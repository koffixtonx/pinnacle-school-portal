import type { Request, Response, NextFunction } from 'express';
import prisma from '../prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

const ADMIN_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN'];

function letterFromScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

async function assertTeachesCourse(userId: string, courseId: string) {
  const course = await prisma.course.findFirst({ where: { id: courseId, teachers: { some: { id: userId } } } });
  if (!course) {
    throw new ApiError(403, 'You do not teach this course.');
  }
}

export const GradesController = {
  async listPeriods(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, tenantId, role } = req.auth!;
      const { courseId } = req.query as { courseId?: string };

      const where =
        role === 'TEACHER'
          ? { tenantId, course: { teachers: { some: { id: userId } } }, ...(courseId ? { courseId } : {}) }
          : role === 'STUDENT'
            ? { tenantId, course: { enrollments: { some: { studentId: userId, status: 'ACTIVE' } } }, ...(courseId ? { courseId } : {}) }
            : { tenantId, ...(courseId ? { courseId } : {}) };

      const periods = await prisma.gradePeriod.findMany({
        where,
        orderBy: { startsAt: 'desc' },
        include: { course: { select: { id: true, title: true, code: true } } },
      });
      res.json({ success: true, data: periods });
    } catch (error) {
      next(error);
    }
  },

  async createPeriod(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, tenantId, role } = req.auth!;
      const { courseId, name, startsAt, endsAt } = req.body as {
        courseId: string;
        name: string;
        startsAt: string;
        endsAt: string;
      };
      if (!courseId || !name || !startsAt || !endsAt) {
        throw new ApiError(422, 'courseId, name, startsAt and endsAt are required.');
      }

      const course = await prisma.course.findFirst({ where: { id: courseId, tenantId } });
      if (!course) {
        throw new ApiError(404, 'Course not found for your tenant.');
      }
      if (role === 'TEACHER') {
        await assertTeachesCourse(userId, courseId);
      } else if (!ADMIN_ROLES.includes(role)) {
        throw new ApiError(403, 'Only teachers or admins can create grade periods.');
      }

      const startDate = new Date(startsAt);
      const endDate = new Date(endsAt);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        throw new ApiError(422, 'startsAt and endsAt must be valid dates.');
      }
      if (endDate <= startDate) {
        throw new ApiError(422, 'endsAt must be after startsAt.');
      }

      const period = await prisma.gradePeriod.create({
        data: { tenantId, courseId, name, startsAt: startDate, endsAt: endDate },
      });
      res.status(201).json({ success: true, data: period });
    } catch (error) {
      next(error);
    }
  },

  async listEntries(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, tenantId, role } = req.auth!;
      const { courseId, gradePeriodId } = req.query as { courseId?: string; gradePeriodId?: string };

      const where =
        role === 'STUDENT'
          ? { tenantId, enrollment: { studentId: userId } }
          : role === 'TEACHER'
            ? { tenantId, gradePeriod: { course: { teachers: { some: { id: userId } } } } }
            : { tenantId };

      const entries = await prisma.gradeEntry.findMany({
        where: {
          ...where,
          ...(courseId ? { gradePeriod: { ...(where as any).gradePeriod, courseId } } : {}),
          ...(gradePeriodId ? { gradePeriodId } : {}),
        },
        orderBy: { recordedAt: 'desc' },
        take: 200,
        include: {
          gradePeriod: { select: { id: true, name: true, courseId: true } },
          enrollment: { select: { id: true, studentId: true } },
        },
      });
      res.json({ success: true, data: entries });
    } catch (error) {
      next(error);
    }
  },

  async upsertEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, tenantId, role } = req.auth!;
      const { enrollmentId, gradePeriodId, score, letterGrade, comments } = req.body as {
        enrollmentId: string;
        gradePeriodId: string;
        score: number;
        letterGrade?: string;
        comments?: string;
      };
      if (!enrollmentId || !gradePeriodId || score === undefined || score === null) {
        throw new ApiError(422, 'enrollmentId, gradePeriodId and score are required.');
      }

      const gradePeriod = await prisma.gradePeriod.findFirst({ where: { id: gradePeriodId, tenantId } });
      if (!gradePeriod) {
        throw new ApiError(404, 'Grade period not found.');
      }
      const enrollment = await prisma.enrollment.findFirst({ where: { id: enrollmentId, tenantId, status: 'ACTIVE' } });
      if (!enrollment) {
        throw new ApiError(404, 'Enrollment not found or not active.');
      }
      if (enrollment.courseId !== gradePeriod.courseId) {
        throw new ApiError(422, 'Enrollment does not belong to the selected grade period course.');
      }
      if (role === 'TEACHER') {
        await assertTeachesCourse(userId, gradePeriod.courseId);
      } else if (!ADMIN_ROLES.includes(role)) {
        throw new ApiError(403, 'Only teachers or admins can enter grades.');
      }

      const entry = await prisma.gradeEntry.upsert({
        where: { enrollmentId_gradePeriodId: { enrollmentId, gradePeriodId } },
        update: { score, letterGrade: letterGrade ?? letterFromScore(score), comments, enteredById: userId },
        create: {
          tenantId,
          enrollmentId,
          gradePeriodId,
          score,
          letterGrade: letterGrade ?? letterFromScore(score),
          comments,
          enteredById: userId,
        },
      });
      res.status(201).json({ success: true, data: entry });
    } catch (error) {
      next(error);
    }
  },
};

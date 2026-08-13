import type { Request, Response, NextFunction } from 'express';
import prisma from '../prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

const ADMIN_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN'];

function requireAdmin(role: string) {
  if (!ADMIN_ROLES.includes(role)) {
    throw new ApiError(403, 'Only school admins can perform this action.');
  }
}

export const AcademicsController = {
  // ---------- Courses ----------
  async listCourses(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, tenantId, role } = req.auth!;
      const where =
        role === 'TEACHER'
          ? { tenantId, teachers: { some: { id: userId } } }
          : role === 'STUDENT'
            ? { tenantId, enrollments: { some: { studentId: userId, status: 'ACTIVE' } } }
            : { tenantId };

      const courses = await prisma.course.findMany({
        where,
        orderBy: { title: 'asc' },
        include: {
          teachers: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { enrollments: true } },
        },
      });
      res.json({ success: true, data: courses });
    } catch (error) {
      next(error);
    }
  },

  async createCourse(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const { title, code, description, teacherIds } = req.body as {
        title: string;
        code: string;
        description: string;
        teacherIds?: string[];
      };
      if (!title || !code) {
        throw new ApiError(422, 'title and code are required.');
      }
      const course = await prisma.course.create({
        data: {
          tenantId: req.auth!.tenantId,
          title,
          code,
          description: description ?? '',
          teachers: teacherIds?.length ? { connect: teacherIds.map((id) => ({ id })) } : undefined,
        },
        include: { teachers: { select: { id: true, firstName: true, lastName: true } } },
      });
      res.status(201).json({ success: true, data: course });
    } catch (error) {
      next(error);
    }
  },

  async updateCourse(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const { id } = req.params;
      const { title, code, description, teacherIds } = req.body as {
        title?: string;
        code?: string;
        description?: string;
        teacherIds?: string[];
      };
      const course = await prisma.course.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(teacherIds ? { teachers: { set: teacherIds.map((tid) => ({ id: tid })) } } : {}),
        },
        include: { teachers: { select: { id: true, firstName: true, lastName: true } } },
      });
      res.json({ success: true, data: course });
    } catch (error) {
      next(error);
    }
  },

  async deleteCourse(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      await prisma.course.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },

  async enrollStudent(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const { id: courseId } = req.params;
      const { studentId } = req.body as { studentId: string };
      if (!studentId) {
        throw new ApiError(422, 'studentId is required.');
      }
      const enrollment = await prisma.enrollment.upsert({
        where: { studentId_courseId: { studentId, courseId } },
        update: { status: 'ACTIVE' },
        create: { tenantId: req.auth!.tenantId, studentId, courseId, status: 'ACTIVE' },
      });
      res.status(201).json({ success: true, data: enrollment });
    } catch (error) {
      next(error);
    }
  },

  async listCourseEnrollments(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, role } = req.auth!;
      const { id: courseId } = req.params;
      if (role === 'TEACHER') {
        const course = await prisma.course.findFirst({ where: { id: courseId, teachers: { some: { id: userId } } } });
        if (!course) {
          throw new ApiError(403, 'You do not teach this course.');
        }
      }
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId, status: 'ACTIVE' },
        include: { student: { select: { id: true, firstName: true, lastName: true } } },
      });
      res.json({ success: true, data: enrollments });
    } catch (error) {
      next(error);
    }
  },

  // ---------- Class sections ----------
  async listClassSections(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, tenantId, role } = req.auth!;
      const where =
        role === 'TEACHER'
          ? { tenantId, homeroomTeacherId: userId }
          : role === 'STUDENT'
            ? { tenantId, students: { some: { id: userId } } }
            : { tenantId };

      const sections = await prisma.classSection.findMany({
        where,
        orderBy: { name: 'asc' },
        include: {
          homeroomTeacher: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { students: true } },
        },
      });
      res.json({ success: true, data: sections });
    } catch (error) {
      next(error);
    }
  },

  async createClassSection(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const { name, grade, homeroomTeacherId } = req.body as {
        name: string;
        grade: string;
        homeroomTeacherId?: string;
      };
      if (!name || !grade) {
        throw new ApiError(422, 'name and grade are required.');
      }
      const section = await prisma.classSection.create({
        data: { tenantId: req.auth!.tenantId, name, grade, homeroomTeacherId },
      });
      res.status(201).json({ success: true, data: section });
    } catch (error) {
      next(error);
    }
  },

  async addStudentToClassSection(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const { id } = req.params;
      const { studentId } = req.body as { studentId: string };
      if (!studentId) {
        throw new ApiError(422, 'studentId is required.');
      }
      const section = await prisma.classSection.update({
        where: { id },
        data: { students: { connect: { id: studentId } } },
        include: { students: { select: { id: true, firstName: true, lastName: true } } },
      });
      res.status(201).json({ success: true, data: section });
    } catch (error) {
      next(error);
    }
  },

  async listClassSectionStudents(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, role } = req.auth!;
      const { id } = req.params;
      const section = await prisma.classSection.findUnique({
        where: { id },
        include: { students: { select: { id: true, firstName: true, lastName: true, email: true } } },
      });
      if (!section) {
        throw new ApiError(404, 'Class section not found.');
      }
      if (role === 'TEACHER' && section.homeroomTeacherId !== userId) {
        throw new ApiError(403, 'You can only view your own class section.');
      }
      res.json({ success: true, data: section.students });
    } catch (error) {
      next(error);
    }
  },

  // ---------- Timetable ----------
  async listTimetable(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, tenantId, role } = req.auth!;
      const { classSectionId, courseId } = req.query as { classSectionId?: string; courseId?: string };

      const where =
        role === 'TEACHER'
          ? { tenantId, teacherId: userId }
          : role === 'STUDENT'
            ? { tenantId, classSection: { students: { some: { id: userId } } } }
            : {
                tenantId,
                ...(classSectionId ? { classSectionId } : {}),
                ...(courseId ? { courseId } : {}),
              };

      const slots = await prisma.timetableSlot.findMany({
        where,
        orderBy: [{ dayOfWeek: 'asc' }, { startsAt: 'asc' }],
        include: {
          course: { select: { id: true, title: true, code: true } },
          classSection: { select: { id: true, name: true } },
          teacher: { select: { id: true, firstName: true, lastName: true } },
        },
      });
      res.json({ success: true, data: slots });
    } catch (error) {
      next(error);
    }
  },

  async createTimetableSlot(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const { courseId, classSectionId, teacherId, dayOfWeek, startsAt, endsAt, room } = req.body as {
        courseId: string;
        classSectionId: string;
        teacherId: string;
        dayOfWeek: number;
        startsAt: string;
        endsAt: string;
        room: string;
      };
      if (!courseId || !classSectionId || !teacherId || dayOfWeek === undefined || !startsAt || !endsAt) {
        throw new ApiError(422, 'courseId, classSectionId, teacherId, dayOfWeek, startsAt and endsAt are required.');
      }
      const slot = await prisma.timetableSlot.create({
        data: {
          tenantId: req.auth!.tenantId,
          courseId,
          classSectionId,
          teacherId,
          dayOfWeek,
          startsAt: new Date(startsAt),
          endsAt: new Date(endsAt),
          room: room ?? '',
        },
      });
      res.status(201).json({ success: true, data: slot });
    } catch (error) {
      next(error);
    }
  },

  async deleteTimetableSlot(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      await prisma.timetableSlot.delete({ where: { id: req.params.id } });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
};

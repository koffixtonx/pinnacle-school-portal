import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

function parseCursor(value?: string) {
  return value ? { createdAt: new Date(value) } : undefined;
}

export const AdminController = {
  async enrollmentAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const enrollmentTrend = await prisma.enrollment.groupBy({
        by: ['createdAt'],
        where: { tenantId },
        _count: { id: true },
      });
      const totalStudents = await prisma.user.count({ where: { tenantId, role: 'STUDENT' } });
      const totalTeachers = await prisma.user.count({ where: { tenantId, role: 'TEACHER' } });
      res.json({ success: true, data: { enrollmentTrend, totals: { totalStudents, totalTeachers } } });
    } catch (error) {
      next(error);
    }
  },

  async feeCollectionAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const monthlyCollection = await prisma.payment.groupBy({
        by: ['paidAt'],
        where: { invoice: { tenantId }, amount: { gt: 0 } },
        _sum: { amount: true },
      });
      res.json({ success: true, data: { monthlyCollection } });
    } catch (error) {
      next(error);
    }
  },

  async attendanceAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const attendanceTotals = await prisma.attendanceRecord.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { status: true },
      });
      res.json({ success: true, data: { attendanceTotals } });
    } catch (error) {
      next(error);
    }
  },

  async listTeachers(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const teachers = await prisma.user.findMany({
        where: { tenantId, role: 'TEACHER' },
        orderBy: [{ firstName: 'asc' }],
        select: { id: true, firstName: true, lastName: true, email: true, active: true },
      });
      res.json({ success: true, data: teachers });
    } catch (error) {
      next(error);
    }
  },

  async listStudents(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const limit = Math.min(Number(req.query.limit) || 25, 100);
      const cursor = parseCursor(req.query.cursor as string | undefined);
      const students = await prisma.user.findMany({
        where: { tenantId, role: 'STUDENT' },
        orderBy: [{ createdAt: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { createdAt: cursor.createdAt, id: '' }, skip: 1 } : {}),
        select: { id: true, firstName: true, lastName: true, email: true, active: true, createdAt: true },
      });
      const hasNextPage = students.length > limit;
      if (hasNextPage) students.pop();
      const nextCursor = hasNextPage ? students[students.length - 1].createdAt.toISOString() : null;
      res.json({ success: true, data: students, paging: { nextCursor } });
    } catch (error) {
      next(error);
    }
  },

  async createTeacher(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const { firstName, lastName, email, password } = req.body as {
        firstName: string;
        lastName: string;
        email: string;
        password?: string;
      };

      if (!firstName || !lastName || !email) {
        throw new ApiError(400, 'First name, last name and email are required.');
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new ApiError(409, 'A user with that email already exists.');
      }

      const passwordHash = await bcrypt.hash(password || 'ChangeMe123!', 12);
      const teacher = await prisma.user.create({
        data: {
          tenantId,
          firstName,
          lastName,
          email,
          passwordHash,
          role: 'TEACHER',
          active: true,
        },
      });

      res.status(201).json({
        success: true,
        data: {
          id: teacher.id,
          firstName: teacher.firstName,
          lastName: teacher.lastName,
          email: teacher.email,
          active: teacher.active,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async createStudent(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const { firstName, lastName, email, password } = req.body as {
        firstName: string;
        lastName: string;
        email: string;
        password?: string;
      };

      if (!firstName || !lastName || !email) {
        throw new ApiError(400, 'First name, last name and email are required.');
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new ApiError(409, 'A user with that email already exists.');
      }

      const passwordHash = await bcrypt.hash(password || 'ChangeMe123!', 12);
      const student = await prisma.user.create({
        data: {
          tenantId,
          firstName,
          lastName,
          email,
          passwordHash,
          role: 'STUDENT',
          active: true,
        },
      });

      res.status(201).json({
        success: true,
        data: {
          id: student.id,
          firstName: student.firstName,
          lastName: student.lastName,
          email: student.email,
          active: student.active,
        },
      });
    } catch (error) {
      next(error);
    }
  },

  async bulkStudentImport(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const { sourceName, lines } = req.body as { sourceName: string; lines: Array<{ email: string; firstName: string; lastName: string }> };
      const job = await prisma.bulkImportJob.create({
        data: {
          tenantId,
          type: 'STUDENT_IMPORT',
          sourceName,
          status: 'PENDING',
          requestedById: req.auth!.userId,
          summary: JSON.stringify({ imported: 0, failed: 0 }),
        },
      });
      void prisma.bulkImportJob.update({ where: { id: job.id }, data: { status: 'PROCESSING' } });
      await Promise.resolve().then(async () => {
        const results = await Promise.all(
          lines.map(async (line) => {
            try {
              await prisma.user.create({
                data: {
                  tenantId,
                  email: line.email,
                  firstName: line.firstName,
                  lastName: line.lastName,
                  passwordHash: await bcrypt.hash('ChangeMe123!', 12),
                  role: 'STUDENT',
                },
              });
              return { success: true };
            } catch {
              return { success: false };
            }
          }),
        );
        const imported = results.filter((result) => result.success).length;
        await prisma.bulkImportJob.update({
          where: { id: job.id },
          data: { status: 'COMPLETED', summary: JSON.stringify({ imported, failed: lines.length - imported }) },
        });
      });
      res.status(202).json({ success: true, jobId: job.id });
    } catch (error) {
      next(error);
    }
  },

  async auditLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const limit = Math.min(Number(req.query.limit) || 25, 100);
      const cursor = parseCursor(req.query.cursor as string | undefined);
      const logs = await prisma.auditLog.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { createdAt: cursor.createdAt, id: '' }, skip: 1 } : {}),
        select: { id: true, action: true, entity: true, entityId: true, summary: true, createdAt: true, actorId: true },
      });
      const hasNextPage = logs.length > limit;
      if (hasNextPage) logs.pop();
      const nextCursor = hasNextPage ? logs[logs.length - 1].createdAt.toISOString() : null;
      res.json({ success: true, data: logs, paging: { nextCursor } });
    } catch (error) {
      next(error);
    }
  },

  async updateTeacher(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { firstName, lastName, email, active } = req.body as { firstName?: string; lastName?: string; email?: string; active?: boolean };
      const user = await prisma.user.update({
        where: { id },
        data: { firstName, lastName, email, active },
        select: { id: true, firstName: true, lastName: true, email: true, active: true },
      });
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  },

  async deleteTeacher(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      await prisma.user.delete({ where: { id } });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },

  async updateStudent(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const { firstName, lastName, email, active } = req.body as { firstName?: string; lastName?: string; email?: string; active?: boolean };
      const user = await prisma.user.update({
        where: { id },
        data: { firstName, lastName, email, active },
        select: { id: true, firstName: true, lastName: true, email: true, active: true, createdAt: true },
      });
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  },

  async deleteStudent(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      await prisma.user.delete({ where: { id } });
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
};

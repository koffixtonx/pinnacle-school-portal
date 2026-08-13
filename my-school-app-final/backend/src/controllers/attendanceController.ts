import type { Request, Response, NextFunction } from 'express';
import prisma from '../prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

const ADMIN_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN'];
const VALID_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'];

export const AttendanceController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, tenantId, role } = req.auth!;
      const { classSectionId, date } = req.query as { classSectionId?: string; date?: string };

      const where: Record<string, unknown> = { tenantId };
      if (role === 'STUDENT') {
        where.studentId = userId;
      } else if (role === 'TEACHER') {
        // Teachers only see attendance for class sections they run.
        where.classSection = { homeroomTeacherId: userId };
      }
      if (classSectionId) where.classSectionId = classSectionId;
      if (date) {
        const day = new Date(date);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);
        where.recordedAt = { gte: day, lt: nextDay };
      }

      const records = await prisma.attendanceRecord.findMany({
        where,
        orderBy: { recordedAt: 'desc' },
        take: 200,
        include: {
          student: { select: { id: true, firstName: true, lastName: true } },
          classSection: { select: { id: true, name: true } },
        },
      });
      res.json({ success: true, data: records });
    } catch (error) {
      next(error);
    }
  },

  // Bulk-mark attendance for a class section on a given date. Teachers may
  // only do this for a class section they're the homeroom teacher of.
  async mark(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, tenantId, role } = req.auth!;
      const { classSectionId, date, records } = req.body as {
        classSectionId: string;
        date: string;
        records: Array<{ studentId: string; status: string; notes?: string }>;
      };

      if (!classSectionId || !date || !Array.isArray(records) || records.length === 0) {
        throw new ApiError(422, 'classSectionId, date and a non-empty records array are required.');
      }
      for (const record of records) {
        if (!VALID_STATUSES.includes(record.status)) {
          throw new ApiError(422, `Invalid status "${record.status}". Must be one of ${VALID_STATUSES.join(', ')}.`);
        }
      }

      const section = await prisma.classSection.findUnique({ where: { id: classSectionId } });
      if (!section || section.tenantId !== tenantId) {
        throw new ApiError(403, 'Class section does not belong to your tenant.');
      }
      if (!ADMIN_ROLES.includes(role)) {
        if (section.homeroomTeacherId !== userId) {
          throw new ApiError(403, 'You can only mark attendance for your own class section.');
        }
      }

      const studentIds = records.map((record) => record.studentId);
      const validStudents = await prisma.user.count({
        where: {
          id: { in: studentIds },
          tenantId,
          role: 'STUDENT',
          classSections: { some: { id: classSectionId } },
        },
      });
      if (validStudents !== studentIds.length) {
        throw new ApiError(422, 'One or more students are invalid, not enrolled in this class section, or do not belong to your tenant.');
      }

      const recordedAt = new Date(date);
      const created = await prisma.$transaction(
        records.map((record) =>
          prisma.attendanceRecord.create({
            data: {
              tenantId,
              classSectionId,
              studentId: record.studentId,
              status: record.status,
              notes: record.notes,
              recordedAt,
              recordedById: userId,
            },
          })
        )
      );

      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  },
};

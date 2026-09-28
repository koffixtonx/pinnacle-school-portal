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
  async listCourseHierarchy(req: Request, res: Response, next: NextFunction) {
    try {
      const faculties = await prisma.faculty.findMany({
        where: { tenantId: req.auth!.tenantId },
        orderBy: { name: 'asc' },
        include: {
          departments: {
            orderBy: { name: 'asc' },
            include: { courses: { orderBy: [{ level: 'asc' }, { code: 'asc' }] } },
          },
        },
      });
      res.json({ success: true, data: faculties });
    } catch (error) { next(error); }
  },

  async listDepartmentTimetable(req: Request, res: Response, next: NextFunction) {
    try {
      const slots = await prisma.departmentTimetableSlot.findMany({
        where: { tenantId: req.auth!.tenantId },
        orderBy: [{ dayOfWeek: 'asc' }, { startHour: 'asc' }],
        include: { course: { select: { id: true, code: true, title: true } }, department: { select: { id: true, name: true, confidence: true } } },
      });
      res.json({ success: true, data: slots });
    } catch (error) { next(error); }
  },

  async createDepartmentTimetableSlot(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const { courseId, departmentId, dayOfWeek, startHour } = req.body as { courseId: string; departmentId: string; dayOfWeek: number; startHour: number };
      if (!courseId || !departmentId || !Number.isInteger(dayOfWeek) || !Number.isInteger(startHour)) throw new ApiError(422, 'courseId, departmentId, dayOfWeek and startHour are required.');
      if (dayOfWeek < 1 || dayOfWeek > 5 || ![8, 10, 12, 14, 16].includes(startHour)) throw new ApiError(422, 'Choose a weekday and one of the fixed two-hour periods from 08:00 to 18:00.');
      const course = await prisma.course.findFirst({ where: { id: courseId, tenantId: req.auth!.tenantId, departmentId } });
      if (!course) throw new ApiError(422, 'The selected course must belong to the selected department.');
      const occupied = await prisma.departmentTimetableSlot.findUnique({ where: { tenantId_dayOfWeek_startHour: { tenantId: req.auth!.tenantId, dayOfWeek, startHour } } });
      if (occupied) throw new ApiError(409, 'This day and time slot is already assigned to another course.');
      const slot = await prisma.departmentTimetableSlot.create({ data: { tenantId: req.auth!.tenantId, courseId, departmentId, dayOfWeek, startHour }, include: { course: { select: { id: true, code: true, title: true } }, department: { select: { id: true, name: true, confidence: true } } } });
      res.status(201).json({ success: true, data: slot });
    } catch (error) { next(error); }
  },

  async deleteDepartmentTimetableSlot(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const slot = await prisma.departmentTimetableSlot.findFirst({ where: { id: req.params.id, tenantId: req.auth!.tenantId } });
      if (!slot) throw new ApiError(404, 'Timetable assignment not found.');
      await prisma.departmentTimetableSlot.delete({ where: { id: slot.id } });
      res.json({ success: true });
    } catch (error) { next(error); }
  },

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
      const { title, code, description, teacherIds, level, departmentId } = req.body as {
        title: string;
        code: string;
        description: string;
        teacherIds?: string[];
        level?: string;
        departmentId?: string | null;
      };
      if (!title || !code) {
        throw new ApiError(422, 'title and code are required.');
      }
      if (departmentId) {
        const department = await prisma.department.findFirst({ where: { id: departmentId, tenantId: req.auth!.tenantId } });
        if (!department) throw new ApiError(404, 'Department not found.');
      }
      const course = await prisma.course.create({
        data: {
          tenantId: req.auth!.tenantId,
          title,
          code,
          description: description ?? '',
          level: level ?? '100',
          departmentId: departmentId ?? null,
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
      const { title, code, description, teacherIds, level, departmentId } = req.body as {
        title?: string;
        code?: string;
        description?: string;
        teacherIds?: string[];
        level?: string;
        departmentId?: string | null;
      };
      const course = await prisma.course.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(level !== undefined ? { level } : {}),
          ...(departmentId === null ? { department: { disconnect: true } } : departmentId ? { department: { connect: { id: departmentId } } } : {}),
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

  async listAvailableCourses(req: Request, res: Response, next: NextFunction) {
    try {
      const courses = await prisma.course.findMany({
        where: { tenantId: req.auth!.tenantId },
        orderBy: [{ level: 'asc' }, { title: 'asc' }],
        include: {
          teachers: { select: { id: true, firstName: true, lastName: true } },
          enrollments: { where: { studentId: req.auth!.userId }, select: { id: true, status: true } },
        },
      });
      res.json({ success: true, data: courses });
    } catch (error) { next(error); }
  },

  async requestCourseEnrollment(req: Request, res: Response, next: NextFunction) {
    try {
      const courseId = String(req.params.id);
      const course = await prisma.course.findFirst({ where: { id: courseId, tenantId: req.auth!.tenantId } });
      if (!course) throw new ApiError(404, 'Course not found.');
      const enrollment = await prisma.enrollment.upsert({
        where: { studentId_courseId: { studentId: req.auth!.userId, courseId } },
        update: { status: 'PENDING' },
        create: { tenantId: req.auth!.tenantId, studentId: req.auth!.userId, courseId, status: 'PENDING' },
      });
      res.status(201).json({ success: true, data: enrollment });
    } catch (error) { next(error); }
  },

  async listPendingEnrollments(req: Request, res: Response, next: NextFunction) {
    try {
      const enrollments = await prisma.enrollment.findMany({
        where: { tenantId: req.auth!.tenantId, status: 'PENDING', course: { teachers: { some: { id: req.auth!.userId } } } },
        orderBy: { createdAt: 'asc' },
        include: {
          course: { select: { id: true, title: true, code: true, level: true } },
          student: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      res.json({ success: true, data: enrollments });
    } catch (error) { next(error); }
  },

  async reviewEnrollment(req: Request, res: Response, next: NextFunction) {
    try {
      const enrollmentId = String(req.params.id);
      const status = String(req.body.status ?? '');
      if (!['ACTIVE', 'REJECTED'].includes(status)) throw new ApiError(400, 'Status must be ACTIVE or REJECTED.');
      const enrollment = await prisma.enrollment.findFirst({ where: { id: enrollmentId, tenantId: req.auth!.tenantId, status: 'PENDING', course: { teachers: { some: { id: req.auth!.userId } } } } });
      if (!enrollment) throw new ApiError(404, 'Pending enrollment not found.');
      const updated = await prisma.enrollment.update({ where: { id: enrollmentId }, data: { status } });
      res.json({ success: true, data: updated });
    } catch (error) { next(error); }
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

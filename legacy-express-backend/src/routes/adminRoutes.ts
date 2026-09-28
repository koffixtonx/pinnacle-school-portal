import { Router } from 'express';
import { authenticate, authorize, verifyTenantAccess } from '../middleware/authMiddleware.js';
import { AdminController } from '../controllers/adminController.js';

const router = Router();

router.use(authenticate, verifyTenantAccess);

// Read-only rosters: admins and teachers both legitimately need these
// (teachers to see who's in their classes), so they don't require the
// stricter admin-only gate below.
router.get('/students', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'), AdminController.listStudents);
router.get('/teachers', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'), AdminController.listTeachers);
router.put('/students/:id', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN', 'TEACHER'), AdminController.updateStudent);

// Everything else (analytics, bulk import, audit log) is admin-only.
router.use(authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'));

router.get('/analytics/enrollments', AdminController.enrollmentAnalytics);
router.get('/analytics/fees', AdminController.feeCollectionAnalytics);
router.get('/analytics/attendance', AdminController.attendanceAnalytics);
router.post('/students/import', AdminController.bulkStudentImport);
router.get('/audit-logs', AdminController.auditLogs);

// Admin CRUD for teachers and students
router.post('/teachers', AdminController.createTeacher);
router.put('/teachers/:id', AdminController.updateTeacher);
router.delete('/teachers/:id', AdminController.deleteTeacher);

router.post('/students', AdminController.createStudent);
router.delete('/students/:id', AdminController.deleteStudent);
router.get('/faculties', AdminController.listFaculties);
router.post('/faculties', AdminController.createFaculty);
router.get('/departments', AdminController.listDepartments);
router.post('/departments', AdminController.createDepartment);

export { router as adminRouter };

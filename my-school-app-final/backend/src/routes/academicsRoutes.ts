import { Router } from 'express';
import { authenticate, authorize, verifyTenantAccess } from '../middleware/authMiddleware.js';
import { AcademicsController } from '../controllers/academicsController.js';

const router = Router();

router.use(authenticate, verifyTenantAccess);

router.get('/courses', AcademicsController.listCourses);
router.get('/course-hierarchy', AcademicsController.listCourseHierarchy);
router.get('/courses/available', authorize('STUDENT'), AcademicsController.listAvailableCourses);
router.post('/courses', AcademicsController.createCourse);
router.put('/courses/:id', AcademicsController.updateCourse);
router.delete('/courses/:id', AcademicsController.deleteCourse);
router.post('/courses/:id/request-enrollment', authorize('STUDENT'), AcademicsController.requestCourseEnrollment);
router.get('/enrollments/pending', authorize('TEACHER'), AcademicsController.listPendingEnrollments);
router.patch('/enrollments/:id/review', authorize('TEACHER'), AcademicsController.reviewEnrollment);
router.post('/courses/:id/enroll', AcademicsController.enrollStudent);
router.get('/courses/:id/enrollments', AcademicsController.listCourseEnrollments);

router.get('/classes', AcademicsController.listClassSections);
router.post('/classes', AcademicsController.createClassSection);
router.get('/classes/:id/students', AcademicsController.listClassSectionStudents);
router.post('/classes/:id/students', AcademicsController.addStudentToClassSection);

router.get('/timetable', AcademicsController.listTimetable);
router.post('/timetable', AcademicsController.createTimetableSlot);
router.delete('/timetable/:id', AcademicsController.deleteTimetableSlot);
router.get('/department-timetable', AcademicsController.listDepartmentTimetable);
router.post('/department-timetable', AcademicsController.createDepartmentTimetableSlot);
router.delete('/department-timetable/:id', AcademicsController.deleteDepartmentTimetableSlot);

export { router as academicsRouter };

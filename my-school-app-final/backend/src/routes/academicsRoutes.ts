import { Router } from 'express';
import { authenticate, verifyTenantAccess } from '../middleware/authMiddleware.js';
import { AcademicsController } from '../controllers/academicsController.js';

const router = Router();

router.use(authenticate, verifyTenantAccess);

router.get('/courses', AcademicsController.listCourses);
router.post('/courses', AcademicsController.createCourse);
router.put('/courses/:id', AcademicsController.updateCourse);
router.delete('/courses/:id', AcademicsController.deleteCourse);
router.post('/courses/:id/enroll', AcademicsController.enrollStudent);
router.get('/courses/:id/enrollments', AcademicsController.listCourseEnrollments);

router.get('/classes', AcademicsController.listClassSections);
router.post('/classes', AcademicsController.createClassSection);
router.get('/classes/:id/students', AcademicsController.listClassSectionStudents);
router.post('/classes/:id/students', AcademicsController.addStudentToClassSection);

router.get('/timetable', AcademicsController.listTimetable);
router.post('/timetable', AcademicsController.createTimetableSlot);
router.delete('/timetable/:id', AcademicsController.deleteTimetableSlot);

export { router as academicsRouter };

import { Router } from 'express';
import { authenticate, verifyTenantAccess } from '../middleware/authMiddleware.js';
import { AttendanceController } from '../controllers/attendanceController.js';

const router = Router();

router.use(authenticate, verifyTenantAccess);

router.get('/', AttendanceController.list);
router.post('/', AttendanceController.mark);

export { router as attendanceRouter };

import { Router } from 'express';
import { authenticate, verifyTenantAccess } from '../middleware/authMiddleware.js';
import { GradesController } from '../controllers/gradesController.js';

const router = Router();

router.use(authenticate, verifyTenantAccess);

router.get('/periods', GradesController.listPeriods);
router.post('/periods', GradesController.createPeriod);

router.get('/entries', GradesController.listEntries);
router.post('/entries', GradesController.upsertEntry);

export { router as gradesRouter };

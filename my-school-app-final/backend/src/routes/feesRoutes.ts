import { Router } from 'express';
import { authenticate, verifyTenantAccess } from '../middleware/authMiddleware.js';
import { FeesController } from '../controllers/feesController.js';

const router = Router();

router.use(authenticate, verifyTenantAccess);

router.get('/structures', FeesController.listStructures);
router.post('/structures', FeesController.createStructure);

router.get('/invoices', FeesController.listInvoices);
router.post('/invoices', FeesController.createInvoice);
router.post('/invoices/:id/payments', FeesController.recordPayment);

export { router as feesRouter };

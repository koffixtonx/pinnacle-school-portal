import { Router } from 'express';
import { authenticate, authorize, verifyTenantAccess } from '../middleware/authMiddleware.js';
import SiteSettingsController, { uploadMiddleware } from '../controllers/siteSettingsController.js';

const router = Router();

router.use(authenticate, verifyTenantAccess);
router.get('/', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), SiteSettingsController.getSettings);
router.post('/', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), uploadMiddleware.fields([{ name: 'logo' }, { name: 'hero' }]), SiteSettingsController.updateSettings);

export { router as siteSettingsRouter };

import { Router } from 'express';
import { authenticate, authorize, verifyTenantAccess } from '../middleware/authMiddleware.js';
import SiteSettingsController, { uploadMiddleware } from '../controllers/siteSettingsController.js';

const router = Router();

router.use(authenticate, verifyTenantAccess);
router.get('/welcome-message', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), SiteSettingsController.getWelcomeMessage);
router.put('/welcome-message', authorize('SUPER_ADMIN'), SiteSettingsController.updateWelcomeMessage);
router.get('/welcome-backgrounds', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), SiteSettingsController.getWelcomeBackgrounds);
router.put('/welcome-backgrounds', authorize('SUPER_ADMIN'), uploadMiddleware.array('images', 8), SiteSettingsController.updateWelcomeBackgrounds);
router.get('/', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), SiteSettingsController.getSettings);
router.post('/', authorize('SUPER_ADMIN', 'SCHOOL_ADMIN'), uploadMiddleware.fields([{ name: 'logo' }, { name: 'hero' }]), SiteSettingsController.updateSettings);

export { router as siteSettingsRouter };

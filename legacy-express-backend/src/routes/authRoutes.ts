import { Router } from 'express';
import { body } from 'express-validator';
import { authLimiter } from '../middleware/rateLimiter.js';
import { AuthController } from '../controllers/authController.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = Router();

router.post(
  '/register',
  authLimiter,
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  validateRequest,
  AuthController.register,
);

router.post(
  '/login',
  authLimiter,
  body('email').isEmail(),
  body('password').isLength({ min: 8 }),
  validateRequest,
  AuthController.login,
);

router.post('/refresh', authLimiter, AuthController.refresh);
router.post('/logout', AuthController.logout);
router.put('/profile', authenticate, AuthController.updateProfile);

export { router as authRouter };

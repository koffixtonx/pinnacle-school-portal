import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { signAccessToken, signRefreshToken, storeRefreshToken, rotateRefreshToken, verifyRefreshToken, revokeRefreshToken } from '../middleware/authMiddleware.js';
import { ApiError } from '../middleware/errorHandler.js';

function setRefreshCookie(res: Response, token: string) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'none',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export const AuthController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const { firstName, lastName, email, password } = req.body as {
        firstName: string;
        lastName: string;
        email: string;
        password: string;
      };

      // Self-registration is scoped to a single default tenant (this app is
      // currently deployed for one school). Role is intentionally hardcoded
      // to STUDENT here - it must never be read from the request body, or
      // anyone could register themselves as SUPER_ADMIN. Staff/admin
      // accounts are provisioned separately (see AdminController).
      const tenantSlug = process.env.DEFAULT_TENANT_SLUG ?? 'pinnacle-school';
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant || tenant.status !== 'ACTIVE') {
        throw new ApiError(503, 'Registration is not available right now.');
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        throw new ApiError(409, 'An account with this email already exists.');
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash,
          firstName,
          lastName,
          role: 'STUDENT',
        },
      });

      const payload = { userId: user.id, tenantId: user.tenantId, role: user.role };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);
      await storeRefreshToken(user.id, refreshToken);
      setRefreshCookie(res, refreshToken);
      res.status(201).json({ success: true, accessToken, user: { id: user.id, email: user.email, role: user.role } });
    } catch (error) {
      next(error);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body as { email: string; password: string };
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.active) {
        throw new ApiError(401, 'Invalid credentials');
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        throw new ApiError(401, 'Invalid credentials');
      }

      const payload = { userId: user.id, tenantId: user.tenantId, role: user.role };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);
      await storeRefreshToken(user.id, refreshToken);
      setRefreshCookie(res, refreshToken);
      res.json({ success: true, accessToken, user: { id: user.id, email: user.email, role: user.role } });
    } catch (error) {
      next(error);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies.refreshToken ?? req.body.refreshToken;
      if (!token) {
        throw new ApiError(401, 'Refresh token required');
      }
      const { payload, tokenId } = await verifyRefreshToken(token);
      const nextAccessToken = signAccessToken(payload);
      const nextRefreshToken = signRefreshToken(payload);
      await rotateRefreshToken(payload.userId, tokenId, nextRefreshToken);
      setRefreshCookie(res, nextRefreshToken);
      res.json({ success: true, accessToken: nextAccessToken });
    } catch (error) {
      next(error);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.cookies.refreshToken;
      if (token) {
        await revokeRefreshToken(token);
      }
      res.clearCookie('refreshToken', { httpOnly: true, sameSite: 'none', secure: process.env.NODE_ENV === 'production' });
      res.json({ success: true, message: 'Logged out' });
    } catch (error) {
      next(error);
    }
  },
};

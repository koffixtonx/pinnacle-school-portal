import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { signAccessToken, signRefreshToken, storeRefreshToken, rotateRefreshToken, verifyRefreshToken, revokeRefreshToken } from '../middleware/authMiddleware.js';
import { ApiError } from '../middleware/errorHandler.js';

const NIGERIAN_PHONE_PATTERN = /^(?:\+234|234|0)(?:7|8|9)\d{9}$/;

const profileSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
} as const;

function normalizePhone(phone: string) {
  return phone.replace(/[\s().-]/g, '');
}

function setRefreshCookie(res: Response, token: string) {
  const isSecureContext = process.env.NODE_ENV === 'production' || process.env.SECURE_COOKIES === 'true';
  const secure = isSecureContext;
  const sameSite = secure ? 'none' : 'lax';

  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
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
      res.status(201).json({ success: true, accessToken, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone, role: user.role } });
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
      res.json({ success: true, accessToken, user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone, role: user.role } });
    } catch (error) {
      next(error);
    }
  },

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const { fullName, phone } = req.body as { fullName?: string; phone?: string };
      const normalizedName = fullName?.trim().replace(/\s+/g, ' ');
      const normalizedPhone = phone === undefined ? undefined : normalizePhone(phone.trim());

      if (!normalizedName || normalizedName.split(' ').length < 2) {
        throw new ApiError(400, 'Please enter your first and last name.');
      }
      if (normalizedPhone && !NIGERIAN_PHONE_PATTERN.test(normalizedPhone)) {
        throw new ApiError(400, 'Please enter a valid Nigerian phone number, such as +234 803 000 1234.');
      }
      if (!req.auth) {
        throw new ApiError(401, 'Authentication required.');
      }

      const nameParts = normalizedName.split(' ');
      const firstName = nameParts.shift() as string;
      const lastName = nameParts.join(' ');
      const user = await prisma.user.update({
        where: { id: req.auth.userId },
        data: { firstName, lastName, phone: normalizedPhone || null },
        select: profileSelect,
      });

      res.json({ success: true, user });
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

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import prisma from '../prisma.js';
import { ApiError } from './errorHandler.js';

// Fail fast instead of silently signing tokens with a guessable default.
// Access and refresh tokens intentionally use different secrets so that a
// leaked access token (short-lived, sent on every request) can't be reused
// to forge a long-lived refresh token, and vice versa.
function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set in the environment. See .env.example.`);
  }
  return value;
}

const JWT_SECRET = requireSecret('JWT_SECRET');
const JWT_REFRESH_SECRET = requireSecret('JWT_REFRESH_SECRET');
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '30d';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type AuthPayload = { userId: string; tenantId: string; role: string };

export function signAccessToken(payload: AuthPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

export function signRefreshToken(payload: AuthPayload) {
  return jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRY });
}

/**
 * Persists a brand-new refresh token (e.g. on login, where there's no prior
 * token to retire). Use rotateRefreshToken below when replacing an existing
 * token so the old one is invalidated in the same step.
 */
export async function storeRefreshToken(userId: string, token: string) {
  const hashedToken = await bcrypt.hash(token, 12);
  await prisma.refreshToken.create({
    data: {
      userId,
      hashedToken,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
}

/**
 * Replaces an existing refresh token with a new one atomically: the old
 * token record is revoked and the new one is created in a single
 * transaction, so a stolen/replayed old token stops working the moment it's
 * rotated rather than staying valid until it expires.
 */
export async function rotateRefreshToken(userId: string, oldTokenId: string, newToken: string) {
  const hashedToken = await bcrypt.hash(newToken, 12);
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: oldTokenId },
      data: { revoked: true, rotated: true },
    }),
    prisma.refreshToken.create({
      data: {
        userId,
        hashedToken,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    }),
  ]);
}

/**
 * Verifies a refresh token against stored hashes and returns both the JWT
 * payload and the matched DB record id, so the caller can revoke that exact
 * record (see rotateRefreshToken) instead of re-scanning for it.
 */
export async function verifyRefreshToken(token: string): Promise<{ payload: AuthPayload; tokenId: string }> {
  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, JWT_REFRESH_SECRET) as AuthPayload;
  } catch {
    throw new ApiError(401, 'Invalid refresh token');
  }

  const tokens = await prisma.refreshToken.findMany({
    where: { userId: payload.userId, revoked: false },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  for (const record of tokens) {
    if (await bcrypt.compare(token, record.hashedToken)) {
      if (record.expiresAt < new Date()) {
        throw new ApiError(401, 'Refresh token expired');
      }
      return { payload, tokenId: record.id };
    }
  }
  throw new ApiError(401, 'Refresh token not found');
}

/** Revokes exactly the one refresh token record matching the given raw token (used on logout). */
export async function revokeRefreshToken(token: string) {
  let userId: string;
  try {
    const payload = jwt.verify(token, JWT_REFRESH_SECRET) as AuthPayload;
    userId = payload.userId;
  } catch {
    // Token is invalid or expired - nothing we can safely revoke.
    return;
  }

  const tokens = await prisma.refreshToken.findMany({
    where: { userId, revoked: false },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  for (const record of tokens) {
    if (await bcrypt.compare(token, record.hashedToken)) {
      await prisma.refreshToken.update({ where: { id: record.id }, data: { revoked: true } });
      return;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new ApiError(401, 'Authentication required.'));
  }

  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    next(new ApiError(401, 'Invalid or expired token.'));
  }
}

export function authorize(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new ApiError(401, 'Authentication required.'));
    }
    if (!allowedRoles.includes(req.auth.role)) {
      return next(new ApiError(403, 'Insufficient permissions.'));
    }
    next();
  };
}

export async function verifyTenantAccess(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    return next(new ApiError(401, 'Authentication required.'));
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId } });
  if (!tenant || tenant.status !== 'ACTIVE') {
    return next(new ApiError(403, 'Tenant access denied.'));
  }
  next();
}

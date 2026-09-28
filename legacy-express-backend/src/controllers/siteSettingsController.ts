import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import prisma from '../prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

const uploadsDir = path.join(process.cwd(), 'backend', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
});

export const uploadMiddleware = multer({ storage });
const MAX_WELCOME_BACKGROUNDS = 8;

const parseBackgroundImages = (value: string | null | undefined): string[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch { return []; }
};

export const SiteSettingsController = {
  async getSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const settings = await prisma.siteSettings.findUnique({ where: { tenantId } });
      const parsed = settings
        ? { ...settings, widgetConfig: settings.widgetConfig ? JSON.parse(settings.widgetConfig) : { announcements: true, calendar: true, quickLinks: true }, welcomeBackgroundImages: parseBackgroundImages(settings.welcomeBackgroundImages) }
        : null;
      res.json({ success: true, data: parsed });
    } catch (error) {
      next(error);
    }
  },

  async publicGetSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const slug = String(req.query.tenantSlug || 'pinnacle-school');
      const tenant = await prisma.tenant.findUnique({ where: { slug } });
      if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found' });
      const settings = await prisma.siteSettings.findUnique({ where: { tenantId: tenant.id } });
      const parsed = settings
        ? { ...settings, widgetConfig: settings.widgetConfig ? JSON.parse(settings.widgetConfig) : { announcements: true, calendar: true, quickLinks: true }, welcomeBackgroundImages: parseBackgroundImages(settings.welcomeBackgroundImages) }
        : null;
      res.json({ success: true, data: parsed });
    } catch (error) {
      next(error);
    }
  },

  async updateSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const { primaryColor, secondaryColor, widgetConfig } = req.body as { primaryColor?: string; secondaryColor?: string; widgetConfig?: any };
      const updateData: any = {};
      if (primaryColor) updateData.primaryColor = primaryColor;
      if (secondaryColor) updateData.secondaryColor = secondaryColor;
      if (widgetConfig !== undefined) updateData.widgetConfig = typeof widgetConfig === 'string' ? widgetConfig : JSON.stringify(widgetConfig);

      // handle uploaded files if present
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      if (files) {
        if (files.logo && files.logo[0]) updateData.logoPath = `/uploads/${path.basename(files.logo[0].path)}`;
        if (files.hero && files.hero[0]) updateData.heroImagePath = `/uploads/${path.basename(files.hero[0].path)}`;
      }

      const settings = await prisma.siteSettings.upsert({
        where: { tenantId },
        update: updateData,
        create: { tenantId, ...updateData },
      });
      const parsed = { ...settings, widgetConfig: settings.widgetConfig ? JSON.parse(settings.widgetConfig) : { announcements: true, calendar: true, quickLinks: true } };
      res.json({ success: true, data: parsed });
    } catch (error) {
      next(error);
    }
  },

  async getWelcomeMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await prisma.siteSettings.findUnique({
        where: { tenantId: req.auth!.tenantId },
        select: { welcomeMessage: true, welcomeMessageColor: true },
      });
      res.json({ success: true, data: { welcomeMessage: settings?.welcomeMessage ?? null, welcomeMessageColor: settings?.welcomeMessageColor ?? '#FFFFFF' } });
    } catch (error) {
      next(error);
    }
  },

  async updateWelcomeMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { welcomeMessage: value, welcomeMessageColor } = req.body as { welcomeMessage?: unknown; welcomeMessageColor?: unknown };
      if (typeof value !== 'string') {
        throw new ApiError(400, 'Welcome message must be text.');
      }
      if (typeof welcomeMessageColor !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(welcomeMessageColor)) {
        throw new ApiError(400, 'Welcome message color must be a six-digit hex color.');
      }
      const welcomeMessage = value.trim();
      if (welcomeMessage.length > 160) {
        throw new ApiError(400, 'Welcome message must be 160 characters or fewer.');
      }
      await prisma.siteSettings.upsert({
        where: { tenantId: req.auth!.tenantId },
        update: { welcomeMessage: welcomeMessage || null, welcomeMessageColor },
        create: { tenantId: req.auth!.tenantId, welcomeMessage: welcomeMessage || null, welcomeMessageColor },
      });
      res.json({ success: true, data: { welcomeMessage: welcomeMessage || null, welcomeMessageColor } });
    } catch (error) {
      next(error);
    }
  },

  async getWelcomeBackgrounds(req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await prisma.siteSettings.findUnique({
        where: { tenantId: req.auth!.tenantId },
        select: { welcomeBackgroundImages: true },
      });
      res.json({ success: true, data: { images: parseBackgroundImages(settings?.welcomeBackgroundImages) } });
    } catch (error) { next(error); }
  },

  async updateWelcomeBackgrounds(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const settings = await prisma.siteSettings.findUnique({
        where: { tenantId },
        select: { welcomeBackgroundImages: true },
      });
      const existing = parseBackgroundImages(settings?.welcomeBackgroundImages);
      const removePaths = parseBackgroundImages(typeof req.body.removePaths === 'string' ? req.body.removePaths : null);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const remaining = existing.filter((image) => !removePaths.includes(image));
      if (remaining.length + files.length > MAX_WELCOME_BACKGROUNDS) {
        files.forEach((file) => fs.unlink(file.path, () => undefined));
        throw new ApiError(400, `Welcome Page Background supports a maximum of ${MAX_WELCOME_BACKGROUNDS} images.`);
      }
      const images = [...remaining, ...files.map((file) => `/uploads/${path.basename(file.path)}`)];
      await prisma.siteSettings.upsert({
        where: { tenantId },
        update: { welcomeBackgroundImages: JSON.stringify(images) },
        create: { tenantId, welcomeBackgroundImages: JSON.stringify(images) },
      });
      res.json({ success: true, data: { images } });
    } catch (error) { next(error); }
  },
};

export default SiteSettingsController;

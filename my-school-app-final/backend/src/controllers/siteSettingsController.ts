import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import prisma from '../prisma.js';

const uploadsDir = path.join(process.cwd(), 'backend', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`),
});

export const uploadMiddleware = multer({ storage });

export const SiteSettingsController = {
  async getSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = req.auth!.tenantId;
      const settings = await prisma.siteSettings.findUnique({ where: { tenantId } });
      const parsed = settings
        ? { ...settings, widgetConfig: settings.widgetConfig ? JSON.parse(settings.widgetConfig) : { announcements: true, calendar: true, quickLinks: true } }
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
        ? { ...settings, widgetConfig: settings.widgetConfig ? JSON.parse(settings.widgetConfig) : { announcements: true, calendar: true, quickLinks: true } }
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
};

export default SiteSettingsController;

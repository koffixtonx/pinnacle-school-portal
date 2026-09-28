import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { authRouter } from './routes/authRoutes.js';
import { adminRouter } from './routes/adminRoutes.js';
import { notificationsRouter } from './routes/notificationsRoutes.js';
import { academicsRouter } from './routes/academicsRoutes.js';
import { attendanceRouter } from './routes/attendanceRoutes.js';
import { gradesRouter } from './routes/gradesRoutes.js';
import { feesRouter } from './routes/feesRoutes.js';
import { siteSettingsRouter } from './routes/siteSettingsRoutes.js';
import path from 'path';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimiter.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(morgan('combined'));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
const configuredOrigins = (process.env.CLIENT_URL ?? 'http://localhost:5173')
  .split(',')
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter(Boolean);

const developmentOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174'];

app.use(
  cors({
    origin: (origin, callback) => {
      const normalizedOrigin = origin?.replace(/\/$/, '');
      const allowed = !origin || configuredOrigins.includes(normalizedOrigin ?? '') || (process.env.NODE_ENV !== 'production' && developmentOrigins.includes(normalizedOrigin ?? ''));
      callback(allowed ? null : new Error('Origin is not allowed by CORS'), allowed);
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(globalLimiter);

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/academics', academicsRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/grades', gradesRouter);
app.use('/api/fees', feesRouter);
// Serve uploaded assets
app.use('/uploads', express.static(path.join(process.cwd(), 'backend', 'uploads')));
// Public read endpoint for welcome page to fetch branding without auth
import SiteSettingsController from './controllers/siteSettingsController.js';
app.get('/api/site-settings/public', SiteSettingsController.publicGetSettings);
app.use('/api/site-settings', siteSettingsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'School API is healthy' });
});

app.use(notFoundHandler);
app.use(errorHandler);

export { app };

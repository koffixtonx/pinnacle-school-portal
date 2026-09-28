import { Router } from 'express';
import { authenticate, verifyTenantAccess } from '../middleware/authMiddleware.js';
import prisma from '../prisma.js';

const router = Router();

router.get('/', authenticate, verifyTenantAccess, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const notifications = await prisma.notification.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  res.json({ success: true, data: notifications });
});

router.patch('/read-all', authenticate, verifyTenantAccess, async (req, res) => {
  await prisma.notification.updateMany({
    where: { tenantId: req.auth!.tenantId },
    data: { readBy: req.auth!.userId },
  });

  res.json({ success: true });
});

router.patch('/:id/read', authenticate, verifyTenantAccess, async (req, res) => {
  const notification = await prisma.notification.updateMany({
    where: {
      id: req.params.id,
      tenantId: req.auth!.tenantId,
    },
    data: {
      readBy: req.auth!.userId,
    },
  });

  if (notification.count === 0) {
    return res.status(404).json({ success: false, message: 'Notification not found.' });
  }

  res.json({ success: true });
});

router.get('/stream', authenticate, verifyTenantAccess, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(async () => {
    const notifications = await prisma.notification.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    send('notifications', notifications);
  }, 10_000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

export { router as notificationsRouter };

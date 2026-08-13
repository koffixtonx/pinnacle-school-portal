import { Router } from 'express';
import { authenticate, verifyTenantAccess } from '../middleware/authMiddleware.js';
import prisma from '../prisma.js';

const router = Router();

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

import type { Request, Response, NextFunction } from 'express';
import prisma from '../prisma.js';
import { ApiError } from '../middleware/errorHandler.js';

const ADMIN_ROLES = ['SUPER_ADMIN', 'SCHOOL_ADMIN'];

function requireAdmin(role: string) {
  if (!ADMIN_ROLES.includes(role)) {
    throw new ApiError(403, 'Only school admins can perform this action.');
  }
}

function generateReference() {
  return `INV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export const FeesController = {
  // ---------- Fee structures ----------
  async listStructures(req: Request, res: Response, next: NextFunction) {
    try {
      const structures = await prisma.feeStructure.findMany({
        where: { tenantId: req.auth!.tenantId, active: true },
        orderBy: { name: 'asc' },
      });
      res.json({ success: true, data: structures });
    } catch (error) {
      next(error);
    }
  },

  async createStructure(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const { name, amount, frequency } = req.body as { name: string; amount: number; frequency: string };
      if (!name || amount === undefined || !frequency) {
        throw new ApiError(422, 'name, amount and frequency are required.');
      }
      const structure = await prisma.feeStructure.create({
        data: { tenantId: req.auth!.tenantId, name, amount, frequency },
      });
      res.status(201).json({ success: true, data: structure });
    } catch (error) {
      next(error);
    }
  },

  // ---------- Invoices ----------
  async listInvoices(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, tenantId, role } = req.auth!;
      const { studentId } = req.query as { studentId?: string };

      const where =
        role === 'STUDENT'
          ? { tenantId, studentId: userId }
          : { tenantId, ...(studentId ? { studentId } : {}) };

      const invoices = await prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          lines: true,
          payments: true,
          student: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      });
      res.json({ success: true, data: invoices });
    } catch (error) {
      next(error);
    }
  },

  async createInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const { studentId, dueDate, lines } = req.body as {
        studentId: string;
        dueDate: string;
        lines: Array<{ description: string; amount: number }>;
      };
      if (!studentId || !dueDate || !Array.isArray(lines) || lines.length === 0) {
        throw new ApiError(422, 'studentId, dueDate and a non-empty lines array are required.');
      }
      const student = await prisma.user.findFirst({ where: { id: studentId, tenantId: req.auth!.tenantId, role: 'STUDENT', active: true } });
      if (!student) {
        throw new ApiError(404, 'Student not found or not active.');
      }
      const due = new Date(dueDate);
      if (Number.isNaN(due.getTime())) {
        throw new ApiError(422, 'dueDate must be a valid date.');
      }
      const sanitizedLines = lines.map((line) => ({ description: String(line.description).trim(), amount: Number(line.amount) }));
      if (sanitizedLines.some((line) => !line.description || !(line.amount > 0))) {
        throw new ApiError(422, 'Each invoice line must have a description and a positive amount.');
      }
      const totalAmount = sanitizedLines.reduce((sum, line) => sum + line.amount, 0);
      if (!(totalAmount > 0)) {
        throw new ApiError(422, 'Invoice lines must sum to a positive amount.');
      }

      const invoice = await prisma.invoice.create({
        data: {
          tenantId: req.auth!.tenantId,
          studentId,
          issuedById: req.auth!.userId,
          dueDate: due,
          totalAmount,
          reference: generateReference(),
          lines: { create: sanitizedLines.map((line) => ({ description: line.description, amount: line.amount })) },
        },
        include: { lines: true },
      });
      res.status(201).json({ success: true, data: invoice });
    } catch (error) {
      next(error);
    }
  },

  async recordPayment(req: Request, res: Response, next: NextFunction) {
    try {
      requireAdmin(req.auth!.role);
      const { id: invoiceId } = req.params;
      const { amount, method, transactionId } = req.body as { amount: number; method: string; transactionId?: string };
      const ALLOWED_METHODS = ['CARD', 'BANK_TRANSFER', 'CASH'];
      if (!amount || amount <= 0 || !method) {
        throw new ApiError(422, 'A positive amount and method are required.');
      }
      if (!ALLOWED_METHODS.includes(method)) {
        throw new ApiError(422, 'Payment method is invalid.');
      }

      const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId: req.auth!.tenantId } });
      if (!invoice) {
        throw new ApiError(404, 'Invoice not found.');
      }

      const remaining = Number(invoice.totalAmount) - Number(invoice.paidAmount);
      if (amount > remaining) {
        throw new ApiError(422, 'Payment amount cannot exceed remaining invoice balance.');
      }

      const newPaidAmount = Number(invoice.paidAmount) + Number(amount);
      const status = newPaidAmount >= Number(invoice.totalAmount) ? 'PAID' : 'PARTIAL';

      const [payment] = await prisma.$transaction([
        prisma.payment.create({
          data: {
            tenantId: req.auth!.tenantId,
            invoiceId,
            studentId: invoice.studentId,
            amount,
            method,
            transactionId,
          },
        }),
        prisma.invoice.update({ where: { id: invoiceId }, data: { paidAmount: newPaidAmount, status } }),
      ]);

      res.status(201).json({ success: true, data: payment });
    } catch (error) {
      next(error);
    }
  },
};

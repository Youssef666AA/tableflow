import { Router } from 'express';
import { z } from 'zod';
import { createPaymentSchema, mockCardSchema } from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { assertBranchAccess, authenticate, requirePermission, resolveBranchId } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import { createPayment, getReceipt, getSessionBill, refundPayment } from '../services/payments.js';
import { listProviders } from '../services/mock-payment-provider.js';
import { renderReceiptPdf, type ReceiptSnapshot } from '../services/receipt-pdf.js';

export const billingRouter: Router = Router();

billingRouter.use(authenticate);

/** Open tabs: every session with something still to pay. */
billingRouter.get(
  '/open',
  requirePermission('billing:view'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);

    const sessions = await prisma.tableSession.findMany({
      where: {
        branchId,
        status: { in: ['ACTIVE', 'PAUSED', 'LOCATION_PENDING', 'CREATED'] },
        orders: { some: { status: { notIn: ['CANCELLED', 'REJECTED'] } } },
      },
      include: {
        table: { select: { id: true, number: true, zone: true } },
        orders: { where: { status: { notIn: ['CANCELLED', 'REJECTED'] } }, select: { total: true, paymentId: true } },
        payments: { where: { status: 'PAID' }, select: { amount: true, tip: true } },
      },
      orderBy: { billRequestedAt: { sort: 'asc', nulls: 'last' } },
    });

    res.json({
      branchId,
      tabs: sessions.map((session) => {
        const billTotal = session.orders.reduce((sum, o) => sum + o.total, 0);
        const paidTotal = session.payments.reduce((sum, p) => sum + p.amount, 0);
        return {
          sessionId: session.id,
          code: session.code,
          tableId: session.table.id,
          tableNumber: session.table.number,
          zone: session.table.zone,
          guestCount: session.guestCount,
          customerName: session.customerName,
          startedAt: session.startedAt,
          billRequestedAt: session.billRequestedAt,
          orderCount: session.orders.length,
          billTotal,
          paidTotal,
          outstanding: Math.max(0, billTotal - paidTotal),
        };
      }),
    });
  }),
);

billingRouter.get(
  '/providers',
  requirePermission('billing:view'),
  asyncHandler(async (_req, res) => {
    res.json({ providers: listProviders() });
  }),
);

billingRouter.get(
  '/sessions/:sessionId',
  requirePermission('billing:view'),
  asyncHandler(async (req, res) => {
    const session = await prisma.tableSession.findUniqueOrThrow({
      where: { id: req.params.sessionId },
      select: { branchId: true },
    });
    assertBranchAccess(req, session.branchId);

    const splitParts = Number(req.query.splitParts ?? 1);
    res.json(await getSessionBill(req.params.sessionId, Number.isFinite(splitParts) ? splitParts : 1));
  }),
);

billingRouter.post(
  '/sessions/:sessionId/payments',
  rateLimits.write,
  requirePermission('billing:process'),
  validate(createPaymentSchema.extend({ card: mockCardSchema.optional() })),
  asyncHandler(async (req, res) => {
    const session = await prisma.tableSession.findUniqueOrThrow({
      where: { id: req.params.sessionId },
      select: { branchId: true },
    });
    assertBranchAccess(req, session.branchId);

    const result = await createPayment({
      sessionId: req.params.sessionId,
      method: req.body.method,
      amount: req.body.amount,
      tip: req.body.tip,
      splitParts: req.body.splitParts,
      reference: req.body.reference ?? null,
      card: req.body.card,
      processedByUserId: req.auth!.userId,
      idempotencyKey: req.body.idempotencyKey ?? null,
      req,
    });

    res.status(result.payment.status === 'PAID' ? 201 : 402).json(result);
  }),
);

billingRouter.post(
  '/payments/:id/refund',
  rateLimits.write,
  requirePermission('billing:process'),
  validate(z.object({ reason: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const payment = await refundPayment({
      paymentId: req.params.id,
      userId: req.auth!.userId,
      allowedBranchIds: req.auth!.branchIds,
      reason: req.body.reason ?? null,
    });
    res.json({ payment });
  }),
);

billingRouter.get(
  '/receipts',
  requirePermission('billing:view'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 25)));

    const [total, receipts] = await Promise.all([
      prisma.receipt.count({ where: { branchId } }),
      prisma.receipt.findMany({
        where: { branchId },
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { payment: { select: { method: true, amount: true, tip: true, status: true } } },
      }),
    ]);

    res.json({
      receipts: receipts.map((r) => ({
        id: r.id,
        number: r.number,
        issuedAt: r.issuedAt,
        sessionId: r.sessionId,
        method: r.payment.method,
        amount: r.payment.amount,
        tip: r.payment.tip,
        status: r.payment.status,
      })),
      pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
    });
  }),
);

billingRouter.get(
  '/receipts/:id',
  requirePermission('billing:view'),
  asyncHandler(async (req, res) => {
    const receipt = await getReceipt(req.params.id);
    if (!receipt) throw AppError.notFound('Receipt not found.');
    assertBranchAccess(req, receipt.branchId);
    res.json({ receipt });
  }),
);

billingRouter.get(
  '/receipts/:id/pdf',
  requirePermission('billing:view'),
  asyncHandler(async (req, res) => {
    const receipt = await getReceipt(req.params.id);
    if (!receipt) throw AppError.notFound('Receipt not found.');
    assertBranchAccess(req, receipt.branchId);

    const pdf = await renderReceiptPdf(receipt.snapshot as unknown as ReceiptSnapshot);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${receipt.number}.pdf"`);
    res.send(pdf);
  }),
);

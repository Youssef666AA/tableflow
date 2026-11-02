import { Router } from 'express';
import { z } from 'zod';
import {
  createOrderSchema,
  createReviewSchema,
  createServiceRequestSchema,
  evaluateOpenState,
  mockCardSchema,
  quoteSchema,
  startSessionSchema,
  verifyLocationSchema,
  type OpeningHour,
} from '@tableflow/shared';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { requireActiveTableSession, requireTableSession } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import { getBranchMenu } from '../services/menu.js';
import {
  createOrder,
  findOrderForSession,
  orderInclude,
  quoteOrder,
  serializeOrderForCustomer,
} from '../services/orders.js';
import { createServiceRequest, listServiceRequests } from '../services/service-requests.js';
import { createPayment, getReceipt, getSessionBill } from '../services/payments.js';
import { renderReceiptPdf, type ReceiptSnapshot } from '../services/receipt-pdf.js';
import { startTableSession, touchSession, verifyDeviceLocation } from '../services/sessions.js';
import { REALTIME_EVENTS } from '@tableflow/shared';
import { emitToBranch } from '../realtime/index.js';
import { writeAudit } from '../services/audit.js';

export const customerRouter: Router = Router();

/* ----------------------------------------------------------- table session */

customerRouter.post(
  '/table-sessions/start',
  rateLimits.scan,
  validate(startSessionSchema.extend({ deviceKey: z.string().min(8).max(64).optional() })),
  asyncHandler(async (req, res) => {
    const result = await startTableSession({
      token: req.body.token,
      deviceKey: req.body.deviceKey ?? null,
      req,
    });
    res.json(result);
  }),
);

/** Everything below this line requires a valid table-session bearer token. */
customerRouter.use('/customer', rateLimits.customer, requireTableSession);

customerRouter.get(
  '/customer/session',
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const session = await prisma.tableSession.findUniqueOrThrow({
      where: { id: ctx.sessionId },
      include: {
        table: { select: { id: true, number: true, label: true, seats: true } },
        branch: {
          include: { restaurant: { select: { id: true, name: true, logoUrl: true, currency: true } } },
        },
      },
    });

    const [activeOrders, openRequests] = await Promise.all([
      prisma.order.count({
        where: {
          sessionId: ctx.sessionId,
          status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY_TO_TABLE'] },
        },
      }),
      prisma.serviceRequest.count({
        where: { sessionId: ctx.sessionId, status: { in: ['REQUESTED', 'ACKNOWLEDGED', 'IN_PROGRESS'] } },
      }),
    ]);

    void touchSession(ctx.sessionId);

    res.json({
      session: {
        id: session.id,
        code: session.code,
        status: session.status,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        guestCount: session.guestCount,
        customerName: session.customerName,
      },
      verified: ctx.verified,
      requiresLocation: ctx.requiresLocation,
      demoMode: env.demoMode,
      table: session.table,
      branch: {
        id: session.branch.id,
        name: session.branch.name,
        address: session.branch.address,
        phone: session.branch.phone,
        latitude: session.branch.latitude,
        longitude: session.branch.longitude,
        serviceRadiusMeters: session.branch.serviceRadiusMeters,
        allowStaffLocationOverride: session.branch.allowStaffLocationOverride,
      },
      restaurant: session.branch.restaurant,
      openState: evaluateOpenState((session.branch.openingHours as unknown as OpeningHour[]) ?? []),
      counts: { activeOrders, openRequests },
    });
  }),
);

customerRouter.post(
  '/customer/session/verify-location',
  validate(verifyLocationSchema),
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const result = await verifyDeviceLocation({
      sessionId: ctx.sessionId,
      deviceId: ctx.deviceId,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      accuracy: req.body.accuracy ?? null,
      simulate: req.body.simulate,
      req,
    });
    res.json(result);
  }),
);

customerRouter.patch(
  '/customer/session',
  validate(
    z.object({
      customerName: z.string().max(60).nullish(),
      guestCount: z.number().int().min(1).max(30).optional(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const session = await prisma.tableSession.update({
      where: { id: ctx.sessionId },
      data: {
        ...(req.body.customerName !== undefined ? { customerName: req.body.customerName?.trim() || null } : {}),
        ...(req.body.guestCount !== undefined ? { guestCount: req.body.guestCount } : {}),
        lastActivityAt: new Date(),
      },
      select: { id: true, code: true, customerName: true, guestCount: true },
    });
    emitToBranch(ctx.branchId, REALTIME_EVENTS.SESSION_UPDATED, { ...session, tableId: ctx.tableId });
    res.json({ session });
  }),
);

/* ------------------------------------------------------------------- menu */

customerRouter.get(
  '/customer/menu',
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 60) : undefined;
    const categoryId = typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined;
    const menu = await getBranchMenu(ctx.branchId, { search, categoryId });
    res.json(menu);
  }),
);

customerRouter.get(
  '/customer/menu/products/:id',
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const menu = await getBranchMenu(ctx.branchId, {});
    const product = menu.products.find((p) => p.id === req.params.id);
    if (!product) throw AppError.notFound('That item is no longer on the menu.');
    res.json({ product });
  }),
);

/* ------------------------------------------------------------------- cart */

customerRouter.post(
  '/customer/cart/quote',
  validate(quoteSchema),
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const quote = await quoteOrder(ctx.branchId, req.body.lines);
    res.json(quote);
  }),
);

/* ----------------------------------------------------------------- orders */

customerRouter.post(
  '/customer/orders',
  rateLimits.orderCreate,
  requireActiveTableSession,
  validate(createOrderSchema.extend({ confirmDuplicate: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const result = await createOrder({
      branchId: ctx.branchId,
      tableId: ctx.tableId,
      sessionId: ctx.sessionId,
      lines: req.body.lines,
      notes: req.body.notes ?? null,
      customerName: req.body.customerName ?? null,
      idempotencyKey: req.body.idempotencyKey,
      confirmDuplicate: req.body.confirmDuplicate,
      channel: 'CUSTOMER',
      req,
    });

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.order.id },
      include: orderInclude,
    });

    res.status(result.reused ? 200 : 201).json({
      order: serializeOrderForCustomer(order),
      reused: result.reused,
    });
  }),
);

customerRouter.get(
  '/customer/orders',
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const orders = await prisma.order.findMany({
      where: { sessionId: ctx.sessionId },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ orders: orders.map(serializeOrderForCustomer) });
  }),
);

customerRouter.get(
  '/customer/orders/:id',
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const order = await findOrderForSession(req.params.id, ctx.sessionId);
    res.json({ order: serializeOrderForCustomer(order) });
  }),
);

/* -------------------------------------------------------- service requests */

customerRouter.post(
  '/customer/service-requests',
  rateLimits.serviceRequest,
  requireActiveTableSession,
  validate(createServiceRequestSchema),
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const result = await createServiceRequest({
      sessionId: ctx.sessionId,
      branchId: ctx.branchId,
      tableId: ctx.tableId,
      restaurantId: ctx.restaurantId,
      type: req.body.type,
      note: req.body.note ?? null,
      req,
    });
    res.status(result.reused ? 200 : 201).json(result);
  }),
);

customerRouter.get(
  '/customer/service-requests',
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const requests = await listServiceRequests({ branchId: ctx.branchId, sessionId: ctx.sessionId });
    res.json({ requests });
  }),
);

/* ------------------------------------------------------------------- bill */

customerRouter.get(
  '/customer/bill',
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    const splitParts = Number(req.query.splitParts ?? 1);
    const bill = await getSessionBill(ctx.sessionId, Number.isFinite(splitParts) ? splitParts : 1);
    res.json(bill);
  }),
);

customerRouter.post(
  '/customer/bill/pay',
  requireActiveTableSession,
  validate(
    z.object({
      amount: z.number().int().min(1).optional(),
      tip: z.number().int().min(0).max(100000000).default(0),
      splitParts: z.number().int().min(1).max(20).default(1),
      card: mockCardSchema,
      idempotencyKey: z.string().min(8).max(120),
    }),
  ),
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;
    // Customers can only use the simulated online method; cash and terminal
    // payments have to be recorded by staff who actually collected the money.
    const result = await createPayment({
      sessionId: ctx.sessionId,
      method: 'MOCK_ONLINE',
      amount: req.body.amount,
      tip: req.body.tip,
      splitParts: req.body.splitParts,
      card: req.body.card,
      idempotencyKey: req.body.idempotencyKey,
      req,
    });
    const httpStatus =
      result.payment.status === 'PAID' && result.payment.id !== '' ? 201
      : result.payment.status === 'PAID' || result.payment.status === 'NOTHING_TO_PAY' ? 200
      : 402;
    res.status(httpStatus).json({ ...result, simulated: true });
  }),
);

/* ---------------------------------------------------------------- receipt */

async function loadOwnedReceipt(receiptId: string, sessionId: string) {
  const receipt = await getReceipt(receiptId);
  if (!receipt || receipt.sessionId !== sessionId) {
    throw AppError.notFound('That receipt is not available for this table.');
  }
  return receipt;
}

customerRouter.get(
  '/customer/receipts/:id',
  asyncHandler(async (req, res) => {
    const receipt = await loadOwnedReceipt(req.params.id, req.customer!.sessionId);
    res.json({ receipt: { id: receipt.id, number: receipt.number, issuedAt: receipt.issuedAt, snapshot: receipt.snapshot } });
  }),
);

customerRouter.get(
  '/customer/receipts/:id/pdf',
  asyncHandler(async (req, res) => {
    const receipt = await loadOwnedReceipt(req.params.id, req.customer!.sessionId);
    const pdf = await renderReceiptPdf(receipt.snapshot as unknown as ReceiptSnapshot);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${receipt.number}.pdf"`);
    res.send(pdf);
  }),
);

/* ---------------------------------------------------------------- reviews */

customerRouter.get(
  '/customer/review',
  asyncHandler(async (req, res) => {
    const review = await prisma.review.findUnique({
      where: { sessionId: req.customer!.sessionId },
      select: { id: true, rating: true, foodRating: true, serviceRating: true, comment: true, createdAt: true },
    });
    res.json({ review });
  }),
);

customerRouter.post(
  '/customer/review',
  validate(createReviewSchema),
  asyncHandler(async (req, res) => {
    const ctx = req.customer!;

    // A review has to be earned: there must be a real order on this session.
    const delivered = await prisma.order.findFirst({
      where: { sessionId: ctx.sessionId, status: { in: ['DELIVERED', 'COMPLETED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!delivered) {
      throw AppError.conflict('You can leave a review once your order has been served.');
    }

    const existing = await prisma.review.findUnique({ where: { sessionId: ctx.sessionId } });
    if (existing) throw AppError.conflict('You have already reviewed this visit. Thank you!');

    const review = await prisma.review.create({
      data: {
        restaurantId: ctx.restaurantId,
        branchId: ctx.branchId,
        sessionId: ctx.sessionId,
        tableId: ctx.tableId,
        orderId: delivered.id,
        rating: req.body.rating,
        foodRating: req.body.foodRating ?? null,
        serviceRating: req.body.serviceRating ?? null,
        comment: req.body.comment?.trim() || null,
      },
    });

    // Keep the per-product rating in step with what guests actually said.
    const items = await prisma.orderItem.findMany({
      where: { orderId: delivered.id, productId: { not: null } },
      select: { productId: true },
    });
    const productIds = [...new Set(items.map((i) => i.productId).filter((id): id is string => !!id))];
    for (const productId of productIds) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { rating: true, ratingCount: true },
      });
      if (!product) continue;
      const nextCount = product.ratingCount + 1;
      const nextRating = (product.rating * product.ratingCount + req.body.rating) / nextCount;
      await prisma.product.update({
        where: { id: productId },
        data: { rating: Math.round(nextRating * 100) / 100, ratingCount: nextCount },
      });
    }

    emitToBranch(ctx.branchId, REALTIME_EVENTS.REVIEW_CREATED, {
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      tableNumber: ctx.tableNumber,
    });

    void writeAudit({
      action: 'review.created',
      entity: 'Review',
      entityId: review.id,
      restaurantId: ctx.restaurantId,
      branchId: ctx.branchId,
      actorType: 'CUSTOMER',
      metadata: { rating: review.rating },
      req,
    });

    res.status(201).json({ review });
  }),
);

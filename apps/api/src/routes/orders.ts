import { Router } from 'express';
import { z } from 'zod';
import { ORDER_STATUSES, can, createOrderSchema, paginationSchema, updateOrderStatusSchema } from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { assertBranchAccess, authenticate, requirePermission, resolveBranchId } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import {
  createOrder,
  orderInclude,
  quoteOrder,
  serializeOrder,
  updateOrderItemStatus,
  updateOrderStatus,
} from '../services/orders.js';

export const ordersRouter: Router = Router();

ordersRouter.use(authenticate);

const listQuerySchema = paginationSchema.extend({
  branchId: z.string().optional(),
  status: z.string().optional(),
  tableId: z.string().optional(),
  sessionId: z.string().optional(),
  search: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

ordersRouter.get(
  '/',
  requirePermission('orders:view'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQuerySchema>;
    const branchId = resolveBranchId(req, query.branchId);

    const statuses = query.status
      ? query.status.split(',').filter((s) => (ORDER_STATUSES as readonly string[]).includes(s))
      : undefined;

    const numberSearch = query.search && /^#?\d+$/.test(query.search) ? Number(query.search.replace('#', '')) : null;

    const where = {
      branchId,
      ...(statuses && statuses.length > 0 ? { status: { in: statuses as never } } : {}),
      ...(query.tableId ? { tableId: query.tableId } : {}),
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
      ...(numberSearch !== null
        ? { number: numberSearch }
        : query.search
          ? {
              OR: [
                { customerName: { contains: query.search, mode: 'insensitive' as const } },
                { table: { number: { contains: query.search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
    };

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    res.json({
      orders: orders.map(serializeOrder),
      pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) },
    });
  }),
);

ordersRouter.get(
  '/:id',
  requirePermission('orders:view'),
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { ...orderInclude, statusEvents: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true } } } } },
    });
    assertBranchAccess(req, order.branchId);
    res.json({
      order: serializeOrder(order),
      timeline: order.statusEvents.map((e) => ({
        id: e.id,
        from: e.fromStatus,
        to: e.toStatus,
        at: e.createdAt,
        actorType: e.actorType,
        actor: e.actor?.fullName ?? null,
        reason: e.reason,
      })),
    });
  }),
);

/** Staff-entered order (phone order, walk-in, or a waiter taking it at the table). */
ordersRouter.post(
  '/',
  rateLimits.write,
  requirePermission('orders:create'),
  validate(createOrderSchema.extend({ tableId: z.string().min(1), branchId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req, req.body.branchId);

    const activeSession = await prisma.tableSession.findFirst({
      where: { tableId: req.body.tableId, status: { in: ['ACTIVE', 'LOCATION_PENDING', 'CREATED', 'PAUSED'] } },
      orderBy: { startedAt: 'desc' },
      select: { id: true, status: true },
    });

    const result = await createOrder({
      branchId,
      tableId: req.body.tableId,
      // Staff orders attach to an existing session so the bill stays whole,
      // but never resurrect one that is not open.
      sessionId: activeSession?.status === 'ACTIVE' ? activeSession.id : null,
      lines: req.body.lines,
      notes: req.body.notes ?? null,
      customerName: req.body.customerName ?? null,
      idempotencyKey: req.body.idempotencyKey,
      channel: 'STAFF',
      userId: req.auth!.userId,
      confirmDuplicate: true,
      req,
    });

    res.status(201).json(result);
  }),
);

ordersRouter.post(
  '/quote',
  requirePermission('orders:create'),
  validate(z.object({ lines: createOrderSchema.shape.lines, branchId: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req, req.body.branchId);
    res.json(await quoteOrder(branchId, req.body.lines));
  }),
);

ordersRouter.patch(
  '/:id/status',
  rateLimits.write,
  requirePermission('orders:update_status'),
  validate(updateOrderStatusSchema),
  asyncHandler(async (req, res) => {
    // Cancelling releases stock and money — a stricter permission than moving forward.
    if (['CANCELLED', 'REJECTED'].includes(req.body.status) && !can(req.auth!.role, 'orders:cancel')) {
      throw AppError.forbidden('Your role cannot cancel orders.');
    }

    const order = await updateOrderStatus({
      orderId: req.params.id,
      status: req.body.status,
      reason: req.body.reason ?? null,
      actorUserId: req.auth!.userId,
      actorType: 'STAFF',
      allowedBranchIds: req.auth!.branchIds,
      req,
    });
    res.json({ order });
  }),
);

ordersRouter.patch(
  '/items/:itemId/status',
  rateLimits.write,
  requirePermission('kitchen:update'),
  validate(z.object({ status: z.enum(['PREPARING', 'READY', 'SERVED']) })),
  asyncHandler(async (req, res) => {
    const order = await updateOrderItemStatus({
      itemId: req.params.itemId,
      status: req.body.status,
      actorUserId: req.auth!.userId,
      allowedBranchIds: req.auth!.branchIds,
      req,
    });
    res.json({ order });
  }),
);

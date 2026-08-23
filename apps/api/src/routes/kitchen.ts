import { Router } from 'express';
import { z } from 'zod';
import { kitchenStationSchema } from '@tableflow/shared';
import { prisma } from '../lib/prisma.js';
import { assertBranchAccess, authenticate, requirePermission, resolveBranchId } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import { orderInclude, serializeOrder, updateOrderStatus } from '../services/orders.js';
import { writeAudit } from '../services/audit.js';

export const kitchenRouter: Router = Router();

kitchenRouter.use(authenticate);

const KITCHEN_STATUSES = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY'] as const;

/**
 * The kitchen display feed. Everything the KDS renders — including the timers —
 * derives from these timestamps, so a refresh never loses the clock.
 */
kitchenRouter.get(
  '/orders',
  requirePermission('kitchen:view'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;

    const branch = await prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { kitchenSlaMinutes: true, splitStationsEnabled: true, autoAcceptOrders: true },
    });

    const orders = await prisma.order.findMany({
      where: {
        branchId,
        status: { in: [...KITCHEN_STATUSES] },
        ...(stationId ? { items: { some: { kitchenStationId: stationId } } } : {}),
      },
      include: orderInclude,
      orderBy: { createdAt: 'asc' },
      take: 120,
    });

    const stations = await prisma.kitchenStation.findMany({
      where: { branchId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, color: true },
    });

    const serialized = orders.map((order) => {
      const full = serializeOrder(order);
      return {
        ...full,
        // When a station filter is on, only show that station's lines.
        items: stationId ? full.items.filter((i) => i.station?.id === stationId) : full.items,
        elapsedMs: Date.now() - order.createdAt.getTime(),
        targetMinutes: Math.max(order.estimatedPrepMinutes, branch.kitchenSlaMinutes),
      };
    });

    res.json({
      branchId,
      slaMinutes: branch.kitchenSlaMinutes,
      splitStationsEnabled: branch.splitStationsEnabled,
      autoAcceptOrders: branch.autoAcceptOrders,
      stations,
      columns: {
        NEW: serialized.filter((o) => o.status === 'PENDING' || o.status === 'ACCEPTED'),
        PREPARING: serialized.filter((o) => o.status === 'PREPARING'),
        READY: serialized.filter((o) => o.status === 'READY'),
      },
      orders: serialized,
    });
  }),
);

kitchenRouter.patch(
  '/orders/:id/accept',
  rateLimits.write,
  requirePermission('kitchen:update'),
  asyncHandler(async (req, res) => {
    const order = await updateOrderStatus({
      orderId: req.params.id,
      status: 'ACCEPTED',
      actorUserId: req.auth!.userId,
      allowedBranchIds: req.auth!.branchIds,
      req,
    });
    res.json({ order });
  }),
);

kitchenRouter.patch(
  '/orders/:id/start',
  rateLimits.write,
  requirePermission('kitchen:update'),
  asyncHandler(async (req, res) => {
    const order = await updateOrderStatus({
      orderId: req.params.id,
      status: 'PREPARING',
      actorUserId: req.auth!.userId,
      allowedBranchIds: req.auth!.branchIds,
      req,
    });
    res.json({ order });
  }),
);

kitchenRouter.patch(
  '/orders/:id/ready',
  rateLimits.write,
  requirePermission('kitchen:update'),
  asyncHandler(async (req, res) => {
    const order = await updateOrderStatus({
      orderId: req.params.id,
      status: 'READY',
      actorUserId: req.auth!.userId,
      allowedBranchIds: req.auth!.branchIds,
      req,
    });
    res.json({ order });
  }),
);

kitchenRouter.patch(
  '/orders/:id/reject',
  rateLimits.write,
  requirePermission('kitchen:update', 'orders:cancel'),
  validate(z.object({ reason: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const order = await updateOrderStatus({
      orderId: req.params.id,
      status: 'REJECTED',
      reason: req.body.reason ?? 'Rejected by the kitchen',
      actorUserId: req.auth!.userId,
      allowedBranchIds: req.auth!.branchIds,
      req,
    });
    res.json({ order });
  }),
);

/* --------------------------------------------------------------- stations */

kitchenRouter.get(
  '/stations',
  requirePermission('kitchen:view'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const stations = await prisma.kitchenStation.findMany({
      where: { branchId },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    res.json({
      stations: stations.map((s) => ({
        id: s.id,
        name: s.name,
        color: s.color,
        sortOrder: s.sortOrder,
        productCount: s._count.products,
      })),
    });
  }),
);

kitchenRouter.post(
  '/stations',
  rateLimits.write,
  requirePermission('menu:manage'),
  validate(kitchenStationSchema),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req, req.body.branchId);
    const station = await prisma.kitchenStation.create({ data: { ...req.body, branchId } });
    void writeAudit({ action: 'station.created', entity: 'KitchenStation', entityId: station.id, branchId, req });
    res.status(201).json({ station });
  }),
);

kitchenRouter.delete(
  '/stations/:id',
  rateLimits.write,
  requirePermission('menu:manage'),
  asyncHandler(async (req, res) => {
    const station = await prisma.kitchenStation.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, station.branchId);
    await prisma.kitchenStation.delete({ where: { id: station.id } });
    void writeAudit({
      action: 'station.deleted',
      entity: 'KitchenStation',
      entityId: station.id,
      branchId: station.branchId,
      req,
    });
    res.status(204).end();
  }),
);

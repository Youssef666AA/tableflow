import { Router } from 'express';
import { z } from 'zod';
import {
  REALTIME_EVENTS,
  bulkTablePositionSchema,
  createTableSchema,
  updateTableSchema,
} from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { assertBranchAccess, authenticate, requirePermission, resolveBranchId } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import { emitToBranch } from '../realtime/index.js';
import {
  deactivateQrToken,
  ensureQrToken,
  qrUrlFor,
  regenerateQrToken,
  renderQrPng,
  renderQrSheetPdf,
  renderQrSvg,
} from '../services/qr.js';
import { closeSession, staffVerifyDevice } from '../services/sessions.js';
import { publishTableChange, recomputeTableStatus, refreshTableStatus } from '../services/tables.js';
import { writeAudit } from '../services/audit.js';

export const tablesRouter: Router = Router();

tablesRouter.use(authenticate);

const OPEN_SESSION_STATUSES = ['CREATED', 'LOCATION_PENDING', 'ACTIVE', 'PAUSED'] as const;
const OPEN_ORDER_STATUSES = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY_TO_TABLE'] as const;

/** Floor view: every table with its live session, order count and running total. */
tablesRouter.get(
  '/',
  requirePermission('tables:view'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);

    const tables = await prisma.restaurantTable.findMany({
      where: { branchId },
      orderBy: [{ zone: 'asc' }, { number: 'asc' }],
      include: {
        sessions: {
          where: { status: { in: [...OPEN_SESSION_STATUSES] } },
          orderBy: { startedAt: 'desc' },
          take: 1,
          include: {
            orders: {
              select: { id: true, status: true, total: true, paymentId: true, createdAt: true },
            },
            serviceRequests: {
              where: { status: { in: ['REQUESTED', 'ACKNOWLEDGED', 'IN_PROGRESS'] } },
              select: { id: true, type: true, status: true, createdAt: true },
            },
            devices: { select: { id: true, verifiedAt: true } },
          },
        },
        qrTokens: { where: { active: true }, take: 1, select: { id: true, token: true, scanCount: true } },
      },
    });

    res.json({
      branchId,
      tables: tables.map((table) => {
        const session = table.sessions[0] ?? null;
        const orders = session?.orders ?? [];
        const openOrders = orders.filter((o) => OPEN_ORDER_STATUSES.includes(o.status as never));
        const billable = orders.filter((o) => !['CANCELLED', 'REJECTED'].includes(o.status));
        return {
          id: table.id,
          number: table.number,
          label: table.label,
          seats: table.seats,
          zone: table.zone,
          posX: table.posX,
          posY: table.posY,
          shape: table.shape,
          status: table.status,
          outOfService: table.outOfService,
          needsCleaning: table.needsCleaning,
          qr: table.qrTokens[0]
            ? { id: table.qrTokens[0].id, url: qrUrlFor(table.qrTokens[0].token), scanCount: table.qrTokens[0].scanCount }
            : null,
          session: session
            ? {
                id: session.id,
                code: session.code,
                status: session.status,
                startedAt: session.startedAt,
                expiresAt: session.expiresAt,
                guestCount: session.guestCount,
                customerName: session.customerName,
                billRequestedAt: session.billRequestedAt,
                deviceCount: session.devices.length,
                verifiedDevices: session.devices.filter((d) => d.verifiedAt).length,
                orderCount: billable.length,
                openOrderCount: openOrders.length,
                runningTotal: billable.reduce((sum, o) => sum + o.total, 0),
                unpaidTotal: billable.filter((o) => !o.paymentId).reduce((sum, o) => sum + o.total, 0),
                openRequests: session.serviceRequests,
                elapsedMinutes: Math.round((Date.now() - session.startedAt.getTime()) / 60000),
              }
            : null,
        };
      }),
    });
  }),
);

tablesRouter.get(
  '/:id',
  requirePermission('tables:view'),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        qrTokens: { orderBy: { createdAt: 'desc' }, take: 5 },
        sessions: {
          orderBy: { startedAt: 'desc' },
          take: 5,
          include: {
            devices: true,
            orders: { select: { id: true, number: true, status: true, total: true, createdAt: true } },
            serviceRequests: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });
    assertBranchAccess(req, table.branchId);

    res.json({
      table: {
        ...table,
        qrTokens: table.qrTokens.map((t) => ({
          id: t.id,
          active: t.active,
          createdAt: t.createdAt,
          revokedAt: t.revokedAt,
          scanCount: t.scanCount,
          url: t.active ? qrUrlFor(t.token) : null,
        })),
      },
    });
  }),
);

tablesRouter.post(
  '/',
  rateLimits.write,
  requirePermission('tables:manage'),
  validate(createTableSchema),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req, req.body.branchId);
    const table = await prisma.restaurantTable.create({
      data: { ...req.body, branchId },
    });
    const qr = await ensureQrToken(table.id);

    void writeAudit({
      action: 'table.created',
      entity: 'RestaurantTable',
      entityId: table.id,
      branchId,
      req,
      metadata: { number: table.number },
    });

    emitToBranch(branchId, REALTIME_EVENTS.TABLE_UPDATED, { id: table.id, number: table.number, status: table.status });
    res.status(201).json({ table: { ...table, qr: { id: qr.id, url: qrUrlFor(qr.token) } } });
  }),
);

tablesRouter.put(
  '/:id',
  rateLimits.write,
  requirePermission('tables:manage'),
  validate(updateTableSchema),
  asyncHandler(async (req, res) => {
    const current = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, current.branchId);

    const table = await prisma.restaurantTable.update({ where: { id: req.params.id }, data: req.body });
    const change = await refreshTableStatus(table.id);

    void writeAudit({
      action: 'table.updated',
      entity: 'RestaurantTable',
      entityId: table.id,
      branchId: table.branchId,
      req,
      metadata: { changes: req.body },
    });

    res.json({ table: { ...table, status: change.to } });
  }),
);

tablesRouter.delete(
  '/:id',
  rateLimits.write,
  requirePermission('tables:manage'),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, table.branchId);

    const openSessions = await prisma.tableSession.count({
      where: { tableId: table.id, status: { in: [...OPEN_SESSION_STATUSES] } },
    });
    if (openSessions > 0) {
      throw AppError.conflict('Close the active session before removing this table.');
    }

    await prisma.restaurantTable.delete({ where: { id: table.id } });
    void writeAudit({
      action: 'table.deleted',
      entity: 'RestaurantTable',
      entityId: table.id,
      branchId: table.branchId,
      req,
      metadata: { number: table.number },
    });
    res.status(204).end();
  }),
);

/** Floor-plan drag and drop persists positions in one call. */
tablesRouter.post(
  '/positions',
  rateLimits.write,
  requirePermission('tables:manage'),
  validate(bulkTablePositionSchema),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const ids = req.body.tables.map((t: { id: string }) => t.id);
    const owned = await prisma.restaurantTable.findMany({
      where: { id: { in: ids }, branchId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((t) => t.id));

    await prisma.$transaction(
      req.body.tables
        .filter((t: { id: string }) => ownedIds.has(t.id))
        .map((t: { id: string; posX: number; posY: number }) =>
          prisma.restaurantTable.update({
            where: { id: t.id },
            data: { posX: t.posX, posY: t.posY },
          }),
        ),
    );

    res.json({ updated: ownedIds.size });
  }),
);

tablesRouter.patch(
  '/:id/status',
  rateLimits.write,
  requirePermission('tables:status_update'),
  validate(z.object({ needsCleaning: z.boolean().optional(), outOfService: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, table.branchId);

    await prisma.restaurantTable.update({ where: { id: table.id }, data: req.body });
    const change = await refreshTableStatus(table.id);

    void writeAudit({
      action: 'table.status_changed',
      entity: 'RestaurantTable',
      entityId: table.id,
      branchId: table.branchId,
      req,
      metadata: { ...req.body, status: change.to },
    });

    res.json({ id: table.id, status: change.to });
  }),
);

/* --------------------------------------------------------------------- QR */

tablesRouter.get(
  '/:id/qr',
  requirePermission('tables:qr_manage'),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, table.branchId);

    const qr = await ensureQrToken(table.id);
    const format = String(req.query.format ?? 'json');

    if (format === 'png') {
      const size = Math.min(1024, Math.max(128, Number(req.query.size ?? 512)));
      const png = await renderQrPng(qr.token, size);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="table-${table.number}-qr.png"`);
      }
      res.send(png);
      return;
    }

    if (format === 'svg') {
      const svg = await renderQrSvg(qr.token);
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'no-store');
      res.send(svg);
      return;
    }

    res.json({ id: qr.id, url: qrUrlFor(qr.token), tableNumber: table.number });
  }),
);

tablesRouter.post(
  '/:id/regenerate-qr',
  rateLimits.write,
  requirePermission('tables:qr_manage'),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, table.branchId);

    const qr = await regenerateQrToken({
      tableId: table.id,
      userId: req.auth!.userId,
      restaurantId: req.auth!.restaurantId,
      branchId: table.branchId,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
    });

    res.status(201).json({ qr: { id: qr.id, url: qr.url }, tableNumber: table.number });
  }),
);

tablesRouter.post(
  '/:id/deactivate-qr',
  rateLimits.write,
  requirePermission('tables:qr_manage'),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, table.branchId);
    await deactivateQrToken(table.id, req.auth!.userId);
    res.status(204).end();
  }),
);

/** Printable sheet for a whole branch, or a chosen subset of tables. */
tablesRouter.get(
  '/qr/sheet.pdf',
  requirePermission('tables:qr_manage'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',').filter(Boolean) : null;

    const branch = await prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { name: true, restaurant: { select: { name: true } } },
    });

    const tables = await prisma.restaurantTable.findMany({
      where: { branchId, ...(ids ? { id: { in: ids } } : {}) },
      orderBy: { number: 'asc' },
      include: { qrTokens: { where: { active: true }, take: 1 } },
    });

    const withTokens: Array<{ number: string; label: string | null; token: string }> = [];
    for (const table of tables) {
      const token = table.qrTokens[0]?.token ?? (await ensureQrToken(table.id)).token;
      withTokens.push({ number: table.number, label: table.label, token });
    }

    const pdf = await renderQrSheetPdf({
      restaurantName: branch.restaurant.name,
      branchName: branch.name,
      tables: withTokens,
    });

    await prisma.tableQrToken.updateMany({
      where: { tableId: { in: tables.map((t) => t.id) }, active: true },
      data: { printedCount: { increment: 1 } },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="tableflow-qr-sheet.pdf"');
    res.send(pdf);
  }),
);

/* --------------------------------------------------------------- sessions */

tablesRouter.get(
  '/sessions/:id',
  requirePermission('sessions:view'),
  asyncHandler(async (req, res) => {
    const session = await prisma.tableSession.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        table: { select: { id: true, number: true, label: true, zone: true } },
        devices: true,
        orders: {
          orderBy: { number: 'asc' },
          include: { items: { include: { modifiers: true } } },
        },
        serviceRequests: { orderBy: { createdAt: 'desc' } },
        payments: { orderBy: { createdAt: 'asc' } },
        review: true,
      },
    });
    assertBranchAccess(req, session.branchId);
    res.json({ session });
  }),
);

tablesRouter.post(
  '/sessions/:id/verify',
  rateLimits.write,
  requirePermission('sessions:view', 'tables:status_update'),
  asyncHandler(async (req, res) => {
    const session = await prisma.tableSession.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, session.branchId);
    await staffVerifyDevice({
      sessionId: session.id,
      deviceId: typeof req.body?.deviceId === 'string' ? req.body.deviceId : null,
      staffUserId: req.auth!.userId,
      req,
    });
    res.status(204).end();
  }),
);

tablesRouter.post(
  '/sessions/:id/close',
  rateLimits.write,
  requirePermission('sessions:close'),
  validate(z.object({ reason: z.string().max(200).optional(), force: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const session = await prisma.tableSession.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, session.branchId);

    await closeSession({
      sessionId: session.id,
      staffUserId: req.auth!.userId,
      reason: req.body.reason ?? null,
      force: req.body.force === true,
      req,
    });

    res.status(204).end();
  }),
);

/** "Table cleaned" — clears the cleaning flag and frees the table. */
tablesRouter.post(
  '/:id/clear',
  rateLimits.write,
  requirePermission('tables:status_update'),
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, table.branchId);

    const change = await prisma.$transaction(async (tx) => {
      await tx.restaurantTable.update({ where: { id: table.id }, data: { needsCleaning: false } });
      return recomputeTableStatus(tx, table.id);
    });
    publishTableChange(change);

    void writeAudit({
      action: 'table.cleared',
      entity: 'RestaurantTable',
      entityId: table.id,
      branchId: table.branchId,
      req,
    });

    res.json({ id: table.id, status: change.to });
  }),
);

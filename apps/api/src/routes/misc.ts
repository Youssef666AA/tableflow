import { Router } from 'express';
import { z } from 'zod';
import { paginationSchema, promotionSchema } from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, resolveBranchId } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import { notificationScope } from '../services/notifications.js';
import { writeAudit } from '../services/audit.js';

/* --------------------------------------------------------- notifications */

export const notificationsRouter: Router = Router();
notificationsRouter.use(authenticate, requirePermission('notifications:view'));

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const where = notificationScope({
      restaurantId: auth.restaurantId,
      userId: auth.userId,
      role: auth.role,
      branchIds: auth.branchIds,
    });

    const [notifications, unread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(100, Number(req.query.limit ?? 40)),
      }),
      prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);

    res.json({ notifications, unread });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const where = notificationScope({
      restaurantId: auth.restaurantId,
      userId: auth.userId,
      role: auth.role,
      branchIds: auth.branchIds,
    });
    const updated = await prisma.notification.updateMany({
      where: { AND: [where, { id: req.params.id }] },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) throw AppError.notFound('Notification not found.');
    res.status(204).end();
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const where = notificationScope({
      restaurantId: auth.restaurantId,
      userId: auth.userId,
      role: auth.role,
      branchIds: auth.branchIds,
    });
    const result = await prisma.notification.updateMany({
      where: { AND: [where, { readAt: null }] },
      data: { readAt: new Date() },
    });
    res.json({ updated: result.count });
  }),
);

/* ---------------------------------------------------------------- reviews */

export const reviewsRouter: Router = Router();
reviewsRouter.use(authenticate, requirePermission('reviews:view'));

reviewsRouter.get(
  '/',
  validate(paginationSchema.extend({ branchId: z.string().optional(), rating: z.coerce.number().min(1).max(5).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as { page: number; pageSize: number; branchId?: string; rating?: number };
    const branchIds = query.branchId ? [resolveBranchId(req, query.branchId)] : req.auth!.branchIds;

    const where = {
      branchId: { in: branchIds },
      ...(query.rating ? { rating: query.rating } : {}),
    };

    const [total, reviews, aggregate] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          table: { select: { number: true } },
          branch: { select: { name: true } },
          session: { select: { code: true, customerName: true } },
        },
      }),
      prisma.review.aggregate({ where, _avg: { rating: true }, _count: true }),
    ]);

    res.json({
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        foodRating: r.foodRating,
        serviceRating: r.serviceRating,
        comment: r.comment,
        createdAt: r.createdAt,
        published: r.published,
        response: r.response,
        respondedAt: r.respondedAt,
        tableNumber: r.table?.number ?? null,
        branchName: r.branch.name,
        sessionCode: r.session.code,
        customerName: r.session.customerName,
      })),
      summary: { average: aggregate._avg.rating, count: aggregate._count },
      pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) },
    });
  }),
);

reviewsRouter.post(
  '/:id/respond',
  rateLimits.write,
  requirePermission('reviews:manage'),
  validate(z.object({ response: z.string().min(1).max(1000) })),
  asyncHandler(async (req, res) => {
    const review = await prisma.review.findUniqueOrThrow({ where: { id: req.params.id } });
    if (!req.auth!.branchIds.includes(review.branchId)) throw AppError.forbidden('Not your review.');

    const updated = await prisma.review.update({
      where: { id: review.id },
      data: { response: req.body.response, respondedAt: new Date() },
    });
    res.json({ review: updated });
  }),
);

reviewsRouter.patch(
  '/:id/publish',
  rateLimits.write,
  requirePermission('reviews:manage'),
  validate(z.object({ published: z.boolean() })),
  asyncHandler(async (req, res) => {
    const review = await prisma.review.findUniqueOrThrow({ where: { id: req.params.id } });
    if (!req.auth!.branchIds.includes(review.branchId)) throw AppError.forbidden('Not your review.');
    const updated = await prisma.review.update({
      where: { id: review.id },
      data: { published: req.body.published },
    });
    res.json({ review: updated });
  }),
);

/* ------------------------------------------------------------- promotions */

export const promotionsRouter: Router = Router();
promotionsRouter.use(authenticate);

promotionsRouter.get(
  '/',
  requirePermission('promotions:view'),
  asyncHandler(async (req, res) => {
    const promotions = await prisma.promotion.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      orderBy: [{ active: 'desc' }, { priority: 'desc' }, { name: 'asc' }],
      include: { branch: { select: { id: true, name: true } }, _count: { select: { orders: true } } },
    });
    res.json({ promotions });
  }),
);

promotionsRouter.post(
  '/',
  rateLimits.write,
  requirePermission('promotions:manage'),
  validate(promotionSchema),
  asyncHandler(async (req, res) => {
    if (req.body.branchId) resolveBranchId(req, req.body.branchId);
    if (req.body.type === 'PERCENTAGE' && req.body.value > 100) {
      throw AppError.badRequest('A percentage discount cannot exceed 100%.');
    }

    const promotion = await prisma.promotion.create({
      data: { ...req.body, restaurantId: req.auth!.restaurantId },
    });

    void writeAudit({
      action: 'promotion.created',
      entity: 'Promotion',
      entityId: promotion.id,
      restaurantId: promotion.restaurantId,
      req,
      metadata: { name: promotion.name, type: promotion.type, value: promotion.value },
    });

    res.status(201).json({ promotion });
  }),
);

promotionsRouter.put(
  '/:id',
  rateLimits.write,
  requirePermission('promotions:manage'),
  validate(promotionSchema.partial()),
  asyncHandler(async (req, res) => {
    const current = await prisma.promotion.findUniqueOrThrow({ where: { id: req.params.id } });
    if (current.restaurantId !== req.auth!.restaurantId) throw AppError.forbidden('Not your promotion.');

    const promotion = await prisma.promotion.update({ where: { id: current.id }, data: req.body });
    void writeAudit({
      action: 'promotion.updated',
      entity: 'Promotion',
      entityId: promotion.id,
      restaurantId: promotion.restaurantId,
      req,
      metadata: { fields: Object.keys(req.body) },
    });
    res.json({ promotion });
  }),
);

promotionsRouter.delete(
  '/:id',
  rateLimits.write,
  requirePermission('promotions:manage'),
  asyncHandler(async (req, res) => {
    const current = await prisma.promotion.findUniqueOrThrow({ where: { id: req.params.id } });
    if (current.restaurantId !== req.auth!.restaurantId) throw AppError.forbidden('Not your promotion.');
    await prisma.promotion.update({ where: { id: current.id }, data: { active: false } });
    res.status(204).end();
  }),
);

/* ------------------------------------------------------------------ audit */

export const auditRouter: Router = Router();
auditRouter.use(authenticate, requirePermission('audit:view'));

auditRouter.get(
  '/',
  validate(
    paginationSchema.extend({
      entity: z.string().optional(),
      action: z.string().optional(),
      actorUserId: z.string().optional(),
    }),
    'query',
  ),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as {
      page: number;
      pageSize: number;
      entity?: string;
      action?: string;
      actorUserId?: string;
    };

    const where = {
      restaurantId: req.auth!.restaurantId,
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' as const } } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    };

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { actor: { select: { fullName: true, email: true } }, branch: { select: { name: true } } },
      }),
    ]);

    res.json({
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        actorType: l.actorType,
        actor: l.actor?.fullName ?? l.actorLabel,
        branch: l.branch?.name ?? null,
        metadata: l.metadata,
        createdAt: l.createdAt,
      })),
      pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) },
    });
  }),
);

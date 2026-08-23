import { Router } from 'express';
import { z } from 'zod';
import { SERVICE_REQUEST_STATUSES, updateServiceRequestSchema } from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, resolveBranchId } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import {
  createServiceRequest,
  listServiceRequests,
  updateServiceRequestStatus,
} from '../services/service-requests.js';

export const serviceRequestsRouter: Router = Router();

serviceRequestsRouter.use(authenticate);

serviceRequestsRouter.get(
  '/',
  requirePermission('requests:view'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const statusParam = typeof req.query.status === 'string' ? req.query.status : 'open';

    const status =
      statusParam === 'open'
        ? (['REQUESTED', 'ACKNOWLEDGED', 'IN_PROGRESS'] as const)
        : statusParam === 'all'
          ? undefined
          : statusParam
              .split(',')
              .filter((s) => (SERVICE_REQUEST_STATUSES as readonly string[]).includes(s));

    const requests = await listServiceRequests({
      branchId,
      status: status as never,
      limit: Number(req.query.limit ?? 100),
    });

    res.json({ requests });
  }),
);

serviceRequestsRouter.patch(
  '/:id/status',
  rateLimits.write,
  requirePermission('requests:handle'),
  validate(updateServiceRequestSchema),
  asyncHandler(async (req, res) => {
    const request = await updateServiceRequestStatus({
      id: req.params.id,
      status: req.body.status,
      userId: req.auth!.userId,
      allowedBranchIds: req.auth!.branchIds,
      req,
    });
    res.json({ request });
  }),
);

/** Waiter shortcut buttons map onto the same state machine. */
for (const [path, status] of [
  ['acknowledge', 'ACKNOWLEDGED'],
  ['start', 'IN_PROGRESS'],
  ['complete', 'COMPLETED'],
  ['cancel', 'CANCELLED'],
] as const) {
  serviceRequestsRouter.post(
    `/:id/${path}`,
    rateLimits.write,
    requirePermission('requests:handle'),
    asyncHandler(async (req, res) => {
      const request = await updateServiceRequestStatus({
        id: req.params.id,
        status,
        userId: req.auth!.userId,
        allowedBranchIds: req.auth!.branchIds,
        req,
      });
      res.json({ request });
    }),
  );
}

/** Staff can raise a request on a guest's behalf (e.g. taken verbally). */
serviceRequestsRouter.post(
  '/',
  rateLimits.write,
  requirePermission('requests:handle'),
  validate(
    z.object({
      tableId: z.string().min(1),
      type: z.enum([
        'WATER',
        'NAPKINS',
        'CUTLERY',
        'CONDIMENTS',
        'CALL_WAITER',
        'REQUEST_BILL',
        'CLEANING',
        'OTHER',
      ]),
      note: z.string().max(280).nullish(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: req.body.tableId } });
    if (table.branchId !== branchId) {
      throw AppError.forbidden('That table belongs to another branch.');
    }

    const session = await prisma.tableSession.findFirst({
      where: { tableId: table.id, status: { in: ['ACTIVE', 'LOCATION_PENDING', 'CREATED', 'PAUSED'] } },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });

    const result = await createServiceRequest({
      sessionId: session?.id ?? null,
      branchId,
      tableId: table.id,
      restaurantId: req.auth!.restaurantId,
      type: req.body.type,
      note: req.body.note ?? null,
      req,
    });
    res.status(201).json(result);
  }),
);

import { Router } from 'express';
import { branchSettingsSchema, createBranchSchema, restaurantSettingsSchema } from '@tableflow/shared';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { assertBranchAccess, authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import { queueKind } from '../queue/index.js';
import { writeAudit } from '../services/audit.js';
import { listProviders } from '../services/mock-payment-provider.js';

export const settingsRouter: Router = Router();

settingsRouter.use(authenticate);

settingsRouter.get(
  '/',
  requirePermission('settings:view'),
  asyncHandler(async (req, res) => {
    const restaurant = await prisma.restaurant.findUniqueOrThrow({
      where: { id: req.auth!.restaurantId },
      include: {
        branches: { orderBy: { name: 'asc' } },
        _count: { select: { products: true, categories: true } },
      },
    });

    res.json({
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        legalName: restaurant.legalName,
        logoUrl: restaurant.logoUrl,
        currency: restaurant.currency,
        taxRateBps: restaurant.taxRateBps,
        serviceChargeRateBps: restaurant.serviceChargeRateBps,
        pricesIncludeTax: restaurant.pricesIncludeTax,
        locale: restaurant.locale,
        productCount: restaurant._count.products,
        categoryCount: restaurant._count.categories,
      },
      branches: restaurant.branches.filter((b) => req.auth!.branchIds.includes(b.id)),
      system: {
        demoMode: env.demoMode,
        environment: env.NODE_ENV,
        queueDriver: queueKind(),
        paymentProviders: listProviders(),
        /** Every one of these is off unless a key is supplied; none is required. */
        integrations: env.integrations,
      },
    });
  }),
);

settingsRouter.put(
  '/',
  rateLimits.write,
  requirePermission('settings:manage'),
  validate(restaurantSettingsSchema),
  asyncHandler(async (req, res) => {
    const restaurant = await prisma.restaurant.update({
      where: { id: req.auth!.restaurantId },
      data: req.body,
    });
    void writeAudit({
      action: 'settings.restaurant_updated',
      entity: 'Restaurant',
      entityId: restaurant.id,
      restaurantId: restaurant.id,
      req,
      metadata: { fields: Object.keys(req.body) },
    });
    res.json({ restaurant });
  }),
);

settingsRouter.get(
  '/branches',
  requirePermission('settings:view'),
  asyncHandler(async (req, res) => {
    const branches = await prisma.branch.findMany({
      where: { id: { in: req.auth!.branchIds } },
      orderBy: { name: 'asc' },
      include: { _count: { select: { tables: true, inventoryItems: true } } },
    });
    res.json({ branches });
  }),
);

settingsRouter.post(
  '/branches',
  rateLimits.write,
  requirePermission('settings:manage'),
  validate(createBranchSchema),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const slugBase = req.body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    let slug = slugBase || 'branch';
    let attempt = 1;
    while (await prisma.branch.findFirst({ where: { restaurantId, slug } })) {
      slug = `${slugBase}-${attempt}`;
      attempt += 1;
    }

    const branch = await prisma.branch.create({
      data: {
        ...req.body,
        restaurantId,
        slug,
        openingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          opensAt: '08:00',
          closesAt: '23:30',
          closed: false,
        })),
      },
    });

    void writeAudit({
      action: 'settings.branch_created',
      entity: 'Branch',
      entityId: branch.id,
      restaurantId,
      branchId: branch.id,
      req,
    });

    res.status(201).json({ branch });
  }),
);

settingsRouter.put(
  '/branches/:id',
  rateLimits.write,
  requirePermission('settings:manage'),
  validate(branchSettingsSchema),
  asyncHandler(async (req, res) => {
    assertBranchAccess(req, req.params.id);
    const current = await prisma.branch.findUniqueOrThrow({ where: { id: req.params.id } });
    if (current.restaurantId !== req.auth!.restaurantId) throw AppError.forbidden('Not your branch.');

    const branch = await prisma.branch.update({
      where: { id: current.id },
      data: { ...req.body, ...(req.body.openingHours ? { openingHours: req.body.openingHours } : {}) },
    });

    void writeAudit({
      action: 'settings.branch_updated',
      entity: 'Branch',
      entityId: branch.id,
      restaurantId: branch.restaurantId,
      branchId: branch.id,
      req,
      metadata: { fields: Object.keys(req.body) },
    });

    res.json({ branch });
  }),
);

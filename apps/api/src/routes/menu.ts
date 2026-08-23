import { Router } from 'express';
import { z } from 'zod';
import {
  REALTIME_EVENTS,
  categorySchema,
  modifierGroupSchema,
  productAvailabilitySchema,
  productSchema,
  updateProductSchema,
} from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission, resolveBranchId } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import { emitToBranch } from '../realtime/index.js';
import { getBranchMenu } from '../services/menu.js';
import { writeAudit } from '../services/audit.js';

export const menuRouter: Router = Router();

menuRouter.use(authenticate);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

async function uniqueSlug(restaurantId: string, base: string, model: 'product' | 'category', excludeId?: string) {
  const root = slugify(base) || model;
  let slug = root;
  let attempt = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing =
      model === 'product'
        ? await prisma.product.findFirst({ where: { restaurantId, slug }, select: { id: true } })
        : await prisma.menuCategory.findFirst({ where: { restaurantId, slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
    slug = `${root}-${attempt}`;
    attempt += 1;
  }
}

menuRouter.get(
  '/',
  requirePermission('menu:view'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const menu = await getBranchMenu(branchId, {
      includeHidden: true,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : undefined,
    });
    res.json(menu);
  }),
);

/* ------------------------------------------------------------- categories */

menuRouter.post(
  '/categories',
  rateLimits.write,
  requirePermission('menu:manage'),
  validate(categorySchema),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const category = await prisma.menuCategory.create({
      data: { ...req.body, restaurantId, slug: await uniqueSlug(restaurantId, req.body.name, 'category') },
    });
    void writeAudit({ action: 'category.created', entity: 'MenuCategory', entityId: category.id, restaurantId, req });
    res.status(201).json({ category });
  }),
);

menuRouter.put(
  '/categories/:id',
  rateLimits.write,
  requirePermission('menu:manage'),
  validate(categorySchema.partial()),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const current = await prisma.menuCategory.findUniqueOrThrow({ where: { id: req.params.id } });
    if (current.restaurantId !== restaurantId) throw AppError.forbidden('That category belongs to another restaurant.');

    const category = await prisma.menuCategory.update({
      where: { id: req.params.id },
      data: {
        ...req.body,
        ...(req.body.name ? { slug: await uniqueSlug(restaurantId, req.body.name, 'category', current.id) } : {}),
      },
    });
    void writeAudit({
      action: 'category.updated',
      entity: 'MenuCategory',
      entityId: category.id,
      restaurantId,
      req,
      metadata: req.body,
    });
    res.json({ category });
  }),
);

menuRouter.delete(
  '/categories/:id',
  rateLimits.write,
  requirePermission('menu:manage'),
  asyncHandler(async (req, res) => {
    const current = await prisma.menuCategory.findUniqueOrThrow({ where: { id: req.params.id } });
    if (current.restaurantId !== req.auth!.restaurantId) throw AppError.forbidden('Not your category.');

    const products = await prisma.product.count({ where: { categoryId: current.id, archivedAt: null } });
    if (products > 0) {
      throw AppError.conflict(`Move or archive the ${products} item(s) in this category first.`);
    }

    await prisma.menuCategory.delete({ where: { id: current.id } });
    void writeAudit({
      action: 'category.deleted',
      entity: 'MenuCategory',
      entityId: current.id,
      restaurantId: current.restaurantId,
      req,
    });
    res.status(204).end();
  }),
);

/* --------------------------------------------------------------- products */

async function writeProductRelations(
  productId: string,
  restaurantId: string,
  body: z.infer<typeof productSchema>,
) {
  if (body.variants) {
    await prisma.productVariant.deleteMany({ where: { productId } });
    if (body.variants.length > 0) {
      await prisma.productVariant.createMany({
        data: body.variants.map((v, index) => ({
          productId,
          name: v.name,
          priceDelta: v.priceDelta,
          available: v.available,
          sortOrder: v.sortOrder ?? index,
        })),
      });
    }
  }

  if (body.modifierGroups) {
    // Modifier groups are owned by the product here: replacing them keeps the
    // admin form honest rather than leaving orphaned options behind.
    const links = await prisma.productModifierGroup.findMany({ where: { productId } });
    await prisma.productModifierGroup.deleteMany({ where: { productId } });
    for (const link of links) {
      const stillUsed = await prisma.productModifierGroup.count({ where: { groupId: link.groupId } });
      if (stillUsed === 0) {
        await prisma.modifierGroup.delete({ where: { id: link.groupId } }).catch(() => undefined);
      }
    }

    for (const [index, group] of body.modifierGroups.entries()) {
      const created = await prisma.modifierGroup.create({
        data: {
          restaurantId,
          name: group.name,
          selectionType: group.selectionType,
          required: group.required,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect ?? null,
          sortOrder: group.sortOrder ?? index,
          options: {
            create: (group.options ?? []).map((o, i) => ({
              name: o.name,
              priceDelta: o.priceDelta,
              available: o.available,
              sortOrder: o.sortOrder ?? i,
            })),
          },
        },
      });
      await prisma.productModifierGroup.create({
        data: { productId, groupId: created.id, sortOrder: group.sortOrder ?? index },
      });
    }
  }
}

menuRouter.post(
  '/products',
  rateLimits.write,
  requirePermission('menu:manage'),
  validate(productSchema),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const branchId = resolveBranchId(req);

    const category = await prisma.menuCategory.findUniqueOrThrow({ where: { id: req.body.categoryId } });
    if (category.restaurantId !== restaurantId) throw AppError.forbidden('That category belongs to another restaurant.');

    const product = await prisma.product.create({
      data: {
        restaurantId,
        categoryId: req.body.categoryId,
        name: req.body.name,
        slug: await uniqueSlug(restaurantId, req.body.name, 'product'),
        description: req.body.description ?? null,
        imageUrl: req.body.imageUrl ?? null,
        basePrice: req.body.basePrice,
        status: req.body.status,
        featured: req.body.featured,
        popular: req.body.popular,
        prepTimeMinutes: req.body.prepTimeMinutes,
        kitchenStationId: req.body.kitchenStationId ?? null,
        allergens: req.body.allergens,
        tags: req.body.tags,
        calories: req.body.calories ?? null,
        sortOrder: req.body.sortOrder,
      },
    });

    await writeProductRelations(product.id, restaurantId, req.body);

    void writeAudit({
      action: 'product.created',
      entity: 'Product',
      entityId: product.id,
      restaurantId,
      req,
      metadata: { name: product.name, basePrice: product.basePrice },
    });
    emitToBranch(branchId, REALTIME_EVENTS.MENU_UPDATED, { productId: product.id });

    res.status(201).json({ product });
  }),
);

menuRouter.put(
  '/products/:id',
  rateLimits.write,
  requirePermission('menu:manage'),
  validate(updateProductSchema),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const branchId = resolveBranchId(req);

    const current = await prisma.product.findUniqueOrThrow({ where: { id: req.params.id } });
    if (current.restaurantId !== restaurantId) throw AppError.forbidden('That item belongs to another restaurant.');

    const { variants, modifierGroups, ...scalar } = req.body as z.infer<typeof productSchema>;

    const product = await prisma.product.update({
      where: { id: current.id },
      data: {
        ...scalar,
        ...(scalar.name ? { slug: await uniqueSlug(restaurantId, scalar.name, 'product', current.id) } : {}),
      },
    });

    await writeProductRelations(product.id, restaurantId, { variants, modifierGroups } as never);

    if (scalar.basePrice !== undefined && scalar.basePrice !== current.basePrice) {
      void writeAudit({
        action: 'product.price_changed',
        entity: 'Product',
        entityId: product.id,
        restaurantId,
        req,
        metadata: { from: current.basePrice, to: scalar.basePrice },
      });
    }
    void writeAudit({
      action: 'product.updated',
      entity: 'Product',
      entityId: product.id,
      restaurantId,
      req,
      metadata: { fields: Object.keys(scalar) },
    });
    emitToBranch(branchId, REALTIME_EVENTS.MENU_UPDATED, { productId: product.id });

    res.json({ product });
  }),
);

menuRouter.delete(
  '/products/:id',
  rateLimits.write,
  requirePermission('menu:manage'),
  asyncHandler(async (req, res) => {
    const current = await prisma.product.findUniqueOrThrow({ where: { id: req.params.id } });
    if (current.restaurantId !== req.auth!.restaurantId) throw AppError.forbidden('Not your item.');

    // Archive rather than delete: historical orders must keep pointing at a real row.
    await prisma.product.update({
      where: { id: current.id },
      data: { archivedAt: new Date(), status: 'HIDDEN' },
    });

    void writeAudit({
      action: 'product.archived',
      entity: 'Product',
      entityId: current.id,
      restaurantId: current.restaurantId,
      req,
      metadata: { name: current.name },
    });
    res.status(204).end();
  }),
);

/** 86 an item — restaurant-wide, or just for one branch. */
menuRouter.patch(
  '/products/:id/availability',
  rateLimits.write,
  requirePermission('menu:manage'),
  validate(productAvailabilitySchema),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const current = await prisma.product.findUniqueOrThrow({ where: { id: req.params.id } });
    if (current.restaurantId !== restaurantId) throw AppError.forbidden('Not your item.');

    if (req.body.branchId) {
      const branchId = resolveBranchId(req, req.body.branchId);
      await prisma.branchProductAvailability.upsert({
        where: { branchId_productId: { branchId, productId: current.id } },
        create: { branchId, productId: current.id, status: req.body.status },
        update: { status: req.body.status },
      });
      emitToBranch(branchId, REALTIME_EVENTS.MENU_UPDATED, { productId: current.id, status: req.body.status });
    } else {
      await prisma.product.update({ where: { id: current.id }, data: { status: req.body.status } });
      const branches = await prisma.branch.findMany({ where: { restaurantId }, select: { id: true } });
      branches.forEach((b) =>
        emitToBranch(b.id, REALTIME_EVENTS.MENU_UPDATED, { productId: current.id, status: req.body.status }),
      );
    }

    void writeAudit({
      action: 'product.availability_changed',
      entity: 'Product',
      entityId: current.id,
      restaurantId,
      branchId: req.body.branchId ?? null,
      req,
      metadata: { status: req.body.status, scope: req.body.branchId ? 'branch' : 'restaurant' },
    });

    res.json({ id: current.id, status: req.body.status, branchId: req.body.branchId ?? null });
  }),
);

/* --------------------------------------------------- shared modifier groups */

menuRouter.get(
  '/modifier-groups',
  requirePermission('menu:view'),
  asyncHandler(async (req, res) => {
    const groups = await prisma.modifierGroup.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      include: { options: { orderBy: { sortOrder: 'asc' } }, _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
    res.json({ groups });
  }),
);

menuRouter.post(
  '/modifier-groups',
  rateLimits.write,
  requirePermission('menu:manage'),
  validate(modifierGroupSchema),
  asyncHandler(async (req, res) => {
    const group = await prisma.modifierGroup.create({
      data: {
        restaurantId: req.auth!.restaurantId,
        name: req.body.name,
        selectionType: req.body.selectionType,
        required: req.body.required,
        minSelect: req.body.minSelect,
        maxSelect: req.body.maxSelect ?? null,
        sortOrder: req.body.sortOrder,
        options: {
          create: (req.body.options ?? []).map((o: { name: string; priceDelta: number; available: boolean }, i: number) => ({
            name: o.name,
            priceDelta: o.priceDelta,
            available: o.available,
            sortOrder: i,
          })),
        },
      },
      include: { options: true },
    });
    res.status(201).json({ group });
  }),
);

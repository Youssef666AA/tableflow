import { Router } from 'express';
import { z } from 'zod';
import {
  areUnitsCompatible,
  can,
  fromStockQuantity,
  inventoryItemSchema,
  paginationSchema,
  recipeSchema,
  stockLevel,
  stockMovementSchema,
  supplierSchema,
  toStockQuantity,
  updateInventoryItemSchema,
} from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { assertBranchAccess, authenticate, requirePermission, resolveBranchId } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import { applyStockMovement, scanLowStock } from '../services/inventory.js';
import { writeAudit } from '../services/audit.js';

export const inventoryRouter: Router = Router();

inventoryRouter.use(authenticate);

function shapeItem(item: {
  id: string;
  name: string;
  sku: string | null;
  unit: never;
  quantity: number;
  minimumQuantity: number;
  costPerUnit: number;
  category: string | null;
  active: boolean;
  supplier?: { id: string; name: string } | null;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    name: item.name,
    sku: item.sku,
    unit: item.unit,
    quantity: fromStockQuantity(item.quantity, item.unit),
    rawQuantity: item.quantity,
    minimumQuantity: fromStockQuantity(item.minimumQuantity, item.unit),
    rawMinimumQuantity: item.minimumQuantity,
    costPerUnit: item.costPerUnit,
    stockValue: Math.round((item.quantity / 1000) * item.costPerUnit),
    level: stockLevel(item.quantity, item.minimumQuantity),
    category: item.category,
    active: item.active,
    supplier: item.supplier ?? null,
    updatedAt: item.updatedAt,
  };
}

inventoryRouter.get(
  '/',
  requirePermission('inventory:view'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const level = typeof req.query.level === 'string' ? req.query.level : undefined;

    const items = await prisma.inventoryItem.findMany({
      where: {
        branchId,
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });

    const shaped = items.map(shapeItem as never).filter((item) => !level || (item as { level: string }).level === level);

    const alerts = await prisma.inventoryAlert.findMany({
      where: { branchId, resolvedAt: null },
      include: { inventoryItem: { select: { id: true, name: true, unit: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({
      branchId,
      items: shaped,
      summary: {
        total: items.length,
        lowStock: items.filter((i) => stockLevel(i.quantity, i.minimumQuantity) === 'LOW_STOCK').length,
        outOfStock: items.filter((i) => stockLevel(i.quantity, i.minimumQuantity) === 'OUT_OF_STOCK').length,
        stockValue: items.reduce((sum, i) => sum + Math.round((i.quantity / 1000) * i.costPerUnit), 0),
      },
      alerts: alerts.map((a) => ({
        id: a.id,
        level: a.level,
        message: a.message,
        createdAt: a.createdAt,
        item: a.inventoryItem,
      })),
    });
  }),
);

inventoryRouter.get(
  '/items/:id',
  requirePermission('inventory:view'),
  asyncHandler(async (req, res) => {
    const item = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        supplier: { select: { id: true, name: true } },
        movements: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: { user: { select: { fullName: true } }, order: { select: { number: true } } },
        },
      },
    });
    assertBranchAccess(req, item.branchId);

    // Which dishes consume this ingredient, via the restaurant-wide catalogue.
    const usedIn = await prisma.recipeIngredient.findMany({
      where: { ingredientId: item.ingredientId },
      include: { recipe: { include: { product: { select: { id: true, name: true } } } } },
    });

    res.json({
      item: shapeItem(item as never),
      movements: item.movements.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: fromStockQuantity(m.quantity, m.unit),
        unit: m.unit,
        balanceAfter: fromStockQuantity(m.balanceAfter, m.unit),
        reason: m.reason,
        wasteReason: m.wasteReason,
        totalCost: m.totalCost,
        reference: m.reference,
        orderNumber: m.order?.number ?? null,
        user: m.user?.fullName ?? null,
        createdAt: m.createdAt,
      })),
      usedIn: usedIn.map((line) => ({
        productId: line.recipe.product.id,
        productName: line.recipe.product.name,
        quantity: line.quantity,
        unit: line.unit,
      })),
    });
  }),
);

inventoryRouter.post(
  '/items',
  rateLimits.write,
  requirePermission('inventory:manage'),
  validate(inventoryItemSchema),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req, req.body.branchId);
    const restaurantId = req.auth!.restaurantId;

    // Stock always hangs off a catalogue ingredient, so recipes written once for
    // the restaurant resolve at every branch.
    const ingredient = await prisma.ingredient.upsert({
      where: { restaurantId_name: { restaurantId, name: req.body.name } },
      create: {
        restaurantId,
        name: req.body.name,
        unit: req.body.unit,
        category: req.body.category ?? null,
      },
      update: { category: req.body.category ?? undefined },
    });

    if (!areUnitsCompatible(req.body.unit, ingredient.unit)) {
      throw AppError.badRequest(
        `${ingredient.name} is measured in ${ingredient.unit} across this restaurant.`,
      );
    }

    const item = await prisma.inventoryItem.create({
      data: {
        branchId,
        ingredientId: ingredient.id,
        name: ingredient.name,
        sku: req.body.sku ?? null,
        unit: req.body.unit,
        quantity: toStockQuantity(req.body.quantity, req.body.unit),
        minimumQuantity: toStockQuantity(req.body.minimumQuantity, req.body.unit),
        costPerUnit: req.body.costPerUnit,
        supplierId: req.body.supplierId ?? null,
        category: req.body.category ?? null,
      },
      include: { supplier: { select: { id: true, name: true } } },
    });

    if (req.body.quantity > 0) {
      await prisma.stockMovement.create({
        data: {
          branchId,
          inventoryItemId: item.id,
          type: 'ADJUSTMENT',
          quantity: item.quantity,
          unit: item.unit,
          balanceAfter: item.quantity,
          reason: 'Opening balance',
          userId: req.auth!.userId,
        },
      });
    }

    void writeAudit({
      action: 'inventory.item_created',
      entity: 'InventoryItem',
      entityId: item.id,
      branchId,
      req,
      metadata: { name: item.name },
    });

    res.status(201).json({ item: shapeItem(item as never) });
  }),
);

inventoryRouter.put(
  '/items/:id',
  rateLimits.write,
  requirePermission('inventory:manage'),
  validate(updateInventoryItemSchema),
  asyncHandler(async (req, res) => {
    const current = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: req.params.id } });
    assertBranchAccess(req, current.branchId);

    const unit = req.body.unit ?? current.unit;
    const item = await prisma.inventoryItem.update({
      where: { id: current.id },
      data: {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.sku !== undefined ? { sku: req.body.sku } : {}),
        ...(req.body.unit !== undefined ? { unit: req.body.unit } : {}),
        ...(req.body.minimumQuantity !== undefined
          ? { minimumQuantity: toStockQuantity(req.body.minimumQuantity, unit) }
          : {}),
        ...(req.body.costPerUnit !== undefined ? { costPerUnit: req.body.costPerUnit } : {}),
        ...(req.body.supplierId !== undefined ? { supplierId: req.body.supplierId } : {}),
        ...(req.body.category !== undefined ? { category: req.body.category } : {}),
      },
      include: { supplier: { select: { id: true, name: true } } },
    });

    void writeAudit({
      action: 'inventory.item_updated',
      entity: 'InventoryItem',
      entityId: item.id,
      branchId: item.branchId,
      req,
      metadata: { fields: Object.keys(req.body) },
    });

    res.json({ item: shapeItem(item as never) });
  }),
);

/**
 * The only way stock ever moves. Every change writes a ledger row, so the
 * balance can always be explained.
 */
inventoryRouter.post(
  '/movements',
  rateLimits.write,
  requirePermission('inventory:waste'),
  validate(stockMovementSchema),
  asyncHandler(async (req, res) => {
    const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: req.body.inventoryItemId } });
    assertBranchAccess(req, item.branchId);

    if (req.body.type !== 'WASTE' && !can(req.auth!.role, 'inventory:manage')) {
      throw AppError.forbidden('Your role can only record waste.');
    }

    const branch = await prisma.branch.findUniqueOrThrow({
      where: { id: item.branchId },
      select: { allowNegativeStock: true },
    });

    const result = await prisma.$transaction((tx) =>
      applyStockMovement(tx, {
        branchId: item.branchId,
        inventoryItemId: item.id,
        type: req.body.type,
        quantity: req.body.quantity,
        unit: req.body.unit,
        reason: req.body.reason ?? null,
        wasteReason: req.body.wasteReason ?? null,
        unitCost: req.body.unitCost ?? null,
        reference: req.body.reference ?? null,
        userId: req.auth!.userId,
        allowNegative: branch.allowNegativeStock,
      }),
    );

    void writeAudit({
      action: `inventory.${req.body.type.toLowerCase()}`,
      entity: 'InventoryItem',
      entityId: item.id,
      branchId: item.branchId,
      req,
      metadata: {
        quantity: req.body.quantity,
        unit: req.body.unit,
        reason: req.body.reason ?? null,
        wasteReason: req.body.wasteReason ?? null,
        balanceAfter: result.balanceAfter,
      },
    });

    await scanLowStock(item.branchId);

    res.status(201).json({
      movement: {
        id: result.movementId,
        itemId: result.itemId,
        itemName: result.itemName,
        balanceAfter: fromStockQuantity(result.balanceAfter, item.unit),
        level: result.level,
      },
    });
  }),
);

inventoryRouter.get(
  '/movements',
  requirePermission('inventory:view'),
  validate(paginationSchema.extend({ type: z.string().optional(), itemId: z.string().optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const query = req.query as unknown as { page: number; pageSize: number; type?: string; itemId?: string };

    const where = {
      branchId,
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.itemId ? { inventoryItemId: query.itemId } : {}),
    };

    const [total, movements] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          inventoryItem: { select: { id: true, name: true, unit: true } },
          user: { select: { fullName: true } },
          order: { select: { number: true } },
        },
      }),
    ]);

    res.json({
      movements: movements.map((m) => ({
        id: m.id,
        type: m.type,
        item: m.inventoryItem,
        quantity: fromStockQuantity(m.quantity, m.unit),
        unit: m.unit,
        balanceAfter: fromStockQuantity(m.balanceAfter, m.unit),
        reason: m.reason,
        wasteReason: m.wasteReason,
        totalCost: m.totalCost,
        orderNumber: m.order?.number ?? null,
        user: m.user?.fullName ?? null,
        createdAt: m.createdAt,
      })),
      pagination: { ...query, total, pages: Math.ceil(total / query.pageSize) },
    });
  }),
);

/* -------------------------------------------------------------- suppliers */

inventoryRouter.get(
  '/suppliers',
  requirePermission('inventory:view'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const suppliers = await prisma.supplier.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true } } },
    });
    res.json({ suppliers });
  }),
);

inventoryRouter.post(
  '/suppliers',
  rateLimits.write,
  requirePermission('inventory:manage'),
  validate(supplierSchema),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req, req.body.branchId);
    const supplier = await prisma.supplier.create({ data: { ...req.body, branchId } });
    res.status(201).json({ supplier });
  }),
);

/* ------------------------------------------------------------ ingredients */

/** The restaurant-wide catalogue that recipes are written against. */
inventoryRouter.get(
  '/ingredients',
  requirePermission('inventory:view'),
  asyncHandler(async (req, res) => {
    const ingredients = await prisma.ingredient.findMany({
      where: { restaurantId: req.auth!.restaurantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { stock: true, recipeLines: true } } },
    });
    res.json({
      ingredients: ingredients.map((ingredient) => ({
        id: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
        category: ingredient.category,
        stockedAtBranches: ingredient._count.stock,
        usedInRecipes: ingredient._count.recipeLines,
      })),
    });
  }),
);

/* ---------------------------------------------------------------- recipes */

inventoryRouter.get(
  '/recipes/:productId',
  requirePermission('inventory:view'),
  asyncHandler(async (req, res) => {
    const recipe = await prisma.recipe.findUnique({
      where: { productId: req.params.productId },
      include: { ingredients: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
    });
    res.json({ recipe });
  }),
);

inventoryRouter.put(
  '/recipes/:productId',
  rateLimits.write,
  requirePermission('inventory:manage'),
  validate(recipeSchema.omit({ productId: true })),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: req.params.productId } });
    if (product.restaurantId !== req.auth!.restaurantId) throw AppError.forbidden('Not your item.');

    const recipe = await prisma.$transaction(async (tx) => {
      const row = await tx.recipe.upsert({
        where: { productId: product.id },
        create: { productId: product.id, yieldQuantity: req.body.yieldQuantity },
        update: { yieldQuantity: req.body.yieldQuantity },
      });
      await tx.recipeIngredient.deleteMany({ where: { recipeId: row.id } });
      if (req.body.ingredients.length > 0) {
        await tx.recipeIngredient.createMany({
          data: req.body.ingredients.map((ing: { ingredientId: string; quantity: number; unit: string }) => ({
            recipeId: row.id,
            ingredientId: ing.ingredientId,
            quantity: ing.quantity,
            unit: ing.unit as never,
          })),
        });
      }
      return tx.recipe.findUniqueOrThrow({
        where: { id: row.id },
        include: { ingredients: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
      });
    });

    void writeAudit({
      action: 'recipe.updated',
      entity: 'Recipe',
      entityId: recipe.id,
      restaurantId: product.restaurantId,
      req,
      metadata: { productId: product.id, ingredients: recipe.ingredients.length },
    });

    res.json({ recipe });
  }),
);

inventoryRouter.post(
  '/scan',
  rateLimits.write,
  requirePermission('inventory:view'),
  asyncHandler(async (req, res) => {
    const branchId = resolveBranchId(req);
    const raised = await scanLowStock(branchId);
    res.json({ raised });
  }),
);

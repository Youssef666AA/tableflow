import type { Prisma, StockMovementType, Unit, WasteReason } from '@prisma/client';
import {
  REALTIME_EVENTS,
  areUnitsCompatible,
  computeConsumption,
  formatStockQuantity,
  fromStockQuantity,
  stockLevel,
  toStockQuantity,
  type RecipeIngredientLike,
} from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { prisma, type Tx } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { emitToBranch } from '../realtime/index.js';
import { notify } from './notifications.js';

export interface MovementInput {
  branchId: string;
  inventoryItemId: string;
  type: StockMovementType;
  /** In `unit`, signed only for ADJUSTMENT; other types use the magnitude. */
  quantity: number;
  unit: Unit;
  reason?: string | null;
  wasteReason?: WasteReason | null;
  unitCost?: number | null;
  reference?: string | null;
  orderId?: string | null;
  userId?: string | null;
  allowNegative?: boolean;
}

export interface MovementResult {
  itemId: string;
  itemName: string;
  delta: number;
  balanceAfter: number;
  level: ReturnType<typeof stockLevel>;
  movementId: string;
}

const DIRECTION: Record<StockMovementType, 1 | -1> = {
  PURCHASE: 1,
  RETURN: 1,
  SALE: -1,
  WASTE: -1,
  ADJUSTMENT: 1,
};

/**
 * Applies one stock movement inside the caller's transaction: writes the ledger
 * row and moves the balance in the same commit, so the ledger can always be
 * replayed to reconstruct the on-hand quantity.
 */
export async function applyStockMovement(tx: Tx, input: MovementInput): Promise<MovementResult> {
  const item = await tx.inventoryItem.findUniqueOrThrow({
    where: { id: input.inventoryItemId },
    select: {
      id: true,
      name: true,
      branchId: true,
      unit: true,
      quantity: true,
      minimumQuantity: true,
      costPerUnit: true,
    },
  });

  if (item.branchId !== input.branchId) {
    throw AppError.forbidden('That inventory item belongs to another branch.');
  }
  if (!areUnitsCompatible(input.unit, item.unit)) {
    throw AppError.badRequest(
      `Cannot record ${input.unit} against ${item.name}, which is measured in ${item.unit}.`,
    );
  }

  const magnitude = toStockQuantity(Math.abs(input.quantity), input.unit);
  const delta =
    input.type === 'ADJUSTMENT'
      ? toStockQuantity(input.quantity, input.unit)
      : DIRECTION[input.type] * magnitude;

  const balanceAfter = item.quantity + delta;

  if (balanceAfter < 0 && !input.allowNegative) {
    throw new AppError(
      'INSUFFICIENT_STOCK',
      `Not enough ${item.name} in stock (${formatStockQuantity(item.quantity, item.unit)} available).`,
      {
        itemId: item.id,
        itemName: item.name,
        available: fromStockQuantity(item.quantity, item.unit),
        required: fromStockQuantity(Math.abs(delta), item.unit),
        unit: item.unit,
      },
    );
  }

  await tx.inventoryItem.update({
    where: { id: item.id },
    data: { quantity: balanceAfter },
  });

  const unitCost = input.unitCost ?? item.costPerUnit;
  const movement = await tx.stockMovement.create({
    data: {
      branchId: input.branchId,
      inventoryItemId: item.id,
      type: input.type,
      quantity: delta,
      unit: input.unit,
      balanceAfter,
      reason: input.reason ?? null,
      wasteReason: input.wasteReason ?? null,
      unitCost,
      totalCost: Math.round((Math.abs(delta) / 1000) * unitCost),
      reference: input.reference ?? null,
      orderId: input.orderId ?? null,
      userId: input.userId ?? null,
    },
  });

  return {
    itemId: item.id,
    itemName: item.name,
    delta,
    balanceAfter,
    level: stockLevel(balanceAfter, item.minimumQuantity),
    movementId: movement.id,
  };
}

export interface OrderConsumptionLine {
  productId: string | null;
  quantity: number;
}

/**
 * Deducts every recipe ingredient an order consumes.
 *
 * Recipes belong to the restaurant, stock belongs to a branch, so each recipe
 * line is resolved to *this* branch's stock of that catalogue ingredient. A
 * branch that does not stock an ingredient simply records no movement for it
 * rather than failing the order — inventory is opt-in per branch and per product.
 */
export async function consumeForOrder(
  tx: Tx,
  params: {
    branchId: string;
    orderId: string;
    orderNumber: number;
    lines: OrderConsumptionLine[];
    userId?: string | null;
    allowNegative: boolean;
  },
): Promise<MovementResult[]> {
  const productIds = params.lines
    .map((l) => l.productId)
    .filter((id): id is string => typeof id === 'string');
  if (productIds.length === 0) return [];

  const recipes = await tx.recipe.findMany({
    where: { productId: { in: productIds } },
    include: { ingredients: true },
  });
  if (recipes.length === 0) return [];

  const recipeMap = new Map<string, RecipeIngredientLike[]>();
  for (const recipe of recipes) {
    recipeMap.set(
      recipe.productId,
      recipe.ingredients.map((ing) => ({
        // Keyed by catalogue ingredient; mapped to branch stock below.
        inventoryItemId: ing.ingredientId,
        // A recipe can yield more than one portion; scale per portion.
        quantity: ing.quantity / Math.max(1, recipe.yieldQuantity),
        unit: ing.unit,
      })),
    );
  }

  const consumption = computeConsumption({
    recipes: recipeMap,
    lines: params.lines
      .filter((l) => l.productId)
      .map((l) => ({ productId: l.productId as string, quantity: l.quantity })),
  });

  // Resolve the catalogue ingredients to this branch's own stock rows in one query.
  const branchStock = await tx.inventoryItem.findMany({
    where: {
      branchId: params.branchId,
      ingredientId: { in: consumption.map((line) => line.inventoryItemId) },
    },
    select: { id: true, ingredientId: true, unit: true },
  });
  const stockByIngredient = new Map(branchStock.map((item) => [item.ingredientId, item]));

  const results: MovementResult[] = [];
  for (const line of consumption) {
    const item = stockByIngredient.get(line.inventoryItemId);
    // This branch does not track that ingredient — nothing to deduct.
    if (!item) continue;

    results.push(
      await applyStockMovement(tx, {
        branchId: params.branchId,
        inventoryItemId: item.id,
        type: 'SALE',
        // computeConsumption returns scaled base units; convert back to the item's unit.
        quantity: fromStockQuantity(line.scaledQuantity, item.unit),
        unit: item.unit,
        reason: `Order #${params.orderNumber}`,
        orderId: params.orderId,
        userId: params.userId ?? null,
        allowNegative: params.allowNegative,
      }),
    );
  }

  return results;
}

/** Puts ingredients back when an order is cancelled after stock was already taken. */
export async function restoreForOrder(tx: Tx, orderId: string, userId?: string | null): Promise<void> {
  const movements = await tx.stockMovement.findMany({
    where: { orderId, type: 'SALE' },
    select: { id: true, inventoryItemId: true, quantity: true, unit: true, branchId: true },
  });

  for (const movement of movements) {
    const alreadyReturned = await tx.stockMovement.count({
      where: { orderId, type: 'RETURN', inventoryItemId: movement.inventoryItemId },
    });
    if (alreadyReturned > 0) continue;

    await applyStockMovement(tx, {
      branchId: movement.branchId,
      inventoryItemId: movement.inventoryItemId,
      type: 'RETURN',
      quantity: fromStockQuantity(Math.abs(movement.quantity), movement.unit),
      unit: movement.unit,
      reason: 'Order cancelled',
      orderId,
      userId: userId ?? null,
      allowNegative: true,
    });
  }
}

/** Raises (and resolves) low-stock alerts, de-duplicated per item. */
export async function scanLowStock(branchId?: string): Promise<number> {
  const items = await prisma.inventoryItem.findMany({
    where: { active: true, ...(branchId ? { branchId } : {}) },
    select: {
      id: true,
      name: true,
      branchId: true,
      unit: true,
      quantity: true,
      minimumQuantity: true,
      branch: { select: { restaurantId: true, name: true } },
    },
  });

  let raised = 0;

  for (const item of items) {
    const level = stockLevel(item.quantity, item.minimumQuantity);
    const open = await prisma.inventoryAlert.findFirst({
      where: { inventoryItemId: item.id, resolvedAt: null },
    });

    if (level === 'OK') {
      if (open) {
        await prisma.inventoryAlert.update({
          where: { id: open.id },
          data: { resolvedAt: new Date() },
        });
      }
      continue;
    }

    if (open && open.level === level) continue;

    if (open) {
      await prisma.inventoryAlert.update({ where: { id: open.id }, data: { resolvedAt: new Date() } });
    }

    const message =
      level === 'OUT_OF_STOCK'
        ? `${item.name} is out of stock.`
        : `${item.name} is below its minimum (${formatStockQuantity(item.quantity, item.unit)} left).`;

    const alert = await prisma.inventoryAlert.create({
      data: { branchId: item.branchId, inventoryItemId: item.id, level, message },
    });
    raised += 1;

    emitToBranch(item.branchId, REALTIME_EVENTS.INVENTORY_ALERT, {
      id: alert.id,
      itemId: item.id,
      itemName: item.name,
      level,
      message,
    });

    await notify({
      restaurantId: item.branch.restaurantId,
      branchId: item.branchId,
      type: 'LOW_STOCK',
      title: level === 'OUT_OF_STOCK' ? 'Out of stock' : 'Low stock',
      body: message,
      data: { inventoryItemId: item.id, level } as Prisma.InputJsonValue,
      roles: ['OWNER', 'ADMIN', 'MANAGER', 'INVENTORY'],
    });
  }

  if (raised > 0) logger.info({ raised, branchId }, 'inventory alerts raised');
  return raised;
}

export function inventoryLevelOf(quantity: number, minimum: number) {
  return stockLevel(quantity, minimum);
}

import { UNIT_BASE } from './constants.js';
import type { Unit } from './constants.js';

/**
 * Stock is stored in a base unit (g / ml / pcs) as an integer in thousandths of
 * that base unit, so 6.4 kg is 6_400_000. Integers everywhere keeps deductions
 * exact under concurrency.
 */
export const STOCK_SCALE = 1000;

export function toBaseUnit(unit: Unit): 'g' | 'ml' | 'pcs' {
  return UNIT_BASE[unit].base;
}

export function areUnitsCompatible(a: Unit, b: Unit): boolean {
  return toBaseUnit(a) === toBaseUnit(b);
}

/** Converts a human quantity + unit into scaled base-unit integers. */
export function toStockQuantity(quantity: number, unit: Unit): number {
  const { factor } = UNIT_BASE[unit];
  return Math.round(quantity * factor * STOCK_SCALE);
}

/** Converts scaled base-unit integers back into a human quantity for a display unit. */
export function fromStockQuantity(scaled: number, unit: Unit): number {
  const { factor } = UNIT_BASE[unit];
  return scaled / (factor * STOCK_SCALE);
}

export function formatStockQuantity(scaled: number, unit: Unit, maxDecimals = 2): string {
  const value = fromStockQuantity(scaled, unit);
  const rounded = Number(value.toFixed(maxDecimals));
  return `${rounded.toLocaleString('en-US', { maximumFractionDigits: maxDecimals })} ${unit}`;
}

export interface RecipeIngredientLike {
  inventoryItemId: string;
  quantity: number;
  unit: Unit;
}

export interface ConsumptionLine {
  inventoryItemId: string;
  scaledQuantity: number;
}

export interface ConsumptionInput {
  /** Recipe rows keyed by the product (or variant) that owns them. */
  recipes: Map<string, RecipeIngredientLike[]>;
  lines: Array<{ productId: string; quantity: number }>;
}

/** Aggregates every recipe row of an order into one deduction per inventory item. */
export function computeConsumption(input: ConsumptionInput): ConsumptionLine[] {
  const totals = new Map<string, number>();

  for (const line of input.lines) {
    const recipe = input.recipes.get(line.productId);
    if (!recipe || recipe.length === 0) continue;
    for (const ingredient of recipe) {
      const scaled = toStockQuantity(ingredient.quantity, ingredient.unit) * line.quantity;
      totals.set(ingredient.inventoryItemId, (totals.get(ingredient.inventoryItemId) ?? 0) + scaled);
    }
  }

  return [...totals.entries()]
    .map(([inventoryItemId, scaledQuantity]) => ({ inventoryItemId, scaledQuantity }))
    .sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId));
}

export type StockLevel = 'OUT_OF_STOCK' | 'LOW_STOCK' | 'OK';

export function stockLevel(current: number, minimum: number): StockLevel {
  if (current <= 0) return 'OUT_OF_STOCK';
  if (minimum > 0 && current <= minimum) return 'LOW_STOCK';
  return 'OK';
}

export const STOCK_LEVEL_LABEL: Record<StockLevel, string> = {
  OUT_OF_STOCK: 'Out of stock',
  LOW_STOCK: 'Low stock',
  OK: 'In stock',
};

/** Signed direction a movement type applies to stock on hand. */
export const MOVEMENT_DIRECTION: Record<string, 1 | -1> = {
  PURCHASE: 1,
  RETURN: 1,
  SALE: -1,
  WASTE: -1,
  ADJUSTMENT: 1,
};

export function signedMovement(type: string, scaledQuantity: number): number {
  const direction = MOVEMENT_DIRECTION[type] ?? 1;
  // ADJUSTMENT carries its own sign; everything else is normalised to a magnitude.
  if (type === 'ADJUSTMENT') return scaledQuantity;
  return direction * Math.abs(scaledQuantity);
}

import { applyRateBps, percentOf } from './money.js';
import type { ModifierSelectionType, PromotionScope, PromotionType } from './constants.js';
import { DEFAULT_CURRENCY } from './constants.js';

/**
 * The authoritative pricing engine.
 *
 * The client imports this only to render an optimistic preview. The API runs the
 * exact same function against database rows and stores *its* result — a client
 * that lies about a price simply gets overruled.
 */

export interface PricingModifierOption {
  id: string;
  name: string;
  priceDelta: number;
  available: boolean;
}

export interface PricingModifierGroup {
  id: string;
  name: string;
  selectionType: ModifierSelectionType;
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  options: PricingModifierOption[];
}

export interface PricingVariant {
  id: string;
  name: string;
  priceDelta: number;
  available: boolean;
}

export interface PricingProduct {
  id: string;
  name: string;
  categoryId: string;
  basePrice: number;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'HIDDEN';
  variants: PricingVariant[];
  modifierGroups: PricingModifierGroup[];
  prepTimeMinutes?: number;
}

export interface CartLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  modifierOptionIds?: string[];
  notes?: string | null;
}

export interface PricedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceDelta: number;
}

export interface PricedLine {
  productId: string;
  productName: string;
  categoryId: string;
  variantId: string | null;
  variantName: string | null;
  quantity: number;
  /** Product base price plus the selected variant delta. */
  unitBasePrice: number;
  modifiersPerUnit: number;
  unitPrice: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineTotal: number;
  modifiers: PricedModifier[];
  notes: string | null;
  prepTimeMinutes: number;
}

export interface PricingPromotion {
  id: string;
  name: string;
  type: PromotionType;
  scope: PromotionScope;
  /** Percentage points for PERCENTAGE, minor units for FIXED. */
  value: number;
  productIds?: string[];
  categoryIds?: string[];
  minSubtotal?: number | null;
  maxDiscount?: number | null;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  /** 0 = Sunday … 6 = Saturday. Empty or undefined means every day. */
  daysOfWeek?: number[] | null;
  /** Minutes from midnight, local restaurant time. */
  startMinuteOfDay?: number | null;
  endMinuteOfDay?: number | null;
  active: boolean;
  priority?: number;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  amount: number;
}

export interface ChargeSettings {
  currency: string;
  taxRateBps: number;
  serviceChargeRateBps: number;
  /** When true, menu prices already contain tax and it is extracted rather than added. */
  pricesIncludeTax: boolean;
}

export const DEFAULT_CHARGE_SETTINGS: ChargeSettings = {
  currency: DEFAULT_CURRENCY,
  taxRateBps: 0,
  serviceChargeRateBps: 0,
  pricesIncludeTax: true,
};

export interface PricedOrder {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  appliedPromotions: AppliedPromotion[];
  taxTotal: number;
  serviceChargeTotal: number;
  total: number;
  currency: string;
  estimatedPrepMinutes: number;
}

export type PricingErrorCode =
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_UNAVAILABLE'
  | 'VARIANT_NOT_FOUND'
  | 'VARIANT_UNAVAILABLE'
  | 'MODIFIER_NOT_FOUND'
  | 'MODIFIER_UNAVAILABLE'
  | 'MODIFIER_GROUP_REQUIRED'
  | 'MODIFIER_TOO_FEW'
  | 'MODIFIER_TOO_MANY'
  | 'INVALID_QUANTITY'
  | 'EMPTY_CART';

export class PricingError extends Error {
  code: PricingErrorCode;
  details: Record<string, unknown>;

  constructor(code: PricingErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
    this.details = details;
  }
}

export const MAX_LINE_QUANTITY = 50;

function priceLine(line: CartLineInput, product: PricingProduct): PricedLine {
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
    throw new PricingError('INVALID_QUANTITY', `Quantity must be between 1 and ${MAX_LINE_QUANTITY}.`, {
      productId: product.id,
      quantity: line.quantity,
    });
  }

  if (product.status !== 'AVAILABLE') {
    throw new PricingError('PRODUCT_UNAVAILABLE', `${product.name} is currently unavailable.`, {
      productId: product.id,
    });
  }

  let variant: PricingVariant | null = null;
  if (line.variantId) {
    variant = product.variants.find((v) => v.id === line.variantId) ?? null;
    if (!variant) {
      throw new PricingError('VARIANT_NOT_FOUND', `Unknown option for ${product.name}.`, {
        productId: product.id,
        variantId: line.variantId,
      });
    }
    if (!variant.available) {
      throw new PricingError('VARIANT_UNAVAILABLE', `${variant.name} is currently unavailable.`, {
        productId: product.id,
        variantId: variant.id,
      });
    }
  } else if (product.variants.length > 0) {
    const fallback = product.variants.find((v) => v.available);
    if (!fallback) {
      throw new PricingError('VARIANT_UNAVAILABLE', `${product.name} is currently unavailable.`, {
        productId: product.id,
      });
    }
    variant = fallback;
  }

  const selectedIds = line.modifierOptionIds ?? [];
  const seen = new Set<string>();
  const modifiers: PricedModifier[] = [];

  for (const optionId of selectedIds) {
    if (seen.has(optionId)) continue;
    seen.add(optionId);

    let found: { group: PricingModifierGroup; option: PricingModifierOption } | null = null;
    for (const group of product.modifierGroups) {
      const option = group.options.find((o) => o.id === optionId);
      if (option) {
        found = { group, option };
        break;
      }
    }

    if (!found) {
      throw new PricingError('MODIFIER_NOT_FOUND', `Unknown choice for ${product.name}.`, {
        productId: product.id,
        optionId,
      });
    }
    if (!found.option.available) {
      throw new PricingError(
        'MODIFIER_UNAVAILABLE',
        `${found.option.name} is currently unavailable.`,
        { productId: product.id, optionId },
      );
    }

    modifiers.push({
      groupId: found.group.id,
      groupName: found.group.name,
      optionId: found.option.id,
      optionName: found.option.name,
      priceDelta: found.option.priceDelta,
    });
  }

  for (const group of product.modifierGroups) {
    const count = modifiers.filter((m) => m.groupId === group.id).length;
    const max = group.selectionType === 'SINGLE' ? 1 : (group.maxSelect ?? group.options.length);
    const min = group.required ? Math.max(1, group.minSelect) : group.minSelect;

    if (count < min) {
      throw new PricingError(
        group.required && count === 0 ? 'MODIFIER_GROUP_REQUIRED' : 'MODIFIER_TOO_FEW',
        `Choose at least ${min} option${min === 1 ? '' : 's'} for ${group.name}.`,
        { productId: product.id, groupId: group.id, min, count },
      );
    }
    if (count > max) {
      throw new PricingError(
        'MODIFIER_TOO_MANY',
        `Choose at most ${max} option${max === 1 ? '' : 's'} for ${group.name}.`,
        { productId: product.id, groupId: group.id, max, count },
      );
    }
  }

  const unitBasePrice = product.basePrice + (variant?.priceDelta ?? 0);
  const modifiersPerUnit = modifiers.reduce((sum, m) => sum + m.priceDelta, 0);
  const unitPrice = unitBasePrice + modifiersPerUnit;
  const lineSubtotal = unitPrice * line.quantity;

  return {
    productId: product.id,
    productName: product.name,
    categoryId: product.categoryId,
    variantId: variant?.id ?? null,
    variantName: variant?.name ?? null,
    quantity: line.quantity,
    unitBasePrice,
    modifiersPerUnit,
    unitPrice,
    lineSubtotal,
    lineDiscount: 0,
    lineTotal: lineSubtotal,
    modifiers,
    notes: line.notes?.trim() ? line.notes.trim().slice(0, 280) : null,
    prepTimeMinutes: product.prepTimeMinutes ?? 10,
  };
}

function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function isPromotionActiveAt(promotion: PricingPromotion, at: Date = new Date()): boolean {
  if (!promotion.active) return false;

  if (promotion.startsAt) {
    const start = promotion.startsAt instanceof Date ? promotion.startsAt : new Date(promotion.startsAt);
    if (at < start) return false;
  }
  if (promotion.endsAt) {
    const end = promotion.endsAt instanceof Date ? promotion.endsAt : new Date(promotion.endsAt);
    if (at > end) return false;
  }
  if (promotion.daysOfWeek && promotion.daysOfWeek.length > 0) {
    if (!promotion.daysOfWeek.includes(at.getDay())) return false;
  }

  const hasStart = typeof promotion.startMinuteOfDay === 'number';
  const hasEnd = typeof promotion.endMinuteOfDay === 'number';
  if (hasStart || hasEnd) {
    const now = minuteOfDay(at);
    const start = hasStart ? (promotion.startMinuteOfDay as number) : 0;
    const end = hasEnd ? (promotion.endMinuteOfDay as number) : 24 * 60;
    if (start <= end) {
      if (now < start || now > end) return false;
    } else if (now < start && now > end) {
      // Window wraps past midnight (e.g. 22:00 -> 02:00).
      return false;
    }
  }

  return true;
}

function promotionBase(promotion: PricingPromotion, lines: PricedLine[]): number {
  if (promotion.scope === 'ORDER') {
    return lines.reduce((sum, l) => sum + l.lineSubtotal, 0);
  }
  if (promotion.scope === 'PRODUCT') {
    const ids = new Set(promotion.productIds ?? []);
    return lines.filter((l) => ids.has(l.productId)).reduce((sum, l) => sum + l.lineSubtotal, 0);
  }
  const ids = new Set(promotion.categoryIds ?? []);
  return lines.filter((l) => ids.has(l.categoryId)).reduce((sum, l) => sum + l.lineSubtotal, 0);
}

export interface PriceOrderInput {
  lines: CartLineInput[];
  products: PricingProduct[];
  promotions?: PricingPromotion[];
  settings?: Partial<ChargeSettings>;
  now?: Date;
}

export function priceOrder(input: PriceOrderInput): PricedOrder {
  const settings: ChargeSettings = { ...DEFAULT_CHARGE_SETTINGS, ...(input.settings ?? {}) };
  const now = input.now ?? new Date();

  if (!input.lines || input.lines.length === 0) {
    throw new PricingError('EMPTY_CART', 'Your cart is empty.');
  }

  const productById = new Map(input.products.map((p) => [p.id, p]));
  const pricedLines: PricedLine[] = input.lines.map((line) => {
    const product = productById.get(line.productId);
    if (!product) {
      throw new PricingError('PRODUCT_NOT_FOUND', 'One of the items is no longer on the menu.', {
        productId: line.productId,
      });
    }
    return priceLine(line, product);
  });

  const subtotal = pricedLines.reduce((sum, l) => sum + l.lineSubtotal, 0);

  const candidates = (input.promotions ?? [])
    .filter((p) => isPromotionActiveAt(p, now))
    .filter((p) => (p.minSubtotal ?? 0) <= subtotal)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  const appliedPromotions: AppliedPromotion[] = [];
  let discountTotal = 0;

  for (const promotion of candidates) {
    const base = promotionBase(promotion, pricedLines);
    if (base <= 0) continue;

    let amount =
      promotion.type === 'PERCENTAGE'
        ? percentOf(base, promotion.value)
        : Math.min(promotion.value, base);

    if (promotion.maxDiscount != null) {
      amount = Math.min(amount, promotion.maxDiscount);
    }
    amount = Math.min(amount, subtotal - discountTotal);
    if (amount <= 0) continue;

    discountTotal += amount;
    appliedPromotions.push({ promotionId: promotion.id, name: promotion.name, amount });
  }

  // Spread the discount across lines proportionally so receipts and split bills add up.
  if (discountTotal > 0 && subtotal > 0) {
    let allocated = 0;
    pricedLines.forEach((line, index) => {
      const isLast = index === pricedLines.length - 1;
      const share = isLast
        ? discountTotal - allocated
        : Math.round((discountTotal * line.lineSubtotal) / subtotal);
      allocated += share;
      line.lineDiscount = share;
      line.lineTotal = line.lineSubtotal - share;
    });
  }

  const netSubtotal = subtotal - discountTotal;

  let taxTotal: number;
  let serviceChargeTotal: number;
  let total: number;

  if (settings.pricesIncludeTax) {
    // Menu prices already include tax: extract it for the receipt breakdown.
    taxTotal =
      settings.taxRateBps > 0
        ? netSubtotal - Math.round((netSubtotal * 10000) / (10000 + settings.taxRateBps))
        : 0;
    serviceChargeTotal = applyRateBps(netSubtotal, settings.serviceChargeRateBps);
    total = netSubtotal + serviceChargeTotal;
  } else {
    taxTotal = applyRateBps(netSubtotal, settings.taxRateBps);
    serviceChargeTotal = applyRateBps(netSubtotal, settings.serviceChargeRateBps);
    total = netSubtotal + taxTotal + serviceChargeTotal;
  }

  // Kitchen throughput: parallel stations, so the longest item dominates, with a
  // small penalty for volume rather than a naive sum.
  const maxPrep = pricedLines.reduce((max, l) => Math.max(max, l.prepTimeMinutes), 0);
  const totalUnits = pricedLines.reduce((sum, l) => sum + l.quantity, 0);
  const estimatedPrepMinutes = Math.max(5, Math.round(maxPrep + Math.max(0, totalUnits - 1) * 1.5));

  return {
    lines: pricedLines,
    subtotal,
    discountTotal,
    appliedPromotions,
    taxTotal,
    serviceChargeTotal,
    total,
    currency: settings.currency,
    estimatedPrepMinutes,
  };
}

/** Prep-time window shown to the customer, e.g. 12–18 min. */
export function prepTimeWindow(minutes: number): { min: number; max: number; label: string } {
  const min = Math.max(3, Math.round(minutes * 0.8));
  const max = Math.round(minutes * 1.25) + 2;
  return { min, max, label: `${min}–${max} min` };
}

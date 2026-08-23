import { describe, expect, it } from 'vitest';
import {
  PricingError,
  isPromotionActiveAt,
  prepTimeWindow,
  priceOrder,
  type PricingProduct,
  type PricingPromotion,
} from '@tableflow/shared';

/**
 * The pricing engine is the one piece of logic the client and server share, and
 * the one the server must never take on trust from the client. These tests pin
 * the arithmetic, the modifier rules and the promotion behaviour.
 */

const burger: PricingProduct = {
  id: 'p-burger',
  name: 'Double Beef Burger',
  categoryId: 'c-burgers',
  basePrice: 27500,
  status: 'AVAILABLE',
  prepTimeMinutes: 12,
  variants: [],
  modifierGroups: [
    {
      id: 'g-cooking',
      name: 'Cooking',
      selectionType: 'SINGLE',
      required: true,
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: 'o-medium', name: 'Medium', priceDelta: 0, available: true },
        { id: 'o-well', name: 'Well done', priceDelta: 0, available: true },
      ],
    },
    {
      id: 'g-extras',
      name: 'Extras',
      selectionType: 'MULTIPLE',
      required: false,
      minSelect: 0,
      maxSelect: 2,
      options: [
        { id: 'o-cheese', name: 'Extra cheese', priceDelta: 2000, available: true },
        { id: 'o-bacon', name: 'Turkey bacon', priceDelta: 3000, available: true },
        { id: 'o-egg', name: 'Fried egg', priceDelta: 2000, available: false },
      ],
    },
  ],
};

const pizza: PricingProduct = {
  id: 'p-pizza',
  name: 'Margherita',
  categoryId: 'c-pizza',
  basePrice: 19000,
  status: 'AVAILABLE',
  prepTimeMinutes: 15,
  variants: [
    { id: 'v-30', name: '30 cm', priceDelta: 0, available: true },
    { id: 'v-40', name: '40 cm', priceDelta: 8000, available: true },
    { id: 'v-50', name: '50 cm', priceDelta: 14000, available: false },
  ],
  modifierGroups: [],
};

const cola: PricingProduct = {
  id: 'p-cola',
  name: 'Coca-Cola',
  categoryId: 'c-drinks',
  basePrice: 4000,
  status: 'AVAILABLE',
  prepTimeMinutes: 2,
  variants: [],
  modifierGroups: [],
};

const soldOut: PricingProduct = { ...cola, id: 'p-sold-out', name: 'Sea Bass', status: 'UNAVAILABLE' };

const products = [burger, pizza, cola, soldOut];

const TAX_INCLUSIVE = { currency: 'TND', taxRateBps: 1900, serviceChargeRateBps: 0, pricesIncludeTax: true };

describe('priceOrder — line arithmetic', () => {
  it('multiplies unit price by quantity', () => {
    const result = priceOrder({
      lines: [{ productId: cola.id, quantity: 3, modifierOptionIds: [] }],
      products,
      settings: TAX_INCLUSIVE,
    });
    expect(result.lines[0].unitPrice).toBe(4000);
    expect(result.lines[0].lineSubtotal).toBe(12000);
    expect(result.subtotal).toBe(12000);
  });

  it('adds the variant delta to the base price', () => {
    const result = priceOrder({
      lines: [{ productId: pizza.id, variantId: 'v-40', quantity: 1, modifierOptionIds: [] }],
      products,
      settings: TAX_INCLUSIVE,
    });
    expect(result.lines[0].unitBasePrice).toBe(27000);
    expect(result.lines[0].variantName).toBe('40 cm');
  });

  it('adds every selected modifier to each unit, not to the line', () => {
    const result = priceOrder({
      lines: [
        { productId: burger.id, quantity: 2, modifierOptionIds: ['o-medium', 'o-cheese', 'o-bacon'] },
      ],
      products,
      settings: TAX_INCLUSIVE,
    });
    expect(result.lines[0].modifiersPerUnit).toBe(5000);
    expect(result.lines[0].unitPrice).toBe(32500);
    expect(result.lines[0].lineSubtotal).toBe(65000);
  });

  it('falls back to the first available variant when none is chosen', () => {
    const result = priceOrder({
      lines: [{ productId: pizza.id, quantity: 1, modifierOptionIds: [] }],
      products,
      settings: TAX_INCLUSIVE,
    });
    expect(result.lines[0].variantId).toBe('v-30');
  });

  it('ignores a duplicated modifier id rather than charging twice', () => {
    const result = priceOrder({
      lines: [
        { productId: burger.id, quantity: 1, modifierOptionIds: ['o-medium', 'o-cheese', 'o-cheese'] },
      ],
      products,
      settings: TAX_INCLUSIVE,
    });
    expect(result.lines[0].modifiersPerUnit).toBe(2000);
  });
});

describe('priceOrder — validation', () => {
  const expectCode = (fn: () => unknown, code: string) => {
    try {
      fn();
      throw new Error('expected a PricingError');
    } catch (error) {
      expect(error).toBeInstanceOf(PricingError);
      expect((error as PricingError).code).toBe(code);
    }
  };

  it('refuses an unknown product', () => {
    expectCode(
      () => priceOrder({ lines: [{ productId: 'nope', quantity: 1 }], products, settings: TAX_INCLUSIVE }),
      'PRODUCT_NOT_FOUND',
    );
  });

  it('refuses an unavailable product', () => {
    expectCode(
      () => priceOrder({ lines: [{ productId: soldOut.id, quantity: 1 }], products, settings: TAX_INCLUSIVE }),
      'PRODUCT_UNAVAILABLE',
    );
  });

  it('refuses an unavailable variant', () => {
    expectCode(
      () =>
        priceOrder({
          lines: [{ productId: pizza.id, variantId: 'v-50', quantity: 1 }],
          products,
          settings: TAX_INCLUSIVE,
        }),
      'VARIANT_UNAVAILABLE',
    );
  });

  it('refuses an unavailable modifier option', () => {
    expectCode(
      () =>
        priceOrder({
          lines: [{ productId: burger.id, quantity: 1, modifierOptionIds: ['o-medium', 'o-egg'] }],
          products,
          settings: TAX_INCLUSIVE,
        }),
      'MODIFIER_UNAVAILABLE',
    );
  });

  it('enforces a required modifier group', () => {
    expectCode(
      () =>
        priceOrder({
          lines: [{ productId: burger.id, quantity: 1, modifierOptionIds: [] }],
          products,
          settings: TAX_INCLUSIVE,
        }),
      'MODIFIER_GROUP_REQUIRED',
    );
  });

  it('enforces the maximum selection of a multi-choice group', () => {
    expectCode(
      () =>
        priceOrder({
          lines: [
            { productId: burger.id, quantity: 1, modifierOptionIds: ['o-medium', 'o-cheese', 'o-bacon', 'o-egg'] },
          ],
          products: [
            { ...burger, modifierGroups: burger.modifierGroups.map((g) => ({ ...g, options: g.options.map((o) => ({ ...o, available: true })) })) },
          ],
          settings: TAX_INCLUSIVE,
        }),
      'MODIFIER_TOO_MANY',
    );
  });

  it('rejects a non-positive or absurd quantity', () => {
    expectCode(
      () => priceOrder({ lines: [{ productId: cola.id, quantity: 0 }], products, settings: TAX_INCLUSIVE }),
      'INVALID_QUANTITY',
    );
    expectCode(
      () => priceOrder({ lines: [{ productId: cola.id, quantity: 999 }], products, settings: TAX_INCLUSIVE }),
      'INVALID_QUANTITY',
    );
  });

  it('rejects an empty cart', () => {
    expectCode(() => priceOrder({ lines: [], products, settings: TAX_INCLUSIVE }), 'EMPTY_CART');
  });
});

describe('priceOrder — tax and service charge', () => {
  it('extracts VAT when menu prices already include it', () => {
    const result = priceOrder({
      lines: [{ productId: cola.id, quantity: 1, modifierOptionIds: [] }],
      products,
      settings: TAX_INCLUSIVE,
    });
    // 4000 inclusive of 19% => net 3361, tax 639. Total is unchanged.
    expect(result.total).toBe(4000);
    expect(result.taxTotal).toBe(4000 - Math.round((4000 * 10000) / 11900));
  });

  it('adds VAT on top when prices exclude it', () => {
    const result = priceOrder({
      lines: [{ productId: cola.id, quantity: 1, modifierOptionIds: [] }],
      products,
      settings: { ...TAX_INCLUSIVE, pricesIncludeTax: false },
    });
    expect(result.taxTotal).toBe(760);
    expect(result.total).toBe(4760);
  });

  it('applies a service charge on the net subtotal', () => {
    const result = priceOrder({
      lines: [{ productId: cola.id, quantity: 1, modifierOptionIds: [] }],
      products,
      settings: { ...TAX_INCLUSIVE, serviceChargeRateBps: 1000 },
    });
    expect(result.serviceChargeTotal).toBe(400);
    expect(result.total).toBe(4400);
  });
});

describe('priceOrder — promotions', () => {
  const happyHour: PricingPromotion = {
    id: 'promo-drinks',
    name: 'Happy Hour',
    type: 'PERCENTAGE',
    scope: 'CATEGORY',
    value: 20,
    categoryIds: ['c-drinks'],
    active: true,
    priority: 10,
  };

  const fiveOff: PricingPromotion = {
    id: 'promo-order',
    name: '5 TND off',
    type: 'FIXED',
    scope: 'ORDER',
    value: 5000,
    minSubtotal: 50000,
    active: true,
    priority: 5,
  };

  it('discounts only the products in scope', () => {
    const result = priceOrder({
      lines: [
        { productId: cola.id, quantity: 2, modifierOptionIds: [] },
        { productId: pizza.id, variantId: 'v-30', quantity: 1, modifierOptionIds: [] },
      ],
      products,
      promotions: [happyHour],
      settings: TAX_INCLUSIVE,
    });
    // 20% of the 8000 drinks subtotal only.
    expect(result.discountTotal).toBe(1600);
    expect(result.subtotal).toBe(27000);
    expect(result.total).toBe(25400);
  });

  it('ignores a promotion below its minimum subtotal', () => {
    const result = priceOrder({
      lines: [{ productId: cola.id, quantity: 1, modifierOptionIds: [] }],
      products,
      promotions: [fiveOff],
      settings: TAX_INCLUSIVE,
    });
    expect(result.discountTotal).toBe(0);
    expect(result.appliedPromotions).toHaveLength(0);
  });

  it('applies several promotions in priority order', () => {
    const result = priceOrder({
      lines: [
        { productId: cola.id, quantity: 5, modifierOptionIds: [] },
        { productId: pizza.id, variantId: 'v-40', quantity: 2, modifierOptionIds: [] },
      ],
      products,
      promotions: [fiveOff, happyHour],
      settings: TAX_INCLUSIVE,
    });
    expect(result.appliedPromotions.map((p) => p.promotionId)).toEqual(['promo-drinks', 'promo-order']);
    expect(result.discountTotal).toBe(4000 + 5000);
  });

  it('never discounts more than the subtotal', () => {
    const huge: PricingPromotion = { ...fiveOff, value: 999_999, minSubtotal: 0 };
    const result = priceOrder({
      lines: [{ productId: cola.id, quantity: 1, modifierOptionIds: [] }],
      products,
      promotions: [huge],
      settings: TAX_INCLUSIVE,
    });
    expect(result.discountTotal).toBe(4000);
    expect(result.total).toBe(0);
  });

  it('respects a maximum discount cap', () => {
    const capped: PricingPromotion = { ...happyHour, maxDiscount: 500 };
    const result = priceOrder({
      lines: [{ productId: cola.id, quantity: 5, modifierOptionIds: [] }],
      products,
      promotions: [capped],
      settings: TAX_INCLUSIVE,
    });
    expect(result.discountTotal).toBe(500);
  });

  it('spreads the discount across lines so the parts sum to the whole', () => {
    const result = priceOrder({
      lines: [
        { productId: cola.id, quantity: 3, modifierOptionIds: [] },
        { productId: pizza.id, variantId: 'v-30', quantity: 1, modifierOptionIds: [] },
        { productId: burger.id, quantity: 1, modifierOptionIds: ['o-medium'] },
      ],
      products,
      promotions: [{ ...fiveOff, value: 3333, minSubtotal: 0 }],
      settings: TAX_INCLUSIVE,
    });
    const allocated = result.lines.reduce((sum, line) => sum + line.lineDiscount, 0);
    expect(allocated).toBe(result.discountTotal);
    expect(result.lines.reduce((sum, line) => sum + line.lineTotal, 0)).toBe(
      result.subtotal - result.discountTotal,
    );
  });
});

describe('isPromotionActiveAt', () => {
  const base: PricingPromotion = {
    id: 'p',
    name: 'Window',
    type: 'PERCENTAGE',
    scope: 'ORDER',
    value: 10,
    active: true,
  };

  it('respects an inactive flag', () => {
    expect(isPromotionActiveAt({ ...base, active: false }, new Date())).toBe(false);
  });

  it('respects a start and end date', () => {
    const promo = { ...base, startsAt: '2026-01-10T00:00:00Z', endsAt: '2026-01-20T00:00:00Z' };
    expect(isPromotionActiveAt(promo, new Date('2026-01-05T12:00:00Z'))).toBe(false);
    expect(isPromotionActiveAt(promo, new Date('2026-01-15T12:00:00Z'))).toBe(true);
    expect(isPromotionActiveAt(promo, new Date('2026-01-25T12:00:00Z'))).toBe(false);
  });

  it('respects a time-of-day window', () => {
    const promo = { ...base, startMinuteOfDay: 14 * 60, endMinuteOfDay: 17 * 60 };
    const at = (hour: number) => {
      const date = new Date();
      date.setHours(hour, 0, 0, 0);
      return date;
    };
    expect(isPromotionActiveAt(promo, at(13))).toBe(false);
    expect(isPromotionActiveAt(promo, at(15))).toBe(true);
    expect(isPromotionActiveAt(promo, at(18))).toBe(false);
  });

  it('respects selected days of the week', () => {
    const monday = new Date('2026-01-05T12:00:00');
    const sunday = new Date('2026-01-04T12:00:00');
    const promo = { ...base, daysOfWeek: [1, 2, 3, 4, 5] };
    expect(isPromotionActiveAt(promo, monday)).toBe(true);
    expect(isPromotionActiveAt(promo, sunday)).toBe(false);
  });
});

describe('prepTimeWindow', () => {
  it('produces a sensible range around the estimate', () => {
    const window = prepTimeWindow(15);
    expect(window.min).toBeLessThan(15);
    expect(window.max).toBeGreaterThan(15);
    expect(window.label).toBe(`${window.min}–${window.max} min`);
  });
});

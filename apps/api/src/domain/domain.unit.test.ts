import { describe, expect, it } from 'vitest';
import {
  canAssignRole,
  canTransitionOrder,
  canTransitionPayment,
  canTransitionServiceRequest,
  canTransitionSession,
  checkLocation,
  computeConsumption,
  deriveTableStatus,
  evaluateOpenState,
  formatMoney,
  fromStockQuantity,
  haversineDistanceMeters,
  can,
  permissionsForRole,
  sessionCanOrder,
  signedMovement,
  splitEvenly,
  stockLevel,
  toMinor,
  toStockQuantity,
  urgencyFor,
  type OpeningHour,
  type RecipeIngredientLike,
} from '@tableflow/shared';

/* ------------------------------------------------------------------ money */

describe('money', () => {
  it('formats TND with three decimals', () => {
    expect(formatMoney(49500, 'TND')).toBe('49.500 TND');
    expect(formatMoney(0, 'TND')).toBe('0.000 TND');
    expect(formatMoney(1234567, 'TND')).toBe('1,234.567 TND');
    expect(formatMoney(-2500, 'TND')).toBe('-2.500 TND');
  });

  it('formats two-decimal currencies correctly', () => {
    expect(formatMoney(1999, 'EUR')).toBe('19.99 EUR');
  });

  it('round-trips major to minor units', () => {
    expect(toMinor(49.5, 'TND')).toBe(49500);
    expect(toMinor(19.99, 'EUR')).toBe(1999);
  });

  it('splits an amount without losing or inventing millimes', () => {
    for (const [total, parts] of [
      [72000, 4],
      [10000, 3],
      [1, 3],
      [99999, 7],
    ] as const) {
      const shares = splitEvenly(total, parts);
      expect(shares).toHaveLength(parts);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    }
  });

  it('refuses a nonsensical number of parts', () => {
    expect(() => splitEvenly(1000, 0)).toThrow();
    expect(() => splitEvenly(1000, -2)).toThrow();
  });
});

/* -------------------------------------------------------------- location */

describe('location verification', () => {
  const restaurant = { latitude: 35.8419, longitude: 10.6386 };

  it('measures a known distance accurately', () => {
    // Sousse to Tunis is roughly 115 km.
    const distance = haversineDistanceMeters(restaurant, { latitude: 36.8065, longitude: 10.1815 });
    expect(distance).toBeGreaterThan(110_000);
    expect(distance).toBeLessThan(125_000);
  });

  it('returns zero for the same point', () => {
    expect(haversineDistanceMeters(restaurant, restaurant)).toBe(0);
  });

  it('accepts a guest inside the radius', () => {
    const result = checkLocation({
      customer: { latitude: 35.8421, longitude: 10.6388 },
      restaurant,
      radiusMeters: 150,
    });
    expect(result.withinRadius).toBe(true);
  });

  it('rejects a guest far outside the radius', () => {
    const result = checkLocation({
      customer: { latitude: 36.8065, longitude: 10.1815 },
      restaurant,
      radiusMeters: 150,
    });
    expect(result.withinRadius).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(100_000);
  });

  it('widens the radius by the reported GPS accuracy', () => {
    const customer = { latitude: 35.8437, longitude: 10.6386 };
    const strict = checkLocation({ customer, restaurant, radiusMeters: 150 });
    const forgiving = checkLocation({ customer, restaurant, radiusMeters: 150, accuracyMeters: 120 });
    expect(strict.withinRadius).toBe(false);
    expect(forgiving.withinRadius).toBe(true);
  });

  it('caps how much slack a very poor reading can buy', () => {
    const result = checkLocation({
      customer: { latitude: 35.8419, longitude: 10.6386 },
      restaurant: { latitude: 35.9, longitude: 10.7 },
      radiusMeters: 150,
      accuracyMeters: 50_000,
      maxAccuracySlackMeters: 150,
    });
    expect(result.effectiveRadiusMeters).toBe(300);
    expect(result.withinRadius).toBe(false);
  });
});

/* -------------------------------------------------------- state machines */

describe('order state machine', () => {
  it('allows the normal path', () => {
    expect(canTransitionOrder('PENDING', 'ACCEPTED')).toBe(true);
    expect(canTransitionOrder('ACCEPTED', 'PREPARING')).toBe(true);
    expect(canTransitionOrder('PREPARING', 'READY')).toBe(true);
    expect(canTransitionOrder('READY', 'DELIVERED')).toBe(true);
    expect(canTransitionOrder('DELIVERED', 'COMPLETED')).toBe(true);
  });

  it('refuses skipping backwards or jumping ahead', () => {
    expect(canTransitionOrder('PENDING', 'COMPLETED')).toBe(false);
    expect(canTransitionOrder('READY', 'PREPARING')).toBe(false);
    expect(canTransitionOrder('PREPARING', 'PENDING')).toBe(false);
  });

  it('treats terminal states as final', () => {
    for (const terminal of ['COMPLETED', 'CANCELLED', 'REJECTED'] as const) {
      expect(canTransitionOrder(terminal, 'PREPARING')).toBe(false);
      expect(canTransitionOrder(terminal, 'COMPLETED')).toBe(false);
    }
  });

  it('never treats a no-op as a valid transition', () => {
    expect(canTransitionOrder('PREPARING', 'PREPARING')).toBe(false);
  });

  it('allows cancelling only before the food is out', () => {
    expect(canTransitionOrder('PENDING', 'CANCELLED')).toBe(true);
    expect(canTransitionOrder('PREPARING', 'CANCELLED')).toBe(true);
    expect(canTransitionOrder('DELIVERED', 'CANCELLED')).toBe(false);
  });
});

describe('session state machine', () => {
  it('only lets an ACTIVE session order', () => {
    expect(sessionCanOrder('ACTIVE')).toBe(true);
    for (const status of ['CREATED', 'LOCATION_PENDING', 'PAUSED', 'EXPIRED', 'CLOSED', 'BLOCKED'] as const) {
      expect(sessionCanOrder(status)).toBe(false);
    }
  });

  it('cannot reopen a closed session', () => {
    expect(canTransitionSession('CLOSED', 'ACTIVE')).toBe(false);
    expect(canTransitionSession('EXPIRED', 'ACTIVE')).toBe(false);
    expect(canTransitionSession('EXPIRED', 'CLOSED')).toBe(true);
  });
});

describe('service request and payment machines', () => {
  it('walks a request through its lifecycle', () => {
    expect(canTransitionServiceRequest('REQUESTED', 'ACKNOWLEDGED')).toBe(true);
    expect(canTransitionServiceRequest('ACKNOWLEDGED', 'COMPLETED')).toBe(true);
    expect(canTransitionServiceRequest('COMPLETED', 'REQUESTED')).toBe(false);
  });

  it('only refunds a completed payment', () => {
    expect(canTransitionPayment('PAID', 'REFUNDED')).toBe(true);
    expect(canTransitionPayment('PENDING', 'REFUNDED')).toBe(false);
    expect(canTransitionPayment('REFUNDED', 'PAID')).toBe(false);
  });
});

describe('derived table status', () => {
  const base = {
    hasActiveSession: false,
    hasOpenOrders: false,
    hasReadyOrders: false,
    billRequested: false,
    paymentPending: false,
    needsCleaning: false,
    outOfService: false,
  };

  it('is available with no session', () => {
    expect(deriveTableStatus(base)).toBe('AVAILABLE');
  });

  it('reports the most urgent state first', () => {
    expect(deriveTableStatus({ ...base, outOfService: true, hasActiveSession: true })).toBe('OUT_OF_SERVICE');
    expect(deriveTableStatus({ ...base, needsCleaning: true })).toBe('CLEANING');
    expect(
      deriveTableStatus({ ...base, hasActiveSession: true, paymentPending: true, billRequested: true }),
    ).toBe('PAYMENT_PENDING');
    expect(deriveTableStatus({ ...base, hasActiveSession: true, billRequested: true })).toBe('WAITING_FOR_BILL');
    expect(
      deriveTableStatus({ ...base, hasActiveSession: true, hasOpenOrders: true, hasReadyOrders: true }),
    ).toBe('FOOD_READY');
    expect(deriveTableStatus({ ...base, hasActiveSession: true, hasOpenOrders: true })).toBe('ORDERING');
    expect(deriveTableStatus({ ...base, hasActiveSession: true })).toBe('ACTIVE');
  });
});

/* ----------------------------------------------------------- permissions */

describe('RBAC', () => {
  it('gives the owner everything', () => {
    expect(can('OWNER', 'settings:manage')).toBe(true);
    expect(can('OWNER', 'audit:view')).toBe(true);
    expect(can('OWNER', 'employees:manage')).toBe(true);
  });

  it('keeps the kitchen out of money and menu editing', () => {
    expect(can('KITCHEN', 'kitchen:update')).toBe(true);
    expect(can('KITCHEN', 'menu:manage')).toBe(false);
    expect(can('KITCHEN', 'analytics:view')).toBe(false);
    expect(can('KITCHEN', 'billing:process')).toBe(false);
    expect(can('KITCHEN', 'employees:manage')).toBe(false);
  });

  it('lets a waiter run the floor but not the business', () => {
    expect(can('WAITER', 'requests:handle')).toBe(true);
    expect(can('WAITER', 'sessions:close')).toBe(true);
    expect(can('WAITER', 'menu:manage')).toBe(false);
    expect(can('WAITER', 'audit:view')).toBe(false);
  });

  it('limits inventory staff to stock', () => {
    expect(can('INVENTORY', 'inventory:manage')).toBe(true);
    expect(can('INVENTORY', 'employees:manage')).toBe(false);
    expect(can('INVENTORY', 'orders:view')).toBe(false);
  });

  it('never grants a permission that is not in the role list', () => {
    expect(permissionsForRole('CASHIER')).not.toContain('menu:manage');
    expect(permissionsForRole('MANAGER')).not.toContain('settings:manage');
  });

  it('stops privilege escalation', () => {
    expect(canAssignRole('OWNER', 'OWNER')).toBe(true);
    expect(canAssignRole('ADMIN', 'OWNER')).toBe(false);
    expect(canAssignRole('ADMIN', 'MANAGER')).toBe(true);
    expect(canAssignRole('MANAGER', 'WAITER')).toBe(false);
    expect(canAssignRole('WAITER', 'WAITER')).toBe(false);
  });

  it('treats an absent role as having nothing', () => {
    expect(can(null, 'orders:view')).toBe(false);
    expect(can(undefined, 'dashboard:view')).toBe(false);
  });
});

/* ------------------------------------------------------------- inventory */

describe('stock quantities', () => {
  it('normalises units onto a common base', () => {
    expect(toStockQuantity(1, 'kg')).toBe(toStockQuantity(1000, 'g'));
    expect(toStockQuantity(1, 'l')).toBe(toStockQuantity(1000, 'ml'));
    expect(fromStockQuantity(toStockQuantity(6.4, 'kg'), 'kg')).toBeCloseTo(6.4, 6);
  });

  it('classifies stock levels against the minimum', () => {
    expect(stockLevel(0, 5)).toBe('OUT_OF_STOCK');
    expect(stockLevel(-10, 5)).toBe('OUT_OF_STOCK');
    expect(stockLevel(5, 5)).toBe('LOW_STOCK');
    expect(stockLevel(6, 5)).toBe('OK');
    expect(stockLevel(1, 0)).toBe('OK');
  });

  it('signs movements by type', () => {
    expect(signedMovement('PURCHASE', 100)).toBe(100);
    expect(signedMovement('SALE', 100)).toBe(-100);
    expect(signedMovement('WASTE', 100)).toBe(-100);
    expect(signedMovement('RETURN', 100)).toBe(100);
    // An adjustment carries its own sign.
    expect(signedMovement('ADJUSTMENT', -40)).toBe(-40);
  });
});

describe('recipe consumption', () => {
  const recipes = new Map<string, RecipeIngredientLike[]>([
    [
      'burger',
      [
        { inventoryItemId: 'beef', quantity: 150, unit: 'g' },
        { inventoryItemId: 'bun', quantity: 1, unit: 'pcs' },
      ],
    ],
    ['pasta', [{ inventoryItemId: 'beef', quantity: 120, unit: 'g' }]],
  ]);

  it('multiplies each ingredient by the line quantity', () => {
    const result = computeConsumption({ recipes, lines: [{ productId: 'burger', quantity: 3 }] });
    const beef = result.find((r) => r.inventoryItemId === 'beef');
    expect(fromStockQuantity(beef!.scaledQuantity, 'g')).toBe(450);
  });

  it('aggregates the same ingredient across different products', () => {
    const result = computeConsumption({
      recipes,
      lines: [
        { productId: 'burger', quantity: 2 },
        { productId: 'pasta', quantity: 1 },
      ],
    });
    const beef = result.find((r) => r.inventoryItemId === 'beef');
    expect(fromStockQuantity(beef!.scaledQuantity, 'g')).toBe(420);
    expect(result).toHaveLength(2);
  });

  it('consumes nothing for a product without a recipe', () => {
    expect(computeConsumption({ recipes, lines: [{ productId: 'coffee', quantity: 5 }] })).toEqual([]);
  });
});

/* ------------------------------------------------------------------ time */

describe('opening hours', () => {
  const at = (day: number, hour: number, minute = 0) => {
    // 2026-01-04 is a Sunday, so adding `day` lands on that weekday.
    const date = new Date(2026, 0, 4 + day, hour, minute, 0, 0);
    return date;
  };

  const standard: OpeningHour[] = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    opensAt: '08:00',
    closesAt: '23:30',
    closed: false,
  }));

  it('is open inside the window and closed outside it', () => {
    expect(evaluateOpenState(standard, at(1, 12)).open).toBe(true);
    expect(evaluateOpenState(standard, at(1, 7)).open).toBe(false);
    expect(evaluateOpenState(standard, at(1, 23, 45)).open).toBe(false);
  });

  it('handles a window that runs past midnight', () => {
    const lateNight: OpeningHour[] = standard.map((h) => ({ ...h, opensAt: '18:00', closesAt: '02:00' }));
    expect(evaluateOpenState(lateNight, at(1, 20)).open).toBe(true);
    expect(evaluateOpenState(lateNight, at(2, 1)).open).toBe(true);
    expect(evaluateOpenState(lateNight, at(2, 12)).open).toBe(false);
  });

  it('honours a closed day', () => {
    const closedMonday = standard.map((h) => (h.dayOfWeek === 1 ? { ...h, closed: true } : h));
    expect(evaluateOpenState(closedMonday, at(1, 12)).open).toBe(false);
    expect(evaluateOpenState(closedMonday, at(2, 12)).open).toBe(true);
  });

  it('treats no configured hours as always open', () => {
    expect(evaluateOpenState([], at(1, 3)).open).toBe(true);
  });
});

describe('kitchen urgency', () => {
  it('escalates as the target approaches and passes', () => {
    const target = 20;
    expect(urgencyFor(5 * 60_000, target)).toBe('normal');
    expect(urgencyFor(16 * 60_000, target)).toBe('warning');
    expect(urgencyFor(25 * 60_000, target)).toBe('critical');
  });
});

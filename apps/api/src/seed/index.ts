import type { Prisma } from '@prisma/client';
import { priceOrder, toStockQuantity, type CartLineInput, type PricingProduct } from '@tableflow/shared';
import { env } from '../env.js';
import { generateQrToken, hashPassword } from '../lib/crypto.js';
// Reuse the application's Prisma client rather than opening a second one: the
// embedded PGlite server used by `npm run db:local` accepts one connection.
import { prisma } from '../lib/prisma.js';
import { recomputeTableStatus } from '../services/tables.js';
import { scanLowStock } from '../services/inventory.js';
import {
  BRANCHES,
  CATEGORIES,
  EMPLOYEES,
  INVENTORY,
  PRODUCTS,
  REVIEW_COMMENTS,
  STATIONS,
  SUPPLIERS,
  ZONES,
  type SeedModifierGroup,
} from './data.js';

/* Deterministic PRNG so every seed produces the same demo dataset. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20240517);

const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const chance = (p: number) => rand() < p;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function wipe() {
  // Ordered so foreign keys never block the delete.
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.review.deleteMany(),
    prisma.receipt.deleteMany(),
    prisma.orderItemModifier.deleteMany(),
    prisma.orderStatusEvent.deleteMany(),
    prisma.orderPromotion.deleteMany(),
    prisma.stockMovement.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.serviceRequest.deleteMany(),
    prisma.sessionDevice.deleteMany(),
    prisma.tableSession.deleteMany(),
    prisma.tableQrToken.deleteMany(),
    prisma.restaurantTable.deleteMany(),
    prisma.inventoryAlert.deleteMany(),
    prisma.recipeIngredient.deleteMany(),
    prisma.recipe.deleteMany(),
    prisma.inventoryItem.deleteMany(),
    prisma.supplier.deleteMany(),
    prisma.productModifierGroup.deleteMany(),
    prisma.modifierOption.deleteMany(),
    prisma.modifierGroup.deleteMany(),
    prisma.branchProductAvailability.deleteMany(),
    prisma.productVariant.deleteMany(),
    prisma.product.deleteMany(),
    prisma.menuCategory.deleteMany(),
    prisma.kitchenStation.deleteMany(),
    prisma.promotion.deleteMany(),
    prisma.counter.deleteMany(),
    prisma.membershipBranch.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.employeeProfile.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.idempotencyRecord.deleteMany(),
    prisma.branch.deleteMany(),
    prisma.user.deleteMany(),
    prisma.restaurant.deleteMany(),
  ]);
}

async function main() {
  const started = Date.now();

  // Bringing the stack up again must never destroy a live database, so seeding
  // only runs against an empty one unless it is explicitly forced.
  const existing = await prisma.restaurant.count();
  if (existing > 0 && process.env.FORCE_SEED !== 'true') {
    process.stdout.write(
      `· database already holds ${existing} restaurant(s) — skipping the seed.\n` +
        '  Run with FORCE_SEED=true (or `npm run db:reset`) to wipe and reseed.\n',
    );
    return;
  }

  process.stdout.write('· clearing existing data\n');
  await wipe();

  /* ------------------------------------------------------- restaurant */
  process.stdout.write('· restaurant, branches and stations\n');

  const restaurant = await prisma.restaurant.create({
    data: {
      name: 'Big Ben Café',
      slug: 'big-ben-cafe',
      legalName: 'Big Ben Restauration SARL',
      currency: 'TND',
      // Tunisian VAT on restaurant service; menu prices are shown tax-inclusive.
      taxRateBps: 1900,
      serviceChargeRateBps: 0,
      pricesIncludeTax: true,
      locale: 'en',
    },
  });

  type SeededBranch = Awaited<ReturnType<typeof prisma.branch.create>> & { tableCount: number };
  const branches: SeededBranch[] = [];
  for (const definition of BRANCHES) {
    const branch = await prisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        name: definition.name,
        slug: definition.slug,
        address: definition.address,
        phone: definition.phone,
        latitude: definition.latitude,
        longitude: definition.longitude,
        serviceRadiusMeters: definition.serviceRadiusMeters,
        requireLocation: true,
        allowStaffLocationOverride: true,
        sessionTtlMinutes: 180,
        maxActiveOrdersPerSession: 8,
        allowNegativeStock: false,
        deductStockOn: 'ORDER_CREATED',
        splitStationsEnabled: true,
        autoAcceptOrders: false,
        kitchenSlaMinutes: definition.kitchenSlaMinutes,
        timezone: 'Africa/Tunis',
        openingHours: definition.openingHours as unknown as Prisma.InputJsonValue,
      },
    });
    branches.push({ ...branch, tableCount: definition.tableCount });
  }

  const mainBranch = branches[0];

  const stationsByBranch = new Map<string, Map<string, string>>();
  for (const branch of branches) {
    const map = new Map<string, string>();
    for (const [index, station] of STATIONS.entries()) {
      const created = await prisma.kitchenStation.create({
        data: { branchId: branch.id, name: station.name, color: station.color, sortOrder: index },
      });
      map.set(station.name, created.id);
    }
    stationsByBranch.set(branch.id, map);
  }

  /* ------------------------------------------------------------- menu */
  process.stdout.write('· menu categories, products, variants and modifiers\n');

  const categoryIds = new Map<string, string>();
  for (const [index, category] of CATEGORIES.entries()) {
    const created = await prisma.menuCategory.create({
      data: {
        restaurantId: restaurant.id,
        name: category.name,
        slug: slugify(category.name),
        description: category.description,
        sortOrder: index,
      },
    });
    categoryIds.set(category.name, created.id);
  }

  async function createModifierGroup(group: SeedModifierGroup, sortOrder: number) {
    return prisma.modifierGroup.create({
      data: {
        restaurantId: restaurant.id,
        name: group.name,
        selectionType: group.selectionType,
        required: group.required ?? false,
        minSelect: group.minSelect ?? 0,
        maxSelect: group.maxSelect ?? null,
        sortOrder,
        options: {
          create: group.options.map((option, i) => ({
            name: option.name,
            priceDelta: option.priceDelta,
            available: option.available ?? true,
            sortOrder: i,
          })),
        },
      },
    });
  }

  const productIds = new Map<string, string>();
  for (const [index, definition] of PRODUCTS.entries()) {
    const categoryId = categoryIds.get(definition.category);
    if (!categoryId) throw new Error(`Unknown category ${definition.category}`);

    const product = await prisma.product.create({
      data: {
        restaurantId: restaurant.id,
        categoryId,
        name: definition.name,
        slug: slugify(definition.name),
        description: definition.description,
        basePrice: definition.basePrice,
        status: definition.status ?? 'AVAILABLE',
        featured: definition.featured ?? false,
        popular: definition.popular ?? false,
        prepTimeMinutes: definition.prepTimeMinutes,
        kitchenStationId: stationsByBranch.get(mainBranch.id)!.get(definition.station) ?? null,
        allergens: definition.allergens ?? [],
        tags: definition.tags ?? [],
        calories: definition.calories ?? null,
        sortOrder: index,
        variants: {
          create: (definition.variants ?? []).map((variant, i) => ({
            name: variant.name,
            priceDelta: variant.priceDelta,
            available: variant.available ?? true,
            sortOrder: i,
          })),
        },
      },
    });
    productIds.set(definition.name, product.id);

    for (const [groupIndex, group] of (definition.modifierGroups ?? []).entries()) {
      const created = await createModifierGroup(group, groupIndex);
      await prisma.productModifierGroup.create({
        data: { productId: product.id, groupId: created.id, sortOrder: groupIndex },
      });
    }
  }

  /* --------------------------------------------------------- employees */
  process.stdout.write('· employees\n');

  const passwordHash = await hashPassword(env.SEED_PASSWORD);
  const branchBySlug = new Map(branches.map((b) => [b.slug, b]));
  const users = new Map<string, string>();

  for (const employee of EMPLOYEES) {
    const user = await prisma.user.create({
      data: { email: employee.email, fullName: employee.fullName, passwordHash },
    });
    users.set(employee.email, user.id);

    await prisma.employeeProfile.create({
      data: {
        userId: user.id,
        restaurantId: restaurant.id,
        position: employee.position,
        hiredAt: new Date(Date.now() - randInt(60, 900) * 24 * 3600 * 1000),
        hourlyRateMinor: randInt(8, 22) * 1000,
      },
    });

    await prisma.membership.create({
      data: {
        userId: user.id,
        restaurantId: restaurant.id,
        role: employee.role,
        branches: {
          create: employee.branchSlugs
            .map((slug) => branchBySlug.get(slug))
            .filter((b): b is (typeof branches)[number] => Boolean(b))
            .map((b) => ({ branchId: b.id })),
        },
      },
    });
  }

  const staffIds = {
    owner: users.get('owner@tableflow.local')!,
    manager: users.get('manager@tableflow.local')!,
    waiter: users.get('waiter@tableflow.local')!,
    kitchen: users.get('kitchen@tableflow.local')!,
    cashier: users.get('cashier@tableflow.local')!,
    inventory: users.get('inventory@tableflow.local')!,
  };

  /* ------------------------------------------------------------ tables */
  process.stdout.write('· tables and QR codes\n');

  const tablesByBranch = new Map<string, Array<{ id: string; number: string }>>();
  for (const branch of branches) {
    const created: Array<{ id: string; number: string }> = [];
    for (let i = 1; i <= branch.tableCount; i += 1) {
      const number = String(i).padStart(2, '0');
      const zone = ZONES[Math.floor((i - 1) / 7) % ZONES.length];
      const column = (i - 1) % 6;
      const row = Math.floor((i - 1) / 6);

      const table = await prisma.restaurantTable.create({
        data: {
          branchId: branch.id,
          number,
          label: null,
          seats: i % 7 === 0 ? 6 : i % 3 === 0 ? 2 : 4,
          zone,
          posX: 12 + column * 15.5,
          posY: 14 + row * 15,
          shape: i % 7 === 0 ? 'RECT' : i % 3 === 0 ? 'SQUARE' : 'ROUND',
        },
      });

      await prisma.tableQrToken.create({ data: { tableId: table.id, token: generateQrToken() } });
      created.push({ id: table.id, number });
    }
    tablesByBranch.set(branch.id, created);
  }

  /* --------------------------------------------------------- inventory */
  process.stdout.write('· suppliers, inventory and recipes\n');

  // The catalogue is restaurant-wide; stock hangs off it per branch.
  const catalogue = new Map<string, { id: string; unit: (typeof INVENTORY)[number]['unit'] }>();
  for (const definition of INVENTORY) {
    const ingredient = await prisma.ingredient.create({
      data: {
        restaurantId: restaurant.id,
        name: definition.name,
        unit: definition.unit,
        category: definition.category,
      },
    });
    catalogue.set(definition.name, { id: ingredient.id, unit: definition.unit });
  }

  const inventoryByBranch = new Map<string, Map<string, { id: string; unit: string }>>();

  for (const branch of branches) {
    const supplierIds = new Map<string, string>();
    for (const supplier of SUPPLIERS) {
      const created = await prisma.supplier.create({
        data: {
          branchId: branch.id,
          name: supplier.name,
          contactName: supplier.contactName,
          phone: supplier.phone,
        },
      });
      supplierIds.set(supplier.name, created.id);
    }

    const items = new Map<string, { id: string; unit: string }>();
    for (const definition of INVENTORY) {
      // Branches differ a little so the dashboards do not look cloned.
      const factor = branch.id === mainBranch.id ? 1 : 0.7 + rand() * 0.7;
      const quantity = Math.round(definition.quantity * factor * 100) / 100;

      const item = await prisma.inventoryItem.create({
        data: {
          branchId: branch.id,
          ingredientId: catalogue.get(definition.name)!.id,
          name: definition.name,
          unit: definition.unit,
          quantity: toStockQuantity(quantity, definition.unit),
          minimumQuantity: toStockQuantity(definition.minimumQuantity, definition.unit),
          costPerUnit: definition.costPerUnit,
          category: definition.category,
          supplierId: supplierIds.get(definition.supplier) ?? null,
        },
      });
      items.set(definition.name, { id: item.id, unit: definition.unit });

      await prisma.stockMovement.create({
        data: {
          branchId: branch.id,
          inventoryItemId: item.id,
          type: 'ADJUSTMENT',
          quantity: item.quantity,
          unit: definition.unit,
          balanceAfter: item.quantity,
          reason: 'Opening balance',
          unitCost: definition.costPerUnit,
          userId: staffIds.inventory,
          createdAt: new Date(Date.now() - 31 * 24 * 3600 * 1000),
        },
      });
    }
    inventoryByBranch.set(branch.id, items);
  }

  // Recipes are written once for the restaurant against the catalogue; each
  // branch's own stock is resolved at order time.
  for (const definition of PRODUCTS) {
    if (!definition.recipe || definition.recipe.length === 0) continue;
    const productId = productIds.get(definition.name)!;

    const recipe = await prisma.recipe.create({ data: { productId, yieldQuantity: 1 } });
    for (const ingredient of definition.recipe) {
      const entry = catalogue.get(ingredient.item);
      if (!entry) throw new Error(`Unknown ingredient ${ingredient.item} for ${definition.name}`);
      await prisma.recipeIngredient.create({
        data: {
          recipeId: recipe.id,
          ingredientId: entry.id,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
        },
      });
    }
  }

  /* -------------------------------------------------------- promotions */
  process.stdout.write('· promotions\n');

  await prisma.promotion.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Happy Hour',
      description: '20% off every drink between 14:00 and 17:00.',
      type: 'PERCENTAGE',
      scope: 'CATEGORY',
      value: 20,
      categoryIds: [categoryIds.get('Drinks')!],
      daysOfWeek: [1, 2, 3, 4, 5],
      startMinuteOfDay: 14 * 60,
      endMinuteOfDay: 17 * 60,
      priority: 10,
      active: true,
    },
  });

  await prisma.promotion.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Big Spend — 5 TND off',
      description: '5.000 TND off any bill over 80.000 TND.',
      type: 'FIXED',
      scope: 'ORDER',
      value: 5000,
      minSubtotal: 80000,
      priority: 5,
      active: true,
    },
  });

  await prisma.promotion.create({
    data: {
      restaurantId: restaurant.id,
      branchId: mainBranch.id,
      name: 'Terrace Dessert Week',
      description: '15% off desserts — Sousse only.',
      type: 'PERCENTAGE',
      scope: 'CATEGORY',
      value: 15,
      categoryIds: [categoryIds.get('Desserts')!],
      startsAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
      endsAt: new Date(Date.now() + 11 * 24 * 3600 * 1000),
      priority: 8,
      active: false,
    },
  });

  /* ----------------------------------------------- pricing helper data */
  const pricingProducts: PricingProduct[] = (
    await prisma.product.findMany({
      where: { restaurantId: restaurant.id },
      include: {
        variants: true,
        modifierGroups: { include: { group: { include: { options: true } } } },
      },
    })
  ).map((product) => ({
    id: product.id,
    name: product.name,
    categoryId: product.categoryId,
    basePrice: product.basePrice,
    status: product.status as PricingProduct['status'],
    prepTimeMinutes: product.prepTimeMinutes,
    variants: product.variants.map((v) => ({
      id: v.id,
      name: v.name,
      priceDelta: v.priceDelta,
      available: v.available,
    })),
    modifierGroups: product.modifierGroups.map((link) => ({
      id: link.group.id,
      name: link.group.name,
      selectionType: link.group.selectionType,
      required: link.group.required,
      minSelect: link.group.minSelect,
      maxSelect: link.group.maxSelect,
      options: link.group.options.map((o) => ({
        id: o.id,
        name: o.name,
        priceDelta: o.priceDelta,
        available: o.available,
      })),
    })),
  }));

  const orderable = pricingProducts.filter((p) => p.status === 'AVAILABLE');
  const chargeSettings = {
    currency: restaurant.currency,
    taxRateBps: restaurant.taxRateBps,
    serviceChargeRateBps: restaurant.serviceChargeRateBps,
    pricesIncludeTax: restaurant.pricesIncludeTax,
  };

  function buildRandomCart(): CartLineInput[] {
    const lineCount = randInt(1, 4);
    const lines: CartLineInput[] = [];
    const used = new Set<string>();

    for (let i = 0; i < lineCount; i += 1) {
      const product = pick(orderable);
      if (used.has(product.id)) continue;
      used.add(product.id);

      const variant = product.variants.length > 0 ? pick(product.variants) : null;
      const modifierOptionIds: string[] = [];

      for (const group of product.modifierGroups) {
        const required = group.required || group.minSelect > 0;
        if (group.selectionType === 'SINGLE') {
          if (required || chance(0.4)) modifierOptionIds.push(pick(group.options).id);
        } else if (chance(0.45)) {
          const count = randInt(1, Math.min(2, group.maxSelect ?? group.options.length));
          for (let k = 0; k < count; k += 1) {
            const option = pick(group.options);
            if (!modifierOptionIds.includes(option.id)) modifierOptionIds.push(option.id);
          }
        }
      }

      lines.push({
        productId: product.id,
        variantId: variant?.id ?? null,
        quantity: randInt(1, 3),
        modifierOptionIds,
        notes: chance(0.12) ? pick(['No ice please', 'Please cut in half', 'Extra napkins', 'Very hot']) : null,
      });
    }

    return lines.length > 0 ? lines : [{ productId: orderable[0].id, quantity: 1, modifierOptionIds: [] }];
  }

  const counters = new Map<string, number>();
  async function nextOrderNumber(branchId: string): Promise<number> {
    const next = (counters.get(branchId) ?? 0) + 1;
    counters.set(branchId, next);
    return next;
  }

  const promotions = await prisma.promotion.findMany({ where: { restaurantId: restaurant.id } });
  const pricingPromotions = promotions.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    scope: p.scope,
    value: p.value,
    productIds: p.productIds,
    categoryIds: p.categoryIds,
    minSubtotal: p.minSubtotal,
    maxDiscount: p.maxDiscount,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    daysOfWeek: p.daysOfWeek,
    startMinuteOfDay: p.startMinuteOfDay,
    endMinuteOfDay: p.endMinuteOfDay,
    active: p.active,
    priority: p.priority,
  }));

  const stationByProduct = new Map<string, string | null>();
  for (const definition of PRODUCTS) {
    stationByProduct.set(
      productIds.get(definition.name)!,
      stationsByBranch.get(mainBranch.id)!.get(definition.station) ?? null,
    );
  }

  async function createHistoricOrder(params: {
    branchId: string;
    tableId: string;
    sessionId: string;
    placedAt: Date;
    cancelled?: boolean;
  }) {
    const lines = buildRandomCart();
    const priced = priceOrder({
      lines,
      products: pricingProducts,
      promotions: pricingPromotions,
      settings: chargeSettings,
      now: params.placedAt,
    });

    const number = await nextOrderNumber(params.branchId);
    const acceptedAt = new Date(params.placedAt.getTime() + randInt(20, 120) * 1000);
    const startedAt = new Date(acceptedAt.getTime() + randInt(30, 240) * 1000);
    const readyAt = new Date(startedAt.getTime() + randInt(5, 22) * 60 * 1000);
    const deliveredAt = new Date(readyAt.getTime() + randInt(40, 300) * 1000);
    const completedAt = new Date(deliveredAt.getTime() + randInt(60, 900) * 1000);

    const stationsForBranch = stationsByBranch.get(params.branchId)!;

    const order = await prisma.order.create({
      data: {
        number,
        branchId: params.branchId,
        tableId: params.tableId,
        sessionId: params.sessionId,
        channel: chance(0.85) ? 'CUSTOMER' : 'STAFF',
        status: params.cancelled ? 'CANCELLED' : 'COMPLETED',
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        taxTotal: priced.taxTotal,
        serviceChargeTotal: priced.serviceChargeTotal,
        total: priced.total,
        currency: priced.currency,
        estimatedPrepMinutes: priced.estimatedPrepMinutes,
        createdAt: params.placedAt,
        acceptedAt: params.cancelled ? null : acceptedAt,
        startedAt: params.cancelled ? null : startedAt,
        readyAt: params.cancelled ? null : readyAt,
        deliveredAt: params.cancelled ? null : deliveredAt,
        completedAt: params.cancelled ? null : completedAt,
        cancelledAt: params.cancelled ? acceptedAt : null,
        cancelReason: params.cancelled ? pick(['Guest changed their mind', 'Item unavailable', 'Duplicate order']) : null,
        items: {
          create: priced.lines.map((line) => {
            const definition = PRODUCTS.find((p) => productIds.get(p.name) === line.productId);
            return {
              productId: line.productId,
              variantId: line.variantId,
              categoryId: line.categoryId,
              kitchenStationId: definition ? (stationsForBranch.get(definition.station) ?? null) : null,
              productName: line.productName,
              variantName: line.variantName,
              unitBasePrice: line.unitBasePrice,
              modifiersPerUnit: line.modifiersPerUnit,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              lineSubtotal: line.lineSubtotal,
              lineDiscount: line.lineDiscount,
              lineTotal: line.lineTotal,
              notes: line.notes,
              prepTimeMinutes: line.prepTimeMinutes,
              status: params.cancelled ? 'CANCELLED' : 'SERVED',
              startedAt: params.cancelled ? null : startedAt,
              readyAt: params.cancelled ? null : readyAt,
              createdAt: params.placedAt,
              modifiers: {
                create: line.modifiers.map((m) => ({
                  modifierGroupId: m.groupId,
                  modifierOptionId: m.optionId,
                  groupName: m.groupName,
                  optionName: m.optionName,
                  priceDelta: m.priceDelta,
                })),
              },
            };
          }),
        },
        promotions: {
          create: priced.appliedPromotions.map((p) => ({
            promotionId: p.promotionId,
            name: p.name,
            amount: p.amount,
          })),
        },
        statusEvents: {
          create: params.cancelled
            ? [
                { toStatus: 'PENDING', actorType: 'CUSTOMER', createdAt: params.placedAt },
                { fromStatus: 'PENDING', toStatus: 'CANCELLED', actorType: 'STAFF', actorUserId: staffIds.manager, createdAt: acceptedAt },
              ]
            : [
                { toStatus: 'PENDING', actorType: 'CUSTOMER', createdAt: params.placedAt },
                { fromStatus: 'PENDING', toStatus: 'ACCEPTED', actorType: 'STAFF', actorUserId: staffIds.kitchen, createdAt: acceptedAt },
                { fromStatus: 'ACCEPTED', toStatus: 'PREPARING', actorType: 'STAFF', actorUserId: staffIds.kitchen, createdAt: startedAt },
                { fromStatus: 'PREPARING', toStatus: 'READY', actorType: 'STAFF', actorUserId: staffIds.kitchen, createdAt: readyAt },
                { fromStatus: 'READY', toStatus: 'DELIVERED', actorType: 'STAFF', actorUserId: staffIds.waiter, createdAt: deliveredAt },
                { fromStatus: 'DELIVERED', toStatus: 'COMPLETED', actorType: 'STAFF', actorUserId: staffIds.waiter, createdAt: completedAt },
              ],
        },
      },
    });

    return { order, priced, completedAt };
  }

  /* -------------------------------------------------- historic activity */
  process.stdout.write('· 30 days of order history (this takes a moment)\n');

  const inventoryConsumption = new Map<string, number>();
  const sessionSequences = new Map<string, number>();
  const nextSessionCode = (branchId: string) => {
    const next = (sessionSequences.get(branchId) ?? 0) + 1;
    sessionSequences.set(branchId, next);
    return `TS-${String(next).padStart(6, '0')}`;
  };

  for (let dayOffset = 30; dayOffset >= 1; dayOffset -= 1) {
    for (const branch of branches) {
      const tables = tablesByBranch.get(branch.id)!;
      const isWeekend = [5, 6].includes(new Date(Date.now() - dayOffset * 86400000).getDay());
      const weight = branch.id === mainBranch.id ? 1 : branch.slug === 'tunis' ? 0.8 : 0.6;
      const sessionCount = Math.round((isWeekend ? randInt(9, 16) : randInt(5, 11)) * weight);

      for (let s = 0; s < sessionCount; s += 1) {
        const table = pick(tables);
        // Skip table 03 of the main branch — it is reserved for the live demo.
        if (branch.id === mainBranch.id && table.number === '03') continue;

        const hour = chance(0.45) ? randInt(11, 14) : chance(0.7) ? randInt(18, 22) : randInt(8, 23);
        const startedAt = new Date(Date.now() - dayOffset * 86400000);
        startedAt.setHours(hour, randInt(0, 59), 0, 0);

        const durationMinutes = randInt(35, 110);
        const closedAt = new Date(startedAt.getTime() + durationMinutes * 60000);

        const sessionCode = nextSessionCode(branch.id);
        const session = await prisma.tableSession.create({
          data: {
            code: sessionCode,
            branchId: branch.id,
            tableId: table.id,
            status: 'CLOSED',
            verificationMethod: 'GPS',
            latitude: branch.latitude + (rand() - 0.5) * 0.0004,
            longitude: branch.longitude + (rand() - 0.5) * 0.0004,
            distanceMeters: randInt(4, 60),
            locationVerifiedAt: startedAt,
            guestCount: randInt(1, 5),
            startedAt,
            lastActivityAt: closedAt,
            expiresAt: new Date(closedAt.getTime() + 3600000),
            closedAt,
            closedById: staffIds.waiter,
          },
        });

        const ordersInSession = randInt(1, 3);
        let sessionTotal = 0;

        for (let o = 0; o < ordersInSession; o += 1) {
          const placedAt = new Date(startedAt.getTime() + o * randInt(12, 30) * 60000);
          if (placedAt > closedAt) break;

          const cancelled = chance(0.05);
          const { order, priced } = await createHistoricOrder({
            branchId: branch.id,
            tableId: table.id,
            sessionId: session.id,
            placedAt,
            cancelled,
          });
          if (!cancelled) sessionTotal += order.total;

          // Track ingredient usage so closing stock reflects the history.
          if (!cancelled && branch.id === mainBranch.id) {
            for (const line of priced.lines) {
              const definition = PRODUCTS.find((p) => productIds.get(p.name) === line.productId);
              for (const ingredient of definition?.recipe ?? []) {
                const scaled = toStockQuantity(ingredient.quantity, ingredient.unit) * line.quantity;
                inventoryConsumption.set(
                  ingredient.item,
                  (inventoryConsumption.get(ingredient.item) ?? 0) + scaled,
                );
              }
            }
          }
        }

        if (sessionTotal > 0) {
          const method = chance(0.5) ? 'CASH' : chance(0.6) ? 'CARD' : 'MOCK_ONLINE';
          const payment = await prisma.payment.create({
            data: {
              branchId: branch.id,
              sessionId: session.id,
              method,
              status: 'PAID',
              amount: sessionTotal,
              tip: chance(0.35) ? Math.round(sessionTotal * 0.05) : 0,
              currency: 'TND',
              reference: `SEED-${session.code}`,
              processedById: staffIds.cashier,
              processedAt: closedAt,
              createdAt: closedAt,
            },
          });
          await prisma.order.updateMany({
            where: { sessionId: session.id, status: 'COMPLETED' },
            data: { paymentId: payment.id },
          });
        }

        // Service requests, mostly answered quickly.
        if (chance(0.4)) {
          const type = pick(['WATER', 'NAPKINS', 'CALL_WAITER', 'CUTLERY', 'REQUEST_BILL'] as const);
          const createdAt = new Date(startedAt.getTime() + randInt(5, 60) * 60000);
          const responseSeconds = randInt(20, 420);
          const resolutionSeconds = responseSeconds + randInt(30, 600);
          await prisma.serviceRequest.create({
            data: {
              branchId: branch.id,
              tableId: table.id,
              sessionId: session.id,
              type,
              status: 'COMPLETED',
              createdAt,
              acknowledgedAt: new Date(createdAt.getTime() + responseSeconds * 1000),
              acknowledgedById: staffIds.waiter,
              completedAt: new Date(createdAt.getTime() + resolutionSeconds * 1000),
              completedById: staffIds.waiter,
              responseSeconds,
              resolutionSeconds,
            },
          });
        }

        // Reviews on roughly a third of visits.
        if (chance(0.32)) {
          const rating = chance(0.72) ? randInt(4, 5) : randInt(2, 4);
          await prisma.review.create({
            data: {
              restaurantId: restaurant.id,
              branchId: branch.id,
              sessionId: session.id,
              tableId: table.id,
              rating,
              foodRating: Math.min(5, Math.max(1, rating + (chance(0.3) ? -1 : 0))),
              serviceRating: Math.min(5, Math.max(1, rating + (chance(0.25) ? 1 : 0))),
              comment: pick(REVIEW_COMMENTS),
              createdAt: closedAt,
            },
          });
        }
      }
    }
  }

  /* -------------------------------------------- reconcile stock + waste */
  process.stdout.write('· stock movements and waste\n');

  for (const branch of branches) {
    const items = inventoryByBranch.get(branch.id)!;

    for (const [itemName, item] of items) {
      const consumed = branch.id === mainBranch.id ? (inventoryConsumption.get(itemName) ?? 0) : 0;
      if (consumed === 0) continue;

      // Purchases arrive across the month so the ledger tells a coherent story.
      const purchases = Math.ceil(consumed / 4);
      for (let i = 0; i < 4; i += 1) {
        const current = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
        const balanceAfter = current.quantity + purchases;
        await prisma.inventoryItem.update({ where: { id: item.id }, data: { quantity: balanceAfter } });
        await prisma.stockMovement.create({
          data: {
            branchId: branch.id,
            inventoryItemId: item.id,
            type: 'PURCHASE',
            quantity: purchases,
            unit: item.unit as never,
            balanceAfter,
            reason: 'Weekly delivery',
            unitCost: current.costPerUnit,
            totalCost: Math.round((purchases / 1000) * current.costPerUnit),
            userId: staffIds.inventory,
            createdAt: new Date(Date.now() - (28 - i * 7) * 86400000),
          },
        });
      }

      const current = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
      const balanceAfter = Math.max(0, current.quantity - consumed);
      await prisma.inventoryItem.update({ where: { id: item.id }, data: { quantity: balanceAfter } });
      await prisma.stockMovement.create({
        data: {
          branchId: branch.id,
          inventoryItemId: item.id,
          type: 'SALE',
          quantity: -consumed,
          unit: item.unit as never,
          balanceAfter,
          reason: 'Consumed by orders (30 days)',
          unitCost: current.costPerUnit,
          totalCost: Math.round((consumed / 1000) * current.costPerUnit),
          createdAt: new Date(Date.now() - 86400000),
        },
      });
    }

    // A realistic sprinkle of waste — capped so it never empties the larder,
    // which would leave the demo unable to sell anything.
    const wasteCandidates = ['Tomatoes', 'Lettuce', 'Beef mince', 'Milk', 'Mushrooms', 'Avocado', 'Cream'];
    for (let i = 0; i < 14; i += 1) {
      const itemName = pick(wasteCandidates);
      const item = items.get(itemName);
      if (!item) continue;

      const current = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
      const magnitude = Math.min(
        Math.floor(current.quantity * 0.05),
        toStockQuantity(randInt(1, 6) / 2, item.unit as never),
      );
      if (magnitude <= 0) continue;

      const balanceAfter = current.quantity - magnitude;
      await prisma.inventoryItem.update({ where: { id: item.id }, data: { quantity: balanceAfter } });
      await prisma.stockMovement.create({
        data: {
          branchId: branch.id,
          inventoryItemId: item.id,
          type: 'WASTE',
          quantity: -magnitude,
          unit: item.unit as never,
          balanceAfter,
          reason: 'Recorded during service',
          wasteReason: pick(['EXPIRED', 'BURNED', 'WRONG_PREPARATION', 'SPILLED', 'CUSTOMER_COMPLAINT', 'OTHER'] as const),
          unitCost: current.costPerUnit,
          totalCost: Math.round((magnitude / 1000) * current.costPerUnit),
          userId: chance(0.5) ? staffIds.kitchen : staffIds.inventory,
          createdAt: new Date(Date.now() - randInt(1, 29) * 86400000),
        },
      });
    }
  }

  /* ------------------------------------------------------ live activity */
  process.stdout.write('· live sessions for the demo\n');

  const mainTables = tablesByBranch.get(mainBranch.id)!;
  const liveTables = mainTables.filter((t) => !['03'].includes(t.number)).slice(0, 5);
  const liveStatuses = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED'] as const;

  for (const [index, table] of liveTables.entries()) {
    const startedAt = new Date(Date.now() - randInt(12, 70) * 60000);
    const session = await prisma.tableSession.create({
      data: {
        code: nextSessionCode(mainBranch.id),
        branchId: mainBranch.id,
        tableId: table.id,
        status: 'ACTIVE',
        verificationMethod: 'GPS',
        latitude: mainBranch.latitude,
        longitude: mainBranch.longitude,
        distanceMeters: randInt(3, 40),
        locationVerifiedAt: startedAt,
        guestCount: randInt(2, 5),
        customerName: pick(['Yasmine', 'Karim', 'Sofia', 'Anis', 'Leïla', null]),
        startedAt,
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + 150 * 60000),
        devices: {
          create: {
            deviceKey: `seed-device-${index}`,
            verifiedAt: startedAt,
            verificationMethod: 'GPS',
            latitude: mainBranch.latitude,
            longitude: mainBranch.longitude,
            distanceMeters: randInt(3, 40),
          },
        },
      },
    });

    const status = liveStatuses[index % liveStatuses.length];
    const placedAt = new Date(Date.now() - randInt(3, 30) * 60000);
    const lines = buildRandomCart();
    const priced = priceOrder({
      lines,
      products: pricingProducts,
      promotions: pricingPromotions,
      settings: chargeSettings,
      now: placedAt,
    });

    const number = await nextOrderNumber(mainBranch.id);
    const stationsForBranch = stationsByBranch.get(mainBranch.id)!;

    await prisma.order.create({
      data: {
        number,
        branchId: mainBranch.id,
        tableId: table.id,
        sessionId: session.id,
        channel: 'CUSTOMER',
        status,
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        taxTotal: priced.taxTotal,
        serviceChargeTotal: priced.serviceChargeTotal,
        total: priced.total,
        currency: priced.currency,
        estimatedPrepMinutes: priced.estimatedPrepMinutes,
        customerName: session.customerName,
        createdAt: placedAt,
        acceptedAt: status === 'PENDING' ? null : new Date(placedAt.getTime() + 60000),
        startedAt: ['PREPARING', 'READY', 'DELIVERED'].includes(status) ? new Date(placedAt.getTime() + 150000) : null,
        readyAt: ['READY', 'DELIVERED'].includes(status) ? new Date(placedAt.getTime() + 600000) : null,
        deliveredAt: status === 'DELIVERED' ? new Date(placedAt.getTime() + 780000) : null,
        items: {
          create: priced.lines.map((line) => {
            const definition = PRODUCTS.find((p) => productIds.get(p.name) === line.productId);
            return {
              productId: line.productId,
              variantId: line.variantId,
              categoryId: line.categoryId,
              kitchenStationId: definition ? (stationsForBranch.get(definition.station) ?? null) : null,
              productName: line.productName,
              variantName: line.variantName,
              unitBasePrice: line.unitBasePrice,
              modifiersPerUnit: line.modifiersPerUnit,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              lineSubtotal: line.lineSubtotal,
              lineDiscount: line.lineDiscount,
              lineTotal: line.lineTotal,
              notes: line.notes,
              prepTimeMinutes: line.prepTimeMinutes,
              status:
                status === 'PENDING' || status === 'ACCEPTED'
                  ? 'QUEUED'
                  : status === 'PREPARING'
                    ? 'PREPARING'
                    : status === 'READY'
                      ? 'READY'
                      : 'SERVED',
              createdAt: placedAt,
              modifiers: {
                create: line.modifiers.map((m) => ({
                  modifierGroupId: m.groupId,
                  modifierOptionId: m.optionId,
                  groupName: m.groupName,
                  optionName: m.optionName,
                  priceDelta: m.priceDelta,
                })),
              },
            };
          }),
        },
        promotions: {
          create: priced.appliedPromotions.map((p) => ({
            promotionId: p.promotionId,
            name: p.name,
            amount: p.amount,
          })),
        },
        statusEvents: { create: { toStatus: status, actorType: 'CUSTOMER', createdAt: placedAt } },
      },
    });

    // A couple of open service requests so the waiter board is not empty.
    if (index % 2 === 0) {
      await prisma.serviceRequest.create({
        data: {
          branchId: mainBranch.id,
          tableId: table.id,
          sessionId: session.id,
          type: index === 0 ? 'CALL_WAITER' : pick(['WATER', 'NAPKINS', 'CONDIMENTS'] as const),
          status: 'REQUESTED',
          createdAt: new Date(Date.now() - randInt(1, 8) * 60000),
        },
      });
    }
  }

  /* ---------------------------------------------------------- counters */
  for (const [branchId, value] of counters) {
    await prisma.counter.upsert({
      where: { branchId_name: { branchId, name: 'order' } },
      create: { branchId, name: 'order', value },
      update: { value },
    });
  }
  for (const branch of branches) {
    const value = sessionSequences.get(branch.id) ?? 0;
    await prisma.counter.upsert({
      where: { branchId_name: { branchId: branch.id, name: 'session' } },
      create: { branchId: branch.id, name: 'session', value },
      update: { value },
    });
  }

  /* ------------------------------------------------------------ alerts */
  process.stdout.write('· recomputing table statuses and stock alerts\n');

  for (const branch of branches) {
    for (const table of tablesByBranch.get(branch.id)!) {
      await prisma.$transaction((tx) => recomputeTableStatus(tx, table.id));
    }
  }

  await scanLowStock();

  /* ----------------------------------------------------------- summary */
  const [orderCount, tableCount, productCount, reviewCount, sessionCount] = await Promise.all([
    prisma.order.count(),
    prisma.restaurantTable.count(),
    prisma.product.count(),
    prisma.review.count(),
    prisma.tableSession.count(),
  ]);

  const demoTable = await prisma.restaurantTable.findFirstOrThrow({
    where: { branchId: mainBranch.id, number: '03' },
    include: { qrTokens: { where: { active: true }, take: 1 } },
  });

  process.stdout.write(
    [
      '',
      `✓ Seed complete in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      '',
      `  Restaurant    Big Ben Café (${branches.length} branches)`,
      `  Tables        ${tableCount}`,
      `  Menu          ${productCount} products across ${CATEGORIES.length} categories`,
      `  Sessions      ${sessionCount}`,
      `  Orders        ${orderCount}`,
      `  Reviews       ${reviewCount}`,
      '',
      '  Staff sign-in (password below applies to every account):',
      ...EMPLOYEES.map((e) => `    ${e.email.padEnd(36)} ${e.role}`),
      `    password: ${env.SEED_PASSWORD}`,
      '',
      '  Demo table 03 (Sousse):',
      `    ${env.WEB_URL}/t/${demoTable.qrTokens[0]?.token ?? '(missing token)'}`,
      '',
      `  QR Test Center: ${env.WEB_URL}/dev/qr`,
      '',
    ].join('\n'),
  );
}

main()
  .catch((error) => {
    process.stderr.write(`Seed failed: ${String(error?.stack ?? error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

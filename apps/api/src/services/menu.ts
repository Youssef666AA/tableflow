import type { ChargeSettings, PricingProduct, PricingPromotion } from '@tableflow/shared';
import { prisma, type Tx } from '../lib/prisma.js';

/**
 * A product is available at a branch when the restaurant-level status allows it
 * *and* the branch has not 86'd it locally. The branch override always wins.
 */
function effectiveStatus(
  productStatus: string,
  override?: { status: string } | null,
): 'AVAILABLE' | 'UNAVAILABLE' | 'HIDDEN' {
  if (productStatus === 'HIDDEN') return 'HIDDEN';
  if (override && override.status !== 'AVAILABLE') return override.status as 'UNAVAILABLE' | 'HIDDEN';
  return productStatus as 'AVAILABLE' | 'UNAVAILABLE';
}

const productInclude = {
  variants: { orderBy: { sortOrder: 'asc' } },
  modifierGroups: {
    orderBy: { sortOrder: 'asc' },
    include: {
      group: { include: { options: { orderBy: { sortOrder: 'asc' } } } },
    },
  },
  kitchenStation: { select: { id: true, name: true, color: true } },
} as const;

export interface MenuOptions {
  /** Admin views need hidden items; the customer menu never sees them. */
  includeHidden?: boolean;
  categoryId?: string;
  search?: string;
}

export async function getBranchMenu(branchId: string, options: MenuOptions = {}) {
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { id: true, restaurantId: true, splitStationsEnabled: true },
  });

  const [categories, products, overrides] = await Promise.all([
    prisma.menuCategory.findMany({
      where: { restaurantId: branch.restaurantId, ...(options.includeHidden ? {} : { active: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.product.findMany({
      where: {
        restaurantId: branch.restaurantId,
        archivedAt: null,
        ...(options.categoryId ? { categoryId: options.categoryId } : {}),
        ...(options.includeHidden ? {} : { status: { not: 'HIDDEN' } }),
        ...(options.search
          ? {
              OR: [
                { name: { contains: options.search, mode: 'insensitive' as const } },
                { description: { contains: options.search, mode: 'insensitive' as const } },
                { tags: { has: options.search.toLowerCase() } },
              ],
            }
          : {}),
      },
      include: productInclude,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
    prisma.branchProductAvailability.findMany({ where: { branchId } }),
  ]);

  const overrideByProduct = new Map(overrides.map((o) => [o.productId, o]));

  const shaped = products
    .map((product) => {
      const status = effectiveStatus(product.status, overrideByProduct.get(product.id));
      return {
        id: product.id,
        categoryId: product.categoryId,
        name: product.name,
        slug: product.slug,
        description: product.description,
        imageUrl: product.imageUrl,
        basePrice: product.basePrice,
        status,
        featured: product.featured,
        popular: product.popular,
        prepTimeMinutes: product.prepTimeMinutes,
        allergens: product.allergens,
        tags: product.tags,
        calories: product.calories,
        rating: product.rating,
        ratingCount: product.ratingCount,
        soldCount: product.soldCount,
        sortOrder: product.sortOrder,
        kitchenStation: product.kitchenStation,
        variants: product.variants.map((v) => ({
          id: v.id,
          name: v.name,
          priceDelta: v.priceDelta,
          available: v.available,
          sortOrder: v.sortOrder,
        })),
        modifierGroups: product.modifierGroups.map((link) => ({
          id: link.group.id,
          name: link.group.name,
          selectionType: link.group.selectionType,
          required: link.group.required,
          minSelect: link.group.minSelect,
          maxSelect: link.group.maxSelect,
          sortOrder: link.sortOrder,
          options: link.group.options.map((o) => ({
            id: o.id,
            name: o.name,
            priceDelta: o.priceDelta,
            available: o.available,
            sortOrder: o.sortOrder,
          })),
        })),
      };
    })
    .filter((p) => options.includeHidden || p.status !== 'HIDDEN');

  const usedCategoryIds = new Set(shaped.map((p) => p.categoryId));

  return {
    branchId,
    categories: categories
      .filter((c) => options.includeHidden || usedCategoryIds.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        imageUrl: c.imageUrl,
        sortOrder: c.sortOrder,
        active: c.active,
        productCount: shaped.filter((p) => p.categoryId === c.id).length,
      })),
    products: shaped,
  };
}

/**
 * Loads the authoritative pricing view of a set of products, with branch
 * availability applied. Everything the pricing engine sees comes from here —
 * never from the request body.
 */
export async function loadPricingProducts(
  tx: Tx,
  branchId: string,
  productIds: string[],
): Promise<PricingProduct[]> {
  if (productIds.length === 0) return [];

  const branch = await tx.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { restaurantId: true },
  });

  const [products, overrides] = await Promise.all([
    tx.product.findMany({
      where: { id: { in: productIds }, restaurantId: branch.restaurantId, archivedAt: null },
      include: productInclude,
    }),
    tx.branchProductAvailability.findMany({ where: { branchId, productId: { in: productIds } } }),
  ]);

  const overrideByProduct = new Map(overrides.map((o) => [o.productId, o]));

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    categoryId: product.categoryId,
    basePrice: product.basePrice,
    status: effectiveStatus(product.status, overrideByProduct.get(product.id)),
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
}

export async function loadActivePromotions(
  tx: Tx,
  restaurantId: string,
  branchId: string,
): Promise<PricingPromotion[]> {
  const rows = await tx.promotion.findMany({
    where: {
      restaurantId,
      active: true,
      OR: [{ branchId: null }, { branchId }],
    },
    orderBy: { priority: 'desc' },
  });

  return rows.map((p) => ({
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
}

export async function loadChargeSettings(tx: Tx, restaurantId: string): Promise<ChargeSettings> {
  const restaurant = await tx.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: {
      currency: true,
      taxRateBps: true,
      serviceChargeRateBps: true,
      pricesIncludeTax: true,
    },
  });
  return {
    currency: restaurant.currency,
    taxRateBps: restaurant.taxRateBps,
    serviceChargeRateBps: restaurant.serviceChargeRateBps,
    pricesIncludeTax: restaurant.pricesIncludeTax,
  };
}

/** Resolves which kitchen station each product should be routed to at this branch. */
export async function resolveStations(
  tx: Tx,
  branchId: string,
  productIds: string[],
): Promise<Map<string, string | null>> {
  const branch = await tx.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { splitStationsEnabled: true },
  });

  const map = new Map<string, string | null>();
  if (!branch.splitStationsEnabled || productIds.length === 0) {
    productIds.forEach((id) => map.set(id, null));
    return map;
  }

  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, kitchenStationId: true, kitchenStation: { select: { branchId: true } } },
  });

  for (const product of products) {
    // A station only applies if it belongs to the branch taking the order.
    const stationId =
      product.kitchenStationId && product.kitchenStation?.branchId === branchId
        ? product.kitchenStationId
        : null;
    map.set(product.id, stationId);
  }
  return map;
}

import { Prisma } from '@prisma/client';
import { fromStockQuantity } from '@tableflow/shared';
import { prisma } from '../lib/prisma.js';

/**
 * Every figure below is computed from stored records — orders, order items,
 * stock movements, sessions, service requests. Nothing is precomputed, cached or
 * invented.
 */

/** Orders that count towards revenue: anything that was not cancelled or rejected. */
const REVENUE_STATUSES = Prisma.sql`('PENDING','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY_TO_TABLE','DELIVERED','COMPLETED')`;

export interface RangeInput {
  branchIds: string[];
  from: Date;
  to: Date;
}

function branchFilter(branchIds: string[]) {
  return Prisma.sql`o."branchId" IN (${Prisma.join(branchIds)})`;
}

function periodBefore(from: Date, to: Date): { from: Date; to: Date } {
  const span = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - span), to: new Date(from.getTime() - 1) };
}

function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

async function coreTotals(branchIds: string[], from: Date, to: Date) {
  const rows = await prisma.$queryRaw<
    Array<{ revenue: bigint | null; orders: bigint; guests: bigint | null; cancelled: bigint }>
  >`
    SELECT
      COALESCE(SUM(CASE WHEN o."status"::text IN ${REVENUE_STATUSES} THEN o."total" ELSE 0 END), 0) AS revenue,
      COUNT(*) FILTER (WHERE o."status"::text IN ${REVENUE_STATUSES}) AS orders,
      COUNT(DISTINCT o."sessionId") AS guests,
      COUNT(*) FILTER (WHERE o."status" IN ('CANCELLED','REJECTED')) AS cancelled
    FROM "Order" o
    WHERE ${branchFilter(branchIds)} AND o."createdAt" BETWEEN ${from} AND ${to}
  `;
  const row = rows[0];
  const revenue = Number(row?.revenue ?? 0);
  const orders = Number(row?.orders ?? 0);
  return {
    revenue,
    orders,
    sessions: Number(row?.guests ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
    averageOrderValue: orders > 0 ? Math.round(revenue / orders) : 0,
  };
}

export async function getOverview(input: RangeInput) {
  const { branchIds, from, to } = input;
  if (branchIds.length === 0) {
    throw new Error('At least one branch is required');
  }

  const previous = periodBefore(from, to);

  const [current, prior, prep, activeTables, pendingRequests, openOrders, lowStock] = await Promise.all([
    coreTotals(branchIds, from, to),
    coreTotals(branchIds, previous.from, previous.to),
    prisma.$queryRaw<Array<{ avg_minutes: number | null; late: bigint; total: bigint }>>`
      SELECT
        AVG(EXTRACT(EPOCH FROM (o."readyAt" - o."createdAt")) / 60) AS avg_minutes,
        COUNT(*) FILTER (
          WHERE EXTRACT(EPOCH FROM (o."readyAt" - o."createdAt")) / 60 > b."kitchenSlaMinutes"
        ) AS late,
        COUNT(*) AS total
      FROM "Order" o
      JOIN "Branch" b ON b."id" = o."branchId"
      WHERE ${branchFilter(branchIds)}
        AND o."readyAt" IS NOT NULL
        AND o."createdAt" BETWEEN ${from} AND ${to}
    `,
    prisma.restaurantTable.count({
      where: { branchId: { in: branchIds }, status: { notIn: ['AVAILABLE', 'OUT_OF_SERVICE'] } },
    }),
    prisma.serviceRequest.count({
      where: { branchId: { in: branchIds }, status: { in: ['REQUESTED', 'ACKNOWLEDGED', 'IN_PROGRESS'] } },
    }),
    prisma.order.count({
      where: {
        branchId: { in: branchIds },
        status: { in: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY_TO_TABLE'] },
      },
    }),
    prisma.inventoryAlert.count({ where: { branchId: { in: branchIds }, resolvedAt: null } }),
  ]);

  const totalTables = await prisma.restaurantTable.count({
    where: { branchId: { in: branchIds }, outOfService: false },
  });

  const prepRow = prep[0];
  const prepTotal = Number(prepRow?.total ?? 0);

  return {
    range: { from, to },
    revenue: { value: current.revenue, changePercent: delta(current.revenue, prior.revenue) },
    orders: { value: current.orders, changePercent: delta(current.orders, prior.orders) },
    averageOrderValue: {
      value: current.averageOrderValue,
      changePercent: delta(current.averageOrderValue, prior.averageOrderValue),
    },
    sessions: { value: current.sessions, changePercent: delta(current.sessions, prior.sessions) },
    cancellationRate: {
      value:
        current.orders + current.cancelled > 0
          ? Math.round((current.cancelled / (current.orders + current.cancelled)) * 1000) / 10
          : 0,
    },
    averagePrepMinutes: {
      value: prepRow?.avg_minutes != null ? Math.round(Number(prepRow.avg_minutes) * 10) / 10 : null,
    },
    lateOrderRate: {
      value: prepTotal > 0 ? Math.round((Number(prepRow?.late ?? 0) / prepTotal) * 1000) / 10 : 0,
    },
    activeTables: { value: activeTables, of: totalTables },
    pendingServiceRequests: { value: pendingRequests },
    openOrders: { value: openOrders },
    stockAlerts: { value: lowStock },
  };
}

export async function getSalesSeries(input: RangeInput & { granularity?: 'hour' | 'day' }) {
  const granularity =
    input.granularity ?? (input.to.getTime() - input.from.getTime() <= 36 * 3600 * 1000 ? 'hour' : 'day');
  const bucket = granularity === 'hour' ? Prisma.sql`'hour'` : Prisma.sql`'day'`;

  const rows = await prisma.$queryRaw<Array<{ bucket: Date; revenue: bigint; orders: bigint }>>`
    SELECT
      date_trunc(${bucket}, o."createdAt") AS bucket,
      COALESCE(SUM(o."total"), 0) AS revenue,
      COUNT(*) AS orders
    FROM "Order" o
    WHERE ${branchFilter(input.branchIds)}
      AND o."createdAt" BETWEEN ${input.from} AND ${input.to}
      AND o."status"::text IN ${REVENUE_STATUSES}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const resultMap = new Map<number, { revenue: number; orders: number }>();
  for (const r of rows) {
    resultMap.set(new Date(r.bucket).getTime(), {
      revenue: Number(r.revenue),
      orders: Number(r.orders),
    });
  }

  const stepMs = granularity === 'hour' ? 3600 * 1000 : 24 * 3600 * 1000;
  const cursor = new Date(input.from);
  if (granularity === 'hour') {
    cursor.setMinutes(0, 0, 0);
  } else {
    cursor.setHours(0, 0, 0, 0);
  }

  const points: Array<{ bucket: Date; revenue: number; orders: number }> = [];
  const endMs = input.to.getTime();
  while (cursor.getTime() <= endMs) {
    const timeKey = cursor.getTime();
    let found = resultMap.get(timeKey);
    if (!found) {
      for (const [key, val] of resultMap.entries()) {
        if (Math.abs(key - timeKey) < stepMs / 2) {
          found = val;
          break;
        }
      }
    }

    points.push({
      bucket: new Date(cursor),
      revenue: found?.revenue ?? 0,
      orders: found?.orders ?? 0,
    });

    cursor.setTime(cursor.getTime() + stepMs);
  }

  return {
    granularity,
    points: points.length >= 2 ? points : rows.map((r) => ({
      bucket: r.bucket,
      revenue: Number(r.revenue),
      orders: Number(r.orders),
    })),
  };
}

export async function getOrdersByHour(input: RangeInput) {
  const rows = await prisma.$queryRaw<Array<{ hour: number; orders: bigint; revenue: bigint }>>`
    SELECT
      EXTRACT(HOUR FROM o."createdAt")::int AS hour,
      COUNT(*) AS orders,
      COALESCE(SUM(o."total"), 0) AS revenue
    FROM "Order" o
    WHERE ${branchFilter(input.branchIds)}
      AND o."createdAt" BETWEEN ${input.from} AND ${input.to}
      AND o."status"::text IN ${REVENUE_STATUSES}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  const byHour = new Map(rows.map((r) => [r.hour, r]));
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    orders: Number(byHour.get(hour)?.orders ?? 0),
    revenue: Number(byHour.get(hour)?.revenue ?? 0),
  }));
}

export async function getProductPerformance(input: RangeInput & { limit?: number }) {
  const limit = input.limit ?? 10;

  const rows = await prisma.$queryRaw<
    Array<{ productId: string | null; name: string; quantity: bigint; revenue: bigint; orders: bigint }>
  >`
    SELECT
      i."productId" AS "productId",
      i."productName" AS name,
      SUM(i."quantity") AS quantity,
      SUM(i."lineTotal") AS revenue,
      COUNT(DISTINCT i."orderId") AS orders
    FROM "OrderItem" i
    JOIN "Order" o ON o."id" = i."orderId"
    WHERE ${branchFilter(input.branchIds)}
      AND o."createdAt" BETWEEN ${input.from} AND ${input.to}
      AND o."status"::text IN ${REVENUE_STATUSES}
    GROUP BY 1, 2
    ORDER BY revenue DESC
  `;

  const shaped = rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    quantity: Number(r.quantity),
    revenue: Number(r.revenue),
    orders: Number(r.orders),
  }));

  return {
    best: shaped.slice(0, limit),
    worst: [...shaped].reverse().slice(0, limit),
  };
}

export async function getCategoryRevenue(input: RangeInput) {
  const rows = await prisma.$queryRaw<Array<{ categoryId: string | null; name: string | null; revenue: bigint; quantity: bigint }>>`
    SELECT
      i."categoryId" AS "categoryId",
      c."name" AS name,
      SUM(i."lineTotal") AS revenue,
      SUM(i."quantity") AS quantity
    FROM "OrderItem" i
    JOIN "Order" o ON o."id" = i."orderId"
    LEFT JOIN "MenuCategory" c ON c."id" = i."categoryId"
    WHERE ${branchFilter(input.branchIds)}
      AND o."createdAt" BETWEEN ${input.from} AND ${input.to}
      AND o."status"::text IN ${REVENUE_STATUSES}
    GROUP BY 1, 2
    ORDER BY revenue DESC
  `;

  return rows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name ?? 'Uncategorised',
    revenue: Number(r.revenue),
    quantity: Number(r.quantity),
  }));
}

export async function getKitchenPerformance(input: RangeInput) {
  const [summary, byStation] = await Promise.all([
    prisma.$queryRaw<
      Array<{ avg_to_ready: number | null; avg_cook: number | null; late: bigint; total: bigint; avg_to_delivered: number | null }>
    >`
      SELECT
        AVG(EXTRACT(EPOCH FROM (o."readyAt" - o."createdAt")) / 60) AS avg_to_ready,
        AVG(EXTRACT(EPOCH FROM (o."readyAt" - o."startedAt")) / 60) AS avg_cook,
        AVG(EXTRACT(EPOCH FROM (o."deliveredAt" - o."createdAt")) / 60) AS avg_to_delivered,
        COUNT(*) FILTER (
          WHERE EXTRACT(EPOCH FROM (o."readyAt" - o."createdAt")) / 60 > b."kitchenSlaMinutes"
        ) AS late,
        COUNT(*) AS total
      FROM "Order" o
      JOIN "Branch" b ON b."id" = o."branchId"
      WHERE ${branchFilter(input.branchIds)}
        AND o."readyAt" IS NOT NULL
        AND o."createdAt" BETWEEN ${input.from} AND ${input.to}
    `,
    prisma.$queryRaw<Array<{ station: string | null; items: bigint; avg_minutes: number | null }>>`
      SELECT
        s."name" AS station,
        COUNT(*) AS items,
        AVG(EXTRACT(EPOCH FROM (i."readyAt" - i."startedAt")) / 60) AS avg_minutes
      FROM "OrderItem" i
      JOIN "Order" o ON o."id" = i."orderId"
      LEFT JOIN "KitchenStation" s ON s."id" = i."kitchenStationId"
      WHERE ${branchFilter(input.branchIds)}
        AND i."readyAt" IS NOT NULL
        AND o."createdAt" BETWEEN ${input.from} AND ${input.to}
      GROUP BY 1
      ORDER BY items DESC
    `,
  ]);

  const row = summary[0];
  const total = Number(row?.total ?? 0);

  return {
    averageMinutesToReady: row?.avg_to_ready != null ? Math.round(Number(row.avg_to_ready) * 10) / 10 : null,
    averageCookMinutes: row?.avg_cook != null ? Math.round(Number(row.avg_cook) * 10) / 10 : null,
    averageMinutesToDelivered:
      row?.avg_to_delivered != null ? Math.round(Number(row.avg_to_delivered) * 10) / 10 : null,
    lateOrders: Number(row?.late ?? 0),
    totalOrders: total,
    lateRate: total > 0 ? Math.round((Number(row?.late ?? 0) / total) * 1000) / 10 : 0,
    stations: byStation.map((s) => ({
      station: s.station ?? 'Unassigned',
      items: Number(s.items),
      averageMinutes: s.avg_minutes != null ? Math.round(Number(s.avg_minutes) * 10) / 10 : null,
    })),
  };
}

export async function getTableAnalytics(input: RangeInput) {
  const rows = await prisma.$queryRaw<
    Array<{
      tableId: string;
      number: string;
      orders: bigint;
      revenue: bigint;
      sessions: bigint;
      avg_session_minutes: number | null;
    }>
  >`
    SELECT
      t."id" AS "tableId",
      t."number" AS number,
      COUNT(o."id") FILTER (WHERE o."status"::text IN ${REVENUE_STATUSES}) AS orders,
      COALESCE(SUM(o."total") FILTER (WHERE o."status"::text IN ${REVENUE_STATUSES}), 0) AS revenue,
      COUNT(DISTINCT o."sessionId") AS sessions,
      AVG(
        EXTRACT(EPOCH FROM (COALESCE(s."closedAt", s."lastActivityAt") - s."startedAt")) / 60
      ) AS avg_session_minutes
    FROM "RestaurantTable" t
    LEFT JOIN "Order" o
      ON o."tableId" = t."id" AND o."createdAt" BETWEEN ${input.from} AND ${input.to}
    LEFT JOIN "TableSession" s
      ON s."id" = o."sessionId"
    WHERE t."branchId" IN (${Prisma.join(input.branchIds)})
    GROUP BY 1, 2
    ORDER BY revenue DESC
  `;

  return rows.map((r) => {
    const orders = Number(r.orders);
    const sessions = Number(r.sessions);
    const revenue = Number(r.revenue);
    return {
      tableId: r.tableId,
      number: r.number,
      orders,
      revenue,
      sessions,
      averageOrderValue: orders > 0 ? Math.round(revenue / orders) : 0,
      averageSessionMinutes:
        r.avg_session_minutes != null ? Math.round(Number(r.avg_session_minutes)) : null,
      ordersPerSession: sessions > 0 ? Math.round((orders / sessions) * 100) / 100 : 0,
    };
  });
}

export async function getServiceResponse(input: RangeInput) {
  const rows = await prisma.$queryRaw<
    Array<{ type: string; count: bigint; avg_response: number | null; avg_resolution: number | null }>
  >`
    SELECT
      r."type"::text AS type,
      COUNT(*) AS count,
      AVG(r."responseSeconds") AS avg_response,
      AVG(r."resolutionSeconds") AS avg_resolution
    FROM "ServiceRequest" r
    WHERE r."branchId" IN (${Prisma.join(input.branchIds)})
      AND r."createdAt" BETWEEN ${input.from} AND ${input.to}
    GROUP BY 1
    ORDER BY count DESC
  `;

  const totals = rows.reduce(
    (acc, r) => {
      const count = Number(r.count);
      return {
        count: acc.count + count,
        responseSum: acc.responseSum + (r.avg_response != null ? Number(r.avg_response) * count : 0),
        responseCount: acc.responseCount + (r.avg_response != null ? count : 0),
      };
    },
    { count: 0, responseSum: 0, responseCount: 0 },
  );

  return {
    total: totals.count,
    averageResponseSeconds:
      totals.responseCount > 0 ? Math.round(totals.responseSum / totals.responseCount) : null,
    byType: rows.map((r) => ({
      type: r.type,
      count: Number(r.count),
      averageResponseSeconds: r.avg_response != null ? Math.round(Number(r.avg_response)) : null,
      averageResolutionSeconds: r.avg_resolution != null ? Math.round(Number(r.avg_resolution)) : null,
    })),
  };
}

export async function getWasteAnalytics(input: RangeInput) {
  const [byReason, series, items] = await Promise.all([
    prisma.$queryRaw<Array<{ reason: string | null; cost: bigint; movements: bigint }>>`
      SELECT
        m."wasteReason"::text AS reason,
        COALESCE(SUM(m."totalCost"), 0) AS cost,
        COUNT(*) AS movements
      FROM "StockMovement" m
      WHERE m."branchId" IN (${Prisma.join(input.branchIds)})
        AND m."type" = 'WASTE'
        AND m."createdAt" BETWEEN ${input.from} AND ${input.to}
      GROUP BY 1
      ORDER BY cost DESC
    `,
    prisma.$queryRaw<Array<{ bucket: Date; cost: bigint }>>`
      SELECT date_trunc('day', m."createdAt") AS bucket, COALESCE(SUM(m."totalCost"), 0) AS cost
      FROM "StockMovement" m
      WHERE m."branchId" IN (${Prisma.join(input.branchIds)})
        AND m."type" = 'WASTE'
        AND m."createdAt" BETWEEN ${input.from} AND ${input.to}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.$queryRaw<Array<{ name: string; unit: string; quantity: bigint; cost: bigint }>>`
      SELECT
        ii."name" AS name,
        ii."unit"::text AS unit,
        COALESCE(SUM(ABS(m."quantity")), 0) AS quantity,
        COALESCE(SUM(m."totalCost"), 0) AS cost
      FROM "StockMovement" m
      JOIN "InventoryItem" ii ON ii."id" = m."inventoryItemId"
      WHERE m."branchId" IN (${Prisma.join(input.branchIds)})
        AND m."type" = 'WASTE'
        AND m."createdAt" BETWEEN ${input.from} AND ${input.to}
      GROUP BY 1, 2
      ORDER BY cost DESC
      LIMIT 10
    `,
  ]);

  return {
    totalCost: byReason.reduce((sum, r) => sum + Number(r.cost), 0),
    byReason: byReason.map((r) => ({
      reason: r.reason ?? 'UNSPECIFIED',
      cost: Number(r.cost),
      movements: Number(r.movements),
    })),
    trend: series.map((r) => ({ bucket: r.bucket, cost: Number(r.cost) })),
    topItems: items.map((r) => ({
      name: r.name,
      unit: r.unit,
      quantity: Math.round(fromStockQuantity(Number(r.quantity), r.unit as never) * 100) / 100,
      cost: Number(r.cost),
    })),
  };
}

export async function getInventoryConsumption(input: RangeInput) {
  const rows = await prisma.$queryRaw<Array<{ name: string; unit: string; quantity: bigint; cost: bigint }>>`
    SELECT
      ii."name" AS name,
      ii."unit"::text AS unit,
      COALESCE(SUM(ABS(m."quantity")), 0) AS quantity,
      COALESCE(SUM(m."totalCost"), 0) AS cost
    FROM "StockMovement" m
    JOIN "InventoryItem" ii ON ii."id" = m."inventoryItemId"
    WHERE m."branchId" IN (${Prisma.join(input.branchIds)})
      AND m."type" = 'SALE'
      AND m."createdAt" BETWEEN ${input.from} AND ${input.to}
    GROUP BY 1, 2
    ORDER BY quantity DESC
    LIMIT 20
  `;

  return rows.map((r) => ({
    name: r.name,
    unit: r.unit,
    quantity: Math.round(fromStockQuantity(Number(r.quantity), r.unit as never) * 100) / 100,
    cost: Number(r.cost),
  }));
}

export async function getBranchComparison(input: RangeInput) {
  const rows = await prisma.$queryRaw<Array<{ branchId: string; name: string; revenue: bigint; orders: bigint }>>`
    SELECT
      b."id" AS "branchId",
      b."name" AS name,
      COALESCE(SUM(o."total") FILTER (WHERE o."status"::text IN ${REVENUE_STATUSES}), 0) AS revenue,
      COUNT(o."id") FILTER (WHERE o."status"::text IN ${REVENUE_STATUSES}) AS orders
    FROM "Branch" b
    LEFT JOIN "Order" o ON o."branchId" = b."id" AND o."createdAt" BETWEEN ${input.from} AND ${input.to}
    WHERE b."id" IN (${Prisma.join(input.branchIds)})
    GROUP BY 1, 2
    ORDER BY revenue DESC
  `;

  return rows.map((r) => {
    const revenue = Number(r.revenue);
    const orders = Number(r.orders);
    return {
      branchId: r.branchId,
      name: r.name,
      revenue,
      orders,
      averageOrderValue: orders > 0 ? Math.round(revenue / orders) : 0,
    };
  });
}

export async function getReviewSummary(input: RangeInput) {
  const rows = await prisma.$queryRaw<
    Array<{ avg_rating: number | null; count: bigint; avg_food: number | null; avg_service: number | null }>
  >`
    SELECT
      AVG(r."rating") AS avg_rating,
      COUNT(*) AS count,
      AVG(r."foodRating") AS avg_food,
      AVG(r."serviceRating") AS avg_service
    FROM "Review" r
    WHERE r."branchId" IN (${Prisma.join(input.branchIds)})
      AND r."createdAt" BETWEEN ${input.from} AND ${input.to}
  `;

  const distribution = await prisma.$queryRaw<Array<{ rating: number; count: bigint }>>`
    SELECT r."rating" AS rating, COUNT(*) AS count
    FROM "Review" r
    WHERE r."branchId" IN (${Prisma.join(input.branchIds)})
      AND r."createdAt" BETWEEN ${input.from} AND ${input.to}
    GROUP BY 1
    ORDER BY 1 DESC
  `;

  const row = rows[0];
  return {
    averageRating: row?.avg_rating != null ? Math.round(Number(row.avg_rating) * 10) / 10 : null,
    count: Number(row?.count ?? 0),
    averageFood: row?.avg_food != null ? Math.round(Number(row.avg_food) * 10) / 10 : null,
    averageService: row?.avg_service != null ? Math.round(Number(row.avg_service) * 10) / 10 : null,
    distribution: [5, 4, 3, 2, 1].map((rating) => ({
      rating,
      count: Number(distribution.find((d) => d.rating === rating)?.count ?? 0),
    })),
  };
}

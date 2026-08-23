import type { Request } from 'express';
import type { OrderStatus, Prisma } from '@prisma/client';
import {
  ACTIVE_ORDER_STATUSES,
  REALTIME_EVENTS,
  canTransitionOrder,
  evaluateOpenState,
  priceOrder,
  toCustomerStage,
  type CartLineInput,
  type OpeningHour,
  type PricedOrder,
} from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { fingerprintOrder } from '../lib/crypto.js';
import { nextCounterValue, prisma } from '../lib/prisma.js';
import { emitToBranch, emitToBranchRole, emitToSession } from '../realtime/index.js';
import { loadActivePromotions, loadChargeSettings, loadPricingProducts, resolveStations } from './menu.js';
import { consumeForOrder, restoreForOrder } from './inventory.js';
import { publishTableChange, recomputeTableStatus } from './tables.js';
import { extendSession } from './sessions.js';
import { writeAudit, writeAuditTx } from './audit.js';
import { notify } from './notifications.js';

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

export const orderInclude = {
  items: {
    include: { modifiers: true, kitchenStation: { select: { id: true, name: true, color: true } } },
    orderBy: { createdAt: 'asc' },
  },
  promotions: true,
  table: { select: { id: true, number: true, label: true, zone: true } },
  session: { select: { id: true, code: true, customerName: true } },
  createdBy: { select: { id: true, fullName: true } },
  payment: { select: { id: true, status: true, method: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithRelations = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export function serializeOrder(order: OrderWithRelations) {
  return {
    id: order.id,
    number: order.number,
    reference: `#${order.number}`,
    branchId: order.branchId,
    tableId: order.tableId,
    tableNumber: order.table.number,
    tableLabel: order.table.label,
    zone: order.table.zone,
    sessionId: order.sessionId,
    sessionCode: order.session?.code ?? null,
    channel: order.channel,
    status: order.status,
    customerStage: toCustomerStage(order.status),
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    taxTotal: order.taxTotal,
    serviceChargeTotal: order.serviceChargeTotal,
    total: order.total,
    currency: order.currency,
    customerName: order.customerName ?? order.session?.customerName ?? null,
    notes: order.notes,
    estimatedPrepMinutes: order.estimatedPrepMinutes,
    paymentId: order.paymentId,
    paymentStatus: order.payment?.status ?? null,
    createdAt: order.createdAt,
    acceptedAt: order.acceptedAt,
    startedAt: order.startedAt,
    readyAt: order.readyAt,
    deliveredAt: order.deliveredAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    cancelReason: order.cancelReason,
    createdBy: order.createdBy ? { id: order.createdBy.id, name: order.createdBy.fullName } : null,
    promotions: order.promotions.map((p) => ({ id: p.id, name: p.name, amount: p.amount })),
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      variantId: item.variantId,
      variantName: item.variantName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineSubtotal: item.lineSubtotal,
      lineDiscount: item.lineDiscount,
      lineTotal: item.lineTotal,
      notes: item.notes,
      status: item.status,
      startedAt: item.startedAt,
      readyAt: item.readyAt,
      prepTimeMinutes: item.prepTimeMinutes,
      station: item.kitchenStation
        ? { id: item.kitchenStation.id, name: item.kitchenStation.name, color: item.kitchenStation.color }
        : null,
      modifiers: item.modifiers.map((m) => ({
        id: m.id,
        groupName: m.groupName,
        optionName: m.optionName,
        priceDelta: m.priceDelta,
      })),
    })),
  };
}

export type SerializedOrder = ReturnType<typeof serializeOrder>;

/** What the customer is allowed to see — no kitchen notes, no internal ids of other tables. */
export function serializeOrderForCustomer(order: OrderWithRelations) {
  const full = serializeOrder(order);
  return {
    id: full.id,
    number: full.number,
    reference: full.reference,
    status: full.status,
    stage: full.customerStage,
    tableNumber: full.tableNumber,
    subtotal: full.subtotal,
    discountTotal: full.discountTotal,
    taxTotal: full.taxTotal,
    serviceChargeTotal: full.serviceChargeTotal,
    total: full.total,
    currency: full.currency,
    notes: full.notes,
    customerName: full.customerName,
    estimatedPrepMinutes: full.estimatedPrepMinutes,
    paymentStatus: full.paymentStatus,
    createdAt: full.createdAt,
    acceptedAt: full.acceptedAt,
    startedAt: full.startedAt,
    readyAt: full.readyAt,
    deliveredAt: full.deliveredAt,
    completedAt: full.completedAt,
    cancelReason: full.cancelReason,
    promotions: full.promotions,
    items: full.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      variantName: item.variantName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      notes: item.notes,
      modifiers: item.modifiers.map((m) => ({ groupName: m.groupName, optionName: m.optionName })),
    })),
  };
}

/** Server-authoritative cart quote. The client renders this; it never computes its own total. */
export async function quoteOrder(branchId: string, lines: CartLineInput[]): Promise<PricedOrder> {
  return prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { restaurantId: true },
    });
    const products = await loadPricingProducts(tx, branchId, [...new Set(lines.map((l) => l.productId))]);
    const [promotions, settings] = await Promise.all([
      loadActivePromotions(tx, branch.restaurantId, branchId),
      loadChargeSettings(tx, branch.restaurantId),
    ]);
    return priceOrder({ lines, products, promotions, settings });
  }, TX_OPTIONS);
}

export interface CreateOrderParams {
  branchId: string;
  tableId: string;
  sessionId?: string | null;
  lines: CartLineInput[];
  notes?: string | null;
  customerName?: string | null;
  idempotencyKey: string;
  channel: 'CUSTOMER' | 'STAFF';
  userId?: string | null;
  req?: Request;
  /** Set when the customer has acknowledged a suspected duplicate and wants it anyway. */
  confirmDuplicate?: boolean;
}

export interface CreateOrderResult {
  order: SerializedOrder;
  reused: boolean;
  stockWarnings: string[];
}

const DUPLICATE_WINDOW_MS = 120_000;

export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  // Idempotency first, outside the transaction: a retry of a request that already
  // succeeded must return the original order rather than doing any work at all.
  if (params.sessionId) {
    const existing = await prisma.order.findFirst({
      where: { sessionId: params.sessionId, idempotencyKey: params.idempotencyKey },
      include: orderInclude,
    });
    if (existing) {
      return { order: serializeOrder(existing), reused: true, stockWarnings: [] };
    }
  }

  const fingerprint = fingerprintOrder(
    params.lines.map((l) => ({
      p: l.productId,
      v: l.variantId ?? null,
      q: l.quantity,
      m: [...(l.modifierOptionIds ?? [])].sort(),
      n: l.notes ?? null,
    })),
  );

  const outcome = await prisma.$transaction(async (tx) => {
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: params.branchId } });
    const table = await tx.restaurantTable.findUniqueOrThrow({
      where: { id: params.tableId },
      select: { id: true, branchId: true, number: true, outOfService: true },
    });

    if (table.branchId !== branch.id) {
      throw AppError.forbidden('That table belongs to another branch.');
    }
    if (table.outOfService && params.channel === 'CUSTOMER') {
      throw AppError.conflict('This table is currently out of service.');
    }

    if (params.channel === 'CUSTOMER') {
      const openState = evaluateOpenState((branch.openingHours as unknown as OpeningHour[]) ?? []);
      if (!openState.open) {
        throw new AppError('RESTAURANT_CLOSED', 'The restaurant is not accepting orders right now.');
      }
    }

    if (params.sessionId) {
      const session = await tx.tableSession.findUniqueOrThrow({
        where: { id: params.sessionId },
        select: { id: true, status: true, tableId: true, expiresAt: true },
      });
      if (session.tableId !== params.tableId) {
        throw AppError.forbidden('This session does not belong to that table.');
      }
      if (session.status !== 'ACTIVE') {
        throw new AppError('SESSION_EXPIRED', 'Your table session is no longer active.');
      }
      if (session.expiresAt.getTime() < Date.now()) {
        throw new AppError('SESSION_EXPIRED', 'Your table session has expired. Please scan the QR code again.');
      }

      const activeCount = await tx.order.count({
        where: { sessionId: session.id, status: { in: [...ACTIVE_ORDER_STATUSES] } },
      });
      if (activeCount >= branch.maxActiveOrdersPerSession) {
        throw new AppError(
          'ORDER_LIMIT_REACHED',
          `This table already has ${activeCount} orders in progress. Please wait for them to be served.`,
          { activeCount, limit: branch.maxActiveOrdersPerSession },
        );
      }

      if (!params.confirmDuplicate) {
        const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);
        const recent = await tx.order.findMany({
          where: { sessionId: session.id, createdAt: { gte: since }, status: { notIn: ['CANCELLED', 'REJECTED'] } },
          include: { items: { include: { modifiers: true } } },
        });
        for (const candidate of recent) {
          const candidateFingerprint = fingerprintOrder(
            candidate.items.map((item) => ({
              p: item.productId,
              v: item.variantId ?? null,
              q: item.quantity,
              m: item.modifiers.map((m) => m.modifierOptionId).filter(Boolean).sort(),
              n: item.notes ?? null,
            })),
          );
          if (candidateFingerprint === fingerprint) {
            throw new AppError(
              'DUPLICATE_ORDER',
              'You just placed an identical order. Would you like to order it again?',
              { existingOrderId: candidate.id, existingOrderNumber: candidate.number },
            );
          }
        }
      }
    }

    const productIds = [...new Set(params.lines.map((l) => l.productId))];
    const products = await loadPricingProducts(tx, params.branchId, productIds);
    const [promotions, settings, stations] = await Promise.all([
      loadActivePromotions(tx, branch.restaurantId, params.branchId),
      loadChargeSettings(tx, branch.restaurantId),
      resolveStations(tx, params.branchId, productIds),
    ]);

    // Every price, discount and total below is computed here, from database rows.
    const priced = priceOrder({ lines: params.lines, products, promotions, settings });

    const number = await nextCounterValue(tx, branch.id, 'order');
    const autoAccept = branch.autoAcceptOrders;
    const now = new Date();

    const order = await tx.order.create({
      data: {
        number,
        branchId: branch.id,
        tableId: table.id,
        sessionId: params.sessionId ?? null,
        createdByUserId: params.userId ?? null,
        channel: params.channel,
        status: autoAccept ? 'ACCEPTED' : 'PENDING',
        acceptedAt: autoAccept ? now : null,
        subtotal: priced.subtotal,
        discountTotal: priced.discountTotal,
        taxTotal: priced.taxTotal,
        serviceChargeTotal: priced.serviceChargeTotal,
        total: priced.total,
        currency: priced.currency,
        customerName: params.customerName?.trim() || null,
        notes: params.notes?.trim() || null,
        idempotencyKey: params.sessionId ? params.idempotencyKey : null,
        estimatedPrepMinutes: priced.estimatedPrepMinutes,
        items: {
          create: priced.lines.map((line) => ({
            productId: line.productId,
            variantId: line.variantId,
            categoryId: line.categoryId,
            kitchenStationId: stations.get(line.productId) ?? null,
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
            modifiers: {
              create: line.modifiers.map((m) => ({
                modifierGroupId: m.groupId,
                modifierOptionId: m.optionId,
                groupName: m.groupName,
                optionName: m.optionName,
                priceDelta: m.priceDelta,
              })),
            },
          })),
        },
        promotions: {
          create: priced.appliedPromotions.map((p) => ({
            promotionId: p.promotionId,
            name: p.name,
            amount: p.amount,
          })),
        },
        statusEvents: {
          create: {
            toStatus: autoAccept ? 'ACCEPTED' : 'PENDING',
            actorType: params.channel === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
            actorUserId: params.userId ?? null,
          },
        },
      },
      include: orderInclude,
    });

    for (const promotion of priced.appliedPromotions) {
      await tx.promotion.update({
        where: { id: promotion.promotionId },
        data: { usageCount: { increment: 1 } },
      }).catch(() => undefined);
    }

    await tx.product.updateMany({
      where: { id: { in: productIds } },
      data: { soldCount: { increment: 1 } },
    });

    const stockWarnings: string[] = [];
    if (branch.deductStockOn === 'ORDER_CREATED') {
      const results = await consumeForOrder(tx, {
        branchId: branch.id,
        orderId: order.id,
        orderNumber: order.number,
        lines: priced.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        userId: params.userId ?? null,
        allowNegative: branch.allowNegativeStock,
      });
      for (const result of results) {
        if (result.level !== 'OK') {
          stockWarnings.push(`${result.itemName} is now ${result.level.toLowerCase().replace('_', ' ')}`);
        }
      }
    }

    if (params.sessionId) {
      await extendSession(tx, params.sessionId, branch.sessionTtlMinutes);
    }

    const tableChange = await recomputeTableStatus(tx, table.id);

    await writeAuditTx(tx, {
      action: 'order.created',
      entity: 'Order',
      entityId: order.id,
      restaurantId: branch.restaurantId,
      branchId: branch.id,
      actorType: params.channel === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
      actorUserId: params.userId ?? null,
      actorLabel: params.channel === 'CUSTOMER' ? `table ${table.number}` : null,
      metadata: { number: order.number, total: order.total, itemCount: priced.lines.length },
    });

    return { order, tableChange, stockWarnings, restaurantId: branch.restaurantId };
  }, TX_OPTIONS);

  // ---- everything below runs only after the transaction has committed ----

  const serialized = serializeOrder(outcome.order);
  publishTableChange(outcome.tableChange);

  emitToBranch(outcome.order.branchId, REALTIME_EVENTS.ORDER_CREATED, serialized);
  if (outcome.order.sessionId) {
    emitToSession(
      outcome.order.sessionId,
      REALTIME_EVENTS.ORDER_CREATED,
      serializeOrderForCustomer(outcome.order),
    );
  }

  await notify({
    restaurantId: outcome.restaurantId,
    branchId: outcome.order.branchId,
    type: 'NEW_ORDER',
    title: `New order #${outcome.order.number}`,
    body: `Table ${serialized.tableNumber} · ${serialized.items.length} item${serialized.items.length === 1 ? '' : 's'}`,
    data: { orderId: outcome.order.id, tableId: outcome.order.tableId } as Prisma.InputJsonValue,
    roles: ['KITCHEN', 'WAITER', 'MANAGER'],
  });

  return { order: serialized, reused: false, stockWarnings: outcome.stockWarnings };
}

const TIMESTAMP_FOR_STATUS: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'acceptedAt',
  PREPARING: 'startedAt',
  READY: 'readyAt',
  DELIVERED: 'deliveredAt',
  COMPLETED: 'completedAt',
};

export interface UpdateStatusParams {
  orderId: string;
  status: OrderStatus;
  actorUserId?: string | null;
  actorType?: 'STAFF' | 'CUSTOMER' | 'SYSTEM';
  reason?: string | null;
  req?: Request;
  /** Branch ids the caller is allowed to touch. */
  allowedBranchIds?: string[];
}

export async function updateOrderStatus(params: UpdateStatusParams): Promise<SerializedOrder> {
  const outcome = await prisma.$transaction(async (tx) => {
    const current = await tx.order.findUniqueOrThrow({
      where: { id: params.orderId },
      select: { id: true, status: true, branchId: true, tableId: true, sessionId: true, number: true },
    });

    if (params.allowedBranchIds && !params.allowedBranchIds.includes(current.branchId)) {
      throw AppError.forbidden('You do not have access to this order.');
    }

    if (!canTransitionOrder(current.status, params.status)) {
      throw new AppError(
        'INVALID_TRANSITION',
        `An order that is ${current.status.toLowerCase().replace(/_/g, ' ')} cannot be moved to ${params.status
          .toLowerCase()
          .replace(/_/g, ' ')}.`,
        { from: current.status, to: params.status },
      );
    }

    const branch = await tx.branch.findUniqueOrThrow({
      where: { id: current.branchId },
      select: { id: true, restaurantId: true, deductStockOn: true, allowNegativeStock: true },
    });

    const data: Prisma.OrderUpdateInput = { status: params.status };
    const timestampField = TIMESTAMP_FOR_STATUS[params.status];
    if (timestampField) {
      (data as Record<string, unknown>)[timestampField] = new Date();
    }
    if (params.status === 'CANCELLED' || params.status === 'REJECTED') {
      data.cancelledAt = new Date();
      data.cancelReason = params.reason ?? null;
    }

    const order = await tx.order.update({
      where: { id: params.orderId },
      data: {
        ...data,
        statusEvents: {
          create: {
            fromStatus: current.status,
            toStatus: params.status,
            actorType: params.actorType ?? 'STAFF',
            actorUserId: params.actorUserId ?? null,
            reason: params.reason ?? null,
          },
        },
      },
      include: orderInclude,
    });

    // Keep the per-item kitchen state consistent with the order-level state.
    if (params.status === 'PREPARING') {
      await tx.orderItem.updateMany({
        where: { orderId: order.id, status: 'QUEUED' },
        data: { status: 'PREPARING', startedAt: new Date() },
      });
    } else if (params.status === 'READY') {
      await tx.orderItem.updateMany({
        where: { orderId: order.id, status: { in: ['QUEUED', 'PREPARING'] } },
        data: { status: 'READY', readyAt: new Date() },
      });
    } else if (params.status === 'DELIVERED') {
      await tx.orderItem.updateMany({
        where: { orderId: order.id, status: { not: 'CANCELLED' } },
        data: { status: 'SERVED' },
      });
    } else if (params.status === 'CANCELLED' || params.status === 'REJECTED') {
      await tx.orderItem.updateMany({ where: { orderId: order.id }, data: { status: 'CANCELLED' } });
      await restoreForOrder(tx, order.id, params.actorUserId ?? null);
    }

    if (params.status === 'COMPLETED' && branch.deductStockOn === 'ORDER_COMPLETED') {
      await consumeForOrder(tx, {
        branchId: branch.id,
        orderId: order.id,
        orderNumber: order.number,
        lines: order.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        userId: params.actorUserId ?? null,
        allowNegative: branch.allowNegativeStock,
      });
    }

    const tableChange = await recomputeTableStatus(tx, current.tableId);

    await writeAuditTx(tx, {
      action: 'order.status_changed',
      entity: 'Order',
      entityId: order.id,
      restaurantId: branch.restaurantId,
      branchId: branch.id,
      actorType: params.actorType ?? 'STAFF',
      actorUserId: params.actorUserId ?? null,
      metadata: { from: current.status, to: params.status, reason: params.reason ?? null },
    });

    return { order, tableChange, previous: current.status, restaurantId: branch.restaurantId };
  }, TX_OPTIONS);

  const serialized = serializeOrder(outcome.order);
  publishTableChange(outcome.tableChange);

  emitToBranch(outcome.order.branchId, REALTIME_EVENTS.ORDER_UPDATED, serialized);
  if (outcome.order.sessionId) {
    emitToSession(
      outcome.order.sessionId,
      REALTIME_EVENTS.ORDER_UPDATED,
      serializeOrderForCustomer(outcome.order),
    );
  }

  if (params.status === 'READY') {
    emitToBranchRole(outcome.order.branchId, 'WAITER', REALTIME_EVENTS.ORDER_UPDATED, serialized);
    await notify({
      restaurantId: outcome.restaurantId,
      branchId: outcome.order.branchId,
      type: 'ORDER_STATUS',
      title: `Order #${outcome.order.number} is ready`,
      body: `Table ${serialized.tableNumber} · ready to serve`,
      data: { orderId: outcome.order.id } as Prisma.InputJsonValue,
      roles: ['WAITER', 'MANAGER'],
    });
  }

  return serialized;
}

/** Per-item kitchen progress, used by the station queues. */
export async function updateOrderItemStatus(params: {
  itemId: string;
  status: 'PREPARING' | 'READY' | 'SERVED';
  actorUserId: string;
  allowedBranchIds: string[];
  req?: Request;
}): Promise<SerializedOrder> {
  const outcome = await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findUniqueOrThrow({
      where: { id: params.itemId },
      select: { id: true, orderId: true, status: true, order: { select: { branchId: true, status: true } } },
    });

    if (!params.allowedBranchIds.includes(item.order.branchId)) {
      throw AppError.forbidden('You do not have access to this order.');
    }
    if (item.status === 'CANCELLED') {
      throw AppError.conflict('That item was cancelled.');
    }

    await tx.orderItem.update({
      where: { id: params.itemId },
      data: {
        status: params.status,
        ...(params.status === 'PREPARING' ? { startedAt: new Date() } : {}),
        ...(params.status === 'READY' ? { readyAt: new Date() } : {}),
      },
    });

    // Roll the order forward once every line has caught up.
    const siblings = await tx.orderItem.findMany({
      where: { orderId: item.orderId, status: { not: 'CANCELLED' } },
      select: { status: true },
    });

    const orderStatus = item.order.status;
    let nextOrderStatus: OrderStatus | null = null;

    if (siblings.every((s) => s.status === 'READY' || s.status === 'SERVED')) {
      if (canTransitionOrder(orderStatus, 'READY')) nextOrderStatus = 'READY';
    } else if (siblings.some((s) => s.status === 'PREPARING')) {
      if (canTransitionOrder(orderStatus, 'PREPARING')) nextOrderStatus = 'PREPARING';
    }

    if (nextOrderStatus) {
      await tx.order.update({
        where: { id: item.orderId },
        data: {
          status: nextOrderStatus,
          ...(nextOrderStatus === 'PREPARING' ? { startedAt: new Date() } : {}),
          ...(nextOrderStatus === 'READY' ? { readyAt: new Date() } : {}),
          statusEvents: {
            create: {
              fromStatus: orderStatus,
              toStatus: nextOrderStatus,
              actorType: 'STAFF',
              actorUserId: params.actorUserId,
              reason: 'Derived from kitchen item progress',
            },
          },
        },
      });
    }

    const order = await tx.order.findUniqueOrThrow({ where: { id: item.orderId }, include: orderInclude });
    const tableChange = await recomputeTableStatus(tx, order.tableId);
    return { order, tableChange };
  }, TX_OPTIONS);

  const serialized = serializeOrder(outcome.order);
  publishTableChange(outcome.tableChange);
  emitToBranch(outcome.order.branchId, REALTIME_EVENTS.ORDER_UPDATED, serialized);
  if (outcome.order.sessionId) {
    emitToSession(
      outcome.order.sessionId,
      REALTIME_EVENTS.ORDER_UPDATED,
      serializeOrderForCustomer(outcome.order),
    );
  }
  return serialized;
}

export async function findOrderForSession(orderId: string, sessionId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, sessionId },
    include: orderInclude,
  });
  if (!order) throw AppError.notFound('That order does not belong to this table.');
  return order;
}

/** Kitchen SLA watchdog: flags orders that have blown past their target prep time. */
export async function checkKitchenSla(): Promise<number> {
  const branches = await prisma.branch.findMany({
    where: { active: true },
    select: { id: true, restaurantId: true, kitchenSlaMinutes: true },
  });

  let flagged = 0;
  for (const branch of branches) {
    const threshold = new Date(Date.now() - branch.kitchenSlaMinutes * 60_000);
    const late = await prisma.order.findMany({
      where: {
        branchId: branch.id,
        status: { in: ['PENDING', 'ACCEPTED', 'PREPARING'] },
        createdAt: { lt: threshold },
      },
      select: { id: true, number: true, createdAt: true, table: { select: { number: true } } },
      take: 20,
    });

    for (const order of late) {
      const minutes = Math.round((Date.now() - order.createdAt.getTime()) / 60_000);
      const alreadyWarned = await prisma.notification.count({
        where: {
          branchId: branch.id,
          type: 'KITCHEN_DELAY',
          createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
          data: { path: ['orderId'], equals: order.id },
        },
      });
      if (alreadyWarned > 0) continue;

      flagged += 1;
      await notify({
        restaurantId: branch.restaurantId,
        branchId: branch.id,
        type: 'KITCHEN_DELAY',
        title: `Order #${order.number} is running late`,
        body: `Table ${order.table.number} · ${minutes} min since it was placed`,
        data: { orderId: order.id, minutes } as Prisma.InputJsonValue,
        roles: ['KITCHEN', 'MANAGER'],
      });
    }
  }
  return flagged;
}

export async function logOrderAudit(input: Parameters<typeof writeAudit>[0]) {
  await writeAudit(input);
}

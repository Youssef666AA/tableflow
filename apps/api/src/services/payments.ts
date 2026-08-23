import type { Request } from 'express';
import type { PaymentMethod, Prisma } from '@prisma/client';
import { REALTIME_EVENTS, splitEvenly } from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { nextCounterValue, prisma, type Tx } from '../lib/prisma.js';
import { emitToBranch, emitToSession } from '../realtime/index.js';
import { publishTableChange, recomputeTableStatus } from './tables.js';
import { writeAuditTx } from './audit.js';
import { notify } from './notifications.js';
import { chargeMockCard, type MockCard } from './mock-payment-provider.js';

const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;
const BILLABLE_ORDER_STATUSES = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY_TO_TABLE', 'DELIVERED', 'COMPLETED'] as const;

export interface BillSummary {
  sessionId: string;
  sessionCode: string;
  tableNumber: string;
  currency: string;
  orders: Array<{
    id: string;
    number: number;
    status: string;
    total: number;
    createdAt: Date;
    paid: boolean;
    items: Array<{ name: string; variantName: string | null; quantity: number; lineTotal: number }>;
  }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  serviceChargeTotal: number;
  tipTotal: number;
  billTotal: number;
  paidTotal: number;
  outstanding: number;
  settled: boolean;
  payments: Array<{
    id: string;
    method: PaymentMethod;
    status: string;
    amount: number;
    tip: number;
    createdAt: Date;
    processedAt: Date | null;
  }>;
  receiptId: string | null;
  billRequestedAt: Date | null;
}

export async function getSessionBill(sessionId: string, splitParts = 1): Promise<BillSummary & { split: number[] }> {
  const session = await prisma.tableSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: {
      table: { select: { number: true } },
      branch: { select: { restaurant: { select: { currency: true } } } },
      orders: {
        where: { status: { in: [...BILLABLE_ORDER_STATUSES] } },
        include: { items: { select: { productName: true, variantName: true, quantity: true, lineTotal: true } } },
        orderBy: { number: 'asc' },
      },
      payments: { orderBy: { createdAt: 'asc' } },
      receipts: { select: { id: true }, take: 1, orderBy: { issuedAt: 'desc' } },
    },
  });

  const totals = session.orders.reduce(
    (acc, order) => ({
      subtotal: acc.subtotal + order.subtotal,
      discountTotal: acc.discountTotal + order.discountTotal,
      taxTotal: acc.taxTotal + order.taxTotal,
      serviceChargeTotal: acc.serviceChargeTotal + order.serviceChargeTotal,
      billTotal: acc.billTotal + order.total,
    }),
    { subtotal: 0, discountTotal: 0, taxTotal: 0, serviceChargeTotal: 0, billTotal: 0 },
  );

  const paidPayments = session.payments.filter((p) => p.status === 'PAID');
  const paidTotal = paidPayments.reduce((sum, p) => sum + p.amount, 0);
  const tipTotal = paidPayments.reduce((sum, p) => sum + p.tip, 0);
  const outstanding = Math.max(0, totals.billTotal - paidTotal);

  return {
    sessionId: session.id,
    sessionCode: session.code,
    tableNumber: session.table.number,
    currency: session.branch.restaurant.currency,
    orders: session.orders.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      total: order.total,
      createdAt: order.createdAt,
      paid: order.paymentId !== null,
      items: order.items.map((i) => ({
        name: i.productName,
        variantName: i.variantName,
        quantity: i.quantity,
        lineTotal: i.lineTotal,
      })),
    })),
    ...totals,
    tipTotal,
    paidTotal,
    outstanding,
    settled: totals.billTotal > 0 && outstanding === 0,
    payments: session.payments.map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      amount: p.amount,
      tip: p.tip,
      createdAt: p.createdAt,
      processedAt: p.processedAt,
    })),
    receiptId: session.receipts[0]?.id ?? null,
    billRequestedAt: session.billRequestedAt,
    split: splitEvenly(outstanding > 0 ? outstanding : totals.billTotal, Math.max(1, splitParts)),
  };
}

export interface CreatePaymentParams {
  sessionId: string;
  method: PaymentMethod;
  /** Omit to settle the whole outstanding balance. */
  amount?: number;
  tip?: number;
  splitParts?: number;
  reference?: string | null;
  card?: MockCard;
  processedByUserId?: string | null;
  idempotencyKey?: string | null;
  req?: Request;
}

export interface PaymentResult {
  payment: {
    id: string;
    method: PaymentMethod;
    status: string;
    amount: number;
    tip: number;
    reference: string | null;
    failureReason: string | null;
    processedAt: Date | null;
  };
  bill: Awaited<ReturnType<typeof getSessionBill>>;
  receiptId: string | null;
}

export async function createPayment(params: CreatePaymentParams): Promise<PaymentResult> {
  if (params.idempotencyKey) {
    const existing = await prisma.payment.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      const bill = await getSessionBill(existing.sessionId ?? params.sessionId);
      return {
        payment: {
          id: existing.id,
          method: existing.method,
          status: existing.status,
          amount: existing.amount,
          tip: existing.tip,
          reference: existing.reference,
          failureReason: existing.failureReason,
          processedAt: existing.processedAt,
        },
        bill,
        receiptId: bill.receiptId,
      };
    }
  }

  const preview = await getSessionBill(params.sessionId);
  if (preview.billTotal === 0) {
    throw AppError.conflict('There is nothing to pay for at this table yet.');
  }
  if (preview.outstanding === 0) {
    throw new AppError('ALREADY_PAID', 'This bill has already been settled.');
  }

  const amount = params.amount ?? preview.outstanding;
  if (amount <= 0) throw AppError.badRequest('Payment amount must be greater than zero.');
  if (amount > preview.outstanding) {
    throw AppError.badRequest('Payment amount exceeds the outstanding balance.', {
      outstanding: preview.outstanding,
    });
  }

  // The mock provider is a real state machine over the local database — it never
  // contacts a payment network and never claims to have moved real money.
  let providerOutcome: { status: 'PAID' | 'FAILED'; reference: string; failureReason: string | null };
  if (params.method === 'MOCK_ONLINE') {
    providerOutcome = chargeMockCard({ amount, card: params.card });
  } else {
    // Cash and card-at-the-terminal are recorded by staff once collected.
    if (!params.processedByUserId) {
      throw AppError.forbidden('Cash and card payments must be recorded by a member of staff.');
    }
    providerOutcome = {
      status: 'PAID',
      reference: params.reference ?? `${params.method}-${Date.now().toString(36).toUpperCase()}`,
      failureReason: null,
    };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const session = await tx.tableSession.findUniqueOrThrow({
      where: { id: params.sessionId },
      select: { id: true, branchId: true, tableId: true, code: true, branch: { select: { restaurantId: true, restaurant: { select: { currency: true } } } } },
    });

    const payment = await tx.payment.create({
      data: {
        branchId: session.branchId,
        sessionId: session.id,
        method: params.method,
        status: providerOutcome.status,
        amount,
        tip: params.tip ?? 0,
        splitParts: params.splitParts ?? 1,
        currency: session.branch.restaurant.currency,
        reference: providerOutcome.reference,
        idempotencyKey: params.idempotencyKey ?? null,
        processedById: params.processedByUserId ?? null,
        processedAt: providerOutcome.status === 'PAID' ? new Date() : null,
        failureReason: providerOutcome.failureReason,
      },
    });

    let receiptId: string | null = null;

    if (providerOutcome.status === 'PAID') {
      const paidTotal = await tx.payment.aggregate({
        where: { sessionId: session.id, status: 'PAID' },
        _sum: { amount: true },
      });
      const orders = await tx.order.findMany({
        where: { sessionId: session.id, status: { in: [...BILLABLE_ORDER_STATUSES] } },
        select: { id: true, total: true, status: true },
      });
      const billTotal = orders.reduce((sum, o) => sum + o.total, 0);
      const settled = (paidTotal._sum.amount ?? 0) >= billTotal;

      if (settled) {
        await tx.order.updateMany({
          where: { sessionId: session.id, status: { in: [...BILLABLE_ORDER_STATUSES] }, paymentId: null },
          data: { paymentId: payment.id },
        });
        await tx.order.updateMany({
          where: { sessionId: session.id, status: 'DELIVERED' },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        receiptId = await issueReceipt(tx, payment.id);
      }
    }

    const tableChange = await recomputeTableStatus(tx, session.tableId);

    await writeAuditTx(tx, {
      action: providerOutcome.status === 'PAID' ? 'payment.completed' : 'payment.failed',
      entity: 'Payment',
      entityId: payment.id,
      restaurantId: session.branch.restaurantId,
      branchId: session.branchId,
      actorType: params.processedByUserId ? 'STAFF' : 'CUSTOMER',
      actorUserId: params.processedByUserId ?? null,
      metadata: { method: params.method, amount, tip: params.tip ?? 0, status: providerOutcome.status },
    });

    return { payment, tableChange, receiptId, session };
  }, TX_OPTIONS);

  publishTableChange(outcome.tableChange);

  const bill = await getSessionBill(params.sessionId);

  emitToSession(params.sessionId, REALTIME_EVENTS.PAYMENT_UPDATED, {
    paymentId: outcome.payment.id,
    status: outcome.payment.status,
    outstanding: bill.outstanding,
    settled: bill.settled,
    receiptId: outcome.receiptId,
  });
  emitToBranch(outcome.session.branchId, REALTIME_EVENTS.PAYMENT_UPDATED, {
    paymentId: outcome.payment.id,
    sessionId: params.sessionId,
    tableId: outcome.session.tableId,
    status: outcome.payment.status,
    amount: outcome.payment.amount,
    outstanding: bill.outstanding,
    settled: bill.settled,
  });

  if (outcome.payment.status === 'PAID') {
    await notify({
      restaurantId: outcome.session.branch.restaurantId,
      branchId: outcome.session.branchId,
      type: 'PAYMENT',
      title: `Payment received · table ${bill.tableNumber}`,
      body: `${(amount / 1000).toFixed(3)} ${bill.currency} via ${params.method.replace('_', ' ').toLowerCase()}`,
      data: { paymentId: outcome.payment.id, sessionId: params.sessionId } as Prisma.InputJsonValue,
      roles: ['CASHIER', 'MANAGER'],
    });
  }

  return {
    payment: {
      id: outcome.payment.id,
      method: outcome.payment.method,
      status: outcome.payment.status,
      amount: outcome.payment.amount,
      tip: outcome.payment.tip,
      reference: outcome.payment.reference,
      failureReason: outcome.payment.failureReason,
      processedAt: outcome.payment.processedAt,
    },
    bill,
    receiptId: outcome.receiptId ?? bill.receiptId,
  };
}

/** Builds the immutable receipt snapshot. Runs inside the settling transaction. */
async function issueReceipt(tx: Tx, paymentId: string): Promise<string> {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      branch: {
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          restaurant: {
            select: { name: true, legalName: true, currency: true, taxRateBps: true, serviceChargeRateBps: true },
          },
        },
      },
      session: {
        select: {
          id: true,
          code: true,
          startedAt: true,
          guestCount: true,
          customerName: true,
          table: { select: { number: true } },
        },
      },
    },
  });

  if (!payment.sessionId || !payment.session) {
    throw AppError.conflict('Cannot issue a receipt for a payment with no table session.');
  }

  const existing = await tx.receipt.findUnique({ where: { paymentId } });
  if (existing) return existing.id;

  const orders = await tx.order.findMany({
    where: { sessionId: payment.sessionId, status: { in: [...BILLABLE_ORDER_STATUSES] } },
    include: { items: { include: { modifiers: true } }, promotions: true },
    orderBy: { number: 'asc' },
  });

  const payments = await tx.payment.findMany({
    where: { sessionId: payment.sessionId, status: 'PAID' },
    orderBy: { createdAt: 'asc' },
  });

  const totals = orders.reduce(
    (acc, order) => ({
      subtotal: acc.subtotal + order.subtotal,
      discountTotal: acc.discountTotal + order.discountTotal,
      taxTotal: acc.taxTotal + order.taxTotal,
      serviceChargeTotal: acc.serviceChargeTotal + order.serviceChargeTotal,
      total: acc.total + order.total,
    }),
    { subtotal: 0, discountTotal: 0, taxTotal: 0, serviceChargeTotal: 0, total: 0 },
  );

  const sequence = await nextCounterValue(tx, payment.branchId, 'receipt');
  const number = `R-${new Date().getFullYear()}-${String(sequence).padStart(6, '0')}`;

  const snapshot = {
    number,
    issuedAt: new Date().toISOString(),
    restaurant: {
      name: payment.branch.restaurant.name,
      legalName: payment.branch.restaurant.legalName,
      currency: payment.branch.restaurant.currency,
      taxRateBps: payment.branch.restaurant.taxRateBps,
      serviceChargeRateBps: payment.branch.restaurant.serviceChargeRateBps,
    },
    branch: { name: payment.branch.name, address: payment.branch.address, phone: payment.branch.phone },
    session: {
      code: payment.session.code,
      tableNumber: payment.session.table.number,
      startedAt: payment.session.startedAt.toISOString(),
      guestCount: payment.session.guestCount,
      customerName: payment.session.customerName,
    },
    orders: orders.map((order) => ({
      number: order.number,
      placedAt: order.createdAt.toISOString(),
      items: order.items.map((item) => ({
        name: item.productName,
        variantName: item.variantName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        modifiers: item.modifiers.map((m) => ({ name: m.optionName, priceDelta: m.priceDelta })),
        notes: item.notes,
      })),
      promotions: order.promotions.map((p) => ({ name: p.name, amount: p.amount })),
      total: order.total,
    })),
    totals: { ...totals, tip: payments.reduce((sum, p) => sum + p.tip, 0) },
    payments: payments.map((p) => ({
      method: p.method,
      amount: p.amount,
      tip: p.tip,
      reference: p.reference,
      processedAt: p.processedAt?.toISOString() ?? null,
      /** Never presented as a real card settlement. */
      simulated: p.method === 'MOCK_ONLINE',
    })),
  };

  const receipt = await tx.receipt.create({
    data: {
      number,
      paymentId: payment.id,
      sessionId: payment.sessionId,
      branchId: payment.branchId,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    },
  });

  return receipt.id;
}

export async function getReceipt(receiptId: string) {
  return prisma.receipt.findUnique({
    where: { id: receiptId },
    include: { payment: { select: { method: true, status: true, amount: true, tip: true } } },
  });
}

export async function refundPayment(params: {
  paymentId: string;
  userId: string;
  allowedBranchIds: string[];
  reason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: params.paymentId } });
    if (!params.allowedBranchIds.includes(payment.branchId)) {
      throw AppError.forbidden('You do not have access to this payment.');
    }
    if (payment.status !== 'PAID') {
      throw AppError.conflict('Only a completed payment can be refunded.');
    }

    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'REFUNDED', failureReason: params.reason ?? null },
    });

    await tx.order.updateMany({ where: { paymentId: payment.id }, data: { paymentId: null } });

    await writeAuditTx(tx, {
      action: 'payment.refunded',
      entity: 'Payment',
      entityId: payment.id,
      branchId: payment.branchId,
      actorType: 'STAFF',
      actorUserId: params.userId,
      metadata: { amount: payment.amount, reason: params.reason ?? null },
    });

    return updated;
  }, TX_OPTIONS);
}

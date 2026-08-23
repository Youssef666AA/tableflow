import { REALTIME_EVENTS, deriveTableStatus, type TableStatus } from '@tableflow/shared';
import { prisma, type Tx } from '../lib/prisma.js';
import { emitToBranch } from '../realtime/index.js';

const OPEN_ORDER_STATUSES = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY_TO_TABLE'] as const;
const READY_ORDER_STATUSES = ['READY', 'OUT_FOR_DELIVERY_TO_TABLE'] as const;

export interface TableStatusChange {
  tableId: string;
  branchId: string;
  number: string;
  from: TableStatus;
  to: TableStatus;
  changed: boolean;
}

/**
 * Table status is derived from live sessions, orders, requests and payments —
 * never set by hand — so the floor plan can never drift out of sync with what is
 * actually happening at the table.
 *
 * Runs inside the caller's transaction; the caller emits after commit.
 */
export async function recomputeTableStatus(tx: Tx, tableId: string): Promise<TableStatusChange> {
  const table = await tx.restaurantTable.findUniqueOrThrow({
    where: { id: tableId },
    select: { id: true, branchId: true, number: true, status: true, outOfService: true, needsCleaning: true },
  });

  const activeSession = await tx.tableSession.findFirst({
    where: { tableId, status: { in: ['CREATED', 'LOCATION_PENDING', 'ACTIVE', 'PAUSED'] } },
    select: { id: true, billRequestedAt: true },
    orderBy: { startedAt: 'desc' },
  });

  let hasOpenOrders = false;
  let hasReadyOrders = false;
  let paymentPending = false;
  let billRequested = false;

  if (activeSession) {
    const [openCount, readyCount, pendingPayment, openBillRequest] = await Promise.all([
      tx.order.count({ where: { tableId, status: { in: [...OPEN_ORDER_STATUSES] } } }),
      tx.order.count({ where: { tableId, status: { in: [...READY_ORDER_STATUSES] } } }),
      tx.payment.count({ where: { sessionId: activeSession.id, status: { in: ['PENDING', 'PROCESSING'] } } }),
      tx.serviceRequest.count({
        where: {
          sessionId: activeSession.id,
          type: 'REQUEST_BILL',
          status: { in: ['REQUESTED', 'ACKNOWLEDGED', 'IN_PROGRESS'] },
        },
      }),
    ]);

    hasOpenOrders = openCount > 0;
    hasReadyOrders = readyCount > 0;
    paymentPending = pendingPayment > 0;
    billRequested = openBillRequest > 0 || activeSession.billRequestedAt !== null;
  }

  const next = deriveTableStatus({
    hasActiveSession: Boolean(activeSession),
    hasOpenOrders,
    hasReadyOrders,
    billRequested,
    paymentPending,
    needsCleaning: table.needsCleaning,
    outOfService: table.outOfService,
  });

  const changed = next !== table.status;
  if (changed) {
    await tx.restaurantTable.update({ where: { id: tableId }, data: { status: next } });
  }

  return {
    tableId,
    branchId: table.branchId,
    number: table.number,
    from: table.status as TableStatus,
    to: next,
    changed,
  };
}

/** Emit a recomputed table status — call only after the transaction has committed. */
export function publishTableChange(change: TableStatusChange): void {
  if (!change.changed) return;
  emitToBranch(change.branchId, REALTIME_EVENTS.TABLE_UPDATED, {
    id: change.tableId,
    number: change.number,
    status: change.to,
    previousStatus: change.from,
  });
}

/** Convenience wrapper for callers not already inside a transaction. */
export async function refreshTableStatus(tableId: string): Promise<TableStatusChange> {
  const change = await prisma.$transaction((tx) => recomputeTableStatus(tx, tableId));
  publishTableChange(change);
  return change;
}

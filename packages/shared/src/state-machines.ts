import type {
  OrderStatus,
  ServiceRequestStatus,
  SessionStatus,
  TableStatus,
  PaymentStatus,
} from './constants.js';

/**
 * Explicit state machines. The API refuses any transition not listed here, so an
 * order can never jump from PENDING straight to COMPLETED, and a cancelled order
 * can never come back to life.
 */

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['ACCEPTED', 'PREPARING', 'REJECTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY_TO_TABLE', 'DELIVERED'],
  OUT_FOR_DELIVERY_TO_TABLE: ['DELIVERED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new Error(`Invalid order transition: ${from} -> ${to}`);
  }
}

export const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  CREATED: ['LOCATION_PENDING', 'ACTIVE', 'BLOCKED', 'EXPIRED', 'CLOSED'],
  LOCATION_PENDING: ['ACTIVE', 'BLOCKED', 'EXPIRED', 'CLOSED'],
  ACTIVE: ['PAUSED', 'EXPIRED', 'CLOSED', 'BLOCKED'],
  PAUSED: ['ACTIVE', 'EXPIRED', 'CLOSED', 'BLOCKED'],
  EXPIRED: ['CLOSED'],
  CLOSED: [],
  BLOCKED: ['CLOSED', 'ACTIVE'],
};

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  if (from === to) return false;
  return (SESSION_TRANSITIONS[from] ?? []).includes(to);
}

/** Only an ACTIVE session may place orders or raise service requests. */
export function sessionCanOrder(status: SessionStatus): boolean {
  return status === 'ACTIVE';
}

export const SERVICE_REQUEST_TRANSITIONS: Record<ServiceRequestStatus, ServiceRequestStatus[]> = {
  REQUESTED: ['ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionServiceRequest(
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
): boolean {
  if (from === to) return false;
  return (SERVICE_REQUEST_TRANSITIONS[from] ?? []).includes(to);
}

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PROCESSING', 'PAID', 'FAILED'],
  PROCESSING: ['PAID', 'FAILED'],
  PAID: ['REFUNDED'],
  FAILED: ['PENDING', 'PROCESSING'],
  REFUNDED: [],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return false;
  return (PAYMENT_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Table status is *derived*, never set arbitrarily, so the floor plan can never
 * disagree with the sessions and orders underneath it.
 */
export interface TableStateInput {
  hasActiveSession: boolean;
  hasOpenOrders: boolean;
  hasReadyOrders: boolean;
  billRequested: boolean;
  paymentPending: boolean;
  needsCleaning: boolean;
  outOfService: boolean;
}

export function deriveTableStatus(input: TableStateInput): TableStatus {
  if (input.outOfService) return 'OUT_OF_SERVICE';
  if (input.needsCleaning) return 'CLEANING';
  if (!input.hasActiveSession) return 'AVAILABLE';
  if (input.paymentPending) return 'PAYMENT_PENDING';
  if (input.billRequested) return 'WAITING_FOR_BILL';
  if (input.hasReadyOrders) return 'FOOD_READY';
  if (input.hasOpenOrders) return 'ORDERING';
  return 'ACTIVE';
}

export const TABLE_STATUS_LABEL: Record<TableStatus, string> = {
  AVAILABLE: 'Available',
  ACTIVE: 'Seated',
  ORDERING: 'Ordering',
  FOOD_READY: 'Food ready',
  WAITING_FOR_BILL: 'Waiting for bill',
  PAYMENT_PENDING: 'Payment pending',
  CLEANING: 'Cleaning',
  OUT_OF_SERVICE: 'Out of service',
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY: 'Ready',
  OUT_FOR_DELIVERY_TO_TABLE: 'On the way',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

export const SERVICE_REQUEST_LABEL: Record<string, string> = {
  WATER: 'Water',
  NAPKINS: 'Napkins',
  CUTLERY: 'Cutlery',
  CONDIMENTS: 'Condiments',
  CALL_WAITER: 'Call waiter',
  REQUEST_BILL: 'Request bill',
  CLEANING: 'Table cleaning',
  OTHER: 'Other',
};

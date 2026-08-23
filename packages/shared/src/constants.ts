/**
 * TableFlow shared domain constants.
 * These values are the single source of truth for both the API and the web client.
 */

export const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'WAITER', 'KITCHEN', 'CASHIER', 'INVENTORY'] as const;
export type Role = (typeof ROLES)[number];

export const ORDER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY_TO_TABLE',
  'DELIVERED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses that still occupy the kitchen / floor. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'PENDING',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY_TO_TABLE',
  'DELIVERED',
];

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ['COMPLETED', 'CANCELLED', 'REJECTED'];

export const SESSION_STATUSES = [
  'CREATED',
  'LOCATION_PENDING',
  'ACTIVE',
  'PAUSED',
  'EXPIRED',
  'CLOSED',
  'BLOCKED',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const TABLE_STATUSES = [
  'AVAILABLE',
  'ACTIVE',
  'ORDERING',
  'FOOD_READY',
  'WAITING_FOR_BILL',
  'PAYMENT_PENDING',
  'CLEANING',
  'OUT_OF_SERVICE',
] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const SERVICE_REQUEST_TYPES = [
  'WATER',
  'NAPKINS',
  'CUTLERY',
  'CONDIMENTS',
  'CALL_WAITER',
  'REQUEST_BILL',
  'CLEANING',
  'OTHER',
] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

export const SERVICE_REQUEST_STATUSES = [
  'REQUESTED',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

export const PAYMENT_METHODS = ['CASH', 'CARD', 'MOCK_ONLINE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PRODUCT_STATUSES = ['AVAILABLE', 'UNAVAILABLE', 'HIDDEN'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const STOCK_MOVEMENT_TYPES = ['PURCHASE', 'SALE', 'ADJUSTMENT', 'WASTE', 'RETURN'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const WASTE_REASONS = [
  'EXPIRED',
  'BURNED',
  'WRONG_PREPARATION',
  'SPILLED',
  'CUSTOMER_COMPLAINT',
  'OTHER',
] as const;
export type WasteReason = (typeof WASTE_REASONS)[number];

export const PROMOTION_TYPES = ['PERCENTAGE', 'FIXED'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export const PROMOTION_SCOPES = ['ORDER', 'PRODUCT', 'CATEGORY'] as const;
export type PromotionScope = (typeof PROMOTION_SCOPES)[number];

export const MODIFIER_SELECTION_TYPES = ['SINGLE', 'MULTIPLE'] as const;
export type ModifierSelectionType = (typeof MODIFIER_SELECTION_TYPES)[number];

export const NOTIFICATION_TYPES = [
  'NEW_ORDER',
  'ORDER_STATUS',
  'SERVICE_REQUEST',
  'BILL_REQUEST',
  'LOW_STOCK',
  'PAYMENT',
  'KITCHEN_DELAY',
  'NEW_REVIEW',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'portion'] as const;
export type Unit = (typeof UNITS)[number];

/** Base unit conversion factors — everything is normalised to g / ml / pcs internally. */
export const UNIT_BASE: Record<Unit, { base: 'g' | 'ml' | 'pcs'; factor: number }> = {
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  l: { base: 'ml', factor: 1000 },
  pcs: { base: 'pcs', factor: 1 },
  portion: { base: 'pcs', factor: 1 },
};

/** Customer-facing simplification of the internal order state machine. */
export const CUSTOMER_ORDER_STAGES = ['RECEIVED', 'PREPARING', 'READY', 'DELIVERED'] as const;
export type CustomerOrderStage = (typeof CUSTOMER_ORDER_STAGES)[number];

export function toCustomerStage(status: OrderStatus): CustomerOrderStage | 'CANCELLED' {
  switch (status) {
    case 'PENDING':
    case 'ACCEPTED':
      return 'RECEIVED';
    case 'PREPARING':
      return 'PREPARING';
    case 'READY':
    case 'OUT_FOR_DELIVERY_TO_TABLE':
      return 'READY';
    case 'DELIVERED':
    case 'COMPLETED':
      return 'DELIVERED';
    default:
      return 'CANCELLED';
  }
}

export const REALTIME_EVENTS = {
  ORDER_CREATED: 'order:created',
  ORDER_UPDATED: 'order:updated',
  ORDER_ITEM_UPDATED: 'order_item:updated',
  SERVICE_REQUEST_CREATED: 'service_request:created',
  SERVICE_REQUEST_UPDATED: 'service_request:updated',
  TABLE_UPDATED: 'table:updated',
  SESSION_UPDATED: 'session:updated',
  PAYMENT_UPDATED: 'payment:updated',
  INVENTORY_ALERT: 'inventory:alert',
  NOTIFICATION: 'notification:new',
  MENU_UPDATED: 'menu:updated',
  REVIEW_CREATED: 'review:created',
} as const;
export type RealtimeEvent = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

export const DEFAULT_CURRENCY = 'TND';
/** TND is a 3-decimal currency: 49.500 TND === 49500 minor units. */
export const CURRENCY_DECIMALS: Record<string, number> = { TND: 3, EUR: 2, USD: 2, GBP: 2 };

export interface MenuModifierOption {
  id: string;
  name: string;
  priceDelta: number;
  available: boolean;
  sortOrder: number;
}

export interface MenuModifierGroup {
  id: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  options: MenuModifierOption[];
}

export interface MenuVariant {
  id: string;
  name: string;
  priceDelta: number;
  available: boolean;
  sortOrder: number;
}

export interface MenuProduct {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  basePrice: number;
  status: 'AVAILABLE' | 'UNAVAILABLE' | 'HIDDEN';
  featured: boolean;
  popular: boolean;
  prepTimeMinutes: number;
  allergens: string[];
  tags: string[];
  calories: number | null;
  rating: number;
  ratingCount: number;
  soldCount: number;
  sortOrder: number;
  kitchenStation: { id: string; name: string; color: string | null } | null;
  variants: MenuVariant[];
  modifierGroups: MenuModifierGroup[];
}

export interface MenuCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  active: boolean;
  productCount: number;
}

export interface MenuResponse {
  branchId: string;
  categories: MenuCategory[];
  products: MenuProduct[];
}

export interface CustomerOrderItem {
  id: string;
  productId: string | null;
  productName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  notes: string | null;
  modifiers: Array<{ groupName: string; optionName: string }>;
}

export interface CustomerOrder {
  id: string;
  number: number;
  reference: string;
  status: string;
  stage: 'RECEIVED' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';
  tableNumber: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  serviceChargeTotal: number;
  total: number;
  currency: string;
  notes: string | null;
  customerName: string | null;
  estimatedPrepMinutes: number;
  paymentStatus: string | null;
  createdAt: string;
  acceptedAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelReason: string | null;
  promotions: Array<{ id: string; name: string; amount: number }>;
  items: CustomerOrderItem[];
}

export interface CustomerServiceRequest {
  id: string;
  type: string;
  label: string;
  status: 'REQUESTED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  note: string | null;
  createdAt: string;
  acknowledgedAt: string | null;
  completedAt: string | null;
}

export interface BillResponse {
  sessionId: string;
  sessionCode: string;
  tableNumber: string;
  currency: string;
  orders: Array<{
    id: string;
    number: number;
    status: string;
    total: number;
    createdAt: string;
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
    method: string;
    status: string;
    amount: number;
    tip: number;
    createdAt: string;
    processedAt: string | null;
  }>;
  receiptId: string | null;
  billRequestedAt: string | null;
  split: number[];
}

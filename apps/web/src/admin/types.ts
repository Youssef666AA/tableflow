export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
  active: boolean;
  productCount: number;
}

export interface AdminVariant {
  id: string;
  name: string;
  priceDelta: number;
  available: boolean;
  sortOrder: number;
}

export interface AdminModifierOption {
  id: string;
  name: string;
  priceDelta: number;
  available: boolean;
  sortOrder: number;
}

export interface AdminModifierGroup {
  id: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  options: AdminModifierOption[];
}

export interface AdminStation {
  id: string;
  name: string;
  color: string | null;
}

export interface AdminProduct {
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
  kitchenStation: AdminStation | null;
  variants: AdminVariant[];
  modifierGroups: AdminModifierGroup[];
}

export interface AdminMenuPayload {
  branchId: string;
  categories: AdminCategory[];
  products: AdminProduct[];
}

export interface AdminTable {
  id: string;
  branchId: string;
  number: string;
  label: string | null;
  seats: number;
  zone: string | null;
  posX: number;
  posY: number;
  shape: 'ROUND' | 'SQUARE' | 'RECT';
  status: string;
  outOfService: boolean;
  needsCleaning: boolean;
  qr: { id: string; url: string; scanCount: number } | null;
  session: { id: string; code: string } | null;
}

export interface AdminInventoryItem {
  id: string;
  name: string;
  sku: string | null;
  unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs' | 'portion';
  quantity: number;
  rawQuantity: number;
  minimumQuantity: number;
  rawMinimumQuantity: number;
  costPerUnit: number;
  stockValue: number;
  level: 'OK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
  category: string | null;
  active: boolean;
  supplier: { id: string; name: string } | null;
  updatedAt: string;
}

export interface AdminEmployee {
  membershipId: string;
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  active: boolean;
  position: string | null;
  hiredAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  branches: Array<{ id: string; name: string }>;
  allBranches: boolean;
}

export interface AdminReview {
  id: string;
  rating: number;
  foodRating: number | null;
  serviceRating: number | null;
  comment: string | null;
  createdAt: string;
  published: boolean;
  response: string | null;
  respondedAt: string | null;
  tableNumber: string | null;
  branchName: string;
  sessionCode: string;
  customerName: string | null;
}

export interface AdminPromotion {
  id: string;
  branchId: string | null;
  name: string;
  description: string | null;
  type: 'PERCENTAGE' | 'FIXED';
  scope: 'ORDER' | 'PRODUCT' | 'CATEGORY';
  value: number;
  productIds: string[];
  categoryIds: string[];
  minSubtotal: number | null;
  maxDiscount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  daysOfWeek: number[];
  startMinuteOfDay: number | null;
  endMinuteOfDay: number | null;
  active: boolean;
  priority: number;
  usageCount: number;
  branch: { id: string; name: string } | null;
  _count: { orders: number };
}

export interface AdminBranch {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  latitude: number;
  longitude: number;
  serviceRadiusMeters: number;
  requireLocation: boolean;
  allowStaffLocationOverride: boolean;
  sessionTtlMinutes: number;
  maxActiveOrdersPerSession: number;
  allowNegativeStock: boolean;
  deductStockOn: 'ORDER_CREATED' | 'ORDER_COMPLETED';
  splitStationsEnabled: boolean;
  autoAcceptOrders: boolean;
  kitchenSlaMinutes: number;
  timezone: string;
  openingHours: Array<{ dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }>;
  active: boolean;
  _count?: { tables: number; inventoryItems: number };
}

export interface AdminSettingsPayload {
  restaurant: {
    id: string;
    name: string;
    slug: string;
    legalName: string | null;
    logoUrl: string | null;
    currency: string;
    taxRateBps: number;
    serviceChargeRateBps: number;
    pricesIncludeTax: boolean;
    locale: string;
    productCount: number;
    categoryCount: number;
  };
  branches: AdminBranch[];
  system: {
    demoMode: boolean;
    environment: string;
    queueDriver: string;
    paymentProviders: Array<{ id: string; displayName: string; simulated: boolean }>;
    integrations: Record<string, boolean>;
  };
}

import { z } from 'zod';
import {
  MODIFIER_SELECTION_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  PRODUCT_STATUSES,
  PROMOTION_SCOPES,
  PROMOTION_TYPES,
  ROLES,
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_TYPES,
  STOCK_MOVEMENT_TYPES,
  TABLE_STATUSES,
  UNITS,
  WASTE_REASONS,
} from './constants.js';

export const uuid = z.string().uuid();
export const cuidLike = z.string().min(10).max(64);
export const id = z.string().min(1).max(64);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const dateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  range: z.enum(['today', '7d', '30d', '90d', 'custom']).default('today'),
});

/* ------------------------------------------------------------------ auth */

export const loginSchema = z.object({
  email: z.string().email().max(160).transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8).max(200),
});

export const registerSchema = z.object({
  email: z.string().email().max(160).transform((v) => v.toLowerCase().trim()),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(200)
    .regex(/[a-z]/, 'Include a lowercase letter')
    .regex(/[A-Z]/, 'Include an uppercase letter')
    .regex(/[0-9]/, 'Include a number'),
  fullName: z.string().min(2).max(120),
  restaurantName: z.string().min(2).max(120),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z
    .string()
    .min(10)
    .max(200)
    .regex(/[a-z]/)
    .regex(/[A-Z]/)
    .regex(/[0-9]/),
});

/* -------------------------------------------------------------- sessions */

export const startSessionSchema = z.object({
  token: z.string().min(16).max(128),
  deviceLabel: z.string().max(120).optional(),
});

export const verifyLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100000).nullish(),
  /** Only honoured when the server runs with DEMO_MODE enabled. */
  simulate: z.boolean().optional(),
});

export const closeSessionSchema = z.object({
  reason: z.string().max(200).optional(),
});

/* ------------------------------------------------------------------ cart */

export const cartLineSchema = z.object({
  productId: id,
  variantId: id.nullish(),
  quantity: z.number().int().min(1).max(50),
  modifierOptionIds: z.array(id).max(30).default([]),
  notes: z.string().max(280).nullish(),
});

export const quoteSchema = z.object({
  lines: z.array(cartLineSchema).min(1).max(60),
});

export const createOrderSchema = z.object({
  lines: z.array(cartLineSchema).min(1).max(60),
  notes: z.string().max(500).nullish(),
  customerName: z.string().max(60).nullish(),
  idempotencyKey: z.string().min(8).max(120),
});

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  reason: z.string().max(300).optional(),
});

/* -------------------------------------------------------- service requests */

export const createServiceRequestSchema = z.object({
  type: z.enum(SERVICE_REQUEST_TYPES),
  note: z.string().max(280).nullish(),
});

export const updateServiceRequestSchema = z.object({
  status: z.enum(SERVICE_REQUEST_STATUSES),
});

/* ---------------------------------------------------------------- tables */

export const createTableSchema = z.object({
  branchId: id,
  number: z.string().min(1).max(12),
  label: z.string().max(60).nullish(),
  seats: z.number().int().min(1).max(40).default(4),
  zone: z.string().max(40).nullish(),
  posX: z.number().min(0).max(100).default(50),
  posY: z.number().min(0).max(100).default(50),
  shape: z.enum(['ROUND', 'SQUARE', 'RECT']).default('ROUND'),
});

export const updateTableSchema = createTableSchema.partial().omit({ branchId: true }).extend({
  outOfService: z.boolean().optional(),
});

export const updateTableStatusSchema = z.object({
  status: z.enum(TABLE_STATUSES),
});

export const bulkTablePositionSchema = z.object({
  tables: z
    .array(
      z.object({
        id: id,
        posX: z.number().min(0).max(100),
        posY: z.number().min(0).max(100),
      }),
    )
    .max(200),
});

/* ------------------------------------------------------------------ menu */

export const categorySchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(400).nullish(),
  imageUrl: z.string().max(500).nullish(),
  sortOrder: z.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
});

export const variantSchema = z.object({
  id: id.optional(),
  name: z.string().min(1).max(60),
  priceDelta: z.number().int().min(-1000000).max(1000000).default(0),
  available: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(99).default(0),
});

export const modifierOptionSchema = z.object({
  id: id.optional(),
  name: z.string().min(1).max(60),
  priceDelta: z.number().int().min(-1000000).max(1000000).default(0),
  available: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(99).default(0),
});

export const modifierGroupSchema = z.object({
  id: id.optional(),
  name: z.string().min(1).max(60),
  selectionType: z.enum(MODIFIER_SELECTION_TYPES).default('SINGLE'),
  required: z.boolean().default(false),
  minSelect: z.number().int().min(0).max(20).default(0),
  maxSelect: z.number().int().min(1).max(20).nullish(),
  sortOrder: z.number().int().min(0).max(99).default(0),
  options: z.array(modifierOptionSchema).max(30).default([]),
});

export const productSchema = z.object({
  categoryId: id,
  name: z.string().min(1).max(120),
  description: z.string().max(600).nullish(),
  basePrice: z.number().int().min(0).max(100000000),
  imageUrl: z.string().max(500).nullish(),
  status: z.enum(PRODUCT_STATUSES).default('AVAILABLE'),
  featured: z.boolean().default(false),
  popular: z.boolean().default(false),
  prepTimeMinutes: z.number().int().min(1).max(240).default(10),
  kitchenStationId: id.nullish(),
  allergens: z.array(z.string().max(40)).max(20).default([]),
  tags: z.array(z.string().max(40)).max(20).default([]),
  calories: z.number().int().min(0).max(10000).nullish(),
  sortOrder: z.number().int().min(0).max(999).default(0),
  variants: z.array(variantSchema).max(15).default([]),
  modifierGroups: z.array(modifierGroupSchema).max(10).default([]),
});

export const updateProductSchema = productSchema.partial();

export const productAvailabilitySchema = z.object({
  status: z.enum(PRODUCT_STATUSES),
  branchId: id.optional(),
});

/* ------------------------------------------------------------- inventory */

export const inventoryItemSchema = z.object({
  branchId: id,
  name: z.string().min(1).max(120),
  sku: z.string().max(60).nullish(),
  unit: z.enum(UNITS),
  quantity: z.number().min(0).max(1000000).default(0),
  minimumQuantity: z.number().min(0).max(1000000).default(0),
  costPerUnit: z.number().int().min(0).max(100000000).default(0),
  supplierId: id.nullish(),
  category: z.string().max(60).nullish(),
});

export const updateInventoryItemSchema = inventoryItemSchema.partial().omit({ branchId: true });

export const stockMovementSchema = z.object({
  inventoryItemId: id,
  type: z.enum(STOCK_MOVEMENT_TYPES),
  quantity: z.number().min(-1000000).max(1000000),
  unit: z.enum(UNITS),
  reason: z.string().max(200).nullish(),
  wasteReason: z.enum(WASTE_REASONS).nullish(),
  unitCost: z.number().int().min(0).max(100000000).nullish(),
  reference: z.string().max(80).nullish(),
});

export const supplierSchema = z.object({
  branchId: id,
  name: z.string().min(1).max(120),
  contactName: z.string().max(120).nullish(),
  phone: z.string().max(40).nullish(),
  email: z.string().email().max(160).nullish(),
  notes: z.string().max(500).nullish(),
});

export const recipeSchema = z.object({
  productId: id,
  yieldQuantity: z.number().int().min(1).max(1000).default(1),
  /** Recipe lines reference the restaurant-wide ingredient catalogue, not branch stock. */
  ingredients: z
    .array(
      z.object({
        ingredientId: id,
        quantity: z.number().min(0.0001).max(100000),
        unit: z.enum(UNITS),
      }),
    )
    .max(40)
    .default([]),
});

export const ingredientSchema = z.object({
  name: z.string().min(1).max(120),
  unit: z.enum(UNITS),
  category: z.string().max(60).nullish(),
});

/* ------------------------------------------------------------- employees */

export const createEmployeeSchema = z.object({
  email: z.string().email().max(160).transform((v) => v.toLowerCase().trim()),
  fullName: z.string().min(2).max(120),
  password: z.string().min(10).max(200),
  role: z.enum(ROLES),
  branchIds: z.array(id).max(20).default([]),
  phone: z.string().max(40).nullish(),
  position: z.string().max(80).nullish(),
});

export const updateEmployeeSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  role: z.enum(ROLES).optional(),
  branchIds: z.array(id).max(20).optional(),
  phone: z.string().max(40).nullish(),
  position: z.string().max(80).nullish(),
  active: z.boolean().optional(),
  password: z.string().min(10).max(200).optional(),
});

/* --------------------------------------------------------------- billing */

export const createPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().int().min(0).max(1000000000).optional(),
  tip: z.number().int().min(0).max(100000000).default(0),
  splitParts: z.number().int().min(1).max(20).default(1),
  reference: z.string().max(120).nullish(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

export const mockCardSchema = z.object({
  cardNumber: z.string().min(12).max(24),
  expiry: z.string().min(4).max(7),
  cvc: z.string().min(3).max(4),
  holder: z.string().min(2).max(80),
});

/* --------------------------------------------------------------- reviews */

export const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  foodRating: z.number().int().min(1).max(5).nullish(),
  serviceRating: z.number().int().min(1).max(5).nullish(),
  comment: z.string().max(1000).nullish(),
});

/* ------------------------------------------------------------ promotions */

export const promotionSchema = z.object({
  branchId: id.nullish(),
  name: z.string().min(1).max(120),
  description: z.string().max(400).nullish(),
  type: z.enum(PROMOTION_TYPES),
  scope: z.enum(PROMOTION_SCOPES),
  value: z.number().min(0).max(100000000),
  productIds: z.array(id).max(200).default([]),
  categoryIds: z.array(id).max(60).default([]),
  minSubtotal: z.number().int().min(0).max(1000000000).nullish(),
  maxDiscount: z.number().int().min(0).max(1000000000).nullish(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  startMinuteOfDay: z.number().int().min(0).max(1440).nullish(),
  endMinuteOfDay: z.number().int().min(0).max(1440).nullish(),
  active: z.boolean().default(true),
  priority: z.number().int().min(0).max(100).default(0),
});

/* -------------------------------------------------------------- settings */

export const openingHoursSchema = z.array(
  z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closed: z.boolean().default(false),
  }),
).max(14);

export const restaurantSettingsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  legalName: z.string().max(160).nullish(),
  logoUrl: z.string().max(500).nullish(),
  currency: z.string().min(3).max(3).optional(),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  serviceChargeRateBps: z.number().int().min(0).max(10000).optional(),
  pricesIncludeTax: z.boolean().optional(),
  locale: z.string().max(10).optional(),
});

export const branchSettingsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  address: z.string().max(300).nullish(),
  phone: z.string().max(40).nullish(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  serviceRadiusMeters: z.number().int().min(10).max(20000).optional(),
  requireLocation: z.boolean().optional(),
  allowStaffLocationOverride: z.boolean().optional(),
  sessionTtlMinutes: z.number().int().min(15).max(1440).optional(),
  maxActiveOrdersPerSession: z.number().int().min(1).max(50).optional(),
  allowNegativeStock: z.boolean().optional(),
  deductStockOn: z.enum(['ORDER_CREATED', 'ORDER_COMPLETED']).optional(),
  splitStationsEnabled: z.boolean().optional(),
  autoAcceptOrders: z.boolean().optional(),
  kitchenSlaMinutes: z.number().int().min(1).max(240).optional(),
  timezone: z.string().max(60).optional(),
  openingHours: openingHoursSchema.optional(),
  active: z.boolean().optional(),
});

export const createBranchSchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(300).nullish(),
  phone: z.string().max(40).nullish(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  serviceRadiusMeters: z.number().int().min(10).max(20000).default(150),
  timezone: z.string().max(60).default('Africa/Tunis'),
});

/* --------------------------------------------------------------- kitchen */

export const kitchenStationSchema = z.object({
  branchId: id,
  name: z.string().min(1).max(60),
  color: z.string().max(20).nullish(),
  sortOrder: z.number().int().min(0).max(99).default(0),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CartLineInputSchema = z.infer<typeof cartLineSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type InventoryItemInput = z.infer<typeof inventoryItemSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
export type PromotionInput = z.infer<typeof promotionSchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type BranchSettingsInput = z.infer<typeof branchSettingsSchema>;

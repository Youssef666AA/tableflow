# Database

PostgreSQL 16 via Prisma. Roughly 30 models; `apps/api/prisma/schema.prisma` is the
source of truth and is commented throughout.

## Conventions

- **UUID primary keys** everywhere.
- **`createdAt` / `updatedAt`** on anything that is edited.
- **Money as integers** in the currency's minor unit. TND has three decimals, so
  `49.500 TND` is `49500`. No floats touch money.
- **Stock as integers** scaled by 1000 on a base unit (g, ml, pcs), so `6.4 kg` is
  `6_400_000` — exact arithmetic under concurrency, at the cost of a documented ceiling
  of about 2 147 kg per line.
- **Foreign keys with deliberate delete behaviour**: `Cascade` where a child cannot
  outlive its parent, `SetNull` where history should survive (an order keeps its item
  rows when a product is archived), `Restrict` where deletion should be refused.
- **Indexes on every access path** a list screen or report uses — `(branchId, status)`,
  `(branchId, createdAt)`, `(tableId, status)`, `(inventoryItemId, createdAt)` and so on.

## The domains

### Identity and tenancy

`User` → `Membership` → `Restaurant`, with `MembershipBranch` narrowing a member to
specific branches (empty means all of them). `RefreshToken` stores hashes with a
`familyId` for rotation and reuse detection. `EmployeeProfile` holds the HR-ish fields.

### Floor

`Branch` → `RestaurantTable` → `TableQrToken` → `TableSession` → `SessionDevice`.

- A table has at most one **active** QR token. Regenerating deactivates the previous row
  rather than overwriting it, so an old printed code stops resolving and the record of
  who rotated what survives.
- A session's `code` is unique **per branch** (`@@unique([branchId, code])`), allocated
  from a per-branch counter. It was briefly globally unique, which was wrong: two
  branches allocating from their own counters collided on `TS-000001`.
- `SessionDevice` is what makes "one bill, but every phone proves its own location"
  possible.

### Menu

`MenuCategory` → `Product` → `ProductVariant`, with `ModifierGroup` / `ModifierOption`
joined through `ProductModifierGroup`. `BranchProductAvailability` overrides a product's
status for a single branch.

Products are **archived, never deleted** (`archivedAt`), because historical order items
reference them.

### Orders

`Order` → `OrderItem` → `OrderItemModifier`, plus `OrderStatusEvent` (the full history)
and `OrderPromotion` (which discounts applied, and for how much).

Order items **denormalise** the product name, variant name and every price at the moment
of sale. A receipt printed a year later must show what was actually sold at what it
actually cost, not what the menu says today.

Two unique constraints carry real weight:

- `@@unique([branchId, number])` — human-readable order numbers, per branch.
- `@@unique([sessionId, idempotencyKey])` — the retry guarantee, enforced by the database
  rather than by application logic.

### Inventory

```
Ingredient  (restaurant-wide catalogue)
   ├─ InventoryItem   (one branch's stock of that ingredient)
   │     └─ StockMovement  (the ledger)
   └─ RecipeIngredient ──▶ Recipe ──▶ Product
```

The catalogue split is load-bearing. Recipes are written once for the restaurant, so a
recipe line must reference an ingredient *concept*; if it referenced a branch's stock row
then a dish could only ever be cooked at that one branch. At order time, consumption
resolves each recipe line to the ordering branch's own `InventoryItem`, and a branch that
does not carry an ingredient simply records no movement rather than failing the order.

`StockMovement` is an append-only ledger — `PURCHASE`, `SALE`, `ADJUSTMENT`, `WASTE`,
`RETURN` — each row carrying the signed change, the resulting balance, a reason, the
actor and any linked order. The balance on `InventoryItem` is a cache of that ledger,
updated in the same transaction, so it can always be reconstructed.

### Money

`Payment` → `Receipt`, with `Order.paymentId` linking settled orders. A receipt stores an
immutable JSON `snapshot` of everything printed on it, so later edits to the menu, the
tax rate or the restaurant's name cannot rewrite history.

### Supporting

`Promotion`, `Notification`, `Review` (one per session, enforced by a unique constraint),
`AuditLog`, `Counter` and `IdempotencyRecord`.

## Migrations

Migrations live in `apps/api/prisma/migrations` and are applied with
`prisma migrate deploy`. They are generated offline against the schema:

```bash
npm run db:migrate:create      # prisma migrate diff -> a new timestamped folder
```

Data-shape changes are hand-finished so they **backfill rather than destroy**. The
ingredient-catalogue migration, for example, creates the catalogue from existing
inventory, backfills both `InventoryItem.ingredientId` and
`RecipeIngredient.ingredientId`, and only then drops the old column — a deployment with
live data keeps it.

`npm run db:reset` drops the schema, re-applies every migration and reseeds. The seed
itself is a no-op against a database that already holds a restaurant unless
`FORCE_SEED=true`, so bringing the stack up twice never destroys data.

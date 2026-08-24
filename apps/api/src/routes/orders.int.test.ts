import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

/**
 * Integration tests against a real PostgreSQL with the demo data seeded.
 *
 *   npm run db:local          (or docker compose up postgres)
 *   npm run db:migrate && npm run db:seed
 *   npm run test:integration
 */

const app = createApp();

interface BranchFixture {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  tables: Array<{ id: string; number: string; token: string }>;
}

let branches: BranchFixture[] = [];
let recipeProductName = '';

/**
 * The duplicate-order guard compares a fingerprint of the cart, so two runs of
 * this suite within the same two-minute window would look like duplicates of
 * each other. Stamping every line with a per-run nonce keeps each run distinct
 * while leaving the duplicate test — which reuses the same nonce — meaningful.
 */
const RUN = `int-${Date.now().toString(36)}`;
const line = (
  product: { id: string; modifierGroups: Array<{ required: boolean; minSelect: number; options: Array<{ id: string }> }> },
  quantity = 1,
) => ({
  productId: product.id,
  quantity,
  modifierOptionIds: requiredOptions(product),
  notes: RUN,
});

async function startSession(branch: BranchFixture, tableIndex: number, deviceKey: string) {
  const table = branch.tables[tableIndex];
  const started = await request(app)
    .post('/api/table-sessions/start')
    .send({ token: table.token, deviceKey });
  expect(started.status).toBe(200);

  const sessionToken = started.body.sessionToken as string;

  const verified = await request(app)
    .post('/api/customer/session/verify-location')
    .set('Authorization', `Bearer ${sessionToken}`)
    .send({ latitude: branch.latitude, longitude: branch.longitude, simulate: true });
  expect(verified.status).toBe(200);

  return { sessionToken, table };
}

async function menuFor(sessionToken: string) {
  const response = await request(app)
    .get('/api/customer/menu')
    .set('Authorization', `Bearer ${sessionToken}`);
  expect(response.status).toBe(200);
  return response.body as {
    products: Array<{
      id: string;
      name: string;
      basePrice: number;
      status: string;
      variants: Array<{ id: string; name: string; priceDelta: number }>;
      modifierGroups: Array<{
        id: string;
        name: string;
        required: boolean;
        minSelect: number;
        options: Array<{ id: string; name: string; priceDelta: number }>;
      }>;
    }>;
  };
}

/** Satisfies every required modifier group so the line is valid. */
function requiredOptions(product: { modifierGroups: Array<{ required: boolean; minSelect: number; options: Array<{ id: string }> }> }) {
  return product.modifierGroups
    .filter((group) => group.required || group.minSelect > 0)
    .map((group) => group.options[0].id);
}

beforeAll(async () => {
  const rows = await prisma.branch.findMany({
    orderBy: { name: 'asc' },
    include: {
      tables: {
        where: { outOfService: false },
        orderBy: { number: 'asc' },
        include: { qrTokens: { where: { active: true }, take: 1 } },
      },
    },
  });

  if (rows.length === 0) {
    throw new Error('No branches found — run `npm run db:seed` before the integration tests.');
  }

  branches = rows.map((branch) => ({
    id: branch.id,
    name: branch.name,
    latitude: branch.latitude,
    longitude: branch.longitude,
    tables: branch.tables
      .filter((table) => table.qrTokens[0])
      .map((table) => ({ id: table.id, number: table.number, token: table.qrTokens[0].token })),
  }));

  // These tests exercise pricing, inventory and session logic — not opening
  // hours — so a branch that happens to be closed at whatever minute this
  // suite runs must never turn into a spurious RESTAURANT_CLOSED failure.
  // Force every branch open for the duration of the run.
  const OPEN_ALL_WEEK = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    closed: false,
    opensAt: '00:00',
    closesAt: '23:59',
  }));
  await prisma.branch.updateMany({
    where: { id: { in: rows.map((b) => b.id) } },
    data: { openingHours: OPEN_ALL_WEEK },
  });

  // A product whose recipe actually consumes stock, so deductions are observable.
  const recipe = await prisma.recipe.findFirst({
    where: { ingredients: { some: {} } },
    include: { product: { select: { name: true, status: true } } },
  });
  if (!recipe) throw new Error('No recipes found — run `npm run db:seed`.');
  recipeProductName = recipe.product.name;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('multi-branch ordering', () => {
  /**
   * Regression: recipes belong to the restaurant while stock belongs to a
   * branch. Before the ingredient catalogue existed, every recipe line pointed
   * at one branch's stock row, so ordering anywhere else failed with
   * "That inventory item belongs to another branch."
   */
  it('accepts an order at every branch and deducts that branch’s own stock', async () => {
    expect(branches.length).toBeGreaterThan(1);

    for (const branch of branches) {
      const { sessionToken } = await startSession(branch, 8, `int-mb-${branch.id.slice(0, 8)}`);
      const menu = await menuFor(sessionToken);

      const product = menu.products.find((p) => p.name === recipeProductName && p.status === 'AVAILABLE');
      expect(product, `${recipeProductName} should be orderable at ${branch.name}`).toBeTruthy();

      const ingredient = await prisma.recipeIngredient.findFirstOrThrow({
        where: { recipe: { product: { name: recipeProductName } } },
        include: { ingredient: true },
      });

      const before = await prisma.inventoryItem.findUnique({
        where: { branchId_ingredientId: { branchId: branch.id, ingredientId: ingredient.ingredientId } },
        select: { quantity: true },
      });

      const placed = await request(app)
        .post('/api/customer/orders')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({
          lines: [line(product!)],
          idempotencyKey: `int-mb-${Date.now()}-${branch.id.slice(0, 6)}`,
        });

      expect(placed.status, `${branch.name}: ${JSON.stringify(placed.body.error ?? {})}`).toBe(201);

      if (before) {
        const after = await prisma.inventoryItem.findUniqueOrThrow({
          where: { branchId_ingredientId: { branchId: branch.id, ingredientId: ingredient.ingredientId } },
          select: { quantity: true },
        });
        expect(after.quantity).toBeLessThan(before.quantity);
      }
    }
  });

  it('never lets one branch consume another branch’s stock', async () => {
    const [first, second] = branches;
    const ingredient = await prisma.recipeIngredient.findFirstOrThrow({
      where: { recipe: { product: { name: recipeProductName } } },
    });

    const otherBefore = await prisma.inventoryItem.findUniqueOrThrow({
      where: { branchId_ingredientId: { branchId: second.id, ingredientId: ingredient.ingredientId } },
      select: { quantity: true },
    });

    const { sessionToken } = await startSession(first, 9, `int-iso-${first.id.slice(0, 8)}`);
    const menu = await menuFor(sessionToken);
    const product = menu.products.find((p) => p.name === recipeProductName && p.status === 'AVAILABLE')!;

    const placed = await request(app)
      .post('/api/customer/orders')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({
        lines: [line(product)],
        idempotencyKey: `int-iso-${Date.now()}`,
      });
    expect(placed.status).toBe(201);

    const otherAfter = await prisma.inventoryItem.findUniqueOrThrow({
      where: { branchId_ingredientId: { branchId: second.id, ingredientId: ingredient.ingredientId } },
      select: { quantity: true },
    });
    expect(otherAfter.quantity).toBe(otherBefore.quantity);
  });
});

describe('order creation guarantees', () => {
  it('prices from the database and ignores anything the client claims', async () => {
    const branch = branches[0];
    const { sessionToken } = await startSession(branch, 10, `int-price-${branch.id.slice(0, 8)}`);
    const menu = await menuFor(sessionToken);
    const product = menu.products.find((p) => p.status === 'AVAILABLE' && p.variants.length === 0)!;

    const placed = await request(app)
      .post('/api/customer/orders')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({
        lines: [
          {
            ...line(product),
            // All of these are attacker-supplied and must be ignored.
            basePrice: 1,
            unitPrice: 1,
            lineTotal: 1,
          },
        ],
        total: 1,
        subtotal: 1,
        idempotencyKey: `int-price-${Date.now()}`,
      });

    expect(placed.status).toBe(201);
    const expected =
      product.basePrice +
      product.modifierGroups
        .filter((g) => g.required || g.minSelect > 0)
        .reduce((sum, g) => sum + g.options[0].priceDelta, 0);
    expect(placed.body.order.total).toBe(expected);
  });

  it('returns the original order when the same idempotency key is retried', async () => {
    const branch = branches[0];
    const { sessionToken } = await startSession(branch, 11, `int-idem-${branch.id.slice(0, 8)}`);
    const menu = await menuFor(sessionToken);
    const product = menu.products.find((p) => p.status === 'AVAILABLE')!;
    const key = `int-idem-${Date.now()}`;
    const body = { lines: [line(product)], idempotencyKey: key };

    const first = await request(app)
      .post('/api/customer/orders')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send(body);
    const second = await request(app)
      .post('/api/customer/orders')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.reused).toBe(true);
    expect(second.body.order.id).toBe(first.body.order.id);
  });

  it('flags an identical order placed moments later as a suspected duplicate', async () => {
    const branch = branches[0];
    const { sessionToken } = await startSession(branch, 12, `int-dup-${branch.id.slice(0, 8)}`);
    const menu = await menuFor(sessionToken);
    const product = menu.products.find((p) => p.status === 'AVAILABLE')!;
    const lines = [line(product)];

    const first = await request(app)
      .post('/api/customer/orders')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ lines, idempotencyKey: `int-dup-a-${Date.now()}` });
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post('/api/customer/orders')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ lines, idempotencyKey: `int-dup-b-${Date.now()}` });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_ORDER');

    // The guest can confirm they really do want it again.
    const confirmed = await request(app)
      .post('/api/customer/orders')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ lines, idempotencyKey: `int-dup-c-${Date.now()}`, confirmDuplicate: true });
    expect(confirmed.status).toBe(201);
  });

  it('refuses to order before this device has verified its location', async () => {
    const branch = branches[0];
    const table = branch.tables[13];
    const started = await request(app)
      .post('/api/table-sessions/start')
      .send({ token: table.token, deviceKey: `int-unverified-${Date.now()}` });
    expect(started.status).toBe(200);
    expect(started.body.verified).toBe(false);

    const blocked = await request(app)
      .post('/api/customer/orders')
      .set('Authorization', `Bearer ${started.body.sessionToken}`)
      .send({ lines: [{ productId: 'anything', quantity: 1 }], idempotencyKey: `int-unv-${Date.now()}` });

    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('LOCATION_REQUIRED');
  });

  it('rejects a location outside the service radius', async () => {
    const branch = branches[0];
    const table = branch.tables[14];
    const started = await request(app)
      .post('/api/table-sessions/start')
      .send({ token: table.token, deviceKey: `int-far-${Date.now()}` });

    const far = await request(app)
      .post('/api/customer/session/verify-location')
      .set('Authorization', `Bearer ${started.body.sessionToken}`)
      .send({ latitude: 48.8566, longitude: 2.3522, accuracy: 10 });

    expect(far.status).toBe(403);
    expect(far.body.error.code).toBe('LOCATION_OUT_OF_RANGE');
    expect(far.body.error.details.distanceMeters).toBeGreaterThan(1_000_000);
  });
});

describe('table isolation', () => {
  it('never exposes another table’s orders', async () => {
    const branch = branches[0];
    const a = await startSession(branch, 15, `int-iso-a-${Date.now()}`);
    const b = await startSession(branch, 16, `int-iso-b-${Date.now()}`);

    const menu = await menuFor(a.sessionToken);
    const product = menu.products.find((p) => p.status === 'AVAILABLE')!;

    const placed = await request(app)
      .post('/api/customer/orders')
      .set('Authorization', `Bearer ${a.sessionToken}`)
      .send({
        lines: [line(product)],
        idempotencyKey: `int-iso-order-${Date.now()}`,
      });
    expect(placed.status).toBe(201);

    const stolen = await request(app)
      .get(`/api/customer/orders/${placed.body.order.id}`)
      .set('Authorization', `Bearer ${b.sessionToken}`);
    expect(stolen.status).toBe(404);

    const list = await request(app)
      .get('/api/customer/orders')
      .set('Authorization', `Bearer ${b.sessionToken}`);
    expect(list.body.orders.every((o: { id: string }) => o.id !== placed.body.order.id)).toBe(true);
  });
});

describe('QR tokens', () => {
  it('rejects a token that does not exist', async () => {
    const response = await request(app)
      .post('/api/table-sessions/start')
      .send({ token: 'a'.repeat(43) });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('QR_INVALID');
  });

  it('stops accepting a token once it has been revoked', async () => {
    const branch = branches[branches.length - 1];
    const table = branch.tables[17];

    await prisma.tableQrToken.updateMany({
      where: { tableId: table.id, active: true },
      data: { active: false, revokedAt: new Date() },
    });

    const response = await request(app).post('/api/table-sessions/start').send({ token: table.token });
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('QR_REVOKED');

    // Restore so repeated runs stay deterministic.
    await prisma.tableQrToken.updateMany({
      where: { tableId: table.id, token: table.token },
      data: { active: true, revokedAt: null },
    });
  });
});

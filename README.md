# TableFlow

**Scan. Order. Serve.**

A guest scans the QR code on their table, orders in seconds and watches the kitchen work.
Staff see every order, request and table as it happens. Owners see what it all adds up to.

TableFlow is a working restaurant operations platform, not a QR menu: table sessions,
a kitchen display, a waiter floor plan, billing, inventory that moves when food is
ordered, employees with real permissions, and analytics computed from actual records.

It runs with **no external API keys**. Payments, email, maps and AI integrations are
optional adapters, all off by default.

---

## Table of contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Running it](#running-it)
  - [With Docker (recommended)](#with-docker-recommended)
  - [Without Docker](#without-docker)
- [Demo credentials](#demo-credentials)
- [Trying the demo story](#trying-the-demo-story)
- [Testing](#testing)
- [Environment variables](#environment-variables)
- [Security](#security)
- [API overview](#api-overview)
- [Deployment notes](#deployment-notes)
- [Known limitations](#known-limitations)

---

## What it does

### For the guest — a phone-first ordering app

Scan → the server resolves the QR token to a restaurant, branch and table → a table
session opens → the device proves it is at the restaurant → menu → customise → cart →
order → live status → call a waiter → request the bill → pay → receipt → review.

The guest never picks their own table, never sees a table id in a URL they could edit,
and never has to create an account.

### For staff — three purpose-built surfaces

- **Kitchen display** — dark, high-contrast, three columns (New / Preparing / Ready),
  live timers that turn amber then red against the branch's target prep time, optional
  per-station queues (Pizza, Grill, Drinks…).
- **Waiter floor** — an interactive 2D floor plan and a dense grid view, with what needs
  a person right now surfaced first: food that is ready, and open service requests.
- **Billing** — open tabs, split bills, cash/card recording and simulated online payment,
  with a PDF receipt at the end.

### For management — the business

Menu and modifier editing, tables and QR code management (including a printable sheet),
inventory with recipes and a full stock ledger, employees with role-based access,
promotions, reviews, settings, and analytics computed live from orders, sessions, stock
movements and service requests.

---

## Architecture

```
                         ┌──────────────────────────────┐
   guest phone  ────────▶│                              │
   kitchen display ─────▶│   web (React SPA, 3 bundles) │
   management console ──▶│   customer · staff · admin   │
                         └───────────────┬──────────────┘
                                         │ REST + WebSocket (same origin via nginx)
                         ┌───────────────▼──────────────┐
                         │   api (Express + TypeScript) │
                         │   ├─ routes    (HTTP surface)│
                         │   ├─ services  (domain)      │
                         │   ├─ realtime  (Socket.IO)   │
                         │   └─ queue     (BullMQ)      │
                         └───────┬───────────────┬──────┘
                                 │               │
                      ┌──────────▼─────┐   ┌─────▼──────┐
                      │   PostgreSQL   │   │   Redis    │
                      │   (Prisma)     │   │ (optional) │
                      └────────────────┘   └────────────┘
                                 ▲
                         ┌───────┴────────┐
                         │  worker        │
                         │  session sweep │
                         │  stock alerts  │
                         │  kitchen SLA   │
                         └────────────────┘
```

Three principles run through it:

1. **The server decides.** Prices, totals, discounts, tax, table identity, permissions
   and stock are computed from database rows. Anything the client sends about money or
   identity is ignored.
2. **State machines, not free-form updates.** Orders, sessions, service requests and
   payments each have an explicit transition table; anything not listed is refused.
   Table status is *derived* from live sessions and orders, so the floor plan can never
   disagree with reality.
3. **Commit, then broadcast.** A realtime event is only emitted after its database
   transaction has committed, so no client ever sees a change that did not happen.

Deeper write-ups live in [`docs/`](./docs).

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, React Hook Form + Zod, Framer Motion, Recharts, Lucide |
| Backend | Node.js, TypeScript, Express, Socket.IO |
| Database | PostgreSQL 16 via Prisma ORM |
| Background jobs | BullMQ + Redis, with an in-process scheduler fallback |
| Auth | JWT access tokens + rotating refresh tokens, bcrypt password hashing |
| Testing | Vitest, Supertest, Playwright |
| Infrastructure | Docker, Docker Compose, nginx |

Money is stored as integers in the currency's minor unit (TND has three decimals, so
`49.500 TND` is `49500`). Stock is stored as integers scaled by 1000 on a base unit.
There are no floats anywhere near money or inventory.

---

## Running it

### With Docker (recommended)

```bash
cp .env.example .env      # optional — the compose defaults already work
docker compose up --build
```

| Service | URL |
| --- | --- |
| Web app | http://localhost:8080 |
| API health | http://localhost:4000/api/health |
| QR Test Center | http://localhost:8080/dev/qr |

On first boot the `migrate` service applies the schema and seeds the demo restaurant,
then exits. The API and worker wait for it. Bringing the stack up again **never** wipes
data — the seed is a no-op on a database that already holds a restaurant. To force a
reseed: `FORCE_SEED=true docker compose up migrate`.

nginx serves the app and proxies `/api` and `/socket.io` to the API, so the browser
makes no cross-origin requests at all.

### Without Docker

You need Node 20+. A PostgreSQL is bundled — no install required.

```bash
npm install

# terminal 1 — embedded PostgreSQL (real Postgres compiled to WebAssembly)
npm run db:local           # applies migrations on boot

# terminal 2 — seed the demo restaurant, then run both apps
npm run db:seed
npm run dev                # api on :4000, web on :5173
```

Then open <http://localhost:5173>.

If you already have a PostgreSQL, point `DATABASE_URL` at it instead and use
`npm run db:migrate && npm run db:seed`.

**Useful scripts**

| Command | Does |
| --- | --- |
| `npm run dev` | API and web together |
| `npm run db:local` | Embedded PostgreSQL on :5433 |
| `npm run db:seed` | Seed the demo restaurant (skips a populated database) |
| `npm run db:reset` | Drop, migrate and reseed |
| `npm run db:migrate:create` | Generate a new migration from schema changes |
| `npm run typecheck` | Typecheck every workspace |
| `npm run lint` | ESLint across the repo |
| `npm test` | Unit + integration tests |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run build` | Production build of everything |

---

## Demo credentials

Every seeded account uses the password **`TableFlow!2024`** (set by `SEED_PASSWORD`).

| Email | Role | Lands on |
| --- | --- | --- |
| `owner@tableflow.local` | Owner | Management dashboard |
| `admin@tableflow.local` | Admin | Management dashboard |
| `manager@tableflow.local` | Manager | Management dashboard |
| `waiter@tableflow.local` | Waiter | Floor plan |
| `kitchen@tableflow.local` | Kitchen | Kitchen display |
| `cashier@tableflow.local` | Cashier | Billing |
| `inventory@tableflow.local` | Inventory | Inventory |

Sign in at `/staff/login`. These are development credentials; the seed refuses to run
in production and `DEMO_MODE` is force-disabled whenever `NODE_ENV=production`.

**Seeded data**: Big Ben Café with three branches (Sousse, Monastir, Tunis), 76 tables
with QR codes, 44 products across 7 categories with variants and modifiers, 25 catalogue
ingredients with recipes, ~1 350 orders across 30 days, reviews, waste and stock history.

---

## Trying the demo story

Printing QR codes is impractical while developing, so open the **QR Test Center** at
`/dev/qr`. Pick a branch and a table and it hands you a working guest link carrying the
same secure token the printed code would.

1. Open the QR Test Center and launch **table 03** of the Sousse branch.
2. Tap **Simulate being at the restaurant** (demo mode only — production uses real GPS).
3. Browse the menu, open a dish, choose its options, add it to the cart.
4. Place the order and watch the live tracker.
5. In another window, sign in as `kitchen@tableflow.local` and open the kitchen display.
   The order is already there. Press **Accept**, then **Start preparing**, then **Mark ready** —
   the guest's tracker follows along without a refresh.
6. Sign in as `waiter@tableflow.local` to see the table light up on the floor plan, then
   mark the order delivered.
7. As the guest, tap **Service → Call waiter**, then **Bill**. Pay with the test card
   `4242 4242 4242 4242`, download the PDF receipt and leave a review.
8. As `cashier@tableflow.local`, close the table; it returns to *Available* once cleared.
9. As `owner@tableflow.local`, watch the dashboard figures move.

Test cards for the simulated provider: `4242…4242` approves, `4000…0002` is declined by
the issuer, `4000…9995` reports insufficient funds.

---

## Testing

```bash
npm test                  # 77 unit + integration tests
npm run test:e2e          # 8 Playwright journeys
```

- **Unit** (`apps/api/src/domain/*.unit.test.ts`) — the pricing engine (line arithmetic,
  modifier rules, tax inclusive/exclusive, promotion scoping, priority, caps and
  proportional allocation), distance and radius checks, all four state machines, RBAC,
  money formatting and split-bill rounding, unit conversion and recipe aggregation,
  opening hours including windows that cross midnight.
- **Integration** (`apps/api/src/routes/*.int.test.ts`) — Supertest against a real
  PostgreSQL: ordering at every branch, per-branch stock isolation, server-side pricing
  ignoring client-supplied amounts, idempotent retries, duplicate detection, the location
  gate, cross-table isolation, and QR revocation.
- **End-to-end** (`e2e/`) — Playwright on a phone viewport for the guest and a desktop
  viewport for staff, including a two-context test where a guest orders in one browser
  and the kitchen advances it in another, asserting the guest's tracker updates live.

Integration and E2E tests need a seeded database running (`npm run db:local && npm run db:seed`).

---

## Environment variables

Copy `.env.example` to `.env`. Nothing beyond the first three is required.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` / `JWT_SESSION_SECRET` | Token signing keys. The API refuses to start in production if these still contain a development placeholder |
| `WEB_URL` | Origin used to build QR links and to allow CORS |
| `REDIS_URL` | Optional. Without it, background jobs run on an in-process scheduler |
| `DEMO_MODE` | Enables the QR Test Center and the simulate-location shortcut. Force-disabled in production |
| `SEED_PASSWORD` | Password for the seeded demo accounts |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS` | Token lifetimes |
| `RUN_WORKER_IN_PROCESS` | `false` when running a separate worker container |
| `INTEGRATION_*_ENABLED` | Feature flags for the optional adapters — all off by default |

---

## Security

- **QR tokens** are 256-bit random URL-safe strings. The URL carries nothing else — no
  table number, no branch id — so there is nothing for a guest to tamper with.
  Regenerating a code revokes the previous one in the same transaction.
- **Table sessions** are bearer JWTs carrying an opaque session id and device id. The
  table, branch and restaurant are re-read from the database on every request.
- **Location is verified per device**, not per table. Several guests share one session so
  their orders land on one bill, but each phone proves for itself that it is at the
  restaurant, with GPS accuracy widening the radius up to a capped amount. Repeated
  failures block that device. Location is one signal among several, never the only one.
- **Every price is computed server-side** from database rows. Amounts, totals and
  discounts in a request body are ignored entirely.
- **Idempotency** on order placement and payment: a retry returns the original result.
  A second identical cart within two minutes is flagged as a suspected duplicate and
  needs explicit confirmation.
- **RBAC is enforced on the server** for every request. Client-side hiding is a courtesy.
  Role changes take effect on the next request, not when the token expires.
- **Refresh tokens rotate**, are stored hashed, and reuse of a spent token revokes the
  entire family.
- **Rate limits** on sign-in, QR scans, order placement (10/min per session), and
  service requests.
- **Audit log** for sign-ins, menu and price changes, availability, stock, order and
  payment status, role changes, QR regeneration and table status.
- Passwords are hashed with bcrypt; IPs are stored only as HMAC digests; helmet sets
  strict headers and the API's CSP is `default-src 'none'` since it only serves JSON,
  PDFs and PNGs.

Full detail in [`docs/security.md`](./docs/security.md).

---

## API overview

All routes are under `/api`. Staff routes take `Authorization: Bearer <access token>`;
guest routes take a table-session token in the same header.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `POST /auth/change-password` |
| Table sessions | `POST /table-sessions/start`, `GET /customer/session`, `POST /customer/session/verify-location`, `PATCH /customer/session` |
| Guest ordering | `GET /customer/menu`, `POST /customer/cart/quote`, `POST /customer/orders`, `GET /customer/orders[/:id]` |
| Guest service | `POST|GET /customer/service-requests`, `GET /customer/bill`, `POST /customer/bill/pay`, `GET /customer/receipts/:id[/pdf]`, `GET|POST /customer/review` |
| Tables & QR | `GET|POST /tables`, `PUT|DELETE /tables/:id`, `POST /tables/positions`, `GET /tables/:id/qr`, `POST /tables/:id/regenerate-qr`, `GET /tables/qr/sheet.pdf`, `POST /tables/sessions/:id/close` |
| Orders | `GET /orders`, `GET /orders/:id`, `POST /orders`, `PATCH /orders/:id/status`, `PATCH /orders/items/:id/status` |
| Kitchen | `GET /kitchen/orders`, `PATCH /kitchen/orders/:id/{accept,start,ready,reject}`, `GET|POST /kitchen/stations` |
| Service requests | `GET /service-requests`, `PATCH /service-requests/:id/status`, `POST /service-requests/:id/{acknowledge,start,complete,cancel}` |
| Billing | `GET /billing/open`, `GET /billing/sessions/:id`, `POST /billing/sessions/:id/payments`, `POST /billing/payments/:id/refund`, `GET /billing/receipts[/:id[/pdf]]` |
| Menu | `GET /menu`, `POST|PUT|DELETE /menu/products[/:id]`, `PATCH /menu/products/:id/availability`, `POST|PUT|DELETE /menu/categories`, `GET|POST /menu/modifier-groups` |
| Inventory | `GET /inventory`, `GET /inventory/items/:id`, `POST|PUT /inventory/items`, `POST|GET /inventory/movements`, `GET /inventory/ingredients`, `GET|PUT /inventory/recipes/:productId`, `GET|POST /inventory/suppliers` |
| Employees | `GET|POST /employees`, `PUT|DELETE /employees/:membershipId` |
| Analytics | `GET /analytics/{overview,sales,kitchen,tables,inventory,reviews}` |
| Other | `/notifications`, `/reviews`, `/promotions`, `/settings`, `/audit`, `/dev` (demo mode only) |

---

## Deployment notes

- Set `NODE_ENV=production`, supply real secrets, and leave `DEMO_MODE` off. The API
  refuses to boot with placeholder secrets and force-disables demo mode regardless.
- Put the API behind TLS and set `TRUST_PROXY=true` so client IPs and rate limits work.
- Run the worker as a separate process (`npm run start:worker`) with
  `RUN_WORKER_IN_PROCESS=false` on the API, and provide `REDIS_URL` so jobs survive a
  restart and only run once across replicas.
- Apply migrations with `npx prisma migrate deploy` before rolling out new API instances.
- `WEB_URL` must be the public origin — printed QR codes embed it.
- Both containers expose a `HEALTHCHECK`; the API's `/api/health` reports database and
  queue status and returns 503 when the database is unreachable.

---

## Known limitations

Stated plainly, because a demo that overclaims is worse than one that does less:

- **Payments are simulated.** The bundled provider is a real state machine over this
  database with deterministic test cards, but it contacts no card network and moves no
  money. Receipts label such payments as simulated. `PaymentProvider` is the seam a real
  gateway would implement.
- **Split bills are equal-share.** The schema and the proportional line-level discount
  allocation support item-level splitting; the UI does not expose it yet.
- **Product photography is not included.** Where a product has no `imageUrl`, the UI
  draws a deterministic gradient plate with a dish glyph rather than a broken frame.
  Real photos work — set `imageUrl` and they are used.
- **The embedded PostgreSQL is a convenience, not the supported path.** PGlite serves a
  single backend, so it handles one client at a time; the server applies migrations
  in-process and refuses queued clients after a timeout rather than wedging. Docker
  Compose with a real PostgreSQL is the supported setup.
- **Optional integrations are interfaces only.** Email, WhatsApp, Stripe, Maps and AI
  are feature-flagged adapter seams with no implementations — nothing in the product
  depends on them.
- **Analytics are computed on demand.** At the seeded scale (~1 350 orders) queries are
  fast; a busy multi-year deployment would want materialised daily rollups.
- **The customer app is installable and caches its shell**, but ordering deliberately
  requires a live connection. It will never pretend an order succeeded offline.

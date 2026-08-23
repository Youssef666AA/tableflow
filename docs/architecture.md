# Architecture

## Shape of the repository

```
tableflow/
├─ packages/shared/        domain logic shared by server and client
├─ apps/api/               Express API, Socket.IO, worker, Prisma schema, seed
├─ apps/web/               React SPA: customer, staff and admin route trees
├─ e2e/                    Playwright journeys
└─ docker-compose.yml      postgres · redis · migrate · api · worker · web
```

`packages/shared` is the interesting one. It holds the pieces that must mean the same
thing on both sides of the wire:

| Module | Responsibility |
| --- | --- |
| `pricing.ts` | The pricing engine: line arithmetic, modifier validation, promotions, tax and service charge |
| `state-machines.ts` | Legal transitions for orders, sessions, service requests and payments; derived table status |
| `permissions.ts` | The role → permission matrix and role-assignment rules |
| `money.ts` | Minor-unit arithmetic, formatting and even splitting |
| `geo.ts` | Haversine distance and the radius check |
| `inventory.ts` | Unit normalisation and recipe consumption aggregation |
| `time.ts` | Opening hours (including windows past midnight) and kitchen urgency |
| `schemas.ts` | Zod schemas for every request payload |

The client imports these to render an *optimistic preview*. The server imports the same
functions and runs them against database rows, and its answer is the one that is stored.
That is the point: one implementation, no drift, and no trust placed in the client.

## Backend layering

```
routes/      HTTP surface: validation, authn/authz, serialisation
services/    domain operations, transactions, realtime emission
lib/         prisma client, jwt, crypto, errors, logging
realtime/    Socket.IO server, rooms, authenticated handshake
queue/       BullMQ driver with an in-process fallback
```

Routes never touch Prisma for anything more than a simple read; anything that changes
state goes through a service so the transaction boundary, the audit entry and the
realtime event stay together.

### Transactions

Every operation that touches more than one table runs inside `prisma.$transaction`:
order creation (order + items + modifiers + promotions + stock movements + counters +
table status + audit), payment settlement (payment + order links + receipt + table
status), session closure, and stock movements (balance + ledger row).

Realtime events are emitted **after** the transaction returns. A service computes what
changed, commits, and only then broadcasts — so a client can never observe a change that
was subsequently rolled back.

### Counters

Order numbers and receipt numbers come from a `Counter` table incremented with
`INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the caller's transaction. Two orders
placed in the same millisecond cannot collide.

## Frontend structure

Three route trees, three lazily-loaded bundles:

| Route | Bundle | Surface |
| --- | --- | --- |
| `/t/:token/*` | `CustomerApp` | Phone-first guest app |
| `/staff/*` | `StaffApp` | Kitchen display, floor, orders, requests, billing |
| `/admin/*` | `AdminApp` | Menu, tables, QR, inventory, employees, analytics, settings |

A guest on a phone never downloads the analytics console or the chart library; the
kitchen display never downloads the cart. The customer bundle is ~84 kB (~22 kB gzipped).

### Design tokens

Every colour is a CSS custom property. Three surfaces re-theme the same vocabulary by
setting `data-surface` on the root element:

- `default` — the management console: cool, dense, professional.
- `customer` — warm off-white, softer contrast, food-first.
- `kitchen` — near-black, maximum contrast, readable across a hot line.

Components reference `bg-surface`, `text-ink-muted`, `border-line` and so on. No
component contains a raw hex value, so re-theming is a token change rather than a sweep.

### Data fetching

TanStack Query owns server state. Socket events invalidate query keys rather than
patching caches by hand, so a reconnect after a dropped connection converges on the
truth instead of on a partially-applied patch stream. Polling remains as a slow safety
net (30–90 s) for the case where the socket is down entirely.

## Background work

Four recurring jobs: expiring stale table sessions, scanning for low stock, flagging
orders past the kitchen SLA, and pruning expired tokens and read notifications.

The queue has two drivers behind one interface. With `REDIS_URL` set it uses BullMQ, so
jobs are durable and run once across replicas. Without it, an in-process scheduler runs
the same handlers on the same cadence — a real scheduler, not a stub. What it gives up
is durability and cross-process fan-out, which is the right trade for a single-node dev
or demo box, and nothing in the product requires Redis to exist.

## Multi-branch model

A restaurant owns branches. Menu, categories, modifier groups, promotions and the
ingredient catalogue are **restaurant-level**. Tables, sessions, orders, stock,
suppliers, kitchen stations and staff assignments are **branch-level**.

Two consequences worth naming:

- A product's availability can be overridden per branch (`BranchProductAvailability`),
  so 86'ing a dish in one branch does not affect the others.
- A recipe references the **ingredient catalogue**, never a branch's stock row. At order
  time the consumption logic resolves each recipe line to the ordering branch's own
  stock. Without that split, a dish could only be cooked at whichever branch the recipe
  happened to point at.

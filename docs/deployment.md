# Deployment

## What ships

Two images, built from the repository root so npm workspaces resolve:

| Image | Contents | Serves |
| --- | --- | --- |
| `apps/api/Dockerfile` | Node 22 Alpine, compiled API, Prisma client and CLI, tini for signals | `:4000` |
| `apps/web/Dockerfile` | nginx serving the built SPA and proxying `/api` and `/socket.io` | `:80` |

Both are multi-stage: a builder installs the full workspace, compiles, and prunes dev
dependencies; the runtime stage copies only what is needed. Both declare a `HEALTHCHECK`.

The same API image runs three roles, selected by command:

```
node dist/index.js                                    # API + Socket.IO
node dist/worker.js                                   # background jobs
sh -c "npx prisma migrate deploy && node dist/seed/index.js"   # one-shot migrate + seed
```

## Compose

```bash
docker compose up --build
```

Brings up postgres, redis, a one-shot `migrate` job, the api, the worker and nginx. The
api and worker wait for `migrate` to complete successfully, and for both datastores to
report healthy.

The seed is a no-op on a database that already holds a restaurant, so `docker compose up`
is safe to re-run. Force it with `FORCE_SEED=true docker compose up migrate`.

nginx serves the app and proxies the API on the same origin, which means the browser
makes no cross-origin request at all — no CORS preflights, one hostname in the printed QR
codes, and WebSocket upgrades pass through untouched.

## Going to production

**Secrets.** Generate real ones:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Set `JWT_SECRET`, `JWT_REFRESH_SECRET` and `JWT_SESSION_SECRET`. The API refuses to boot
in production if any still contains a development placeholder.

**`NODE_ENV=production`.** This also force-disables `DEMO_MODE`, which removes the QR
Test Center and the simulate-location shortcut regardless of what `.env` says.

**`WEB_URL` must be the public origin.** Printed QR codes embed it, so changing it later
means reprinting every code.

**TLS and `TRUST_PROXY=true`.** Behind a load balancer the API needs to trust
`X-Forwarded-For`, or rate limiting and audit IP hashing all see the proxy's address.

**Run the worker separately.** Set `RUN_WORKER_IN_PROCESS=false` on the API and run
`node dist/worker.js` as its own service, with `REDIS_URL` configured so jobs are durable
and run exactly once across replicas.

**Migrations.** Run `npx prisma migrate deploy` before rolling out new API instances.
Migrations are written to backfill rather than destroy, so they are safe against live
data, but they should still be applied by a single job rather than by every replica.

## Scaling notes

| Component | Today | To scale |
| --- | --- | --- |
| API | one process, in-memory rate-limit store | several replicas behind a load balancer, Redis-backed rate limiting, a Redis Socket.IO adapter so rooms span processes |
| Worker | one process | BullMQ already handles several workers; increase concurrency or replicas |
| Postgres | single instance | connection pooler, read replica for analytics |
| Web | nginx | any CDN — the build is static and the assets are content-hashed |
| Analytics | computed on demand | materialised daily rollups once history outgrows on-demand aggregation |

## Backups

Everything that matters is in PostgreSQL. `pg_dump` covers it; the Redis volume holds
only transient job state. The two things that hurt to lose are `TableQrToken` rows
(losing them means reprinting every code) and `Receipt.snapshot` (immutable financial
records).

## Observability

- `GET /api/health` reports the database and queue status, the environment, and whether
  demo mode is on. It returns 503 when the database is unreachable, so it works as both a
  liveness and readiness probe.
- Structured JSON logs via pino, with request ids echoed in the `x-request-id` response
  header and included in every error body, so a user-reported failure can be traced to a
  single request.
- The audit log is the record of who changed what; the stock ledger is the record of
  where inventory went.

## Running without Docker

Node 20+ and a PostgreSQL:

```bash
npm ci
npm run build
npm run db:migrate
npm run db:seed
node apps/api/dist/index.js       # API
npx serve apps/web/dist           # or any static host
```

If there is no PostgreSQL to hand, `npm run db:local` starts an embedded one (real
PostgreSQL compiled to WebAssembly) that applies migrations on boot. It serves a single
client at a time, which is fine for development and demos but is explicitly not the
supported production path.

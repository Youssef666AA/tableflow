import { Router } from 'express';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../middleware/common.js';
import { ensureQrToken, qrUrlFor } from '../services/qr.js';
import { queueKind } from '../queue/index.js';
import { PRODUCTS } from '../seed/data.js';

/**
 * QR Test Center.
 *
 * Printing physical QR codes is not practical during development, so this
 * endpoint hands back working table links for every seeded table.
 *
 * It is hard-gated behind DEMO_MODE, which `env.ts` force-disables whenever
 * NODE_ENV=production — there is no configuration that exposes it on a live box.
 */
export const devRouter: Router = Router();

devRouter.use((_req, _res, next) => {
  if (!env.demoMode) {
    return next(new AppError('DEMO_DISABLED', 'Developer tools are disabled outside demo mode.'));
  }
  next();
});

devRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const [restaurants, branches, tables, orders, sessions] = await Promise.all([
      prisma.restaurant.count(),
      prisma.branch.count(),
      prisma.restaurantTable.count(),
      prisma.order.count(),
      prisma.tableSession.count({ where: { status: 'ACTIVE' } }),
    ]);
    res.json({
      demoMode: true,
      environment: env.NODE_ENV,
      queueDriver: queueKind(),
      counts: { restaurants, branches, tables, orders, activeSessions: sessions },
    });
  }),
);

devRouter.get(
  '/qr-test-center',
  asyncHandler(async (_req, res) => {
    const restaurants = await prisma.restaurant.findMany({
      include: {
        branches: {
          orderBy: { name: 'asc' },
          include: {
            tables: {
              orderBy: { number: 'asc' },
              include: {
                qrTokens: { where: { active: true }, take: 1 },
                sessions: {
                  where: { status: { in: ['CREATED', 'LOCATION_PENDING', 'ACTIVE', 'PAUSED'] } },
                  select: { id: true, code: true, status: true },
                  take: 1,
                  orderBy: { startedAt: 'desc' },
                },
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      webUrl: env.WEB_URL,
      restaurants: restaurants.map((restaurant) => ({
        id: restaurant.id,
        name: restaurant.name,
        branches: restaurant.branches.map((branch) => ({
          id: branch.id,
          name: branch.name,
          latitude: branch.latitude,
          longitude: branch.longitude,
          serviceRadiusMeters: branch.serviceRadiusMeters,
          requireLocation: branch.requireLocation,
          tables: branch.tables.map((table) => ({
            id: table.id,
            number: table.number,
            label: table.label,
            seats: table.seats,
            zone: table.zone,
            status: table.status,
            qrUrl: table.qrTokens[0] ? qrUrlFor(table.qrTokens[0].token) : null,
            token: table.qrTokens[0]?.token ?? null,
            activeSession: table.sessions[0] ?? null,
          })),
        })),
      })),
    });
  }),
);

/** Mints a token on demand for a table that somehow has none. */

devRouter.post(
  '/sync-images',
  asyncHandler(async (_req, res) => {
    let count = 0;
    for (const p of PRODUCTS) {
      if (p.imageUrl) {
        await prisma.product.updateMany({
          where: { name: p.name },
          data: { imageUrl: p.imageUrl },
        });
        count++;
      }
    }
    res.json({ success: true, count });
  }),
);

devRouter.post(
  '/tables/:id/ensure-qr',
  asyncHandler(async (req, res) => {
    const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: req.params.id } });
    const qr = await ensureQrToken(table.id);
    res.json({ tableId: table.id, number: table.number, url: qrUrlFor(qr.token) });
  }),
);

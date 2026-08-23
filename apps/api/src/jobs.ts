import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { registerJob } from './queue/index.js';
import { sweepExpiredSessions } from './services/sessions.js';
import { scanLowStock } from './services/inventory.js';
import { checkKitchenSla } from './services/orders.js';

/** Wires the background jobs to their handlers. Called by both the API and the worker. */
export function registerJobs(): void {
  registerJob('sessions:sweep-expired', async () => {
    await sweepExpiredSessions();
  });

  registerJob('inventory:scan-low-stock', async () => {
    await scanLowStock();
  });

  registerJob('kitchen:check-sla', async () => {
    await checkKitchenSla();
  });

  registerJob('maintenance:prune', async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const [tokens, notifications] = await Promise.all([
      prisma.refreshToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
      }),
      prisma.notification.deleteMany({ where: { readAt: { lt: cutoff } } }),
    ]);

    if (tokens.count > 0 || notifications.count > 0) {
      logger.info(
        { refreshTokens: tokens.count, notifications: notifications.count },
        'pruned expired records',
      );
    }
  });
}

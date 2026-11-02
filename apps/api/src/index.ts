import http from 'node:http';
import { createApp } from './app.js';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { disconnectPrisma, prisma } from './lib/prisma.js';
import { registerJobs } from './jobs.js';
import { closeQueue, initQueue, queueKind } from './queue/index.js';
import { closeRealtime, initRealtime } from './realtime/index.js';

async function main(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  initRealtime(server);
  registerJobs();
  // A single-node deployment runs the scheduler in-process; a scaled-out one
  // sets RUN_WORKER_IN_PROCESS=false and runs `npm run start:worker` separately.
  await initQueue({ startWorker: env.RUN_WORKER_IN_PROCESS });

  await prisma.$queryRaw`SELECT 1`;

  try {
    await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "Receipt_number_key"');
    await prisma.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "Receipt_branchId_number_key" ON "Receipt"("branchId", "number")',
    );
  } catch (err) {
    logger.warn({ err }, 'could not ensure Receipt_branchId_number_key index');
  }

  server.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        demoMode: env.demoMode,
        queue: queueKind(),
        web: env.WEB_URL,
      },
      'TableFlow API ready',
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();

    server.close();
    await closeRealtime().catch(() => undefined);
    await closeQueue().catch(() => undefined);
    await disconnectPrisma().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection'));
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'failed to start API');
  process.exit(1);
});

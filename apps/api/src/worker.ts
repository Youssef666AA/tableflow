import { logger } from './lib/logger.js';
import { disconnectPrisma, prisma } from './lib/prisma.js';
import { registerJobs } from './jobs.js';
import { closeQueue, initQueue, queueKind } from './queue/index.js';

/**
 * Standalone background worker.
 *
 * Only needed when the API runs with RUN_WORKER_IN_PROCESS=false (the Docker
 * Compose setup does exactly that, so jobs survive an API restart).
 */
async function main(): Promise<void> {
  registerJobs();
  await initQueue({ startWorker: true });
  await prisma.$queryRaw`SELECT 1`;

  logger.info({ queue: queueKind() }, 'TableFlow worker ready');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await closeQueue().catch(() => undefined);
    await disconnectPrisma().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'failed to start worker');
  process.exit(1);
});

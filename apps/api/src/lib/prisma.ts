import { PrismaClient } from '@prisma/client';
import { env } from '../env.js';
import { logger } from './logger.js';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDevelopment
      ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
      : [{ emit: 'event', level: 'error' }],
  });

// @ts-expect-error - the event map is only present when log events are configured
prisma.$on('error', (e: { message: string }) => logger.error({ prisma: e }, 'prisma error'));
if (env.isDevelopment) {
  // @ts-expect-error - see above
  prisma.$on('warn', (e: { message: string }) => logger.warn({ prisma: e }, 'prisma warning'));
}

if (!env.isProduction) globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

/**
 * Allocates the next value of a per-branch counter inside the caller's
 * transaction. `UPDATE … RETURNING` makes the increment atomic, so two orders
 * placed in the same millisecond can never share a number.
 */
export async function nextCounterValue(tx: Tx, branchId: string, name: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "Counter" ("id", "branchId", "name", "value")
    VALUES (gen_random_uuid(), ${branchId}, ${name}, 1)
    ON CONFLICT ("branchId", "name")
    DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"
  `;
  const value = rows[0]?.value;
  if (typeof value !== 'number') throw new Error(`Failed to allocate counter ${name}`);
  return value;
}

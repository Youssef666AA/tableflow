import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma, type Tx } from '../lib/prisma.js';
import { hashIp } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null;
  restaurantId?: string | null;
  branchId?: string | null;
  metadata?: Prisma.InputJsonValue;
  req?: Request;
  actorType?: 'STAFF' | 'CUSTOMER' | 'SYSTEM';
  actorUserId?: string | null;
  actorLabel?: string | null;
}

function actorFrom(input: AuditInput) {
  if (input.actorType) {
    return {
      actorType: input.actorType,
      actorUserId: input.actorUserId ?? null,
      actorLabel: input.actorLabel ?? null,
    };
  }
  if (input.req?.auth) {
    return {
      actorType: 'STAFF' as const,
      actorUserId: input.req.auth.userId,
      actorLabel: `${input.req.auth.fullName} <${input.req.auth.email}>`,
    };
  }
  if (input.req?.customer) {
    return {
      actorType: 'CUSTOMER' as const,
      actorUserId: null,
      actorLabel: `table ${input.req.customer.tableNumber}`,
    };
  }
  return { actorType: 'SYSTEM' as const, actorUserId: null, actorLabel: 'system' };
}

function buildRow(input: AuditInput) {
  const actor = actorFrom(input);
  return {
    restaurantId: input.restaurantId ?? input.req?.auth?.restaurantId ?? input.req?.customer?.restaurantId ?? null,
    branchId: input.branchId ?? input.req?.customer?.branchId ?? null,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? {},
    ipHash: hashIp(input.req?.ip),
    userAgent: input.req?.headers['user-agent']?.slice(0, 300) ?? null,
    ...actor,
  };
}

/**
 * Records an audit entry. Auditing must never take down the request that it is
 * describing, so failures are logged rather than thrown.
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({ data: buildRow(input) });
  } catch (error) {
    logger.error({ err: error, action: input.action }, 'failed to write audit log');
  }
}

/** Same, but enlisted in an existing transaction so it commits atomically with the change. */
export async function writeAuditTx(tx: Tx, input: AuditInput): Promise<void> {
  await tx.auditLog.create({ data: buildRow(input) });
}

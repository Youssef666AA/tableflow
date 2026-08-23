import type { Request } from 'express';
import {
  REALTIME_EVENTS,
  checkLocation,
  evaluateOpenState,
  type OpeningHour,
} from '@tableflow/shared';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { generateOpaqueToken, hashIp } from '../lib/crypto.js';
import { signSessionToken } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';
import { nextCounterValue, prisma, type Tx } from '../lib/prisma.js';
import { emitToBranch, emitToSession } from '../realtime/index.js';
import { publishTableChange, recomputeTableStatus } from './tables.js';
import { writeAudit } from './audit.js';

const OPEN_SESSION_STATUSES = ['CREATED', 'LOCATION_PENDING', 'ACTIVE', 'PAUSED'] as const;

export interface ResolvedQr {
  qrTokenId: string;
  tableId: string;
  tableNumber: string;
  tableLabel: string | null;
  branchId: string;
  restaurantId: string;
}

/**
 * Resolves a printed QR token to a table. The token is the *only* thing the
 * customer supplies; the table, branch and restaurant all come from the server.
 */
export async function resolveQrToken(token: string): Promise<ResolvedQr> {
  const row = await prisma.tableQrToken.findUnique({
    where: { token },
    include: {
      table: {
        select: {
          id: true,
          number: true,
          label: true,
          branchId: true,
          outOfService: true,
          branch: { select: { id: true, active: true, restaurantId: true } },
        },
      },
    },
  });

  if (!row) {
    throw new AppError('QR_INVALID', 'This QR code is not recognised. Please ask a member of staff.');
  }
  if (!row.active || row.revokedAt) {
    throw new AppError('QR_REVOKED', 'This table QR code is no longer active. Please ask for an updated code.');
  }
  if (row.table.outOfService) {
    throw new AppError('QR_REVOKED', 'This table is currently out of service.');
  }
  if (!row.table.branch.active) {
    throw new AppError('RESTAURANT_CLOSED', 'This location is not currently accepting orders.');
  }

  return {
    qrTokenId: row.id,
    tableId: row.table.id,
    tableNumber: row.table.number,
    tableLabel: row.table.label,
    branchId: row.table.branchId,
    restaurantId: row.table.branch.restaurantId,
  };
}

function formatSessionCode(value: number): string {
  return `TS-${String(value).padStart(6, '0')}`;
}

export interface StartSessionResult {
  sessionToken: string;
  session: {
    id: string;
    code: string;
    status: string;
    startedAt: Date;
    expiresAt: Date;
    guestCount: number;
    customerName: string | null;
  };
  device: { id: string; key: string; verified: boolean };
  requiresLocation: boolean;
  verified: boolean;
  table: { id: string; number: string; label: string | null; seats: number };
  branch: {
    id: string;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    serviceRadiusMeters: number;
    timezone: string;
  };
  restaurant: { id: string; name: string; logoUrl: string | null; currency: string };
  openState: ReturnType<typeof evaluateOpenState>;
  demoMode: boolean;
}

export async function startTableSession(params: {
  token: string;
  deviceKey?: string | null;
  req?: Request;
}): Promise<StartSessionResult> {
  const resolved = await resolveQrToken(params.token);
  const deviceKey = params.deviceKey?.trim() || generateOpaqueToken(16);

  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: resolved.branchId },
    include: {
      restaurant: { select: { id: true, name: true, logoUrl: true, currency: true } },
    },
  });

  const table = await prisma.restaurantTable.findUniqueOrThrow({
    where: { id: resolved.tableId },
    select: { id: true, number: true, label: true, seats: true },
  });

  const now = new Date();
  const userAgent = params.req?.headers['user-agent']?.slice(0, 300) ?? null;
  const ipHash = hashIp(params.req?.ip);

  const { session, device, created } = await prisma.$transaction(async (tx) => {
    // Expire anything that has quietly run past its TTL before reusing it.
    await tx.tableSession.updateMany({
      where: {
        tableId: resolved.tableId,
        status: { in: [...OPEN_SESSION_STATUSES] },
        expiresAt: { lt: now },
      },
      data: { status: 'EXPIRED' },
    });

    let existing = await tx.tableSession.findFirst({
      where: { tableId: resolved.tableId, status: { in: [...OPEN_SESSION_STATUSES] } },
      orderBy: { startedAt: 'desc' },
    });

    let wasCreated = false;

    if (!existing) {
      const counter = await nextCounterValue(tx, branch.id, 'session');
      existing = await tx.tableSession.create({
        data: {
          code: formatSessionCode(counter),
          branchId: branch.id,
          tableId: table.id,
          qrTokenId: resolved.qrTokenId,
          status: branch.requireLocation ? 'LOCATION_PENDING' : 'ACTIVE',
          expiresAt: new Date(now.getTime() + branch.sessionTtlMinutes * 60_000),
          userAgent,
          ipHash,
        },
      });
      wasCreated = true;
    } else {
      existing = await tx.tableSession.update({
        where: { id: existing.id },
        data: { lastActivityAt: now },
      });
    }

    const deviceRow = await tx.sessionDevice.upsert({
      where: { sessionId_deviceKey: { sessionId: existing.id, deviceKey } },
      create: {
        sessionId: existing.id,
        deviceKey,
        userAgent,
        ipHash,
        // When the branch does not require location, every device is trusted on arrival.
        verifiedAt: branch.requireLocation ? null : now,
        verificationMethod: branch.requireLocation ? null : 'SKIPPED',
      },
      update: { lastSeenAt: now, userAgent, ipHash },
    });

    await tx.tableQrToken.update({
      where: { id: resolved.qrTokenId },
      data: { scanCount: { increment: 1 }, lastScanAt: now },
    });

    return { session: existing, device: deviceRow, created: wasCreated };
  });

  const tableChange = await prisma.$transaction((tx) => recomputeTableStatus(tx, table.id));
  publishTableChange(tableChange);

  if (created) {
    emitToBranch(branch.id, REALTIME_EVENTS.SESSION_UPDATED, {
      id: session.id,
      code: session.code,
      tableId: table.id,
      tableNumber: table.number,
      status: session.status,
      startedAt: session.startedAt,
    });
    void writeAudit({
      action: 'session.started',
      entity: 'TableSession',
      entityId: session.id,
      restaurantId: branch.restaurantId,
      branchId: branch.id,
      actorType: 'CUSTOMER',
      actorLabel: `table ${table.number}`,
      metadata: { code: session.code, tableNumber: table.number },
      req: params.req,
    });
  }

  const ttlSeconds = Math.max(60, Math.floor((session.expiresAt.getTime() - now.getTime()) / 1000));
  const verified = !branch.requireLocation || device.verifiedAt !== null;

  return {
    sessionToken: signSessionToken(session.id, device.id, session.tokenVersion, ttlSeconds),
    session: {
      id: session.id,
      code: session.code,
      status: session.status,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      guestCount: session.guestCount,
      customerName: session.customerName,
    },
    device: { id: device.id, key: deviceKey, verified },
    requiresLocation: branch.requireLocation,
    verified,
    table: { id: table.id, number: table.number, label: table.label, seats: table.seats },
    branch: {
      id: branch.id,
      name: branch.name,
      address: branch.address,
      latitude: branch.latitude,
      longitude: branch.longitude,
      serviceRadiusMeters: branch.serviceRadiusMeters,
      timezone: branch.timezone,
    },
    restaurant: {
      id: branch.restaurant.id,
      name: branch.restaurant.name,
      logoUrl: branch.restaurant.logoUrl,
      currency: branch.restaurant.currency,
    },
    openState: evaluateOpenState((branch.openingHours as unknown as OpeningHour[]) ?? []),
    demoMode: env.demoMode,
  };
}

export interface VerifyLocationResult {
  verified: boolean;
  distanceMeters: number | null;
  effectiveRadiusMeters: number;
  sessionStatus: string;
  method: 'GPS' | 'DEMO' | 'STAFF' | 'SKIPPED';
}

const MAX_LOCATION_ATTEMPTS = 12;

export async function verifyDeviceLocation(params: {
  sessionId: string;
  deviceId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  simulate?: boolean;
  req?: Request;
}): Promise<VerifyLocationResult> {
  const session = await prisma.tableSession.findUniqueOrThrow({
    where: { id: params.sessionId },
    include: {
      branch: true,
      table: { select: { id: true, number: true } },
      devices: { where: { id: params.deviceId } },
    },
  });

  const device = session.devices[0];
  if (!device) throw AppError.notFound('Unknown device for this session.');
  if (device.blocked) {
    throw new AppError('SESSION_BLOCKED', 'This device has been blocked. Please ask a member of staff.');
  }

  const branch = session.branch;

  if (!branch.requireLocation) {
    await prisma.sessionDevice.update({
      where: { id: device.id },
      data: { verifiedAt: new Date(), verificationMethod: 'SKIPPED' },
    });
    await activateSession(session.id);
    return {
      verified: true,
      distanceMeters: null,
      effectiveRadiusMeters: branch.serviceRadiusMeters,
      sessionStatus: 'ACTIVE',
      method: 'SKIPPED',
    };
  }

  // The "simulate" shortcut exists so the flow can be demonstrated on a laptop.
  // env.demoMode is force-disabled whenever NODE_ENV=production.
  if (params.simulate) {
    if (!env.demoMode) {
      throw new AppError('DEMO_DISABLED', 'Simulated location is only available in demo mode.');
    }
    await prisma.sessionDevice.update({
      where: { id: device.id },
      data: {
        verifiedAt: new Date(),
        verificationMethod: 'DEMO',
        latitude: branch.latitude,
        longitude: branch.longitude,
        distanceMeters: 0,
        accuracyMeters: null,
      },
    });
    await activateSession(session.id);
    void writeAudit({
      action: 'session.location_simulated',
      entity: 'TableSession',
      entityId: session.id,
      restaurantId: branch.restaurantId,
      branchId: branch.id,
      actorType: 'CUSTOMER',
      metadata: { deviceId: device.id },
      req: params.req,
    });
    return {
      verified: true,
      distanceMeters: 0,
      effectiveRadiusMeters: branch.serviceRadiusMeters,
      sessionStatus: 'ACTIVE',
      method: 'DEMO',
    };
  }

  const result = checkLocation({
    customer: { latitude: params.latitude, longitude: params.longitude },
    restaurant: { latitude: branch.latitude, longitude: branch.longitude },
    radiusMeters: branch.serviceRadiusMeters,
    accuracyMeters: params.accuracy ?? null,
  });

  if (!result.withinRadius) {
    const attempts = device.failedAttempts + 1;
    await prisma.sessionDevice.update({
      where: { id: device.id },
      data: {
        failedAttempts: attempts,
        latitude: params.latitude,
        longitude: params.longitude,
        accuracyMeters: params.accuracy ?? null,
        distanceMeters: result.distanceMeters,
        blocked: attempts >= MAX_LOCATION_ATTEMPTS,
      },
    });

    throw new AppError(
      'LOCATION_OUT_OF_RANGE',
      'You appear to be outside the restaurant. Please scan the QR code from your table.',
      {
        distanceMeters: result.distanceMeters,
        allowedRadiusMeters: result.effectiveRadiusMeters,
        staffOverrideAvailable: branch.allowStaffLocationOverride,
      },
    );
  }

  await prisma.sessionDevice.update({
    where: { id: device.id },
    data: {
      verifiedAt: new Date(),
      verificationMethod: 'GPS',
      latitude: params.latitude,
      longitude: params.longitude,
      accuracyMeters: params.accuracy ?? null,
      distanceMeters: result.distanceMeters,
      failedAttempts: 0,
    },
  });

  await prisma.tableSession.update({
    where: { id: session.id },
    data: {
      latitude: session.latitude ?? params.latitude,
      longitude: session.longitude ?? params.longitude,
      distanceMeters: session.distanceMeters ?? result.distanceMeters,
      accuracyMeters: session.accuracyMeters ?? params.accuracy ?? null,
      locationVerifiedAt: session.locationVerifiedAt ?? new Date(),
      verificationMethod: session.verificationMethod ?? 'GPS',
    },
  });

  await activateSession(session.id);

  return {
    verified: true,
    distanceMeters: result.distanceMeters,
    effectiveRadiusMeters: result.effectiveRadiusMeters,
    sessionStatus: 'ACTIVE',
    method: 'GPS',
  };
}

/** Staff-assisted verification for guests whose GPS will not cooperate. */
export async function staffVerifyDevice(params: {
  sessionId: string;
  deviceId?: string | null;
  staffUserId: string;
  req?: Request;
}): Promise<void> {
  const session = await prisma.tableSession.findUniqueOrThrow({
    where: { id: params.sessionId },
    include: { branch: { select: { id: true, restaurantId: true, allowStaffLocationOverride: true } } },
  });

  if (!session.branch.allowStaffLocationOverride) {
    throw AppError.forbidden('Staff verification is disabled for this branch.');
  }

  await prisma.sessionDevice.updateMany({
    where: params.deviceId ? { id: params.deviceId, sessionId: session.id } : { sessionId: session.id },
    data: { verifiedAt: new Date(), verificationMethod: 'STAFF', blocked: false, failedAttempts: 0 },
  });

  await activateSession(session.id);

  void writeAudit({
    action: 'session.staff_verified',
    entity: 'TableSession',
    entityId: session.id,
    restaurantId: session.branch.restaurantId,
    branchId: session.branchId,
    actorType: 'STAFF',
    actorUserId: params.staffUserId,
    metadata: { deviceId: params.deviceId ?? 'all' },
    req: params.req,
  });

  emitToSession(session.id, REALTIME_EVENTS.SESSION_UPDATED, { id: session.id, status: 'ACTIVE', verified: true });
}

async function activateSession(sessionId: string): Promise<void> {
  const session = await prisma.tableSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { id: true, status: true, branchId: true, tableId: true },
  });
  if (session.status === 'LOCATION_PENDING' || session.status === 'CREATED') {
    await prisma.tableSession.update({ where: { id: sessionId }, data: { status: 'ACTIVE' } });
    emitToBranch(session.branchId, REALTIME_EVENTS.SESSION_UPDATED, { id: sessionId, status: 'ACTIVE' });
    const change = await prisma.$transaction((tx) => recomputeTableStatus(tx, session.tableId));
    publishTableChange(change);
  }
}

export async function touchSession(sessionId: string): Promise<void> {
  await prisma.tableSession
    .update({ where: { id: sessionId }, data: { lastActivityAt: new Date() } })
    .catch(() => undefined);
}

export interface CloseSessionParams {
  sessionId: string;
  staffUserId?: string | null;
  reason?: string | null;
  req?: Request;
  /** Refuse to close while money is still owed, unless explicitly overridden. */
  force?: boolean;
}

export async function closeSession(params: CloseSessionParams): Promise<void> {
  const result = await prisma.$transaction(async (tx) => {
    const session = await tx.tableSession.findUniqueOrThrow({
      where: { id: params.sessionId },
      include: { branch: { select: { id: true, restaurantId: true } } },
    });

    if (session.status === 'CLOSED') return { session, change: null, alreadyClosed: true };

    if (!params.force) {
      const unpaid = await tx.order.count({
        where: {
          sessionId: session.id,
          status: { notIn: ['CANCELLED', 'REJECTED'] },
          paymentId: null,
        },
      });
      if (unpaid > 0) {
        throw AppError.conflict(
          `This table still has ${unpaid} unpaid order${unpaid === 1 ? '' : 's'}. Settle the bill first.`,
          { unpaidOrders: unpaid },
        );
      }
    }

    // Complete anything delivered but not yet closed out, and cancel what never started.
    await tx.order.updateMany({
      where: { sessionId: session.id, status: 'DELIVERED' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await tx.serviceRequest.updateMany({
      where: { sessionId: session.id, status: { in: ['REQUESTED', 'ACKNOWLEDGED', 'IN_PROGRESS'] } },
      data: { status: 'CANCELLED' },
    });

    const updated = await tx.tableSession.update({
      where: { id: session.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedById: params.staffUserId ?? null,
        closeReason: params.reason ?? null,
        tokenVersion: { increment: 1 },
      },
    });

    await tx.restaurantTable.update({
      where: { id: session.tableId },
      data: { needsCleaning: true },
    });

    const change = await recomputeTableStatus(tx, session.tableId);
    return { session: updated, change, alreadyClosed: false };
  });

  if (result.alreadyClosed) return;
  if (result.change) publishTableChange(result.change);

  emitToSession(params.sessionId, REALTIME_EVENTS.SESSION_UPDATED, {
    id: params.sessionId,
    status: 'CLOSED',
  });
  emitToBranch(result.session.branchId, REALTIME_EVENTS.SESSION_UPDATED, {
    id: params.sessionId,
    status: 'CLOSED',
    tableId: result.session.tableId,
  });

  void writeAudit({
    action: 'session.closed',
    entity: 'TableSession',
    entityId: params.sessionId,
    branchId: result.session.branchId,
    actorType: params.staffUserId ? 'STAFF' : 'SYSTEM',
    actorUserId: params.staffUserId ?? null,
    metadata: { reason: params.reason ?? null, forced: Boolean(params.force) },
    req: params.req,
  });
}

/** Background sweep: expire sessions past their TTL and free their tables. */
export async function sweepExpiredSessions(): Promise<number> {
  const now = new Date();
  const stale = await prisma.tableSession.findMany({
    where: { status: { in: [...OPEN_SESSION_STATUSES] }, expiresAt: { lt: now } },
    select: { id: true, tableId: true, branchId: true, code: true },
    take: 200,
  });

  if (stale.length === 0) return 0;

  for (const session of stale) {
    try {
      const change = await prisma.$transaction(async (tx) => {
        await tx.tableSession.update({
          where: { id: session.id },
          data: { status: 'EXPIRED', tokenVersion: { increment: 1 } },
        });
        return recomputeTableStatus(tx, session.tableId);
      });
      publishTableChange(change);
      emitToSession(session.id, REALTIME_EVENTS.SESSION_UPDATED, { id: session.id, status: 'EXPIRED' });
    } catch (error) {
      logger.error({ err: error, sessionId: session.id }, 'failed to expire session');
    }
  }

  logger.info({ count: stale.length }, 'expired stale table sessions');
  return stale.length;
}

/** Extends the session TTL while guests are still ordering. */
export async function extendSession(tx: Tx, sessionId: string, minutes: number): Promise<void> {
  const session = await tx.tableSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { expiresAt: true },
  });
  const target = new Date(Date.now() + minutes * 60_000);
  if (target > session.expiresAt) {
    await tx.tableSession.update({ where: { id: sessionId }, data: { expiresAt: target } });
  }
}

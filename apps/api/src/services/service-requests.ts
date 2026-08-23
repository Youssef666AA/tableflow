import type { Request } from 'express';
import type { Prisma, ServiceRequestStatus, ServiceRequestType } from '@prisma/client';
import { REALTIME_EVENTS, SERVICE_REQUEST_LABEL, canTransitionServiceRequest } from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { emitToBranch, emitToSession } from '../realtime/index.js';
import { publishTableChange, recomputeTableStatus } from './tables.js';
import { notify } from './notifications.js';
import { writeAudit } from './audit.js';

const OPEN_STATUSES: ServiceRequestStatus[] = ['REQUESTED', 'ACKNOWLEDGED', 'IN_PROGRESS'];

const requestInclude = {
  table: { select: { id: true, number: true, zone: true } },
  session: { select: { id: true, code: true, customerName: true } },
  acknowledgedBy: { select: { id: true, fullName: true } },
  completedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ServiceRequestInclude;

type RequestWithRelations = Prisma.ServiceRequestGetPayload<{ include: typeof requestInclude }>;

export function serializeRequest(row: RequestWithRelations) {
  return {
    id: row.id,
    branchId: row.branchId,
    tableId: row.tableId,
    tableNumber: row.table.number,
    zone: row.table.zone,
    sessionId: row.sessionId,
    sessionCode: row.session?.code ?? null,
    customerName: row.session?.customerName ?? null,
    type: row.type,
    label: SERVICE_REQUEST_LABEL[row.type] ?? row.type,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
    acknowledgedAt: row.acknowledgedAt,
    completedAt: row.completedAt,
    responseSeconds: row.responseSeconds,
    resolutionSeconds: row.resolutionSeconds,
    acknowledgedBy: row.acknowledgedBy?.fullName ?? null,
    completedBy: row.completedBy?.fullName ?? null,
  };
}

export async function createServiceRequest(params: {
  sessionId: string | null;
  branchId: string;
  tableId: string;
  restaurantId: string;
  type: ServiceRequestType;
  note?: string | null;
  req?: Request;
}) {
  // Tapping "call waiter" twice should not queue two jobs for the same table.
  const existing = await prisma.serviceRequest.findFirst({
    where: {
      ...(params.sessionId ? { sessionId: params.sessionId } : { tableId: params.tableId, sessionId: null }),
      type: params.type,
      status: { in: OPEN_STATUSES },
    },
    include: requestInclude,
  });
  if (existing) {
    return { request: serializeRequest(existing), reused: true };
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.serviceRequest.create({
      data: {
        branchId: params.branchId,
        tableId: params.tableId,
        sessionId: params.sessionId,
        type: params.type,
        note: params.note?.trim() || null,
      },
      include: requestInclude,
    });

    if (params.type === 'REQUEST_BILL' && params.sessionId) {
      await tx.tableSession.update({
        where: { id: params.sessionId },
        data: { billRequestedAt: new Date() },
      });
    }

    const tableChange = await recomputeTableStatus(tx, params.tableId);
    return { row, tableChange };
  });

  const serialized = serializeRequest(created.row);
  publishTableChange(created.tableChange);
  emitToBranch(params.branchId, REALTIME_EVENTS.SERVICE_REQUEST_CREATED, serialized);
  if (params.sessionId) emitToSession(params.sessionId, REALTIME_EVENTS.SERVICE_REQUEST_CREATED, serialized);

  const isBill = params.type === 'REQUEST_BILL';
  await notify({
    restaurantId: params.restaurantId,
    branchId: params.branchId,
    type: isBill ? 'BILL_REQUEST' : 'SERVICE_REQUEST',
    title: isBill ? `Table ${serialized.tableNumber} requested the bill` : `Table ${serialized.tableNumber} needs assistance`,
    body: serialized.label + (serialized.note ? ` — ${serialized.note}` : ''),
    data: { serviceRequestId: serialized.id, tableId: params.tableId } as Prisma.InputJsonValue,
    roles: isBill ? ['CASHIER', 'WAITER', 'MANAGER'] : ['WAITER', 'MANAGER'],
  });

  void writeAudit({
    action: 'service_request.created',
    entity: 'ServiceRequest',
    entityId: serialized.id,
    restaurantId: params.restaurantId,
    branchId: params.branchId,
    actorType: 'CUSTOMER',
    metadata: { type: params.type },
    req: params.req,
  });

  return { request: serialized, reused: false };
}

export async function updateServiceRequestStatus(params: {
  id: string;
  status: ServiceRequestStatus;
  userId: string;
  allowedBranchIds: string[];
  req?: Request;
}) {
  const outcome = await prisma.$transaction(async (tx) => {
    const current = await tx.serviceRequest.findUniqueOrThrow({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        branchId: true,
        tableId: true,
        sessionId: true,
        createdAt: true,
        acknowledgedAt: true,
        type: true,
      },
    });

    if (!params.allowedBranchIds.includes(current.branchId)) {
      throw AppError.forbidden('You do not have access to this request.');
    }
    if (!canTransitionServiceRequest(current.status, params.status)) {
      throw new AppError(
        'INVALID_TRANSITION',
        `A request that is ${current.status.toLowerCase()} cannot be moved to ${params.status.toLowerCase()}.`,
      );
    }

    const now = new Date();
    const data: Prisma.ServiceRequestUpdateInput = { status: params.status };

    if (params.status === 'ACKNOWLEDGED' || (params.status === 'IN_PROGRESS' && !current.acknowledgedAt)) {
      data.acknowledgedAt = now;
      data.acknowledgedBy = { connect: { id: params.userId } };
      data.responseSeconds = Math.round((now.getTime() - current.createdAt.getTime()) / 1000);
    }
    if (params.status === 'COMPLETED' || params.status === 'CANCELLED') {
      data.completedAt = now;
      data.completedBy = { connect: { id: params.userId } };
      data.resolutionSeconds = Math.round((now.getTime() - current.createdAt.getTime()) / 1000);
    }

    const row = await tx.serviceRequest.update({
      where: { id: params.id },
      data,
      include: requestInclude,
    });

    if (
      current.type === 'REQUEST_BILL' &&
      (params.status === 'COMPLETED' || params.status === 'CANCELLED') &&
      current.sessionId
    ) {
      const stillOpen = await tx.serviceRequest.count({
        where: { sessionId: current.sessionId, type: 'REQUEST_BILL', status: { in: OPEN_STATUSES } },
      });
      if (stillOpen === 0) {
        await tx.tableSession.update({
          where: { id: current.sessionId },
          data: { billRequestedAt: null },
        });
      }
    }

    const tableChange = await recomputeTableStatus(tx, current.tableId);
    return { row, tableChange };
  });

  const serialized = serializeRequest(outcome.row);
  publishTableChange(outcome.tableChange);
  emitToBranch(serialized.branchId, REALTIME_EVENTS.SERVICE_REQUEST_UPDATED, serialized);
  if (serialized.sessionId) {
    emitToSession(serialized.sessionId, REALTIME_EVENTS.SERVICE_REQUEST_UPDATED, serialized);
  }

  void writeAudit({
    action: 'service_request.status_changed',
    entity: 'ServiceRequest',
    entityId: serialized.id,
    branchId: serialized.branchId,
    actorType: 'STAFF',
    actorUserId: params.userId,
    metadata: { status: params.status },
    req: params.req,
  });

  return serialized;
}

export async function listServiceRequests(params: {
  branchId: string;
  status?: ServiceRequestStatus[];
  sessionId?: string;
  limit?: number;
}) {
  const rows = await prisma.serviceRequest.findMany({
    where: {
      branchId: params.branchId,
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      ...(params.status && params.status.length > 0 ? { status: { in: params.status } } : {}),
    },
    include: requestInclude,
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    take: params.limit ?? 100,
  });
  return rows.map(serializeRequest);
}

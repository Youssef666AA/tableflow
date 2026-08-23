import type { Prisma } from '@prisma/client';
import { REALTIME_EVENTS, type NotificationType, type Role } from '@tableflow/shared';
import { prisma } from '../lib/prisma.js';
import { emitToBranch, emitToBranchRole, emitToUser } from '../realtime/index.js';
import { logger } from '../lib/logger.js';

export interface NotificationInput {
  restaurantId: string;
  branchId?: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  data?: Prisma.InputJsonValue;
  /** Target a single user, or leave empty to notify a set of roles in the branch. */
  userId?: string | null;
  roles?: Role[];
}

/**
 * Persists a notification and pushes it over the socket. Persist first: a client
 * that reconnects must be able to catch up from the database, so the record is
 * the source of truth and the socket event is only a nudge.
 */
export async function notify(input: NotificationInput): Promise<void> {
  try {
    const roles = input.roles ?? [];

    if (input.userId) {
      const row = await prisma.notification.create({
        data: {
          restaurantId: input.restaurantId,
          branchId: input.branchId ?? null,
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          data: input.data ?? {},
        },
      });
      emitToUser(input.userId, REALTIME_EVENTS.NOTIFICATION, row);
      return;
    }

    if (roles.length === 0) {
      const row = await prisma.notification.create({
        data: {
          restaurantId: input.restaurantId,
          branchId: input.branchId ?? null,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          data: input.data ?? {},
        },
      });
      if (input.branchId) emitToBranch(input.branchId, REALTIME_EVENTS.NOTIFICATION, row);
      return;
    }

    const rows = await prisma.$transaction(
      roles.map((role) =>
        prisma.notification.create({
          data: {
            restaurantId: input.restaurantId,
            branchId: input.branchId ?? null,
            role,
            type: input.type,
            title: input.title,
            body: input.body ?? null,
            data: input.data ?? {},
          },
        }),
      ),
    );

    if (input.branchId) {
      rows.forEach((row) => {
        emitToBranchRole(input.branchId!, row.role as Role, REALTIME_EVENTS.NOTIFICATION, row);
      });
    }
  } catch (error) {
    logger.error({ err: error, type: input.type }, 'failed to create notification');
  }
}

/** Notifications a given member should see: their own, plus their role's and branch-wide ones. */
export function notificationScope(params: {
  restaurantId: string;
  userId: string;
  role: Role;
  branchIds: string[];
}): Prisma.NotificationWhereInput {
  return {
    restaurantId: params.restaurantId,
    OR: [
      { userId: params.userId },
      { userId: null, role: params.role, branchId: { in: params.branchIds } },
      { userId: null, role: null, branchId: { in: params.branchIds } },
      { userId: null, role: null, branchId: null },
    ],
  };
}

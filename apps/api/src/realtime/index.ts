import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import type { Role } from '@tableflow/shared';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken, verifySessionToken } from '../lib/jwt.js';

let io: IOServer | null = null;

export const rooms = {
  branch: (branchId: string) => `branch:${branchId}`,
  branchRole: (branchId: string, role: Role) => `branch:${branchId}:role:${role}`,
  restaurant: (restaurantId: string) => `restaurant:${restaurantId}`,
  session: (sessionId: string) => `session:${sessionId}`,
  user: (userId: string) => `user:${userId}`,
};

interface StaffHandshake {
  kind: 'staff';
  token: string;
  branchId?: string;
}

interface CustomerHandshake {
  kind: 'customer';
  token: string;
}

type Handshake = StaffHandshake | CustomerHandshake;

async function authenticateSocket(socket: Socket): Promise<void> {
  const auth = socket.handshake.auth as Partial<Handshake> | undefined;
  if (!auth?.token || !auth.kind) {
    throw new Error('Missing credentials');
  }

  if (auth.kind === 'staff') {
    const payload = verifyAccessToken(auth.token);
    const membership = await prisma.membership.findUnique({
      where: { id: payload.membershipId },
      include: { branches: true, user: { select: { active: true } } },
    });
    if (!membership || !membership.active || !membership.user.active) {
      throw new Error('Membership is not active');
    }

    const scopedBranchIds = membership.branches.map((b) => b.branchId);
    const branchIds =
      scopedBranchIds.length > 0
        ? scopedBranchIds
        : (
            await prisma.branch.findMany({
              where: { restaurantId: membership.restaurantId },
              select: { id: true },
            })
          ).map((b) => b.id);

    socket.data.kind = 'staff';
    socket.data.userId = membership.userId;
    socket.data.role = membership.role;
    socket.data.restaurantId = membership.restaurantId;
    socket.data.branchIds = branchIds;

    await socket.join(rooms.restaurant(membership.restaurantId));
    await socket.join(rooms.user(membership.userId));
    for (const branchId of branchIds) {
      await socket.join(rooms.branch(branchId));
      await socket.join(rooms.branchRole(branchId, membership.role));
    }
    return;
  }

  if (auth.kind === 'customer') {
    const payload = verifySessionToken(auth.token);
    const session = await prisma.tableSession.findUnique({
      where: { id: payload.sid },
      select: { id: true, status: true, tokenVersion: true, branchId: true, tableId: true, expiresAt: true },
    });
    if (!session) throw new Error('Unknown session');
    if (session.tokenVersion !== payload.tv) throw new Error('Session token superseded');
    if (['CLOSED', 'EXPIRED', 'BLOCKED'].includes(session.status)) throw new Error('Session is not active');
    if (session.expiresAt.getTime() < Date.now()) throw new Error('Session expired');

    socket.data.kind = 'customer';
    socket.data.sessionId = session.id;
    socket.data.branchId = session.branchId;
    socket.data.tableId = session.tableId;

    await socket.join(rooms.session(session.id));
    return;
  }

  throw new Error('Unknown client kind');
}

export function initRealtime(server: HttpServer): IOServer {
  io = new IOServer(server, {
    cors: { origin: env.corsOrigins, credentials: true },
    path: '/socket.io',
    serveClient: false,
    pingInterval: 20000,
    pingTimeout: 25000,
  });

  io.use((socket, next) => {
    authenticateSocket(socket)
      .then(() => next())
      .catch((error: Error) => {
        logger.debug({ err: error.message }, 'socket auth rejected');
        next(new Error('unauthorized'));
      });
  });

  io.on('connection', (socket) => {
    logger.debug({ id: socket.id, kind: socket.data.kind }, 'socket connected');

    // Staff can narrow their feed to a single branch when switching branches in the UI.
    socket.on('branch:focus', async (branchId: string, ack?: (ok: boolean) => void) => {
      if (socket.data.kind !== 'staff' || !Array.isArray(socket.data.branchIds)) {
        ack?.(false);
        return;
      }
      if (!socket.data.branchIds.includes(branchId)) {
        ack?.(false);
        return;
      }
      socket.data.focusedBranchId = branchId;
      ack?.(true);
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ id: socket.id, reason }, 'socket disconnected');
    });
  });

  return io;
}

export function getIo(): IOServer | null {
  return io;
}

function emit(room: string, event: string, payload: unknown): void {
  if (!io) return;
  io.to(room).emit(event, payload);
}

/** Broadcast to every staff member scoped to a branch. */
export function emitToBranch(branchId: string, event: string, payload: unknown): void {
  emit(rooms.branch(branchId), event, payload);
}

/** Broadcast to one role within a branch (e.g. only the kitchen). */
export function emitToBranchRole(branchId: string, role: Role, event: string, payload: unknown): void {
  emit(rooms.branchRole(branchId, role), event, payload);
}

/** Deliver to the customer holding a specific table session. */
export function emitToSession(sessionId: string, event: string, payload: unknown): void {
  emit(rooms.session(sessionId), event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  emit(rooms.user(userId), event, payload);
}

export function emitToRestaurant(restaurantId: string, event: string, payload: unknown): void {
  emit(rooms.restaurant(restaurantId), event, payload);
}

export async function closeRealtime(): Promise<void> {
  if (!io) return;
  await io.close();
  io = null;
}

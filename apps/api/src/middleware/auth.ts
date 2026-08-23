import type { NextFunction, Request, Response } from 'express';
import type { Permission, Role } from '@tableflow/shared';
import { can, sessionCanOrder } from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken, verifySessionToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';

export interface StaffContext {
  userId: string;
  membershipId: string;
  restaurantId: string;
  role: Role;
  /** Branches this member may act on. Always concrete — never an empty "means all". */
  branchIds: string[];
  fullName: string;
  email: string;
}

export interface CustomerSessionContext {
  sessionId: string;
  deviceId: string;
  branchId: string;
  tableId: string;
  restaurantId: string;
  status: string;
  tableNumber: string;
  expiresAt: Date;
  /** This device has proven it is at the restaurant (or the branch does not require it). */
  verified: boolean;
  requiresLocation: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: StaffContext;
      customer?: CustomerSessionContext;
      requestId?: string;
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

async function loadStaffContext(token: string): Promise<StaffContext> {
  const payload = verifyAccessToken(token);

  const membership = await prisma.membership.findUnique({
    where: { id: payload.membershipId },
    include: {
      branches: { select: { branchId: true } },
      user: { select: { id: true, active: true, fullName: true, email: true } },
    },
  });

  if (!membership || !membership.active) {
    throw AppError.unauthorized('Your access has been revoked.');
  }
  if (!membership.user.active) {
    throw AppError.unauthorized('This account has been deactivated.');
  }
  // The role is re-read from the database, so a demotion takes effect on the very
  // next request instead of waiting for the access token to expire.
  const scoped = membership.branches.map((b) => b.branchId);
  const branchIds =
    scoped.length > 0
      ? scoped
      : (
          await prisma.branch.findMany({
            where: { restaurantId: membership.restaurantId },
            select: { id: true },
          })
        ).map((b) => b.id);

  return {
    userId: membership.userId,
    membershipId: membership.id,
    restaurantId: membership.restaurantId,
    role: membership.role as Role,
    branchIds,
    fullName: membership.user.fullName,
    email: membership.user.email,
  };
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (!token) throw AppError.unauthorized();
    req.auth = await loadStaffContext(token);
    next();
  } catch (error) {
    next(error);
  }
}

export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (token) req.auth = await loadStaffContext(token);
  } catch {
    // An invalid token on an optional route is simply treated as anonymous.
  }
  next();
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(AppError.unauthorized());
    const missing = permissions.filter((p) => !can(req.auth!.role, p));
    if (missing.length > 0) {
      return next(
        AppError.forbidden(
          `Your role (${req.auth.role.toLowerCase()}) does not allow this action.`,
        ),
      );
    }
    next();
  };
}

export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(AppError.unauthorized());
    if (!permissions.some((p) => can(req.auth!.role, p))) {
      return next(
        AppError.forbidden(`Your role (${req.auth.role.toLowerCase()}) does not allow this action.`),
      );
    }
    next();
  };
}

/**
 * Resolves the branch a staff request targets and proves the caller is scoped to
 * it. Client-supplied branch ids are never trusted beyond this check.
 */
export function resolveBranchId(req: Request, explicit?: string | null): string {
  if (!req.auth) throw AppError.unauthorized();

  const candidate =
    explicit ??
    (req.params.branchId as string | undefined) ??
    (typeof req.query.branchId === 'string' ? req.query.branchId : undefined) ??
    (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).branchId : undefined);

  if (typeof candidate === 'string' && candidate.length > 0) {
    if (!req.auth.branchIds.includes(candidate)) {
      throw AppError.forbidden('You do not have access to this branch.');
    }
    return candidate;
  }

  const fallback = req.auth.branchIds[0];
  if (!fallback) throw AppError.forbidden('Your account is not assigned to any branch.');
  return fallback;
}

export function assertBranchAccess(req: Request, branchId: string): void {
  if (!req.auth) throw AppError.unauthorized();
  if (!req.auth.branchIds.includes(branchId)) {
    throw AppError.forbidden('You do not have access to this branch.');
  }
}

/**
 * Customer authentication. The bearer token identifies a table session and
 * nothing else; the table, branch and restaurant are always re-read from the
 * database, so a customer can never point themselves at a different table.
 */
export async function requireTableSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (!token) {
      throw new AppError('SESSION_EXPIRED', 'Please scan the QR code at your table to start.');
    }

    const payload = verifySessionToken(token);
    const session = await prisma.tableSession.findUnique({
      where: { id: payload.sid },
      include: {
        table: { select: { id: true, number: true } },
        branch: { select: { id: true, restaurantId: true, requireLocation: true } },
        devices: { where: { id: payload.did } },
      },
    });

    if (!session) {
      throw new AppError('SESSION_EXPIRED', 'Your table session no longer exists. Please scan again.');
    }
    // Lifecycle first, token bookkeeping second: closing a session bumps
    // tokenVersion, and "this session has been closed" is far more useful to the
    // guest than "your token was replaced".
    if (session.status === 'BLOCKED') {
      throw new AppError('SESSION_BLOCKED', 'This table session has been blocked. Please ask a member of staff.');
    }
    if (session.status === 'CLOSED') {
      throw new AppError('SESSION_CLOSED', 'This table session has been closed.');
    }
    if (session.status === 'EXPIRED' || session.expiresAt.getTime() < Date.now()) {
      throw new AppError('SESSION_EXPIRED', 'Your table session has expired. Please scan the QR code again.');
    }
    if (session.tokenVersion !== payload.tv) {
      throw new AppError('SESSION_EXPIRED', 'Your table session was replaced. Please scan again.');
    }
    const device = session.devices[0];
    if (!device) {
      throw new AppError('SESSION_EXPIRED', 'This device is no longer part of the table session.');
    }
    if (device.blocked) {
      throw new AppError('SESSION_BLOCKED', 'This device has been blocked. Please ask a member of staff.');
    }

    req.customer = {
      sessionId: session.id,
      deviceId: device.id,
      branchId: session.branchId,
      tableId: session.tableId,
      restaurantId: session.branch.restaurantId,
      status: session.status,
      tableNumber: session.table.number,
      expiresAt: session.expiresAt,
      requiresLocation: session.branch.requireLocation,
      verified: !session.branch.requireLocation || device.verifiedAt !== null,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/** For actions that need a fully verified, order-capable session on this device. */
export function requireActiveTableSession(req: Request, _res: Response, next: NextFunction) {
  if (!req.customer) return next(AppError.unauthorized());

  if (!req.customer.verified) {
    return next(
      new AppError('LOCATION_REQUIRED', 'Please confirm you are at the restaurant before ordering.'),
    );
  }
  if (!sessionCanOrder(req.customer.status as never)) {
    if (req.customer.status === 'LOCATION_PENDING' || req.customer.status === 'CREATED') {
      return next(
        new AppError('LOCATION_REQUIRED', 'Please confirm you are at the restaurant before ordering.'),
      );
    }
    return next(new AppError('SESSION_EXPIRED', 'Your table session is not active.'));
  }
  next();
}

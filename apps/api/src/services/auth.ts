import crypto from 'node:crypto';
import type { Request } from 'express';
import type { Role } from '@tableflow/shared';
import { permissionsForRole } from '@tableflow/shared';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { generateOpaqueToken, hashIp, hashPassword, sha256, verifyPassword } from '../lib/crypto.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { writeAudit } from './audit.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  role: Role;
  permissions: string[];
  restaurant: { id: string; name: string; currency: string; logoUrl: string | null };
  branches: Array<{ id: string; name: string; slug: string; timezone: string }>;
  membershipId: string;
}

async function issueTokens(params: {
  userId: string;
  membershipId: string;
  restaurantId: string;
  role: Role;
  branchIds: string[];
  familyId?: string;
  req?: Request;
}): Promise<AuthTokens> {
  const jti = crypto.randomUUID();
  const familyId = params.familyId ?? crypto.randomUUID();

  const refreshToken = signRefreshToken({ sub: params.userId, jti, familyId });

  await prisma.refreshToken.create({
    data: {
      id: jti,
      userId: params.userId,
      tokenHash: sha256(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000),
      userAgent: params.req?.headers['user-agent']?.slice(0, 300) ?? null,
      ipHash: hashIp(params.req?.ip),
    },
  });

  const accessToken = signAccessToken({
    sub: params.userId,
    membershipId: params.membershipId,
    restaurantId: params.restaurantId,
    role: params.role,
    branchIds: params.branchIds,
  });

  return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL };
}

async function buildSessionUser(membershipId: string): Promise<SessionUser> {
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { id: membershipId },
    include: {
      user: { select: { id: true, email: true, fullName: true, avatarUrl: true } },
      restaurant: { select: { id: true, name: true, currency: true, logoUrl: true } },
      branches: { select: { branchId: true } },
    },
  });

  const scoped = membership.branches.map((b) => b.branchId);
  const branches = await prisma.branch.findMany({
    where:
      scoped.length > 0
        ? { id: { in: scoped } }
        : { restaurantId: membership.restaurantId, active: true },
    select: { id: true, name: true, slug: true, timezone: true },
    orderBy: { name: 'asc' },
  });

  return {
    id: membership.user.id,
    email: membership.user.email,
    fullName: membership.user.fullName,
    avatarUrl: membership.user.avatarUrl,
    role: membership.role as Role,
    permissions: permissionsForRole(membership.role as Role),
    restaurant: membership.restaurant,
    branches,
    membershipId: membership.id,
  };
}

export async function login(params: { email: string; password: string; req?: Request }) {
  const user = await prisma.user.findUnique({
    where: { email: params.email },
    include: {
      memberships: {
        where: { active: true },
        include: { branches: { select: { branchId: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  // Always run a hash comparison so a missing account and a wrong password take
  // roughly the same time — no user enumeration through response latency.
  const hash = user?.passwordHash ?? '$2a$12$0000000000000000000000000000000000000000000000000000';
  const passwordOk = await verifyPassword(params.password, hash);

  if (!user || !passwordOk) {
    throw AppError.unauthorized('That email or password is not correct.');
  }
  if (!user.active) {
    throw AppError.unauthorized('This account has been deactivated. Please contact your manager.');
  }

  const membership = user.memberships[0];
  if (!membership) {
    throw AppError.forbidden('This account is not linked to a restaurant.');
  }

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

  const tokens = await issueTokens({
    userId: user.id,
    membershipId: membership.id,
    restaurantId: membership.restaurantId,
    role: membership.role as Role,
    branchIds,
    req: params.req,
  });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  void writeAudit({
    action: 'auth.login',
    entity: 'User',
    entityId: user.id,
    restaurantId: membership.restaurantId,
    actorType: 'STAFF',
    actorUserId: user.id,
    actorLabel: user.email,
    req: params.req,
  });

  return { ...tokens, user: await buildSessionUser(membership.id) };
}

export async function refresh(params: { token: string; req?: Request }) {
  const payload = verifyRefreshToken(params.token);
  const tokenHash = sha256(params.token);

  const stored = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });

  if (!stored || stored.tokenHash !== tokenHash) {
    throw AppError.unauthorized('Your session has expired. Please sign in again.');
  }

  // Refresh token reuse means the token leaked. Kill the whole family, not just this one.
  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn({ userId: stored.userId, familyId: stored.familyId }, 'refresh token reuse detected');
    void writeAudit({
      action: 'auth.refresh_reuse_detected',
      entity: 'User',
      entityId: stored.userId,
      actorType: 'SYSTEM',
      metadata: { familyId: stored.familyId },
      req: params.req,
    });
    throw AppError.unauthorized('Your session has expired. Please sign in again.');
  }

  if (stored.expiresAt.getTime() < Date.now()) {
    throw AppError.unauthorized('Your session has expired. Please sign in again.');
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: stored.userId, active: true },
    include: { branches: { select: { branchId: true } }, user: { select: { active: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (!membership || !membership.user.active) {
    throw AppError.unauthorized('Your access has been revoked.');
  }

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

  const tokens = await issueTokens({
    userId: stored.userId,
    membershipId: membership.id,
    restaurantId: membership.restaurantId,
    role: membership.role as Role,
    branchIds,
    familyId: stored.familyId,
    req: params.req,
  });

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date(), replacedById: sha256(tokens.refreshToken).slice(0, 32) },
  });

  return { ...tokens, user: await buildSessionUser(membership.id) };
}

export async function logout(params: { token?: string | null; userId?: string | null; req?: Request }) {
  if (params.token) {
    try {
      const payload = verifyRefreshToken(params.token);
      await prisma.refreshToken.updateMany({
        where: { familyId: payload.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // An already-invalid token is fine — the caller wanted to be signed out anyway.
    }
  } else if (params.userId) {
    await prisma.refreshToken.updateMany({
      where: { userId: params.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  if (params.userId) {
    void writeAudit({
      action: 'auth.logout',
      entity: 'User',
      entityId: params.userId,
      actorType: 'STAFF',
      actorUserId: params.userId,
      req: params.req,
    });
  }
}

export async function getSessionUser(membershipId: string) {
  return buildSessionUser(membershipId);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/** Self-serve signup: creates the restaurant, its first branch and the owner account. */
export async function register(params: {
  email: string;
  password: string;
  fullName: string;
  restaurantName: string;
  req?: Request;
}) {
  const existing = await prisma.user.findUnique({ where: { email: params.email } });
  if (existing) {
    throw AppError.conflict('An account already exists for that email address.');
  }

  const baseSlug = slugify(params.restaurantName) || 'restaurant';
  let slug = baseSlug;
  let attempt = 1;
  while (await prisma.restaurant.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${attempt}`;
    attempt += 1;
  }

  const membership = await prisma.$transaction(async (tx) => {
    const restaurant = await tx.restaurant.create({
      data: { name: params.restaurantName, slug, currency: 'TND' },
    });

    await tx.branch.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Main branch',
        slug: 'main',
        latitude: 36.8065,
        longitude: 10.1815,
        serviceRadiusMeters: 150,
        openingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
          dayOfWeek,
          opensAt: '08:00',
          closesAt: '23:30',
          closed: false,
        })),
      },
    });

    const user = await tx.user.create({
      data: {
        email: params.email,
        passwordHash: await hashPassword(params.password),
        fullName: params.fullName,
      },
    });

    await tx.employeeProfile.create({
      data: { userId: user.id, restaurantId: restaurant.id, position: 'Owner', hiredAt: new Date() },
    });

    return tx.membership.create({
      data: { userId: user.id, restaurantId: restaurant.id, role: 'OWNER' },
    });
  });

  void writeAudit({
    action: 'auth.register',
    entity: 'Restaurant',
    entityId: membership.restaurantId,
    restaurantId: membership.restaurantId,
    actorType: 'STAFF',
    actorUserId: membership.userId,
    req: params.req,
  });

  return login({ email: params.email, password: params.password, req: params.req });
}

export async function changePassword(params: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  req?: Request;
}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: params.userId } });
  const ok = await verifyPassword(params.currentPassword, user.passwordHash);
  if (!ok) throw AppError.unauthorized('Your current password is not correct.');

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(params.newPassword) },
  });

  // Changing a password signs out every other device.
  await prisma.refreshToken.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  void writeAudit({
    action: 'auth.password_changed',
    entity: 'User',
    entityId: user.id,
    actorType: 'STAFF',
    actorUserId: user.id,
    req: params.req,
  });
}

export function newDeviceKey(): string {
  return generateOpaqueToken(16);
}

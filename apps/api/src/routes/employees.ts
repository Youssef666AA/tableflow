import { Router } from 'express';
import { ROLE_RANK, canAssignRole, createEmployeeSchema, updateEmployeeSchema, type Role } from '@tableflow/shared';
import { AppError } from '../lib/errors.js';
import { hashPassword } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler, rateLimits, validate } from '../middleware/common.js';
import { writeAudit } from '../services/audit.js';

export const employeesRouter: Router = Router();

employeesRouter.use(authenticate);

employeesRouter.get(
  '/',
  requirePermission('employees:view'),
  asyncHandler(async (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const memberships = await prisma.membership.findMany({
      where: {
        restaurantId: req.auth!.restaurantId,
        ...(search
          ? {
              user: {
                OR: [
                  { fullName: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            phone: true,
            avatarUrl: true,
            active: true,
            lastLoginAt: true,
            createdAt: true,
            employeeProfile: { select: { position: true, hiredAt: true } },
          },
        },
        branches: { include: { branch: { select: { id: true, name: true } } } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    res.json({
      employees: memberships.map((m) => ({
        membershipId: m.id,
        id: m.user.id,
        email: m.user.email,
        fullName: m.user.fullName,
        phone: m.user.phone,
        avatarUrl: m.user.avatarUrl,
        role: m.role,
        active: m.active && m.user.active,
        position: m.user.employeeProfile?.position ?? null,
        hiredAt: m.user.employeeProfile?.hiredAt ?? null,
        lastLoginAt: m.user.lastLoginAt,
        createdAt: m.user.createdAt,
        branches: m.branches.map((b) => b.branch),
        allBranches: m.branches.length === 0,
      })),
    });
  }),
);

/** Guards against privilege escalation: you can never mint a role above your own. */
function assertCanAssign(actorRole: Role, targetRole: Role) {
  if (!canAssignRole(actorRole, targetRole)) {
    throw AppError.forbidden(`A ${actorRole.toLowerCase()} cannot assign the ${targetRole.toLowerCase()} role.`);
  }
}

employeesRouter.post(
  '/',
  rateLimits.write,
  requirePermission('employees:manage'),
  validate(createEmployeeSchema),
  asyncHandler(async (req, res) => {
    const actor = req.auth!;
    assertCanAssign(actor.role, req.body.role);

    const branchIds: string[] = req.body.branchIds ?? [];
    const invalid = branchIds.filter((id) => !actor.branchIds.includes(id));
    if (invalid.length > 0) throw AppError.forbidden('You cannot assign branches you do not manage.');

    const existing = await prisma.user.findUnique({ where: { email: req.body.email } });
    if (existing) throw AppError.conflict('An account already exists for that email address.');

    const membership = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: req.body.email,
          fullName: req.body.fullName,
          phone: req.body.phone ?? null,
          passwordHash: await hashPassword(req.body.password),
        },
      });

      await tx.employeeProfile.create({
        data: {
          userId: user.id,
          restaurantId: actor.restaurantId,
          position: req.body.position ?? null,
          phone: req.body.phone ?? null,
          hiredAt: new Date(),
        },
      });

      return tx.membership.create({
        data: {
          userId: user.id,
          restaurantId: actor.restaurantId,
          role: req.body.role,
          branches: { create: branchIds.map((branchId) => ({ branchId })) },
        },
        include: { user: { select: { id: true, email: true, fullName: true } } },
      });
    });

    void writeAudit({
      action: 'employee.created',
      entity: 'User',
      entityId: membership.userId,
      restaurantId: actor.restaurantId,
      req,
      metadata: { role: req.body.role, email: req.body.email },
    });

    res.status(201).json({
      employee: {
        membershipId: membership.id,
        id: membership.user.id,
        email: membership.user.email,
        fullName: membership.user.fullName,
        role: membership.role,
      },
    });
  }),
);

employeesRouter.put(
  '/:membershipId',
  rateLimits.write,
  requirePermission('employees:manage'),
  validate(updateEmployeeSchema),
  asyncHandler(async (req, res) => {
    const actor = req.auth!;
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: req.params.membershipId },
      include: { user: true },
    });

    if (membership.restaurantId !== actor.restaurantId) {
      throw AppError.forbidden('That employee belongs to another restaurant.');
    }
    // You may not edit someone at or above your own rank (except yourself).
    if (membership.userId !== actor.userId && ROLE_RANK[membership.role as Role] >= ROLE_RANK[actor.role]) {
      throw AppError.forbidden('You cannot modify an account at or above your own level.');
    }
    if (req.body.role) assertCanAssign(actor.role, req.body.role);

    if (req.body.branchIds) {
      const invalid = req.body.branchIds.filter((id: string) => !actor.branchIds.includes(id));
      if (invalid.length > 0) throw AppError.forbidden('You cannot assign branches you do not manage.');
    }

    // A restaurant must always keep at least one active owner.
    if ((req.body.role && req.body.role !== 'OWNER') || req.body.active === false) {
      if (membership.role === 'OWNER') {
        const owners = await prisma.membership.count({
          where: { restaurantId: actor.restaurantId, role: 'OWNER', active: true },
        });
        if (owners <= 1) throw AppError.conflict('A restaurant must keep at least one active owner.');
      }
    }

    await prisma.$transaction(async (tx) => {
      if (req.body.fullName || req.body.phone !== undefined || req.body.active !== undefined || req.body.password) {
        await tx.user.update({
          where: { id: membership.userId },
          data: {
            ...(req.body.fullName ? { fullName: req.body.fullName } : {}),
            ...(req.body.phone !== undefined ? { phone: req.body.phone } : {}),
            ...(req.body.active !== undefined ? { active: req.body.active } : {}),
            ...(req.body.password ? { passwordHash: await hashPassword(req.body.password) } : {}),
          },
        });
      }

      if (req.body.password || req.body.active === false) {
        await tx.refreshToken.updateMany({
          where: { userId: membership.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      if (req.body.position !== undefined) {
        await tx.employeeProfile.update({
          where: { userId: membership.userId },
          data: { position: req.body.position },
        });
      }

      await tx.membership.update({
        where: { id: membership.id },
        data: {
          ...(req.body.role ? { role: req.body.role } : {}),
          ...(req.body.active !== undefined ? { active: req.body.active } : {}),
        },
      });

      if (req.body.branchIds) {
        await tx.membershipBranch.deleteMany({ where: { membershipId: membership.id } });
        if (req.body.branchIds.length > 0) {
          await tx.membershipBranch.createMany({
            data: req.body.branchIds.map((branchId: string) => ({ membershipId: membership.id, branchId })),
          });
        }
      }
    });

    void writeAudit({
      action: req.body.role ? 'employee.role_changed' : 'employee.updated',
      entity: 'User',
      entityId: membership.userId,
      restaurantId: actor.restaurantId,
      req,
      metadata: { from: membership.role, to: req.body.role ?? membership.role, fields: Object.keys(req.body) },
    });

    res.status(204).end();
  }),
);

employeesRouter.delete(
  '/:membershipId',
  rateLimits.write,
  requirePermission('employees:manage'),
  asyncHandler(async (req, res) => {
    const actor = req.auth!;
    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: req.params.membershipId } });

    if (membership.restaurantId !== actor.restaurantId) throw AppError.forbidden('Not your employee.');
    if (membership.userId === actor.userId) throw AppError.conflict('You cannot remove your own access.');
    if (ROLE_RANK[membership.role as Role] >= ROLE_RANK[actor.role]) {
      throw AppError.forbidden('You cannot remove an account at or above your own level.');
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.update({ where: { id: membership.id }, data: { active: false } });
      await tx.user.update({ where: { id: membership.userId }, data: { active: false } });
      await tx.refreshToken.updateMany({
        where: { userId: membership.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    void writeAudit({
      action: 'employee.deactivated',
      entity: 'User',
      entityId: membership.userId,
      restaurantId: actor.restaurantId,
      req,
    });

    res.status(204).end();
  }),
);

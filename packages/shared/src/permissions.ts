import type { Role } from './constants.js';

export const PERMISSIONS = [
  'dashboard:view',
  'orders:view',
  'orders:create',
  'orders:update_status',
  'orders:cancel',
  'kitchen:view',
  'kitchen:update',
  'tables:view',
  'tables:manage',
  'tables:qr_manage',
  'tables:status_update',
  'sessions:view',
  'sessions:close',
  'menu:view',
  'menu:manage',
  'inventory:view',
  'inventory:manage',
  'inventory:waste',
  'employees:view',
  'employees:manage',
  'analytics:view',
  'settings:view',
  'settings:manage',
  'billing:view',
  'billing:process',
  'requests:view',
  'requests:handle',
  'reviews:view',
  'reviews:manage',
  'promotions:view',
  'promotions:manage',
  'audit:view',
  'notifications:view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

const MANAGER: Permission[] = [
  'dashboard:view',
  'orders:view',
  'orders:create',
  'orders:update_status',
  'orders:cancel',
  'kitchen:view',
  'kitchen:update',
  'tables:view',
  'tables:manage',
  'tables:qr_manage',
  'tables:status_update',
  'sessions:view',
  'sessions:close',
  'menu:view',
  'menu:manage',
  'inventory:view',
  'inventory:manage',
  'inventory:waste',
  'employees:view',
  'analytics:view',
  'settings:view',
  'billing:view',
  'billing:process',
  'requests:view',
  'requests:handle',
  'reviews:view',
  'reviews:manage',
  'promotions:view',
  'promotions:manage',
  'notifications:view',
];

const WAITER: Permission[] = [
  'dashboard:view',
  'orders:view',
  'orders:create',
  'orders:update_status',
  'tables:view',
  'tables:status_update',
  'sessions:view',
  'sessions:close',
  'menu:view',
  'kitchen:view',
  'billing:view',
  'requests:view',
  'requests:handle',
  'notifications:view',
];

const KITCHEN: Permission[] = [
  'dashboard:view',
  'orders:view',
  'orders:update_status',
  'kitchen:view',
  'kitchen:update',
  'menu:view',
  'inventory:view',
  'inventory:waste',
  'notifications:view',
];

const CASHIER: Permission[] = [
  'dashboard:view',
  'orders:view',
  'tables:view',
  'sessions:view',
  'sessions:close',
  'menu:view',
  'billing:view',
  'billing:process',
  'requests:view',
  'requests:handle',
  'notifications:view',
];

const INVENTORY: Permission[] = [
  'dashboard:view',
  'menu:view',
  'inventory:view',
  'inventory:manage',
  'inventory:waste',
  'notifications:view',
];

const ADMIN: Permission[] = ALL.filter((p) => p !== 'settings:manage' || true);

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: ALL,
  ADMIN,
  MANAGER,
  WAITER,
  KITCHEN,
  CASHIER,
  INVENTORY,
};

/** Relative authority, used to stop staff from escalating their own privileges. */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 100,
  ADMIN: 80,
  MANAGER: 60,
  CASHIER: 40,
  WAITER: 40,
  KITCHEN: 40,
  INVENTORY: 40,
};

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return permissionsForRole(role).includes(permission);
}

export function canAny(role: Role | undefined | null, permissions: Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

export function canAll(role: Role | undefined | null, permissions: Permission[]): boolean {
  return permissions.every((p) => can(role, p));
}

/** Only OWNER can mint another OWNER; ADMIN can manage everyone below them. */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === 'OWNER') return true;
  if (actor === 'ADMIN') return target !== 'OWNER';
  return false;
}

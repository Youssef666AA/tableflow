import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2, Check, ChevronDown, LogOut, Menu, Utensils, X, type LucideIcon } from 'lucide-react';
import type { Permission } from '@tableflow/shared';
import { cn } from '@/lib/cn';
import { useAuth } from '@/lib/auth';
import { initialsOf, titleCase } from '@/lib/format';
import { Button, IconButton } from '@/components/ui/primitives';
import { NotificationBell } from './NotificationBell';

export interface NavItem {
  to: string;
  label: string;
  Icon: LucideIcon;
  permission?: Permission;
  end?: boolean;
  /** Optional live count rendered as a pill. */
  badge?: number;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export function ConsoleLayout({
  sections,
  title,
  children,
  compactSidebar,
}: {
  sections: NavSection[];
  title: string;
  children: ReactNode;
  compactSidebar?: boolean;
}) {
  const { user, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const visible = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.permission || can(item.permission)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="flex min-h-[100dvh] bg-canvas">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'sticky top-0 hidden h-[100dvh] shrink-0 flex-col border-r border-line bg-surface lg:flex',
          compactSidebar ? 'w-[15rem]' : 'w-[16.5rem]',
        )}
      >
        <BrandBlock />
        <BranchSwitcher />
        <nav className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {visible.map((section, index) => (
            <div key={index} className={index > 0 ? 'mt-5' : undefined}>
              {section.label && (
                <p className="mb-1.5 px-3 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <SidebarLink item={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <UserBlock />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
              aria-hidden
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 340 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-line bg-surface lg:hidden"
            >
              <div className="flex items-center justify-between">
                <BrandBlock />
                <IconButton label="Close menu" className="mr-3" onClick={() => setMobileOpen(false)}>
                  <X className="size-4" />
                </IconButton>
              </div>
              <BranchSwitcher />
              <nav className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-3 py-3">
                {visible.map((section, index) => (
                  <div key={index} className={index > 0 ? 'mt-5' : undefined}>
                    {section.label && (
                      <p className="mb-1.5 px-3 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                        {section.label}
                      </p>
                    )}
                    <ul className="space-y-0.5">
                      {section.items.map((item) => (
                        <li key={item.to} onClick={() => setMobileOpen(false)}>
                          <SidebarLink item={item} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
              <UserBlock />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur-lg lg:px-6">
          <IconButton label="Open menu" className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="size-4" />
          </IconButton>
          {/* Visual context only — the page below owns the document's heading. */}
          <p className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-ink">{title}</p>
          <NotificationBell />
          <span className="hidden text-xs text-ink-muted sm:inline">{user?.restaurant.name}</span>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const { Icon } = item;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-accent-soft text-accent-strong'
            : 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon className="size-[1.0625rem] shrink-0" strokeWidth={isActive ? 2.1 : 1.7} />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.badge !== undefined && item.badge > 0 && (
            <span
              className={cn(
                'tabular rounded-full px-1.5 py-px text-2xs font-semibold',
                isActive ? 'bg-accent text-white' : 'bg-line text-ink-soft',
              )}
            >
              {item.badge > 99 ? '99+' : item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function BrandBlock() {
  const { user } = useAuth();
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line px-5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-ink text-ink-inverse">
        <Utensils className="size-4" strokeWidth={1.9} aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-sm font-semibold leading-none text-ink">{user?.restaurant.name ?? 'TableFlow'}</p>
        <p className="mt-1 text-[0.5625rem] uppercase tracking-[0.16em] text-ink-muted">Scan. Order. Serve.</p>
      </div>
    </div>
  );
}

function BranchSwitcher() {
  const { user, branchId, branchName, setBranchId } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user || user.branches.length <= 1) return null;

  return (
    <div className="relative border-b border-line px-3 py-3">
      <button
        onClick={() => setOpen((value) => !value)}
        disabled={user.branches.length === 1}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md border border-line px-3 py-2 text-left transition-colors',
          user.branches.length > 1 && 'hover:bg-surface-sunken',
        )}
      >
        <Building2 className="size-4 shrink-0 text-ink-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-2xs text-ink-muted">Branch</span>
          <span className="block truncate text-[0.8125rem] font-medium text-ink">{branchName || '—'}</span>
        </span>
        {user.branches.length > 1 && (
          <ChevronDown
            className={cn('size-3.5 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-x-3 top-[calc(100%-0.25rem)] z-20 overflow-hidden rounded-md border border-line bg-surface shadow-overlay"
          >
            {user.branches.map((branch) => (
              <li key={branch.id}>
                <button
                  onClick={() => {
                    setBranchId(branch.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[0.8125rem] text-ink-soft transition-colors hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                  {branch.id === branchId && <Check className="size-3.5 shrink-0 text-accent" aria-hidden />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserBlock() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  return (
    <div className="shrink-0 border-t border-line p-3">
      <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-strong">
          {initialsOf(user.fullName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8125rem] font-medium text-ink">{user.fullName}</span>
          <span className="block truncate text-2xs text-ink-muted">{titleCase(user.role)}</span>
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        fullWidth
        className="mt-1 justify-start"
        leadingIcon={<LogOut className="size-3.5" />}
        onClick={async () => {
          await logout();
          navigate('/staff/login', { replace: true });
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

import { AnimatePresence, motion } from 'framer-motion';
import { BellRing, ClipboardList, Receipt, UtensilsCrossed } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';
import { useConnectionState } from '@/lib/hooks';
import { ConnectionIndicator } from '@/components/ui/feedback';
import { useCart } from '../cart';
import { useSession } from '../session';

/* -------------------------------------------------------------- Header */

export function RestaurantHeader({ compact }: { compact?: boolean }) {
  const { data, sessionToken } = useSession();
  const connection = useConnectionState('customer', sessionToken);
  const { restaurant, table, openState, branch } = data;

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-line/60 bg-[#FAF8F5]/90 backdrop-blur-xl',
        'pt-[env(safe-area-inset-top,0px)]',
      )}
    >
      <div className={cn('mx-auto flex max-w-phone items-center gap-3 px-4', compact ? 'py-2.5' : 'py-3')}>
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#141413] text-white shadow-xs ring-1 ring-black/5">
          {restaurant.logoUrl ? (
            <img src={restaurant.logoUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="font-display text-base font-bold">
              {restaurant.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-[1.0625rem] font-bold leading-tight text-ink">
              {restaurant.name}
            </h1>
          </div>

          <div className="mt-1 flex items-center gap-2">
            {/* Live Table status pill with pulsing emerald indicator */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-ink shadow-xs ring-1 ring-black/5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              Table {table.number}
            </span>

            {openState.open ? (
              <span className="text-[11px] font-medium text-emerald-700">
                Open{openState.closesAt ? ` until ${openState.closesAt}` : ''}
              </span>
            ) : (
              <span className="text-[11px] font-medium text-danger">Closed</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <ConnectionIndicator state={connection} compact />
          {!compact && (
            <span className="max-w-[7rem] truncate text-[11px] font-medium text-ink-muted">
              {branch.name.split('—')[0]?.trim()}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

/* ----------------------------------------------------------- BottomNav */

const NAV_ITEMS = [
  { to: 'menu', label: 'Menu', Icon: UtensilsCrossed },
  { to: 'orders', label: 'Orders', Icon: ClipboardList, badge: 'orders' as const },
  { to: 'services', label: 'Service', Icon: BellRing, badge: 'requests' as const },
  { to: 'bill', label: 'Bill', Icon: Receipt },
];

export function BottomNav() {
  const { data } = useSession();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-white/90 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-phone items-stretch justify-around px-2 pb-[env(safe-area-inset-bottom,0px)]">
        {NAV_ITEMS.map(({ to, label, Icon, badge }) => {
          const count =
            badge === 'orders'
              ? data.counts.activeOrders
              : badge === 'requests'
                ? data.counts.openRequests
                : 0;

          return (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'tap relative flex flex-1 flex-col items-center justify-center gap-1 py-2 text-[11px] transition-all',
                  isActive ? 'font-bold text-accent' : 'font-medium text-ink-muted hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon className="size-5" strokeWidth={isActive ? 2.3 : 1.8} aria-hidden />
                    {count > 0 && (
                      <span className="absolute -right-2.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-white shadow-xs">
                        {count > 9 ? '9+' : count}
                      </span>
                    )}
                  </span>
                  <span>{label}</span>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active-dot"
                      className="absolute bottom-1 size-1 rounded-full bg-accent"
                      transition={{ type: 'spring', damping: 26, stiffness: 360 }}
                    />
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

/* -------------------------------------------------------------- CartBar */

/**
 * The sticky checkout affordance. It floats above the bottom navigation and
 * only appears when there is something in the cart, so it never steals space
 * from the menu.
 */
export function CartBar() {
  const { itemCount, quote, estimatedTotal, quoteLoading } = useCart();
  const { currency } = useSession();
  const navigate = useNavigate();

  const total = quote?.total ?? estimatedTotal;

  return (
    <AnimatePresence>
      {itemCount > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-30 px-4"
        >
          <button
            type="button"
            onClick={() => navigate('cart')}
            className="pointer-events-auto mx-auto flex h-14 w-full max-w-phone items-center justify-between gap-3 rounded-2xl bg-[#141413]/95 px-5 text-white shadow-float backdrop-blur-xl border border-white/10 transition-transform active:scale-[0.98] hover:bg-[#141413]"
          >
            <span className="flex items-center gap-3">
              <span className="flex size-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-white shadow-xs">
                {itemCount}
              </span>
              <span className="text-sm font-semibold tracking-wide">View cart</span>
            </span>
            <span className={cn('tabular font-display text-sm font-bold text-white/95', quoteLoading && 'opacity-60')}>
              {money(total, currency)} →
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------- SessionBanner */

export function TableSessionBanner() {
  const { data } = useSession();
  const minutes = Math.max(0, Math.round((new Date(data.session.expiresAt).getTime() - Date.now()) / 60000));

  if (minutes > 20) return null;

  return (
    <div className="mx-4 mt-3 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-2.5">
      <p className="text-xs leading-relaxed text-warning">
        Your table session ends in about {minutes} {minutes === 1 ? 'minute' : 'minutes'}. Placing another
        order extends it automatically.
      </p>
    </div>
  );
}


/* ----------------------------------------------------------- PageHeader */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 px-4 pb-1 pt-5">
      <div className="min-w-0">
        <h2 className="font-display text-[1.375rem] font-bold leading-tight tracking-tight text-ink">
          {title}
        </h2>
        {description && <p className="mt-1 text-xs leading-snug text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

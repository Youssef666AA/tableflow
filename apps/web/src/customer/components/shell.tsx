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
        'sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-lg',
        'pt-[env(safe-area-inset-top,0px)]',
      )}
    >
      <div className={cn('mx-auto flex max-w-phone items-center gap-3 px-4', compact ? 'py-2.5' : 'py-3')}>
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink text-ink-inverse">
          {restaurant.logoUrl ? (
            <img src={restaurant.logoUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="font-display text-base font-semibold">
              {restaurant.name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[1.0625rem] font-semibold leading-tight text-ink">
            {restaurant.name}
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-muted">
            <span className="font-medium text-ink-soft">Table {table.number}</span>
            <span aria-hidden>·</span>
            {openState.open ? (
              <span className="text-success">
                Open{openState.closesAt ? ` until ${openState.closesAt}` : ''}
              </span>
            ) : (
              <span className="text-danger">
                Closed{openState.opensAt ? ` · opens ${openState.opensAt}` : ''}
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <ConnectionIndicator state={connection} compact />
          {!compact && <span className="truncate text-2xs text-ink-muted">{branch.name.split('—')[0]?.trim()}</span>}
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
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur-lg"
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
                  'tap relative flex flex-1 flex-col items-center justify-center gap-1 py-2 text-2xs font-medium transition-colors',
                  isActive ? 'text-accent' : 'text-ink-muted hover:text-ink-soft',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <Icon className="size-[1.375rem]" strokeWidth={isActive ? 2.2 : 1.7} aria-hidden />
                    {count > 0 && (
                      <span className="absolute -right-2 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.5625rem] font-semibold leading-4 text-white">
                        {count > 9 ? '9+' : count}
                      </span>
                    )}
                  </span>
                  {label}
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
          className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom,0px))] z-30 px-4"
        >
          <button
            onClick={() => navigate('cart')}
            className="mx-auto flex h-14 w-full max-w-phone items-center justify-between gap-3 rounded-lg bg-ink px-5 text-ink-inverse shadow-overlay transition-transform active:scale-[0.99]"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex size-6 items-center justify-center rounded-full bg-white/15 text-xs font-semibold tabular">
                {itemCount}
              </span>
              <span className="text-[0.9375rem] font-medium">View cart</span>
            </span>
            <span className={cn('tabular text-[0.9375rem] font-semibold', quoteLoading && 'opacity-60')}>
              {money(total, currency)}
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
    <div className="mx-4 mt-3 rounded-md border border-warning/25 bg-warning-soft px-3.5 py-2.5">
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
        <h2 className="font-display text-[1.375rem] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h2>
        {description && <p className="mt-1 text-sm leading-snug text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

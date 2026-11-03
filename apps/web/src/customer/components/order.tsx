import { motion } from 'framer-motion';
import { Check, ChefHat, Clock, ConciergeBell, PackageCheck, Receipt, XCircle } from 'lucide-react';
import { prepTimeWindow } from '@tableflow/shared';
import { cn } from '@/lib/cn';
import { formatTime, money, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { Badge } from '@/components/ui/primitives';
import type { CustomerOrder } from '../types';

const STAGES = [
  { key: 'RECEIVED', label: 'Order received', Icon: Receipt, hint: 'The kitchen has accepted your ticket' },
  { key: 'PREPARING', label: 'Preparing', Icon: ChefHat, hint: 'Chefs are firing up your dishes' },
  { key: 'READY', label: 'Ready', Icon: PackageCheck, hint: 'Plated and on the counter for pickup' },
  { key: 'DELIVERED', label: 'Delivered', Icon: ConciergeBell, hint: 'Served at your table. Bon appétit!' },
] as const;

type StageKey = (typeof STAGES)[number]['key'];

function timestampFor(order: CustomerOrder, stage: StageKey): string | null {
  switch (stage) {
    case 'RECEIVED':
      return order.createdAt;
    case 'PREPARING':
      return order.startedAt;
    case 'READY':
      return order.readyAt;
    case 'DELIVERED':
      return order.deliveredAt ?? order.completedAt;
    default:
      return null;
  }
}

/**
 * The customer's live order tracker.
 *
 * Every dot reflects a timestamp the API actually recorded — nothing here is
 * guessed, and the state advances from live socket events.
 */
export function OrderTimeline({ order }: { order: CustomerOrder }) {
  const now = useNow(30_000);

  if (order.stage === 'CANCELLED') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger-soft p-4">
        <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div>
          <p className="text-sm font-bold text-danger">This order was cancelled</p>
          {order.cancelReason && <p className="mt-1 text-xs leading-relaxed text-danger/80">{order.cancelReason}</p>}
        </div>
      </div>
    );
  }

  const currentIndex = STAGES.findIndex((stage) => stage.key === order.stage);
  const window = prepTimeWindow(order.estimatedPrepMinutes);
  const elapsedMinutes = Math.floor((now - new Date(order.createdAt).getTime()) / 60000);
  const remaining = Math.max(0, window.max - elapsedMinutes);

  return (
    <div>
      {order.stage !== 'DELIVERED' && (
        <div className="mb-6 overflow-hidden rounded-2xl border border-line/75 bg-stone-50/80 p-4.5 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-ink-muted">
              <Clock className="size-3 text-accent" />
              Estimated time
            </p>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
              </span>
              Kitchen live
            </span>
          </div>
          <p className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">
            {order.stage === 'READY' ? 'Ready now' : remaining > 0 ? `${window.label}` : 'Any moment now'}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Placed {relativeTime(order.createdAt, now)} · {formatTime(order.createdAt)}
          </p>
        </div>
      )}

      <ol className="relative pl-1">
        {STAGES.map((stage, index) => {
          const complete = index < currentIndex;
          const active = index === currentIndex;
          const timestamp = timestampFor(order, stage.key);
          const isLast = index === STAGES.length - 1;

          return (
            <li key={stage.key} className="relative flex gap-4 pb-7 last:pb-1">
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-[1.125rem] top-9 h-[calc(100%-1.1rem)] w-0.5 rounded-full transition-colors duration-500',
                    complete ? 'bg-emerald-600' : active ? 'bg-gradient-to-b from-emerald-600 to-accent' : 'bg-line',
                  )}
                />
              )}

              <div className="relative shrink-0">
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-0 animate-pulse-ring rounded-full bg-accent/25"
                  />
                )}
                <motion.span
                  initial={false}
                  animate={{ scale: active ? 1.08 : 1 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 340 }}
                  className={cn(
                    'relative flex size-9 items-center justify-center rounded-full border-2 transition-all duration-300',
                    complete && 'border-emerald-600 bg-emerald-600 text-white shadow-xs',
                    active && 'border-accent bg-accent-soft text-accent ring-4 ring-accent/20',
                    !complete && !active && 'border-line/80 bg-surface text-ink-muted',
                  )}
                >
                  {complete ? (
                    <Check className="size-4 stroke-[3]" aria-hidden />
                  ) : (
                    <stage.Icon className="size-4" strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                  )}
                </motion.span>
              </div>

              <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p
                    className={cn(
                      'text-sm font-bold leading-tight',
                      complete ? 'text-emerald-800' : active ? 'text-ink font-bold' : 'text-ink-muted',
                    )}
                  >
                    {stage.label}
                  </p>
                  {timestamp && (
                    <span className="tabular shrink-0 text-xs font-medium text-ink-muted">
                      {formatTime(timestamp)}
                    </span>
                  )}
                </div>
                <p className={cn('mt-0.5 text-xs', active ? 'font-medium text-accent-strong' : 'text-ink-muted')}>
                  {active ? stage.hint : complete ? 'Completed' : 'Upcoming'}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------- OrderCard */

const STAGE_TONES: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  RECEIVED: 'warning',
  PREPARING: 'info',
  READY: 'success',
  DELIVERED: 'accent',
  CANCELLED: 'danger',
};

const STAGE_LABELS: Record<string, string> = {
  RECEIVED: 'Received',
  PREPARING: 'Preparing',
  READY: 'Ready',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export function OrderCard({
  order,
  currency,
  onOpen,
}: {
  order: CustomerOrder;
  currency: string;
  onOpen: () => void;
}) {
  const now = useNow(30_000);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-line/75 bg-surface p-4 text-left shadow-subtle transition-all active:scale-[0.99] hover:border-line-strong hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-sm font-bold text-ink">Order {order.reference}</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {relativeTime(order.createdAt, now)} · {order.items.length}{' '}
            {order.items.length === 1 ? 'item' : 'items'}
          </p>
        </div>
        <Badge tone={STAGE_TONES[order.stage] ?? 'neutral'} dot>
          {STAGE_LABELS[order.stage] ?? order.stage}
        </Badge>
      </div>

      <ul className="mt-3 space-y-1">
        {order.items.slice(0, 3).map((item) => (
          <li key={item.id} className="flex gap-2 text-xs text-ink-soft">
            <span className="tabular shrink-0 font-bold text-ink-muted">{item.quantity}×</span>
            <span className="truncate">
              {item.productName}
              {item.variantName && <span className="text-ink-muted"> · {item.variantName}</span>}
            </span>
          </li>
        ))}
        {order.items.length > 3 && (
          <li className="text-xs text-ink-muted">+{order.items.length - 3} more items</li>
        )}
      </ul>

      <div className="mt-3.5 flex items-center justify-between border-t border-line/60 pt-3">
        <span className="text-xs font-medium text-ink-muted">
          {order.paymentStatus === 'PAID' ? 'Paid' : 'Added to table bill'}
        </span>
        <span className="tabular text-sm font-bold text-ink">{money(order.total, currency)}</span>
      </div>
    </button>
  );
}

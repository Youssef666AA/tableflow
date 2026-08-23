import { motion } from 'framer-motion';
import { Check, ChefHat, ConciergeBell, PackageCheck, Receipt, XCircle } from 'lucide-react';
import { prepTimeWindow } from '@tableflow/shared';
import { cn } from '@/lib/cn';
import { formatTime, money, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { Badge } from '@/components/ui/primitives';
import type { CustomerOrder } from '../types';

const STAGES = [
  { key: 'RECEIVED', label: 'Order received', Icon: Receipt, hint: 'The restaurant has your order' },
  { key: 'PREPARING', label: 'Preparing', Icon: ChefHat, hint: 'The kitchen is cooking' },
  { key: 'READY', label: 'Ready', Icon: PackageCheck, hint: 'Plated and waiting for a waiter' },
  { key: 'DELIVERED', label: 'Delivered', Icon: ConciergeBell, hint: 'Enjoy your meal' },
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
 * animated on a guess, and the state advances from realtime events.
 */
export function OrderTimeline({ order }: { order: CustomerOrder }) {
  const now = useNow(30_000);

  if (order.stage === 'CANCELLED') {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-danger/25 bg-danger-soft p-4">
        <XCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-danger">This order was cancelled</p>
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
        <div className="mb-5 rounded-lg border border-line bg-surface-sunken/70 px-4 py-3">
          <p className="text-2xs font-medium uppercase tracking-wider text-ink-muted">Estimated time</p>
          <p className="mt-1 font-display text-xl font-semibold text-ink">
            {order.stage === 'READY' ? 'Ready now' : remaining > 0 ? `${window.label}` : 'Any moment now'}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Placed {relativeTime(order.createdAt, now)} · {formatTime(order.createdAt)}
          </p>
        </div>
      )}

      <ol className="relative">
        {STAGES.map((stage, index) => {
          const complete = index < currentIndex;
          const active = index === currentIndex;
          const timestamp = timestampFor(order, stage.key);
          const isLast = index === STAGES.length - 1;

          return (
            <li key={stage.key} className="relative flex gap-4 pb-6 last:pb-0">
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-[1.0625rem] top-9 h-[calc(100%-1.25rem)] w-0.5 rounded-full transition-colors duration-500',
                    complete ? 'bg-accent' : 'bg-line',
                  )}
                />
              )}

              <div className="relative shrink-0">
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-0 animate-pulse-ring rounded-full bg-accent/30"
                  />
                )}
                <motion.span
                  initial={false}
                  animate={{ scale: active ? 1.06 : 1 }}
                  transition={{ type: 'spring', damping: 18, stiffness: 320 }}
                  className={cn(
                    'relative flex size-[2.125rem] items-center justify-center rounded-full border-2 transition-colors duration-300',
                    complete && 'border-accent bg-accent text-white',
                    active && 'border-accent bg-surface text-accent',
                    !complete && !active && 'border-line bg-surface text-ink-muted',
                  )}
                >
                  {complete ? (
                    <Check className="size-4" strokeWidth={3} aria-hidden />
                  ) : (
                    <stage.Icon className="size-[1.0625rem]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                  )}
                </motion.span>
              </div>

              <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p
                    className={cn(
                      'text-[0.9375rem] font-medium leading-tight',
                      complete || active ? 'text-ink' : 'text-ink-muted',
                    )}
                  >
                    {stage.label}
                  </p>
                  {timestamp && (
                    <span className="tabular shrink-0 text-xs text-ink-muted">{formatTime(timestamp)}</span>
                  )}
                </div>
                <p className={cn('mt-0.5 text-xs', active ? 'text-accent-strong' : 'text-ink-muted')}>
                  {active ? stage.hint : complete ? 'Done' : '—'}
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
      onClick={onOpen}
      className="w-full rounded-lg border border-line bg-surface p-4 text-left shadow-subtle transition-all active:scale-[0.99] hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-[0.9375rem] font-semibold text-ink">Order {order.reference}</p>
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
          <li key={item.id} className="flex gap-2 text-[0.8125rem] text-ink-soft">
            <span className="tabular shrink-0 font-medium text-ink-muted">{item.quantity}×</span>
            <span className="truncate">
              {item.productName}
              {item.variantName && <span className="text-ink-muted"> · {item.variantName}</span>}
            </span>
          </li>
        ))}
        {order.items.length > 3 && (
          <li className="text-[0.8125rem] text-ink-muted">+{order.items.length - 3} more</li>
        )}
      </ul>

      <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-xs text-ink-muted">
          {order.paymentStatus === 'PAID' ? 'Paid' : 'Added to the table bill'}
        </span>
        <span className="tabular text-[0.9375rem] font-semibold text-ink">{money(order.total, currency)}</span>
      </div>
    </button>
  );
}

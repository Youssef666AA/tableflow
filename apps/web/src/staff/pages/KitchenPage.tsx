import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, ChefHat, Clock, Play, Timer, X } from 'lucide-react';
import { formatDuration, urgencyFor } from '@tableflow/shared';
import { ApiError, api, staffTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import { useNow, useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { Button, SegmentedControl, Spinner } from '@/components/ui/primitives';
import { ConnectionIndicator, EmptyState, ErrorState } from '@/components/ui/feedback';
import { ConfirmDialog, useToast } from '@/components/ui/overlays';
import { useConnectionState } from '@/lib/hooks';
import { NotificationBell } from '@/console/NotificationBell';

interface KitchenItem {
  id: string;
  productName: string;
  variantName: string | null;
  quantity: number;
  notes: string | null;
  status: string;
  station: { id: string; name: string; color: string | null } | null;
  modifiers: Array<{ groupName: string; optionName: string }>;
}

interface KitchenOrder {
  id: string;
  number: number;
  reference: string;
  status: string;
  tableNumber: string;
  zone: string | null;
  customerName: string | null;
  notes: string | null;
  createdAt: string;
  elapsedMs: number;
  targetMinutes: number;
  items: KitchenItem[];
}

interface KitchenPayload {
  branchId: string;
  slaMinutes: number;
  splitStationsEnabled: boolean;
  autoAcceptOrders: boolean;
  stations: Array<{ id: string; name: string; color: string | null }>;
  columns: { NEW: KitchenOrder[]; PREPARING: KitchenOrder[]; READY: KitchenOrder[] };
  orders: KitchenOrder[];
}

type Filter = 'all' | 'new' | 'preparing' | 'ready' | 'late';

/**
 * The kitchen display.
 *
 * Full-bleed, near-black and high contrast so it stays readable across a hot
 * line. Every card carries a live timer driven by the timestamps the API
 * recorded, and turns amber then red as it approaches and passes the branch's
 * target preparation time.
 */
export default function KitchenPage() {
  const { branchId, branchName } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const socket = useSocket('staff', staffTokens.access());
  const connection = useConnectionState('staff', staffTokens.access());
  const now = useNow(1000);

  const [stationId, setStationId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [rejecting, setRejecting] = useState<KitchenOrder | null>(null);

  const query = useQuery({
    queryKey: ['kitchen', branchId, stationId],
    queryFn: () =>
      api.get<KitchenPayload>(
        `/kitchen/orders?branchId=${branchId}${stationId ? `&stationId=${stationId}` : ''}`,
      ),
    enabled: Boolean(branchId),
    refetchInterval: 30_000,
  });

  useRealtimeInvalidation(socket, ['order:created', 'order:updated'], [['kitchen', branchId, stationId]]);

  const advance = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'start' | 'ready' }) =>
      api.patch(`/kitchen/orders/${id}/${action}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['kitchen'] }),
    onError: (error) =>
      toast.error('That did not go through', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.patch(`/kitchen/orders/${id}/reject`, { reason }),
    onSuccess: () => {
      setRejecting(null);
      void queryClient.invalidateQueries({ queryKey: ['kitchen'] });
      toast.success('Order rejected', 'The guest has been notified.');
    },
    onError: (error) =>
      toast.error('Could not reject', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const data = query.data;

  const lateCount = useMemo(
    () =>
      (data?.orders ?? []).filter(
        (order) => urgencyFor(now - new Date(order.createdAt).getTime(), order.targetMinutes) === 'critical',
      ).length,
    [data, now],
  );

  const columns = useMemo(() => {
    if (!data) return [];
    const isLate = (order: KitchenOrder) =>
      urgencyFor(now - new Date(order.createdAt).getTime(), order.targetMinutes) === 'critical';

    const base = [
      { key: 'NEW' as const, title: 'New', orders: data.columns.NEW },
      { key: 'PREPARING' as const, title: 'Preparing', orders: data.columns.PREPARING },
      { key: 'READY' as const, title: 'Ready', orders: data.columns.READY },
    ];

    if (filter === 'late') {
      return base.map((column) => ({ ...column, orders: column.orders.filter(isLate) }));
    }
    if (filter === 'all') return base;
    return base.filter((column) => column.key.toLowerCase() === filter);
  }, [data, filter, now]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur-lg">
        <button
          onClick={() => navigate('/staff')}
          className="-ml-2 inline-flex items-center gap-1.5 rounded p-2 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          <span className="hidden sm:inline">Staff</span>
        </button>

        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <ChefHat className="size-[1.125rem]" strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-display text-base font-semibold leading-none text-ink">
              Kitchen display
            </h1>
            <p className="mt-1 truncate text-2xs text-ink-muted">
              {branchName} · target {data?.slaMinutes ?? '—'} min
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ConnectionIndicator state={connection} />
          <NotificationBell />
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 pt-1">
          <SegmentedControl
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: data?.orders.length },
              { value: 'new', label: 'New', count: data?.columns.NEW.length },
              { value: 'preparing', label: 'Preparing', count: data?.columns.PREPARING.length },
              { value: 'ready', label: 'Ready', count: data?.columns.READY.length },
              { value: 'late', label: 'Late', count: lateCount },
            ]}
          />

          {data && data.splitStationsEnabled && data.stations.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <StationChip active={stationId === null} onClick={() => setStationId(null)} label="All stations" />
              {data.stations.map((station) => (
                <StationChip
                  key={station.id}
                  active={stationId === station.id}
                  onClick={() => setStationId(station.id)}
                  label={station.name}
                  color={station.color}
                />
              ))}
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 p-4">
        {query.isLoading && (
          <div className="flex h-72 items-center justify-center">
            <Spinner className="size-6" />
          </div>
        )}

        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

        {data && data.orders.length === 0 && (
          <EmptyState
            icon={<ChefHat className="size-5" />}
            title="No orders on the pass"
            description="New orders appear here the moment a guest places one. Nothing to cook right now."
            className="py-28"
          />
        )}

        {data && data.orders.length > 0 && (
          <div
            className={cn(
              'grid gap-4',
              columns.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3',
            )}
          >
            {columns.map((column) => (
              <section key={column.key} className="min-w-0">
                <div className="mb-3 flex items-center justify-between gap-2 px-1">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
                    {column.title}
                  </h2>
                  <span className="tabular rounded-full bg-surface-raised px-2 py-0.5 text-xs font-semibold text-ink-soft">
                    {column.orders.length}
                  </span>
                </div>

                <div className="space-y-3">
                  <AnimatePresence initial={false}>
                    {column.orders.map((order) => (
                      <KitchenCard
                        key={order.id}
                        order={order}
                        now={now}
                        busy={advance.isPending && advance.variables?.id === order.id}
                        onAccept={() => advance.mutate({ id: order.id, action: 'accept' })}
                        onStart={() => advance.mutate({ id: order.id, action: 'start' })}
                        onReady={() => advance.mutate({ id: order.id, action: 'ready' })}
                        onReject={() => setRejecting(order)}
                      />
                    ))}
                  </AnimatePresence>

                  {column.orders.length === 0 && (
                    <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-xs text-ink-muted">
                      Nothing here
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        onConfirm={() =>
          rejecting && reject.mutate({ id: rejecting.id, reason: 'Rejected by the kitchen' })
        }
        loading={reject.isPending}
        tone="danger"
        title={`Reject order ${rejecting?.reference ?? ''}?`}
        message="The guest is told immediately and any stock taken for this order is returned. This cannot be undone."
        confirmLabel="Reject order"
      />
    </div>
  );
}

function StationChip({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string | null;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line bg-surface text-ink-muted hover:text-ink-soft',
      )}
    >
      {color && <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />}
      {label}
    </button>
  );
}

function KitchenCard({
  order,
  now,
  busy,
  onAccept,
  onStart,
  onReady,
  onReject,
}: {
  order: KitchenOrder;
  now: number;
  busy: boolean;
  onAccept: () => void;
  onStart: () => void;
  onReady: () => void;
  onReject: () => void;
}) {
  const elapsedMs = now - new Date(order.createdAt).getTime();
  const urgency = urgencyFor(elapsedMs, order.targetMinutes);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', damping: 30, stiffness: 340 }}
      className={cn(
        'overflow-hidden rounded-lg border-2 bg-surface shadow-lift',
        urgency === 'critical' && 'border-danger',
        urgency === 'warning' && 'border-warning',
        urgency === 'normal' && 'border-line',
      )}
    >
      <header
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-3',
          urgency === 'critical' && 'bg-danger-soft',
          urgency === 'warning' && 'bg-warning-soft',
          urgency === 'normal' && 'bg-surface-raised',
        )}
      >
        <div className="min-w-0">
          <p className="tabular font-display text-xl font-semibold leading-none text-ink">
            {order.reference}
          </p>
          <p className="mt-1.5 truncate text-xs text-ink-soft">
            Table {order.tableNumber}
            {order.zone ? ` · ${order.zone}` : ''}
            {order.customerName ? ` · ${order.customerName}` : ''}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p
            className={cn(
              'tabular font-display text-xl font-semibold leading-none',
              urgency === 'critical' && 'text-danger',
              urgency === 'warning' && 'text-warning',
              urgency === 'normal' && 'text-ink',
            )}
          >
            {formatDuration(elapsedMs)}
          </p>
          <p className="mt-1.5 flex items-center justify-end gap-1 text-2xs text-ink-muted">
            <Clock className="size-3" aria-hidden />
            {formatTime(order.createdAt)}
          </p>
        </div>
      </header>

      {urgency !== 'normal' && (
        <p
          className={cn(
            'flex items-center gap-1.5 px-4 py-1.5 text-2xs font-semibold uppercase tracking-wider',
            urgency === 'critical' ? 'bg-danger text-white' : 'bg-warning text-white',
          )}
        >
          <Timer className="size-3" aria-hidden />
          {urgency === 'critical'
            ? `Over the ${order.targetMinutes} min target`
            : `Approaching ${order.targetMinutes} min`}
        </p>
      )}

      <ul className="divide-y divide-line px-4">
        {order.items.map((item) => (
          <li key={item.id} className="flex gap-3 py-3">
            <span className="tabular shrink-0 font-display text-lg font-semibold leading-tight text-accent">
              {item.quantity}×
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.9375rem] font-semibold leading-snug text-ink">
                {item.productName}
                {item.variantName && <span className="font-normal text-ink-soft"> · {item.variantName}</span>}
              </p>
              {item.modifiers.length > 0 && (
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-soft">
                  {item.modifiers.map((modifier) => modifier.optionName).join(' · ')}
                </p>
              )}
              {item.notes && (
                <p className="mt-1 rounded bg-warning-soft px-2 py-1 text-[0.8125rem] font-medium leading-snug text-warning">
                  {item.notes}
                </p>
              )}
            </div>
            {item.station && (
              <span
                className="mt-1 size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.station.color ?? undefined }}
                title={item.station.name}
                aria-label={item.station.name}
              />
            )}
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="mx-4 mb-3 rounded bg-info-soft px-3 py-2 text-[0.8125rem] leading-relaxed text-info">
          <span className="font-semibold">Guest note:</span> {order.notes}
        </p>
      )}

      <footer className="flex gap-2 border-t border-line p-3">
        {order.status === 'PENDING' && (
          <>
            <Button size="lg" className="flex-1" loading={busy} onClick={onAccept} leadingIcon={<Check className="size-4" />}>
              Accept
            </Button>
            <Button size="lg" variant="ghost" onClick={onReject} aria-label="Reject order">
              <X className="size-4" />
            </Button>
          </>
        )}

        {order.status === 'ACCEPTED' && (
          <Button size="lg" fullWidth loading={busy} onClick={onStart} leadingIcon={<Play className="size-4" />}>
            Start preparing
          </Button>
        )}

        {order.status === 'PREPARING' && (
          <Button size="lg" fullWidth loading={busy} onClick={onReady} leadingIcon={<Check className="size-4" />}>
            Mark ready
          </Button>
        )}

        {order.status === 'READY' && (
          <p className="w-full py-2 text-center text-sm font-medium text-accent">
            Waiting for a waiter to serve
          </p>
        )}
      </footer>
    </motion.article>
  );
}

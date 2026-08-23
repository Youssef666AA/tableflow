import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, ChefHat, Clock, Receipt, Users } from 'lucide-react';
import type { TableStatus } from '@tableflow/shared';
import { TABLE_STATUS_LABEL } from '@tableflow/shared';
import { cn } from '@/lib/cn';
import { money } from '@/lib/format';

export interface FloorTableSession {
  id: string;
  code: string;
  status: string;
  startedAt: string;
  expiresAt: string;
  guestCount: number;
  customerName: string | null;
  billRequestedAt: string | null;
  deviceCount: number;
  verifiedDevices: number;
  orderCount: number;
  openOrderCount: number;
  runningTotal: number;
  unpaidTotal: number;
  openRequests: Array<{ id: string; type: string; status: string; createdAt: string }>;
  elapsedMinutes: number;
}

export interface FloorTable {
  id: string;
  number: string;
  label: string | null;
  seats: number;
  zone: string | null;
  posX: number;
  posY: number;
  shape: 'ROUND' | 'SQUARE' | 'RECT';
  status: TableStatus;
  outOfService: boolean;
  needsCleaning: boolean;
  qr: { id: string; url: string; scanCount: number } | null;
  session: FloorTableSession | null;
}

/** One colour language for table state, shared by the plan and the list. */
export const STATUS_STYLES: Record<TableStatus, { dot: string; surface: string; border: string; text: string }> = {
  AVAILABLE: { dot: 'bg-success', surface: 'bg-surface', border: 'border-line', text: 'text-ink-muted' },
  ACTIVE: { dot: 'bg-info', surface: 'bg-info-soft', border: 'border-info/35', text: 'text-info' },
  ORDERING: { dot: 'bg-warning', surface: 'bg-warning-soft', border: 'border-warning/35', text: 'text-warning' },
  FOOD_READY: { dot: 'bg-accent', surface: 'bg-accent-soft', border: 'border-accent/40', text: 'text-accent-strong' },
  WAITING_FOR_BILL: { dot: 'bg-gold', surface: 'bg-gold-soft', border: 'border-gold/40', text: 'text-gold' },
  PAYMENT_PENDING: { dot: 'bg-gold', surface: 'bg-gold-soft', border: 'border-gold/40', text: 'text-gold' },
  CLEANING: { dot: 'bg-ink-muted', surface: 'bg-surface-sunken', border: 'border-line', text: 'text-ink-muted' },
  OUT_OF_SERVICE: { dot: 'bg-danger', surface: 'bg-danger-soft', border: 'border-danger/35', text: 'text-danger' },
};

export function FloorLegend({ counts }: { counts: Partial<Record<TableStatus, number>> }) {
  const order: TableStatus[] = [
    'AVAILABLE',
    'ACTIVE',
    'ORDERING',
    'FOOD_READY',
    'WAITING_FOR_BILL',
    'CLEANING',
    'OUT_OF_SERVICE',
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {order.map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <span className={cn('size-2 rounded-full', STATUS_STYLES[status].dot)} aria-hidden />
          {TABLE_STATUS_LABEL[status]}
          {counts[status] !== undefined && (
            <span className="tabular font-medium text-ink-soft">{counts[status]}</span>
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Interactive 2D floor plan.
 *
 * Positions are percentages of the room, stored per table, so the same layout
 * renders identically on a phone, a tablet and a wall display. In edit mode a
 * manager can drag tables and the new positions are persisted.
 */
export function FloorPlan({
  tables,
  selectedId,
  onSelect,
  editable,
  onMove,
  className,
}: {
  tables: FloorTable[];
  selectedId?: string | null;
  onSelect: (table: FloorTable) => void;
  editable?: boolean;
  onMove?: (tableId: string, posX: number, posY: number) => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const handleDragEnd = (table: FloorTable, x: number, y: number) => {
    const container = containerRef.current;
    setDragging(null);
    if (!container || !onMove) return;
    const rect = container.getBoundingClientRect();
    const posX = Math.min(96, Math.max(2, ((x - rect.left) / rect.width) * 100));
    const posY = Math.min(94, Math.max(3, ((y - rect.top) / rect.height) * 100));
    onMove(table.id, Math.round(posX * 10) / 10, Math.round(posY * 10) / 10);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative w-full overflow-hidden rounded-lg border border-line bg-surface-sunken/50',
        className,
      )}
      style={{ aspectRatio: '16 / 10', minHeight: 320 }}
    >
      {/* Room furniture: fixed reference points so the plan reads as a room. */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-x-[4%] top-[3%] flex h-[9%] items-center justify-center rounded-md border border-dashed border-line-strong bg-surface/60 text-2xs font-medium uppercase tracking-wider text-ink-muted"
          aria-hidden
        >
          Kitchen · pass
        </div>
        <div
          className="absolute bottom-[4%] left-[4%] flex h-[16%] w-[16%] items-center justify-center rounded-md border border-dashed border-line-strong bg-surface/60 text-center text-2xs font-medium uppercase tracking-wider leading-tight text-ink-muted"
          aria-hidden
        >
          Bar
        </div>
        <div
          className="absolute bottom-[4%] right-[4%] flex h-[12%] w-[14%] items-center justify-center rounded-md border border-dashed border-line-strong bg-surface/60 text-center text-2xs font-medium uppercase tracking-wider leading-tight text-ink-muted"
          aria-hidden
        >
          Service
        </div>
      </div>

      {tables.map((table) => {
        const style = STATUS_STYLES[table.status];
        const selected = table.id === selectedId;
        const alerting = table.status === 'FOOD_READY' || (table.session?.openRequests.length ?? 0) > 0;

        return (
          <motion.button
            key={table.id}
            drag={editable}
            dragMomentum={false}
            onDragStart={() => setDragging(table.id)}
            onDragEnd={(event) => {
              const point = 'changedTouches' in event
                ? (event as unknown as TouchEvent).changedTouches[0]
                : (event as unknown as MouseEvent);
              handleDragEnd(table, point.clientX, point.clientY);
            }}
            onClick={() => !dragging && onSelect(table)}
            aria-label={`Table ${table.number}, ${TABLE_STATUS_LABEL[table.status]}`}
            className={cn(
              'absolute flex flex-col items-center justify-center border-2 transition-shadow',
              table.shape === 'ROUND' && 'rounded-full',
              table.shape === 'SQUARE' && 'rounded-lg',
              table.shape === 'RECT' && 'rounded-md',
              style.surface,
              selected ? 'border-ink shadow-lift' : style.border,
              editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer hover:shadow-lift',
            )}
            style={{
              left: `${table.posX}%`,
              top: `${table.posY}%`,
              width: table.shape === 'RECT' ? '11%' : '8.5%',
              height: table.shape === 'RECT' ? '8%' : '11%',
              minWidth: 44,
              minHeight: 44,
              transform: 'translate(-50%, -50%)',
            }}
          >
            {alerting && (
              <span
                className={cn('absolute -right-1 -top-1 size-2.5 rounded-full', style.dot)}
                aria-hidden
              >
                <span className={cn('absolute inset-0 animate-ping rounded-full', style.dot, 'opacity-60')} />
              </span>
            )}
            <span className={cn('tabular text-sm font-semibold leading-none', style.text)}>{table.number}</span>
            {table.session && (
              <span className="mt-0.5 text-[0.5625rem] leading-none text-ink-muted">
                {table.session.elapsedMinutes}m
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- TableCard */

export function TableCard({
  table,
  currency,
  onOpen,
}: {
  table: FloorTable;
  currency: string;
  onOpen: () => void;
}) {
  const style = STATUS_STYLES[table.status];
  const requests = table.session?.openRequests.length ?? 0;

  return (
    <button
      onClick={onOpen}
      className="flex w-full flex-col rounded-lg border border-line bg-surface p-3.5 text-left shadow-subtle transition-all hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn('size-2.5 rounded-full', style.dot)} aria-hidden />
          <span className="font-display text-lg font-semibold leading-none text-ink">{table.number}</span>
        </div>
        <span className={cn('text-2xs font-medium', style.text)}>{TABLE_STATUS_LABEL[table.status]}</span>
      </div>

      <p className="mt-1.5 truncate text-2xs text-ink-muted">
        {table.zone ?? 'No zone'} · {table.seats} seats
      </p>

      {table.session ? (
        <div className="mt-3 space-y-1.5 border-t border-line pt-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1 text-ink-muted">
              <Clock className="size-3" aria-hidden />
              {table.session.elapsedMinutes}m
            </span>
            <span className="inline-flex items-center gap-1 text-ink-muted">
              <Users className="size-3" aria-hidden />
              {table.session.guestCount}
            </span>
            <span className="tabular font-semibold text-ink">
              {money(table.session.runningTotal, currency)}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {table.session.openOrderCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[0.625rem] font-medium text-info">
                <ChefHat className="size-2.5" aria-hidden />
                {table.session.openOrderCount} open
              </span>
            )}
            {requests > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[0.625rem] font-medium text-warning">
                <Bell className="size-2.5" aria-hidden />
                {requests}
              </span>
            )}
            {table.session.billRequestedAt && (
              <span className="inline-flex items-center gap-1 rounded-full bg-gold-soft px-2 py-0.5 text-[0.625rem] font-medium text-gold">
                <Receipt className="size-2.5" aria-hidden />
                Bill
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-3 border-t border-line pt-2.5 text-xs text-ink-muted">
          {table.needsCleaning ? 'Needs clearing' : table.outOfService ? 'Out of service' : 'Free'}
        </p>
      )}
    </button>
  );
}

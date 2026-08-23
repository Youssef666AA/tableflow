import type { ReactNode } from 'react';
import { AlertCircle, Inbox, WifiOff } from 'lucide-react';
import type { OrderStatus, ServiceRequestStatus, TableStatus } from '@tableflow/shared';
import { ORDER_STATUS_LABEL, TABLE_STATUS_LABEL } from '@tableflow/shared';
import { cn } from '@/lib/cn';
import { ApiError } from '@/lib/api';
import { Badge, Button, Skeleton } from './primitives';

/* ------------------------------------------------------------ EmptyState */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-6 py-10' : 'gap-3 px-6 py-16',
        className,
      )}
    >
      <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
        {icon ?? <Inbox className="size-5" aria-hidden />}
      </div>
      <h3 className="text-[0.9375rem] font-semibold text-ink">{title}</h3>
      {description && (
        <p className="max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------ ErrorState */

export function ErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  const apiError = error instanceof ApiError ? error : null;
  const offline = apiError?.isOffline ?? false;

  return (
    <EmptyState
      className={className}
      icon={offline ? <WifiOff className="size-5" /> : <AlertCircle className="size-5 text-danger" />}
      title={title ?? (offline ? 'You appear to be offline' : 'Something went wrong')}
      description={
        apiError?.message ??
        (error instanceof Error ? error.message : 'Please try again in a moment.')
      }
      action={
        onRetry && (
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}

/* ---------------------------------------------------------- LoadingState */

export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-3.5 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function LoadingCards({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="rounded-lg border border-line bg-surface p-4">
          <Skeleton className="mb-4 h-28 w-full rounded-md" />
          <Skeleton className="mb-2 h-3.5 w-3/5" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- StatusBadge */

const ORDER_TONES: Record<OrderStatus, Parameters<typeof Badge>[0]['tone']> = {
  PENDING: 'warning',
  ACCEPTED: 'info',
  PREPARING: 'info',
  READY: 'success',
  OUT_FOR_DELIVERY_TO_TABLE: 'success',
  DELIVERED: 'accent',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
  REJECTED: 'danger',
};

export function OrderStatusBadge({ status, size }: { status: OrderStatus; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={ORDER_TONES[status] ?? 'neutral'} size={size} dot>
      {ORDER_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const TABLE_TONES: Record<TableStatus, Parameters<typeof Badge>[0]['tone']> = {
  AVAILABLE: 'success',
  ACTIVE: 'info',
  ORDERING: 'warning',
  FOOD_READY: 'accent',
  WAITING_FOR_BILL: 'gold',
  PAYMENT_PENDING: 'gold',
  CLEANING: 'neutral',
  OUT_OF_SERVICE: 'danger',
};

export function TableStatusBadge({ status, size }: { status: TableStatus; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={TABLE_TONES[status] ?? 'neutral'} size={size} dot>
      {TABLE_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const REQUEST_TONES: Record<ServiceRequestStatus, Parameters<typeof Badge>[0]['tone']> = {
  REQUESTED: 'warning',
  ACKNOWLEDGED: 'info',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

const REQUEST_LABELS: Record<ServiceRequestStatus, string> = {
  REQUESTED: 'New',
  ACKNOWLEDGED: 'Acknowledged',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
};

export function RequestStatusBadge({ status, size }: { status: ServiceRequestStatus; size?: 'sm' | 'md' }) {
  return (
    <Badge tone={REQUEST_TONES[status] ?? 'neutral'} size={size} dot>
      {REQUEST_LABELS[status] ?? status}
    </Badge>
  );
}

/* --------------------------------------------------- ConnectionIndicator */

export function ConnectionIndicator({
  state,
  className,
  compact,
}: {
  state: 'connecting' | 'connected' | 'disconnected';
  className?: string;
  compact?: boolean;
}) {
  if (state === 'connected') {
    return compact ? null : (
      <span className={cn('inline-flex items-center gap-1.5 text-2xs text-ink-muted', className)}>
        <span className="size-1.5 rounded-full bg-success" aria-hidden />
        Live
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-2xs font-medium',
        state === 'connecting' ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger',
        className,
      )}
      role="status"
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          state === 'connecting' ? 'animate-pulse bg-warning' : 'bg-danger',
        )}
        aria-hidden
      />
      {state === 'connecting' ? 'Reconnecting…' : 'Connection lost'}
    </span>
  );
}

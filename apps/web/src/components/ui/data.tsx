import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Minus, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Input, Skeleton } from './primitives';
import { EmptyState } from './feedback';

/* -------------------------------------------------------------- StatCard */

export function StatCard({
  label,
  value,
  sublabel,
  changePercent,
  icon,
  tone = 'neutral',
  className,
  loading,
}: {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  changePercent?: number | null;
  icon?: ReactNode;
  tone?: 'neutral' | 'accent' | 'warning' | 'danger';
  className?: string;
  loading?: boolean;
}) {
  const direction = changePercent == null ? null : changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat';

  return (
    <div className={cn('rounded-lg border border-line bg-surface p-4 shadow-subtle', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.8125rem] font-medium text-ink-muted">{label}</p>
        {icon && (
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md',
              tone === 'accent' && 'bg-accent-soft text-accent-strong',
              tone === 'warning' && 'bg-warning-soft text-warning',
              tone === 'danger' && 'bg-danger-soft text-danger',
              tone === 'neutral' && 'bg-surface-sunken text-ink-muted',
            )}
          >
            {icon}
          </span>
        )}
      </div>

      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="tabular mt-2 text-[1.75rem] font-semibold leading-none tracking-tight text-ink">{value}</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {direction && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-medium',
              direction === 'up' && 'text-success',
              direction === 'down' && 'text-danger',
              direction === 'flat' && 'text-ink-muted',
            )}
          >
            {direction === 'up' && <ArrowUp className="size-3" aria-hidden />}
            {direction === 'down' && <ArrowDown className="size-3" aria-hidden />}
            {direction === 'flat' && <Minus className="size-3" aria-hidden />}
            {Math.abs(changePercent ?? 0).toFixed(1)}%
          </span>
        )}
        {sublabel && <span className="truncate text-xs text-ink-muted">{sublabel}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- ChartCard */

export function ChartCard({
  title,
  description,
  action,
  children,
  className,
  height = 260,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  height?: number;
}) {
  return (
    <section className={cn('flex flex-col rounded-lg border border-line bg-surface shadow-subtle', className)}>
      <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-4">
        <div className="min-w-0">
          <h3 className="text-[0.9375rem] font-semibold leading-tight text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-ink-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="relative min-w-0 px-2 pb-3" style={{ height }}>
        {children}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- DataTable */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  headerClassName?: string;
  /** Hide below the md breakpoint so tables stay readable on tablets. */
  hideOnMobile?: boolean;
  align?: 'left' | 'right' | 'center';
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading,
  empty,
  className,
  dense,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  const alignClass = (align?: Column<T>['align']) =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  if (loading) {
    return (
      <div className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}>
        <div className="space-y-3 p-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}>
        {empty ?? <EmptyState title="Nothing here yet" compact />}
      </div>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-surface shadow-subtle', className)}>
      <div className="scrollbar-slim overflow-x-auto">
        <table className="w-full min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunken/60">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-muted',
                    alignClass(column.align),
                    column.hideOnMobile && 'hidden md:table-cell',
                    column.headerClassName,
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line last:border-0 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-surface-sunken/70',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-4 align-middle text-ink-soft',
                      dense ? 'py-2' : 'py-3',
                      alignClass(column.align),
                      column.hideOnMobile && 'hidden md:table-cell',
                      column.className,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Pagination */

export function Pagination({
  page,
  pages,
  total,
  pageSize,
  onChange,
  className,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  if (pages <= 1) {
    return total > 0 ? (
      <p className={cn('px-1 py-3 text-xs text-ink-muted', className)}>
        {total} {total === 1 ? 'result' : 'results'}
      </p>
    ) : null;
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className={cn('flex items-center justify-between gap-4 py-3', className)}>
      <p className="tabular text-xs text-ink-muted">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          leadingIcon={<ChevronLeft className="size-3.5" />}
        >
          Previous
        </Button>
        <span className="tabular px-2 text-xs text-ink-muted">
          {page} / {pages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          trailingIcon={<ChevronRight className="size-3.5" />}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- FilterBar */

export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  children,
  actions,
  className,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {onSearchChange && (
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={search ?? ''}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9"
            type="search"
          />
        </div>
      )}
      {children}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- KeyValue */

export function KeyValue({
  items,
  className,
  columns = 2,
}: {
  items: Array<{ label: ReactNode; value: ReactNode }>;
  className?: string;
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-3',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'grid-cols-1 sm:grid-cols-2',
        columns === 3 && 'grid-cols-1 sm:grid-cols-3',
        className,
      )}
    >
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="text-2xs font-medium uppercase tracking-wider text-ink-muted">{item.label}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Eye } from 'lucide-react';
import type { OrderStatus } from '@tableflow/shared';
import { ORDER_STATUS_LABEL, ORDER_TRANSITIONS } from '@tableflow/shared';
import { ApiError, api, staffTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { formatTime, money, relativeTime } from '@/lib/format';
import { Badge, Button, Select } from '@/components/ui/primitives';
import { DataTable, FilterBar, KeyValue, Pagination, type Column } from '@/components/ui/data';
import { EmptyState, ErrorState, OrderStatusBadge } from '@/components/ui/feedback';
import { SidePanel, useToast } from '@/components/ui/overlays';
import { Page, PageHeading } from '@/console/PageShell';

interface StaffOrderItem {
  id: string;
  productName: string;
  variantName: string | null;
  quantity: number;
  lineTotal: number;
  notes: string | null;
  status: string;
  station: { id: string; name: string; color: string | null } | null;
  modifiers: Array<{ id: string; groupName: string; optionName: string; priceDelta: number }>;
}

interface StaffOrder {
  id: string;
  number: number;
  reference: string;
  status: OrderStatus;
  tableNumber: string;
  zone: string | null;
  sessionCode: string | null;
  channel: string;
  customerName: string | null;
  notes: string | null;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  serviceChargeTotal: number;
  total: number;
  paymentStatus: string | null;
  createdAt: string;
  items: StaffOrderItem[];
  promotions: Array<{ id: string; name: string; amount: number }>;
}

interface OrdersPayload {
  orders: StaffOrder[];
  pagination: { page: number; pageSize: number; total: number; pages: number };
}

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING,ACCEPTED,PREPARING,READY,OUT_FOR_DELIVERY_TO_TABLE', label: 'Open' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'READY', label: 'Ready' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED,REJECTED', label: 'Cancelled' },
];

export default function StaffOrdersPage() {
  const { branchId, currency, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const socket = useSocket('staff', staffTokens.access());

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<StaffOrder | null>(null);

  const debouncedSearch = useDebounced(search, 300);

  const query = useQuery({
    queryKey: ['orders', branchId, status, debouncedSearch, page],
    queryFn: () =>
      api.get<OrdersPayload>(
        `/orders?branchId=${branchId}&page=${page}&pageSize=25` +
          (status ? `&status=${status}` : '') +
          (debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : ''),
      ),
    enabled: Boolean(branchId),
  });

  useRealtimeInvalidation(socket, ['order:created', 'order:updated'], [['orders', branchId]]);

  const changeStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: OrderStatus }) =>
      api.patch(`/orders/${id}/status`, { status: next }),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success(`Moved to ${ORDER_STATUS_LABEL[variables.next].toLowerCase()}`);
      setSelected(null);
    },
    onError: (error) =>
      toast.error('That transition was refused', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const orders = query.data?.orders ?? [];

  const columns: Column<StaffOrder>[] = [
    {
      key: 'number',
      header: 'Order',
      render: (order) => (
        <div>
          <p className="tabular font-semibold text-ink">{order.reference}</p>
          <p className="text-2xs text-ink-muted">{formatTime(order.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'table',
      header: 'Table',
      render: (order) => (
        <div>
          <p className="font-medium text-ink">{order.tableNumber}</p>
          {order.zone && <p className="text-2xs text-ink-muted">{order.zone}</p>}
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      hideOnMobile: true,
      render: (order) => (
        <p className="max-w-xs truncate text-ink-soft">
          {order.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}
        </p>
      ),
    },
    {
      key: 'channel',
      header: 'Source',
      hideOnMobile: true,
      render: (order) => (
        <Badge size="sm" tone={order.channel === 'CUSTOMER' ? 'accent' : 'neutral'}>
          {order.channel === 'CUSTOMER' ? 'Guest' : 'Staff'}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (order) => <OrderStatusBadge status={order.status} size="sm" />,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (order) => <span className="tabular font-semibold text-ink">{money(order.total, currency)}</span>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: () => <Eye className="ml-auto size-4 text-ink-muted" aria-hidden />,
    },
  ];

  const nextStatuses = selected ? (ORDER_TRANSITIONS[selected.status] ?? []) : [];

  return (
    <Page>
      <PageHeading title="Orders" description="Every order taken, guest or staff." />

      <FilterBar
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Order number, table or guest…"
        className="mb-4"
      >
        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          className="w-44"
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FilterBar>

      {query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={orders}
            rowKey={(order) => order.id}
            onRowClick={setSelected}
            loading={query.isLoading}
            empty={
              <EmptyState
                icon={<ClipboardList className="size-5" />}
                title="No orders match"
                description="Try a different status or clear the search."
                compact
              />
            }
          />
          {query.data && (
            <Pagination
              page={query.data.pagination.page}
              pages={query.data.pagination.pages}
              total={query.data.pagination.total}
              pageSize={query.data.pagination.pageSize}
              onChange={setPage}
            />
          )}
        </>
      )}

      <SidePanel
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `Order ${selected.reference}` : ''}
        description={
          selected
            ? `Table ${selected.tableNumber} · ${relativeTime(selected.createdAt)}${selected.sessionCode ? ` · ${selected.sessionCode}` : ''}`
            : undefined
        }
        footer={
          selected && can('orders:update_status') && nextStatuses.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {nextStatuses.map((next) => (
                <Button
                  key={next}
                  size="sm"
                  variant={next === 'CANCELLED' || next === 'REJECTED' ? 'ghost' : 'primary'}
                  loading={changeStatus.isPending && changeStatus.variables?.next === next}
                  onClick={() => changeStatus.mutate({ id: selected.id, next })}
                >
                  {ORDER_STATUS_LABEL[next]}
                </Button>
              ))}
            </div>
          ) : null
        }
      >
        {selected && (
          <div className="space-y-6">
            <KeyValue
              items={[
                { label: 'Status', value: <OrderStatusBadge status={selected.status} size="sm" /> },
                { label: 'Source', value: selected.channel === 'CUSTOMER' ? 'Guest device' : 'Staff' },
                { label: 'Guest', value: selected.customerName ?? '—' },
                { label: 'Payment', value: selected.paymentStatus ?? 'On the table bill' },
              ]}
            />

            <section>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-muted">Items</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {selected.items.map((item) => (
                  <li key={item.id} className="flex gap-3 px-3.5 py-3">
                    <span className="tabular shrink-0 text-sm font-semibold text-ink-muted">
                      {item.quantity}×
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">
                        {item.productName}
                        {item.variantName && <span className="text-ink-muted"> · {item.variantName}</span>}
                      </p>
                      {item.modifiers.length > 0 && (
                        <p className="mt-0.5 text-xs text-ink-muted">
                          {item.modifiers.map((modifier) => modifier.optionName).join(' · ')}
                        </p>
                      )}
                      {item.notes && (
                        <p className="mt-0.5 text-xs italic text-warning">“{item.notes}”</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="tabular text-sm text-ink">{money(item.lineTotal, currency)}</p>
                      {item.station && (
                        <p className="mt-0.5 text-2xs text-ink-muted">{item.station.name}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Subtotal</dt>
                <dd className="tabular text-ink">{money(selected.subtotal, currency)}</dd>
              </div>
              {selected.promotions.map((promotion) => (
                <div key={promotion.id} className="flex justify-between text-accent-strong">
                  <dt>{promotion.name}</dt>
                  <dd className="tabular">−{money(promotion.amount, currency)}</dd>
                </div>
              ))}
              {selected.serviceChargeTotal > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Service charge</dt>
                  <dd className="tabular text-ink">{money(selected.serviceChargeTotal, currency)}</dd>
                </div>
              )}
              {selected.taxTotal > 0 && (
                <div className="flex justify-between text-xs">
                  <dt className="text-ink-muted">VAT (included)</dt>
                  <dd className="tabular text-ink-muted">{money(selected.taxTotal, currency)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <dt className="font-semibold text-ink">Total</dt>
                <dd className="tabular font-display text-lg font-semibold text-ink">
                  {money(selected.total, currency)}
                </dd>
              </div>
            </dl>

            {selected.notes && (
              <p className="rounded-md bg-info-soft px-3.5 py-2.5 text-xs leading-relaxed text-info">
                <span className="font-semibold">Guest note:</span> {selected.notes}
              </p>
            )}
          </div>
        )}
      </SidePanel>
    </Page>
  );
}

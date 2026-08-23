import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Brush,
  Check,
  CheckCircle2,
  MapPin,
  Receipt,
  Smartphone,
  Users,
} from 'lucide-react';
import { SERVICE_REQUEST_LABEL, TABLE_STATUS_LABEL } from '@tableflow/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatTime, money, relativeTime } from '@/lib/format';
import { Badge, Button, Divider, Spinner } from '@/components/ui/primitives';
import { ConfirmDialog, SidePanel, useToast } from '@/components/ui/overlays';
import { OrderStatusBadge } from '@/components/ui/feedback';
import { KeyValue } from '@/components/ui/data';
import type { FloorTable } from './floor';

interface SessionDetail {
  id: string;
  code: string;
  status: string;
  startedAt: string;
  expiresAt: string;
  guestCount: number;
  customerName: string | null;
  billRequestedAt: string | null;
  devices: Array<{
    id: string;
    verifiedAt: string | null;
    verificationMethod: string | null;
    distanceMeters: number | null;
    blocked: boolean;
    lastSeenAt: string;
  }>;
  orders: Array<{
    id: string;
    number: number;
    status: string;
    total: number;
    createdAt: string;
    items: Array<{ id: string; productName: string; variantName: string | null; quantity: number }>;
  }>;
  serviceRequests: Array<{
    id: string;
    type: string;
    status: string;
    note: string | null;
    createdAt: string;
  }>;
  payments: Array<{ id: string; method: string; status: string; amount: number; tip: number }>;
}

export function TableDetailPanel({
  table,
  open,
  onClose,
}: {
  table: FloorTable | null;
  open: boolean;
  onClose: () => void;
}) {
  const { currency, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmClose, setConfirmClose] = useState(false);
  const [forceClose, setForceClose] = useState(false);

  const sessionId = table?.session?.id ?? null;

  const query = useQuery({
    queryKey: ['table-session', sessionId],
    queryFn: () => api.get<{ session: SessionDetail }>(`/tables/sessions/${sessionId}`),
    enabled: open && Boolean(sessionId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tables'] });
    void queryClient.invalidateQueries({ queryKey: ['table-session', sessionId] });
    void queryClient.invalidateQueries({ queryKey: ['service-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  const fail = (error: unknown) =>
    toast.error('That did not work', error instanceof ApiError ? error.message : 'Please try again.');

  const deliver = useMutation({
    mutationFn: (orderId: string) => api.patch(`/orders/${orderId}/status`, { status: 'DELIVERED' }),
    onSuccess: () => {
      invalidate();
      toast.success('Marked as delivered');
    },
    onError: fail,
  });

  const handleRequest = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'acknowledge' | 'complete' }) =>
      api.post(`/service-requests/${id}/${action}`),
    onSuccess: () => {
      invalidate();
    },
    onError: fail,
  });

  const verifyDevice = useMutation({
    mutationFn: () => api.post(`/tables/sessions/${sessionId}/verify`, {}),
    onSuccess: () => {
      invalidate();
      toast.success('Table verified', 'The guest can order now.');
    },
    onError: fail,
  });

  const closeSession = useMutation({
    mutationFn: (force: boolean) =>
      api.post(`/tables/sessions/${sessionId}/close`, { force, reason: 'Closed by staff' }),
    onSuccess: () => {
      setConfirmClose(false);
      setForceClose(false);
      invalidate();
      toast.success('Table closed', 'It will be free once it has been cleared.');
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'CONFLICT') {
        setForceClose(true);
        toast.warning('There is still an unpaid balance', error.message);
      } else {
        fail(error);
      }
    },
  });

  const clearTable = useMutation({
    mutationFn: () => api.post(`/tables/${table?.id}/clear`),
    onSuccess: () => {
      invalidate();
      toast.success('Table cleared', 'It is available again.');
      onClose();
    },
    onError: fail,
  });

  if (!table) return null;

  const detail = query.data?.session;
  const openOrders = (detail?.orders ?? []).filter(
    (order) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(order.status),
  );
  const readyOrders = openOrders.filter((order) => ['READY', 'OUT_FOR_DELIVERY_TO_TABLE'].includes(order.status));
  const openRequests = (detail?.serviceRequests ?? []).filter(
    (request) => !['COMPLETED', 'CANCELLED'].includes(request.status),
  );
  const unverified = (detail?.devices ?? []).filter((device) => !device.verifiedAt);

  return (
    <>
      <SidePanel
        open={open}
        onClose={onClose}
        title={`Table ${table.number}`}
        description={`${TABLE_STATUS_LABEL[table.status]}${table.zone ? ` · ${table.zone}` : ''} · ${table.seats} seats`}
        footer={
          table.session ? (
            <div className="flex flex-wrap gap-2">
              {can('sessions:close') && (
                <Button variant="secondary" onClick={() => setConfirmClose(true)}>
                  Close table
                </Button>
              )}
              {can('billing:view') && (
                <Button
                  variant="ghost"
                  leadingIcon={<Receipt className="size-4" />}
                  onClick={() => window.location.assign(`/staff/billing?session=${table.session?.id}`)}
                >
                  Open bill
                </Button>
              )}
            </div>
          ) : table.needsCleaning && can('tables:status_update') ? (
            <Button
              fullWidth
              loading={clearTable.isPending}
              onClick={() => clearTable.mutate()}
              leadingIcon={<Brush className="size-4" />}
            >
              Mark as cleared
            </Button>
          ) : null
        }
      >
        {!table.session && (
          <div className="rounded-lg border border-dashed border-line px-4 py-10 text-center">
            <p className="text-sm font-medium text-ink">
              {table.needsCleaning ? 'Waiting to be cleared' : 'This table is free'}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {table.needsCleaning
                ? 'Clear the table to make it available for the next guests.'
                : 'A session starts the moment a guest scans the QR code.'}
            </p>
            {table.qr && (
              <p className="mt-4 break-all rounded bg-surface-sunken px-3 py-2 text-2xs text-ink-muted">
                {table.qr.url}
              </p>
            )}
          </div>
        )}

        {table.session && query.isLoading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}

        {detail && (
          <div className="space-y-6">
            <KeyValue
              items={[
                { label: 'Session', value: <span className="tabular">{detail.code}</span> },
                { label: 'Seated', value: `${relativeTime(detail.startedAt)} · ${formatTime(detail.startedAt)}` },
                {
                  label: 'Guests',
                  value: (
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="size-3.5 text-ink-muted" aria-hidden />
                      {detail.guestCount}
                    </span>
                  ),
                },
                {
                  label: 'Running total',
                  value: (
                    <span className="tabular font-semibold">
                      {money(table.session?.runningTotal ?? 0, currency)}
                    </span>
                  ),
                },
              ]}
            />

            {unverified.length > 0 && (
              <div className="rounded-lg border border-warning/30 bg-warning-soft p-4">
                <div className="flex items-start gap-2.5">
                  <Smartphone className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-warning">
                      {unverified.length} device{unverified.length === 1 ? '' : 's'} not verified
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-warning/85">
                      A guest could not confirm their location. You can vouch for the table from here.
                    </p>
                    <Button
                      size="sm"
                      className="mt-2.5"
                      loading={verifyDevice.isPending}
                      onClick={() => verifyDevice.mutate()}
                      leadingIcon={<MapPin className="size-3.5" />}
                    >
                      Verify this table
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {readyOrders.length > 0 && (
              <section>
                <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-accent-strong">
                  Ready to serve
                </h3>
                <div className="space-y-2">
                  {readyOrders.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-3.5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="tabular text-sm font-semibold text-accent-strong">#{order.number}</p>
                        <p className="mt-0.5 truncate text-xs text-accent-strong/80">
                          {order.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        loading={deliver.isPending && deliver.variables === order.id}
                        onClick={() => deliver.mutate(order.id)}
                        leadingIcon={<Check className="size-3.5" />}
                      >
                        Delivered
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {openRequests.length > 0 && (
              <section>
                <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-warning">
                  Open requests
                </h3>
                <div className="space-y-2">
                  {openRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3.5 py-3"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                          <Bell className="size-3.5 text-warning" aria-hidden />
                          {SERVICE_REQUEST_LABEL[request.type] ?? request.type}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {relativeTime(request.createdAt)}
                          {request.note ? ` · ${request.note}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        {request.status === 'REQUESTED' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleRequest.mutate({ id: request.id, action: 'acknowledge' })}
                          >
                            Ack
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => handleRequest.mutate({ id: request.id, action: 'complete' })}
                          leadingIcon={<CheckCircle2 className="size-3.5" />}
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                Orders this visit
              </h3>
              {detail.orders.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-ink-muted">
                  Nothing ordered yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {detail.orders.map((order) => (
                    <li
                      key={order.id}
                      className="rounded-lg border border-line bg-surface px-3.5 py-3 shadow-subtle"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="tabular text-sm font-semibold text-ink">#{order.number}</p>
                          <p className="mt-0.5 text-2xs text-ink-muted">{formatTime(order.createdAt)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <OrderStatusBadge status={order.status as never} size="sm" />
                          <span className="tabular text-sm font-semibold text-ink">
                            {money(order.total, currency)}
                          </span>
                        </div>
                      </div>
                      <p className="mt-1.5 truncate text-xs text-ink-muted">
                        {order.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {detail.payments.length > 0 && (
              <>
                <Divider />
                <section>
                  <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                    Payments
                  </h3>
                  <ul className="space-y-1.5">
                    {detail.payments.map((payment) => (
                      <li key={payment.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-ink-soft">{payment.method.replace(/_/g, ' ').toLowerCase()}</span>
                        <span className="flex items-center gap-2">
                          <Badge
                            size="sm"
                            tone={payment.status === 'PAID' ? 'success' : payment.status === 'FAILED' ? 'danger' : 'neutral'}
                          >
                            {payment.status.toLowerCase()}
                          </Badge>
                          <span className="tabular font-medium text-ink">{money(payment.amount, currency)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}

            <section>
              <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-muted">Devices</h3>
              <ul className="space-y-1.5">
                {detail.devices.map((device) => (
                  <li key={device.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="inline-flex items-center gap-1.5 text-ink-soft">
                      <Smartphone className="size-3.5 text-ink-muted" aria-hidden />
                      Seen {relativeTime(device.lastSeenAt)}
                    </span>
                    <span className={cn('font-medium', device.verifiedAt ? 'text-success' : 'text-warning')}>
                      {device.verifiedAt
                        ? `Verified${device.distanceMeters != null ? ` · ${device.distanceMeters} m` : ''}`
                        : 'Not verified'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </SidePanel>

      <ConfirmDialog
        open={confirmClose}
        onClose={() => {
          setConfirmClose(false);
          setForceClose(false);
        }}
        onConfirm={() => closeSession.mutate(forceClose)}
        loading={closeSession.isPending}
        tone={forceClose ? 'danger' : 'primary'}
        title={forceClose ? 'Close with an unpaid balance?' : `Close table ${table.number}?`}
        message={
          forceClose
            ? 'This table still owes money. Closing anyway will end the session and mark the table for cleaning without settling the bill.'
            : 'Any delivered orders are completed, open requests are cancelled and the table is marked for cleaning.'
        }
        confirmLabel={forceClose ? 'Close anyway' : 'Close table'}
      />
    </>
  );
}

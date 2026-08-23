import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CreditCard, Download, Receipt, Users, Wallet } from 'lucide-react';
import { ApiError, api, downloadFile, newIdempotencyKey, staffTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatTime, money, relativeTime } from '@/lib/format';
import { useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { Badge, Button, Divider, Input, Spinner } from '@/components/ui/primitives';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/overlays';
import { Page, PageHeading, SectionHeading } from '@/console/PageShell';

interface OpenTab {
  sessionId: string;
  code: string;
  tableId: string;
  tableNumber: string;
  zone: string | null;
  guestCount: number;
  customerName: string | null;
  startedAt: string;
  billRequestedAt: string | null;
  orderCount: number;
  billTotal: number;
  paidTotal: number;
  outstanding: number;
}

interface Bill {
  sessionId: string;
  sessionCode: string;
  tableNumber: string;
  currency: string;
  orders: Array<{
    id: string;
    number: number;
    status: string;
    total: number;
    createdAt: string;
    paid: boolean;
    items: Array<{ name: string; variantName: string | null; quantity: number; lineTotal: number }>;
  }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  serviceChargeTotal: number;
  tipTotal: number;
  billTotal: number;
  paidTotal: number;
  outstanding: number;
  settled: boolean;
  payments: Array<{
    id: string;
    method: string;
    status: string;
    amount: number;
    tip: number;
    createdAt: string;
    processedAt: string | null;
  }>;
  receiptId: string | null;
  billRequestedAt: string | null;
  split: number[];
}

const METHODS = [
  { value: 'CASH', label: 'Cash', Icon: Banknote },
  { value: 'CARD', label: 'Card terminal', Icon: CreditCard },
] as const;

export default function BillingPage() {
  const { branchId, currency, can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const socket = useSocket('staff', staffTokens.access());
  const [searchParams, setSearchParams] = useSearchParams();

  const [sessionId, setSessionId] = useState<string | null>(searchParams.get('session'));
  const [splitParts, setSplitParts] = useState(1);
  const [method, setMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [tip, setTip] = useState('0');
  const [amount, setAmount] = useState('');

  const tabsQuery = useQuery({
    queryKey: ['billing', 'open', branchId],
    queryFn: () => api.get<{ tabs: OpenTab[] }>(`/billing/open?branchId=${branchId}`),
    enabled: Boolean(branchId),
    refetchInterval: 45_000,
  });

  const billQuery = useQuery({
    queryKey: ['billing', 'session', sessionId, splitParts],
    queryFn: () => api.get<Bill>(`/billing/sessions/${sessionId}?splitParts=${splitParts}`),
    enabled: Boolean(sessionId),
  });

  useRealtimeInvalidation(
    socket,
    ['order:created', 'order:updated', 'payment:updated', 'session:updated'],
    [['billing', 'open', branchId], ['billing', 'session', sessionId, splitParts]],
  );

  // Keep the deep link in the address bar honest.
  useEffect(() => {
    if (sessionId) setSearchParams({ session: sessionId }, { replace: true });
  }, [sessionId, setSearchParams]);

  const bill = billQuery.data;

  useEffect(() => {
    if (bill) setAmount(String((bill.outstanding / 1000).toFixed(3)));
  }, [bill?.outstanding, bill]);

  const takePayment = useMutation({
    mutationFn: () =>
      api.post(`/billing/sessions/${sessionId}/payments`, {
        method,
        amount: Math.round(Number(amount) * 1000),
        tip: Math.round(Number(tip || '0') * 1000),
        splitParts,
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['billing'] });
      void queryClient.invalidateQueries({ queryKey: ['tables'] });
      toast.success('Payment recorded');
    },
    onError: (error) =>
      toast.error('Could not record that payment', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const tabs = tabsQuery.data?.tabs ?? [];

  return (
    <Page>
      <PageHeading title="Billing" description="Open tabs and settled receipts for this branch." />

      <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
        <section className="min-w-0">
          <SectionHeading title="Open tabs" description={`${tabs.length} table${tabs.length === 1 ? '' : 's'} with a balance`} />

          {tabsQuery.isLoading && (
            <div className="flex h-40 items-center justify-center">
              <Spinner />
            </div>
          )}
          {tabsQuery.isError && <ErrorState error={tabsQuery.error} onRetry={() => void tabsQuery.refetch()} />}

          {tabsQuery.isSuccess && tabs.length === 0 && (
            <EmptyState
              icon={<Wallet className="size-5" />}
              title="No open tabs"
              description="Everything at this branch has been settled."
              compact
            />
          )}

          <div className="space-y-2">
            {tabs.map((tab) => (
              <button
                key={tab.sessionId}
                onClick={() => setSessionId(tab.sessionId)}
                className={cn(
                  'w-full rounded-lg border bg-surface p-3.5 text-left shadow-subtle transition-all hover:shadow-lift',
                  tab.sessionId === sessionId ? 'border-accent ring-1 ring-accent/25' : 'border-line',
                  tab.billRequestedAt && 'border-gold/50',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-base font-semibold leading-none text-ink">
                      Table {tab.tableNumber}
                    </p>
                    <p className="mt-1 truncate text-2xs text-ink-muted">
                      {tab.code} · {tab.orderCount} orders · {relativeTime(tab.startedAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="tabular text-sm font-semibold text-ink">{money(tab.outstanding, currency)}</p>
                    {tab.paidTotal > 0 && (
                      <p className="tabular mt-0.5 text-2xs text-accent-strong">
                        {money(tab.paidTotal, currency)} paid
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-2xs text-ink-muted">
                    <Users className="size-3" aria-hidden />
                    {tab.guestCount}
                  </span>
                  {tab.billRequestedAt && (
                    <Badge tone="gold" size="sm">
                      Bill requested
                    </Badge>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="min-w-0">
          {!sessionId && (
            <EmptyState
              icon={<Receipt className="size-5" />}
              title="Select a table"
              description="Choose an open tab on the left to view its bill and take payment."
              className="rounded-lg border border-dashed border-line py-24"
            />
          )}

          {sessionId && billQuery.isLoading && (
            <div className="flex h-64 items-center justify-center rounded-lg border border-line bg-surface">
              <Spinner className="size-6" />
            </div>
          )}

          {sessionId && billQuery.isError && (
            <ErrorState error={billQuery.error} onRetry={() => void billQuery.refetch()} />
          )}

          {bill && (
            <div className="rounded-lg border border-line bg-surface shadow-subtle">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <h3 className="font-display text-lg font-semibold leading-none text-ink">
                    Table {bill.tableNumber}
                  </h3>
                  <p className="tabular mt-1.5 text-xs text-ink-muted">
                    {bill.sessionCode} · {bill.orders.length} orders
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xs uppercase tracking-wider text-ink-muted">Outstanding</p>
                  <p className="tabular font-display text-2xl font-semibold leading-none text-ink">
                    {money(bill.outstanding, currency)}
                  </p>
                </div>
              </header>

              <div className="max-h-64 overflow-y-auto px-5 py-4 scrollbar-slim">
                {bill.orders.map((order) => (
                  <div key={order.id} className="mb-3 last:mb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="tabular text-sm font-medium text-ink">
                        #{order.number}
                        {order.paid && <span className="ml-2 text-2xs text-accent-strong">paid</span>}
                      </p>
                      <p className="tabular text-sm text-ink">{money(order.total, currency)}</p>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {formatTime(order.createdAt)} ·{' '}
                      {order.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}
                    </p>
                  </div>
                ))}
              </div>

              <div className="border-t border-line px-5 py-4">
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Subtotal</dt>
                    <dd className="tabular text-ink">{money(bill.subtotal, currency)}</dd>
                  </div>
                  {bill.discountTotal > 0 && (
                    <div className="flex justify-between text-accent-strong">
                      <dt>Discounts</dt>
                      <dd className="tabular">−{money(bill.discountTotal, currency)}</dd>
                    </div>
                  )}
                  {bill.taxTotal > 0 && (
                    <div className="flex justify-between text-xs">
                      <dt className="text-ink-muted">VAT (included)</dt>
                      <dd className="tabular text-ink-muted">{money(bill.taxTotal, currency)}</dd>
                    </div>
                  )}
                  {bill.paidTotal > 0 && (
                    <div className="flex justify-between text-accent-strong">
                      <dt>Paid</dt>
                      <dd className="tabular">−{money(bill.paidTotal, currency)}</dd>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between border-t border-line pt-2">
                    <dt className="font-semibold text-ink">Due</dt>
                    <dd className="tabular font-display text-lg font-semibold text-ink">
                      {money(bill.outstanding, currency)}
                    </dd>
                  </div>
                </dl>
              </div>

              {bill.payments.length > 0 && (
                <div className="border-t border-line px-5 py-4">
                  <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wider text-ink-muted">
                    Payments
                  </h4>
                  <ul className="space-y-1.5">
                    {bill.payments.map((payment) => (
                      <li key={payment.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-ink-soft">
                          {payment.method.replace(/_/g, ' ').toLowerCase()} · {formatTime(payment.createdAt)}
                        </span>
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
                </div>
              )}

              {!bill.settled && can('billing:process') && (
                <div className="border-t border-line bg-surface-sunken/50 px-5 py-4">
                  <h4 className="mb-3 text-sm font-semibold text-ink">Take payment</h4>

                  <div className="mb-3 grid grid-cols-2 gap-2">
                    {METHODS.map(({ value, label, Icon }) => (
                      <button
                        key={value}
                        onClick={() => setMethod(value)}
                        className={cn(
                          'flex items-center justify-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors',
                          method === value
                            ? 'border-accent bg-accent-soft text-accent-strong'
                            : 'border-line bg-surface text-ink-soft hover:bg-surface-sunken',
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="pay-amount" className="mb-1.5 block text-2xs font-medium text-ink-soft">
                        Amount ({currency})
                      </label>
                      <Input
                        id="pay-amount"
                        inputMode="decimal"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        className="tabular"
                      />
                    </div>
                    <div>
                      <label htmlFor="pay-tip" className="mb-1.5 block text-2xs font-medium text-ink-soft">
                        Tip ({currency})
                      </label>
                      <Input
                        id="pay-tip"
                        inputMode="decimal"
                        value={tip}
                        onChange={(event) => setTip(event.target.value)}
                        className="tabular"
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <label htmlFor="split" className="text-2xs font-medium text-ink-soft">
                      Split
                    </label>
                    <Input
                      id="split"
                      type="number"
                      min={1}
                      max={20}
                      value={splitParts}
                      onChange={(event) => setSplitParts(Math.max(1, Number(event.target.value) || 1))}
                      className="tabular w-20"
                    />
                    {splitParts > 1 && (
                      <span className="tabular text-xs text-ink-muted">
                        {money(bill.split[0] ?? 0, currency)} each
                      </span>
                    )}
                  </div>

                  <Button
                    fullWidth
                    size="lg"
                    className="mt-4"
                    loading={takePayment.isPending}
                    onClick={() => takePayment.mutate()}
                  >
                    Record {method === 'CASH' ? 'cash' : 'card'} payment
                  </Button>
                </div>
              )}

              {bill.settled && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-accent-soft px-5 py-4">
                  <p className="text-sm font-medium text-accent-strong">This bill is settled.</p>
                  {bill.receiptId && (
                    <Button
                      size="sm"
                      variant="secondary"
                      leadingIcon={<Download className="size-3.5" />}
                      onClick={() =>
                        void downloadFile(
                          `/billing/receipts/${bill.receiptId}/pdf`,
                          `receipt-${bill.sessionCode}.pdf`,
                        )
                      }
                    >
                      Receipt PDF
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {bill && <Divider className="my-6" />}
        </section>
      </div>
    </Page>
  );
}

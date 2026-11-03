import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { BadgeCheck, CreditCard, Minus, Plus, Receipt, Users, Wallet } from 'lucide-react';
import { ApiError, api, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatTime, money } from '@/lib/format';
import { useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { Button, Input } from '@/components/ui/primitives';
import { BottomSheet, useToast } from '@/components/ui/overlays';
import { ErrorState, LoadingRows } from '@/components/ui/feedback';
import { PageHeader } from '../components/shell';
import { useSession, useSessionAuth } from '../session';
import type { BillResponse } from '../types';

const TIP_PRESETS = [0, 5, 10, 15];

export default function BillPage() {
  const { data, currency, sessionToken } = useSession();
  const auth = useSessionAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const socket = useSocket('customer', sessionToken);

  const [splitParts, setSplitParts] = useState(1);
  const [tipPercent, setTipPercent] = useState(0);
  const [payOpen, setPayOpen] = useState(false);

  const query = useQuery({
    queryKey: ['customer', 'bill', data.session.id, splitParts],
    queryFn: () => api.get<BillResponse>(`/customer/bill?splitParts=${splitParts}`, auth),
    refetchInterval: 45_000,
  });

  useRealtimeInvalidation(
    socket,
    ['order:created', 'order:updated', 'payment:updated'],
    [['customer', 'bill', data.session.id, splitParts], ['customer', 'session', sessionToken]],
  );

  const requestBill = useMutation({
    mutationFn: () => api.post('/customer/service-requests', { type: 'REQUEST_BILL' }, auth),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customer'] });
      toast.success('Your bill has been requested', 'A member of staff is on their way.');
    },
    onError: (error) =>
      toast.error('We could not send that', error instanceof ApiError ? error.message : 'Please try again.'),
  });

  const bill = query.data;
  const tipAmount = bill ? Math.round((bill.outstanding * tipPercent) / 100) : 0;

  return (
    <div className="mx-auto max-w-phone pb-36">
      <PageHeader title="Your bill" description={`Table ${data.table.number} · session ${data.session.code}`} />

      <div className="px-4">
        {query.isLoading && <LoadingRows rows={4} className="mt-6" />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

        {bill && bill.billTotal === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-line/80 bg-surface/50 px-4 py-10 text-center">
            <Receipt className="mx-auto mb-2 size-5 text-ink-muted" aria-hidden />
            <p className="text-sm font-bold text-ink">Nothing on the bill yet</p>
            <p className="mt-1 text-xs text-ink-muted">Dishes you order will automatically be added here.</p>
            <Button className="mt-4 rounded-xl" variant="secondary" onClick={() => navigate('../menu')}>
              Browse the menu
            </Button>
          </div>
        )}

        {bill && bill.billTotal > 0 && (
          <>
            {bill.settled && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4 flex items-start gap-3 rounded-2xl border border-accent/25 bg-accent-soft px-4 py-3.5 shadow-xs"
              >
                <BadgeCheck className="mt-0.5 size-5 shrink-0 text-accent-strong" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-accent-strong">This bill has been settled</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-accent-strong/80">
                    Thank you for dining with us. Your receipt is available below.
                  </p>
                  {bill.receiptId && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => navigate(`../receipt/${bill.receiptId}`)} className="rounded-xl">
                        View receipt
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => navigate('../review')} className="rounded-xl">
                        Leave a review
                      </Button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Individual orders list */}
            <section className="mt-4 overflow-hidden rounded-2xl border border-line/75 bg-surface shadow-subtle">
              {bill.orders.map((order) => (
                <div key={order.id} className="border-b border-line/60 px-4 py-3.5 last:border-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="tabular text-sm font-bold text-ink">Order #{order.number}</p>
                    <p className="tabular text-sm font-bold text-ink">{money(order.total, currency)}</p>
                  </div>
                  <p className="mt-0.5 text-2xs font-medium text-ink-muted">
                    {formatTime(order.createdAt)}
                    {order.paid && <span className="ml-1.5 font-bold text-accent-strong">· paid</span>}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {order.items.map((item, index) => (
                      <li key={index} className="flex justify-between gap-3 text-xs text-ink-muted">
                        <span className="truncate">
                          <span className="tabular font-semibold text-ink-soft">{item.quantity}×</span>{' '}
                          {item.name}
                          {item.variantName ? ` · ${item.variantName}` : ''}
                        </span>
                        <span className="tabular shrink-0">{money(item.lineTotal, currency)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            {/* Receipt Summary Breakdown */}
            <section className="mt-4 rounded-2xl border border-line/75 bg-surface p-4.5 shadow-subtle">
              <dl className="space-y-2 text-sm">
                <Row label="Subtotal" value={money(bill.subtotal, currency)} />
                {bill.discountTotal > 0 && (
                  <Row label="Discounts" value={`−${money(bill.discountTotal, currency)}`} tone="accent" />
                )}
                {bill.serviceChargeTotal > 0 && (
                  <Row label="Service charge" value={money(bill.serviceChargeTotal, currency)} />
                )}
                {bill.taxTotal > 0 && <Row label="VAT (included)" value={money(bill.taxTotal, currency)} muted />}
                {bill.paidTotal > 0 && (
                  <Row label="Already paid" value={`−${money(bill.paidTotal, currency)}`} tone="accent" />
                )}
                <div className="my-2 border-t border-dashed border-line-strong" />
                <div className="flex items-baseline justify-between pt-1">
                  <dt className="text-sm font-bold text-ink">
                    {bill.outstanding > 0 ? 'Outstanding' : 'Total'}
                  </dt>
                  <dd className="tabular font-display text-2xl font-bold text-ink">
                    {money(bill.outstanding > 0 ? bill.outstanding : bill.billTotal, currency)}
                  </dd>
                </div>
              </dl>
            </section>

            {!bill.settled && (
              <>
                {/* Bill Splitting Card */}
                <section className="mt-4 rounded-2xl border border-line/75 bg-surface p-4 shadow-subtle">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Users className="size-4 text-accent" aria-hidden />
                      <h3 className="text-sm font-bold text-ink">Split the bill</h3>
                    </div>
                    <div className="flex items-center rounded-xl border border-line-strong/80 bg-surface shadow-xs">
                      <button
                        type="button"
                        aria-label="Fewer people"
                        onClick={() => setSplitParts((n) => Math.max(1, n - 1))}
                        disabled={splitParts <= 1}
                        className="flex size-9 items-center justify-center text-ink-soft transition-all hover:text-ink active:scale-90 disabled:opacity-30"
                      >
                        <Minus className="size-3.5" strokeWidth={2.4} />
                      </button>
                      <span className="tabular w-8 text-center text-sm font-bold text-ink select-none">{splitParts}</span>
                      <button
                        type="button"
                        aria-label="More people"
                        onClick={() => setSplitParts((n) => Math.min(20, n + 1))}
                        disabled={splitParts >= 20}
                        className="flex size-9 items-center justify-center text-ink-soft transition-all hover:text-ink active:scale-90 disabled:opacity-30"
                      >
                        <Plus className="size-3.5" strokeWidth={2.4} />
                      </button>
                    </div>
                  </div>

                  {splitParts > 1 && (
                    <div className="mt-3 rounded-xl bg-stone-50 px-3.5 py-3">
                      <p className="text-xs font-medium text-ink-muted">Each person pays</p>
                      <p className="tabular mt-0.5 font-display text-xl font-bold text-ink">
                        {money(bill.split[0] ?? 0, currency)}
                      </p>
                      {new Set(bill.split).size > 1 && (
                        <p className="mt-1 text-2xs text-ink-muted">
                          Rounding adjustment: final share is {money(bill.split[bill.split.length - 1] ?? 0, currency)}.
                        </p>
                      )}
                    </div>
                  )}
                </section>

                <div className="mt-4 space-y-2.5">
                  <Button
                    size="xl"
                    fullWidth
                    onClick={() => setPayOpen(true)}
                    leadingIcon={<CreditCard className="size-4" />}
                    className="h-14 rounded-2xl bg-accent hover:bg-accent-strong text-white font-bold text-base shadow-lift transition-transform active:scale-[0.98]"
                  >
                    Pay now
                  </Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    fullWidth
                    loading={requestBill.isPending}
                    onClick={() => requestBill.mutate()}
                    leadingIcon={<Wallet className="size-4" />}
                    className="rounded-2xl font-semibold"
                  >
                    {bill.billRequestedAt ? 'Bill already requested' : 'Pay at the table (cash or card)'}
                  </Button>
                  {bill.billRequestedAt && (
                    <p className="text-center text-xs text-ink-muted">
                      Requested at {formatTime(bill.billRequestedAt)} — our staff is on their way.
                    </p>
                  )}
                </div>
              </>
            )}

            <PaymentSheet
              open={payOpen}
              onClose={() => setPayOpen(false)}
              amount={bill.outstanding}
              perPerson={splitParts > 1 ? (bill.split[0] ?? 0) : null}
              currency={currency}
              tipPercent={tipPercent}
              onTipChange={setTipPercent}
              tipAmount={tipAmount}
              onPaid={(receiptId) => {
                setPayOpen(false);
                void queryClient.invalidateQueries({ queryKey: ['customer'] });
                if (receiptId) navigate(`../receipt/${receiptId}`);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: string;
  tone?: 'accent';
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={tone === 'accent' ? 'font-medium text-accent-strong' : 'text-ink-muted'}>{label}</dt>
      <dd
        className={cn(
          'tabular',
          tone === 'accent' ? 'font-semibold text-accent-strong' : muted ? 'text-ink-muted' : 'font-medium text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* ---------------------------------------------------------- PaymentSheet */

function PaymentSheet({
  open,
  onClose,
  amount,
  perPerson,
  currency,
  tipPercent,
  onTipChange,
  tipAmount,
  onPaid,
}: {
  open: boolean;
  onClose: () => void;
  amount: number;
  perPerson: number | null;
  currency: string;
  tipPercent: number;
  onTipChange: (percent: number) => void;
  tipAmount: number;
  onPaid: (receiptId: string | null) => void;
}) {
  const auth = useSessionAuth();
  const toast = useToast();

  const [card, setCard] = useState({ cardNumber: '4242 4242 4242 4242', expiry: '12/30', cvc: '123', holder: '' });
  const [payingWhole, setPayingWhole] = useState(true);
  const [status, setStatus] = useState<'idle' | 'processing' | 'failed'>('idle');
  const [failure, setFailure] = useState<string | null>(null);

  const chargeAmount = payingWhole || perPerson === null ? amount : perPerson;

  const pay = async () => {
    setStatus('processing');
    setFailure(null);

    try {
      const response = await api.post<{
        payment: { status: string; failureReason: string | null };
        receiptId: string | null;
      }>(
        '/customer/bill/pay',
        {
          amount: chargeAmount,
          tip: tipAmount,
          splitParts: perPerson ? Math.max(1, Math.round(amount / perPerson)) : 1,
          card: {
            cardNumber: card.cardNumber.replace(/\s+/g, ''),
            expiry: card.expiry,
            cvc: card.cvc,
            holder: card.holder.trim() || 'Guest',
          },
          idempotencyKey: newIdempotencyKey(),
        },
        auth,
      );

      toast.success('Payment complete', 'This is a simulated payment — no real funds moved.');
      onPaid(response.receiptId);
      setStatus('idle');
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      const details = apiError?.details as { payment?: { failureReason?: string } } | undefined;
      setFailure(details?.payment?.failureReason ?? apiError?.message ?? 'The payment could not be completed.');
      setStatus('failed');
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={status === 'processing' ? () => undefined : onClose}
      title="Demo online payment"
      description="Simulated secure card checkout."
      footer={
        <Button
          size="xl"
          fullWidth
          loading={status === 'processing'}
          onClick={() => void pay()}
          className="h-14 rounded-2xl bg-accent hover:bg-accent-strong text-white font-bold text-base shadow-lift"
        >
          {status === 'processing' ? 'Processing…' : `Pay ${money(chargeAmount + tipAmount, currency)}`}
        </Button>
      }
    >
      <div className="space-y-5 px-5 pb-6 pt-1">
        {perPerson !== null && (
          <div className="grid grid-cols-2 gap-2.5">
            <ChoiceButton active={payingWhole} onClick={() => setPayingWhole(true)}>
              <span className="block text-xs font-medium text-ink-muted">Whole bill</span>
              <span className="tabular block text-sm font-bold text-ink">{money(amount, currency)}</span>
            </ChoiceButton>
            <ChoiceButton active={!payingWhole} onClick={() => setPayingWhole(false)}>
              <span className="block text-xs font-medium text-ink-muted">My share</span>
              <span className="tabular block text-sm font-bold text-ink">{money(perPerson, currency)}</span>
            </ChoiceButton>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold text-ink-soft">Add staff gratuity</p>
          <div className="grid grid-cols-4 gap-2">
            {TIP_PRESETS.map((percent) => (
              <ChoiceButton key={percent} active={tipPercent === percent} onClick={() => onTipChange(percent)}>
                <span className="block text-sm font-bold text-ink">{percent === 0 ? 'None' : `${percent}%`}</span>
              </ChoiceButton>
            ))}
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-line/75 bg-stone-50/70 p-4">
          <div>
            <label htmlFor="card-number" className="mb-1.5 block text-xs font-semibold text-ink-soft">
              Card number
            </label>
            <Input
              id="card-number"
              inputMode="numeric"
              autoComplete="cc-number"
              value={card.cardNumber}
              onChange={(event) => setCard({ ...card, cardNumber: event.target.value })}
              className="tabular rounded-xl"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="card-expiry" className="mb-1.5 block text-xs font-semibold text-ink-soft">
                Expiry
              </label>
              <Input
                id="card-expiry"
                placeholder="MM/YY"
                autoComplete="cc-exp"
                value={card.expiry}
                onChange={(event) => setCard({ ...card, expiry: event.target.value })}
                className="tabular rounded-xl"
              />
            </div>
            <div>
              <label htmlFor="card-cvc" className="mb-1.5 block text-xs font-semibold text-ink-soft">
                CVC
              </label>
              <Input
                id="card-cvc"
                inputMode="numeric"
                autoComplete="cc-csc"
                value={card.cvc}
                onChange={(event) => setCard({ ...card, cvc: event.target.value })}
                className="tabular rounded-xl"
              />
            </div>
          </div>
          <div>
            <label htmlFor="card-holder" className="mb-1.5 block text-xs font-semibold text-ink-soft">
              Name on card
            </label>
            <Input
              id="card-holder"
              autoComplete="cc-name"
              value={card.holder}
              onChange={(event) => setCard({ ...card, holder: event.target.value })}
              placeholder="Guest"
              className="rounded-xl"
            />
          </div>
        </div>

        {status === 'failed' && failure && (
          <div className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3">
            <p className="text-sm font-semibold text-danger">Payment declined</p>
            <p className="mt-0.5 text-xs leading-relaxed text-danger/80">{failure}</p>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

function ChoiceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border px-3 py-2.5 text-center transition-all active:scale-95',
        active
          ? 'border-accent bg-accent-soft/60 shadow-xs'
          : 'border-line/75 bg-surface hover:border-line-strong active:bg-stone-50',
      )}
    >
      {children}
    </button>
  );
}

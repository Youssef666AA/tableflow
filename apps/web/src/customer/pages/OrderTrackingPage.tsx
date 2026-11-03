import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BellRing, Plus, Receipt, Utensils } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { Button } from '@/components/ui/primitives';
import { ErrorState, LoadingRows } from '@/components/ui/feedback';
import { OrderTimeline } from '../components/order';
import { useSession, useSessionAuth } from '../session';
import type { CustomerOrder } from '../types';

export default function OrderTrackingPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { sessionToken, currency, data } = useSession();
  const auth = useSessionAuth();
  const navigate = useNavigate();
  const socket = useSocket('customer', sessionToken);

  const query = useQuery({
    queryKey: ['customer', 'order', orderId],
    queryFn: () => api.get<{ order: CustomerOrder }>(`/customer/orders/${orderId}`, auth),
    enabled: Boolean(orderId),
    refetchInterval: 30_000,
  });

  useRealtimeInvalidation(
    socket,
    ['order:updated', 'order:created'],
    [['customer', 'order', orderId], ['customer', 'orders', data.session.id]],
  );

  const order = query.data?.order;

  return (
    <div className="mx-auto max-w-phone px-4 pb-36">
      <div className="flex items-center justify-between gap-3 pt-4">
        <button
          type="button"
          onClick={() => navigate('../orders')}
          className="-ml-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-ink-soft transition-all hover:bg-stone-100 hover:text-ink active:scale-95"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Orders
        </button>
        {order && (
          <span className="tabular rounded-full bg-stone-100 px-3 py-1 font-mono text-xs font-bold text-ink">
            {order.reference}
          </span>
        )}
      </div>

      {query.isLoading && <LoadingRows rows={4} className="mt-8" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} className="py-16" />}

      {order && (
        <>
          <div className="pb-5 pt-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-2xs font-bold uppercase tracking-wider text-accent-strong">
              <span className="size-1.5 rounded-full bg-accent" />
              Table {order.tableNumber}
            </span>
            <h1 className="mt-2 font-display text-[1.75rem] font-bold leading-tight tracking-tight text-ink">
              {headlineFor(order.stage)}
            </h1>
          </div>

          {/* Timeline tracker */}
          <section className="rounded-2xl border border-line/75 bg-surface p-5 shadow-subtle">
            <OrderTimeline order={order} />
          </section>

          {/* Ticket Breakdown */}
          <section className="mt-5 rounded-2xl border border-line/75 bg-surface p-5 shadow-subtle">
            <div className="flex items-center justify-between pb-3 border-b border-line/60">
              <h2 className="font-display text-sm font-bold text-ink">What you ordered</h2>
              <span className="text-2xs font-semibold text-ink-muted">{order.items.length} items</span>
            </div>

            <ul className="mt-3.5 space-y-3">
              {order.items.map((item) => (
                <li key={item.id} className="flex gap-3 text-sm">
                  <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-md bg-stone-100 text-xs font-bold text-ink-soft">
                    {item.quantity}×
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">
                      {item.productName}
                      {item.variantName && (
                        <span className="ml-1 text-xs font-medium text-accent-strong">· {item.variantName}</span>
                      )}
                    </p>
                    {item.modifiers.length > 0 && (
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {item.modifiers.map((modifier) => modifier.optionName).join(' · ')}
                      </p>
                    )}
                    {item.notes && (
                      <p className="mt-0.5 text-xs italic text-ink-muted">“{item.notes}”</p>
                    )}
                  </div>
                  <span className="tabular shrink-0 font-semibold text-ink">
                    {money(item.lineTotal, currency)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-1.5 border-t border-line/60 pt-3 text-sm">
              {order.discountTotal > 0 && (
                <div className="flex justify-between">
                  <dt className="text-accent-strong">Discounts</dt>
                  <dd className="tabular font-medium text-accent-strong">−{money(order.discountTotal, currency)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-1">
                <dt className="font-bold text-ink">Order total</dt>
                <dd className="tabular font-display text-xl font-bold text-ink">
                  {money(order.total, currency)}
                </dd>
              </div>
            </dl>

            {order.notes && (
              <div className="mt-3.5 rounded-xl bg-stone-50 px-3.5 py-2.5 text-xs text-ink-muted">
                <span className="font-semibold text-ink-soft">Special note:</span> {order.notes}
              </div>
            )}
          </section>

          {/* Contextual Assistance card */}
          <div className="mt-5 rounded-2xl border border-line/75 bg-surface p-4 shadow-subtle">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong">
                <Utensils className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink">Need help or cutlery?</p>
                <p className="text-xs text-ink-muted">Our floor team is on standby to assist.</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate('../services')}
                className="shrink-0 text-xs font-semibold text-ink hover:bg-stone-100"
              >
                Call waiter
              </Button>
            </div>
          </div>

          {/* Quick action navigation buttons */}
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => navigate('../menu')}
              leadingIcon={<Plus className="size-4" />}
              className="rounded-xl font-semibold"
            >
              Order more
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => navigate('../services')}
              leadingIcon={<BellRing className="size-4" />}
              className="rounded-xl font-semibold"
            >
              Call waiter
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="col-span-2 rounded-xl font-semibold text-ink hover:bg-stone-100"
              onClick={() => navigate('../bill')}
              leadingIcon={<Receipt className="size-4" />}
            >
              Request the bill
            </Button>
          </div>

          <p className="mt-6 text-center text-2xs leading-relaxed text-ink-muted">
            Session {data.session.code} · this view updates in real-time, no refresh needed.
          </p>
        </>
      )}
    </div>
  );
}

function headlineFor(stage: CustomerOrder['stage']): string {
  switch (stage) {
    case 'RECEIVED':
      return 'We have your order';
    case 'PREPARING':
      return 'Your food is being prepared';
    case 'READY':
      return 'Ready — on its way to you';
    case 'DELIVERED':
      return 'Served. Enjoy your meal';
    default:
      return 'Order cancelled';
  }
}

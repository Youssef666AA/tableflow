import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BellRing, Plus, Receipt } from 'lucide-react';
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
    <div className="mx-auto max-w-phone px-4 pb-32">
      <div className="flex items-center justify-between gap-3 pt-4">
        <button
          onClick={() => navigate('../orders')}
          className="-ml-2 inline-flex items-center gap-1.5 rounded p-2 text-sm font-medium text-ink-soft hover:text-ink"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Orders
        </button>
        {order && (
          <span className="tabular font-display text-lg font-semibold text-ink">{order.reference}</span>
        )}
      </div>

      {query.isLoading && <LoadingRows rows={4} className="mt-8" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} className="py-16" />}

      {order && (
        <>
          <div className="pb-6 pt-3">
            <p className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent-strong">
              Table {order.tableNumber}
            </p>
            <h1 className="mt-1.5 font-display text-[1.625rem] font-semibold leading-tight tracking-tight text-ink">
              {headlineFor(order.stage)}
            </h1>
          </div>

          <section className="rounded-lg border border-line bg-surface p-5 shadow-subtle">
            <OrderTimeline order={order} />
          </section>

          <section className="mt-5 rounded-lg border border-line bg-surface p-4 shadow-subtle">
            <h2 className="mb-3 text-sm font-semibold text-ink">What you ordered</h2>
            <ul className="space-y-3">
              {order.items.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <span className="tabular shrink-0 text-sm font-semibold text-ink-muted">{item.quantity}×</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {item.productName}
                      {item.variantName && <span className="font-normal text-ink-muted"> · {item.variantName}</span>}
                    </p>
                    {item.modifiers.length > 0 && (
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                        {item.modifiers.map((modifier) => modifier.optionName).join(' · ')}
                      </p>
                    )}
                    {item.notes && (
                      <p className="mt-0.5 text-xs italic leading-relaxed text-ink-muted">“{item.notes}”</p>
                    )}
                  </div>
                  <span className="tabular shrink-0 text-sm text-ink">{money(item.lineTotal, currency)}</span>
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
              {order.discountTotal > 0 && (
                <div className="flex justify-between">
                  <dt className="text-accent-strong">Discounts</dt>
                  <dd className="tabular text-accent-strong">−{money(order.discountTotal, currency)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-1">
                <dt className="font-semibold text-ink">Order total</dt>
                <dd className="tabular font-display text-lg font-semibold text-ink">
                  {money(order.total, currency)}
                </dd>
              </div>
            </dl>

            {order.notes && (
              <p className="mt-3 rounded-md bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-ink-muted">
                <span className="font-medium text-ink-soft">Your note:</span> {order.notes}
              </p>
            )}
          </section>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <Button variant="secondary" size="lg" onClick={() => navigate('../menu')} leadingIcon={<Plus className="size-4" />}>
              Order more
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => navigate('../services')}
              leadingIcon={<BellRing className="size-4" />}
            >
              Call waiter
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="col-span-2"
              onClick={() => navigate('../bill')}
              leadingIcon={<Receipt className="size-4" />}
            >
              Request the bill
            </Button>
          </div>

          <p className="mt-6 text-center text-2xs leading-relaxed text-ink-muted">
            Session {data.session.code} · this page updates by itself, no need to refresh.
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

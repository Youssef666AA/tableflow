import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { Button } from '@/components/ui/primitives';
import { EmptyState, ErrorState, LoadingRows } from '@/components/ui/feedback';
import { OrderCard } from '../components/order';
import { PageHeader } from '../components/shell';
import { useSession, useSessionAuth } from '../session';
import type { CustomerOrder } from '../types';

export default function OrdersPage() {
  const { sessionToken, currency, data } = useSession();
  const auth = useSessionAuth();
  const navigate = useNavigate();
  const socket = useSocket('customer', sessionToken);

  const query = useQuery({
    queryKey: ['customer', 'orders', data.session.id],
    queryFn: () => api.get<{ orders: CustomerOrder[] }>('/customer/orders', auth),
    refetchInterval: 45_000,
  });

  useRealtimeInvalidation(
    socket,
    ['order:created', 'order:updated'],
    [['customer', 'orders', data.session.id], ['customer', 'session', sessionToken]],
  );

  const orders = query.data?.orders ?? [];
  const active = orders.filter((order) => !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(order.status));
  const past = orders.filter((order) => ['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(order.status));

  return (
    <div className="mx-auto max-w-phone pb-32">
      <PageHeader
        title="Your orders"
        description={`Everything ordered at table ${data.table.number} during this visit`}
      />

      <div className="px-4">
        {query.isLoading && <LoadingRows rows={3} className="mt-6" />}
        {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

        {query.isSuccess && orders.length === 0 && (
          <EmptyState
            icon={<ClipboardList className="size-5" />}
            title="No active orders"
            description="Your table doesn't have any orders yet. Anything you order will appear here with live status."
            action={<Button onClick={() => navigate('../menu')}>Browse menu</Button>}
            className="py-14"
          />
        )}

        {active.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-2.5 text-[0.8125rem] font-semibold uppercase tracking-wider text-ink-soft">
              In progress
            </h2>
            <div className="space-y-2.5">
              {active.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  currency={currency}
                  onOpen={() => navigate(`../order/${order.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section className="mt-7">
            <h2 className="mb-2.5 text-[0.8125rem] font-semibold uppercase tracking-wider text-ink-soft">
              Earlier this visit
            </h2>
            <div className="space-y-2.5">
              {past.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  currency={currency}
                  onOpen={() => navigate(`../order/${order.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {orders.length > 0 && (
          <div className="mt-7 flex flex-col gap-2">
            <Button variant="secondary" size="lg" fullWidth onClick={() => navigate('../menu')}>
              Order more
            </Button>
            <Button variant="ghost" size="lg" fullWidth onClick={() => navigate('../bill')}>
              View the table bill
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

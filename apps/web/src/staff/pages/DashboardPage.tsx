import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bell, ChefHat, ClipboardList, Receipt, Table2, Timer } from 'lucide-react';
import { api, staffTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/format';
import { useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { StatCard } from '@/components/ui/data';
import { Page, PageHeading, SectionHeading } from '@/console/PageShell';
import type { FloorTable } from '../components/floor';

interface TablesPayload {
  tables: FloorTable[];
}

interface RequestsPayload {
  requests: Array<{ id: string; tableNumber: string; label: string; status: string; createdAt: string }>;
}

const SHORTCUTS = [
  { to: '/staff/kitchen', label: 'Kitchen display', description: 'Tickets, timers and stations', Icon: ChefHat, permission: 'kitchen:view' as const },
  { to: '/staff/waiter', label: 'Floor', description: 'Tables, ready food, requests', Icon: Table2, permission: 'tables:view' as const },
  { to: '/staff/orders', label: 'Orders', description: 'Every order at this branch', Icon: ClipboardList, permission: 'orders:view' as const },
  { to: '/staff/requests', label: 'Requests', description: 'Water, cutlery, the bill', Icon: Bell, permission: 'requests:view' as const },
  { to: '/staff/billing', label: 'Billing', description: 'Open tabs and receipts', Icon: Receipt, permission: 'billing:view' as const },
];

export default function StaffDashboardPage() {
  const { branchId, branchName, currency, can, user } = useAuth();
  const socket = useSocket('staff', staffTokens.access());

  const tablesQuery = useQuery({
    queryKey: ['tables', branchId],
    queryFn: () => api.get<TablesPayload>(`/tables?branchId=${branchId}`),
    enabled: Boolean(branchId) && can('tables:view'),
    refetchInterval: 60_000,
  });

  const requestsQuery = useQuery({
    queryKey: ['service-requests', branchId, 'open'],
    queryFn: () => api.get<RequestsPayload>(`/service-requests?branchId=${branchId}&status=open`),
    enabled: Boolean(branchId) && can('requests:view'),
    refetchInterval: 60_000,
  });

  useRealtimeInvalidation(
    socket,
    ['table:updated', 'order:created', 'order:updated', 'service_request:created', 'service_request:updated'],
    [['tables', branchId], ['service-requests', branchId, 'open']],
  );

  const tables = tablesQuery.data?.tables ?? [];
  const occupied = tables.filter((table) => table.session !== null);
  const readyTables = tables.filter((table) => table.status === 'FOOD_READY');
  const openOrders = occupied.reduce((sum, table) => sum + (table.session?.openOrderCount ?? 0), 0);
  const openTotal = occupied.reduce((sum, table) => sum + (table.session?.unpaidTotal ?? 0), 0);
  const requests = requestsQuery.data?.requests ?? [];

  const shortcuts = SHORTCUTS.filter((shortcut) => can(shortcut.permission));

  return (
    <Page>
      <PageHeading
        title={`Good ${greeting()}, ${user?.fullName.split(' ')[0] ?? 'there'}`}
        description={`${branchName} · here is where the floor stands right now.`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tables seated"
          value={occupied.length}
          sublabel={`of ${tables.length} tables`}
          icon={<Table2 className="size-4" />}
          loading={tablesQuery.isLoading}
        />
        <StatCard
          label="Orders in progress"
          value={openOrders}
          sublabel="not yet delivered"
          icon={<ClipboardList className="size-4" />}
          tone={openOrders > 0 ? 'accent' : 'neutral'}
          loading={tablesQuery.isLoading}
        />
        <StatCard
          label="Ready to serve"
          value={readyTables.length}
          sublabel={readyTables.length > 0 ? `tables ${readyTables.map((t) => t.number).join(', ')}` : 'nothing waiting'}
          icon={<Timer className="size-4" />}
          tone={readyTables.length > 0 ? 'warning' : 'neutral'}
          loading={tablesQuery.isLoading}
        />
        <StatCard
          label="Unpaid on the floor"
          value={money(openTotal, currency)}
          sublabel={`${occupied.length} open ${occupied.length === 1 ? 'tab' : 'tabs'}`}
          icon={<Receipt className="size-4" />}
          loading={tablesQuery.isLoading}
        />
      </div>

      {requests.length > 0 && (
        <section className="mb-6">
          <SectionHeading
            title="Guests waiting"
            description={`${requests.length} open ${requests.length === 1 ? 'request' : 'requests'}`}
            actions={
              <Link to="/staff/requests" className="text-xs font-medium text-accent-strong hover:underline">
                Handle all
              </Link>
            }
          />
          <div className="flex flex-wrap gap-2">
            {requests.slice(0, 8).map((request) => (
              <span
                key={request.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-3 py-1.5 text-xs font-medium text-warning"
              >
                <Bell className="size-3" aria-hidden />
                Table {request.tableNumber} · {request.label}
              </span>
            ))}
          </div>
        </section>
      )}

      <SectionHeading title="Jump to" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shortcuts.map(({ to, label, description, Icon }) => (
          <Link
            key={to}
            to={to}
            className="group flex items-start gap-3 rounded-lg border border-line bg-surface p-4 shadow-subtle transition-all hover:shadow-lift"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-ink-soft transition-colors group-hover:bg-accent-soft group-hover:text-accent-strong">
              <Icon className="size-[1.125rem]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">{label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{description}</span>
            </span>
            <ArrowRight
              className="mt-2.5 size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </Page>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

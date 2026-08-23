import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { amount, formatMinutes, formatPercent, formatSeconds, money, titleCase } from '@/lib/format';
import { SegmentedControl } from '@/components/ui/primitives';
import { ChartCard, DataTable, StatCard, type Column } from '@/components/ui/data';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { Page, PageHeading } from '@/console/PageShell';
import { CHART_COLORS, chartAxis, chartGrid, ChartTooltip } from '../components/charts';

type Range = 'today' | '7d' | '30d' | '90d';
type Tab = 'sales' | 'kitchen' | 'tables' | 'inventory';

interface SalesPayload {
  series: { granularity: string; points: Array<{ bucket: string; revenue: number; orders: number }> };
  ordersByHour: Array<{ hour: number; orders: number; revenue: number }>;
  products: {
    best: Array<{ productId: string | null; name: string; quantity: number; revenue: number; orders: number }>;
    worst: Array<{ productId: string | null; name: string; quantity: number; revenue: number; orders: number }>;
  };
  categories: Array<{ categoryId: string | null; name: string; revenue: number; quantity: number }>;
  branches: Array<{ branchId: string; name: string; revenue: number; orders: number; averageOrderValue: number }>;
}

interface KitchenPayload {
  kitchen: {
    averageMinutesToReady: number | null;
    averageCookMinutes: number | null;
    averageMinutesToDelivered: number | null;
    lateOrders: number;
    totalOrders: number;
    lateRate: number;
    stations: Array<{ station: string; items: number; averageMinutes: number | null }>;
  };
  service: {
    total: number;
    averageResponseSeconds: number | null;
    byType: Array<{
      type: string;
      count: number;
      averageResponseSeconds: number | null;
      averageResolutionSeconds: number | null;
    }>;
  };
}

interface TableRow {
  tableId: string;
  number: string;
  orders: number;
  revenue: number;
  sessions: number;
  averageOrderValue: number;
  averageSessionMinutes: number | null;
  ordersPerSession: number;
}

interface InventoryPayload {
  waste: {
    totalCost: number;
    byReason: Array<{ reason: string; cost: number; movements: number }>;
    trend: Array<{ bucket: string; cost: number }>;
    topItems: Array<{ name: string; unit: string; quantity: number; cost: number }>;
  };
  consumption: Array<{ name: string; unit: string; quantity: number; cost: number }>;
}

export default function AnalyticsPage() {
  const { branchId, currency, user } = useAuth();
  const [range, setRange] = useState<Range>('30d');
  const [tab, setTab] = useState<Tab>('sales');
  const [scope, setScope] = useState<'branch' | 'all'>('branch');

  const branchParam = scope === 'all' ? 'all' : branchId;
  const suffix = `range=${range}&branchId=${branchParam}`;

  const sales = useQuery({
    queryKey: ['analytics', 'sales', branchParam, range],
    queryFn: () => api.get<SalesPayload>(`/analytics/sales?${suffix}`),
    enabled: Boolean(branchId) && tab === 'sales',
  });

  const kitchen = useQuery({
    queryKey: ['analytics', 'kitchen', branchParam, range],
    queryFn: () => api.get<KitchenPayload>(`/analytics/kitchen?${suffix}`),
    enabled: Boolean(branchId) && tab === 'kitchen',
  });

  const tablesQuery = useQuery({
    queryKey: ['analytics', 'tables', branchParam, range],
    queryFn: () => api.get<{ tables: TableRow[] }>(`/analytics/tables?${suffix}`),
    enabled: Boolean(branchId) && tab === 'tables',
  });

  const inventory = useQuery({
    queryKey: ['analytics', 'inventory', branchParam, range],
    queryFn: () => api.get<InventoryPayload>(`/analytics/inventory?${suffix}`),
    enabled: Boolean(branchId) && tab === 'inventory',
  });

  const tableColumns: Column<TableRow>[] = [
    { key: 'number', header: 'Table', render: (row) => <span className="tabular font-semibold text-ink">{row.number}</span> },
    {
      key: 'revenue',
      header: 'Revenue',
      align: 'right',
      render: (row) => <span className="tabular font-medium text-ink">{money(row.revenue, currency)}</span>,
    },
    { key: 'orders', header: 'Orders', align: 'right', render: (row) => <span className="tabular">{row.orders}</span> },
    {
      key: 'aov',
      header: 'Avg. order',
      align: 'right',
      hideOnMobile: true,
      render: (row) => <span className="tabular">{money(row.averageOrderValue, currency)}</span>,
    },
    { key: 'sessions', header: 'Visits', align: 'right', hideOnMobile: true, render: (row) => <span className="tabular">{row.sessions}</span> },
    {
      key: 'duration',
      header: 'Avg. visit',
      align: 'right',
      hideOnMobile: true,
      render: (row) => (
        <span className="tabular">{row.averageSessionMinutes != null ? formatMinutes(row.averageSessionMinutes) : '—'}</span>
      ),
    },
    {
      key: 'perSession',
      header: 'Orders / visit',
      align: 'right',
      hideOnMobile: true,
      render: (row) => <span className="tabular">{row.ordersPerSession.toFixed(2)}</span>,
    },
  ];

  return (
    <Page>
      <PageHeading
        title="Analytics"
        description="Computed live from orders, sessions, stock movements and service requests."
        actions={
          <div className="flex flex-wrap gap-2">
            {(user?.branches.length ?? 0) > 1 && (
              <SegmentedControl
                size="sm"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'branch', label: 'This branch' },
                  { value: 'all', label: 'All branches' },
                ]}
              />
            )}
            <SegmentedControl
              size="sm"
              value={range}
              onChange={setRange}
              options={[
                { value: 'today', label: 'Today' },
                { value: '7d', label: '7d' },
                { value: '30d', label: '30d' },
                { value: '90d', label: '90d' },
              ]}
            />
          </div>
        }
      />

      <SegmentedControl
        className="mb-5"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'sales', label: 'Sales' },
          { value: 'kitchen', label: 'Kitchen & service' },
          { value: 'tables', label: 'Tables' },
          { value: 'inventory', label: 'Inventory & waste' },
        ]}
      />

      {tab === 'sales' && (
        <>
          {sales.isError && <ErrorState error={sales.error} onRetry={() => void sales.refetch()} />}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Revenue over time" className="lg:col-span-2" height={280}>
              {(sales.data?.series.points.length ?? 0) === 0 ? (
                <EmptyState title="No sales in this period" compact />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={sales.data?.series.points.map((point) => ({
                      label: new Date(point.bucket).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
                      revenue: point.revenue / 1000,
                      orders: point.orders,
                    }))}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid {...chartGrid} />
                    <XAxis dataKey="label" {...chartAxis} />
                    <YAxis {...chartAxis} width={56} tickFormatter={(value: number) => amount(value * 1000, currency)} />
                    <Tooltip content={<ChartTooltip currency={currency} valueKey="revenue" scale={1000} />} />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke={CHART_COLORS[0]}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Best sellers" description="By revenue" height={300}>
              <ul className="space-y-2.5 px-3 pt-1">
                {sales.data?.products.best.map((product, index) => (
                  <li key={product.productId ?? product.name} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-ink">
                      <span className="tabular mr-2 text-2xs text-ink-muted">{index + 1}</span>
                      {product.name}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block text-sm font-medium text-ink">
                        {money(product.revenue, currency)}
                      </span>
                      <span className="tabular block text-2xs text-ink-muted">{product.quantity} sold</span>
                    </span>
                  </li>
                ))}
                {(sales.data?.products.best.length ?? 0) === 0 && <EmptyState title="Nothing sold" compact />}
              </ul>
            </ChartCard>

            <ChartCard title="Slowest movers" description="Lowest revenue" height={300}>
              <ul className="space-y-2.5 px-3 pt-1">
                {sales.data?.products.worst.map((product) => (
                  <li key={product.productId ?? product.name} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-ink">{product.name}</span>
                    <span className="shrink-0 text-right">
                      <span className="tabular block text-sm font-medium text-ink">
                        {money(product.revenue, currency)}
                      </span>
                      <span className="tabular block text-2xs text-ink-muted">{product.quantity} sold</span>
                    </span>
                  </li>
                ))}
                {(sales.data?.products.worst.length ?? 0) === 0 && <EmptyState title="Nothing sold" compact />}
              </ul>
            </ChartCard>

            {(sales.data?.branches.length ?? 0) > 1 && (
              <ChartCard title="Branch comparison" className="lg:col-span-2" height={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sales.data?.branches.map((branch) => ({
                      label: branch.name.split('—')[0]?.trim() ?? branch.name,
                      revenue: branch.revenue / 1000,
                    }))}
                    margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid {...chartGrid} />
                    <XAxis dataKey="label" {...chartAxis} />
                    <YAxis {...chartAxis} width={56} tickFormatter={(value: number) => amount(value * 1000, currency)} />
                    <Tooltip
                      content={<ChartTooltip currency={currency} valueKey="revenue" scale={1000} />}
                      cursor={{ fill: 'rgb(0 0 0 / 0.04)' }}
                    />
                    <Bar dataKey="revenue" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            )}
          </div>
        </>
      )}

      {tab === 'kitchen' && (
        <>
          {kitchen.isError && <ErrorState error={kitchen.error} onRetry={() => void kitchen.refetch()} />}
          <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Order to ready"
              value={kitchen.data?.kitchen.averageMinutesToReady != null ? formatMinutes(kitchen.data.kitchen.averageMinutesToReady) : '—'}
              sublabel="average"
              loading={kitchen.isLoading}
            />
            <StatCard
              label="Cook time"
              value={kitchen.data?.kitchen.averageCookMinutes != null ? formatMinutes(kitchen.data.kitchen.averageCookMinutes) : '—'}
              sublabel="start to ready"
              loading={kitchen.isLoading}
            />
            <StatCard
              label="Late orders"
              value={formatPercent(kitchen.data?.kitchen.lateRate)}
              sublabel={`${kitchen.data?.kitchen.lateOrders ?? 0} of ${kitchen.data?.kitchen.totalOrders ?? 0}`}
              tone={(kitchen.data?.kitchen.lateRate ?? 0) > 25 ? 'danger' : 'neutral'}
              loading={kitchen.isLoading}
            />
            <StatCard
              label="Request response"
              value={formatSeconds(kitchen.data?.service.averageResponseSeconds)}
              sublabel={`${kitchen.data?.service.total ?? 0} requests`}
              loading={kitchen.isLoading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="By station" description="Average time per item" height={260}>
              {(kitchen.data?.kitchen.stations.length ?? 0) === 0 ? (
                <EmptyState title="No station data" compact />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={kitchen.data?.kitchen.stations.map((station) => ({
                      label: station.station,
                      minutes: station.averageMinutes ?? 0,
                    }))}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                  >
                    <CartesianGrid {...chartGrid} horizontal={false} />
                    <XAxis type="number" {...chartAxis} />
                    <YAxis type="category" dataKey="label" {...chartAxis} width={82} />
                    <Tooltip content={<ChartTooltip valueKey="minutes" suffix=" min" />} cursor={{ fill: 'rgb(0 0 0 / 0.04)' }} />
                    <Bar dataKey="minutes" fill={CHART_COLORS[2]} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Service requests" description="Response time by type" height={260}>
              <ul className="space-y-2 px-3 pt-1">
                {kitchen.data?.service.byType.map((row) => (
                  <li key={row.type} className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-ink">{titleCase(row.type)}</span>
                    <span className="text-right">
                      <span className="tabular block text-sm font-medium text-ink">
                        {formatSeconds(row.averageResponseSeconds)}
                      </span>
                      <span className="tabular block text-2xs text-ink-muted">{row.count} requests</span>
                    </span>
                  </li>
                ))}
                {(kitchen.data?.service.byType.length ?? 0) === 0 && (
                  <EmptyState title="No requests in this period" compact />
                )}
              </ul>
            </ChartCard>
          </div>
        </>
      )}

      {tab === 'tables' && (
        <>
          {tablesQuery.isError && <ErrorState error={tablesQuery.error} onRetry={() => void tablesQuery.refetch()} />}
          <DataTable
            columns={tableColumns}
            rows={tablesQuery.data?.tables ?? []}
            rowKey={(row) => row.tableId}
            loading={tablesQuery.isLoading}
            dense
            empty={<EmptyState title="No table activity in this period" compact />}
          />
        </>
      )}

      {tab === 'inventory' && (
        <>
          {inventory.isError && <ErrorState error={inventory.error} onRetry={() => void inventory.refetch()} />}
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Waste cost"
              value={money(inventory.data?.waste.totalCost ?? 0, currency)}
              tone="warning"
              loading={inventory.isLoading}
            />
            <StatCard
              label="Waste events"
              value={inventory.data?.waste.byReason.reduce((sum, row) => sum + row.movements, 0) ?? 0}
              loading={inventory.isLoading}
            />
            <StatCard
              label="Ingredients consumed"
              value={inventory.data?.consumption.length ?? 0}
              sublabel="distinct items"
              loading={inventory.isLoading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Waste by reason" height={280}>
              {(inventory.data?.waste.byReason.length ?? 0) === 0 ? (
                <EmptyState title="No waste recorded" compact />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={inventory.data?.waste.byReason.map((row) => ({
                        name: titleCase(row.reason),
                        value: row.cost / 1000,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="50%"
                      outerRadius="78%"
                      paddingAngle={2}
                      stroke="none"
                    >
                      {(inventory.data?.waste.byReason ?? []).map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip currency={currency} valueKey="value" scale={1000} />} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard title="Most consumed" description="By quantity used" height={280}>
              <ul className="space-y-2 px-3 pt-1">
                {inventory.data?.consumption.slice(0, 8).map((row) => (
                  <li key={row.name} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-ink">{row.name}</span>
                    <span className="text-right">
                      <span className="tabular block text-sm font-medium text-ink">
                        {row.quantity} {row.unit}
                      </span>
                      <span className="tabular block text-2xs text-ink-muted">{money(row.cost, currency)}</span>
                    </span>
                  </li>
                ))}
                {(inventory.data?.consumption.length ?? 0) === 0 && (
                  <EmptyState title="No consumption recorded" compact />
                )}
              </ul>
            </ChartCard>
          </div>
        </>
      )}
    </Page>
  );
}

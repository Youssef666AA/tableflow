import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Bell,
  ClipboardList,
  Star,
  Table2,
  Timer,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { api, staffTokens } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { amount, formatMinutes, formatPercent, money } from '@/lib/format';
import { useRealtimeInvalidation, useSocket } from '@/lib/hooks';
import { SegmentedControl } from '@/components/ui/primitives';
import { ChartCard, StatCard } from '@/components/ui/data';
import { EmptyState, ErrorState } from '@/components/ui/feedback';
import { Page, PageHeading } from '@/console/PageShell';
import { CHART_COLORS, chartAxis, chartGrid, ChartTooltip } from '../components/charts';

interface Metric {
  value: number;
  changePercent?: number | null;
  of?: number;
}

interface OverviewPayload {
  scope: { branchIds: string[]; from: string; to: string };
  overview: {
    revenue: Metric;
    orders: Metric;
    averageOrderValue: Metric;
    sessions: Metric;
    cancellationRate: Metric;
    averagePrepMinutes: { value: number | null };
    lateOrderRate: Metric;
    activeTables: Metric;
    pendingServiceRequests: Metric;
    openOrders: Metric;
    stockAlerts: Metric;
  };
  sales: { granularity: 'hour' | 'day'; points: Array<{ bucket: string; revenue: number; orders: number }> };
  ordersByHour: Array<{ hour: number; orders: number; revenue: number }>;
  topProducts: Array<{ productId: string | null; name: string; quantity: number; revenue: number }>;
  categories: Array<{ categoryId: string | null; name: string; revenue: number; quantity: number }>;
  reviews: { averageRating: number | null; count: number; distribution: Array<{ rating: number; count: number }> };
}

type Range = 'today' | '7d' | '30d' | '90d';

export default function AdminDashboardPage() {
  const { currency, user, branchId } = useAuth();
  const socket = useSocket('staff', staffTokens.access());
  const [range, setRange] = useState<Range>('today');
  const [scope, setScope] = useState<'branch' | 'all'>('branch');

  const branchParam = scope === 'all' ? 'all' : branchId;

  const query = useQuery({
    queryKey: ['analytics', 'overview', branchParam, range],
    queryFn: () => api.get<OverviewPayload>(`/analytics/overview?range=${range}&branchId=${branchParam}`),
    enabled: Boolean(branchId),
    refetchInterval: 120_000,
  });

  useRealtimeInvalidation(
    socket,
    ['order:created', 'order:updated', 'payment:updated'],
    [['analytics', 'overview', branchParam, range]],
  );

  const data = query.data;
  const o = data?.overview;

  const salesData = (data?.sales.points ?? []).map((point) => ({
    label:
      data?.sales.granularity === 'hour'
        ? new Date(point.bucket).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : new Date(point.bucket).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
    revenue: point.revenue / 1000,
    orders: point.orders,
  }));

  const hourData = (data?.ordersByHour ?? []).map((row) => ({
    label: `${String(row.hour).padStart(2, '0')}:00`,
    orders: row.orders,
  }));

  const categoryData = (data?.categories ?? []).slice(0, 6).map((row) => ({
    name: row.name,
    value: row.revenue / 1000,
  }));

  return (
    <Page>
      <PageHeading
        title="Dashboard"
        description={`${user?.restaurant.name} · ${scope === 'all' ? 'all branches' : 'this branch'}`}
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
                { value: '7d', label: '7 days' },
                { value: '30d', label: '30 days' },
                { value: '90d', label: '90 days' },
              ]}
            />
          </div>
        }
      />

      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Revenue"
          value={money(o?.revenue.value ?? 0, currency)}
          changePercent={o?.revenue.changePercent}
          sublabel="vs previous period"
          icon={<TrendingUp className="size-4" />}
          tone="accent"
          loading={query.isLoading}
        />
        <StatCard
          label="Orders"
          value={o?.orders.value ?? 0}
          changePercent={o?.orders.changePercent}
          icon={<ClipboardList className="size-4" />}
          loading={query.isLoading}
        />
        <StatCard
          label="Average order"
          value={money(o?.averageOrderValue.value ?? 0, currency)}
          changePercent={o?.averageOrderValue.changePercent}
          icon={<Wallet className="size-4" />}
          loading={query.isLoading}
        />
        <StatCard
          label="Active tables"
          value={o?.activeTables.value ?? 0}
          sublabel={`of ${o?.activeTables.of ?? 0} tables`}
          icon={<Table2 className="size-4" />}
          loading={query.isLoading}
        />
        <StatCard
          label="Avg. prep time"
          value={o?.averagePrepMinutes.value != null ? formatMinutes(o.averagePrepMinutes.value) : '—'}
          sublabel={`${formatPercent(o?.lateOrderRate.value)} over target`}
          icon={<Timer className="size-4" />}
          tone={(o?.lateOrderRate.value ?? 0) > 25 ? 'warning' : 'neutral'}
          loading={query.isLoading}
        />
        <StatCard
          label="Open requests"
          value={o?.pendingServiceRequests.value ?? 0}
          sublabel={`${o?.openOrders.value ?? 0} orders in progress`}
          icon={<Bell className="size-4" />}
          tone={(o?.pendingServiceRequests.value ?? 0) > 0 ? 'warning' : 'neutral'}
          loading={query.isLoading}
        />
      </div>

      {(o?.stockAlerts.value ?? 0) > 0 && (
        <Link
          to="/admin/inventory"
          className="mb-5 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 transition-colors hover:bg-warning-soft/70"
        >
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 flex-1 text-sm font-medium text-warning">
            {o?.stockAlerts.value} ingredient{o?.stockAlerts.value === 1 ? '' : 's'} below threshold
          </p>
          <span className="shrink-0 text-xs font-medium text-warning underline-offset-2 hover:underline">
            Review stock
          </span>
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Sales"
          description={data?.sales.granularity === 'hour' ? 'By hour' : 'By day'}
          className="lg:col-span-2"
          height={280}
        >
          {salesData.length === 0 ? (
            <EmptyState title="No sales in this period" compact />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={salesData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="label" {...chartAxis} />
                <YAxis {...chartAxis} width={54} tickFormatter={(value: number) => amount(value * 1000, currency)} />
                <Tooltip
                  content={<ChartTooltip currency={currency} valueKey="revenue" scale={1000} suffix=" revenue" />}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke={CHART_COLORS[0]}
                  strokeWidth={2}
                  fill="url(#revenueFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Revenue by category" height={280}>
          {categoryData.length === 0 ? (
            <EmptyState title="Nothing sold yet" compact />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="52%"
                  outerRadius="80%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {categoryData.map((_, index) => (
                    <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip currency={currency} valueKey="value" scale={1000} />} />
              </PieChart>
            </ResponsiveContainer>
          )}
          {categoryData.length > 0 && (
            <ul className="-mt-4 flex flex-wrap justify-center gap-x-3 gap-y-1 px-3">
              {categoryData.map((entry, index) => (
                <li key={entry.name} className="inline-flex items-center gap-1.5 text-2xs text-ink-muted">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                    aria-hidden
                  />
                  {entry.name}
                </li>
              ))}
            </ul>
          )}
        </ChartCard>

        <ChartCard title="Orders by hour" description="When the room is busy" height={240}>
          {hourData.every((row) => row.orders === 0) ? (
            <EmptyState title="No orders in this period" compact />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="label" {...chartAxis} interval={3} />
                <YAxis {...chartAxis} width={32} allowDecimals={false} />
                <Tooltip content={<ChartTooltip valueKey="orders" suffix=" orders" />} cursor={{ fill: 'rgb(0 0 0 / 0.04)' }} />
                <Bar dataKey="orders" fill={CHART_COLORS[1]} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Top products" description="By revenue" height={240} className="lg:col-span-2">
          {(data?.topProducts.length ?? 0) === 0 ? (
            <EmptyState title="Nothing sold yet" compact />
          ) : (
            <ul className="space-y-2 px-3 pt-1">
              {data?.topProducts.map((product, index) => {
                const max = data.topProducts[0]?.revenue || 1;
                return (
                  <li key={product.productId ?? product.name}>
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-ink">
                        <span className="tabular mr-2 text-2xs text-ink-muted">{index + 1}</span>
                        {product.name}
                      </span>
                      <span className="tabular shrink-0 text-sm font-medium text-ink">
                        {money(product.revenue, currency)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(4, (product.revenue / max) * 100)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-line bg-surface p-4 shadow-subtle">
          <div className="flex items-center gap-2">
            <Star className="size-4 text-gold" aria-hidden />
            <h3 className="text-sm font-semibold text-ink">Guest rating</h3>
          </div>
          <p className="tabular mt-2 text-2xl font-semibold text-ink">
            {data?.reviews.averageRating?.toFixed(1) ?? '—'}
            <span className="ml-1 text-sm font-normal text-ink-muted">/ 5</span>
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {data?.reviews.count ?? 0} review{data?.reviews.count === 1 ? '' : 's'} in this period
          </p>
          <Link
            to="/admin/reviews"
            className="mt-3 inline-block text-xs font-medium text-accent-strong hover:underline"
          >
            Read reviews
          </Link>
        </div>

        <StatCard
          label="Cancellation rate"
          value={formatPercent(o?.cancellationRate.value)}
          sublabel="of all orders placed"
          tone={(o?.cancellationRate.value ?? 0) > 8 ? 'warning' : 'neutral'}
          loading={query.isLoading}
        />
        <StatCard
          label="Table sessions"
          value={o?.sessions.value ?? 0}
          changePercent={o?.sessions.changePercent}
          sublabel="distinct visits"
          loading={query.isLoading}
        />
        <StatCard
          label="Late orders"
          value={formatPercent(o?.lateOrderRate.value)}
          sublabel="past the kitchen target"
          tone={(o?.lateOrderRate.value ?? 0) > 25 ? 'danger' : 'neutral'}
          loading={query.isLoading}
        />
      </div>
    </Page>
  );
}

import { money } from '@/lib/format';

/**
 * One categorical ramp for the whole console, ordered so neighbouring series
 * stay distinguishable and the first colour matches the brand accent.
 */
export const CHART_COLORS = [
  '#2F7A55', // accent green
  '#B0894A', // warm gold
  '#3E6076', // slate blue
  '#8A6A43', // toasted almond
  '#5F7A5A', // sage
  '#9A5540', // terracotta
  '#6B5B8A', // fig
  '#417D8C', // teal
];

export const chartGrid = {
  strokeDasharray: '3 3',
  stroke: 'rgb(var(--c-line))',
  vertical: false,
} as const;

export const chartAxis = {
  stroke: 'rgb(var(--c-line-strong))',
  tick: { fill: 'rgb(var(--c-ink-muted))', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

interface TooltipPayloadEntry {
  name?: string;
  value?: number | string;
  dataKey?: string | number;
  color?: string;
  payload?: Record<string, unknown>;
}

/**
 * A tooltip that speaks the app's own formatting rules — money as money,
 * counts as counts — instead of Recharts' raw numbers.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  currency,
  valueKey,
  scale = 1,
  suffix = '',
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  currency?: string;
  valueKey?: string;
  /** Multiply the plotted value by this before formatting (charts plot major units). */
  scale?: number;
  suffix?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const entry = valueKey
    ? (payload.find((item) => item.dataKey === valueKey) ?? payload[0])
    : payload[0];
  const raw = Number(entry?.value ?? 0);

  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-overlay">
      {label !== undefined && (
        <p className="mb-0.5 text-2xs font-medium uppercase tracking-wider text-ink-muted">
          {entry?.payload?.name ? String(entry.payload.name) : String(label)}
        </p>
      )}
      <p className="tabular text-sm font-semibold text-ink">
        {currency ? money(raw * scale, currency) : raw.toLocaleString('en-GB')}
        {suffix}
      </p>
    </div>
  );
}

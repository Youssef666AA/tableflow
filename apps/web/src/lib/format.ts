import { formatAmount, formatMoney } from '@tableflow/shared';

export { formatMoney, formatAmount };

export function money(minor: number | null | undefined, currency = 'TND'): string {
  return formatMoney(minor ?? 0, currency);
}

export function amount(minor: number | null | undefined, currency = 'TND'): string {
  return formatAmount(minor ?? 0, currency);
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const weekdayFormatter = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return timeFormatter.format(new Date(value));
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return dateTimeFormatter.format(new Date(value));
}

export function formatWeekday(value: string | Date): string {
  return weekdayFormatter.format(new Date(value));
}

export function relativeTime(value: string | Date | null | undefined, now = Date.now()): string {
  if (!value) return '—';
  const diff = now - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  if (minutes < 60) return `${Math.round(minutes * 10) / 10} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatQuantity(value: number, unit: string): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${unit}`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

export interface OpeningHour {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  closed: boolean;
}

function parseHm(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}

export interface OpenState {
  open: boolean;
  closesAt: string | null;
  opensAt: string | null;
  nextOpenDay: number | null;
}

/**
 * Evaluates opening hours, including windows that run past midnight
 * (e.g. 18:00 -> 02:00 counts as open at 00:30 on the following day).
 */
export function evaluateOpenState(hours: OpeningHour[], at: Date = new Date()): OpenState {
  if (!hours || hours.length === 0) {
    return { open: true, closesAt: null, opensAt: null, nextOpenDay: null };
  }

  const day = at.getDay();
  const minutes = at.getHours() * 60 + at.getMinutes();
  const byDay = new Map(hours.map((h) => [h.dayOfWeek, h]));

  const today = byDay.get(day);
  if (today && !today.closed) {
    const open = parseHm(today.opensAt);
    const close = parseHm(today.closesAt);
    if (close > open) {
      if (minutes >= open && minutes < close) {
        return { open: true, closesAt: today.closesAt, opensAt: today.opensAt, nextOpenDay: day };
      }
      if (minutes < open) {
        return { open: false, closesAt: null, opensAt: today.opensAt, nextOpenDay: day };
      }
    } else if (minutes >= open) {
      // Window wraps into tomorrow.
      return { open: true, closesAt: today.closesAt, opensAt: today.opensAt, nextOpenDay: day };
    }
  }

  const yesterday = byDay.get((day + 6) % 7);
  if (yesterday && !yesterday.closed) {
    const open = parseHm(yesterday.opensAt);
    const close = parseHm(yesterday.closesAt);
    if (close <= open && minutes < close) {
      return {
        open: true,
        closesAt: yesterday.closesAt,
        opensAt: yesterday.opensAt,
        nextOpenDay: (day + 6) % 7,
      };
    }
  }

  for (let offset = 0; offset < 8; offset += 1) {
    const candidateDay = (day + offset) % 7;
    const candidate = byDay.get(candidateDay);
    if (!candidate || candidate.closed) continue;
    if (offset === 0 && minutes >= parseHm(candidate.opensAt)) continue;
    return { open: false, closesAt: null, opensAt: candidate.opensAt, nextOpenDay: candidateDay };
  }

  return { open: false, closesAt: null, opensAt: null, nextOpenDay: null };
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** mm:ss for short timers, h:mm:ss once an order crosses an hour. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatElapsedShort(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export type UrgencyLevel = 'normal' | 'warning' | 'critical';

/** Kitchen card urgency: neutral, then amber at 75% of target, then red past it. */
export function urgencyFor(elapsedMs: number, targetMinutes: number): UrgencyLevel {
  const targetMs = targetMinutes * 60_000;
  if (elapsedMs >= targetMs) return 'critical';
  if (elapsedMs >= targetMs * 0.75) return 'warning';
  return 'normal';
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function resolveRange(
  range: 'today' | '7d' | '30d' | '90d' | 'custom',
  from?: Date,
  to?: Date,
  now: Date = new Date(),
): { from: Date; to: Date } {
  if (range === 'custom' && from && to) {
    return { from: startOfDay(from), to: endOfDay(to) };
  }
  const end = endOfDay(now);
  switch (range) {
    case '7d':
      return { from: startOfDay(addDays(now, -6)), to: end };
    case '30d':
      return { from: startOfDay(addDays(now, -29)), to: end };
    case '90d':
      return { from: startOfDay(addDays(now, -89)), to: end };
    default:
      return { from: startOfDay(now), to: end };
  }
}

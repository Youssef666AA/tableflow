import { CURRENCY_DECIMALS, DEFAULT_CURRENCY } from './constants.js';

/**
 * Every monetary value in TableFlow is an integer in the currency's minor unit.
 * TND has three decimals, so 49.500 TND is stored as 49500. Never floats.
 */
export function decimalsFor(currency: string = DEFAULT_CURRENCY): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

export function toMinor(amount: number, currency: string = DEFAULT_CURRENCY): number {
  const factor = 10 ** decimalsFor(currency);
  return Math.round(amount * factor);
}

export function toMajor(minor: number, currency: string = DEFAULT_CURRENCY): number {
  const factor = 10 ** decimalsFor(currency);
  return minor / factor;
}

export function formatMoney(minor: number, currency: string = DEFAULT_CURRENCY): string {
  const d = decimalsFor(currency);
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const factor = 10 ** d;
  const whole = Math.floor(abs / factor);
  const frac = String(abs % factor).padStart(d, '0');
  const groupedWhole = whole.toLocaleString('en-US');
  const value = d > 0 ? groupedWhole + '.' + frac : groupedWhole;
  return (negative ? '-' : '') + value + ' ' + currency.toUpperCase();
}

/** Compact form without the currency code, for dense tables and cards. */
export function formatAmount(minor: number, currency: string = DEFAULT_CURRENCY): string {
  const d = decimalsFor(currency);
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const factor = 10 ** d;
  const whole = Math.floor(abs / factor);
  const frac = String(abs % factor).padStart(d, '0');
  const value = d > 0 ? whole.toLocaleString('en-US') + '.' + frac : whole.toLocaleString('en-US');
  return (negative ? '-' : '') + value;
}

/** Applies a basis-point rate (1900 bps = 19%) to a minor-unit amount. */
export function applyRateBps(amountMinor: number, rateBps: number): number {
  return Math.round((amountMinor * rateBps) / 10000);
}

export function percentOf(amountMinor: number, percent: number): number {
  return Math.round((amountMinor * percent) / 100);
}

/** Splits an amount into n parts without losing or inventing minor units. */
export function splitEvenly(totalMinor: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new Error('parts must be a positive integer');
  }
  const sign = totalMinor < 0 ? -1 : 1;
  const abs = Math.abs(Math.round(totalMinor));
  const base = Math.floor(abs / parts);
  let remainder = abs - base * parts;
  const result: number[] = [];
  for (let i = 0; i < parts; i += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    result.push(sign * (base + extra));
  }
  return result;
}

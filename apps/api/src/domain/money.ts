import { CURRENCIES, type CurrencyCode } from './reference.js';

const RATES = new Map(CURRENCIES.map((c) => [c.code, c.usdRate]));

/**
 * Exact USD value, in minor units (cents), of an amount in minor units of `currency`.
 * Unrounded on purpose: aggregates (totals, medians) are computed from exact values
 * and rounded once at the end, so rounding error never accumulates across rows.
 * Throws on unknown currency: silent fallbacks hide data bugs.
 */
export function toUsdExact(amountMinor: number, currency: CurrencyCode | string): number {
  const rate = RATES.get(currency as CurrencyCode);
  if (rate === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return amountMinor * rate;
}

/** USD per major unit of `currency` from the static table (recorded with each salary change). */
export function usdRate(currency: CurrencyCode | string): number {
  const rate = RATES.get(currency as CurrencyCode);
  if (rate === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return rate;
}

/** A single amount in USD cents, rounded once. Use toUsdExact for anything aggregated. */
export function toUsdMinor(amountMinor: number, currency: CurrencyCode | string): number {
  return Math.round(toUsdExact(amountMinor, currency));
}

/** Inverse of toUsdMinor; used by the seed to express USD bands in local currency. */
export function fromUsdMinor(usdMinor: number, currency: CurrencyCode | string): number {
  const rate = RATES.get(currency as CurrencyCode);
  if (rate === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return Math.round(usdMinor / rate);
}

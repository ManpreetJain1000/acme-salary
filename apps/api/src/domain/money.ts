import { CURRENCIES, type CurrencyCode } from './reference.js';

const RATES = new Map(CURRENCIES.map((c) => [c.code, c.usdRate]));

/**
 * Convert an amount in minor units of `currency` to USD minor units (cents).
 * Rounds half away from zero only at the end, so we never accumulate float error
 * across operations. Throws on unknown currency: silent fallbacks hide data bugs.
 */
export function toUsdMinor(amountMinor: number, currency: CurrencyCode | string): number {
  const rate = RATES.get(currency as CurrencyCode);
  if (rate === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return Math.round(amountMinor * rate);
}

/** Inverse of toUsdMinor; used by the seed to express USD bands in local currency. */
export function fromUsdMinor(usdMinor: number, currency: CurrencyCode | string): number {
  const rate = RATES.get(currency as CurrencyCode);
  if (rate === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return Math.round(usdMinor / rate);
}

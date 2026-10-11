import { describe, expect, it } from 'vitest';
import { fromUsdMinor, toUsdExact, toUsdMinor } from './money.js';

describe('toUsdMinor', () => {
  it('is the identity for USD', () => {
    expect(toUsdMinor(123_456, 'USD')).toBe(123_456);
  });

  it('converts using the static rate and returns integer cents', () => {
    // 1,000,000.00 INR * 0.0113 = 11,300.00 USD
    expect(toUsdMinor(100_000_000, 'INR')).toBe(1_130_000);
    const usd = toUsdMinor(333, 'GBP');
    expect(Number.isInteger(usd)).toBe(true);
  });

  it('throws on an unsupported currency rather than guessing', () => {
    expect(() => toUsdMinor(100, 'XYZ')).toThrow(/Unsupported currency/);
  });
});

describe('toUsdExact', () => {
  it('does not round, so sums can be rounded once', () => {
    expect(toUsdExact(50, 'INR')).toBeCloseTo(0.565, 10);
  });
});

describe('fromUsdMinor', () => {
  it('round-trips within one minor unit', () => {
    const eur = fromUsdMinor(10_000_000, 'EUR');
    expect(Math.abs(toUsdMinor(eur, 'EUR') - 10_000_000)).toBeLessThanOrEqual(1);
  });
});

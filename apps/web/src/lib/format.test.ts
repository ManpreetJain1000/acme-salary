import { describe, expect, it } from 'vitest';
import { safeNext, toQueryString } from './api';
import { formatMoney, formatPercent, toMinor } from './format';

describe('formatMoney', () => {
  it('formats minor units in the given currency', () => {
    expect(formatMoney(12_345_600, 'USD')).toBe('$123,456');
    expect(formatMoney(240_000_000, 'INR')).toBe('₹2,400,000');
  });

  it('supports compact notation for dashboards', () => {
    expect(formatMoney(1_250_000_000, 'USD', { compact: true })).toBe('$12.5M');
  });
});

describe('toMinor', () => {
  it('converts major units to integer minor units without float drift', () => {
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor('85000.5')).toBe(8_500_050);
  });

  it('rejects zero, negative and non-numeric input', () => {
    expect(toMinor(0)).toBeNull();
    expect(toMinor(-1)).toBeNull();
    expect(toMinor('abc')).toBeNull();
  });
});

describe('formatPercent', () => {
  it('signs positive deviations when asked', () => {
    expect(formatPercent(0.423, { signed: true })).toBe('+42%');
    expect(formatPercent(-0.5, { signed: true })).toBe('-50%');
  });
});

describe('toQueryString', () => {
  it('drops empty values and encodes the rest', () => {
    expect(toQueryString({ page: 1, search: '', country: undefined, q: 'a b' })).toBe('?page=1&q=a+b');
    expect(toQueryString({})).toBe('');
  });
});

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/insights?country=IN')).toBe('/insights?country=IN');
  });

  it('refuses anything that could leave the site', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'insights', '', null, undefined]) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});

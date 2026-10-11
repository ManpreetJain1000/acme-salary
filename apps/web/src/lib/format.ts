/** Display helpers. Money stays in integer minor units until the moment it is shown. */

const formatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${compact}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: compact ? 1 : 0,
      notation: compact ? 'compact' : 'standard',
    });
    formatters.set(key, f);
  }
  return f;
}

export function formatMoney(minor: number, currency: string, { compact = false } = {}): string {
  return currencyFormatter(currency, compact).format(minor / 100);
}

export const formatUsd = (minor: number, opts?: { compact?: boolean }) => formatMoney(minor, 'USD', opts);

/** Major units typed by a user -> integer minor units. Rejects NaN/negatives. */
export function toMinor(major: number | string): number | null {
  const n = typeof major === 'string' ? Number(major) : major;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export const toMajor = (minor: number) => minor / 100;

export function formatPercent(fraction: number, { signed = false } = {}): string {
  const pct = Math.round(fraction * 100);
  return `${signed && pct > 0 ? '+' : ''}${pct}%`;
}

export const formatCount = (n: number) => new Intl.NumberFormat('en-US').format(n);

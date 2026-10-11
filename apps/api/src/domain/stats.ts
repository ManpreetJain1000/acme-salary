/**
 * Pure statistics helpers. SQLite has no MEDIAN/PERCENTILE, so grouping happens
 * in SQL and these functions do the maths (decisions.md D6).
 */

export interface Distribution {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  mean: number;
}

/**
 * Exact percentile of an ascending-sorted array, using linear interpolation between
 * closest ranks (the same method as Excel's PERCENTILE.INC, which HR already knows).
 */
export function percentileExact(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of empty set');
  if (p < 0 || p > 1) throw new Error('p must be within [0, 1]');
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loVal = sorted[lo]!;
  const hiVal = sorted[hi]!;
  return loVal + (hiVal - loVal) * (rank - lo);
}

/** Percentile rounded once to an integer (minor units). */
export function percentileSorted(sorted: readonly number[], p: number): number {
  return Math.round(percentileExact(sorted, p));
}

/** Exact median of unsorted values, or null for none. */
export function medianExact(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return percentileExact([...values].sort((a, b) => a - b), 0.5);
}

/** Summary distribution, or null for an empty input (no fake zeros). */
export function describe(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    min: sorted[0]!,
    p25: percentileSorted(sorted, 0.25),
    median: percentileSorted(sorted, 0.5),
    p75: percentileSorted(sorted, 0.75),
    max: sorted[sorted.length - 1]!,
    mean: Math.round(sum / sorted.length),
  };
}

/** Signed relative deviation from a reference, e.g. 0.4 = 40% above. */
export function relativeDeviation(value: number, reference: number): number {
  if (reference === 0) throw new Error('reference must be non-zero');
  return (value - reference) / reference;
}

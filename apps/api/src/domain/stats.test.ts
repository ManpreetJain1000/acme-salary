import { describe as suite, expect, it } from 'vitest';
import { describe, medianExact, percentileExact, percentileSorted, relativeDeviation } from './stats.js';

suite('percentileSorted', () => {
  it('returns the only value for a single-element set', () => {
    expect(percentileSorted([42], 0.5)).toBe(42);
  });

  it('returns the middle value as median of an odd-sized set', () => {
    expect(percentileSorted([10, 20, 30], 0.5)).toBe(20);
  });

  it('returns the average of the middle two as median of an even-sized set', () => {
    expect(percentileSorted([10, 20, 30, 40], 0.5)).toBe(25);
  });

  it('interpolates quartiles like Excel PERCENTILE.INC', () => {
    // PERCENTILE.INC({10,20,30,40}, 0.25) = 17.5 -> rounded to 18 (integer minor units)
    expect(percentileSorted([10, 20, 30, 40], 0.25)).toBe(18);
    expect(percentileSorted([10, 20, 30, 40], 0.75)).toBe(33);
  });

  it('returns min and max at p=0 and p=1', () => {
    expect(percentileSorted([5, 7, 9], 0)).toBe(5);
    expect(percentileSorted([5, 7, 9], 1)).toBe(9);
  });

  it('rejects an empty set and out-of-range p', () => {
    expect(() => percentileSorted([], 0.5)).toThrow();
    expect(() => percentileSorted([1], 1.5)).toThrow();
  });
});

suite('describe', () => {
  it('returns null for an empty input instead of fake zeros', () => {
    expect(describe([])).toBeNull();
  });

  it('summarises unsorted input without mutating it', () => {
    const input = [40, 10, 30, 20];
    const result = describe(input);
    expect(result).toEqual({ count: 4, min: 10, p25: 18, median: 25, p75: 33, max: 40, mean: 25 });
    expect(input).toEqual([40, 10, 30, 20]);
  });
});

suite('relativeDeviation', () => {
  it('is positive above the reference and negative below', () => {
    expect(relativeDeviation(150, 100)).toBeCloseTo(0.5);
    expect(relativeDeviation(60, 100)).toBeCloseTo(-0.4);
  });

  it('rejects a zero reference', () => {
    expect(() => relativeDeviation(1, 0)).toThrow();
  });
});

suite('exact helpers', () => {
  it('keeps fractions until the caller rounds', () => {
    expect(percentileExact([10, 20, 30, 40], 0.25)).toBe(17.5);
    expect(medianExact([3, 1, 2, 4])).toBe(2.5);
    expect(medianExact([])).toBeNull();
  });
});

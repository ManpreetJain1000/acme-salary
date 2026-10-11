import { toUsdExact } from '../domain/money.js';
import { countryByCode } from '../domain/reference.js';
import { describe, medianExact, relativeDeviation, type Distribution } from '../domain/stats.js';
import type { EmployeeRepository, SalaryRow } from '../employees/repository.js';
import type { InsightFilter, OutlierQuery } from './schemas.js';

export interface Breakdown {
  key: string;
  label: string;
  headcount: number;
  totalUsdMinor: number;
  medianUsdMinor: number;
}

export interface Summary {
  headcount: number;
  totalPayrollUsdMinor: number;
  medianUsdMinor: number | null;
  byCountry: Breakdown[];
  byDepartment: Breakdown[];
}

export interface PayBand extends Distribution {
  country: string;
  countryName: string;
  jobTitle: string;
  department: string;
  currency: string;
  medianUsdMinor: number;
}

export interface Outlier {
  id: number;
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  department: string;
  country: string;
  currency: string;
  salaryMinor: number;
  groupMedianMinor: number;
  groupSize: number;
  /** Signed relative deviation from the group median, e.g. 0.42 = 42% above. */
  deviation: number;
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** A "pay group" is people doing the same job in the same market and currency. */
const payGroupKey = (r: SalaryRow) => `${r.country}|${r.job_title}|${r.currency}`;

/**
 * Answers "how does the org pay people?". Filtering happens in SQL (repository, indexed);
 * percentiles are computed in pure functions because SQLite has no MEDIAN
 * (decisions.md D6). Reads only the narrow columns needed: ~10k small rows.
 */
export class InsightService {
  constructor(private readonly repo: EmployeeRepository) {}

  summary(filter: InsightFilter): Summary {
    const rows = this.rows(filter);
    // Exact USD per row; every aggregate is rounded once, at the end.
    const usd = rows.map((r) => toUsdExact(r.salary_minor, r.currency));
    const withUsd = rows.map((r, i) => ({ row: r, usd: usd[i]! }));
    const roundedMedian = (values: number[]) => Math.round(medianExact(values)!);

    const breakdown = (keyOf: (r: SalaryRow) => string, labelOf: (k: string) => string) =>
      [...groupBy(withUsd, (x) => keyOf(x.row))]
        .map(([key, items]): Breakdown => {
          const values = items.map((x) => x.usd);
          return {
            key,
            label: labelOf(key),
            headcount: items.length,
            totalUsdMinor: Math.round(sum(values)),
            medianUsdMinor: roundedMedian(values),
          };
        })
        .sort((a, b) => b.totalUsdMinor - a.totalUsdMinor);

    return {
      headcount: rows.length,
      totalPayrollUsdMinor: Math.round(sum(usd)),
      medianUsdMinor: usd.length ? roundedMedian(usd) : null,
      byCountry: breakdown(
        (r) => r.country,
        (k) => countryByCode(k)?.name ?? k,
      ),
      byDepartment: breakdown(
        (r) => r.department,
        (k) => k,
      ),
    };
  }

  payBands(filter: InsightFilter): PayBand[] {
    const groups = groupBy(this.rows(filter), payGroupKey);
    const bands: PayBand[] = [];
    for (const items of groups.values()) {
      const first = items[0]!;
      const local = items.map((r) => r.salary_minor);
      const dist = describe(local)!;
      bands.push({
        country: first.country,
        countryName: countryByCode(first.country)?.name ?? first.country,
        jobTitle: first.job_title,
        department: first.department,
        currency: first.currency,
        ...dist,
        // Convert the exact local median, not the rounded one: round once.
        medianUsdMinor: Math.round(toUsdExact(medianExact(local)!, first.currency)),
      });
    }
    return bands.sort(
      (a, b) => a.country.localeCompare(b.country) || b.medianUsdMinor - a.medianUsdMinor,
    );
  }

  outliers(query: OutlierQuery): { total: number; data: Outlier[] } {
    const groups = groupBy(this.rows(query), payGroupKey);
    const found: Outlier[] = [];
    for (const items of groups.values()) {
      // Tiny groups have no meaningful "normal"; skip them rather than flag noise.
      if (items.length < query.minGroupSize) continue;
      const median = medianExact(items.map((r) => r.salary_minor))!;
      for (const r of items) {
        const deviation = relativeDeviation(r.salary_minor, median);
        if (Math.abs(deviation) >= query.threshold) {
          found.push({
            id: r.id,
            employeeCode: r.employee_code,
            fullName: r.full_name,
            jobTitle: r.job_title,
            department: r.department,
            country: r.country,
            currency: r.currency,
            salaryMinor: r.salary_minor,
            groupMedianMinor: Math.round(median),
            groupSize: items.length,
            deviation: Math.round(deviation * 1000) / 1000,
          });
        }
      }
    }
    found.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation) || a.id - b.id);
    return { total: found.length, data: found.slice(0, query.limit) };
  }

  private rows(filter: InsightFilter): SalaryRow[] {
    return this.repo.salaryRows(filter);
  }
}

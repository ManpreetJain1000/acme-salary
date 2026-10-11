import type { DB } from '../db/database.js';
import { toUsdMinor } from '../domain/money.js';
import { countryByCode } from '../domain/reference.js';
import { describe, relativeDeviation, type Distribution } from '../domain/stats.js';
import type { InsightFilter, OutlierQuery } from './schemas.js';

interface SalaryRow {
  id: number;
  employee_code: string;
  full_name: string;
  job_title: string;
  department: string;
  country: string;
  currency: string;
  salary_minor: number;
}

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
 * Answers "how does the org pay people?". Filtering happens in SQL (indexed);
 * percentiles are computed in pure functions because SQLite has no MEDIAN
 * (decisions.md D6). Reads only the narrow columns needed: ~10k small rows.
 */
export class InsightService {
  constructor(private readonly db: DB) {}

  summary(filter: InsightFilter): Summary {
    const rows = this.rows(filter);
    const usd = rows.map((r) => toUsdMinor(r.salary_minor, r.currency));
    const withUsd = rows.map((r, i) => ({ row: r, usd: usd[i]! }));

    const breakdown = (keyOf: (r: SalaryRow) => string, labelOf: (k: string) => string) =>
      [...groupBy(withUsd, (x) => keyOf(x.row))]
        .map(([key, items]): Breakdown => {
          const values = items.map((x) => x.usd);
          return {
            key,
            label: labelOf(key),
            headcount: items.length,
            totalUsdMinor: values.reduce((a, b) => a + b, 0),
            medianUsdMinor: describe(values)!.median,
          };
        })
        .sort((a, b) => b.totalUsdMinor - a.totalUsdMinor);

    return {
      headcount: rows.length,
      totalPayrollUsdMinor: usd.reduce((a, b) => a + b, 0),
      medianUsdMinor: describe(usd)?.median ?? null,
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
      const dist = describe(items.map((r) => r.salary_minor))!;
      bands.push({
        country: first.country,
        countryName: countryByCode(first.country)?.name ?? first.country,
        jobTitle: first.job_title,
        department: first.department,
        currency: first.currency,
        ...dist,
        medianUsdMinor: toUsdMinor(dist.median, first.currency),
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
      const median = describe(items.map((r) => r.salary_minor))!.median;
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
            groupMedianMinor: median,
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
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (filter.country) {
      where.push('country = @country');
      params.country = filter.country;
    }
    if (filter.department) {
      where.push('department = @department');
      params.department = filter.department;
    }
    if (filter.jobTitle) {
      where.push('job_title = @jobTitle');
      params.jobTitle = filter.jobTitle;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT id, employee_code, full_name, job_title, department, country, currency, salary_minor
         FROM employees ${whereSql}`,
      )
      .all(params) as SalaryRow[];
  }
}

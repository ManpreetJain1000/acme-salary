import { fromUsdMinor } from '../domain/money.js';
import { COUNTRIES, DEPARTMENTS, LEVEL_BANDS_USD } from '../domain/reference.js';
import { formatEmployeeCode, type EmployeeRow, type SalaryHistoryRow } from '../employees/repository.js';
import { emailLocalPart, namePoolFor } from './names.js';
import { createRng, intBetween, pick, weightedPick, type Rng } from './rng.js';

export interface SeedOptions {
  count: number;
  seed: number;
  /** Fixed "today" for the dataset. Never Date.now(): runs must be reproducible. */
  referenceDate: string;
  /** Share of employees deliberately paid far from their band (gives outliers signal). */
  outlierRate: number;
}

export const DEFAULT_SEED_OPTIONS: SeedOptions = {
  count: 10_000,
  seed: 42,
  referenceDate: '2026-01-01',
  outlierRate: 0.01,
};

export interface GeneratedEmployee {
  employee: EmployeeRow;
  history: Omit<SalaryHistoryRow, 'id'>[];
  isOutlier: boolean;
}

const EARLIEST_HIRE = Date.UTC(2012, 0, 1);
const DAY_MS = 86_400_000;
/** Real salaries are agreed in round numbers: round to 100 major units (10,000 minor). */
const ROUND_TO_MINOR = 10_000;

const roundSalary = (minor: number) =>
  Math.max(ROUND_TO_MINOR, Math.round(minor / ROUND_TO_MINOR) * ROUND_TO_MINOR);

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Triangular-ish sample in [0,1): clusters around the middle of the band like real pay. */
const centred = (rng: Rng) => (rng() + rng()) / 2;

export function generateEmployees(options: SeedOptions = DEFAULT_SEED_OPTIONS): GeneratedEmployee[] {
  const rng = createRng(options.seed);
  const referenceMs = Date.parse(`${options.referenceDate}T00:00:00Z`);
  const createdAt = new Date(referenceMs).toISOString();
  const result: GeneratedEmployee[] = [];

  for (let i = 1; i <= options.count; i++) {
    const country = weightedPick(rng, COUNTRIES, (c) => c.headcountWeight);
    const department = weightedPick(rng, DEPARTMENTS, (d) => d.headcountWeight);
    const role = pick(rng, department.titles);
    const names = namePoolFor(country.code);
    const first = pick(rng, names.first);
    const last = pick(rng, names.last);

    const band = LEVEL_BANDS_USD[role.level];
    let usdMajor = (band.min + (band.max - band.min) * centred(rng)) * country.payMultiplier;
    const isOutlier = rng() < options.outlierRate;
    if (isOutlier) usdMajor *= pick(rng, [0.5, 1.8]);
    const salaryMinor = roundSalary(fromUsdMinor(Math.round(usdMajor * 100), country.currency));

    const hireMs = EARLIEST_HIRE + intBetween(rng, 0, Math.floor((referenceMs - EARLIEST_HIRE) / DAY_MS) - 1) * DAY_MS;
    const hireDate = isoDay(hireMs);

    // ~35% of people hired 1+ year ago have had a raise: initial -> current salary.
    const history: GeneratedEmployee['history'] = [];
    const tenureDays = Math.floor((referenceMs - hireMs) / DAY_MS);
    if (tenureDays > 365 && rng() < 0.35) {
      const raise = 0.03 + rng() * 0.09; // 3-12%
      const initial = roundSalary(salaryMinor / (1 + raise));
      const raiseMs = hireMs + intBetween(rng, 365, tenureDays) * DAY_MS;
      history.push(
        { employee_id: i, old_salary_minor: null, new_salary_minor: initial, old_currency: null, new_currency: country.currency, changed_at: `${hireDate}T00:00:00.000Z` },
        { employee_id: i, old_salary_minor: initial, new_salary_minor: salaryMinor, old_currency: country.currency, new_currency: country.currency, changed_at: new Date(raiseMs).toISOString() },
      );
    } else {
      history.push({ employee_id: i, old_salary_minor: null, new_salary_minor: salaryMinor, old_currency: null, new_currency: country.currency, changed_at: `${hireDate}T00:00:00.000Z` });
    }

    result.push({
      employee: {
        id: i,
        employee_code: formatEmployeeCode(i),
        full_name: `${first} ${last}`,
        // The numeric suffix guarantees uniqueness even when names repeat.
        email: `${emailLocalPart(first, last)}.${i}@acme.example`,
        job_title: role.title,
        department: department.name,
        country: country.code,
        currency: country.currency,
        salary_minor: salaryMinor,
        hire_date: hireDate,
        version: 1,
        status: 'active',
        terminated_at: null,
        created_at: createdAt,
        updated_at: createdAt,
      },
      history,
      isOutlier,
    });
  }
  return result;
}

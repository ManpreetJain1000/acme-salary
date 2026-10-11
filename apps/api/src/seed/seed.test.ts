import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { toUsdMinor } from '../domain/money.js';
import { COUNTRIES, DEPARTMENTS, LEVEL_BANDS_USD } from '../domain/reference.js';
import { DEFAULT_SEED_OPTIONS, generateEmployees } from './generator.js';
import { seedDatabase } from './seed.js';

const small = { ...DEFAULT_SEED_OPTIONS, count: 500 };

describe('generateEmployees', () => {
  it('is deterministic for the same seed', () => {
    expect(generateEmployees(small)).toEqual(generateEmployees(small));
  });

  it('produces different data for a different seed', () => {
    const a = generateEmployees(small);
    const b = generateEmployees({ ...small, seed: 7 });
    expect(a.map((g) => g.employee.email)).not.toEqual(b.map((g) => g.employee.email));
  });

  it('generates unique emails and codes', () => {
    const rows = generateEmployees(small).map((g) => g.employee);
    expect(new Set(rows.map((r) => r.email)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.employee_code)).size).toBe(rows.length);
  });

  it('keeps non-outlier salaries within the country-adjusted band (plus rounding)', () => {
    const levelOf = new Map(DEPARTMENTS.flatMap((d) => d.titles.map((t) => [t.title, t.level] as const)));
    const countryOf = new Map(COUNTRIES.map((c) => [c.code, c]));
    // Rounding to 100 major units in local currency can move the USD value slightly.
    const tolerance = 0.02;

    for (const { employee, isOutlier } of generateEmployees(small)) {
      if (isOutlier) continue;
      const band = LEVEL_BANDS_USD[levelOf.get(employee.job_title)!];
      const m = countryOf.get(employee.country)!.payMultiplier;
      const usd = toUsdMinor(employee.salary_minor, employee.currency) / 100;
      expect(usd).toBeGreaterThanOrEqual(band.min * m * (1 - tolerance));
      expect(usd).toBeLessThanOrEqual(band.max * m * (1 + tolerance));
    }
  });

  it('pays each employee in their country currency with a hire date before the reference date', () => {
    const currencyOf = new Map(COUNTRIES.map((c) => [c.code, c.currency]));
    for (const { employee } of generateEmployees(small)) {
      expect(employee.currency).toBe(currencyOf.get(employee.country));
      expect(employee.hire_date < small.referenceDate).toBe(true);
    }
  });

  it('ends every salary history at the current salary', () => {
    for (const { employee, history } of generateEmployees(small)) {
      expect(history.at(-1)!.new_salary_minor).toBe(employee.salary_minor);
      expect(history[0]!.old_salary_minor).toBeNull();
    }
  });
});

describe('seedDatabase', () => {
  it('seeds 10,000 employees by default', () => {
    const db = openDatabase(':memory:');
    const result = seedDatabase(db);
    expect(result).toMatchObject({ status: 'seeded', employees: 10_000 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM employees').get()).toEqual({ n: 10_000 });
  });

  it('is idempotent: a second run skips instead of duplicating', () => {
    const db = openDatabase(':memory:');
    seedDatabase(db, { count: 50 });
    const second = seedDatabase(db, { count: 50 });
    expect(second.status).toBe('skipped');
    expect(db.prepare('SELECT COUNT(*) AS n FROM employees').get()).toEqual({ n: 50 });
  });

  it('reseeds from scratch with reset', () => {
    const db = openDatabase(':memory:');
    seedDatabase(db, { count: 50 });
    const result = seedDatabase(db, { count: 20, reset: true });
    expect(result.status).toBe('seeded');
    expect(db.prepare('SELECT COUNT(*) AS n FROM employees').get()).toEqual({ n: 20 });
  });

  it('keeps search working for seeded and later-added employees', () => {
    const db = openDatabase(':memory:');
    seedDatabase(db, { count: 200 });
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'employees_fts_insert'").all();
    expect(triggers).toHaveLength(1); // restored after the bulk load
    const someone = db.prepare('SELECT full_name FROM employees WHERE id = 50').get() as { full_name: string };
    const hits = db
      .prepare('SELECT rowid FROM employees_fts WHERE employees_fts MATCH ?')
      .all(`"${someone.full_name}"`) as { rowid: number }[];
    expect(hits.map((h) => h.rowid)).toContain(50);
  });

  it('restores the search trigger when the seed fails', () => {
    const db = openDatabase(':memory:');
    db.exec(`CREATE TRIGGER fail_midway BEFORE INSERT ON employees WHEN NEW.id = 25
             BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    expect(() => seedDatabase(db, { count: 50 })).toThrow(/boom/);
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE name = 'employees_fts_insert'").all();
    expect(triggers).toHaveLength(1);
  });

  it('is atomic: a failure mid-seed leaves the database empty', () => {
    const db = openDatabase(':memory:');
    // Force a failure on the 25th insert to prove the transaction rolls everything back.
    db.exec(`CREATE TRIGGER fail_midway BEFORE INSERT ON employees WHEN NEW.id = 25
             BEGIN SELECT RAISE(ABORT, 'boom'); END;`);
    expect(() => seedDatabase(db, { count: 50 })).toThrow(/boom/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM employees').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM salary_history').get()).toEqual({ n: 0 });
  });
});

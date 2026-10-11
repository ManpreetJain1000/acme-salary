import { dropAllTables, migrate, type DB } from '../db/database.js';
import { DEFAULT_SEED_OPTIONS, generateEmployees, type SeedOptions } from './generator.js';

export interface SeedResult {
  status: 'seeded' | 'skipped';
  employees: number;
  historyRows: number;
  durationMs: number;
}

/**
 * Seed the database atomically and idempotently (decisions.md D8).
 *
 * - One `BEGIN IMMEDIATE` transaction: takes the write lock up front, so either
 *   all rows land or none do. Readers (WAL) keep seeing the old state until COMMIT.
 * - The emptiness check runs *inside* that transaction, so two processes booting
 *   at once cannot both seed: the second waits for the lock, then sees data and skips.
 * - Prepared statements reused for every row: 10k inserts take well under a second.
 */
export function seedDatabase(
  db: DB,
  { reset = false, ...overrides }: Partial<SeedOptions> & { reset?: boolean } = {},
): SeedResult {
  const options = { ...DEFAULT_SEED_OPTIONS, ...overrides };
  const started = performance.now();

  const insertEmployee = db.prepare(
    `INSERT INTO employees
       (id, employee_code, full_name, email, job_title, department, country, currency,
        salary_minor, hire_date, created_at, updated_at)
     VALUES
       (@id, @employee_code, @full_name, @email, @job_title, @department, @country, @currency,
        @salary_minor, @hire_date, @created_at, @updated_at)`,
  );
  const insertHistory = db.prepare(
    `INSERT INTO salary_history
       (employee_id, old_salary_minor, new_salary_minor, old_currency, new_currency,
        changed_at, changed_by, usd_rate)
     VALUES
       (@employee_id, @old_salary_minor, @new_salary_minor, @old_currency, @new_currency,
        @changed_at, @changed_by, @usd_rate)`,
  );

  const run = db.transaction((): Omit<SeedResult, 'durationMs'> => {
    if (reset) {
      // History is append-only and employees can't be deleted (migration 3), so a
      // reset rebuilds the schema instead.
      dropAllTables(db);
      migrate(db);
    }
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM employees').get() as { n: number };
    if (n > 0) return { status: 'skipped', employees: n, historyRows: 0 };

    // Bulk load: indexing search one row at a time made 100k rows take ~60 s.
    // Set the per-row search trigger aside, load, rebuild the index in one pass,
    // then restore the trigger exactly as the schema defines it. DDL is
    // transactional in SQLite, so a failure anywhere restores the trigger too.
    const { sql: ftsTrigger } = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'employees_fts_insert'")
      .get() as { sql: string };
    db.exec('DROP TRIGGER employees_fts_insert');

    let historyRows = 0;
    for (const { employee, history } of generateEmployees(options)) {
      insertEmployee.run(employee);
      for (const h of history) {
        insertHistory.run(h);
        historyRows++;
      }
    }

    // One set-based statement for every "hired" event.
    db.exec(`INSERT INTO employment_events (employee_id, event, effective_date, recorded_at, recorded_by)
             SELECT id, 'hired', hire_date, created_at, 'seed' FROM employees`);
    db.exec("INSERT INTO employees_fts (employees_fts) VALUES ('rebuild')");
    db.exec(ftsTrigger);
    return { status: 'seeded', employees: options.count, historyRows };
  });

  const result = run.immediate();
  // Bulk load changes the data's shape completely: refresh planner statistics,
  // in full (a sampled ANALYZE misled the planner; the full one takes ~150 ms at 100k).
  if (result.status === 'seeded') {
    db.pragma('analysis_limit = 0');
    db.exec('ANALYZE');
  }
  return { ...result, durationMs: Math.round(performance.now() - started) };
}

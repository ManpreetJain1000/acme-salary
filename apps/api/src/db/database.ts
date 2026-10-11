import Database from 'better-sqlite3';

export type DB = Database.Database;

/**
 * Open a SQLite database with production-sane pragmas and bring its schema up to date.
 * Pass ':memory:' for tests: every test gets an isolated, fast database.
 */
export function openDatabase(filename: string): DB {
  const db = new Database(filename);
  if (filename !== ':memory:') {
    // WAL lets readers proceed while a writer (e.g. the seed) holds the write lock.
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');
  // Wait briefly instead of failing immediately when another connection is writing.
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

/**
 * Ordered, append-only schema migrations. The database's `user_version` records how
 * many have run, so an existing file is upgraded in place and never re-created.
 * Never edit a released migration; add a new one.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: initial schema. IF NOT EXISTS so files created before versioning upgrade cleanly.
  `
  CREATE TABLE IF NOT EXISTS employees (
    id            INTEGER PRIMARY KEY AUTOINCREMENT, -- never reuse ids/codes
    employee_code TEXT    NOT NULL UNIQUE,
    full_name     TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    job_title     TEXT    NOT NULL,
    department    TEXT    NOT NULL,
    country       TEXT    NOT NULL,
    currency      TEXT    NOT NULL,
    salary_minor  INTEGER NOT NULL CHECK (salary_minor > 0),
    hire_date     TEXT    NOT NULL,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
  );

  -- Filter columns, plus the composite used by pay-band and outlier queries.
  CREATE INDEX IF NOT EXISTS idx_employees_country       ON employees(country);
  CREATE INDEX IF NOT EXISTS idx_employees_department    ON employees(department);
  CREATE INDEX IF NOT EXISTS idx_employees_job_title     ON employees(job_title);
  CREATE INDEX IF NOT EXISTS idx_employees_country_title ON employees(country, job_title, salary_minor);
  CREATE INDEX IF NOT EXISTS idx_employees_full_name     ON employees(full_name);

  -- Audit trail of salary changes (append-only from migration 3).
  CREATE TABLE IF NOT EXISTS salary_history (
    id                 INTEGER PRIMARY KEY,
    employee_id        INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    old_salary_minor   INTEGER,
    new_salary_minor   INTEGER NOT NULL,
    old_currency       TEXT,
    new_currency       TEXT    NOT NULL,
    changed_at         TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_salary_history_employee ON salary_history(employee_id, changed_at);
  `,

  // 2: employees who leave are terminated, not deleted (decisions.md D5).
  `
  ALTER TABLE employees ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'terminated'));
  ALTER TABLE employees ADD COLUMN terminated_at TEXT;
  CREATE INDEX idx_employees_status ON employees(status);
  `,

  // 3: enforce the audit trail in the database, not just by convention (D5).
  // Any UPDATE/DELETE of history, or DELETE of an employee (which would cascade
  // into history), is rejected however the database is reached.
  `
  CREATE TRIGGER salary_history_append_only_update BEFORE UPDATE ON salary_history
  BEGIN SELECT RAISE(ABORT, 'salary_history is append-only'); END;
  CREATE TRIGGER salary_history_append_only_delete BEFORE DELETE ON salary_history
  BEGIN SELECT RAISE(ABORT, 'salary_history is append-only'); END;
  CREATE TRIGGER employees_no_delete BEFORE DELETE ON employees
  BEGIN SELECT RAISE(ABORT, 'employees are terminated, not deleted'); END;
  `,
];

export function schemaVersion(db: DB): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/** Apply every migration newer than the file's user_version, each atomically. */
export function migrate(db: DB): void {
  MIGRATIONS.forEach((sql, index) => {
    const version = index + 1;
    db.transaction(() => {
      // Re-check inside the write transaction: another process may have just migrated.
      if (schemaVersion(db) >= version) return;
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    }).immediate();
  });
}

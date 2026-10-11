import Database from 'better-sqlite3';

export type DB = Database.Database;

/**
 * Open a SQLite database with production-sane pragmas.
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

/** Idempotent schema creation. A real system would use versioned migrations. */
export function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id            INTEGER PRIMARY KEY AUTOINCREMENT, -- never reuse ids/codes of deleted employees
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

    -- Immutable audit trail of salary changes.
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
  `);
}

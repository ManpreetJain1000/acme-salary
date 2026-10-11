import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate, openDatabase, SALARY_USD_SQL, schemaVersion } from './database.js';

describe('migrations', () => {
  it('brings a new database to the latest version', () => {
    const db = openDatabase(':memory:');
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it('is idempotent: running again changes nothing', () => {
    const db = openDatabase(':memory:');
    expect(() => migrate(db)).not.toThrow();
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it('upgrades a pre-versioning database in place, keeping its rows', () => {
    // A file created by the original CREATE TABLE IF NOT EXISTS schema: user_version 0.
    const db = new Database(':memory:');
    db.exec(MIGRATIONS[0]!);
    db.prepare(
      `INSERT INTO employees (employee_code, full_name, email, job_title, department, country,
         currency, salary_minor, hire_date, created_at, updated_at)
       VALUES ('EMP-000001', 'Old Row', 'old@acme.example', 'Recruiter', 'People', 'US', 'USD',
         100, '2020-01-01', '2020-01-01', '2020-01-01')`,
    ).run();
    expect(schemaVersion(db)).toBe(0);

    migrate(db);

    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT full_name, status, terminated_at FROM employees').get()).toEqual({
      full_name: 'Old Row',
      status: 'active',
      terminated_at: null,
    });
  });
});

describe('audit trail is enforced by the database (migration 3)', () => {
  function withEmployee() {
    const db = openDatabase(':memory:');
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO employees (employee_code, full_name, email, job_title, department, country,
           currency, salary_minor, hire_date, created_at, updated_at)
         VALUES ('EMP-000001', 'A', 'a@acme.example', 'Recruiter', 'People', 'US', 'USD',
           100, '2020-01-01', '2020-01-01', '2020-01-01')`,
      )
      .run();
    db.prepare(
      `INSERT INTO salary_history (employee_id, new_salary_minor, new_currency, changed_at)
       VALUES (?, 100, 'USD', '2020-01-01')`,
    ).run(lastInsertRowid);
    return db;
  }

  it('rejects editing salary history', () => {
    expect(() => withEmployee().exec('UPDATE salary_history SET new_salary_minor = 1')).toThrow(/append-only/);
  });

  it('rejects deleting salary history', () => {
    expect(() => withEmployee().exec('DELETE FROM salary_history')).toThrow(/append-only/);
  });

  it('rejects deleting an employee, which would cascade into history', () => {
    const db = withEmployee();
    expect(() => db.exec('DELETE FROM employees')).toThrow(/terminated, not deleted/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM salary_history').get()).toEqual({ n: 1 });
  });
});

describe('salary-sort index stays in step with the FX rates', () => {
  it('was built on the same expression the repository sorts by', () => {
    // If this fails, FX rates changed: add a migration that drops and recreates
    // idx_employees_status_salary_usd. Sorting stays correct meanwhile, just unindexed.
    const db = openDatabase(':memory:');
    const { sql } = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_employees_status_salary_usd'")
      .get() as { sql: string };
    expect(sql).toContain(SALARY_USD_SQL);
  });
});

describe('audit trail (migration 9)', () => {
  it('makes employment events append-only', () => {
    const db = openDatabase(':memory:');
    db.exec(`INSERT INTO employees (employee_code, full_name, email, job_title, department, country,
               currency, salary_minor, hire_date, created_at, updated_at)
             VALUES ('EMP-000001', 'A', 'a@acme.example', 'Recruiter', 'People', 'US', 'USD',
               100, '2020-01-01', '2020-01-01', '2020-01-01');
             INSERT INTO employment_events (employee_id, event, effective_date, recorded_at)
             VALUES (1, 'hired', '2020-01-01', '2020-01-01');`);
    expect(() => db.exec("UPDATE employment_events SET event = 'terminated'")).toThrow(/append-only/);
    expect(() => db.exec('DELETE FROM employment_events')).toThrow(/append-only/);
  });

  it('backfills hired and terminated events for existing employees', () => {
    const db = new Database(':memory:');
    MIGRATIONS.slice(0, 8).forEach((sql) => db.exec(sql));
    db.pragma('user_version = 8');
    db.exec(`INSERT INTO employees (employee_code, full_name, email, job_title, department, country,
               currency, salary_minor, hire_date, status, terminated_at, created_at, updated_at)
             VALUES ('EMP-000001', 'Left Already', 'l@acme.example', 'Recruiter', 'People', 'US', 'USD',
               100, '2020-01-01', 'terminated', '2025-06-30', '2020-01-01', '2025-06-30T10:00:00Z')`);
    migrate(db);
    expect(db.prepare('SELECT event, effective_date FROM employment_events ORDER BY id').all()).toEqual([
      { event: 'hired', effective_date: '2020-01-01' },
      { event: 'terminated', effective_date: '2025-06-30' },
    ]);
  });
});

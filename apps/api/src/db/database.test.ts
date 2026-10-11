import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate, openDatabase, schemaVersion } from './database.js';

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

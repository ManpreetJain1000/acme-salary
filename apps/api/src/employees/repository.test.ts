import { describe, expect, it } from 'vitest';
import { openDatabase, SALARY_USD_SQL } from '../db/database.js';
import { seedDatabase } from '../seed/seed.js';
import { EmployeeRepository, ftsPhrase } from './repository.js';
import { EmployeeService } from './service.js';
import { listQuerySchema } from './schemas.js';
import { employeeInput } from '../test-utils.js';

const q = (o: Record<string, unknown>) => listQuerySchema.parse(o);

function setup() {
  const db = openDatabase(':memory:');
  const repo = new EmployeeRepository(db);
  return { db, repo, service: new EmployeeService(repo) };
}

describe('search (FTS5 trigram index)', () => {
  it('finds substrings in names, emails and codes, case-insensitively', () => {
    const { repo, service } = setup();
    service.create(employeeInput({ fullName: 'Priya Sharma', email: 'priya.s@acme.example' }));
    service.create(employeeInput({ fullName: 'Ben Carter' }));
    const names = (search: string) => repo.list(q({ search })).rows.map((r) => r.full_name);
    expect(names('HARM')).toEqual(['Priya Sharma']);
    expect(names('priya.s@')).toEqual(['Priya Sharma']);
    expect(names('EMP-000002')).toEqual(['Ben Carter']);
  });

  it('ignores accents, so "muller" finds "Müller"', () => {
    const { repo, service } = setup();
    service.create(employeeInput({ fullName: 'Lena Müller' }));
    expect(repo.list(q({ search: 'muller' })).total).toBe(1);
  });

  it('stays in sync when a name changes', () => {
    const { repo, service } = setup();
    const e = service.create(employeeInput({ fullName: 'Old Name' }));
    service.update(e.id, { fullName: 'New Person' });
    expect(repo.list(q({ search: 'Old Name' })).total).toBe(0);
    expect(repo.list(q({ search: 'New Pers' })).total).toBe(1);
  });

  it('treats FTS operators in the term literally', () => {
    const { repo, service } = setup();
    service.create(employeeInput({ fullName: 'Ana Silva' }));
    expect(ftsPhrase('a "b" OR c*')).toBe('"a ""b"" OR c*"');
    expect(() => repo.list(q({ search: 'silva" OR *' }))).not.toThrow();
    expect(repo.list(q({ search: 'silva" OR *' })).total).toBe(0);
  });

  it('falls back to LIKE for terms shorter than 3 characters', () => {
    const { repo, service } = setup();
    service.create(employeeInput({ fullName: 'Bo Li' }));
    expect(repo.list(q({ search: 'Li' })).total).toBe(1);
  });
});

describe('query plans at scale (guards against silent full scans)', () => {
  const { db, repo } = (() => {
    const db = openDatabase(':memory:');
    seedDatabase(db, { count: 2_000 });
    return { db, repo: new EmployeeRepository(db) };
  })();
  const planOf = (sql: string) =>
    (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');

  it('serves the salary sort from the expression index, in both directions', () => {
    for (const dir of ['ASC', 'DESC']) {
      const plan = planOf(
        `SELECT * FROM employees WHERE status = 'active' ORDER BY ${SALARY_USD_SQL} ${dir}, id ${dir} LIMIT 25`,
      );
      expect(plan).toContain('idx_employees_status_salary_usd');
      expect(plan).not.toContain('TEMP B-TREE');
    }
  });

  it('salary sort returns the highest USD earner first', () => {
    const top = repo.list(q({ sortBy: 'salary', sortDir: 'desc', pageSize: 2 })).rows;
    const usd = (r: (typeof top)[number]) =>
      (db.prepare(`SELECT ${SALARY_USD_SQL} AS v FROM employees WHERE id = ?`).get(r.id) as { v: number }).v;
    expect(usd(top[0]!)).toBeGreaterThanOrEqual(usd(top[1]!));
  });

  it('uses the country index for country filters once statistics exist', () => {
    const plan = planOf("SELECT COUNT(*) FROM employees WHERE status = 'active' AND country = 'DE'");
    expect(plan).toContain('idx_employees_country');
  });

  it('serves search from the full-text index', () => {
    const plan = planOf(
      `SELECT * FROM employees WHERE status = 'active'
       AND id IN (SELECT rowid FROM employees_fts WHERE employees_fts MATCH '"sharma"')`,
    );
    expect(plan).toMatch(/VIRTUAL TABLE INDEX/);
  });
});

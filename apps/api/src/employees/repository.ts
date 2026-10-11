import type { DB } from '../db/database.js';
import { CURRENCIES } from '../domain/reference.js';
import type { ListQuery, SortField } from './schemas.js';

/** Row shape as stored. Only this module knows column names. */
export interface EmployeeRow {
  id: number;
  employee_code: string;
  full_name: string;
  email: string;
  job_title: string;
  department: string;
  country: string;
  currency: string;
  salary_minor: number;
  hire_date: string;
  status: EmployeeStatus;
  terminated_at: string | null;
  created_at: string;
  updated_at: string;
}

export type EmployeeStatus = 'active' | 'terminated';

export interface SalaryHistoryRow {
  id: number;
  employee_id: number;
  old_salary_minor: number | null;
  new_salary_minor: number;
  old_currency: string | null;
  new_currency: string;
  changed_at: string;
}

export type NewEmployeeRow = Omit<EmployeeRow, 'id' | 'status' | 'terminated_at'>;

/** Narrow row for statistics: only what pay groups and outliers need. */
export interface SalaryRow {
  id: number;
  employee_code: string;
  full_name: string;
  job_title: string;
  department: string;
  country: string;
  currency: string;
  salary_minor: number;
}

export interface EmployeeFilter {
  country?: string;
  department?: string;
  jobTitle?: string;
}

/**
 * USD-equivalent salary as a SQL expression, built only from the static FX table
 * (trusted constants, never user input). Sorting by raw salary_minor would rank
 * INR 2,000,000 (~$22.6k) above USD 150,000, which is meaningless across currencies.
 */
export const SALARY_USD_SQL = `(salary_minor * CASE currency ${CURRENCIES.map(
  (c) => `WHEN '${c.code}' THEN ${c.usdRate}`,
).join(' ')} END)`;

/** Sort key (validated by schemas.ts) -> SQL. User input never reaches ORDER BY. */
const SORT_SQL: Record<SortField, string> = {
  fullName: 'full_name',
  employeeCode: 'employee_code',
  jobTitle: 'job_title',
  department: 'department',
  country: 'country',
  salary: SALARY_USD_SQL,
  hireDate: 'hire_date',
};

function filterSql(filter: EmployeeFilter, where: string[], params: Record<string, unknown>) {
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
}

/** Escape LIKE wildcards so a search for "50%" is literal. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function formatEmployeeCode(n: number): string {
  return `EMP-${String(n).padStart(6, '0')}`;
}

/**
 * The only module that knows SQL or the database library (decisions.md D2).
 * Services express *what* must be atomic via transaction(); this decides *how*.
 */
export class EmployeeRepository {
  constructor(private readonly db: DB) {}

  /** Changes whenever any employee row is written, by any connection (migration 5). */
  dataVersion(): number {
    return (
      this.db.prepare("SELECT value FROM app_meta WHERE key = 'data_version'").get() as { value: number }
    ).value;
  }

  /** Run fn atomically, taking the write lock up front (BEGIN IMMEDIATE). */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }

  findById(id: number): EmployeeRow | undefined {
    return this.db.prepare('SELECT * FROM employees WHERE id = ?').get(id) as
      | EmployeeRow
      | undefined;
  }

  findByEmail(email: string): EmployeeRow | undefined {
    return this.db.prepare('SELECT * FROM employees WHERE email = ?').get(email) as
      | EmployeeRow
      | undefined;
  }

  /**
   * Next human-facing code. Reads AUTOINCREMENT's high-water mark rather than
   * MAX(id), so a code is never handed to someone else even if rows are ever removed.
   * Must be called inside the write transaction that performs the insert.
   */
  nextEmployeeCode(): string {
    const row = this.db
      .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'employees'")
      .get() as { seq: number } | undefined;
    return formatEmployeeCode((row?.seq ?? 0) + 1);
  }

  insert(row: NewEmployeeRow): number {
    const result = this.db
      .prepare(
        `INSERT INTO employees
          (employee_code, full_name, email, job_title, department, country, currency,
           salary_minor, hire_date, created_at, updated_at)
         VALUES
          (@employee_code, @full_name, @email, @job_title, @department, @country, @currency,
           @salary_minor, @hire_date, @created_at, @updated_at)`,
      )
      .run(row);
    return Number(result.lastInsertRowid);
  }

  update(
    id: number,
    row: Omit<EmployeeRow, 'id' | 'employee_code' | 'created_at' | 'status' | 'terminated_at'>,
  ): void {
    this.db
      .prepare(
        `UPDATE employees SET
           full_name = @full_name, email = @email, job_title = @job_title,
           department = @department, country = @country, currency = @currency,
           salary_minor = @salary_minor, hire_date = @hire_date, updated_at = @updated_at
         WHERE id = @id`,
      )
      .run({ ...row, id });
  }

  setStatus(id: number, status: EmployeeStatus, terminatedAt: string | null, updatedAt: string): void {
    this.db
      .prepare(
        'UPDATE employees SET status = ?, terminated_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(status, terminatedAt, updatedAt, id);
  }

  insertSalaryHistory(row: Omit<SalaryHistoryRow, 'id'>): void {
    this.db
      .prepare(
        `INSERT INTO salary_history
           (employee_id, old_salary_minor, new_salary_minor, old_currency, new_currency, changed_at)
         VALUES
           (@employee_id, @old_salary_minor, @new_salary_minor, @old_currency, @new_currency, @changed_at)`,
      )
      .run(row);
  }

  salaryHistory(employeeId: number): SalaryHistoryRow[] {
    return this.db
      .prepare(
        'SELECT * FROM salary_history WHERE employee_id = ? ORDER BY changed_at DESC, id DESC',
      )
      .all(employeeId) as SalaryHistoryRow[];
  }

  list(query: ListQuery): { rows: EmployeeRow[]; total: number } {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (query.search) {
      where.push(
        `(full_name LIKE @search ESCAPE '\\' OR email LIKE @search ESCAPE '\\' OR employee_code LIKE @search ESCAPE '\\')`,
      );
      params.search = `%${escapeLike(query.search)}%`;
    }
    filterSql(query, where, params);
    if (query.status !== 'all') {
      where.push('status = @status');
      params.status = query.status;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // Both values come from allow-lists, never from raw input.
    const column = SORT_SQL[query.sortBy];
    const direction = query.sortDir === 'desc' ? 'DESC' : 'ASC';

    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM employees ${whereSql}`)
      .get(params) as { total: number };

    const rows = this.db
      .prepare(
        `SELECT * FROM employees ${whereSql}
         ORDER BY ${column} ${direction}, id ASC
         LIMIT @limit OFFSET @offset`,
      )
      .all({
        ...params,
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }) as EmployeeRow[];

    return { rows, total };
  }

  /** Current workforce only: former employees don't count towards how we pay people. */
  salaryRows(filter: EmployeeFilter): SalaryRow[] {
    const where: string[] = ["status = 'active'"];
    const params: Record<string, unknown> = {};
    filterSql(filter, where, params);
    const whereSql = `WHERE ${where.join(' AND ')}`;
    return this.db
      .prepare(
        `SELECT id, employee_code, full_name, job_title, department, country, currency, salary_minor
         FROM employees ${whereSql}`,
      )
      .all(params) as SalaryRow[];
  }
}

import type { DB } from '../db/database.js';
import { toUsdMinor } from '../domain/money.js';
import { conflict, notFound } from '../http/errors.js';
import {
  EmployeeRepository,
  type EmployeeRow,
  type SalaryHistoryRow,
} from './repository.js';
import type { EmployeeInput, EmployeeUpdate, ListQuery } from './schemas.js';

export interface Employee {
  id: number;
  employeeCode: string;
  fullName: string;
  email: string;
  jobTitle: string;
  department: string;
  country: string;
  currency: string;
  salaryMinor: number;
  salaryUsdMinor: number;
  hireDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryChange {
  oldSalaryMinor: number | null;
  newSalaryMinor: number;
  oldCurrency: string | null;
  newCurrency: string;
  changedAt: string;
}

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

export function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    employeeCode: row.employee_code,
    fullName: row.full_name,
    email: row.email,
    jobTitle: row.job_title,
    department: row.department,
    country: row.country,
    currency: row.currency,
    salaryMinor: row.salary_minor,
    salaryUsdMinor: toUsdMinor(row.salary_minor, row.currency),
    hireDate: row.hire_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSalaryChange(row: SalaryHistoryRow): SalaryChange {
  return {
    oldSalaryMinor: row.old_salary_minor,
    newSalaryMinor: row.new_salary_minor,
    oldCurrency: row.old_currency,
    newCurrency: row.new_currency,
    changedAt: row.changed_at,
  };
}

/**
 * Business rules for employees. Every write that touches salary also writes the
 * audit row in the same transaction, so history can never drift from reality.
 */
export class EmployeeService {
  private readonly repo: EmployeeRepository;

  constructor(
    private readonly db: DB,
    private readonly now: Clock = systemClock,
  ) {
    this.repo = new EmployeeRepository(db);
  }

  list(query: ListQuery): Page<Employee> {
    const { rows, total } = this.repo.list(query);
    return {
      data: rows.map(toEmployee),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  get(id: number): Employee & { salaryHistory: SalaryChange[] } {
    const row = this.repo.findById(id);
    if (!row) throw notFound('Employee');
    return { ...toEmployee(row), salaryHistory: this.repo.salaryHistory(id).map(toSalaryChange) };
  }

  create(input: EmployeeInput): Employee {
    return this.db.transaction(() => {
      this.assertEmailAvailable(input.email);
      const ts = this.now();
      const id = this.repo.insert({
        employee_code: this.repo.nextEmployeeCode(),
        full_name: input.fullName,
        email: input.email,
        job_title: input.jobTitle,
        department: input.department,
        country: input.country,
        currency: input.currency,
        salary_minor: input.salaryMinor,
        hire_date: input.hireDate,
        created_at: ts,
        updated_at: ts,
      });
      this.repo.insertSalaryHistory({
        employee_id: id,
        old_salary_minor: null,
        new_salary_minor: input.salaryMinor,
        old_currency: null,
        new_currency: input.currency,
        changed_at: ts,
      });
      return toEmployee(this.repo.findById(id)!);
    }).immediate();
  }

  update(id: number, patch: EmployeeUpdate): Employee {
    return this.db.transaction(() => {
      const current = this.repo.findById(id);
      if (!current) throw notFound('Employee');
      if (patch.email && patch.email !== current.email) this.assertEmailAvailable(patch.email, id);

      const ts = this.now();
      const next = {
        full_name: patch.fullName ?? current.full_name,
        email: patch.email ?? current.email,
        job_title: patch.jobTitle ?? current.job_title,
        department: patch.department ?? current.department,
        country: patch.country ?? current.country,
        currency: patch.currency ?? current.currency,
        salary_minor: patch.salaryMinor ?? current.salary_minor,
        hire_date: patch.hireDate ?? current.hire_date,
        updated_at: ts,
      };
      this.repo.update(id, next);

      const salaryChanged =
        next.salary_minor !== current.salary_minor || next.currency !== current.currency;
      if (salaryChanged) {
        this.repo.insertSalaryHistory({
          employee_id: id,
          old_salary_minor: current.salary_minor,
          new_salary_minor: next.salary_minor,
          old_currency: current.currency,
          new_currency: next.currency,
          changed_at: ts,
        });
      }
      return toEmployee(this.repo.findById(id)!);
    }).immediate();
  }

  delete(id: number): void {
    if (!this.repo.delete(id)) throw notFound('Employee');
  }

  private assertEmailAvailable(email: string, exceptId?: number): void {
    const existing = this.repo.findByEmail(email);
    if (existing && existing.id !== exceptId) {
      throw conflict(`An employee with email ${email} already exists`);
    }
  }
}

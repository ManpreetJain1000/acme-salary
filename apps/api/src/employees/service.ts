import { toUsdMinor, usdRate } from '../domain/money.js';
import { badRequest, conflict, notFound, stale } from '../http/errors.js';
import {
  EmployeeRepository,
  type EmployeeRow,
  type EmployeeStatus,
  type EmploymentEvent,
  type EmploymentEventRow,
  type ExpectedVersion,
  type SalaryHistoryRow,
} from './repository.js';
import type { EmployeeInput, EmployeeUpdate, ListQuery, TerminateInput } from './schemas.js';

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
  /** Send back as If-Match ("<version>") when changing this employee. */
  version: number;
  status: EmployeeStatus;
  terminatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryChange {
  oldSalaryMinor: number | null;
  newSalaryMinor: number;
  oldCurrency: string | null;
  newCurrency: string;
  changedAt: string;
  changedBy: string | null;
  usdRate: number | null;
}

export interface EmploymentChange {
  event: EmploymentEvent;
  effectiveDate: string;
  recordedAt: string;
  recordedBy: string | null;
}

/** Who a write is attributed to. Routes always pass the signed-in user. */
export const SYSTEM_ACTOR = 'system';

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type Clock = () => string;
const systemClock: Clock = () => new Date().toISOString();

/** Throw 412 if the caller's copy is out of date (null = caller chose to overwrite). */
function assertVersion(current: EmployeeRow, expected: ExpectedVersion): void {
  if (expected !== null && current.version !== expected) throw stale(current.version);
}

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
    version: row.version,
    status: row.status,
    terminatedAt: row.terminated_at,
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
    changedBy: row.changed_by,
    usdRate: row.usd_rate,
  };
}

function toEmploymentChange(row: EmploymentEventRow): EmploymentChange {
  return {
    event: row.event,
    effectiveDate: row.effective_date,
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by,
  };
}

/**
 * Business rules for employees. Every write that touches salary also writes the
 * audit row in the same transaction, so history can never drift from reality.
 */
export class EmployeeService {
  constructor(
    private readonly repo: EmployeeRepository,
    private readonly now: Clock = systemClock,
  ) {}

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

  get(id: number): Employee & { salaryHistory: SalaryChange[]; employmentHistory: EmploymentChange[] } {
    const row = this.repo.findById(id);
    if (!row) throw notFound('Employee');
    return {
      ...toEmployee(row),
      salaryHistory: this.repo.salaryHistory(id).map(toSalaryChange),
      employmentHistory: this.repo.employmentEvents(id).map(toEmploymentChange),
    };
  }

  create(input: EmployeeInput, actor: string = SYSTEM_ACTOR): Employee {
    return this.repo.transaction(() => {
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
        changed_by: actor,
        usd_rate: usdRate(input.currency),
      });
      this.repo.insertEmploymentEvent({
        employee_id: id,
        event: 'hired',
        effective_date: input.hireDate,
        recorded_at: ts,
        recorded_by: actor,
      });
      return toEmployee(this.repo.findById(id)!);
    });
  }

  update(id: number, patch: EmployeeUpdate, expected: ExpectedVersion, actor: string = SYSTEM_ACTOR): Employee {
    return this.repo.transaction(() => {
      const current = this.repo.findById(id);
      if (!current) throw notFound('Employee');
      assertVersion(current, expected);
      if (current.status === 'terminated') {
        throw conflict(`${current.full_name} has left; reinstate them before making changes`);
      }
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
      // Compare-and-set as well as the check above: correct even if a write slips between.
      if (!this.repo.update(id, next, expected)) throw stale(this.repo.findById(id)!.version);

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
          changed_by: actor,
          usd_rate: usdRate(next.currency),
        });
      }
      return toEmployee(this.repo.findById(id)!);
    });
  }

  /**
   * Record that someone left. Their row and salary history are kept: HR is asked
   * about former employees' pay, and the audit trail must survive (decisions.md D5).
   */
  terminate(
    id: number,
    input: TerminateInput,
    expected: ExpectedVersion,
    actor: string = SYSTEM_ACTOR,
  ): Employee {
    return this.repo.transaction(() => {
      const current = this.repo.findById(id);
      if (!current) throw notFound('Employee');
      assertVersion(current, expected);
      if (current.status === 'terminated') throw conflict(`${current.full_name} has already left`);
      const ts = this.now();
      const date = input.terminationDate ?? ts.slice(0, 10);
      if (date < current.hire_date) {
        throw badRequest(`Termination date ${date} is before the hire date ${current.hire_date}`);
      }
      if (!this.repo.setStatus(id, 'terminated', date, ts, expected)) throw stale(current.version + 1);
      this.repo.insertEmploymentEvent({
        employee_id: id,
        event: 'terminated',
        effective_date: date,
        recorded_at: ts,
        recorded_by: actor,
      });
      return toEmployee(this.repo.findById(id)!);
    });
  }

  /** Undo a termination recorded by mistake, or a rehire into the same record. */
  reinstate(id: number, expected: ExpectedVersion, actor: string = SYSTEM_ACTOR): Employee {
    return this.repo.transaction(() => {
      const current = this.repo.findById(id);
      if (!current) throw notFound('Employee');
      assertVersion(current, expected);
      if (current.status === 'active') throw conflict(`${current.full_name} is already active`);
      const ts = this.now();
      if (!this.repo.setStatus(id, 'active', null, ts, expected)) throw stale(current.version + 1);
      this.repo.insertEmploymentEvent({
        employee_id: id,
        event: 'reinstated',
        effective_date: ts.slice(0, 10),
        recorded_at: ts,
        recorded_by: actor,
      });
      return toEmployee(this.repo.findById(id)!);
    });
  }

  private assertEmailAvailable(email: string, exceptId?: number): void {
    const existing = this.repo.findByEmail(email);
    if (existing && existing.id !== exceptId) {
      throw conflict(
        existing.status === 'terminated'
          ? `${email} belongs to former employee ${existing.employee_code}; reinstate them instead`
          : `An employee with email ${email} already exists`,
      );
    }
  }
}

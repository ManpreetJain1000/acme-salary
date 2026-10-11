import { z } from 'zod';
import {
  COUNTRY_CODES,
  CURRENCIES,
  CURRENCY_CODES,
  DEPARTMENT_NAMES,
  JOB_TITLES,
} from '../domain/reference.js';

/** Upper bound guards against typos like an extra three zeros (100M in major units). */
const MAX_SALARY_MINOR = 100_000_000_00;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date');

export const employeeInputSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  jobTitle: z.enum(JOB_TITLES),
  department: z.enum(DEPARTMENT_NAMES),
  country: z.enum(COUNTRY_CODES),
  currency: z.enum(CURRENCY_CODES),
  salaryMinor: z.number().int().positive().max(MAX_SALARY_MINOR),
  hireDate: isoDate,
});

export const employeeUpdateSchema = employeeInputSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export type EmployeeInput = z.infer<typeof employeeInputSchema>;
export type EmployeeUpdate = z.infer<typeof employeeUpdateSchema>;

/**
 * USD-equivalent salary as a SQL expression, built only from the static FX table
 * (trusted constants, never user input). Sorting by raw salary_minor would rank
 * INR 2,000,000 (~$22.6k) above USD 150,000, which is meaningless across currencies.
 */
export const SALARY_USD_SQL = `(salary_minor * CASE currency ${CURRENCIES.map(
  (c) => `WHEN '${c.code}' THEN ${c.usdRate}`,
).join(' ')} END)`;

/** Allow-list of sortable columns: user input is never interpolated into SQL. */
export const SORT_FIELDS = {
  fullName: 'full_name',
  employeeCode: 'employee_code',
  jobTitle: 'job_title',
  department: 'department',
  country: 'country',
  salary: SALARY_USD_SQL,
  hireDate: 'hire_date',
} as const;

export const MAX_PAGE_SIZE = 100;

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(25),
  search: z.string().trim().max(100).optional(),
  country: z.enum(COUNTRY_CODES).optional(),
  department: z.enum(DEPARTMENT_NAMES).optional(),
  jobTitle: z.enum(JOB_TITLES).optional(),
  sortBy: z.enum(Object.keys(SORT_FIELDS) as [keyof typeof SORT_FIELDS]).default('fullName'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export const idParamSchema = z.coerce.number().int().positive();

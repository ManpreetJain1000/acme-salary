/** Mirrors the API contract. Money is always integer minor units. */

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
  status: EmployeeStatus;
  /** Last day of employment, YYYY-MM-DD; null while active. */
  terminatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EmployeeStatus = 'active' | 'terminated';

export interface SalaryChange {
  oldSalaryMinor: number | null;
  newSalaryMinor: number;
  oldCurrency: string | null;
  newCurrency: string;
  changedAt: string;
}

export type EmployeeDetail = Employee & { salaryHistory: SalaryChange[] };

export interface EmployeeInput {
  fullName: string;
  email: string;
  jobTitle: string;
  department: string;
  country: string;
  currency: string;
  salaryMinor: number;
  hireDate: string;
}

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Meta {
  countries: { code: string; name: string; currency: string }[];
  currencies: { code: string; usdRate: number }[];
  fxAsOf: string;
  departments: { name: string; jobTitles: string[] }[];
}

export interface Breakdown {
  key: string;
  label: string;
  headcount: number;
  totalUsdMinor: number;
  medianUsdMinor: number;
}

export interface Summary {
  headcount: number;
  totalPayrollUsdMinor: number;
  medianUsdMinor: number | null;
  byCountry: Breakdown[];
  byDepartment: Breakdown[];
}

export interface PayBand {
  country: string;
  countryName: string;
  jobTitle: string;
  department: string;
  currency: string;
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  mean: number;
  medianUsdMinor: number;
}

export interface Outlier {
  id: number;
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  department: string;
  country: string;
  currency: string;
  salaryMinor: number;
  groupMedianMinor: number;
  groupSize: number;
  deviation: number;
}

export interface InsightFilter {
  country?: string;
  department?: string;
  jobTitle?: string;
}

export interface EmployeeQuery extends InsightFilter {
  page: number;
  pageSize: number;
  search?: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
  status: EmployeeStatus | 'all';
}

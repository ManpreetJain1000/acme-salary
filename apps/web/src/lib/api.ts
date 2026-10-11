import type {
  Employee,
  EmployeeDetail,
  EmployeeInput,
  EmployeeQuery,
  InsightFilter,
  Meta,
  Outlier,
  Page,
  PayBand,
  Summary,
} from './types';

export interface FieldError {
  path: string;
  message: string;
}

/** Error carrying the API's structured payload so forms can show field errors. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: FieldError[] = [],
  ) {
    super(message);
  }
}

/** Build a query string, dropping empty values so URLs stay clean. */
export function toQueryString(params: object): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/**
 * Where to go after signing in. Only same-site paths are accepted, so a crafted
 * link (?next=//evil.example) can't bounce the user to another site.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next;
}

function redirectToLogin() {
  if (typeof window === 'undefined' || window.location.pathname === '/login') return;
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    // POSTs must be JSON (the API's CSRF defence), so always say so.
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  // Session missing or expired: send the user to sign in, then back here.
  if (res.status === 401 && !path.startsWith('/api/auth/')) redirectToLogin();
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? res.statusText, err?.details ?? []);
  }
  return body as T;
}

const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

/** True when a save lost a race with someone else's change (HTTP 412). */
export const isStale = (err: unknown) => err instanceof ApiError && err.code === 'STALE';

export const api = {
  login: (email: string, password: string) =>
    request<{ email: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST', body: '{}' }),
  me: () => request<{ email: string }>('/api/auth/me'),
  /** Demo deployments only; 404 otherwise. */
  demoCredentials: () => request<{ email: string; password: string }>('/api/auth/demo'),
  meta: () => request<Meta>('/api/meta'),
  listEmployees: (q: EmployeeQuery) => request<Page<Employee>>(`/api/employees${toQueryString(q)}`),
  getEmployee: (id: number) => request<EmployeeDetail>(`/api/employees/${id}`),
  createEmployee: (input: EmployeeInput) =>
    request<Employee>('/api/employees', { method: 'POST', body: JSON.stringify(input) }),
  // Every change names the version it was based on, so a stale copy gets 412
  // instead of silently overwriting someone else's edit.
  updateEmployee: (id: number, version: number, patch: Partial<EmployeeInput>) =>
    request<Employee>(`/api/employees/${id}`, {
      method: 'PATCH',
      headers: ifMatch(version),
      body: JSON.stringify(patch),
    }),
  terminateEmployee: (id: number, version: number, terminationDate?: string) =>
    request<Employee>(`/api/employees/${id}/terminate`, {
      method: 'POST',
      headers: ifMatch(version),
      body: JSON.stringify(terminationDate ? { terminationDate } : {}),
    }),
  reinstateEmployee: (id: number, version: number) =>
    request<Employee>(`/api/employees/${id}/reinstate`, { method: 'POST', headers: ifMatch(version), body: '{}' }),
  summary: (f: InsightFilter) => request<Summary>(`/api/insights/summary${toQueryString(f)}`),
  payBands: (f: InsightFilter) =>
    request<{ data: PayBand[] }>(`/api/insights/pay-bands${toQueryString(f)}`).then((r) => r.data),
  outliers: (f: InsightFilter & { threshold: number }) =>
    request<{ total: number; data: Outlier[] }>(`/api/insights/outliers${toQueryString(f)}`),
};

import { createApp, type AppOptions } from './app.js';
import { openDatabase } from './db/database.js';
import { silentLogger } from './http/logger.js';
import type { EmployeeInput } from './employees/schemas.js';

export const FIXED_NOW = '2026-10-01T09:00:00.000Z';

/** Fresh in-memory database + app per test: isolated, fast, deterministic. */
/**
 * Business-logic suites run with sign-in off; auth.test.ts runs with it on and
 * checks that every protected route really is protected.
 */
export function setupTestApp(options: Partial<Pick<AppOptions, 'logger' | 'rateLimitPerMinute' | 'auth'>> = {}) {
  const db = openDatabase(':memory:');
  const app = createApp({ db, now: () => FIXED_NOW, logger: silentLogger, auth: false, ...options });
  return { db, app };
}

let counter = 0;
export function employeeInput(overrides: Partial<EmployeeInput> = {}): EmployeeInput {
  counter++;
  return {
    fullName: 'Asha Rao',
    email: `asha.rao.${counter}@acme.example`,
    jobTitle: 'Software Engineer',
    department: 'Engineering',
    country: 'IN',
    currency: 'INR',
    salaryMinor: 2_400_000_00,
    hireDate: '2024-04-01',
    ...overrides,
  };
}

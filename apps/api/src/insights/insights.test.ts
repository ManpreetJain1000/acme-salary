import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db/database.js';
import { EmployeeRepository } from '../employees/repository.js';
import { EmployeeService } from '../employees/service.js';
import { employeeInput, setupTestApp } from '../test-utils.js';
import { InsightService } from './service.js';

/** Five US Software Engineers at 100k..140k (+ one outlier) and two Indian engineers. */
function seedFixture(db: DB) {
  const employees = new EmployeeService(new EmployeeRepository(db), () => '2026-10-01T00:00:00.000Z');
  const us = (usd: number, fullName = 'US Engineer') =>
    employees.create(employeeInput({ fullName, country: 'US', currency: 'USD', salaryMinor: usd * 100 }));
  [100_000, 110_000, 120_000, 130_000, 140_000].forEach((v) => us(v));
  us(240_000, 'Highly Paid');
  employees.create(employeeInput({ country: 'IN', currency: 'INR', salaryMinor: 2_000_000_00 }));
  employees.create(
    employeeInput({ country: 'IN', currency: 'INR', salaryMinor: 3_000_000_00, department: 'Sales', jobTitle: 'Account Executive' }),
  );
}

describe('InsightService', () => {
  let service: InsightService;

  beforeEach(() => {
    const { db } = setupTestApp();
    seedFixture(db);
    service = new InsightService(new EmployeeRepository(db));
  });

  it('summarises headcount and USD-normalised payroll by country, largest first', () => {
    const summary = service.summary({});
    expect(summary.headcount).toBe(8);
    expect(summary.byCountry.map((c) => [c.key, c.headcount])).toEqual([['US', 6], ['IN', 2]]);
    // 2,000,000 INR + 3,000,000 INR = 5,000,000 INR * 0.0113 = 56,500 USD
    expect(summary.byCountry[1]!.totalUsdMinor).toBe(5_650_000);
    expect(summary.byCountry[1]!.label).toBe('India');
  });

  it('counts only current employees', () => {
    const { db } = setupTestApp();
    const repo = new EmployeeRepository(db);
    const employees = new EmployeeService(repo);
    const leaver = employees.create(employeeInput({ country: 'US', currency: 'USD', salaryMinor: 999_999_00 }));
    employees.create(employeeInput({ country: 'US', currency: 'USD', salaryMinor: 100_000_00 }));
    employees.terminate(leaver.id, {});
    expect(new InsightService(repo).summary({})).toMatchObject({ headcount: 1, totalPayrollUsdMinor: 100_000_00 });
  });

  it('respects filters', () => {
    const summary = service.summary({ department: 'Sales' });
    expect(summary.headcount).toBe(1);
    expect(summary.byDepartment).toHaveLength(1);
  });

  it('returns null median for an empty selection instead of zero', () => {
    expect(service.summary({ country: 'BR' })).toMatchObject({ headcount: 0, medianUsdMinor: null });
  });

  it('computes pay bands per job title and country in local currency', () => {
    const band = service.payBands({ country: 'US', jobTitle: 'Software Engineer' })[0]!;
    expect(band).toMatchObject({
      count: 6,
      currency: 'USD',
      min: 10_000_000,
      median: 12_500_000, // even count: avg of 120k and 130k
      max: 24_000_000,
      medianUsdMinor: 12_500_000,
    });
  });

  it('flags salaries far from their group median, skipping tiny groups', () => {
    const { total, data } = service.outliers({ threshold: 0.5, minGroupSize: 5, limit: 100 });
    expect(total).toBe(1);
    expect(data[0]).toMatchObject({ fullName: 'Highly Paid', groupMedianMinor: 12_500_000, groupSize: 6, deviation: 0.92 });
  });
});

describe('InsightService money rounding', () => {
  // Tiny amounts make rounding visible: 50 paise = $0.00565 -> 0.565 cents.
  it('sums exact USD values and rounds the total once, not per employee', () => {
    const { db } = setupTestApp();
    const employees = new EmployeeService(new EmployeeRepository(db));
    for (let i = 0; i < 3; i++) {
      employees.create(employeeInput({ country: 'IN', currency: 'INR', salaryMinor: 50 }));
    }
    // Exact: 3 x 0.565 = 1.695 -> 2 cents. Rounding each row first would give 3.
    expect(new InsightService(new EmployeeRepository(db)).summary({}).totalPayrollUsdMinor).toBe(2);
  });

  it('converts the exact local median to USD instead of rounding twice', () => {
    const { db } = setupTestApp();
    const employees = new EmployeeService(new EmployeeRepository(db));
    for (const salaryMinor of [1, 2]) {
      employees.create(employeeInput({ country: 'GB', currency: 'GBP', salaryMinor }));
    }
    // Exact median 1.5p x 1.33 = 1.995 -> 2 cents. Rounding the median to 2p first gives 2.66 -> 3.
    const [band] = new InsightService(new EmployeeRepository(db)).payBands({});
    expect(band!.medianUsdMinor).toBe(2);
  });
});

describe('Insights API', () => {
  it('validates query parameters', async () => {
    const { app } = setupTestApp();
    await request(app).get('/api/insights/pay-bands?country=ZZ').expect(400);
    await request(app).get('/api/insights/outliers?threshold=99').expect(400);
  });

  it('serves summary, pay bands and outliers', async () => {
    const { db, app } = setupTestApp();
    seedFixture(db);
    const summary = await request(app).get('/api/insights/summary').expect(200);
    expect(summary.body.headcount).toBe(8);
    const bands = await request(app).get('/api/insights/pay-bands?country=US').expect(200);
    expect(bands.body.data).toHaveLength(1);
    const outliers = await request(app).get('/api/insights/outliers?threshold=0.5').expect(200);
    expect(outliers.body.total).toBe(1);
  });
});

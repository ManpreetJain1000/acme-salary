/**
 * Micro-benchmark of the hot paths against the full 10k seed (in-memory SQLite).
 * Usage: npm run bench --workspace api. Numbers are recorded in docs/performance.md.
 */
import { openDatabase } from './db/database.js';
import { listQuerySchema } from './employees/schemas.js';
import { EmployeeService } from './employees/service.js';
import { InsightService } from './insights/service.js';
import { seedDatabase } from './seed/seed.js';

const db = openDatabase(':memory:');
const seed = seedDatabase(db);
const employees = new EmployeeService(db);
const insights = new InsightService(db);

function bench(name: string, fn: () => unknown, runs = 50) {
  for (let i = 0; i < 5; i++) fn(); // warm prepared-statement cache
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const p = (q: number) => times[Math.floor(q * (times.length - 1))]!.toFixed(2);
  return { name, p50ms: p(0.5), p95ms: p(0.95) };
}

const q = (o: Record<string, unknown>) => listQuerySchema.parse(o);

console.log(`Seed: ${seed.employees} employees + ${seed.historyRows} history rows in ${seed.durationMs} ms\n`);
console.table([
  bench('list: first page, sort by name', () => employees.list(q({}))),
  bench('list: last page (offset 9975), sort by salary', () => employees.list(q({ page: 400, sortBy: 'salary' }))),
  bench('list: filter country + department', () => employees.list(q({ country: 'IN', department: 'Engineering' }))),
  bench('list: search "sharma" (LIKE %x%)', () => employees.list(q({ search: 'sharma' }))),
  bench('get: employee + history', () => employees.get(4242)),
  bench('insights: summary (all 10k)', () => insights.summary({})),
  bench('insights: pay bands (all groups)', () => insights.payBands({})),
  bench('insights: outliers (all groups)', () => insights.outliers({ threshold: 0.4, minGroupSize: 5, limit: 100 })),
  bench('insights: summary, one country', () => insights.summary({ country: 'DE' })),
]);

/**
 * Micro-benchmark of the hot paths against the full 10k seed (in-memory SQLite).
 * Usage: npm run bench --workspace api   (BENCH_COUNT=100000 for a scale test).
 * Numbers are recorded in docs/performance.md.
 */
import { openDatabase } from './db/database.js';
import { EmployeeRepository } from './employees/repository.js';
import { listQuerySchema } from './employees/schemas.js';
import { EmployeeService } from './employees/service.js';
import { InsightService } from './insights/service.js';
import { seedDatabase } from './seed/seed.js';

const db = openDatabase(':memory:');
const count = Number(process.env.BENCH_COUNT ?? 10_000);
const seed = seedDatabase(db, { count });
const repo = new EmployeeRepository(db);
const employees = new EmployeeService(repo);
const insights = new InsightService(repo);

function bench(name: string, fn: () => unknown, runs = count > 100_000 ? 5 : 20) {
  for (let i = 0; i < 2; i++) fn(); // warm prepared-statement cache
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const p = (x: number) => times[Math.floor(x * (times.length - 1))]!.toFixed(2);
  return { name, p50ms: p(0.5), p95ms: p(0.95) };
}

const q = (o: Record<string, unknown>) => listQuerySchema.parse(o);

console.log(`Seed: ${seed.employees} employees + ${seed.historyRows} history rows in ${seed.durationMs} ms\n`);
console.table([
  bench('list: first page, sort by name', () => employees.list(q({}))),
  bench('list: last page, sort by salary', () => employees.list(q({ page: Math.ceil(count / 25), sortBy: 'salary' }))),
  bench('list: filter country + department', () => employees.list(q({ country: 'IN', department: 'Engineering' }))),
  bench('list: search "sharma" (LIKE %x%)', () => employees.list(q({ search: 'sharma' }))),
  bench('get: employee + history', () => employees.get(Math.min(4242, count))),
  bench('insights: summary, whole org', () => insights.summary({})),
  bench('insights: pay bands (all groups)', () => insights.payBands({})),
  bench('insights: outliers (all groups)', () => insights.outliers({ threshold: 0.4, minGroupSize: 5, limit: 100 })),
  bench('insights: summary, one country', () => insights.summary({ country: 'DE' })),
]);

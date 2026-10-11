import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/database.js';
import { seedDatabase } from './seed.js';

/**
 * Usage: npm run seed [-- --reset]
 * --reset wipes and reseeds. Refused in production unless ALLOW_RESET=true,
 * so nobody deletes real data by accident.
 */
const config = loadConfig();
const reset = process.argv.includes('--reset');

if (reset && config.NODE_ENV === 'production' && process.env.ALLOW_RESET !== 'true') {
  console.error('Refusing --reset in production. Set ALLOW_RESET=true if you really mean it.');
  process.exit(1);
}

mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
const db = openDatabase(config.DATABASE_PATH);
const result = seedDatabase(db, { reset });
db.close();

console.log(
  result.status === 'seeded'
    ? `Seeded ${result.employees} employees (${result.historyRows} salary history rows) in ${result.durationMs} ms`
    : `Skipped: database already has ${result.employees} employees (use --reset to reseed)`,
);

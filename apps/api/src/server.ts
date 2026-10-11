import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { jsonLogger } from './http/logger.js';
import { seedDatabase } from './seed/seed.js';

const config = loadConfig();
mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
const db = openDatabase(config.DATABASE_PATH);

if (config.SEED_ON_BOOT) {
  const result = seedDatabase(db);
  console.log(`Seed on boot: ${result.status} (${result.employees} employees)`);
}

const app = createApp({
  db,
  corsOrigin: config.CORS_ORIGIN.split(',').map((o) => o.trim()),
  logger: jsonLogger,
  rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE,
});
const server = app.listen(config.PORT, () => {
  console.log(`API listening on http://localhost:${config.PORT}`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

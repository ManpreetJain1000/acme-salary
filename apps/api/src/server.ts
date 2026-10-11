import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { hashPassword } from './auth/password.js';
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

if (!config.SESSION_SECRET) {
  console.warn('SESSION_SECRET not set: using a random one, so sign-ins reset on restart (development only).');
}

const app = createApp({
  db,
  auth: {
    email: config.HR_EMAIL,
    passwordHash: hashPassword(config.HR_PASSWORD),
    sessionSecret: config.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    cookieSecure: config.COOKIE_SECURE,
    demoPassword: config.DEMO_LOGIN_HINT ? config.HR_PASSWORD : undefined,
  },
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

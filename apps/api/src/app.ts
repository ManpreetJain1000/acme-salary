import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { authRoutes, requireAuth, requireJsonForWrites, type AuthOptions } from './auth/auth.js';
import type { DB } from './db/database.js';
import {
  COUNTRIES,
  CURRENCIES,
  DEPARTMENTS,
  FX_AS_OF,
} from './domain/reference.js';
import { EmployeeRepository } from './employees/repository.js';
import { employeeRoutes } from './employees/routes.js';
import { EmployeeService, type Clock } from './employees/service.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import type { Logger } from './http/logger.js';
import { requestContext } from './http/requestContext.js';
import { insightRoutes } from './insights/routes.js';
import { InsightService } from './insights/service.js';

export interface AppOptions {
  db: DB;
  /** Allowed browser origin(s). Locked down in production via CORS_ORIGIN. */
  corsOrigin?: string | string[];
  now?: Clock;
  logger: Logger;
  /** HR sign-in. `false` only in tests that exercise business logic, never in server.ts. */
  auth: AuthOptions | false;
  /** Requests per minute per client IP across /api (health excluded). */
  rateLimitPerMinute?: number;
}

export function createApp({ db, corsOrigin, now, logger, auth, rateLimitPerMinute = 600 }: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  // Requests arrive via the Next.js proxy on loopback; trust its X-Forwarded-For
  // (and only from loopback) so rate limits apply per real client, not per proxy.
  app.set('trust proxy', 'loopback');
  app.use(requestContext(logger));
  app.use(helmet());
  app.use(cors({ origin: corsOrigin ?? false }));
  app.use(express.json({ limit: '50kb' }));

  const employees = new EmployeeRepository(db);

  // Liveness and readiness in one: 503 when the database can't answer, so the
  // platform's health check restarts or stops routing to a broken instance.
  app.get('/api/health', (_req, res) => {
    const database = employees.ping();
    res.status(database ? 200 : 503).json({ status: database ? 'ok' : 'unavailable', database: database ? 'ok' : 'down' });
  });

  // In-memory store: correct for one instance. Several instances would share a
  // store (e.g. Redis) so the limit holds across them.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: rateLimitPerMinute,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({
          error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' },
        });
      },
    }),
  );

  app.use('/api', requireJsonForWrites);

  // Everything below /api/auth requires a signed-in HR user. Health stays public.
  if (auth) {
    app.use('/api/auth', authRoutes(auth));
    const signedIn = requireAuth(auth);
    for (const path of ['/api/meta', '/api/employees', '/api/insights']) app.use(path, signedIn);
  }

  // Reference data for dropdowns, so the UI never hard-codes lists the API validates.
  app.get('/api/meta', (_req, res) => {
    res.json({
      countries: COUNTRIES.map(({ code, name, currency }) => ({ code, name, currency })),
      currencies: CURRENCIES,
      fxAsOf: FX_AS_OF,
      departments: DEPARTMENTS.map((d) => ({
        name: d.name,
        jobTitles: d.titles.map((t) => t.title),
      })),
    });
  });

  app.use('/api/employees', employeeRoutes(new EmployeeService(employees, now)));
  app.use('/api/insights', insightRoutes(new InsightService(employees)));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}

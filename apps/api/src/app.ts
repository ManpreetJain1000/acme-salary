import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
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
import { insightRoutes } from './insights/routes.js';
import { InsightService } from './insights/service.js';

export interface AppOptions {
  db: DB;
  /** Allowed browser origin(s). Locked down in production via CORS_ORIGIN. */
  corsOrigin?: string | string[];
  now?: Clock;
}

export function createApp({ db, corsOrigin, now }: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: corsOrigin ?? false }));
  app.use(express.json({ limit: '50kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

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

  const employees = new EmployeeRepository(db);
  app.use('/api/employees', employeeRoutes(new EmployeeService(employees, now)));
  app.use('/api/insights', insightRoutes(new InsightService(employees)));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

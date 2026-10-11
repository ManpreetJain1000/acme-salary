import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { Logger } from './logger.js';

const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The path without its query string (search terms are people's names), with
 * numeric ids collapsed so log lines group by endpoint: /api/employees/:id.
 * (Express resets req.baseUrl on error paths, so the original URL is used.)
 */
export function routeOf(req: Request): string {
  const path = req.originalUrl.split('?')[0] ?? '';
  return path.replace(/\/\d+(?=\/|$)/g, '/:id');
}

/**
 * Give every request an id (reusing a well-formed incoming X-Request-Id so one id
 * follows a request across services), echo it in the response, and log one line
 * when the response finishes.
 */
export function requestContext(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const requestId = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('request', {
        requestId,
        method: req.method,
        route: routeOf(req),
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      });
    });
    next();
  };
}

import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from './logger.js';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
export const badRequest = (message: string) => new AppError(400, 'BAD_REQUEST', message);

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', 'Route not found'));
};

/**
 * One consistent error shape: { error: { code, message, details? } }.
 * Unexpected errors are logged with the request id (never the request body, which
 * may contain salaries) and return that id, so a support ticket can be traced,
 * but never a stack trace.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request is invalid',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
      return;
    }
    const requestId = res.locals.requestId as string | undefined;
    logger.error('unhandled error', {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId } });
  };
}

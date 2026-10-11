import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setupTestApp } from '../test-utils.js';
import type { LogFields, Logger } from './logger.js';

function capturingLogger() {
  const lines: { level: string; msg: string; fields?: LogFields }[] = [];
  const logger: Logger = {
    info: (msg, fields) => lines.push({ level: 'info', msg, fields }),
    error: (msg, fields) => lines.push({ level: 'error', msg, fields }),
  };
  return { logger, lines };
}

describe('request ids and logging', () => {
  it('assigns a request id and returns it in a header', async () => {
    const { app } = setupTestApp();
    const res = await request(app).get('/api/health').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses a well-formed incoming id and replaces a malformed one', async () => {
    const { app } = setupTestApp();
    const kept = await request(app).get('/api/health').set('X-Request-Id', 'trace-123');
    expect(kept.headers['x-request-id']).toBe('trace-123');
    const replaced = await request(app).get('/api/health').set('X-Request-Id', 'x'.repeat(65));
    expect(replaced.headers['x-request-id']).not.toBe('x'.repeat(65));
  });

  it('logs one line per request with the route template, never the query string', async () => {
    const { logger, lines } = capturingLogger();
    const { app } = setupTestApp({ logger });
    await request(app).get('/api/employees?search=Priya%20Sharma').expect(200);
    await request(app).get('/api/employees/42').expect(404);

    expect(lines.map((l) => l.fields?.route)).toEqual(['/api/employees', '/api/employees/:id']);
    expect(lines[0]!.fields).toMatchObject({ method: 'GET', status: 200 });
    expect(typeof lines[0]!.fields!.durationMs).toBe('number');
    expect(JSON.stringify(lines)).not.toMatch(/Priya|Sharma/);
  });

  it('returns the request id on unexpected errors and logs it, without internals', async () => {
    const { logger, lines } = capturingLogger();
    const { app, db } = setupTestApp({ logger });
    db.close(); // any query now fails unexpectedly

    const res = await request(app).get('/api/employees').expect(500);
    expect(res.body.error).toEqual({
      code: 'INTERNAL',
      message: 'Something went wrong',
      requestId: res.headers['x-request-id'],
    });
    expect(lines.find((l) => l.level === 'error')?.fields?.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('health check', () => {
  it('reports the database as ok', async () => {
    const { app } = setupTestApp();
    expect((await request(app).get('/api/health').expect(200)).body).toEqual({ status: 'ok', database: 'ok' });
  });

  it('answers 503 when the database is unavailable', async () => {
    const { app, db } = setupTestApp();
    db.close();
    expect((await request(app).get('/api/health').expect(503)).body).toEqual({ status: 'unavailable', database: 'down' });
  });
});

describe('rate limiting', () => {
  it('answers 429 in the standard error shape once the limit is reached', async () => {
    const { app } = setupTestApp({ rateLimitPerMinute: 2 });
    await request(app).get('/api/meta').expect(200);
    await request(app).get('/api/meta').expect(200);
    const res = await request(app).get('/api/meta').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('never limits the health check', async () => {
    const { app } = setupTestApp({ rateLimitPerMinute: 1 });
    for (let i = 0; i < 3; i++) await request(app).get('/api/health').expect(200);
  });

  it('limits per real client behind the proxy, not per proxy', async () => {
    const { app } = setupTestApp({ rateLimitPerMinute: 1 });
    await request(app).get('/api/meta').set('X-Forwarded-For', '203.0.113.1').expect(200);
    await request(app).get('/api/meta').set('X-Forwarded-For', '203.0.113.1').expect(429);
    await request(app).get('/api/meta').set('X-Forwarded-For', '203.0.113.2').expect(200);
  });
});

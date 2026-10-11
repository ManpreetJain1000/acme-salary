import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { employeeInput, setupTestApp } from '../test-utils.js';
import type { AuthOptions } from './auth.js';
import { hashPassword, verifyPassword } from './password.js';
import { issueToken, readCookie, readToken } from './session.js';

const PASSWORD = 'correct horse battery';
const SECRET = 's'.repeat(32);
const passwordHash = hashPassword(PASSWORD); // scrypt is deliberately slow: hash once

function authApp(overrides: Partial<AuthOptions> = {}) {
  let now = Date.parse('2026-10-11T09:00:00Z');
  const auth: AuthOptions = {
    email: 'hr@acme.example',
    passwordHash,
    sessionSecret: SECRET,
    // The test client speaks plain HTTP, where browsers (and supertest) never send
    // Secure cookies. The Secure flag itself is asserted in its own test.
    cookieSecure: false,
    nowMs: () => now,
    ...overrides,
  };
  const { app, db } = setupTestApp({ auth });
  return { app, db, advance: (ms: number) => (now += ms) };
}

async function signIn(app: ReturnType<typeof authApp>['app']) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email: 'HR@acme.example', password: PASSWORD }).expect(200);
  return agent;
}

describe('password hashing', () => {
  it('verifies the right password and rejects others', () => {
    expect(verifyPassword(PASSWORD, passwordHash)).toBe(true);
    expect(verifyPassword('wrong', passwordHash)).toBe(false);
    expect(verifyPassword(PASSWORD, 'not-a-hash')).toBe(false);
  });

  it('salts every hash', () => {
    expect(hashPassword(PASSWORD)).not.toBe(hashPassword(PASSWORD));
  });
});

describe('session tokens', () => {
  const now = 1_000_000;
  const token = issueToken({ sub: 'hr@acme.example', exp: now + 1000 }, SECRET);

  it('round-trips a valid token', () => {
    expect(readToken(token, SECRET, now)).toEqual({ sub: 'hr@acme.example', exp: now + 1000 });
  });

  it('rejects tampering, the wrong secret, expiry and garbage', () => {
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'attacker', exp: now + 1000 })).toString('base64url');
    expect(readToken(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(readToken(`${payload}.${sig}`, 'x'.repeat(32), now)).toBeNull();
    expect(readToken(token, SECRET, now + 1000)).toBeNull();
    expect(readToken('garbage', SECRET, now)).toBeNull();
    expect(readToken(undefined, SECRET, now)).toBeNull();
  });

  it('reads one cookie from a Cookie header', () => {
    expect(readCookie('a=1; acme_session=abc.def; b=2', 'acme_session')).toBe('abc.def');
    expect(readCookie(undefined, 'acme_session')).toBeUndefined();
  });
});

describe('sign-in API', () => {
  it('protects every API route except health and sign-in', async () => {
    const { app } = authApp();
    await request(app).get('/api/health').expect(200);
    const attempts = [
      request(app).get('/api/meta'),
      request(app).get('/api/employees'),
      request(app).get('/api/employees/1'),
      request(app).post('/api/employees').send(employeeInput()),
      request(app).patch('/api/employees/1').send({ fullName: 'Someone Else' }),
      request(app).post('/api/employees/1/terminate').send({}),
      request(app).post('/api/employees/1/reinstate').send({}),
      request(app).get('/api/insights/summary'),
      request(app).get('/api/insights/pay-bands'),
      request(app).get('/api/insights/outliers'),
      request(app).get('/api/auth/me'),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('sets a Secure, HttpOnly, SameSite=Lax session cookie', async () => {
    const { app } = authApp({ cookieSecure: true });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hr@acme.example', password: PASSWORD })
      .expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/acme_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Secure/);
  });

  it('grants access once signed in', async () => {
    const { app } = authApp();
    const agent = await signIn(app);
    await agent.get('/api/employees').expect(200);
    expect((await agent.get('/api/auth/me').expect(200)).body).toEqual({ email: 'hr@acme.example' });
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { app } = authApp();
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: 'hr@acme.example', password: 'nope' });
    const unknownEmail = await request(app).post('/api/auth/login').send({ email: 'ceo@acme.example', password: PASSWORD });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('attributes every change to the signed-in HR user', async () => {
    const { app } = authApp();
    const agent = await signIn(app);
    const { body: e } = await agent.post('/api/employees').send(employeeInput()).expect(201);
    await agent.patch(`/api/employees/${e.id}`).set('If-Match', `"${e.version}"`).send({ salaryMinor: 300_000_000 }).expect(200);
    await agent.post(`/api/employees/${e.id}/terminate`).set('If-Match', `"${e.version + 1}"`).send({}).expect(200);

    const { body } = await agent.get(`/api/employees/${e.id}`).expect(200);
    expect(body.salaryHistory.map((h: { changedBy: string }) => h.changedBy)).toEqual(['hr@acme.example', 'hr@acme.example']);
    expect(body.employmentHistory.map((h: { recordedBy: string }) => h.recordedBy)).toEqual(['hr@acme.example', 'hr@acme.example']);
  });

  it('expires sessions', async () => {
    const { app, advance } = authApp({ sessionTtlMs: 60_000 });
    const agent = await signIn(app);
    await agent.get('/api/employees').expect(200);
    advance(60_001);
    await agent.get('/api/employees').expect(401);
  });

  it('signs out', async () => {
    const { app } = authApp();
    const agent = await signIn(app);
    await agent.get('/api/employees').expect(200);
    await agent.post('/api/auth/logout').send({}).expect(204);
    await agent.get('/api/employees').expect(401);
  });

  it('limits failed sign-in attempts per client, not successful ones', async () => {
    const { app } = authApp({ loginAttemptsPer15Min: 2 });
    const fail = () => request(app).post('/api/auth/login').send({ email: 'hr@acme.example', password: 'nope' });
    await fail().expect(401);
    await fail().expect(401);
    const res = await fail().expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('only reveals demo credentials when demo mode is on', async () => {
    await request(authApp().app).get('/api/auth/demo').expect(404);
    const demo = await request(authApp({ demoPassword: PASSWORD }).app).get('/api/auth/demo').expect(200);
    expect(demo.body).toEqual({ email: 'hr@acme.example', password: PASSWORD });
  });

  it('rejects non-JSON POSTs (CSRF defence in depth)', async () => {
    const { app } = authApp();
    const agent = await signIn(app);
    const res = await agent
      .post('/api/employees/1/terminate')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send('terminationDate=2026-10-01')
      .expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});

describe('auth configuration', () => {
  it('refuses to start in production without a password and session secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/HR_PASSWORD is required[\s\S]*SESSION_SECRET is required/);
  });

  it('defaults to secure cookies and no demo hint in production', () => {
    const config = loadConfig({ NODE_ENV: 'production', HR_PASSWORD: 'a-long-password', SESSION_SECRET: SECRET });
    expect(config).toMatchObject({ COOKIE_SECURE: true, DEMO_LOGIN_HINT: false });
  });

  it('works out of the box in development', () => {
    expect(loadConfig({})).toMatchObject({ HR_EMAIL: 'hr@acme.example', COOKIE_SECURE: false, DEMO_LOGIN_HINT: true });
  });
});

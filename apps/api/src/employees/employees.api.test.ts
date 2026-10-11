import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { employeeInput, FIXED_NOW, setupTestApp } from '../test-utils.js';

describe('Employees API', () => {
  let app: ReturnType<typeof setupTestApp>['app'];

  beforeEach(() => {
    ({ app } = setupTestApp());
  });

  describe('POST /api/employees', () => {
    it('creates an employee with a generated code, USD value and initial history entry', async () => {
      const res = await request(app).post('/api/employees').send(employeeInput()).expect(201);

      expect(res.body).toMatchObject({
        employeeCode: 'EMP-000001',
        salaryMinor: 240_000_000,
        salaryUsdMinor: 2_712_000, // 2,400,000 INR * 0.0113 = 27,120 USD
        createdAt: FIXED_NOW,
      });
      expect(res.headers.location).toBe(`/api/employees/${res.body.id}`);

      const detail = await request(app).get(`/api/employees/${res.body.id}`).expect(200);
      expect(detail.body.salaryHistory).toEqual([
        { oldSalaryMinor: null, newSalaryMinor: 240_000_000, oldCurrency: null, newCurrency: 'INR', changedAt: FIXED_NOW },
      ]);
    });

    it('rejects invalid input with field-level details', async () => {
      const res = await request(app)
        .post('/api/employees')
        .send(employeeInput({ salaryMinor: -5, currency: 'XYZ' as never, email: 'nope' }))
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const paths = res.body.error.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['salaryMinor', 'currency', 'email']));
    });

    it('rejects a fractional salary (money is integer minor units)', async () => {
      await request(app).post('/api/employees').send(employeeInput({ salaryMinor: 100.5 })).expect(400);
    });

    it('returns 409 for a duplicate email, case-insensitively', async () => {
      await request(app).post('/api/employees').send(employeeInput({ email: 'dup@acme.example' })).expect(201);
      const res = await request(app)
        .post('/api/employees')
        .send(employeeInput({ email: 'DUP@acme.example' }))
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('returns 400 for malformed JSON without leaking internals', async () => {
      const res = await request(app)
        .post('/api/employees')
        .set('content-type', 'application/json')
        .send('{"fullName":')
        .expect(400);
      expect(res.body).toEqual({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
    });
  });

  describe('PATCH /api/employees/:id', () => {
    it('records a salary change in history', async () => {
      const { body: created } = await request(app).post('/api/employees').send(employeeInput()).expect(201);

      const res = await request(app)
        .patch(`/api/employees/${created.id}`).set('If-Match', '*')
        .send({ salaryMinor: 260_000_000 })
        .expect(200);
      expect(res.body.salaryMinor).toBe(260_000_000);

      const { body } = await request(app).get(`/api/employees/${created.id}`);
      expect(body.salaryHistory[0]).toMatchObject({ oldSalaryMinor: 240_000_000, newSalaryMinor: 260_000_000 });
      expect(body.salaryHistory).toHaveLength(2);
    });

    it('does not write history when salary is unchanged', async () => {
      const { body: created } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      await request(app).patch(`/api/employees/${created.id}`).set('If-Match', '*').send({ jobTitle: 'Senior Software Engineer' }).expect(200);

      const { body } = await request(app).get(`/api/employees/${created.id}`);
      expect(body.salaryHistory).toHaveLength(1);
      expect(body.jobTitle).toBe('Senior Software Engineer');
    });

    it('rejects an empty patch and unknown ids', async () => {
      const { body: created } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      await request(app).patch(`/api/employees/${created.id}`).set('If-Match', '*').send({}).expect(400);
      await request(app).patch('/api/employees/9999').set('If-Match', '*').send({ fullName: 'Nobody Here' }).expect(404);
    });
  });

  describe('optimistic locking (no silent overwrites)', () => {
    it('returns the version as an ETag and bumps it on every change', async () => {
      const { body: e, headers } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      expect(e.version).toBe(1);
      expect(headers.etag).toBe('"1"');
      const res = await request(app).patch(`/api/employees/${e.id}`).set('If-Match', '"1"').send({ salaryMinor: 1_000 }).expect(200);
      expect(res.body.version).toBe(2);
      expect((await request(app).get(`/api/employees/${e.id}`)).headers.etag).toBe('"2"');
    });

    it('rejects a save based on an out-of-date copy with 412, keeping the other change', async () => {
      const { body: e } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      // Two HR users open version 1. The first saves a raise...
      await request(app).patch(`/api/employees/${e.id}`).set('If-Match', '"1"').send({ salaryMinor: 300_000_000 }).expect(200);
      // ...the second, still on version 1, must not silently overwrite it.
      const res = await request(app).patch(`/api/employees/${e.id}`).set('If-Match', '"1"').send({ salaryMinor: 1 }).expect(412);
      expect(res.body.error).toMatchObject({ code: 'STALE', details: { currentVersion: 2 } });
      expect((await request(app).get(`/api/employees/${e.id}`)).body.salaryMinor).toBe(300_000_000);
    });

    it('applies the same rule to leaving and reinstating', async () => {
      const { body: e } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      await request(app).patch(`/api/employees/${e.id}`).set('If-Match', '"1"').send({ fullName: 'Renamed Person' }).expect(200);
      await request(app).post(`/api/employees/${e.id}/terminate`).set('If-Match', '"1"').send({}).expect(412);
      await request(app).post(`/api/employees/${e.id}/terminate`).set('If-Match', '"2"').send({}).expect(200);
      await request(app).post(`/api/employees/${e.id}/reinstate`).set('If-Match', '"2"').send({}).expect(412);
    });

    it('requires If-Match on writes (428), accepts * to overwrite deliberately, and rejects garbage', async () => {
      const { body: e } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      const res = await request(app).patch(`/api/employees/${e.id}`).send({ fullName: 'No Header' }).expect(428);
      expect(res.body.error.code).toBe('PRECONDITION_REQUIRED');
      await request(app).patch(`/api/employees/${e.id}`).set('If-Match', 'nonsense').send({ fullName: 'Bad Header' }).expect(400);
      await request(app).patch(`/api/employees/${e.id}`).set('If-Match', '*').send({ fullName: 'Star Overwrite' }).expect(200);
    });
  });

  describe('leaving: terminate and reinstate (no hard delete)', () => {
    it('terminates instead of deleting, keeping the record and its salary history', async () => {
      const { body: e } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      await request(app).patch(`/api/employees/${e.id}`).set('If-Match', '*').send({ salaryMinor: 250_000_000 }).expect(200);

      const res = await request(app)
        .post(`/api/employees/${e.id}/terminate`).set('If-Match', '*')
        .send({ terminationDate: '2026-09-30' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'terminated', terminatedAt: '2026-09-30' });

      const { body } = await request(app).get(`/api/employees/${e.id}`).expect(200);
      expect(body.salaryHistory).toHaveLength(2);
    });

    it('defaults the termination date to today', async () => {
      const { body: e } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      const res = await request(app).post(`/api/employees/${e.id}/terminate`).set('If-Match', '*').send({}).expect(200);
      expect(res.body.terminatedAt).toBe(FIXED_NOW.slice(0, 10));
    });

    it('rejects DELETE with 405 and points to terminate', async () => {
      const { body: e } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      const res = await request(app).delete(`/api/employees/${e.id}`).expect(405);
      expect(res.body.error.message).toMatch(/terminate/);
      await request(app).get(`/api/employees/${e.id}`).expect(200);
    });

    it('hides former employees from the directory unless asked', async () => {
      const { body: e } = await request(app).post('/api/employees').send(employeeInput({ fullName: 'Gone Person' })).expect(201);
      await request(app).post('/api/employees').send(employeeInput({ fullName: 'Still Here' })).expect(201);
      await request(app).post(`/api/employees/${e.id}/terminate`).set('If-Match', '*').send({}).expect(200);

      const names = async (qs: string) =>
        (await request(app).get(`/api/employees${qs}`).expect(200)).body.data.map((x: { fullName: string }) => x.fullName);
      expect(await names('')).toEqual(['Still Here']);
      expect(await names('?status=terminated')).toEqual(['Gone Person']);
      expect(await names('?status=all')).toEqual(['Gone Person', 'Still Here']);
    });

    it('blocks edits to a former employee until reinstated', async () => {
      const { body: e } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      await request(app).post(`/api/employees/${e.id}/terminate`).set('If-Match', '*').send({}).expect(200);
      await request(app).patch(`/api/employees/${e.id}`).set('If-Match', '*').send({ salaryMinor: 1_000 }).expect(409);

      const res = await request(app).post(`/api/employees/${e.id}/reinstate`).set('If-Match', '*').send({}).expect(200);
      expect(res.body).toMatchObject({ status: 'active', terminatedAt: null });
      await request(app).patch(`/api/employees/${e.id}`).set('If-Match', '*').send({ salaryMinor: 1_000 }).expect(200);
    });

    it('rejects double termination, reinstating an active employee and a date before hire', async () => {
      const { body: e } = await request(app).post('/api/employees').send(employeeInput({ hireDate: '2024-04-01' })).expect(201);
      await request(app).post(`/api/employees/${e.id}/terminate`).set('If-Match', '*').send({ terminationDate: '2024-03-31' }).expect(400);
      await request(app).post(`/api/employees/${e.id}/reinstate`).set('If-Match', '*').send({}).expect(409);
      await request(app).post(`/api/employees/${e.id}/terminate`).set('If-Match', '*').send({}).expect(200);
      await request(app).post(`/api/employees/${e.id}/terminate`).set('If-Match', '*').send({}).expect(409);
      await request(app).post('/api/employees/9999/terminate').set('If-Match', '*').send({}).expect(404);
    });

    it("explains when a new hire's email belongs to a former employee", async () => {
      const { body: e } = await request(app).post('/api/employees').send(employeeInput({ email: 'back@acme.example' })).expect(201);
      await request(app).post(`/api/employees/${e.id}/terminate`).set('If-Match', '*').send({}).expect(200);
      const res = await request(app).post('/api/employees').send(employeeInput({ email: 'back@acme.example' })).expect(409);
      expect(res.body.error.message).toMatch(/former employee EMP-000001; reinstate/);
    });
  });

  describe('GET /api/employees', () => {
    beforeEach(async () => {
      const people = [
        employeeInput({ fullName: 'Asha Rao', country: 'IN', currency: 'INR', salaryMinor: 200_000_000 }),
        employeeInput({ fullName: 'Ben Carter', country: 'US', currency: 'USD', department: 'Sales', jobTitle: 'Account Executive', salaryMinor: 9_000_000 }),
        employeeInput({ fullName: 'Chloe 100% Martin', country: 'FR', currency: 'EUR', salaryMinor: 6_000_000 }),
      ];
      for (const p of people) await request(app).post('/api/employees').send(p).expect(201);
    });

    it('paginates and reports totals', async () => {
      const res = await request(app).get('/api/employees?pageSize=2&page=2').expect(200);
      expect(res.body).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
      expect(res.body.data).toHaveLength(1);
    });

    it('filters by country and department', async () => {
      const res = await request(app).get('/api/employees?country=US&department=Sales').expect(200);
      expect(res.body.data.map((e: { fullName: string }) => e.fullName)).toEqual(['Ben Carter']);
    });

    it('treats LIKE wildcards in search literally', async () => {
      const res = await request(app).get('/api/employees?search=100%25').expect(200);
      expect(res.body.data.map((e: { fullName: string }) => e.fullName)).toEqual(['Chloe 100% Martin']);
      const none = await request(app).get('/api/employees?search=_').expect(200);
      expect(none.body.total).toBe(0);
    });

    it('sorts salary by USD equivalent, not by raw local amount', async () => {
      // Asha: 2,000,000 INR (~$22.6k) has the largest raw number but is the lowest paid.
      const res = await request(app).get('/api/employees?sortBy=salary&sortDir=desc').expect(200);
      expect(res.body.data.map((e: { fullName: string }) => e.fullName)).toEqual([
        'Ben Carter', // $90,000
        'Chloe 100% Martin', // EUR 60,000 (~$69.6k)
        'Asha Rao',
      ]);
    });

    it('rejects non-allow-listed sort fields and oversize pages', async () => {
      await request(app).get('/api/employees?sortBy=salary_minor;DROP TABLE employees').expect(400);
      await request(app).get('/api/employees?pageSize=10000').expect(400);
    });
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

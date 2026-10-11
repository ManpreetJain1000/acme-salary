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
        .patch(`/api/employees/${created.id}`)
        .send({ salaryMinor: 260_000_000 })
        .expect(200);
      expect(res.body.salaryMinor).toBe(260_000_000);

      const { body } = await request(app).get(`/api/employees/${created.id}`);
      expect(body.salaryHistory[0]).toMatchObject({ oldSalaryMinor: 240_000_000, newSalaryMinor: 260_000_000 });
      expect(body.salaryHistory).toHaveLength(2);
    });

    it('does not write history when salary is unchanged', async () => {
      const { body: created } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      await request(app).patch(`/api/employees/${created.id}`).send({ jobTitle: 'Senior Software Engineer' }).expect(200);

      const { body } = await request(app).get(`/api/employees/${created.id}`);
      expect(body.salaryHistory).toHaveLength(1);
      expect(body.jobTitle).toBe('Senior Software Engineer');
    });

    it('rejects an empty patch and unknown ids', async () => {
      const { body: created } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      await request(app).patch(`/api/employees/${created.id}`).send({}).expect(400);
      await request(app).patch('/api/employees/9999').send({ fullName: 'Nobody Here' }).expect(404);
    });
  });

  describe('DELETE /api/employees/:id', () => {
    it('deletes the employee and never reuses its code', async () => {
      const { body: first } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      await request(app).delete(`/api/employees/${first.id}`).expect(204);
      await request(app).get(`/api/employees/${first.id}`).expect(404);

      const { body: second } = await request(app).post('/api/employees').send(employeeInput()).expect(201);
      expect(second.employeeCode).toBe('EMP-000002');
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

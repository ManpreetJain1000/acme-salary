import { Router } from 'express';
import type { EmployeeService } from './service.js';
import {
  employeeInputSchema,
  employeeUpdateSchema,
  idParamSchema,
  listQuerySchema,
  terminateSchema,
} from './schemas.js';
import { AppError } from '../http/errors.js';

/** Thin HTTP layer: parse/validate input, call the service, shape the response. */
export function employeeRoutes(service: EmployeeService): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(service.list(listQuerySchema.parse(req.query)));
  });

  router.get('/:id', (req, res) => {
    res.json(service.get(idParamSchema.parse(req.params.id)));
  });

  router.post('/', (req, res) => {
    const created = service.create(employeeInputSchema.parse(req.body));
    res.status(201).location(`/api/employees/${created.id}`).json(created);
  });

  router.patch('/:id', (req, res) => {
    res.json(service.update(idParamSchema.parse(req.params.id), employeeUpdateSchema.parse(req.body)));
  });

  router.post('/:id/terminate', (req, res) => {
    res.json(service.terminate(idParamSchema.parse(req.params.id), terminateSchema.parse(req.body ?? {})));
  });

  router.post('/:id/reinstate', (req, res) => {
    res.json(service.reinstate(idParamSchema.parse(req.params.id)));
  });

  // Salary records are never hard-deleted; point API clients at the right call.
  router.delete('/:id', () => {
    throw new AppError(
      405,
      'METHOD_NOT_ALLOWED',
      'Employees are not deleted. Use POST /api/employees/:id/terminate to record that someone left.',
    );
  });

  return router;
}

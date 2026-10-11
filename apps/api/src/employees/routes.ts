import { Router } from 'express';
import type { EmployeeService } from './service.js';
import {
  employeeInputSchema,
  employeeUpdateSchema,
  idParamSchema,
  listQuerySchema,
} from './schemas.js';

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

  router.delete('/:id', (req, res) => {
    service.delete(idParamSchema.parse(req.params.id));
    res.status(204).end();
  });

  return router;
}

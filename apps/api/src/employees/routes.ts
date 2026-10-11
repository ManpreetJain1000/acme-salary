import { Router, type Request, type Response } from 'express';
import { SYSTEM_ACTOR, type EmployeeService } from './service.js';
import {
  employeeInputSchema,
  employeeUpdateSchema,
  idParamSchema,
  listQuerySchema,
  terminateSchema,
} from './schemas.js';
import { AppError } from '../http/errors.js';

/**
 * Optimistic locking over standard HTTP: reads return ETag "<version>"; writes must
 * send If-Match with it (412 if stale) or "*" to deliberately overwrite. A write
 * without If-Match gets 428, so no client can overwrite silently by accident.
 */
function expectedVersion(req: Request): number | null {
  const header = req.get('if-match')?.trim();
  if (!header) {
    throw new AppError(
      428,
      'PRECONDITION_REQUIRED',
      'Send If-Match with the employee\'s ETag (its version), or * to overwrite deliberately.',
    );
  }
  if (header === '*') return null;
  const match = /^(?:W\/)?"(\d+)"$/.exec(header);
  if (!match) throw new AppError(400, 'BAD_REQUEST', 'If-Match must be an ETag like "3", or *');
  return Number(match[1]);
}

function sendEmployee(res: Response, employee: { version: number }, status = 200) {
  res.status(status).setHeader('ETag', `"${employee.version}"`).json(employee);
}

/** Who to attribute a write to: the signed-in HR user (set by requireAuth). */
const actorOf = (res: Response) => (res.locals.user as string | undefined) ?? SYSTEM_ACTOR;

/** Thin HTTP layer: parse/validate input, call the service, shape the response. */
export function employeeRoutes(service: EmployeeService): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(service.list(listQuerySchema.parse(req.query)));
  });

  router.get('/:id', (req, res) => {
    sendEmployee(res, service.get(idParamSchema.parse(req.params.id)));
  });

  router.post('/', (req, res) => {
    const created = service.create(employeeInputSchema.parse(req.body), actorOf(res));
    res.location(`/api/employees/${created.id}`);
    sendEmployee(res, created, 201);
  });

  router.patch('/:id', (req, res) => {
    const id = idParamSchema.parse(req.params.id);
    sendEmployee(res, service.update(id, employeeUpdateSchema.parse(req.body), expectedVersion(req), actorOf(res)));
  });

  router.post('/:id/terminate', (req, res) => {
    const id = idParamSchema.parse(req.params.id);
    sendEmployee(
      res,
      service.terminate(id, terminateSchema.parse(req.body ?? {}), expectedVersion(req), actorOf(res)),
    );
  });

  router.post('/:id/reinstate', (req, res) => {
    sendEmployee(res, service.reinstate(idParamSchema.parse(req.params.id), expectedVersion(req), actorOf(res)));
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

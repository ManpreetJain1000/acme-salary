import { Router } from 'express';
import { insightFilterSchema, outlierQuerySchema } from './schemas.js';
import type { InsightService } from './service.js';

export function insightRoutes(service: InsightService): Router {
  const router = Router();

  router.get('/summary', (req, res) => {
    res.json(service.summary(insightFilterSchema.parse(req.query)));
  });

  router.get('/pay-bands', (req, res) => {
    res.json({ data: service.payBands(insightFilterSchema.parse(req.query)) });
  });

  router.get('/outliers', (req, res) => {
    res.json(service.outliers(outlierQuerySchema.parse(req.query)));
  });

  return router;
}

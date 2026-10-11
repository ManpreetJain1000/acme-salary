import { z } from 'zod';
import { COUNTRY_CODES, DEPARTMENT_NAMES, JOB_TITLES } from '../domain/reference.js';

export const insightFilterSchema = z.object({
  country: z.enum(COUNTRY_CODES).optional(),
  department: z.enum(DEPARTMENT_NAMES).optional(),
  jobTitle: z.enum(JOB_TITLES).optional(),
});

export const outlierQuerySchema = insightFilterSchema.extend({
  /** Minimum |deviation| from the group median to count as an outlier (0.25 = 25%). */
  threshold: z.coerce.number().min(0.05).max(5).default(0.25),
  minGroupSize: z.coerce.number().int().min(2).max(1000).default(5),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type InsightFilter = z.infer<typeof insightFilterSchema>;
export type OutlierQuery = z.infer<typeof outlierQuerySchema>;

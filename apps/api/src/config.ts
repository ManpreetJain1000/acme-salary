import { z } from 'zod';

const DEMO_PASSWORD = 'acme-demo-2026';
const bool = (fallback: 'true' | 'false') =>
  z.enum(['true', 'false']).default(fallback).transform((v) => v === 'true');

/** Validated configuration. Fails fast at boot instead of misbehaving later. */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_PATH: z.string().default('./data/acme.db'),
    CORS_ORIGIN: z.string().default('http://localhost:3000'),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
    /** Seed an empty database on boot (safe: the seed is idempotent and transactional). */
    SEED_ON_BOOT: bool('true'),

    HR_EMAIL: z.string().email().default('hr@acme.example'),
    /** Required in production; development falls back to the demo password. */
    HR_PASSWORD: z.string().min(12).optional(),
    /** Signs session cookies. Required in production; random per boot in development. */
    SESSION_SECRET: z.string().min(32).optional(),
    /** Secure cookies need HTTPS. Defaults on in production. */
    COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    /** Public demo only: show the demo sign-in on the login page. */
    DEMO_LOGIN_HINT: z.enum(['true', 'false']).optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['HR_PASSWORD', 'SESSION_SECRET'] as const) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
    }
  })
  .transform((env) => {
    const production = env.NODE_ENV === 'production';
    return {
      ...env,
      HR_PASSWORD: env.HR_PASSWORD ?? DEMO_PASSWORD,
      COOKIE_SECURE: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : production,
      DEMO_LOGIN_HINT: env.DEMO_LOGIN_HINT ? env.DEMO_LOGIN_HINT === 'true' : !production,
    };
  });

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(env);
}

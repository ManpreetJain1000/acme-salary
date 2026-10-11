import type { CookieOptions, RequestHandler, Router } from 'express';
import { Router as createRouter } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { verifyPassword } from './password.js';
import { issueToken, readCookie, readToken } from './session.js';

export const SESSION_COOKIE = 'acme_session';

export interface AuthOptions {
  email: string;
  /** From hashPassword(); the plain password is never kept in memory after boot. */
  passwordHash: string;
  sessionSecret: string;
  /** Secure cookies need HTTPS; off only for local plain-HTTP runs. */
  cookieSecure: boolean;
  sessionTtlMs?: number;
  /** Public demo only: expose the demo credentials to the login page. */
  demoPassword?: string;
  /** Failed login attempts allowed per client per 15 minutes. */
  loginAttemptsPer15Min?: number;
  nowMs?: () => number;
}

const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Please sign in');

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().min(1).max(200),
});

export function authRoutes(options: AuthOptions): Router {
  const now = options.nowMs ?? Date.now;
  const ttl = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  const cookie: CookieOptions = {
    httpOnly: true, // unreadable from JavaScript, so XSS can't steal it
    sameSite: 'lax', // not sent on cross-site POSTs (CSRF)
    secure: options.cookieSecure,
    path: '/',
  };
  const router = createRouter();

  router.post(
    '/login',
    // Brute-force guard: only failed attempts count.
    rateLimit({
      windowMs: 15 * 60_000,
      limit: options.loginAttemptsPer15Min ?? 10,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({
          error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again in 15 minutes.' },
        });
      },
    }),
    (req, res) => {
      const { email, password } = loginSchema.parse(req.body);
      // Verify the password even for an unknown email so timing doesn't reveal which was wrong.
      const passwordOk = verifyPassword(password, options.passwordHash);
      if (email !== options.email.toLowerCase() || !passwordOk) {
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
      }
      const token = issueToken({ sub: options.email, exp: now() + ttl }, options.sessionSecret);
      res.cookie(SESSION_COOKIE, token, { ...cookie, maxAge: ttl });
      res.json({ email: options.email });
    },
  );

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookie);
    res.status(204).end();
  });

  router.get('/me', requireAuth(options), (_req, res) => {
    res.json({ email: res.locals.user as string });
  });

  router.get('/demo', (_req, res) => {
    if (!options.demoPassword) throw new AppError(404, 'NOT_FOUND', 'Route not found');
    res.json({ email: options.email, password: options.demoPassword });
  });

  return router;
}

export function requireAuth(options: AuthOptions): RequestHandler {
  const now = options.nowMs ?? Date.now;
  return (req, res, next) => {
    const session = readToken(readCookie(req.get('cookie'), SESSION_COOKIE), options.sessionSecret, now());
    if (!session) {
      next(unauthenticated());
      return;
    }
    res.locals.user = session.sub;
    next();
  };
}

/**
 * Defence in depth against CSRF (SameSite=Lax is the main guard): a cross-site HTML
 * form can only GET or POST, and can't send application/json without a CORS
 * preflight, which we refuse. So every POST must be JSON. PATCH/PUT/DELETE from
 * another site always need a preflight, so they don't need this check.
 */
export const requireJsonForWrites: RequestHandler = (req, _res, next) => {
  if (req.method !== 'POST' || req.get('content-type')?.toLowerCase().startsWith('application/json')) {
    next();
    return;
  }
  next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send requests as application/json'));
};

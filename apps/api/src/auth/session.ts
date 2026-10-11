import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless session token: base64url(JSON {sub, exp}) + "." + HMAC-SHA256 signature.
 * Nothing to store server-side; tampering breaks the signature; exp bounds its life.
 * (Trade-off: a token can't be revoked before it expires except by rotating the
 * secret. A sessions table is the upgrade path if that matters.)
 */
export interface Session {
  sub: string;
  exp: number; // epoch ms
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const sign = (payload: string, secret: string) => createHmac('sha256', secret).update(payload).digest();

export function issueToken(session: Session, secret: string): string {
  const payload = b64(JSON.stringify(session));
  return `${payload}.${b64(sign(payload, secret))}`;
}

export function readToken(token: string | undefined, secret: string, nowMs: number): Session | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = sign(payload, secret);
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    if (typeof session.sub !== 'string' || typeof session.exp !== 'number') return null;
    return session.exp > nowMs ? session : null;
  } catch {
    return null;
  }
}

/** Minimal Cookie header parser: we read exactly one cookie. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

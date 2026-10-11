import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture fitness test for decisions.md D2: application SQL and the database
 * library live only in the repository. Schema (db/) and the bulk seed loader are
 * storage-specific by nature and are the other allowed places.
 */
const SRC = new URL('.', import.meta.url).pathname;
const ALLOWED = ['employees/repository.ts', 'db/', 'seed/seed.ts', 'architecture.test.ts'];
// db.exec, not any .exec: RegExp#exec is fine anywhere.
const SQL_SIGNS = [/\.prepare\(/, /\bdb\.exec\(/, /(?<!repo)\.transaction\(/, /\bSELECT\s/, /\bINSERT\s+INTO\b/, /better-sqlite3/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('architecture', () => {
  it('keeps SQL and the database library inside the repository layer', () => {
    const offenders = files(SRC)
      .map((path) => relative(SRC, path))
      .filter((rel) => !ALLOWED.some((allowed) => rel.startsWith(allowed)))
      .filter((rel) => !rel.endsWith('.test.ts') && rel !== 'test-utils.ts')
      .filter((rel) => SQL_SIGNS.some((sign) => sign.test(readFileSync(join(SRC, rel), 'utf8'))));
    expect(offenders).toEqual([]);
  });
});

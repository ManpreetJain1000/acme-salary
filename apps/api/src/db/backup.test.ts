import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { seedDatabase } from '../seed/seed.js';
import { backupDatabase } from './backup.js';
import { openDatabase } from './database.js';

describe('backupDatabase', () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'acme-backup-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('writes a complete, intact copy of the live database', async () => {
    const db = openDatabase(':memory:');
    seedDatabase(db, { count: 100 });
    const { file } = await backupDatabase(db, tempDir(), { now: new Date('2026-10-11T10:00:00Z') });

    expect(file).toMatch(/acme-2026-10-11T10-00-00-000Z\.db$/);
    const copy = new Database(file, { readonly: true });
    expect(copy.prepare('SELECT COUNT(*) AS n FROM employees').get()).toEqual({ n: 100 });
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    copy.close();
  });

  it('keeps only the newest copies', async () => {
    const db = openDatabase(':memory:');
    const dir = tempDir();
    for (let hour = 1; hour <= 4; hour++) {
      await backupDatabase(db, dir, { keep: 2, now: new Date(`2026-10-11T0${hour}:00:00Z`) });
    }
    expect(readdirSync(dir).sort()).toEqual([
      'acme-2026-10-11T03-00-00-000Z.db',
      'acme-2026-10-11T04-00-00-000Z.db',
    ]);
  });
});

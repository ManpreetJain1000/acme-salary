import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { DB } from './database.js';

export interface BackupResult {
  file: string;
  pruned: string[];
}

const PREFIX = 'acme-';

/**
 * Consistent copy of a live database using SQLite's online backup API: safe while
 * the app is serving and writing (WAL). Each copy is integrity-checked, and only
 * the newest `keep` copies are retained.
 */
export async function backupDatabase(
  db: DB,
  dir: string,
  { keep = 14, now = new Date() }: { keep?: number; now?: Date } = {},
): Promise<BackupResult> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${PREFIX}${now.toISOString().replace(/[:.]/g, '-')}.db`);
  await db.backup(file);

  const copy = new Database(file, { readonly: true });
  try {
    const result = copy.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(`Backup failed integrity check: ${String(result)}`);
  } finally {
    copy.close();
  }

  // ISO timestamps sort chronologically as text.
  const backups = readdirSync(dir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith('.db'))
    .sort();
  const pruned = backups.slice(0, Math.max(0, backups.length - keep));
  for (const name of pruned) rmSync(join(dir, name));
  return { file, pruned };
}

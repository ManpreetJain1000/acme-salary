import { loadConfig } from '../config.js';
import { backupDatabase } from './backup.js';
import { openDatabase } from './database.js';

/**
 * Usage: npm run backup (dev) or node apps/api/dist/db/backup-cli.js (container).
 * Schedule it (e.g. hourly) with the host's cron and ship BACKUP_DIR off the
 * machine; for continuous replication to object storage use Litestream instead.
 */
const config = loadConfig();
const dir = process.env.BACKUP_DIR ?? './backups';
const keep = Number(process.env.BACKUP_KEEP ?? 14);

const db = openDatabase(config.DATABASE_PATH);
try {
  const { file, pruned } = await backupDatabase(db, dir, { keep });
  console.log(`Backup written to ${file}${pruned.length ? `; pruned ${pruned.length} older copies` : ''}`);
} finally {
  db.close();
}

import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { SQLite } from './sqlite.js';
import { dataDir } from './paths.js';
const dir = dataDir(), backups = join(dir, 'backups');
mkdirSync(backups, { recursive: true, mode: 0o700 });
const db = new SQLite(join(dir, 'quota.db'), { readonly: true, fileMustExist: true });
try {
  const path = join(backups, 'quota-' + new Date().toISOString().replaceAll(':', '-') + '.db');
  await db.backup(path);
  console.log('Backup saved: ' + path);
} finally { db.close(); }

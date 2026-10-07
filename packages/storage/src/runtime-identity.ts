import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from './native-database.mjs';

export function runtimeIdentity(dataDir?: string): string {
  if (!dataDir) return randomUUID();
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(join(dataDir, 'metadata.db'));
  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS runtime_identity (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.prepare('INSERT OR IGNORE INTO runtime_identity(key,value) VALUES(?,?)').run('runtime_id', randomUUID());
    const row = db.prepare('SELECT value FROM runtime_identity WHERE key = ?').get('runtime_id') as { value: string };
    return row.value;
  } finally { db.close(); }
}

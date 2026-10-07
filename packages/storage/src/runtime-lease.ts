import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from './native-database.mjs';

/** Atomic local-process ownership. Never reclaims a live or unverifiable owner. */
export class RuntimeLease {
  private db?: Database.Database;
  private readonly token = randomUUID();
  constructor(dataDir?: string) {
    if (!dataDir) return;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const db = new Database(join(dataDir, 'metadata.db'));
    try {
      db.pragma('journal_mode = WAL');
      db.exec('CREATE TABLE IF NOT EXISTS runtime_owner (slot INTEGER PRIMARY KEY CHECK(slot=1), pid INTEGER NOT NULL, host TEXT NOT NULL, token TEXT NOT NULL)');
      db.transaction(() => {
        const owner = db.prepare('SELECT pid,host FROM runtime_owner WHERE slot=1').get() as {pid:number;host:string}|undefined;
        if (owner) {
          let alive = true;
          if (owner.host === hostname() && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
            try { process.kill(owner.pid, 0); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; }
          }
          if (alive) throw Object.assign(new Error('Runtime data directory is already in use; stop its existing Runtime before starting another'), {code:'RUNTIME_IN_USE'});
        }
        db.prepare('INSERT INTO runtime_owner(slot,pid,host,token) VALUES(1,?,?,?) ON CONFLICT(slot) DO UPDATE SET pid=excluded.pid,host=excluded.host,token=excluded.token').run(process.pid,hostname(),this.token);
      }).immediate();
      this.db = db;
    } catch (error) { db.close(); throw error; }
  }
  close() {
    const db = this.db;
    if (!db) return;
    this.db = undefined;
    try { db.prepare('DELETE FROM runtime_owner WHERE slot=1 AND token=?').run(this.token); }
    finally { db.close(); }
  }
}

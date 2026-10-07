import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { agentSnapshot } from '../../protocol/src/index.js';
import Database from './native-database.mjs';
import type { AgentSnapshot } from '../../ai-core/src/agent.js';

export type SavedAgentRun = { snapshot: AgentSnapshot; signature: string; requestId: string; requestHash: string; nextRunId?: string; createdAt: number };
/** Bounded checkpoint journal. Restoring a record never restores a running tool loop. */
export class AgentRunStore {
  private readonly db: Database.Database;
  readonly persistent: boolean;
  constructor(dataDir?: string) {
    this.persistent = !!dataDir;
    if (dataDir) mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new Database(dataDir ? join(dataDir, 'metadata.db') : ':memory:');
    this.db.pragma('journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, snapshot TEXT NOT NULL, signature TEXT NOT NULL, request_id TEXT UNIQUE NOT NULL, request_hash TEXT NOT NULL, next_run_id TEXT, created_at INTEGER NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS agent_request_keys (request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, run_id TEXT NOT NULL); INSERT OR IGNORE INTO agent_request_keys SELECT request_id,request_hash,id FROM agent_runs');
    for (const record of this.all()) {
      if (['running', 'awaiting_approval', 'cancelling'].includes(record.snapshot.status)) {
        record.snapshot.status = 'failed';
        record.snapshot.error = 'Runtime restarted during this task. Completed steps are retained; check execution history for unknown outcomes. No tools or writes were replayed.';
        delete record.snapshot.pendingApproval;
        this.save(record.snapshot);
      }
    }
  }
  private decode(row: unknown): SavedAgentRun | undefined {
    if (!row) return;
    const item = row as { snapshot: string; signature: string; request_id: string; request_hash: string; next_run_id?: string; created_at: number };
    return { snapshot: agentSnapshot.parse(JSON.parse(item.snapshot)), signature: item.signature, requestId: item.request_id, requestHash: item.request_hash, nextRunId: item.next_run_id ?? undefined, createdAt: item.created_at };
  }
  get(id: string) { return this.decode(this.db.prepare('SELECT * FROM agent_runs WHERE id=?').get(id)); }
  byRequest(id: string) {
    const row = this.db.prepare('SELECT request_hash,run_id FROM agent_request_keys WHERE request_id=?').get(id) as {request_hash:string;run_id:string}|undefined;
    return row && { requestHash: row.request_hash, id: row.run_id, available: !!this.get(row.run_id) };
  }
  all(): SavedAgentRun[] { return this.db.prepare('SELECT * FROM agent_runs ORDER BY created_at, rowid').all().map(row => this.decode(row)!); }
  private encode(snapshot: AgentSnapshot) {
    const json = JSON.stringify(snapshot);
    if (Buffer.byteLength(json) > 1024 * 1024) throw new Error('Agent checkpoint exceeds budget');
    return json;
  }
  begin(record: SavedAgentRun, previousId?: string) {
    this.db.transaction(() => {
      const count = (this.db.prepare('SELECT count(*) AS n FROM agent_request_keys').get() as {n:number}).n;
      if (count >= 100000) throw new Error('Agent request ledger is full; no requests were replayed');
      this.db.prepare('INSERT INTO agent_request_keys VALUES(?,?,?)').run(record.requestId, record.requestHash, record.snapshot.id);
      if (previousId) {
        const parent = this.get(previousId);
        if (!parent || parent.signature !== record.signature || parent.nextRunId) throw new Error('Conversation changed');
        this.db.prepare('UPDATE agent_runs SET next_run_id=? WHERE id=?').run(record.snapshot.id, previousId);
      }
      this.db.prepare('INSERT INTO agent_runs(id,snapshot,signature,request_id,request_hash,created_at) VALUES(?,?,?,?,?,?)').run(record.snapshot.id, this.encode(record.snapshot), record.signature, record.requestId, record.requestHash, record.createdAt);
      this.db.prepare('DELETE FROM agent_runs WHERE id NOT IN (SELECT id FROM agent_runs ORDER BY created_at DESC,rowid DESC LIMIT 32)').run();
    }).immediate();
  }
  save(snapshot: AgentSnapshot) {
    const result = this.db.prepare('UPDATE agent_runs SET snapshot=? WHERE id=?').run(this.encode(snapshot), snapshot.id);
    if (result.changes !== 1) throw new Error('Agent checkpoint unavailable');
  }
  close() { this.db.close(); }
}

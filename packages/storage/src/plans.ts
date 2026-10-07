import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from './native-database.mjs';
import type { SqlStep } from '../../core/src/sql.js';

export type StoredPlan = {
  id: string;
  connectionId: string;
  connectionVersion: number;
  database?: string;
  steps: SqlStep[];
  source: 'human' | 'ai';
  approved: boolean;
  consumed: boolean;
  createdAt: number;
  executionId?: string;
  clientRequestId?: string;
  requestHash?: string;
  policyHash?: string;
};

type PlanRow = { id: string; connection_id: string; connection_version: number; steps: string; source: 'human' | 'ai'; approved: number; consumed: number; created_at: number; execution_id: string | null; client_request_id: string | null; request_hash: string | null; policy_hash: string | null; target_database: string | null };

export class PlanStore {
  private readonly memory = new Map<string, StoredPlan>();
  private readonly db?: Database.Database;

  constructor(dataDir?: string) {
    if (!dataDir) return;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new Database(join(dataDir, 'metadata.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, connection_version INTEGER NOT NULL, steps TEXT NOT NULL, source TEXT NOT NULL, approved INTEGER NOT NULL, consumed INTEGER NOT NULL, created_at INTEGER NOT NULL, execution_id TEXT)');
    const columns = new Set((this.db.pragma('table_info(plans)') as { name: string }[]).map(column => column.name));
    if (!columns.has('client_request_id')) this.db.exec('ALTER TABLE plans ADD COLUMN client_request_id TEXT');
    if (!columns.has('request_hash')) this.db.exec('ALTER TABLE plans ADD COLUMN request_hash TEXT');
    if (!columns.has('target_database')) this.db.exec('ALTER TABLE plans ADD COLUMN target_database TEXT');
    if (!columns.has('policy_hash')) this.db.exec('ALTER TABLE plans ADD COLUMN policy_hash TEXT');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS plans_client_request_id ON plans(client_request_id) WHERE client_request_id IS NOT NULL');
  }

  add(plan: StoredPlan) {
    if (this.db) this.db.prepare('INSERT INTO plans(id,connection_id,connection_version,steps,source,approved,consumed,created_at,client_request_id,request_hash,policy_hash,target_database) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(plan.id, plan.connectionId, plan.connectionVersion, JSON.stringify(plan.steps), plan.source, Number(plan.approved), Number(plan.consumed), plan.createdAt, plan.clientRequestId ?? null, plan.requestHash ?? null, plan.policyHash ?? null, plan.database ?? null);
    else this.memory.set(plan.id, { ...plan, steps: plan.steps.map(step => ({ ...step })) });
  }

  get(id: string): StoredPlan | undefined {
    if (!this.db) return this.memory.get(id);
    const row = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as PlanRow | undefined;
    return row && { id: row.id, connectionId: row.connection_id, connectionVersion: row.connection_version, steps: JSON.parse(row.steps) as SqlStep[], source: row.source, approved: !!row.approved, consumed: !!row.consumed, createdAt: row.created_at, executionId: row.execution_id ?? undefined, clientRequestId: row.client_request_id ?? undefined, requestHash: row.request_hash ?? undefined, policyHash: row.policy_hash ?? undefined, database: row.target_database ?? undefined };
  }

  findByClientRequestId(clientRequestId: string): StoredPlan | undefined {
    if (!this.db) return [...this.memory.values()].find(plan => plan.clientRequestId === clientRequestId);
    const row = this.db.prepare('SELECT id FROM plans WHERE client_request_id = ?').get(clientRequestId) as { id: string } | undefined;
    return row ? this.get(row.id) : undefined;
  }

  findByExecutionId(executionId: string): StoredPlan | undefined {
    if (!this.db) return [...this.memory.values()].find(plan => plan.executionId === executionId);
    const row = this.db.prepare('SELECT id FROM plans WHERE execution_id = ?').get(executionId) as {id:string} | undefined;
    return row ? this.get(row.id) : undefined;
  }

  listExecuted(connectionId: string, limit = 50): StoredPlan[] {
    const boundedLimit = Math.max(1, Math.min(100, limit));
    if (!this.db) return [...this.memory.values()].filter(plan => plan.connectionId === connectionId && !!plan.executionId)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, boundedLimit);
    const rows = this.db.prepare('SELECT id FROM plans WHERE connection_id = ? AND execution_id IS NOT NULL ORDER BY created_at DESC LIMIT ?')
      .all(connectionId, boundedLimit) as { id: string }[];
    return rows.map(row => this.get(row.id)!);
  }

  decide(id: string, decision: 'approve' | 'reject'): boolean {
    if (!this.db) {
      const plan = this.memory.get(id);
      if (!plan || plan.consumed) return false;
      if (decision === 'approve') plan.approved = true;
      else plan.consumed = true;
      return true;
    }
    const changes = this.db.prepare('UPDATE plans SET approved = ?, consumed = ? WHERE id = ? AND consumed = 0')
      .run(decision === 'approve' ? 1 : 0, decision === 'reject' ? 1 : 0, id).changes;
    return changes === 1;
  }

  claim(id: string, executionId: string, auditIntent?: { connectionId: string; sqlHash: string }): boolean {
    if (!this.db) {
      const plan = this.memory.get(id);
      if (!plan || plan.consumed) return false;
      plan.consumed = true;
      plan.executionId = executionId;
      return true;
    }
    const transaction = this.db.transaction(() => {
      const updated = this.db!.prepare('UPDATE plans SET consumed = 1, execution_id = ? WHERE id = ? AND consumed = 0').run(executionId, id);
      if (updated.changes !== 1) return false;
      this.db!.prepare('INSERT INTO executions(id,status,results,updated_at) VALUES(?,?,?,?)').run(executionId, 'running', '[]', Date.now());
      if (auditIntent) this.db!.prepare('INSERT INTO audit_events(id,action,plan_id,execution_id,connection_id,sql_hash,status,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), 'execution_intent', id, executionId, auditIntent.connectionId, auditIntent.sqlHash, null, Date.now());
      return true;
    });
    return transaction.immediate();
  }

  pruneExpiredUnconsumed(cutoff: number): number {
    if (this.db) return this.db.prepare('DELETE FROM plans WHERE consumed = 0 AND created_at < ?').run(cutoff).changes;
    let removed = 0;
    for (const [id, plan] of this.memory) {
      if (!plan.consumed && plan.createdAt < cutoff) { this.memory.delete(id); removed++; }
    }
    return removed;
  }

  close() { this.db?.close(); }
}

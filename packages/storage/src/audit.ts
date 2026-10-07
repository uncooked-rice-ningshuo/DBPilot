import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from './native-database.mjs';

export type AuditAction = 'ai_settings_changed' | 'policy_changed' | 'connection_change_intent' | 'connection_changed' | 'model_outbound' | 'agent_tool' | 'plan_created' | 'approval_decided' | 'execution_intent' | 'execution_finished' | 'cancel_requested';
export type AuditEvent = { runId?: string; toolCallId?: string; stepId?: number; modelId?: string; provider?: string; id: string; action: AuditAction; planId?: string; executionId?: string; connectionId?: string; sqlHash?: string; status?: string; createdAt: number };

export function hashSql(sql: string): string { return createHash('sha256').update(sql).digest('hex'); }

export class AuditStore {
  private readonly db?: Database.Database;
  private readonly memory: AuditEvent[] = [];
  constructor(dataDir?: string) {
    if (!dataDir) return;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new Database(join(dataDir, 'metadata.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, plan_id TEXT, execution_id TEXT, connection_id TEXT, sql_hash TEXT, status TEXT, created_at INTEGER NOT NULL)');
    this.db.exec('CREATE INDEX IF NOT EXISTS audit_events_created_at ON audit_events(created_at)');
    const columns = new Set((this.db.pragma('table_info(audit_events)') as {name:string}[]).map(column => column.name));
    for (const [name, type] of [['run_id','TEXT'],['tool_call_id','TEXT'],['step_id','INTEGER'],['model_id','TEXT'],['provider','TEXT']]) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE audit_events ADD COLUMN ${name} ${type}`);
    }
  }
  append(input: Omit<AuditEvent, 'id' | 'createdAt'>): AuditEvent {
    const event = { ...input, id: randomUUID(), createdAt: Date.now() };
    if (this.db) this.db.prepare('INSERT INTO audit_events(id,action,plan_id,execution_id,connection_id,sql_hash,status,created_at,run_id,tool_call_id,step_id,model_id,provider) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(event.id, event.action, event.planId ?? null, event.executionId ?? null, event.connectionId ?? null, event.sqlHash ?? null, event.status ?? null, event.createdAt, event.runId ?? null, event.toolCallId ?? null, event.stepId ?? null, event.modelId ?? null, event.provider ?? null);
    else this.memory.push(event);
    return event;
  }
  list(executionId?: string): AuditEvent[] {
    if (!this.db) return this.memory.filter(event => !executionId || event.executionId === executionId);
    const rows = this.db.prepare(`SELECT id, action, plan_id AS planId, execution_id AS executionId, connection_id AS connectionId, sql_hash AS sqlHash, status, created_at AS createdAt, run_id AS runId, tool_call_id AS toolCallId, step_id AS stepId, model_id AS modelId, provider FROM audit_events ${executionId ? 'WHERE execution_id = ?' : ''} ORDER BY created_at, rowid`).all(...(executionId ? [executionId] : [])) as AuditEvent[];
    return rows;
  }
  close() { this.db?.close(); }
}

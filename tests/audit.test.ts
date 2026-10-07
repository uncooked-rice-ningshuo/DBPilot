import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { AuditStore, hashSql } from '../packages/storage/src/audit.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('durable audit', () => {
  it('records connection lifecycle without exposing its configured path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-audit-')); dirs.push(dir);
    const filename = join(dir, 'private-target.db');
    const db = new Database(filename); db.close();
    const app = await createApp({ dataDir: dir });
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'target', filename } });
      const id = created.json().id as string;
      expect(created.statusCode).toBe(201);
      expect((await app.inject({ method: 'PUT', url: `/api/v1/connections/${id}`, payload: { engine: 'sqlite', name: 'renamed', filename } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/connections/${id}` })).statusCode).toBe(204);
      const audit = new AuditStore(dir);
      expect(audit.list().filter(event => event.action === 'connection_changed').map(event => event.status)).toEqual(['created', 'updated', 'deleted']);
      expect(JSON.stringify(audit.list())).not.toContain(filename);
      audit.close();
    } finally { await app.close(); }
  });

  it('blocks model data outbound when audit cannot be written', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-audit-')); dirs.push(dir);
    const filename = join(dir, 'target.db');
    const db = new Database(filename); db.exec('CREATE TABLE items(value TEXT)'); db.close();
    const aiFetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const app = await createApp({ dataDir: dir, ai: { apiKey: 'test-key', model: 'test-model' }, aiFetch });
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'target', filename } });
      const metadata = new Database(join(dir, 'metadata.db'));
      metadata.exec("CREATE TRIGGER block_model_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'model_outbound' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
      metadata.close();
      const response = await app.inject({ method: 'POST', url: '/api/v1/ai/drafts', payload: { connectionId: created.json().id, request: 'List items' } });
      expect(response.statusCode).toBe(503);
      expect(aiFetch).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it('records plan and execution intent without storing SQL text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-audit-')); dirs.push(dir);
    const filename = join(dir, 'target.db');
    const db = new Database(filename); db.exec('CREATE TABLE items(value TEXT)'); db.close();
    const app = await createApp({ dataDir: dir });
    try {
      const connection = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'target', filename } });
      const sql = "INSERT INTO items(value) VALUES ('private value')";
      const plan = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId: connection.json().id, sql, source: 'human' } });
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.json().id } });
      expect(started.statusCode).toBe(202);
      for (let i = 0; i < 50; i++) {
        const state = await app.inject({ method: 'GET', url: `/api/v1/executions/${started.json().executionId}` });
        if (state.json().status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const audit = new AuditStore(dir);
      const events = audit.list(started.json().executionId);
      expect(events.map(event => event.action)).toEqual(['execution_intent', 'execution_finished']);
      expect(events[0].sqlHash).toBe(hashSql(sql));
      expect(JSON.stringify(audit.list())).not.toContain('private value');
      audit.close();
    } finally { await app.close(); }
  });

  it('rejects execution before database access when audit intent cannot be saved', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-audit-')); dirs.push(dir);
    const filename = join(dir, 'target.db');
    const db = new Database(filename); db.exec('CREATE TABLE items(value TEXT)'); db.close();
    const app = await createApp({ dataDir: dir });
    try {
      const connection = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'target', filename } });
      const plan = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId: connection.json().id, sql: "INSERT INTO items(value) VALUES ('blocked')", source: 'human' } });
      const metadata = new Database(join(dir, 'metadata.db'));
      metadata.exec("CREATE TRIGGER block_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'execution_intent' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
      metadata.close();
      expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.json().id } })).statusCode).toBe(503);
      const planAfter = await app.inject({ method: 'GET', url: `/api/v1/command-plans/${plan.json().id}` });
      expect(planAfter.json().consumed).toBe(false);
      const metadataAfter = new Database(join(dir, 'metadata.db'));
      expect(metadataAfter.prepare('SELECT COUNT(*) AS count FROM executions').get()).toEqual({ count: 0 });
      metadataAfter.close();
      const target = new Database(filename);
      expect(target.prepare('SELECT * FROM items').all()).toEqual([]);
      target.close();
    } finally { await app.close(); }
  });
});

it('upgrades old audit tables without deleting existing records',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-audit-upgrade-'));dirs.push(dir);
 const db=new Database(join(dir,'metadata.db'));
 db.exec("CREATE TABLE audit_events (id TEXT PRIMARY KEY, action TEXT NOT NULL, plan_id TEXT, execution_id TEXT, connection_id TEXT, sql_hash TEXT, status TEXT, created_at INTEGER NOT NULL); INSERT INTO audit_events(id,action,status,created_at) VALUES('old','agent_tool','list_connections',1)");db.close();
 const audit=new AuditStore(dir);
 try{audit.append({action:'agent_tool',runId:'run',toolCallId:'tool',stepId:1,status:'command_reference'});const events=audit.list();expect(events).toHaveLength(2);expect(events[0]).toMatchObject({id:'old',status:'list_connections'});expect(events[1]).toMatchObject({runId:'run',toolCallId:'tool',stepId:1});}finally{audit.close();}
});

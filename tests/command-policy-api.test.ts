import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../apps/server/src/app.js';

it('enforces rules for both sources and invalidates persisted approvals after rule changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-policy-'));
  const filename = join(dir, 'target.db');
  new Database(filename).close();
  let app = await createApp({ dataDir: dir });
  try {
    const connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { name: 'policy', engine: 'sqlite', filename } })).json().id;
    const prepare = async (sql: string, source = 'ai') => (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql, source } })).json();
    expect((await prepare('SELECT 42')).approvalRequired).toBe(true);
    await app.close();
    const rules = [{ connectionId, kind: 'read' as const, decision: 'allow' as const, exactSql: 'SELECT 42' }];
    app = await createApp({ dataDir: dir, commandRules: rules });
    const allowed = await prepare('SELECT 42');
    expect(allowed.approvalRequired).toBe(false);
    const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: allowed.id } });
    expect(started.statusCode).toBe(202);
    const waiting = await prepare('SELECT 43');
    expect(waiting.approvalRequired).toBe(true);
    expect((await app.inject({ method: 'POST', url: `/api/v1/approvals/${waiting.id}/decision`, payload: { decision: 'approve' } })).statusCode).toBe(200);
    await app.close();
    app = await createApp({ dataDir: dir, commandRules: [...rules, { connectionId, kind: 'write', decision: 'deny' }] });
    expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: waiting.id } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: allowed.id } })).json()).toMatchObject({ executionId: started.json().executionId, replayed: true });
    for (const source of ['human', 'ai']) {
      const denied = await prepare('INSERT INTO items VALUES (1)', source);
      expect(denied.steps[0].decision).toBe('deny');
      expect((await app.inject({ method: 'POST', url: `/api/v1/approvals/${denied.id}/decision`, payload: { decision: 'approve' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: denied.id } })).statusCode).toBe(403);
    }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('requires one approval for mixed plans and never replays an allowed write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-policy-write-'));
  const filename = join(dir, 'target.db');
  const db = new Database(filename); db.exec('CREATE TABLE items(value INTEGER)');
  let app = await createApp({ dataDir: dir });
  try {
    const connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { name: 'writes', engine: 'sqlite', filename } })).json().id;
    await app.close();
    app = await createApp({ dataDir: dir, commandRules: [{ connectionId, kind: 'write', decision: 'allow', exactSql: 'INSERT INTO items VALUES (1)' }] });
    const plan = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, source: 'ai', sql: 'INSERT INTO items VALUES (1); INSERT INTO items VALUES (2)' } })).json();
    expect(plan.steps.map((step: { decision: string }) => step.decision)).toEqual(['allow', 'ask']);
    expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.id } })).statusCode).toBe(403);
    expect(db.prepare('SELECT * FROM items').all()).toEqual([]);
    expect((await app.inject({ method: 'POST', url: `/api/v1/approvals/${plan.id}/decision`, payload: { decision: 'approve' } })).statusCode).toBe(200);
    const started = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.id } })).json();
    let state;
    for (let i = 0; i < 100; i++) {
      state = (await app.inject(`/api/v1/executions/${started.executionId}`)).json();
      if (state.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(state.status).toBe('succeeded');
    expect(db.prepare('SELECT value FROM items ORDER BY value').all()).toEqual([{ value: 1 }, { value: 2 }]);
    expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.id } })).json()).toMatchObject({ executionId: started.executionId, replayed: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM items').get()).toEqual({ n: 2 });
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

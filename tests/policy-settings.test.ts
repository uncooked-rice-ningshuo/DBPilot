import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';

it('persists versioned policy updates, rejects stale saves and invalidates old plans even after reverting rules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-settings-'));
  let app = await createApp({ dataDir: dir });
  try {
    const initial = await app.inject('/api/v1/command-policy');
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({ revision: 0, rules: [], readOnly: false, persistent: true });
    const connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { name: 'test', engine: 'sqlite', filename: join(dir, 'target.db') } })).json().id;
    const prepare = async () => (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT 42', source: 'ai' } })).json();
    const old = await prepare();
    const rules = [{ connectionId, kind: 'read', decision: 'allow', exactSql: 'SELECT 42' }];
    const save = (revision: number, rules: unknown[]) => app.inject({ method: 'PUT', url: '/api/v1/command-policy', payload: { revision, rules } });
    expect((await save(0, rules)).json()).toMatchObject({ revision: 1, rules });
    expect((await prepare()).approvalRequired).toBe(false);
    expect((await save(0, [])).statusCode).toBe(409);
    expect((await save(1, [{ connectionId, kind: 'read', decision: 'allow' }])).statusCode).toBe(400);
    expect((await save(1, [])).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: `/api/v1/approvals/${old.id}/decision`, payload: { decision: 'approve' } })).statusCode).toBe(403);
    await app.close(); app = await createApp({ dataDir: dir });
    expect((await app.inject('/api/v1/command-policy')).json()).toMatchObject({ revision: 2, rules: [] });
    const db = new Database(join(dir, 'metadata.db'));
    expect(db.prepare("SELECT count(*) AS n FROM audit_events WHERE action = 'policy_changed'").get()).toEqual({ n: 2 });
    db.exec("CREATE TRIGGER reject_policy_audit BEFORE INSERT ON audit_events WHEN NEW.action = 'policy_changed' BEGIN SELECT RAISE(ABORT, 'unavailable'); END");
    expect((await save(2, rules)).statusCode).toBe(503);
    expect((await app.inject('/api/v1/command-policy')).json()).toMatchObject({ revision: 2, rules: [] });
    db.close();
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('treats explicit file rules including empty rules as read-only and preserves saved settings underneath', async () => {
  const app = await createApp({ commandRules: [] });
  try {
    expect((await app.inject('/api/v1/command-policy')).json()).toMatchObject({ source: 'configuration', readOnly: true });
    expect((await app.inject({ method: 'PUT', url: '/api/v1/command-policy', payload: { revision: 0, rules: [] } })).statusCode).toBe(403);
  } finally { await app.close(); }
});

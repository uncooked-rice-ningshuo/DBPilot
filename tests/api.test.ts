import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function setup(options: Parameters<typeof createApp>[0] = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-api-')); dirs.push(dir);
  const filename = join(dir, 'test.db');
  const db = new Database(filename); db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT)'); db.close();
  const app = await createApp(options);
  const created = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'test', filename } });
  expect(created.statusCode).toBe(201);
  return { app, filename, connectionId: created.json().id as string };
}
async function waitForExecution(app: Awaited<ReturnType<typeof createApp>>, id: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const response = await app.inject({ method: 'GET', url: `/api/v1/executions/${id}` });
    if (response.json().status !== 'running') return response;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Execution did not finish within test timeout');
}

describe('execution API', () => {
  it('rechecks persisted plans against current SQL policy before approval or execution', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dbpilot-policy-')); dirs.push(dataDir);
    const { app, connectionId } = await setup({ dataDir });
    const plan = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT 1', source: 'ai' } })).json();
    await app.close();
    // Simulate a plan saved by an older classifier which allowed arbitrary calls.
    const metadata = new Database(join(dataDir, 'metadata.db'));
    metadata.prepare('UPDATE plans SET steps = ?, approved = 1 WHERE id = ?').run(JSON.stringify([{ sql: 'SELECT custom_mutation()', kind: 'read', decision: 'allow' }]), plan.id);
    metadata.close();
    const reopened = await createApp({ dataDir });
    try {
      expect((await reopened.inject({ method: 'POST', url: `/api/v1/approvals/${plan.id}/decision`, payload: { decision: 'approve' } })).statusCode).toBe(403);
      expect((await reopened.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.id } })).statusCode).toBe(403);
      expect((await reopened.inject(`/api/v1/command-plans/${plan.id}`)).json().consumed).toBe(false);
    } finally { await reopened.close(); }
  });
  it.each([['SELECT * FROM items', 'cancelled'], ["INSERT INTO items(name) VALUES ('late')", 'outcome_unknown']])('stops active queries before closing persistent runtime storage: %s', async (sql, expected) => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dbpilot-shutdown-')); dirs.push(dataDir);
    const { app, filename, connectionId } = await setup({ dataDir });
    const blocker = new Database(filename);
    blocker.exec('BEGIN EXCLUSIVE');
    const prepared = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql, source: 'human' } })).json();
    const started = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.id } })).json();
    await app.close();
    const reopened = await createApp({ dataDir });
    try {
      const state = (await reopened.inject(`/api/v1/executions/${started.executionId}`)).json();
      expect(state.status).toBe(expected);
      expect(state.results[0].status).toBe(expected);
      const replay = (await reopened.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.id } })).json();
      expect(replay).toMatchObject({ executionId: started.executionId, replayed: true });
      expect(blocker.prepare('SELECT count(*) AS count FROM items').get()).toEqual({ count: 0 });
    } finally { blocker.exec('ROLLBACK'); blocker.close(); await reopened.close(); }
  });
  it('rejects excess executions without consuming their plans and frees capacity after cancellation', async () => {
    const { app, filename, connectionId } = await setup({ maxConcurrentExecutions: 1 });
    const blocker = new Database(filename);
    blocker.exec('BEGIN EXCLUSIVE');
    try {
      const prepare = async () => (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT * FROM items', source: 'human' } })).json().id;
      const firstPlan = await prepare();
      const first = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: firstPlan } })).json();
      const nextPlan = await prepare();
      const denied = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: nextPlan } });
      expect(denied.statusCode).toBe(429);
      const replay = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: firstPlan } });
      expect(replay.json()).toMatchObject({ executionId: first.executionId, replayed: true });
      expect((await app.inject(`/api/v1/command-plans/${nextPlan}`)).json().consumed).toBe(false);
      await app.inject({ method: 'POST', url: `/api/v1/executions/${first.executionId}/cancel` });
      await waitForExecution(app, first.executionId);
      blocker.exec('ROLLBACK');
      const next = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: nextPlan } });
      expect(next.statusCode).toBe(202);
      expect((await waitForExecution(app, next.json().executionId)).json().status).toBe('succeeded');
      expect((await app.inject('/api/v1/runtime')).json().limits.maxConcurrentExecutions).toBe(1);
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); blocker.close(); await app.close(); }
  });
  it('enforces the SQLite execution budget without a user cancellation request', async () => {
    const { app, filename, connectionId } = await setup({ queryTimeoutMs: 100 });
    const blocker = new Database(filename);
    blocker.exec('BEGIN EXCLUSIVE');
    try {
      for (const [sql, expected] of [['SELECT * FROM items', 'cancelled'], ["INSERT INTO items(name) VALUES ('late')", 'outcome_unknown'], ["BEGIN; INSERT INTO items(name) VALUES ('late'); COMMIT", 'outcome_unknown']] as const) {
        const plan = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql, source: 'human' } })).json();
        const started = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.id } })).json();
        const state = (await waitForExecution(app, started.executionId)).json();
        expect(state.status).toBe(expected);
        expect(state.results.some((step: { error?: string }) => step.error?.includes('time budget'))).toBe(true);
      }
    } finally { blocker.exec('ROLLBACK'); blocker.close(); await app.close(); }
  });
  it.each([false, true])('preserves SQLite integer boundaries and positional cells (transaction=%s)', async transaction => {
    const { app, connectionId } = await setup();
    try {
      const query = "SELECT 9007199254740993 AS value, -9223372036854775808 AS value, 9223372036854775807 AS maximum, 42 AS small, NULL AS missing, 1.25 AS fraction, '2026-10-07T12:00:00+08:00' AS timestamp";
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: transaction ? `BEGIN; ${query}; COMMIT` : query, source: 'human' } });
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } });
      const id = started.json().executionId;
      expect((await waitForExecution(app, id)).json().status).toBe('succeeded');
      const page = await app.inject(`/api/v1/executions/${id}/results/${transaction ? 1 : 0}`);
      expect(page.json().columns).toEqual(['value', 'value', 'maximum', 'small', 'missing', 'fraction', 'timestamp']);
      expect(page.json().rows).toEqual([['9007199254740993', '-9223372036854775808', '9223372036854775807', 42, null, 1.25, '2026-10-07T12:00:00+08:00']]);
    } finally { await app.close(); }
  });
  it('explains a missing encryption key, then saves and restores a network connection with one', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dbpilot-network-profile-')); dirs.push(dataDir);
    const profile = { engine: 'mysql', name: 'network', host: '127.0.0.1', port: 3306, database: 'sample', user: 'root', password: 'test-secret', ssl: false };
    const unconfigured = await createApp({ dataDir });
    try {
      const denied = await unconfigured.inject({ method: 'POST', url: '/api/v1/connections', payload: profile });
      expect(denied.statusCode).toBe(503);
      expect(denied.json().error).toContain('DBPILOT_MASTER_KEY');
      expect(denied.body).not.toContain(profile.password);
    } finally { await unconfigured.close(); }

    const masterKey = randomBytes(32).toString('base64');
    const configured = await createApp({ dataDir, masterKey });
    let id: string;
    try {
      const created = await configured.inject({ method: 'POST', url: '/api/v1/connections', payload: profile });
      expect(created.statusCode).toBe(201);
      expect(created.body).not.toContain(profile.password);
      id = created.json().id as string;
    } finally { await configured.close(); }
    const reopened = await createApp({ dataDir, masterKey });
    try {
      const listed = await reopened.inject('/api/v1/connections');
      expect(listed.statusCode).toBe(200);
      expect(listed.json()).toMatchObject([{ id, name: 'network', engine: 'mysql' }]);
      expect(listed.body).not.toContain(profile.password);
    } finally { await reopened.close(); }
  });
  it('tests a saved or unsaved SQLite connection and explains an invalid path', async () => {
    const { app, filename, connectionId } = await setup();
    try {
      const saved = await app.inject({ method: 'POST', url: `/api/v1/connections/${connectionId}/test` });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toEqual({ ok: true });
      const draft = await app.inject({ method: 'POST', url: '/api/v1/connections/test', payload: { engine: 'sqlite', name: 'draft', filename } });
      expect(draft.statusCode).toBe(200);
      const missing = await app.inject({ method: 'POST', url: '/api/v1/connections/test', payload: { engine: 'sqlite', name: 'missing', filename: `${filename}.missing` } });
      expect(missing.statusCode).toBe(502);
      expect(missing.json().error).toContain('SQLite 文件无法打开');
      const invalid = await app.inject({ method: 'POST', url: '/api/v1/connections/test', payload: { engine: 'sqlite', name: 'draft' } });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error).toContain('连接参数');
    } finally { await app.close(); }
  });
  it('lists executed SQL and status after a runtime restart', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dbpilot-history-')); dirs.push(dataDir);
    const { app, connectionId } = await setup({ dataDir });
    const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT 1', source: 'human' } });
    const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } });
    const executionId = started.json().executionId as string;
    await waitForExecution(app, executionId);
    await app.close();
    const reopened = await createApp({ dataDir });
    try {
      const response = await reopened.inject({ method: 'GET', url: `/api/v1/executions?connectionId=${connectionId}` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject([{ id: executionId, sql: 'SELECT 1', status: 'succeeded', steps: [{ sql: 'SELECT 1', status: 'succeeded' }], resultAvailable: false }]);
    } finally { await reopened.close(); }
  });
  it('expires result rows while retaining the execution status', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'dbpilot-expiry-')); dirs.push(dataDir);
    const { app, connectionId } = await setup({ dataDir, resultTtlMs: 5 });
    try {
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT 1', source: 'human' } });
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } });
      const id = started.json().executionId as string;
      await waitForExecution(app, id);
      await new Promise(resolve => setTimeout(resolve, 20));
      expect((await app.inject({ method: 'GET', url: `/api/v1/executions/${id}/results/0` })).statusCode).toBe(410);
      const snapshot = await app.inject({ method: 'GET', url: `/api/v1/executions/${id}` });
      expect(snapshot.json()).toMatchObject({ status: 'succeeded', resultAvailable: false });
    } finally { await app.close(); }
  });
  it('evicts older result snapshots when the shared cache budget is reached', async () => {
    const { app, connectionId } = await setup({ resultCacheBytes: 35 });
    const runQuery = async (value: string) => {
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: `SELECT '${value}' AS value`, source: 'human' } });
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } });
      const id = started.json().executionId as string;
      await waitForExecution(app, id);
      return id;
    };
    try {
      expect((await app.inject('/api/v1/runtime')).json().limits.resultCacheBytes).toBe(35);
      const first = await runQuery('abcdefghij');
      expect((await app.inject({ method: 'GET', url: `/api/v1/executions/${first}/results/0` })).statusCode).toBe(200);
      const second = await runQuery('klmnopqrst');
      const evicted = await app.inject({ method: 'GET', url: `/api/v1/executions/${first}/results/0` });
      expect(evicted.statusCode).toBe(410);
      expect(evicted.json().error).toBe('RESULT_EXPIRED');
      expect((await app.inject({ method: 'GET', url: `/api/v1/executions/${first}` })).json()).toMatchObject({ status: 'succeeded', results: [{ status: 'succeeded', resultAvailable: false }] });
      expect((await app.inject({ method: 'GET', url: `/api/v1/executions/${second}/results/0` })).json().rows).toEqual([['klmnopqrst']]);
      const history = (await app.inject({ method: 'GET', url: `/api/v1/executions?connectionId=${connectionId}` })).json();
      expect(history.find((item: { id: string }) => item.id === first).resultAvailable).toBe(false);
      expect(history.find((item: { id: string }) => item.id === second).resultAvailable).toBe(true);
    } finally { await app.close(); }
  });
  it('keeps a 10,000-row SQLite snapshot and pages it without rerunning SQL', async () => {
    const { app, filename, connectionId } = await setup();
    const db = new Database(filename);
    db.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 10001) INSERT INTO items(id, name) SELECT x, 'row-' || x FROM n");
    db.close();
    try {
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT id, name FROM items ORDER BY id', source: 'human' } });
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } });
      const id = started.json().executionId as string;
      expect((await waitForExecution(app, id)).json().results[0].truncated).toBe(true);
      let cursor: string | null = null;
      let count = 0;
      let last: unknown[] | undefined;
      do {
        const pageResponse = await app.inject({ method: 'GET', url: `/api/v1/executions/${id}/results/0${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}` });
        expect(pageResponse.statusCode).toBe(200);
        const page = pageResponse.json() as { rows: unknown[][]; nextCursor: string | null };
        count += page.rows.length;
        last = page.rows.at(-1);
        cursor = page.nextCursor;
      } while (cursor);
      expect(count).toBe(10_000);
      expect(last).toEqual([10_000, 'row-10000']);
    } finally { await app.close(); }
  });
  it('restores a prepared AI plan and approval flow after app restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-restart-')); dirs.push(dir);
    const filename = join(dir, 'target.db');
    const db = new Database(filename); db.exec('CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT)'); db.close();
    const first = await createApp({ dataDir: dir });
    const connection = await first.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'target', filename } });
    const clientRequestId = randomUUID();
    const payload = { connectionId: connection.json().id, sql: "INSERT INTO items(name) VALUES ('persisted')", source: 'ai', clientRequestId };
    const prepared = await first.inject({ method: 'POST', url: '/api/v1/command-plans', payload });
    const planId = prepared.json().id as string;
    await first.close();
    const second = await createApp({ dataDir: dir });
    try {
      const replay = await second.inject({ method: 'POST', url: '/api/v1/command-plans', payload });
      expect(replay.json()).toMatchObject({ id: planId, replayed: true });
      const changed = await second.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { ...payload, sql: 'SELECT 2' } });
      expect(changed.statusCode).toBe(409);
      const restored = await second.inject({ method: 'GET', url: `/api/v1/command-plans/${planId}` });
      expect(restored.json().approvalRequired).toBe(true);
      expect((await second.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } })).statusCode).toBe(403);
      expect((await second.inject({ method: 'POST', url: `/api/v1/approvals/${planId}/decision`, payload: { decision: 'approve' } })).statusCode).toBe(200);
      const started = await second.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } });
      expect(started.statusCode).toBe(202);
      expect((await waitForExecution(second, started.json().executionId)).json().status).toBe('succeeded');
    } finally { await second.close(); }
  });
  it('rejects an untrusted Host header before serving API routes', async () => {
    const app = await createApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/api/v1/runtime', headers: { host: 'attacker.example:3000' } });
      expect(response.statusCode).toBe(403);
    } finally { await app.close(); }
  });
  it('rejects cross-site state changes while allowing same-origin and non-browser calls', async () => {
    const { app, connectionId } = await setup();
    const payload = { connectionId, sql: 'SELECT 1', source: 'human' };
    try {
      for (const headers of [
        { host: 'localhost:3000', origin: 'https://attacker.example' },
        { host: 'localhost:3000', origin: 'http://localhost:3001' },
        { host: 'localhost:3000', origin: 'null' },
        { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' },
      ]) {
        const denied = await app.inject({ method: 'POST', url: '/api/v1/command-plans', headers, payload });
        expect(denied.statusCode).toBe(403);
      }
      const sameOrigin = await app.inject({ method: 'POST', url: '/api/v1/command-plans', headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' }, payload });
      expect(sameOrigin.statusCode).toBe(200);
      const desktopStyle = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { ...payload, sql: 'SELECT 2' } });
      expect(desktopStyle.statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it('accepts an explicitly configured HTTPS proxy origin', async () => {
    const { app, connectionId } = await setup({ allowedHosts: ['localhost', '127.0.0.1', 'db.example'], allowedOrigins: ['https://db.example'] });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/command-plans', headers: { host: 'db.example', origin: 'https://db.example', 'sec-fetch-site': 'same-origin' }, payload: { connectionId, sql: 'SELECT 1', source: 'human' } });
      expect(response.statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it('invalidates a plan when a connection configuration version changes', async () => {
    const { app, filename, connectionId } = await setup();
    try {
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT 1', source: 'human' } });
      const updated = await app.inject({ method: 'PUT', url: `/api/v1/connections/${connectionId}`, payload: { engine: 'sqlite', name: 'renamed', filename } });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().version).toBe(2);
      expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } })).statusCode).toBe(409);
    } finally { await app.close(); }
  });
  it('returns an AI SQL draft without creating or executing a plan', async () => {
    const aiFetch = (async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'propose_sql', arguments: JSON.stringify({ sql: 'SELECT name FROM items', explanation: 'Read names' }) } }] } }] }), { status: 200 })) as typeof fetch;
    const { app, connectionId } = await setup({ ai: { apiKey: 'test-key', model: 'test-model' }, aiFetch });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/ai/drafts', payload: { connectionId, request: 'List item names' } });
      expect(response.statusCode).toBe(200);
      expect(response.json().sql).toBe('SELECT name FROM items');
      expect(response.json().steps[0].decision).toBe('allow');
    } finally { await app.close(); }
  });
  it('analyzes an existing result without running SQL again', async () => {
    const aiFetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'One visible row.' } }] }), { status: 200 })) as typeof fetch;
    const { app, filename, connectionId } = await setup({ ai: { apiKey: 'test-key', model: 'test-model' }, aiFetch });
    const db = new Database(filename); db.exec("INSERT INTO items(name) VALUES ('a')"); db.close();
    try {
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT name FROM items', source: 'human' } });
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } });
      const executionId = started.json().executionId as string;
      await waitForExecution(app, executionId);
      const analysis = await app.inject({ method: 'POST', url: '/api/v1/ai/analysis', payload: { executionId, setId: 0, request: 'Summarize' } });
      expect(analysis.statusCode).toBe(200);
      expect(analysis.json()).toMatchObject({ answer: 'One visible row.', analyzedRows: 1, partial: false });
    } finally { await app.close(); }
  });
  it('invalidates a prepared plan when its connection is deleted', async () => {
    const { app, connectionId } = await setup();
    try {
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT 1', source: 'human' } });
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/connections/${connectionId}` })).statusCode).toBe(204);
      expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } })).statusCode).toBe(409);
    } finally { await app.close(); }
  });
  it('lists table and column metadata without reading table rows', async () => {
    const { app, connectionId } = await setup();
    try {
      const response = await app.inject({ method: 'GET', url: `/api/v1/connections/${connectionId}/schema` });
      expect(response.statusCode).toBe(200);
      expect(response.json().tables).toEqual([{ schema: 'main', name: 'items', columns: [{ name: 'id', type: 'INTEGER', nullable: true }, { name: 'name', type: 'TEXT', nullable: true }] }]);
    } finally { await app.close(); }
  });
  it('pages one execution snapshot with a bound cursor', async () => {
    const { app, filename, connectionId } = await setup();
    const db = new Database(filename); db.exec("INSERT INTO items(name) VALUES ('a'),('b'),('c')"); db.close();
    try {
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT name FROM items ORDER BY id', source: 'human' } });
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } });
      const id = started.json().executionId as string;
      const snapshot = await waitForExecution(app, id);
      expect(snapshot.json().results[0].rows).toBeUndefined();
      expect(snapshot.json().results[0].resultAvailable).toBe(true);
      const first = await app.inject({ method: 'GET', url: `/api/v1/executions/${id}/results/0?limit=2` });
      expect(first.json().rows).toEqual([['a'], ['b']]);
      expect(first.json().nextCursor).toBeTruthy();
      const second = await app.inject({ method: 'GET', url: `/api/v1/executions/${id}/results/0?limit=2&cursor=${first.json().nextCursor}` });
      expect(second.json().rows).toEqual([['c']]);
      expect(second.json().nextCursor).toBeNull();
      expect((await app.inject({ method: 'GET', url: `/api/v1/executions/${id}/results/0?cursor=invalid` })).statusCode).toBe(400);
    } finally { await app.close(); }
  });
  it('requires approval for AI plans and consumes them once', async () => {
    const { app, connectionId } = await setup();
    try {
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: "INSERT INTO items(name) VALUES ('one')", source: 'ai' } });
      const planId = prepared.json().id as string;
      expect(prepared.json().approvalRequired).toBe(true);
      expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: `/api/v1/approvals/${planId}/decision`, payload: { decision: 'approve' } })).statusCode).toBe(200);
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } });
      expect(started.statusCode).toBe(202);
      const retry = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } });
      expect(retry.statusCode).toBe(202);
      expect(retry.json()).toMatchObject({ executionId: started.json().executionId, replayed: true });
      const snapshot = await waitForExecution(app, started.json().executionId);
      expect(snapshot.json().status).toBe('succeeded');
      expect(snapshot.json().results[0].affectedRows).toBe(1);
      const stream = await app.inject({ method: 'GET', url: `/api/v1/executions/${started.json().executionId}/events?afterSeq=0` });
      expect(stream.headers['content-type']).toContain('text/event-stream');
      expect(stream.body).toContain('event: started');
      expect(stream.body).toContain('event: completed');
    } finally { await app.close(); }
  });

  it('rejects unsupported steps and reports partial completion', async () => {
    const { app, filename, connectionId } = await setup();
    try {
      const denied = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT 1; VACUUM', source: 'human' } });
      expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: denied.json().id } })).statusCode).toBe(403);
      const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: "INSERT INTO items(name) VALUES ('saved'); INSERT INTO missing VALUES (1); INSERT INTO items(name) VALUES ('skipped')", source: 'human' } });
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } });
      const snapshot = await waitForExecution(app, started.json().executionId);
      expect(snapshot.json().status).toBe('failed');
      expect(snapshot.json().results.map((result: { status: string }) => result.status)).toEqual(['succeeded', 'failed', 'skipped']);
      const db = new Database(filename); expect(db.prepare('SELECT name FROM items').all()).toEqual([{ name: 'saved' }]); db.close();
    } finally { await app.close(); }
  });
  it('runs a SQLite transaction on one connection and rolls back a failed block', async () => {
    const { app, filename, connectionId } = await setup();
    try {
      const commitPlan = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: "BEGIN; INSERT INTO items(name) VALUES ('committed'); COMMIT", source: 'human' } });
      expect(commitPlan.json().steps.every((step: { decision: string }) => step.decision === 'ask')).toBe(true);
      const commit = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: commitPlan.json().id } });
      expect((await waitForExecution(app, commit.json().executionId)).json().status).toBe('succeeded');
      const rollbackPlan = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: "BEGIN; INSERT INTO items(name) VALUES ('explicit rollback'); ROLLBACK", source: 'human' } });
      const rollback = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: rollbackPlan.json().id } });
      const rollbackSnapshot = (await waitForExecution(app, rollback.json().executionId)).json();
      expect(rollbackSnapshot.status).toBe('succeeded');
      expect(rollbackSnapshot.results[1].rolledBack).toBe(true);
      const failPlan = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: "BEGIN; INSERT INTO items(name) VALUES ('rolled back'); INSERT INTO missing VALUES (1); COMMIT", source: 'human' } });
      const failed = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: failPlan.json().id } });
      const snapshot = (await waitForExecution(app, failed.json().executionId)).json();
      expect(snapshot.status).toBe('failed');
      expect(snapshot.results.map((result: { status: string }) => result.status)).toEqual(['succeeded', 'succeeded', 'failed', 'skipped']);
      expect(snapshot.results[1].rolledBack).toBe(true);
      const db = new Database(filename);
      expect(db.prepare('SELECT name FROM items ORDER BY id').all()).toEqual([{ name: 'committed' }]);
      db.close();
    } finally { await app.close(); }
  });
  it('reports cancelled reads and unknown writes when a SQLite worker is interrupted', async () => {
    const { app, filename, connectionId } = await setup();
    const blocker = new Database(filename);
    blocker.exec('BEGIN EXCLUSIVE');
    try {
      for (const [sql, expected] of [['SELECT * FROM items', 'cancelled'], ["INSERT INTO items(name) VALUES ('maybe')", 'outcome_unknown']] as const) {
        const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql, source: 'human' } });
        const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id } });
        const id = started.json().executionId as string;
        const receipt = await app.inject({ method: 'POST', url: `/api/v1/executions/${id}/cancel` });
        expect(receipt.json().accepted).toBe(true);
        const snapshot = await waitForExecution(app, id);
        expect(snapshot.json().status).toBe(expected);
        expect(snapshot.json().results[0].status).toBe(expected);
      }
    } finally { blocker.exec('ROLLBACK'); blocker.close(); await app.close(); }
  });
});

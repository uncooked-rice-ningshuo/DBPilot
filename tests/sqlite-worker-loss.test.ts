import { expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('../apps/server/src/sqlite-process.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../apps/server/src/sqlite-process.js')>();
  return { startSqliteWorker: (...args: Parameters<typeof actual.startSqliteWorker>) => {
    const child = actual.startSqliteWorker(...args);
    child.once('spawn', () => child.kill('SIGKILL'));
    return child;
  } };
});
import { createApp } from '../apps/server/src/app.js';
it.each([
  ['SELECT 42', 'failed'],
  ['INSERT INTO items VALUES (1)', 'outcome_unknown'],
  ['BEGIN; INSERT INTO items VALUES (1); COMMIT', 'outcome_unknown']
])('retains uncertain writes after a real SQLite child is killed: %s', async (sql, expected) => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-worker-loss-'));
  const filename = join(dir, 'target.db');
  const db = new Database(filename); db.exec('CREATE TABLE items(value INT)'); db.close();
  const app = await createApp();
  try {
    const connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'fault', filename } })).json().id;
    const planId = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, source: 'human', sql } })).json().id;
    const executionId = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } })).json().executionId;
    let state;
    for (let i = 0; i < 100; i++) {
      state = (await app.inject(`/api/v1/executions/${executionId}`)).json();
      if (state.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(state.status).toBe(expected);
    expect(state.results.some((result: { status: string }) => result.status === expected)).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } })).json()).toMatchObject({ executionId, replayed: true });
    expect((await app.inject('/api/v1/runtime')).statusCode).toBe(200);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

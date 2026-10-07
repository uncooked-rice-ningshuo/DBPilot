import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.js';

for (const engine of ['sqlite', 'postgres', 'mysql'] as const) {
  it.skipIf(engine !== 'sqlite' && process.env[`DBPILOT_TEST_${engine.toUpperCase()}`] !== '1')(`${engine} supports the table/index DDL subset through the shared policy`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-ddl-'));
    const filename = join(dir, 'test.db'); new Database(filename).close();
    const app = await createApp();
    const table = `ddl_${randomUUID().replaceAll('-', '')}`;
    let connectionId = '';
    const execute = async (sql: string) => {
      const plan = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, source: 'human', sql } })).json();
      expect(plan.steps.every((step: { decision: string }) => step.decision !== 'deny')).toBe(true);
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.id } });
      expect(started.statusCode).toBe(202);
      const id = started.json().executionId;
      for (let i = 0; i < 100; i++) {
        const state = (await app.inject(`/api/v1/executions/${id}`)).json();
        if (state.status !== 'running') return state;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('DDL execution did not complete');
    };
    try {
      const profile = engine === 'sqlite' ? { engine, name: engine, filename } : { engine, name: engine, host: '127.0.0.1', port: engine === 'postgres' ? 55433 : 55434, database: engine === 'postgres' ? 'postgres' : 'dbpilot_test', user: engine === 'postgres' ? process.env.USER ?? 'ningshuo' : 'root', password: engine === 'postgres' ? '' : 'dbpilot-test-only', ssl: false };
      connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: profile })).json().id;
      const state = await execute(`CREATE TABLE ${table}(id INT); INSERT INTO ${table} VALUES (1); CREATE UNIQUE INDEX ${table}_idx ON ${table}(id); ALTER TABLE ${table} ADD COLUMN label TEXT; SELECT id, label FROM ${table}; DROP INDEX ${table}_idx${engine === 'mysql' ? ` ON ${table}` : ''}; DROP TABLE ${table}`);
      expect(state.status).toBe('succeeded');
      expect(state.results.map((step: { status: string }) => step.status)).toEqual(Array(7).fill('succeeded'));
      expect((await app.inject(`/api/v1/executions/${state.id}/results/4`)).json()).toMatchObject({ columns: ['id', 'label'], rows: [[1, null]] });
    } finally {
      if (connectionId) await execute(`DROP TABLE IF EXISTS ${table}`);
      await app.close(); rmSync(dir, { recursive: true, force: true });
    }
  });
}

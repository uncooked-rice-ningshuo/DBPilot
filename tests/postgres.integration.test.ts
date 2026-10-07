import { describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { createApp } from '../apps/server/src/app.js';

const enabled = process.env.DBPILOT_TEST_POSTGRES === '1';
describe.skipIf(!enabled)('PostgreSQL integration', () => {
  it('rejects side-effect functions even after an approval attempt', async () => {
    const sequence = `dbpilot_policy_${Date.now()}`;
    const config = { host: '127.0.0.1', port: 55433, database: 'postgres', user: process.env.USER ?? 'ningshuo', password: '' };
    const client = new PgClient(config);
    await client.connect();
    const app = await createApp();
    try {
      await client.query(`CREATE SEQUENCE ${sequence}`);
      const connection = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { ...config, engine: 'postgres', name: 'policy', ssl: false } })).json();
      for (const source of ['human', 'ai']) {
        const plan = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId: connection.id, sql: `SELECT setval('${sequence}', 99)`, source } })).json();
        expect(plan.steps[0].decision).toBe('deny');
        expect((await app.inject({ method: 'POST', url: `/api/v1/approvals/${plan.id}/decision`, payload: { decision: 'approve' } })).statusCode).toBe(403);
        expect((await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.id } })).statusCode).toBe(403);
      }
      expect((await client.query(`SELECT last_value::text, is_called FROM ${sequence}`)).rows).toEqual([{ last_value: '1', is_called: false }]);
    } finally { await app.close(); await client.query(`DROP SEQUENCE IF EXISTS ${sequence}`); await client.end(); }
  });
  it('commits and rolls back explicit blocks on one connection', async () => {
    const table = `dbpilot_transaction_${Date.now()}`;
    const client = new PgClient({ host: '127.0.0.1', port: 55433, database: 'postgres', user: process.env.USER ?? 'ningshuo', password: '' });
    await client.connect();
    const app = await createApp();
    try {
      await client.query(`CREATE TABLE ${table}(value TEXT)`);
      const connection = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'postgres', name: 'transaction', host: '127.0.0.1', port: 55433, database: 'postgres', user: process.env.USER ?? 'ningshuo', password: '', ssl: false } });
      const execute = async (sql: string) => {
        const plan = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId: connection.json().id, sql, source: 'human' } });
        expect(plan.json().steps.every((step: { decision: string }) => step.decision === 'ask')).toBe(true);
        const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.json().id } });
        for (let attempt = 0; attempt < 100; attempt++) {
          const state = (await app.inject({ method: 'GET', url: `/api/v1/executions/${started.json().executionId}` })).json();
          if (state.status !== 'running') return state;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('PostgreSQL transaction did not finish');
      };
      expect((await execute(`BEGIN; INSERT INTO ${table}(value) VALUES ('committed'); COMMIT`)).status).toBe('succeeded');
      const failed = await execute(`BEGIN; INSERT INTO ${table}(value) VALUES ('failed'); INSERT INTO missing_table(value) VALUES ('x'); COMMIT`);
      expect(failed.status).toBe('failed');
      expect(failed.results[1].rolledBack).toBe(true);
      const explicit = await execute(`BEGIN; INSERT INTO ${table}(value) VALUES ('explicit'); ROLLBACK`);
      expect(explicit.status).toBe('succeeded');
      expect(explicit.results[1].rolledBack).toBe(true);
      expect((await client.query(`SELECT value FROM ${table}`)).rows).toEqual([{ value: 'committed' }]);
    } finally { await app.close(); await client.query(`DROP TABLE IF EXISTS ${table}`); await client.end(); }
  }, 15000);

  it('streams a read result and cancels an active read', async () => {
    const app = await createApp();
    let table: string | undefined;
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'postgres', name: 'integration', host: '127.0.0.1', port: 55433, database: 'postgres', user: process.env.USER ?? 'ningshuo', password: '', ssl: false } });
      expect(created.statusCode).toBe(201);
      const connectionId = created.json().id as string;
      expect((await app.inject({ method: 'POST', url: `/api/v1/connections/${connectionId}/test` })).statusCode).toBe(200);
      const prepare = async (sql: string) => (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql, source: 'human' } })).json().id as string;
      const start = async (planId: string) => (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } })).json().executionId as string;
      const wait = async (id: string) => {
        for (let i = 0; i < 100; i++) {
          const state = (await app.inject({ method: 'GET', url: `/api/v1/executions/${id}` })).json();
          if (state.status !== 'running') return state;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('PostgreSQL execution did not finish');
      };
      const readId = await start(await prepare('SELECT 42 AS value'));
      expect((await wait(readId)).status).toBe('succeeded');
      expect((await app.inject({ method: 'GET', url: `/api/v1/executions/${readId}/results/0` })).json().rows).toEqual([[42]]);
      const manyId = await start(await prepare('SELECT generate_series(1, 10001) AS value'));
      expect((await wait(manyId)).status).toBe('succeeded');
      const page = (await app.inject({ method: 'GET', url: `/api/v1/executions/${manyId}/results/0?limit=200` })).json();
      expect(page.rows).toHaveLength(200);
      expect(page.truncated).toBe(true);
      const sleepId = await start(await prepare('SELECT pg_sleep(10)'));
      await new Promise(resolve => setTimeout(resolve, 100));
      expect((await app.inject({ method: 'POST', url: `/api/v1/executions/${sleepId}/cancel` })).json().accepted).toBe(true);
      expect((await wait(sleepId)).status).toBe('cancelled');
      table = `dbpilot_cancel_${Date.now()}`;
      expect((await wait(await start(await prepare(`CREATE TABLE ${table}(value TEXT)`)))).status).toBe('succeeded');
      expect((await wait(await start(await prepare(`INSERT INTO ${table}(value) VALUES ('saved')`)))).status).toBe('succeeded');
      const writeId = await start(await prepare(`INSERT INTO ${table}(value) SELECT 'late' FROM pg_sleep(10)`));
      await new Promise(resolve => setTimeout(resolve, 100));
      expect((await app.inject({ method: 'POST', url: `/api/v1/executions/${writeId}/cancel` })).json().accepted).toBe(true);
      expect((await wait(writeId)).status).toBe('outcome_unknown');
      const verifyId = await start(await prepare(`SELECT value FROM ${table} ORDER BY value`));
      expect((await wait(verifyId)).status).toBe('succeeded');
      expect((await app.inject({ method: 'GET', url: `/api/v1/executions/${verifyId}/results/0` })).json().rows).toEqual([['saved']]);
    } finally {
      await app.close();
      if (table) {
        const cleanup = new PgClient({ host: '127.0.0.1', port: 55433, database: 'postgres', user: process.env.USER ?? 'ningshuo', password: '' });
        await cleanup.connect();
        try { await cleanup.query(`DROP TABLE IF EXISTS ${table}`); }
        finally { await cleanup.end(); }
      }
    }
  }, 15000);
});

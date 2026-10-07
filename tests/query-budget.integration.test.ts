import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import mysql from 'mysql2/promise';
import { createApp } from '../apps/server/src/app.js';

for (const engine of ['postgres', 'mysql'] as const) describe.skipIf(process.env[engine === 'postgres' ? 'DBPILOT_TEST_POSTGRES' : 'DBPILOT_TEST_MYSQL'] !== '1')(`${engine} query budget`, () => {
  it('cancels timed-out reads and reports uncertain writes without replaying them', async () => {
    const config = { host: '127.0.0.1', port: engine === 'postgres' ? 55433 : 55434, database: engine === 'postgres' ? 'postgres' : 'dbpilot_test', user: engine === 'postgres' ? process.env.USER ?? 'ningshuo' : 'root', password: engine === 'postgres' ? '' : 'dbpilot-test-only' };
    const pg = engine === 'postgres' ? new Client(config) : undefined;
    await pg?.connect();
    const my = engine === 'mysql' ? await mysql.createConnection(config) : undefined;
    const query = async (sql: string) => pg ? (await pg.query(sql)).rows : (await my!.query(sql))[0];
    const table = `dbpilot_budget_${Date.now()}`;
    await query(`CREATE TABLE ${table}(value INT)`);
    const app = await createApp({ queryTimeoutMs: 150 });
    try {
      const connection = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine, name: 'budget', ...config, ssl: false } })).json();
      const execute = async (sql: string) => {
        const plan = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId: connection.id, sql, source: 'human' } })).json();
        const started = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.id } })).json();
        let state;
        for (let attempt = 0; attempt < 100; attempt++) {
          state = (await app.inject(`/api/v1/executions/${started.executionId}`)).json();
          if (state.status !== 'running') return { state, planId: plan.id, executionId: started.executionId };
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('Query exceeded its budget without reaching a final state');
      };
      const sleep = engine === 'postgres' ? 'pg_sleep(1)' : 'SLEEP(1)';
      const read = await execute(`SELECT ${sleep}; INSERT INTO ${table}(value) VALUES (2)`);
      expect(read.state.status).toBe('cancelled');
      expect(read.state.results[0].error).toContain('time budget');
      expect(read.state.results[1].status).toBe('skipped');
      const writeSql = engine === 'postgres' ? `INSERT INTO ${table}(value) SELECT 1 FROM pg_sleep(1)` : `INSERT INTO ${table}(value) SELECT 1 FROM (SELECT SLEEP(1)) AS pause`;
      const write = await execute(writeSql);
      expect(write.state.status).toBe('outcome_unknown');
      const replay = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: write.planId } })).json();
      expect(replay).toMatchObject({ executionId: write.executionId, replayed: true });
      expect(await query(`SELECT value FROM ${table}`)).toEqual([]);
      expect((await execute('SELECT 42')).state.status).toBe('succeeded');
      expect((await app.inject('/api/v1/runtime')).json().limits.queryTimeoutMs).toBe(150);
    } finally { await app.close(); await query(`DROP TABLE ${table}`); await pg?.end(); await my?.end(); }
  }, 15000);
});

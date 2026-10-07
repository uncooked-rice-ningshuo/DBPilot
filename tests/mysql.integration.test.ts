import { describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { createApp } from '../apps/server/src/app.js';

const enabled = process.env.DBPILOT_TEST_MYSQL === '1';
describe.skipIf(!enabled)('MySQL integration', () => {
  it('commits and rolls back DML blocks on one connection', async () => {
    const config = { host: '127.0.0.1', port: 55434, database: 'dbpilot_test', user: 'root', password: 'dbpilot-test-only' };
    const db = await mysql.createConnection(config);
    const table = `dbpilot_transaction_${Date.now()}`;
    const app = await createApp();
    try {
      await db.query(`CREATE TABLE ${table}(value VARCHAR(100))`);
      const created = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'mysql', name: 'transaction', ...config, ssl: false } });
      const execute = async (sql: string) => {
        const plan = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId: created.json().id, sql, source: 'human' } });
        expect(plan.json().steps.every((step: { decision: string }) => step.decision === 'ask')).toBe(true);
        const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.json().id } });
        for (let attempt = 0; attempt < 100; attempt++) {
          const state = (await app.inject({ method: 'GET', url: `/api/v1/executions/${started.json().executionId}` })).json();
          if (state.status !== 'running') return state;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('MySQL transaction did not finish');
      };
      expect((await execute(`BEGIN; INSERT INTO ${table}(value) VALUES ('committed'); COMMIT`)).status).toBe('succeeded');
      const failed = await execute(`BEGIN; INSERT INTO ${table}(value) VALUES ('failed'); INSERT INTO missing_table(value) VALUES ('x'); COMMIT`);
      expect(failed.status).toBe('failed');
      expect(failed.results[1].rolledBack).toBe(true);
      const explicit = await execute(`BEGIN; INSERT INTO ${table}(value) VALUES ('explicit'); ROLLBACK`);
      expect(explicit.status).toBe('succeeded');
      expect(explicit.results[1].rolledBack).toBe(true);
      const [rows] = await db.query(`SELECT value FROM ${table}`);
      expect(rows).toEqual([{ value: 'committed' }]);
    } finally { await app.close(); await db.query(`DROP TABLE IF EXISTS ${table}`); await db.end(); }
  }, 15000);

  it('connects, reads bounded rows, writes, and cancels reads and writes', async () => {
    const config = { host: '127.0.0.1', port: 55434, database: 'dbpilot_test', user: 'root', password: 'dbpilot-test-only' };
    const db = await mysql.createConnection(config);
    const table = `dbpilot_integration_${Date.now()}`;
    const app = await createApp();
    try {
      await db.query(`CREATE TABLE ${table}(id INT AUTO_INCREMENT PRIMARY KEY, value VARCHAR(100))`);
      await db.query(`INSERT INTO ${table}(value) VALUES ?`, [Array.from({ length: 10001 }, (_, index) => [`value-${index}`])]);
      const created = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'mysql', name: 'integration', ...config, ssl: false } });
      expect(created.statusCode).toBe(201);
      const connectionId = created.json().id as string;
      expect((await app.inject({ method: 'POST', url: `/api/v1/connections/${connectionId}/test` })).statusCode).toBe(200);
      const schema = (await app.inject({ method: 'GET', url: `/api/v1/connections/${connectionId}/schema` })).json();
      expect(schema.tables.some((entry: { name: string }) => entry.name === table)).toBe(true);
      const prepare = async (sql: string) => (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql, source: 'human' } })).json().id as string;
      const start = async (planId: string) => (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } })).json().executionId as string;
      const wait = async (id: string) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const state = (await app.inject({ method: 'GET', url: `/api/v1/executions/${id}` })).json();
          if (state.status !== 'running') return state;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('MySQL execution did not finish');
      };
      const readId = await start(await prepare(`SELECT id, value FROM ${table} ORDER BY id`));
      expect((await wait(readId)).status).toBe('succeeded');
      const page = (await app.inject({ method: 'GET', url: `/api/v1/executions/${readId}/results/0?limit=200` })).json();
      expect(page.rows).toHaveLength(200);
      expect(page.truncated).toBe(true);
      const writeId = await start(await prepare(`INSERT INTO ${table}(value) VALUES ('saved')`));
      expect((await wait(writeId)).status).toBe('succeeded');
      const sleepId = await start(await prepare('SELECT SLEEP(10)'));
      await new Promise(resolve => setTimeout(resolve, 100));
      expect((await app.inject({ method: 'POST', url: `/api/v1/executions/${sleepId}/cancel` })).json().accepted).toBe(true);
      expect((await wait(sleepId)).status).toBe('cancelled');
      const slowWriteId = await start(await prepare(`INSERT INTO ${table}(value) SELECT 'late' FROM (SELECT SLEEP(10) AS waited) AS slow_source`));
      await new Promise(resolve => setTimeout(resolve, 100));
      expect((await app.inject({ method: 'POST', url: `/api/v1/executions/${slowWriteId}/cancel` })).json()).toMatchObject({ accepted: true });
      expect((await wait(slowWriteId)).status).toBe('outcome_unknown');
    } finally {
      await app.close();
      await db.query(`DROP TABLE IF EXISTS ${table}`);
      await db.end();
    }
  }, 15000);
});

it.skipIf(process.env.DBPILOT_TEST_MYSQL !== '1')('does not send a saved password to a changed draft or saved target', async () => {
  const app = await createApp();
  const profile = { engine:'mysql',name:'credential scope',host:'127.0.0.1',port:55434,database:'dbpilot_test',user:'root',password:'dbpilot-test-only',ssl:false };
  try {
    const id=(await app.inject({method:'POST',url:'/api/v1/connections',payload:profile})).json().id;
    expect((await app.inject({method:'POST',url:'/api/v1/connections/test',payload:{...profile,editingId:id,password:''}})).statusCode).toBe(200);
    const changed={...profile,host:'localhost',password:''};
    expect((await app.inject({method:'POST',url:'/api/v1/connections/test',payload:{...changed,editingId:id}})).statusCode).toBe(502);
    expect((await app.inject({method:'POST',url:`/api/v1/connections/${id}/test`})).statusCode).toBe(200);
    expect((await app.inject({method:'PUT',url:`/api/v1/connections/${id}`,payload:changed})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/v1/connections/${id}/test`})).statusCode).toBe(502);
  }finally{await app.close();}
},10000);

import { expect, it } from 'vitest';
import { Client } from 'pg';
import mysql from 'mysql2/promise';
import { createApp } from '../apps/server/src/app.js';

for (const engine of ['postgres', 'mysql'] as const) it.skipIf(process.env[`DBPILOT_TEST_${engine.toUpperCase()}`] !== '1')(`${engine} stops an oversized read before its slow tail and keeps the bounded snapshot`, async () => {
  const config = { host: '127.0.0.1', port: engine === 'postgres' ? 55433 : 55434, database: engine === 'postgres' ? 'postgres' : 'dbpilot_test', user: engine === 'postgres' ? process.env.USER ?? 'ningshuo' : 'root', password: engine === 'postgres' ? '' : 'dbpilot-test-only' };
  const pg = engine === 'postgres' ? new Client(config) : undefined;
  await pg?.connect();
  const my = engine === 'mysql' ? await mysql.createConnection(config) : undefined;
  const table = `result_stop_${Date.now()}`;
  const app = await createApp({ queryTimeoutMs: 2500 });
  try {
    if (my) {
      await my.query(`CREATE TABLE ${table}(id INT PRIMARY KEY)`);
      for (let start = 1; start <= 12000; start += 1000) await my.query(`INSERT INTO ${table} VALUES ${Array.from({ length: 1000 }, (_, index) => `(${start + index})`).join(',')}`);
    }
    const connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine, name: 'result budget', ...config, ssl: false } })).json().id;
    const sql = engine === 'postgres'
      ? 'SELECT id, pg_sleep(CASE WHEN id > 11000 THEN 10 ELSE 0 END) FROM generate_series(1, 12000) AS id'
      : `SELECT id, SLEEP(CASE WHEN id > 11000 THEN 10 ELSE 0 END) FROM ${table} ORDER BY id`;
    const plan = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: `${sql}; SELECT 42`, source: 'human' } })).json();
    const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.id } });
    expect(started.statusCode).toBe(202);
    const id = started.json().executionId;
    let state;
    for (let i = 0; i < 200; i++) {
      state = (await app.inject(`/api/v1/executions/${id}`)).json();
      if (state.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(state.status).toBe('succeeded');
    expect(state.results[0].truncated).toBe(true);
    const page = (await app.inject(`/api/v1/executions/${id}/results/0`)).json();
    expect(page.rows).toHaveLength(200);
    expect(page.rows[0][0]).toBe(1);
    expect((await app.inject(`/api/v1/executions/${id}/results/1`)).json().rows).toEqual([[42]]);
  } finally { await app.close(); if (my) await my.query(`DROP TABLE IF EXISTS ${table}`); await pg?.end(); await my?.end(); }
}, 15000);

import { createApp } from '../../apps/server/src/app.ts';
import { Client } from 'pg';
import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
const engine = process.argv[2];
const transaction = process.argv[3].startsWith('transaction');
const writing = process.argv[3].endsWith('write');
const table = `fault_${randomUUID().replaceAll('-', '')}`;
const config = { host: '127.0.0.1', port: engine === 'postgres' ? 55433 : 55434, database: engine === 'postgres' ? 'postgres' : 'dbpilot_test', user: engine === 'postgres' ? process.env.USER ?? 'ningshuo' : 'root', password: engine === 'postgres' ? '' : 'dbpilot-test-only' };
const pg = engine === 'postgres' ? new Client(config) : undefined;
await pg?.connect();
const my = engine === 'mysql' ? await mysql.createConnection(config) : undefined;
const app = await createApp();
try {
  if (writing) {
    if (pg) await pg.query(`CREATE TABLE ${table}(value INT)`);
    else await my.query(`CREATE TABLE ${table}(value INT)`);
  }
  const connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { ...config, name: 'fault fixture', engine, ssl: false } })).json().id;
  const sql = writing
    ? (pg ? `INSERT INTO ${table} SELECT 1 FROM pg_sleep(5)` : `INSERT INTO ${table} SELECT SLEEP(5)`)
    : `SELECT ${engine === 'postgres' ? 'pg_sleep' : 'SLEEP'}(5) /* fault_${randomUUID()} */`;
  const planId = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, source: 'human', sql: transaction ? `BEGIN; ${sql}; COMMIT` : sql } })).json().id;
  const executionId = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } })).json().executionId;
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = pg ? (await pg.query('SELECT pid AS id FROM pg_stat_activity WHERE query = $1', [sql])).rows : (await my.query('SELECT ID AS id FROM INFORMATION_SCHEMA.PROCESSLIST WHERE INFO = ?', [sql]))[0];
    target = rows[0]?.id;
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (!target) throw new Error('Could not locate isolated query');
  if (pg) await pg.query('SELECT pg_terminate_backend($1)', [target]);
  else await my.query(`KILL CONNECTION ${Number(target)}`);
  let status;
  for (let attempt = 0; attempt < 100; attempt++) {
    status = (await app.inject(`/api/v1/executions/${executionId}`)).json().status;
    if (status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await new Promise(resolve => setTimeout(resolve, 100));
  const replay = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId } })).json();
  console.log(JSON.stringify({ status, runtimeHealthy: (await app.inject('/api/v1/runtime')).statusCode === 200, replayed: replay.replayed && replay.executionId === executionId }));
} finally {
  await app.close();
  if (writing) { if (pg) await pg.query(`DROP TABLE IF EXISTS ${table}`); else await my.query(`DROP TABLE IF EXISTS ${table}`); }
  await pg?.end(); await my?.end();
}

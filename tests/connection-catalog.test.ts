import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { Client } from 'pg';
import mysql from 'mysql2/promise';
import { createApp } from '../apps/server/src/app.js';
import { connectionInput } from '../packages/protocol/src/index.js';
import { PlanStore } from '../packages/storage/src/plans.js';

it('accepts server connections without a default database', () => {
  for (const engine of ['postgres', 'mysql']) expect(connectionInput.safeParse({ engine, name: 'Server', host: 'localhost', user: 'test', password: '' }).success).toBe(true);
});
it('lists the SQLite catalog and rejects a different target database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-catalog-'));
  const filename = join(dir, 'fixture.db'); const db = new Database(filename); db.exec('CREATE TABLE items(id INTEGER)'); db.close();
  const app = await createApp();
  try {
    const saved = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'Fixture', filename } })).json();
    expect((await app.inject(`/api/v1/connections/${saved.id}/databases`)).json().databases).toEqual([{ name: 'main' }]);
    expect((await app.inject(`/api/v1/connections/${saved.id}/schema?database=other`)).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId: saved.id, database: 'other', sql: 'SELECT 1' } })).statusCode).toBe(400);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
it('persists the exact database target with a plan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-plan-target-'));
  let store = new PlanStore(dir);
  const id = randomUUID();
  try {
    store.add({ id, connectionId: randomUUID(), connectionVersion: 1, database: 'target_b', steps: [], source: 'human', approved: false, consumed: false, createdAt: Date.now() });
    store.close(); store = new PlanStore(dir);
    expect(store.get(id)?.database).toBe('target_b');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
for (const engine of ['postgres', 'mysql'] as const) {
  it.skipIf(process.env[engine === 'postgres' ? 'DBPILOT_TEST_POSTGRES' : 'DBPILOT_TEST_MYSQL'] !== '1')(`${engine}: discovers databases and binds same SQL to independent targets`, async () => {
    const names = [0, 1].map(i => `dbpilot_catalog_${randomUUID().replaceAll('-', '')}_${i}`);
    const config = engine === 'postgres' ? { host: '127.0.0.1', port: 55433, user: process.env.USER ?? 'ningshuo', password: '' } : { host: '127.0.0.1', port: 55434, user: 'root', password: 'dbpilot-test-only' };
    const pg = engine === 'postgres' ? new Client({ ...config, database: 'postgres' }) : undefined;
    if (pg) await pg.connect();
    const my = engine === 'mysql' ? await mysql.createConnection(config) : undefined;
    const admin = async (sql: string) => pg ? pg.query(sql) : my!.query(sql);
    const created: string[] = [];
    const app = await createApp();
    try {
      for (const [index, name] of names.entries()) {
        await admin(`CREATE DATABASE ${name}`); created.push(name);
        const target = engine === 'postgres' ? new Client({ ...config, database: name }) : await mysql.createConnection({ ...config, database: name });
        if (target instanceof Client) await target.connect();
        try {
          const query = (sql: string) => target instanceof Client ? target.query(sql) : target.query(sql);
          if (index === 0) for (let n = 0; n < 205; n++) await query(`CREATE TABLE page_${String(n).padStart(3, '0')}(id INTEGER)`);
          await query('CREATE TABLE sample(value INTEGER)'); await query(`INSERT INTO sample VALUES(${41 + index})`);
        }
        finally { await target.end(); }
      }
      const saved = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine, name: 'Server', ...config } });
      expect(saved.statusCode).toBe(201); const connectionId = saved.json().id;
      expect((await app.inject({ method: 'POST', url: `/api/v1/connections/${connectionId}/test` })).statusCode).toBe(200);
      const catalog = (await app.inject(`/api/v1/connections/${connectionId}/databases`)).json();
      for (const name of names) expect(catalog.databases).toContainEqual({ name });
      expect((await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, sql: 'SELECT value FROM sample' } })).statusCode).toBe(400);
      const directory = `/api/v1/connections/${connectionId}/tables?database=${names[0]}`;
      const firstPage = (await app.inject(directory)).json();
      expect(firstPage.tables).toHaveLength(200); expect(firstPage.tables[0].columns).toEqual([]);
      const secondPage = (await app.inject(`${directory}&cursor=${encodeURIComponent(firstPage.nextCursor)}`)).json();
      expect(secondPage.tables).toHaveLength(6); expect(secondPage.nextCursor).toBeUndefined();
      expect(new Set([...firstPage.tables, ...secondPage.tables].map(table => table.name)).size).toBe(206);
      expect((await app.inject(`/api/v1/connections/${connectionId}/tables?database=${names[1]}&cursor=${encodeURIComponent(firstPage.nextCursor)}`)).statusCode).toBe(400);
      const selectedTable = (await app.inject(`/api/v1/connections/${connectionId}/schema?database=${names[0]}&schema=${engine === 'postgres' ? 'public' : names[0]}&table=sample`)).json();
      expect(selectedTable.tables).toHaveLength(1); expect(selectedTable.tables[0].columns[0].name).toBe('value');
      const requestId = randomUUID();
      for (const [index, database] of names.entries()) {
        const schema = (await app.inject(`/api/v1/connections/${connectionId}/schema?database=${database}`)).json();
        expect(schema.tables.some((table: { name: string }) => table.name === 'sample')).toBe(true);
        const prepared = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, database, sql: 'SELECT value FROM sample', clientRequestId: index === 0 ? requestId : randomUUID() } });
        expect(prepared.json().database).toBe(database);
        const started = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: prepared.json().id, database: names[1 - index] } })).json();
        let state;
        for (let n = 0; n < 100; n++) { state = (await app.inject(`/api/v1/executions/${started.executionId}`)).json(); if (state.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 20)); }
        expect(state.status).toBe('succeeded');
        expect((await app.inject(`/api/v1/executions/${started.executionId}/results/0`)).json().rows).toEqual([[41 + index]]);
      }
      expect((await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId, database: names[1], sql: 'SELECT value FROM sample', clientRequestId: requestId } })).statusCode).toBe(409);
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/connections/${connectionId}` })).statusCode).toBe(204);
      expect((await app.inject('/api/v1/connections')).json()).toEqual([]);
    } finally {
      await app.close();
      for (const name of created) await admin(`DROP DATABASE ${name}`);
      await pg?.end(); await my?.end();
    }
  }, 20000);
}

it('paginates table names beyond the old SQLite limit and loads selected columns separately', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-catalog-pages-'));
  const filename = join(dir, 'fixture.db'); const db = new Database(filename);
  db.transaction(() => { for (let i = 0; i < 2105; i++) db.exec(`CREATE TABLE item_${String(i).padStart(4, '0')}(id INTEGER, value TEXT)`); })(); db.close();
  const app = await createApp();
  try {
    const saved = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'Paged', filename } })).json();
    const names: string[] = []; let cursor: string | undefined;
    do {
      const response = await app.inject(`/api/v1/connections/${saved.id}/tables?database=main${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(response.statusCode).toBe(200);
      const page = response.json(); expect(page.tables.length).toBeLessThanOrEqual(200);
      for (const table of page.tables) { names.push(table.name); expect(table.columns).toEqual([]); }
      cursor = page.nextCursor;
    } while (cursor);
    expect(names).toHaveLength(2105); expect(new Set(names).size).toBe(2105); expect(names.at(-1)).toBe('item_2104');
    const selected = (await app.inject(`/api/v1/connections/${saved.id}/schema?database=main&schema=main&table=item_2104`)).json();
    expect(selected.tables).toHaveLength(1); expect(selected.tables[0].columns.map((column: { name: string }) => column.name)).toEqual(['id', 'value']);
    const extra = new Database(filename); extra.exec('CREATE TABLE " odd"" table " ("a b" INTEGER)'); extra.close();
    const unusual = (await app.inject(`/api/v1/connections/${saved.id}/schema?database=main&schema=main&table=${encodeURIComponent(' odd" table ')}`)).json();
    expect(unusual.tables[0].name).toBe(' odd" table '); expect(unusual.tables[0].columns[0].name).toBe('a b');
    expect((await app.inject(`/api/v1/connections/${saved.id}/tables?database=main&cursor=invalid`)).statusCode).toBe(400);
    expect((await app.inject(`/api/v1/connections/${saved.id}/schema?database=main&table=item_2104`)).statusCode).toBe(400);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

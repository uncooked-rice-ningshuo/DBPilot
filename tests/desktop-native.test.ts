import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';

it.skipIf(process.env.DBPILOT_TEST_DESKTOP !== '1')('runs SQLite through real Electron IPC and query child while Node stays usable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-desktop-native-'));
  const filename = join(dir, 'fixture.db');
  const db = new Database(filename);
  db.exec('CREATE TABLE values_test(value INTEGER); INSERT INTO values_test VALUES(42)');
  db.close();
  const entry = join(dir, 'entry.mjs');
  const exercise = `(async () => {
    const api = window.dbpilotDesktop;
    const call = async (op, input = {}) => {
      const response = await api[op](input);
      if (response.statusCode >= 400) throw new Error(op + ': ' + JSON.stringify(response.body));
      return response.body;
    };
    const runtime = await call('runtime.info');
    if (runtime.mode !== 'desktop-local') throw new Error('Wrong runtime');
    const connection = await call('connections.create', { body: { name: 'Native fixture', engine: 'sqlite', filename: ${JSON.stringify(filename)} } });
    await call('connections.test', { id: connection.id });
    const catalog = await call('connections.databases', { id: connection.id });
    if (catalog.databases[0]?.name !== 'main') throw new Error('Wrong catalog');
    const tables = await call('connections.tables', { id: connection.id, database: 'main' });
    if (tables.tables[0]?.name !== 'values_test' || tables.tables[0].columns.length) throw new Error('Wrong table page');
    const schema = await call('connections.schema', { id: connection.id, database: 'main', schema: 'main', table: 'values_test' });
    if (schema.database !== 'main' || schema.tables[0]?.name !== 'values_test') throw new Error('Wrong schema target');
    const plan = await call('plans.prepare', { body: { connectionId: connection.id, database: 'main', source: 'human', sql: 'SELECT value FROM values_test' } });
    const execution = await call('executions.start', { body: { planId: plan.id } });
    for (let i = 0; i < 150; i++) {
      const state = await call('executions.get', { id: execution.executionId });
      if (state.status === 'succeeded') {
        const result = await call('executions.resultPage', { id: execution.executionId, index: 0 });
        if (JSON.stringify(result.rows) !== '[[42]]') throw new Error('Wrong result');
        return 'DBPILOT_NATIVE_READY';
      }
      if (['failed', 'cancelled', 'partially_succeeded'].includes(state.status)) throw new Error('Query failed: ' + JSON.stringify(state));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Query did not complete');
  })()`;
  writeFileSync(entry, `import { app } from 'electron';
app.setPath('userData', ${JSON.stringify(dir)});
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try { console.log(await window.webContents.executeJavaScript(${JSON.stringify(exercise)})); }
    catch (error) { console.log('DBPILOT_NATIVE_FAILED: ' + error.message); }
    finally { app.quit(); }
  });
});
await import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/main.mjs')).href)});
`);
  const env: NodeJS.ProcessEnv = { ...process.env, DBPILOT_DESKTOP_DATA_DIR: join(dir, 'userdata') };
  delete env.ELECTRON_RUN_AS_NODE; delete env.DEEPSEEK_API_KEY; delete env.DEEPSEEK_MODEL; delete env.DEEPSEEK_BASE_URL;
  try {
    const executable = createRequire(import.meta.url)('electron') as string;
    const output = await new Promise<string>((resolveOutput, reject) => execFile(executable, [entry], { env, timeout: 25000 }, (error, stdout) => error ? reject(error) : resolveOutput(stdout)));
    expect(output).toContain('DBPILOT_NATIVE_READY');
    const nodeDb = new Database(filename);
    expect(nodeDb.prepare('SELECT value FROM values_test').get()).toEqual({ value: 42 });
    nodeDb.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);

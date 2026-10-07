// Optional validation dependency: install Playwright, or pass its module path.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
const { _electron: electron } = await import(process.env.DBPILOT_PLAYWRIGHT_MODULE || 'playwright');
if (!process.argv[2]) throw new Error('Pass the packaged desktop executable path');
const executablePath = resolve(process.argv[2]);
const require = createRequire(import.meta.url);
const asar = createRequire(require.resolve('electron-builder'))('@electron/asar');
const archive = process.platform === 'darwin' ? join(dirname(executablePath), '../Resources/app.asar') : join(dirname(executablePath), 'resources/app.asar');
const packagedFiles = asar.listPackage(archive);
assert.ok(packagedFiles.includes('/dist/web/index.html'));
assert.ok(packagedFiles.includes('/dist/server/apps/server/src/app.js'));
assert.ok(packagedFiles.includes('/dist/server/apps/server/src/sqlite-parent-watch.mjs'));
assert.equal(packagedFiles.filter(path => path.startsWith('/dist/') && !/^\/dist\/(server|web)(\/|$)/.test(path)).length, 0, 'Previous build artifacts were packaged recursively');
assert.equal(packagedFiles.filter(path => /^\/(\.data|\.env)(\/|\.|$)/.test(path)).length, 0, 'Workspace data or environment configuration was packaged');
const dir = mkdtempSync(join(tmpdir(), 'dbpilot-packaged-'));
const filename = join(dir, 'fixture.db');
const db = new Database(filename); db.exec('CREATE TABLE sample(value INTEGER); INSERT INTO sample VALUES(42)'); db.close();
const env = { ...process.env, DBPILOT_DESKTOP_DATA_DIR: join(dir, 'userdata') };
delete env.ELECTRON_RUN_AS_NODE; delete env.DEEPSEEK_API_KEY; delete env.DEEPSEEK_MODEL; delete env.DEEPSEEK_BASE_URL;
let app;
try {
  app = await electron.launch({ executablePath, env, timeout: 30000 });
  assert.deepEqual(await app.evaluate(({ app }) => ({ packaged: app.isPackaged, dataDir: app.getPath('userData') })), { packaged: true, dataDir: env.DBPILOT_DESKTOP_DATA_DIR });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('svg.app-icon').first().waitFor();
  const saved = await page.evaluate(async filename => {
    const call = async (operation, input = {}) => {
      const response = await window.dbpilotDesktop[operation](input);
      if (response.statusCode >= 400) throw new Error(operation + ': ' + JSON.stringify(response.body));
      return response.body;
    };
    const runtime = await call('runtime.info');
    const connection = await call('connections.create', { body: { name: 'Packaged fixture', engine: 'sqlite', filename } });
    const plan = await call('plans.prepare', { body: { connectionId: connection.id, sql: 'SELECT value FROM sample', source: 'human' } });
    const execution = await call('executions.start', { body: { planId: plan.id } });
    for (let i = 0; i < 150; i++) {
      const state = await call('executions.get', { id: execution.executionId });
      if (state.status === 'succeeded') {
        const result = await call('executions.resultPage', { id: execution.executionId, index: 0 });
        if (JSON.stringify(result.rows) !== '[[42]]') throw new Error('Incorrect packaged query result');
        return { runtimeId: runtime.runtimeId, connectionId: connection.id, executionId: execution.executionId };
      }
      if (state.status !== 'running') throw new Error('Packaged query failed: ' + JSON.stringify(state));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Packaged query timeout');
  }, filename);
  await app.close(); app = undefined;
  app = await electron.launch({ executablePath, env, timeout: 30000 });
  const secondPage = await app.firstWindow();
  await secondPage.waitForLoadState('domcontentloaded');
  const restored = await secondPage.evaluate(async saved => {
    const api = window.dbpilotDesktop;
    const runtime = await api['runtime.info']({});
    const connections = await api['connections.list']({});
    const execution = await api['executions.get']({ id: saved.executionId });
    return { runtimeId: runtime.body.runtimeId, connections: connections.body, execution: execution.body, statusCode: execution.statusCode };
  }, saved);
  assert.equal(restored.runtimeId, saved.runtimeId);
  assert.ok(JSON.stringify(restored.connections).includes(saved.connectionId));
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.execution.status, 'succeeded');
  await secondPage.getByRole('button', { name: '连接设置 Packaged fixture', exact: true }).click();
  const dialogBefore = await secondPage.getByRole('dialog').boundingBox();
  await secondPage.getByRole('button', { name: '测试连接', exact: true }).click();
  await secondPage.getByText('测试连接成功', { exact: true }).waitFor();
  await secondPage.waitForFunction(() => {
    const toast = document.querySelector('[data-sonner-toast]');
    return toast && getComputedStyle(toast).opacity === '1' && toast.getBoundingClientRect().bottom <= innerHeight;
  });
  assert.deepEqual(await secondPage.getByRole('dialog').boundingBox(), dialogBefore);
  assert.equal(await secondPage.evaluate(() => {
    const toast = document.querySelector('[data-sonner-toast]'); const rect = toast.getBoundingClientRect();
    return !!document.elementFromPoint(rect.x + 30, rect.y + 25)?.closest('[data-sonner-toast]') && !toast.closest('[aria-hidden="true"]');
  }), true);
  mkdirSync('output/playwright', { recursive: true });
  await secondPage.screenshot({ path: 'output/playwright/desktop-packaged.png' });
  await secondPage.getByRole('button', { name: '关闭提示', exact: true }).click();
  assert.equal(await secondPage.getByRole('dialog').isVisible(), true);
  await secondPage.getByRole('textbox', { name: '数据库文件路径', exact: true }).fill(filename);
  console.log('Packaged desktop: global toast above modal with stable layout,  isolated profile, Local Core, SQLite query child, and restart persistence passed.');
} finally {
  if (app) await app.close();
  rmSync(dir, { recursive: true, force: true });
}

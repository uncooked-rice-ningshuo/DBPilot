import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, safeStorage, session, utilityProcess } from 'electron';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeForDesktopOperation } from '../../dist/server/packages/runtime-client/src/desktop-operations.js';
import { validateRuntimeHandshake } from '../../dist/server/packages/runtime-client/src/handshake.js';
import { requestRuntimeJson, runtimeRequestTimeoutMs } from '../../dist/server/packages/runtime-client/src/json-request.js';

// Separate profiles for local installations and packaged smoke tests. This is
// a main-process launch setting, never accepted from Renderer/IPC/model input.
if (process.env.DBPILOT_DESKTOP_DATA_DIR) {
  const dataDir = process.env.DBPILOT_DESKTOP_DATA_DIR;
  if (!isAbsolute(dataDir)) throw new Error('DBPILOT_DESKTOP_DATA_DIR must be an absolute path');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  app.setPath('userData', dataDir);
}

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const webRoot = join(appRoot, 'dist/web');
let window;
let child;
let coreReady;
let target = { kind: 'local' };
const pending = new Map();

function trusted(event) { return event.senderFrame?.url.startsWith('app://dbpilot/') && event.sender === window?.webContents; }
function validateTarget(value) {
  if (value?.kind === 'local') return { kind: 'local' };
  if (value?.kind !== 'remote' || typeof value.baseUrl !== 'string') throw new Error('Invalid Runtime target');
  const url = new URL(value.baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Remote Runtime requires HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('Runtime URL cannot contain credentials, query, or fragment');
  return { kind: 'remote', baseUrl: url.origin, runtimeId: typeof value.runtimeId === 'string' ? value.runtimeId : undefined };
}
function sendChild(message) {
  return new Promise((resolvePromise, rejectPromise) => {
    const owner = child;
    if (!owner) return rejectPromise(new Error('Local Core is unavailable'));
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); rejectPromise(new Error('Local Core 请求超时。操作可能已经完成，请先刷新状态或查看历史，避免重复执行。')); }, runtimeRequestTimeoutMs(message.url ?? ''));
    pending.set(id, { owner, resolve: resolvePromise, reject: rejectPromise, timer });
    try { owner.postMessage({ ...message, id }); }
    catch (error) { clearTimeout(timer); pending.delete(id); rejectPromise(error); }
  });
}
function masterKey() {
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  const path = join(app.getPath('userData'), 'master.key');
  if (existsSync(path)) return safeStorage.decryptString(readFileSync(path));
  const key = randomBytes(32).toString('base64');
  writeFileSync(path, safeStorage.encryptString(key), { mode: 0o600 });
  return key;
}
async function ensureCore() {
  if (coreReady) return coreReady;
  let instance;
  coreReady = (async () => {
    instance = utilityProcess.fork(fileURLToPath(new URL('./utility.mjs', import.meta.url)), [], { serviceName: 'DBPilot Core' });
    child = instance;
    instance.on('message', message => {
      const entry = pending.get(message.id);
      if (!entry || entry.owner !== instance) return;
      clearTimeout(entry.timer); pending.delete(message.id); entry.resolve(message);
    });
    instance.on('exit', () => {
      for (const [id, entry] of pending) {
        if (entry.owner !== instance) continue;
        clearTimeout(entry.timer); pending.delete(id); entry.reject(new Error('Local Core interrupted'));
      }
      if (child === instance) { child = undefined; coreReady = undefined; }
    });
    const answer = await sendChild({ kind: 'init', dataDir: app.getPath('userData'), masterKey: masterKey(), ai: process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_MODEL ? { apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL, baseUrl: process.env.DEEPSEEK_BASE_URL } : undefined });
    if (answer.statusCode !== 200) throw new Error(answer.body?.code === 'RUNTIME_IN_USE' ? 'Runtime 数据目录正在使用，请先关闭已有运行实例。' : 'Local Core failed to start');
  })().catch(error => {
    instance?.kill();
    if (child === instance) { child = undefined; coreReady = undefined; }
    throw error;
  });
  return coreReady;
}
async function requestRemote(route, baseUrl = target.baseUrl) {
  return requestRuntimeJson(new URL(route.url, baseUrl), { method: route.method, headers: route.payload === undefined ? {} : { 'content-type': 'application/json' }, body: route.payload === undefined ? undefined : JSON.stringify(route.payload) });
}

// Do not await readiness at module scope: Electron waits for ESM evaluation before ready.
void app.whenReady().then(() => {
const targetPath = join(app.getPath('userData'), 'runtime.json');
if (existsSync(targetPath)) target = validateTarget(JSON.parse(readFileSync(targetPath, 'utf8')));
protocol.handle('app', async request => {
  const url = new URL(request.url);
  if (url.hostname !== 'dbpilot') return new Response('Not found', { status: 404 });
  const file = resolve(webRoot, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
  if (!file.startsWith(`${webRoot}${sep}`) || !existsSync(file)) return new Response('Not found', { status: 404 });
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }[extname(file)] ?? 'application/octet-stream';
  // Monaco generates theme/layout styles at runtime. Only styles allow inline
  // content; scripts and workers remain restricted to packaged app resources.
  return new Response(readFileSync(file), { headers: { 'content-type': mime, 'content-security-policy': "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" } });
});
session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
ipcMain.handle('dbpilot:invoke', async (event, operation, input) => {
  if (!trusted(event)) throw new Error('Untrusted IPC source');
  const route = routeForDesktopOperation(operation, input);
  if (target.kind === 'remote') return requestRemote(route);
  await ensureCore();
  return sendChild({ kind: 'request', ...route });
});
ipcMain.handle('dbpilot:target:get', event => { if (!trusted(event)) throw new Error('Untrusted IPC source'); return target; });
ipcMain.handle('dbpilot:target:set', async (event, value) => {
  if (!trusted(event)) throw new Error('Untrusted IPC source');
  const candidate = validateTarget(value);
  if (candidate.kind === 'remote') {
    const response = await requestRemote({ method: 'GET', url: '/api/v1/runtime' }, candidate.baseUrl);
    if (response.statusCode !== 200) throw new Error('Remote Runtime handshake failed');
    candidate.runtimeId = validateRuntimeHandshake(response.body).runtimeId;
  }
  target = candidate;
  writeFileSync(targetPath, JSON.stringify(target), { mode: 0o600 });
  return target;
});
ipcMain.handle('dbpilot:clipboard:write', (event, text) => {
  if (!trusted(event)) throw new Error('Untrusted IPC source');
  if (typeof text !== 'string' || text.length > 16000) throw new Error('Invalid clipboard text');
  clipboard.writeText(text);
});
ipcMain.handle('dbpilot:sqlite:pick', async event => {
  if (!trusted(event)) throw new Error('Untrusted IPC source');
  const selected = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }, { name: 'All files', extensions: ['*'] }] });
  return selected.canceled ? null : selected.filePaths[0];
});

function createWindow() {
  window = new BrowserWindow({ width: 1300, height: 850, minWidth: 900, minHeight: 650, webPreferences: { preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('app://dbpilot/')) event.preventDefault(); });
  void window.loadURL('app://dbpilot/index.html');
}
createWindow();
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => child?.kill());

});

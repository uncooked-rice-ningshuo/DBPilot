// Isolated UI fixture: temporary SQLite, encrypted configuration, simulated model API.
import { createApp } from '../../dist/server/apps/server/src/app.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'dbpilot-workbench-ui-'));
const filename = join(dir, 'target.db'); const db = new Database(filename);
for (let i=0;i<120;i++) db.exec(`CREATE TABLE example_${String(i).padStart(3,'0')} (id INTEGER, name TEXT)`);
db.exec("INSERT INTO example_000 VALUES (1,'Fixture row')"); db.close();
const app = await createApp({ dataDir: dir, masterKey: randomBytes(32).toString('base64'), webRoot: resolve('dist/web'), aiFetch: async url => new Response(JSON.stringify(String(url).endsWith('/models') ? { data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] } : { choices: [{ message: { role: 'assistant', content: 'AI settings fixture connected. No external model was called.' } }] })) });
for (const name of ['界面验收库', '备用验收库']) await app.inject({ method:'POST', url:'/api/v1/connections', payload:{ name, engine:'sqlite', filename } });
await app.listen({host:'127.0.0.1',port:3139});
console.log('Isolated workbench UI fixture: http://127.0.0.1:3139');
async function close(){ await app.close(); rmSync(dir,{recursive:true,force:true}); process.exit(0); }
process.once('SIGINT',close); process.once('SIGTERM',close);

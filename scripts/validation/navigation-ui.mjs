// Isolated real PostgreSQL + SQLite navigation fixture; never uses saved user connections.
import { createApp } from '../../dist/server/apps/server/src/app.js';
import Database from 'better-sqlite3';
import { Client } from 'pg';
import { mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'dbpilot-navigation-ui-'));
const filename = join(dir, 'target.db'); const db = new Database(filename);
const tableCount = Math.min(10000, Math.max(120, Number(process.env.DBPILOT_NAV_TABLE_COUNT) || 120));
for (let i=0;i<tableCount;i++) db.exec(`CREATE TABLE example_${String(i).padStart(3,'0')} (id INTEGER, name TEXT)`);
db.exec("INSERT INTO example_000 VALUES (1,'Fixture row')"); db.close();
const config = { host:'127.0.0.1', port:55433, user:process.env.USER, database:'postgres' };
const admin = new Client(config); await admin.connect();
const names = [0,1].map(i => `dbpilot_nav_${randomBytes(4).toString('hex')}_${i}`);
const created = [];
let app;
async function close(){
  if (app) await app.close();
  for (const name of created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end(); rmSync(dir,{recursive:true,force:true});
}
try {
  for (const [i,name] of names.entries()) {
    await admin.query(`CREATE DATABASE "${name}"`); created.push(name);
    const client = new Client({...config,database:name}); await client.connect();
    try { await client.query(`CREATE TABLE navigation_sample(value INTEGER); INSERT INTO navigation_sample VALUES (${41+i})`); }
    finally { await client.end(); }
  }
  app = await createApp({ dataDir:dir, masterKey:randomBytes(32).toString('base64'), webRoot:resolve('dist/web') });
  for (const name of ['重复连接','重复连接']) await app.inject({method:'POST',url:'/api/v1/connections',payload:{name,engine:'sqlite',filename}});
  await app.inject({method:'POST',url:'/api/v1/connections',payload:{name:'服务器导航验收',engine:'postgres',host:config.host,port:config.port,user:config.user,password:''}});
  await app.listen({host:'127.0.0.1',port:3139});
  console.log(JSON.stringify({url:'http://127.0.0.1:3139',databases:names,pid:process.pid}));
  process.once('SIGINT',()=>void close().then(()=>process.exit(0)));
  process.once('SIGTERM',()=>void close().then(()=>process.exit(0)));
} catch(error) { await close(); throw error; }

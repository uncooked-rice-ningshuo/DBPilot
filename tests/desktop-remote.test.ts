import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { createApp } from '../apps/server/src/app.js';

it.skipIf(process.env.DBPILOT_TEST_DESKTOP !== '1')('switches real Electron between isolated HTTP Runtime and Local Core', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-desktop-remote-'));
  const filename = join(dir, 'remote.db');
  const db = new Database(filename); db.exec('CREATE TABLE sample(value INTEGER); INSERT INTO sample VALUES(73)'); db.close();
  const remote = await createApp({ai:{apiKey:'fixture-only',model:'fixture'},aiFetch:async(_url,init)=>{
    const body=JSON.parse(String(init?.body));
    const message=body.tool_choice?{role:'assistant',tool_calls:[{id:'probe',type:'function',function:{name:'dbpilot_probe',arguments:'{"ok":true}'}}]}:{role:'assistant',content:'Remote Agent ready.'};
    return new Response(JSON.stringify({choices:[{message}]}));
  }});
  const connection = (await remote.inject({ method: 'POST', url: '/api/v1/connections', payload: { name: 'Remote fixture', engine: 'sqlite', filename } })).json();
  const runtime = (await remote.inject('/api/v1/runtime')).json();
  const baseUrl = await remote.listen({ host: '127.0.0.1', port: 0 });
  const exercise = `(async () => {
    const api = window.dbpilotDesktop;
    const call = async (op, input = {}) => {
      const response = await api[op](input);
      if (response.statusCode >= 400) throw new Error(op + ': ' + JSON.stringify(response.body));
      return response.body;
    };
    const local = await call('runtime.info');
    const target = await api.setTarget({ kind: 'remote', baseUrl: ${JSON.stringify(baseUrl)} });
    if (target.runtimeId !== ${JSON.stringify(runtime.runtimeId)}) throw new Error('Wrong handshake identity');
    if ((await call('runtime.info')).runtimeId !== target.runtimeId) throw new Error('Wrong remote');
    const probe=await call('ai.test',{body:{provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'fixture'}});
    if(!probe.toolCalling)throw Error('Remote model probe failed');
    const agent=await call('ai.start',{body:{runtimeId:target.runtimeId,mode:'suggest',allowedConnectionIds:[],clientRequestId:crypto.randomUUID(),request:'Hello'}});
    let agentComplete=false;
    for(let i=0;i<100;i++){
      const state=await call('ai.get',{id:agent.id});
      if(state.status==='succeeded'){agentComplete=true;break;}
      if(state.status!=='running')throw Error('Remote Agent failed');
      await new Promise(r=>setTimeout(r,20));
    }
    if(!agentComplete || (await call('ai.list')).runs.length!==1)throw Error('Remote Agent history missing');
    await call('connections.test',{id:${JSON.stringify(connection.id)}});
    await call('ai.cancel',{id:agent.id});
    const resume=await api['ai.resume']({id:agent.id});
    if(resume.statusCode!==403)throw Error('Unexpected bodyless resume status: '+resume.statusCode);
    const plan = await call('plans.prepare', { body: { connectionId: ${JSON.stringify(connection.id)}, source: 'human', sql: 'SELECT value FROM sample' } });
    const execution = await call('executions.start', { body: { planId: plan.id } });
    let finished = false;
    for (let i = 0; i < 150; i++) {
      const state = await call('executions.get', { id: execution.executionId });
      if (state.status === 'succeeded') {
        const result = await call('executions.resultPage', { id: execution.executionId, index: 0 });
        if (JSON.stringify(result.rows) !== '[[73]]') throw new Error('Wrong remote result');
        finished = true; break;
      }
      if (state.status !== 'running') throw new Error('Remote query failed');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!finished) throw new Error('Remote query timed out');
    let rejected = false;
    try { await api.setTarget({ kind: 'remote', baseUrl: 'http://example.invalid' }); } catch { rejected = true; }
    if (!rejected || (await api.getTarget()).runtimeId !== target.runtimeId) throw new Error('Invalid target changed active runtime');
    await call('executions.cancel',{id:execution.executionId});
    await api.setTarget({ kind: 'local' });
    if ((await call('runtime.info')).runtimeId !== local.runtimeId) throw new Error('Local identity changed');
    const localConnections = await call('connections.list');
    if (JSON.stringify(localConnections).includes(${JSON.stringify(connection.id)})) throw new Error('Remote connection leaked into local');
    return 'DBPILOT_REMOTE_READY';
  })()`;
  const entry = join(dir, 'entry.mjs');
  writeFileSync(entry, `import { app } from 'electron';
app.setPath('userData', ${JSON.stringify(join(dir, 'userdata'))});
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try { console.log(await window.webContents.executeJavaScript(${JSON.stringify(exercise)})); }
    catch (error) { console.log('DBPILOT_REMOTE_FAILED: ' + error.message); }
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
    expect(output).toContain('DBPILOT_REMOTE_READY');
  } finally { await remote.close(); rmSync(dir, { recursive: true, force: true }); }
}, 30000);

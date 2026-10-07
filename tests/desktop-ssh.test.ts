import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { sshFixture } from './fixtures/ssh-server.js';
it.skipIf(process.env.DBPILOT_TEST_DESKTOP!=='1'||process.env.DBPILOT_TEST_SSH!=='1')('uses the real Electron Local Core SSH implementation without optional native crypto addons',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dbpilot-desktop-ssh-'));const ssh=await sshFixture([55434]);
  const body={engine:'mysql',name:'SSH desktop',host:'127.0.0.1',port:55434,database:'dbpilot_test',user:'root',password:'dbpilot-test-only',ssl:false,ssh:{host:'127.0.0.1',port:ssh.port,user:'fixture',password:'ssh-fixture-only',hostFingerprint:ssh.fingerprint}};
  const exercise=`(async()=>{const api=window.dbpilotDesktop;const body=${JSON.stringify(body)};const response=await api['connections.testDraft']({body});if(response.statusCode!==200)throw Error(JSON.stringify(response.body));const saved=await api['connections.create']({body});if(saved.statusCode!==201||JSON.stringify(saved.body).includes('ssh-fixture-only'))throw Error('SSH secret leak or save failed');return 'DBPILOT_SSH_READY';})()`;
  const entry=join(dir,'entry.mjs');
  writeFileSync(entry,`import { app } from 'electron';app.setPath('userData',${JSON.stringify(dir)});app.on('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',async()=>{try{console.log(await window.webContents.executeJavaScript(${JSON.stringify(exercise)}));}catch(error){console.log('SSH_FAILED: '+error.message);}finally{app.quit();}}));await import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/main.mjs')).href)});`);
  const env:NodeJS.ProcessEnv={...process.env,DBPILOT_DESKTOP_DATA_DIR:join(dir,'runtime')};delete env.ELECTRON_RUN_AS_NODE;delete env.DEEPSEEK_API_KEY;delete env.DEEPSEEK_MODEL;delete env.DEEPSEEK_BASE_URL;
  try{const executable=createRequire(import.meta.url)('electron') as string;const output=await new Promise<string>((done,reject)=>execFile(executable,[entry],{env,timeout:25000},(error,stdout)=>error?reject(error):done(stdout)));expect(output).toContain('DBPILOT_SSH_READY');expect(ssh.metrics.forwards).toBeGreaterThan(0);}
  finally{await ssh.close();rmSync(dir,{recursive:true,force:true});}
},30000);

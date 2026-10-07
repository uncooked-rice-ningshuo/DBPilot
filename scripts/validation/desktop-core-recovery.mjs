import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import Database from 'better-sqlite3';
const {_electron:electron}=await import(process.env.DBPILOT_PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'dbpilot-core-recovery-'));const filename=join(dir,'target.db');const db=new Database(filename);db.exec('CREATE TABLE sample(value INTEGER)');
const env={...process.env,DBPILOT_DESKTOP_DATA_DIR:join(dir,'runtime')};delete env.ELECTRON_RUN_AS_NODE;delete env.DEEPSEEK_API_KEY;delete env.DEEPSEEK_MODEL;delete env.DEEPSEEK_BASE_URL;
let app;
try{
 app=await electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[resolve('.')],env});const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
 const saved=await page.evaluate(async filename=>{
  const api=window.dbpilotDesktop;const call=async(op,input={})=>{const r=await api[op](input);if(r.statusCode>=400)throw Error(op);return r.body;};
  const runtime=await call('runtime.info');const connection=await call('connections.create',{body:{engine:'sqlite',name:'recovery',filename}});
  const plan=await call('plans.prepare',{body:{connectionId:connection.id,source:'human',sql:'INSERT INTO sample VALUES(1)'}});const execution=await call('executions.start',{body:{planId:plan.id}});
  for(let i=0;i<100;i++){const state=await call('executions.get',{id:execution.executionId});if(state.status==='succeeded')return{runtimeId:runtime.runtimeId,executionId:execution.executionId};if(state.status!=='running')throw Error('write failed');await new Promise(r=>setTimeout(r,20));}throw Error('write timeout');
 },filename);
 for(let cycle=0;cycle<3;cycle++){
  await app.evaluate(({app})=>{const core=app.getAppMetrics().find(item=>item.name==='DBPilot Core');if(!core)throw Error('owned Core process not found');process.kill(core.pid,'SIGKILL');});
  const recovered=await page.evaluate(async saved=>{
   const api=window.dbpilotDesktop;
   for(let i=0;i<30;i++){try{const [runtime,execution]=await Promise.all([api['runtime.info']({}),api['executions.get']({id:saved.executionId})]);if(runtime.statusCode===200&&execution.statusCode===200)return{runtimeId:runtime.body.runtimeId,status:execution.body.status};}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Core did not recover');
  },saved);
  assert.deepEqual(recovered,{runtimeId:saved.runtimeId,status:'succeeded'});assert.equal(db.prepare('SELECT count(*) AS n FROM sample').get().n,1);
 }
 console.log('Three real Electron Core crash/recovery cycles retained Runtime identity and execution evidence; committed write count remained one.');
}finally{if(app)await app.close();db.close();rmSync(dir,{recursive:true,force:true});}

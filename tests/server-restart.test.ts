import {expect,it} from 'vitest';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
it('real CLI stop/restart retains connection credentials, AI settings, conversations and request identity',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-server-restart-'));const dataDir=join(dir,'workspace');const filename=join(dir,'target.db');new Database(filename).close();let modelCalls=0;let holdModel=false;
 const model=createServer(async(req,res)=>{for await(const _chunk of req){/* Consume fixed fixture request without logging it. */}modelCalls++;if(holdModel)return;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'Persisted fixture answer.'}}]}));});
 await new Promise<void>(done=>model.listen(0,'127.0.0.1',done));
 const modelUrl=`http://127.0.0.1:${(model.address() as {port:number}).port}`;
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('DBPILOT_')||key.startsWith('DEEPSEEK_')||key==='ELECTRON_RUN_AS_NODE')delete env[key];
 Object.assign(env,{DBPILOT_DATA_DIR:dataDir,DBPILOT_PORT:'0'});
 let child:ChildProcess|undefined;
 async function start(){
  child=spawn(process.execPath,process.env.DBPILOT_TEST_COMPILED==='1'?[resolve('dist/server/apps/server/src/index.js')]:['--import','tsx',resolve('apps/server/src/index.ts')],{cwd:resolve('.'),env,stdio:['ignore','pipe','pipe']});
  return new Promise<string>((done,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('CLI startup timeout')),10000);child!.stdout!.on('data',chunk=>{output+=chunk;const match=output.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);done(match[1]);}});child!.once('exit',code=>{clearTimeout(timer);reject(Error(`CLI exited before startup: ${code}`));});child!.once('error',reject);});
 }
 async function stop(signal:'SIGTERM'|'SIGKILL'='SIGTERM'){if(!child||child.exitCode!==null||child.signalCode!==null)return;const current=child;const ended=new Promise<void>(done=>current.once('exit',()=>done()));current.kill(signal);await ended;if(signal==='SIGTERM')expect(current.exitCode).toBe(0);child=undefined;}
 let url='';const api=async(path:string,body?:unknown,method=body===undefined?'GET':'POST')=>{const r=await fetch(url+'/api/v1'+path,{method,headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
 try{
  url=await start();const runtime=(await api('/runtime')).body;expect(runtime.storage.persistent).toBe(true);
  const sqlite=(await api('/connections',{engine:'sqlite',name:'persistent SQLite',filename})).body;
  const network=(await api('/connections',{engine:'mysql',name:'stored secret fixture',host:'127.0.0.1',port:9,database:'fixture',user:'fixture',password:'fixture-database-secret',ssl:false})).body;
  expect((await api('/ai/settings',{revision:0,provider:'openai-compatible',baseUrl:modelUrl,model:'fixture',apiKey:'fixture-ai-key'},'PUT')).status).toBe(200);
  const input={runtimeId:runtime.runtimeId,mode:'suggest',allowedConnectionIds:[sqlite.id],clientRequestId:randomUUID(),request:'Persistence fixture'};
  const run=(await api('/ai/runs',input)).body;
  let state;for(let i=0;i<100;i++){state=(await api(`/ai/runs/${run.id}`)).body;if(state.status!=='running')break;await new Promise(r=>setTimeout(r,20));}expect(state.status).toBe('succeeded');expect(modelCalls).toBe(1);
  const key=readFileSync(join(dataDir,'secrets','master.key'));await stop();url=await start();
  expect((await api('/runtime')).body).toMatchObject({runtimeId:runtime.runtimeId,storage:{persistent:true}});
  const restored=(await api('/connections')).body;expect(restored.map((c:{id:string})=>c.id).sort()).toEqual([sqlite.id,network.id].sort());expect(JSON.stringify(restored)).not.toContain('fixture-database-secret');
  expect((await api('/ai/settings')).body).toMatchObject({persistent:true,configured:true,hasApiKey:true,model:'fixture'});
  expect((await api(`/ai/runs/${run.id}`)).body).toMatchObject({status:'succeeded',answer:'Persisted fixture answer.'});expect((await api('/ai/runs')).body).toMatchObject({persistent:true,runs:[{id:run.id}]});
  expect((await api('/ai/runs',input)).body).toMatchObject({id:run.id,replayed:true});expect(modelCalls).toBe(1);
  expect(readFileSync(join(dataDir,'secrets','master.key'))).toEqual(key);
  for(const path of [join(dataDir,'metadata.db'),join(dataDir,'metadata.db-wal')])if(existsSync(path)){const bytes=readFileSync(path);expect(bytes.includes(Buffer.from('fixture-ai-key'))).toBe(false);expect(bytes.includes(Buffer.from('fixture-database-secret'))).toBe(false);}
  holdModel=true;
  const interruptedInput={...input,clientRequestId:randomUUID(),request:'Interrupted fixture'};
  const interrupted=(await api('/ai/runs',interruptedInput)).body;
  for(let i=0;i<100&&modelCalls<2;i++)await new Promise(r=>setTimeout(r,10));
  expect(modelCalls).toBe(2);expect((await api(`/ai/runs/${interrupted.id}`)).body.status).toBe('running');
  await stop('SIGKILL');url=await start();
  expect((await api(`/ai/runs/${interrupted.id}`)).body).toMatchObject({status:'failed',request:'Interrupted fixture'});
  expect((await api(`/ai/runs/${run.id}`)).body.answer).toBe('Persisted fixture answer.');
  expect((await api('/ai/runs',interruptedInput)).body).toMatchObject({id:interrupted.id,replayed:true});
  expect((await api('/ai/runs')).body.runs).toHaveLength(2);expect(modelCalls).toBe(2);
  await stop();
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise<void>(done=>child!.once('exit',()=>done()));child.kill('SIGKILL');await ended;}model.closeAllConnections();await new Promise<void>(done=>model.close(()=>done()));rmSync(dir,{recursive:true,force:true});}
},25000);

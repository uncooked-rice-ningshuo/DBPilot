import {expect,it} from 'vitest';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../apps/server/src/app.js';
it.each(['connection','ai','ai-with-environment'] as const)('refuses a wrong workspace key at startup and preserves %s records',async kind=>{
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-secret-open-'));const masterKey=randomBytes(32).toString('base64');let app=await createApp({dataDir:dir,masterKey});let bad:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  const runtimeId=(await app.inject('/api/v1/runtime')).json().runtimeId;
  if(kind==='connection')expect((await app.inject({method:'POST',url:'/api/v1/connections',payload:{engine:'mysql',name:'retained',host:'127.0.0.1',port:9,database:'fixture',user:'fixture',password:'fixture-secret',ssl:false}})).statusCode).toBe(201);
  else expect((await app.inject({method:'PUT',url:'/api/v1/ai/settings',payload:{revision:0,provider:'openai-compatible',baseUrl:'http://127.0.0.1:9',model:'fixture',apiKey:'fixture-ai-secret'}})).statusCode).toBe(200);
  await app.close();let rejected=false;
  try{bad=await createApp({dataDir:dir,masterKey:randomBytes(32).toString('base64'),ai:kind==='ai-with-environment'?{apiKey:'environment-fixture',model:'fixture'}:undefined});}catch(error){rejected=true;expect((error as Error).message).toContain('original workspace master key');expect((error as Error).message).not.toContain('fixture-secret');}
  finally{await bad?.close();}
  expect(rejected).toBe(true);
  app=await createApp({dataDir:dir,masterKey});expect((await app.inject('/api/v1/runtime')).json().runtimeId).toBe(runtimeId);
  if(kind==='connection')expect((await app.inject('/api/v1/connections')).json()).toHaveLength(1);
  else expect((await app.inject('/api/v1/ai/settings')).json()).toMatchObject({configured:true,hasApiKey:true});
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

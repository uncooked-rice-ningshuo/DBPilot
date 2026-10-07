import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createApp } from '../apps/server/src/app.js';
it('analyzes an explicitly selected SQLite snapshot through Agent tools without rerunning its SQL',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-agent-selected-'));const filename=join(dir,'db');const db=new Database(filename);db.exec('CREATE TABLE sample(value INTEGER)');let calls=0;
 const app=await createApp({resultTtlMs:1000,ai:{apiKey:'fixture',model:'fixture'},aiFetch:async(_url,init)=>{
  const input=JSON.parse(String(init?.body));calls++;
  const message=calls===1?{role:'assistant',tool_calls:[{id:'selected',type:'function',function:{name:'get_selected_result',arguments:'{}'}}]}:{role:'assistant',content:'Selected snapshot contains 42.'};
  if(calls===2){const result=JSON.parse(input.messages.at(-1).content);expect(result.data.rows).toEqual([[42]]);expect(result.data.selectedByUser).toBe(true);}
  return new Response(JSON.stringify({choices:[{message}]}));
 }});
 try{
  const runtimeId=(await app.inject('/api/v1/runtime')).json().runtimeId;
  const connectionId=(await app.inject({method:'POST',url:'/api/v1/connections',payload:{engine:'sqlite',name:'selected',filename}})).json().id;
  const plan=(await app.inject({method:'POST',url:'/api/v1/command-plans',payload:{connectionId,source:'human',sql:'INSERT INTO sample VALUES (42); SELECT value FROM sample'}})).json();
  const executionId=(await app.inject({method:'POST',url:'/api/v1/executions',payload:{planId:plan.id}})).json().executionId;
  for(let i=0;i<100;i++){if((await app.inject(`/api/v1/executions/${executionId}`)).json().status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  const resultSource={executionId,connectionId,setId:1};
  const body={runtimeId,clientRequestId:randomUUID(),request:'Summarize selected snapshot',mode:'suggest',allowedConnectionIds:[connectionId],resultSource};
  expect((await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:{...body,allowedConnectionIds:[]}})).statusCode).toBe(403);
  const created=await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:body});expect(created.statusCode).toBe(202);
  let snapshot;for(let i=0;i<100;i++){snapshot=(await app.inject(`/api/v1/ai/runs/${created.json().id}`)).json();if(snapshot.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  expect(snapshot).toMatchObject({status:'succeeded',resultSource});expect(db.prepare('SELECT count(*) AS n FROM sample').get()).toEqual({n:1});expect(calls).toBe(2);
  await new Promise(r=>setTimeout(r,1050));
  expect((await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:{...body,clientRequestId:randomUUID()}})).statusCode).toBe(410);expect(calls).toBe(2);
 }finally{await app.close();db.close();rmSync(dir,{recursive:true,force:true});}
});

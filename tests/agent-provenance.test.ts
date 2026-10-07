import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { AuditStore } from '../packages/storage/src/audit.js';
it('retains actual model identity and correlates tool audit records to the run',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-provenance-'));let count=0;
 let app=await createApp({dataDir:dir,ai:{apiKey:'must-not-leak',model:'fixture-model'},aiFetch:async()=>new Response(JSON.stringify({choices:[{message:count++===0?{role:'assistant',tool_calls:[{id:'reference-1',type:'function',function:{name:'command_reference',arguments:'{"command":"ls"}'}}]}:{role:'assistant',content:'Reference only.'}}]}))});
 try{
  const runtimeId=(await app.inject('/api/v1/runtime')).json().runtimeId;
  const id=(await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:{runtimeId,clientRequestId:randomUUID(),request:'ls help',mode:'suggest',allowedConnectionIds:[]}})).json().id;
  let state;for(let i=0;i<50;i++){state=(await app.inject(`/api/v1/ai/runs/${id}`)).json();if(state.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  expect(state.model).toEqual({provider:'deepseek',id:'fixture-model'});
  const audit=new AuditStore(dir);try{const events=audit.list().filter(event=>event.action==='agent_tool');expect(events).toHaveLength(1);expect(events[0]).toMatchObject({runId:id,toolCallId:'reference-1:0',stepId:1,status:'command_reference'});expect(JSON.stringify(audit.list())).not.toContain('must-not-leak');}finally{audit.close();}
  expect(JSON.stringify(state)).not.toContain('must-not-leak');
  await app.close();app=await createApp({dataDir:dir,ai:{apiKey:'different-key',model:'changed-model'}});
  expect((await app.inject(`/api/v1/ai/runs/${id}`)).json().model).toEqual({provider:'deepseek',id:'fixture-model'});
  expect(count).toBe(2);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

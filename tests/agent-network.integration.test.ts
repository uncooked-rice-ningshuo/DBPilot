import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import mysql from 'mysql2/promise';
import { createApp } from '../apps/server/src/app.js';
const targets = [
  {engine:'postgres' as const, enabled:process.env.DBPILOT_TEST_POSTGRES==='1',host:'127.0.0.1',port:55433,database:'postgres',user:process.env.USER??'ningshuo',password:'',schema:'public'},
  {engine:'mysql' as const, enabled:process.env.DBPILOT_TEST_MYSQL==='1',host:'127.0.0.1',port:55434,database:'dbpilot_test',user:'root',password:'dbpilot-test-only',schema:'dbpilot_test'},
];
async function admin(target:typeof targets[number]) {
  if(target.engine==='postgres'){const db=new Client(target);await db.connect();return{query:async(sql:string)=>(await db.query(sql)).rows,close:()=>db.end()};}
  const db=await mysql.createConnection({host:target.host,port:target.port,database:target.database,user:target.user,password:target.password});
  return{query:async(sql:string)=>(await db.query(sql))[0] as unknown[],close:()=>db.end()};
}
async function wait(app:Awaited<ReturnType<typeof createApp>>,id:string) {
  for(let i=0;i<300;i++){const state=(await app.inject(`/api/v1/ai/runs/${id}`)).json();if(!['running','cancelling'].includes(state.status))return state;await new Promise(r=>setTimeout(r,20));}
  throw Error('Agent did not settle');
}
const response=(message:unknown)=>new Response(JSON.stringify({choices:[{message}]}));
const call=(id:string,name:string,args:unknown)=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
it.skipIf(!targets.every(t=>t.enabled))('runs one Agent across real PostgreSQL and MySQL with discovery, exact approvals and result provenance',async()=>{
  const table=`dbpilot_agent_${randomUUID().replaceAll('-','')}`;
  const clients=await Promise.all(targets.map(admin));const ids:string[]=[];let runtimeId='';let turn=0;
  const app=await createApp({ai:{apiKey:'fixture-only',model:'fixture'},aiFetch:async(_url,init)=>{
    const messages=JSON.parse(String(init?.body)).messages;
    const outputs=messages.filter((m:any)=>m.role==='tool').slice(-2).map((m:any)=>JSON.parse(m.content).data);
    const batch=(name:string,args:(i:number)=>unknown)=>response({role:'assistant',tool_calls:targets.map((_,i)=>call(`${turn}-${i}`,name,args(i)))});
    const target=(i:number)=>({runtimeId,connectionId:ids[i],database:targets[i].database});
    switch(turn++){
      case 0:return response({role:'assistant',tool_calls:[call('discover','list_connections',{})]});
      case 1:expect(outputs[0].connections.map((c:any)=>c.id)).toEqual(ids);return batch('list_databases',i=>({runtimeId,connectionId:ids[i]}));
      case 2:outputs.forEach((o:any,i:number)=>expect(o.databases).toContainEqual({name:targets[i].database}));return batch('search_schema',i=>({...target(i),search:table}));
      case 3:outputs.forEach((o:any,i:number)=>expect(o.tables).toContainEqual({schema:targets[i].schema,name:table,columns:[]}));return batch('describe_table',i=>({...target(i),schema:targets[i].schema,table}));
      case 4:outputs.forEach((o:any)=>expect(o.tables[0].columns.map((c:any)=>c.name)).toEqual(['amount','missing']));return batch('propose_sql',i=>({...target(i),sql:`SELECT amount, missing FROM ${table}`}));
      case 5:return batch('execute_plan',i=>({runtimeId,connectionId:ids[i],planId:outputs[i].planId}));
      case 6:return batch('get_result',i=>({runtimeId,connectionId:ids[i],executionId:outputs[i].executionId,setId:0}));
      default:outputs.forEach((o:any,i:number)=>expect(o).toMatchObject({runtimeId,connectionId:ids[i],rows:[['9007199254740993.123456789',null]],truncated:false}));return response({role:'assistant',content:'Both real database snapshots read.'});
    }
  }});
  try{
    for(const db of clients){await db.query(`CREATE TABLE ${table}(amount DECIMAL(29,9), missing VARCHAR(10))`);await db.query(`INSERT INTO ${table} VALUES(9007199254740993.123456789,NULL)`);}
    runtimeId=(await app.inject('/api/v1/runtime')).json().runtimeId;
    for(const {enabled,schema,...target} of targets){const created=await app.inject({method:'POST',url:'/api/v1/connections',payload:{...target,name:target.engine,ssl:false}});expect(created.statusCode).toBe(201);ids.push(created.json().id);}
    const started=await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:{runtimeId,clientRequestId:randomUUID(),request:'Compare both databases',mode:'execute',allowedConnectionIds:ids}});expect(started.statusCode).toBe(202);const id=started.json().id;
    for(const [index,connectionId] of ids.entries()){
      const state=await wait(app,id);expect(state).toMatchObject({status:'awaiting_approval',pendingApproval:{connectionId,database:targets[index].database,steps:[{sql:`SELECT amount, missing FROM ${table}`}]}});
      expect((await app.inject({method:'POST',url:`/api/v1/approvals/${state.pendingApproval.planId}/decision`,payload:{decision:'approve'}})).statusCode).toBe(200);
      expect((await app.inject({method:'POST',url:`/api/v1/ai/runs/${id}/resume`})).statusCode).toBe(202);
    }
    expect(await wait(app,id)).toMatchObject({status:'succeeded',answer:'Both real database snapshots read.'});expect(turn).toBe(8);
    for(const id of ids)expect((await app.inject(`/api/v1/executions?connectionId=${id}`)).json()).toHaveLength(1);
  }finally{await app.close();await Promise.all(clients.map(async db=>{try{await db.query(`DROP TABLE IF EXISTS ${table}`);}finally{await db.close();}}));}
},20000);
for(const target of targets)it.skipIf(!target.enabled)(`${target.engine}: Agent reports partial commit and request resubmit does not replay writes`,async()=>{
  const table=`dbpilot_partial_${randomUUID().replaceAll('-','')}`;const db=await admin(target);let binding={runtimeId:'',connectionId:''};let turn=0;
  const app=await createApp({ai:{apiKey:'fixture-only',model:'fixture'},aiFetch:async(_url,init)=>{
    const messages=JSON.parse(String(init?.body)).messages;const name=turn++===0?'propose_sql':'execute_plan';expect(turn).toBeLessThanOrEqual(2);
    const args=name==='propose_sql'?{...binding,database:target.database,sql:`INSERT INTO ${table} VALUES(1); INSERT INTO ${table}_missing VALUES(2); INSERT INTO ${table} VALUES(3)`}:{...binding,planId:JSON.parse(messages.at(-1).content).data.planId};
    return response({role:'assistant',tool_calls:[call(`partial-${turn}`,name,args)]});
  }});
  try{
    await db.query(`CREATE TABLE ${table}(value INTEGER)`);binding.runtimeId=(await app.inject('/api/v1/runtime')).json().runtimeId;
    const {enabled,schema,...config}=target;binding.connectionId=(await app.inject({method:'POST',url:'/api/v1/connections',payload:{...config,name:'partial',ssl:false}})).json().id;
    const payload={runtimeId:binding.runtimeId,clientRequestId:randomUUID(),request:'Partial failure fixture',mode:'execute',allowedConnectionIds:[binding.connectionId]};
    const id=(await app.inject({method:'POST',url:'/api/v1/ai/runs',payload})).json().id;const pending=await wait(app,id);expect(pending.status).toBe('awaiting_approval');
    await app.inject({method:'POST',url:`/api/v1/approvals/${pending.pendingApproval.planId}/decision`,payload:{decision:'approve'}});await app.inject({method:'POST',url:`/api/v1/ai/runs/${id}/resume`});
    const failed=await wait(app,id);expect(failed.status).toBe('failed');expect(failed.activity.at(-1).result.data.results.map((r:any)=>r.status)).toEqual(['succeeded','failed','skipped']);
    expect((await app.inject({method:'POST',url:'/api/v1/ai/runs',payload})).json()).toMatchObject({id,replayed:true});expect(turn).toBe(2);
    expect(await db.query(`SELECT value FROM ${table}`)).toEqual([{value:1}]);
  }finally{await app.close();try{await db.query(`DROP TABLE IF EXISTS ${table}`);}finally{await db.close();}}
},15000);

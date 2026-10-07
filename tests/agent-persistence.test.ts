import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { AgentRunStore } from '../packages/storage/src/agent-runs.js';
import type { AgentSnapshot } from '../packages/ai-core/src/agent.js';

it('restores conversation and idempotency after restart without invoking a model until a new user request', async () => {
  const dir=mkdtempSync(join(tmpdir(),'dbpilot-agent-journal-'));
  let completions=0;
  const aiFetch: typeof fetch = async (_url, init) => {
    completions++;
    if(completions===2) expect(String(init?.body)).toContain('First answer');
    return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:completions===1?'First answer':'Second answer'}}]}));
  };
  let app=await createApp({dataDir:dir,ai:{apiKey:'fixture-secret',model:'fixture'},aiFetch});
  const wait=async(id:string)=>{for(let n=0;n<100;n++){const s=(await app.inject(`/api/v1/ai/runs/${id}`)).json();if(s.status!=='running')return s;await new Promise(r=>setTimeout(r,5));}throw Error('Timeout');};
  try {
    const runtimeId=(await app.inject('/api/v1/runtime')).json().runtimeId;
    const body={runtimeId,clientRequestId:randomUUID(),mode:'suggest',allowedConnectionIds:[],request:'First question'};
    const first=(await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:body})).json().id;
    expect((await wait(first)).answer).toBe('First answer');
    await app.close();
    app=await createApp({dataDir:dir,ai:{apiKey:'fixture-secret',model:'fixture'},aiFetch});
    expect(completions).toBe(1);
    expect((await app.inject(`/api/v1/ai/runs/${first}`)).json()).toMatchObject({status:'succeeded',answer:'First answer'});
    expect((await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:body})).json()).toEqual({id:first,replayed:true});
    expect(completions).toBe(1);
    const next={...body,clientRequestId:randomUUID(),previousRunId:first,request:'Follow up'};
    const second=(await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:next})).json().id;
    expect((await wait(second)).history[0].answer).toBe('First answer');
    const list=(await app.inject('/api/v1/ai/runs')).json();
    expect(list.persistent).toBe(true);expect(list.runs.map((r:{id:string})=>r.id)).toEqual([second]);
    expect(JSON.stringify(list)).not.toContain('fixture-secret');
    await app.close();app=await createApp({dataDir:dir,ai:{apiKey:'fixture-secret',model:'fixture'},aiFetch});
    expect((await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:{...next,clientRequestId:randomUUID()}})).statusCode).toBe(409);
    expect(completions).toBe(2);
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});

it('marks interrupted checkpoints failed, removes approvals and bounds retained runs transactionally', () => {
  const dir=mkdtempSync(join(tmpdir(),'dbpilot-agent-recovery-'));
  let store=new AgentRunStore(dir);
  const runtimeId=randomUUID();
  const snapshot=(id:string):AgentSnapshot=>({id,runtimeId,request:'test',mode:'execute',allowedConnectionIds:[],history:[],historyTruncated:false,status:'awaiting_approval',activity:[],pendingApproval:{runtimeId,connectionId:randomUUID(),planId:randomUUID(),steps:[]}});
  try {
    const id=randomUUID();
    store.begin({snapshot:snapshot(id),signature:'scope',requestId:'request',requestHash:'hash',createdAt:1});
    store.close();store=new AgentRunStore(dir);
    expect(store.get(id)?.snapshot).toMatchObject({status:'failed'});
    expect(store.get(id)?.snapshot.pendingApproval).toBeUndefined();
    expect(store.get(id)?.snapshot.error).toContain('No tools or writes were replayed');
    for(let i=0;i<34;i++)store.begin({snapshot:{...snapshot(randomUUID()),status:'succeeded',pendingApproval:undefined},signature:'scope',requestId:`r${i}`,requestHash:'hash',createdAt:i+2});
    expect(store.all()).toHaveLength(32);expect(store.get(id)).toBeUndefined();
    expect(store.byRequest('request')).toEqual({id,requestHash:'hash',available:false});
    const parent=store.all().at(-1)!;
    expect(()=>store.begin({snapshot:snapshot(randomUUID()),signature:'changed',requestId:'invalid',requestHash:'hash',createdAt:50},parent.snapshot.id)).toThrow('Conversation changed');
    expect(store.get(parent.snapshot.id)?.nextRunId).toBeUndefined();
    expect(store.all()).toHaveLength(32);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

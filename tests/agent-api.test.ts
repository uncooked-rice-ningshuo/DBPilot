import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.js';

it('pauses a multi-turn Agent for trusted approval, executes real SQLite, and feeds its result to the model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-agent-loop-'));
  const filename = join(dir, 'target.db'); new Database(filename).close();
  let target: { runtimeId: string; connectionId: string };
  let turn = 0;
  const aiFetch = (async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    expect(JSON.stringify(request.messages)).not.toContain('test-secret');
    const last = request.messages.at(-1);
    const call = (name: string, args: unknown) => ({ role: 'assistant', content: null, tool_calls: [{ id: `call-${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    let message;
    switch (turn++) {
      case 0: message = call('list_connections', {}); break;
      case 1: message = call('propose_sql', { ...target, sql: 'SELECT 42 AS answer' }); break;
      case 2: message = call('execute_plan', { ...target, planId: JSON.parse(last.content).data.planId }); break;
      case 3: message = call('get_result', { ...target, executionId: JSON.parse(last.content).data.executionId, setId: 0 }); break;
      default:
        expect(JSON.parse(last.content).data.rows).toEqual([[42]]);
        message = { role: 'assistant', content: 'Result is 42.' };
    }
    return new Response(JSON.stringify({ choices: [{ message }] }));
  }) as typeof fetch;
  const app = await createApp({ ai: { apiKey: 'test-secret', model: 'test-model' }, aiFetch });
  try {
    const runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
    const connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'test', filename } })).json().id;
    target = { runtimeId, connectionId };
    const body = { runtimeId, clientRequestId: randomUUID(), request: 'Read 42', mode: 'execute', allowedConnectionIds: [connectionId] };
    const start = await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: body });
    expect(start.statusCode).toBe(202);
    const id = start.json().id;
    const wait = async () => {
      for (let i = 0; i < 100; i++) {
        const state = (await app.inject(`/api/v1/ai/runs/${id}`)).json();
        if (state.status !== 'running') return state;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error('Agent did not yield');
    };
    const paused = await wait();
    expect(paused.status).toBe('awaiting_approval');
    expect(paused.pendingApproval).toMatchObject({ ...target, steps: [{ sql: 'SELECT 42 AS answer' }] });
    expect((await app.inject({ method: 'POST', url: `/api/v1/ai/runs/${id}/resume`, payload: { approved: true } })).statusCode).toBe(403);
    expect((await app.inject(`/api/v1/executions?connectionId=${connectionId}`)).json()).toEqual([]);
    const replay = await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: body });
    expect(replay.json().id).toBe(id);
    expect((await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: { ...body, request: 'changed task' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: { ...body, clientRequestId: randomUUID() } })).statusCode).toBe(409);
    await app.inject({ method: 'POST', url: `/api/v1/approvals/${paused.pendingApproval.planId}/decision`, payload: { decision: 'approve' } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/ai/runs/${id}/resume` })).statusCode).toBe(202);
    expect(await wait()).toMatchObject({ status: 'succeeded', answer: 'Result is 42.' });
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('retains the single-Agent lock until cancellation cleanup settles', async () => {
  let release!: (response:Response)=>void;
  let entered!: ()=>void;const started=new Promise<void>(done=>{entered=done;});
  const app=await createApp({ai:{apiKey:'fixture-only',model:'fixture'},aiFetch:async()=>{entered();return new Promise<Response>(done=>{release=done;});}});
  try{
    const runtimeId=(await app.inject('/api/v1/runtime')).json().runtimeId;
    const payload={runtimeId,mode:'suggest',allowedConnectionIds:[],request:'test',clientRequestId:randomUUID()};
    const first=(await app.inject({method:'POST',url:'/api/v1/ai/runs',payload})).json();await started;
    const cancellation=app.inject({method:'POST',url:`/api/v1/ai/runs/${first.id}/cancel`}).then(response=>response);
    await new Promise(done=>setTimeout(done,10));
    expect((await app.inject(`/api/v1/ai/runs/${first.id}`)).json().status).toBe('cancelling');
    expect((await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:{...payload,clientRequestId:randomUUID()}})).statusCode).toBe(409);
    release(new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'late'}}]})));
    expect((await cancellation).json().status).toBe('cancelled');
    expect((await app.inject(`/api/v1/ai/runs/${first.id}`)).json().answer).toBeUndefined();
  }finally{release?.(new Response('{}'));await app.close();}
});

import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { AgentRun } from '../packages/ai-core/src/agent.js';
import { createAgentTools } from '../packages/ai-core/src/tools.js';

const runtimeId = randomUUID();
const connectionId = randomUUID();
describe('Agent loop', () => {
  it('feeds validated discovery results back to the model and completes without a selected table', async () => {
    const signal = new AbortController().signal;
    const tools = createAgentTools({ runtimeId, mode: 'suggest', allowedConnectionIds: [connectionId], signal, invoke: async () => ({ statusCode: 200, body: [{ id: connectionId, name: 'orders', engine: 'sqlite', version: 1 }] }) });
    let turns = 0;
    const run = new AgentRun({ runtimeId, mode: 'suggest', request: 'Find my database', tools, complete: async messages => {
      if (turns++ === 0) return { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'list_connections', arguments: '{}' } }] };
      expect(messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: '1' });
      expect(messages.at(-1)?.content).toContain('orders');
      return { role: 'assistant', content: 'Found orders.' };
    } });
    await run.start();
    expect(run.snapshot()).toMatchObject({ status: 'succeeded', answer: 'Found orders.', mode: 'suggest' });
  });
  it('stops on invalid tools instead of allowing model-written approvals', async () => {
    const tools = createAgentTools({ runtimeId, mode: 'execute', allowedConnectionIds: [connectionId], signal: new AbortController().signal, invoke: async () => { throw new Error('must not dispatch'); } });
    const run = new AgentRun({ runtimeId, mode: 'execute', request: 'test', tools, complete: async () => ({ role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'approve_plan', arguments: '{}' } }] }) });
    await run.start();
    expect(run.snapshot()).toMatchObject({ status: 'failed' });
  });
});

it('keeps execution provenance when cancellation races with execution dispatch', async () => {
  const controller = new AbortController();
  let dispatched!: () => void;
  const dispatching = new Promise<void>(resolve => { dispatched = resolve; });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const tools = createAgentTools({ runtimeId, mode: 'execute', allowedConnectionIds: [connectionId], signal: controller.signal, invoke: async operation => {
    if (operation === 'plans.prepare') return { statusCode: 200, body: { id: 'plan', connectionId, steps: [] } };
    if (operation === 'plans.get') return { statusCode: 200, body: { id: 'plan', connectionId, approved: true } };
    if (operation === 'executions.start') { dispatched(); await held; return { statusCode: 202, body: { executionId: 'execution' } }; }
    if (operation === 'executions.get') return { statusCode: 200, body: { id: 'execution', status: 'outcome_unknown', results: [] } };
    return { statusCode: 200, body: { accepted: true } };
  } });
  let turn = 0;
  const run = new AgentRun({ runtimeId, mode: 'execute', request: 'test', tools, controller, complete: async () => {
    const name = turn++ === 0 ? 'propose_sql' : 'execute_plan';
    const args = name === 'propose_sql' ? { runtimeId, connectionId, sql: 'SELECT 1' } : { runtimeId, connectionId, planId: 'plan' };
    return { role: 'assistant', content: null, tool_calls: [{ id: String(turn), type: 'function', function: { name, arguments: JSON.stringify(args) } }] };
  } });
  const started = run.start();
  await dispatching;
  const cancelled = run.cancel();
  expect(run.snapshot().status).toBe('cancelling');
  const repeatedCancellation = run.cancel();
  release();
  await Promise.all([started, cancelled, repeatedCancellation]);
  expect(run.snapshot().status).toBe('cancelled');
  expect(run.snapshot().activity).toContainEqual({ tool: 'execute_plan', result: { ok: true, data: { id: 'execution', executionId: 'execution', runtimeId, connectionId, status: 'outcome_unknown', results: [], cancellationRequested: true } } });
});

it('expires a waiting approval and never resumes or dispatches its plan after the deadline', async () => {
  const { vi } = await import('vitest'); vi.useFakeTimers();
  const controller=new AbortController();const operations:string[]=[];
  const tools=createAgentTools({runtimeId,mode:'execute',allowedConnectionIds:[connectionId],signal:controller.signal,invoke:async operation=>{
    operations.push(operation);
    return {statusCode:200,body:{id:'plan',connectionId,approved:false,steps:[]}};
  }});
  let turn=0;
  const run=new AgentRun({runtimeId,mode:'execute',request:'test',tools,controller,timeBudgetMs:50,complete:async()=>{
    const name=turn++===0?'propose_sql':'execute_plan';
    return {role:'assistant',tool_calls:[{id:String(turn),type:'function',function:{name,arguments:JSON.stringify(name==='propose_sql'?{runtimeId,connectionId,sql:'SELECT 1'}:{runtimeId,connectionId,planId:'plan'})}}]};
  }});
  try{
    await run.start();expect(run.snapshot().status).toBe('awaiting_approval');
    await vi.advanceTimersByTimeAsync(51);
    expect(run.snapshot().status).toBe('cancelled');expect(run.snapshot().pendingApproval).toBeUndefined();expect(run.resume()).toBe(false);
    expect(operations).toEqual(['plans.prepare','plans.get']);
  }finally{vi.useRealTimers();}
});

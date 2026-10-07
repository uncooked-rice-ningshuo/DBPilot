import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAgentTools, type ToolRuntime } from '../packages/ai-core/src/tools.js';

const connectionId = randomUUID();
const runtimeId = randomUUID();
function fixture(mode: 'suggest' | 'execute' = 'execute') {
  const calls: string[] = [];
  const runtime: ToolRuntime = async (operation, input) => {
    calls.push(operation);
    if (operation === 'connections.list') return { statusCode: 200, body: [{ id: connectionId, name: 'test', engine: 'sqlite', version: 1, password: 'never-model', filename: '/private/db' }, { id: randomUUID(), name: 'not-authorized' }] };
    if (operation === 'plans.prepare') return { statusCode: 200, body: { id: 'plan', connectionId, source: (input as any).body.source, approved: false, steps: [{ sql: 'SELECT 1', kind: 'read', decision: 'allow' }] } };
    if (operation === 'plans.get') return { statusCode: 200, body: { id: 'plan', connectionId, approved: false, steps: [{ sql: 'SELECT 1', kind: 'read', decision: 'ask' }] } };
    return { statusCode: 200, body: {} };
  };
  return { calls, tools: createAgentTools({ runtimeId, mode, allowedConnectionIds: [connectionId], invoke: runtime, signal: new AbortController().signal }) };
}
describe('controlled Agent tools', () => {
  it('returns only authorized connection metadata, excluding configuration secrets', async () => {
    const { tools } = fixture();
    const result = await tools.execute('1', 'list_connections', {});
    expect(result).toEqual({ ok: true, data: { runtimeId, connections: [{ id: connectionId, name: 'test', engine: 'sqlite', version: 1 }] } });
    expect(JSON.stringify(result)).not.toContain('never-model');
    expect(JSON.stringify(result)).not.toContain('/private/db');
  });
  it('rejects unknown tools, target forgery, and extra approval/source fields before dispatch', async () => {
    const { tools, calls } = fixture();
    for (const [name, args] of [
      ['approve_plan', {}],
      ['search_schema', { runtimeId: randomUUID(), connectionId }],
      ['search_schema', { runtimeId, connectionId: randomUUID() }],
      ['propose_sql', { runtimeId, connectionId, sql: 'SELECT 1', source: 'human', approved: true }],
    ] as const) expect((await tools.execute(randomUUID(), name, args)).ok).toBe(false);
    expect(calls).toEqual([]);
  });
  it('prepares AI-owned plans and never lets a model approve them', async () => {
    const { tools, calls } = fixture();
    const proposal = await tools.execute('prepare', 'propose_sql', { runtimeId, connectionId, sql: 'SELECT 1' });
    expect(proposal.ok).toBe(true);
    const result = await tools.execute('execute', 'execute_plan', { runtimeId, connectionId, planId: 'plan' });
    expect(result).toMatchObject({ ok: true, data: { status: 'awaiting_approval', planId: 'plan' } });
    expect(calls).toEqual(['plans.prepare', 'plans.get']);
  });
  it('disallows execution in suggestion mode and rejects foreign plans', async () => {
    for (const mode of ['suggest', 'execute'] as const) {
      const { tools, calls } = fixture(mode);
      expect((await tools.execute('1', 'execute_plan', { runtimeId, connectionId, planId: 'foreign' })).ok).toBe(false);
      expect(calls).toEqual([]);
    }
  });
  it('deduplicates tool calls and rejects reuse with changed arguments', async () => {
    const { tools, calls } = fixture();
    const first = await tools.execute('1', 'list_connections', {});
    expect(await tools.execute('1', 'list_connections', {})).toEqual(first);
    expect((await tools.execute('1', 'search_schema', { runtimeId, connectionId })).ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

it('does not dispatch tools after cancellation or a failed audit write', async () => {
  const controller = new AbortController();
  let calls = 0;
  const tools = createAgentTools({ runtimeId, mode: 'execute', allowedConnectionIds: [connectionId], signal: controller.signal, invoke: async () => { calls++; throw new Error('secret'); }, beforeTool: () => { throw new Error('audit secret'); } });
  expect((await tools.execute('1', 'list_connections', {})).ok).toBe(false);
  controller.abort();
  expect(await tools.execute('2', 'list_connections', {})).toEqual({ ok: false, error: 'Run cancelled' });
  expect(calls).toBe(0);
});

it('tracks bounded run-local todos without dispatching database operations', async () => {
  const { tools, calls } = fixture('suggest');
  const items = [{ id: 'inspect', text: '检查结构', status: 'in_progress' }];
  expect(await tools.execute('todo', 'update_todo', { items })).toEqual({ ok: true, data: { items, planningOnly: true } });
  const snapshot = tools.todos();
  snapshot[0].text = 'changed';
  expect(tools.todos()[0].text).toBe('检查结构');
  expect(fixture().tools.todos()).toEqual([]);
  for (const invalid of [
    [...items, ...items],
    [...items, { id: 'second', text: '第二项', status: 'in_progress' }],
    [{ id: '1', text: ' ', status: 'pending' }],
    Array.from({ length: 13 }, (_, id) => ({ id: String(id), text: 'task', status: 'pending' })),
  ]) expect((await tools.execute(randomUUID(), 'update_todo', { items: invalid })).ok).toBe(false);
  expect(tools.todos()).toEqual(items);
  expect(calls).toEqual([]);
});

it('provides fixed command references without accepting shell input or paths', async () => {
  const { tools, calls } = fixture();
  expect(await tools.execute('ls', 'command_reference', { command: 'ls' })).toMatchObject({ ok: true, data: { example: 'ls -lah', executed: false, referenceOnly: true } });
  for (const args of [{ command: 'ls; cat /etc/passwd' }, { command: 'ls', path: '/' }, { command: 'rm' }]) {
    expect((await tools.execute(randomUUID(), 'command_reference', args)).ok).toBe(false);
  }
  expect(calls).toEqual([]);
});

it('offers connection drafts without credentials, network operations or changing scope', async () => {
  const { tools, calls } = fixture();
  const draft = { engine: 'postgres', name: '分析库', host: 'db.example', port: 5432, database: 'analytics', user: 'reader' };
  expect(await tools.execute('draft', 'request_connection', draft)).toEqual({ ok: true, data: { draft, created: false, requiresUserInput: true } });
  for (const extra of [{ password: 'secret' }, { ssl: false }, { approved: true }, { ssh: {} }]) {
    expect((await tools.execute(randomUUID(), 'request_connection', { ...draft, ...extra })).ok).toBe(false);
  }
  expect((await tools.execute('target', 'connect_database', { runtimeId, connectionId: randomUUID() })).ok).toBe(false);
  expect(calls).toEqual([]);
});

it('waits for cancellation acknowledgement to become terminal without replaying an execution', async () => {
  let polls=0, starts=0, cancels=0;
  const tools=createAgentTools({runtimeId,mode:'execute',allowedConnectionIds:[connectionId],signal:new AbortController().signal,invoke:async operation=>{
    if(operation==='plans.prepare')return {statusCode:200,body:{id:'plan',connectionId,steps:[]}};
    if(operation==='plans.get')return {statusCode:200,body:{id:'plan',connectionId,approved:true}};
    if(operation==='executions.start'){starts++;return {statusCode:202,body:{executionId:'execution'}};}
    if(operation==='executions.cancel'){cancels++;return {statusCode:200,body:{accepted:true}};}
    if(operation==='executions.get')return {statusCode:200,body:{status:++polls<3?'running':'cancelled'}};
    throw Error('unexpected');
  }});
  await tools.execute('prepare','propose_sql',{runtimeId,connectionId,sql:'SELECT 1'});
  await tools.execute('execute','execute_plan',{runtimeId,connectionId,planId:'plan'});
  expect(await tools.cancelOwnedExecutions()).toMatchObject([{ok:true,data:{status:'cancelled',executionId:'execution'}}]);
  expect({polls,starts,cancels}).toEqual({polls:3,starts:1,cancels:1});
});

it('never treats a user-selected result as an owned execution that the Agent can cancel', async () => {
  const operations:string[]=[];
  const source={executionId:randomUUID(),connectionId,setId:0};
  const tools=createAgentTools({runtimeId,mode:'suggest',allowedConnectionIds:[connectionId],resultSource:source,signal:new AbortController().signal,invoke:async operation=>{operations.push(operation);return {statusCode:200,body:{columns:['value'],rows:[[42]]}};}});
  expect(await tools.execute('read','get_selected_result',{})).toMatchObject({ok:true,data:{...source,rows:[[42]],selectedByUser:true}});
  expect((await tools.execute('forge','get_selected_result',{executionId:randomUUID()})).ok).toBe(false);
  expect((await tools.execute('cancel','cancel_query',{runtimeId,connectionId,executionId:source.executionId})).ok).toBe(false);
  await tools.cancelOwnedExecutions();
  expect(operations).toEqual(['executions.resultPage']);
});

it('filters unexpected Runtime fields and rejects malformed tool output before model context',async()=>{
 let malformed=false;
 const tools=createAgentTools({runtimeId,mode:'suggest',allowedConnectionIds:[connectionId],signal:new AbortController().signal,invoke:async()=>({statusCode:200,body:{connectionId,databases:malformed?'wrong':[{name:'main'}],password:'runtime-secret'}})});
 const result=await tools.execute('valid','list_databases',{runtimeId,connectionId});expect(result.ok).toBe(true);expect(JSON.stringify(result)).not.toContain('runtime-secret');
 malformed=true;expect((await tools.execute('invalid','list_databases',{runtimeId,connectionId})).ok).toBe(false);
});

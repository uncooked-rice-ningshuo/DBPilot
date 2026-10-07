import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { routeForDesktopOperation } from '../packages/runtime-client/src/desktop-operations.js';
import { createAgentTools } from '../packages/ai-core/src/tools.js';

it.each([false, true])('uses real Runtime policy and SQLite snapshots (automatic=%s)', async automatic => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-agent-'));
  const filename = join(dir, 'target.db');
  new Database(filename).close();
  let app = await createApp({ dataDir: dir });
  try {
    const runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
    const connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'agent', filename } })).json().id;
    if (automatic) {
      await app.close();
      app = await createApp({ dataDir: dir, commandRules: [{ connectionId, kind: 'read', decision: 'allow', exactSql: 'SELECT 42 AS answer' }] });
    }
    const target = { runtimeId, connectionId };
    const tools = createAgentTools({ runtimeId, allowedConnectionIds: [connectionId], mode: 'execute', signal: new AbortController().signal, invoke: async (operation, input) => {
      const route = routeForDesktopOperation(operation, input);
      const response = await app.inject({ ...route, payload: route.payload as Record<string, unknown> });
      return { statusCode: response.statusCode, body: response.json() };
    } });
    expect(await tools.execute('catalog', 'list_databases', target)).toMatchObject({ ok: true, data: { databases: [{ name: 'main' }] } });
    expect(await tools.execute('schema', 'search_schema', { ...target, database: 'main' })).toMatchObject({ ok: true, data: { database: 'main' } });
    expect((await tools.execute('bad-target', 'propose_sql', { ...target, database: 'wrong', sql: 'SELECT 42' })).ok).toBe(false);
    const proposed = await tools.execute('1', 'propose_sql', { ...target, database: 'main', sql: 'SELECT 42 AS answer' });
    expect(proposed).toMatchObject({ ok: true, data: { database: 'main' } });
    const planId = (proposed as { data: { planId: string } }).data.planId;
    if (!automatic) {
    expect(await tools.execute('2', 'execute_plan', { ...target, planId })).toMatchObject({ ok: true, data: { status: 'awaiting_approval' } });
    expect((await app.inject({ method: 'POST', url: `/api/v1/approvals/${planId}/decision`, payload: { decision: 'approve' } })).statusCode).toBe(200);
    }
    const started = await tools.execute('3', 'execute_plan', { ...target, planId });
    expect(started).toMatchObject({ ok: true, data: { executionId: expect.any(String) } });
    const executionId = (started as { data: { executionId: string } }).data.executionId;
    let state;
    for (let i = 0; i < 20; i++) {
      state = await tools.execute(`poll-${i}`, 'get_execution_status', { ...target, executionId });
      if ((state as { data: { status: string } }).data.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(state).toMatchObject({ ok: true, data: { status: 'succeeded', connectionId } });
    expect(await tools.execute('result', 'get_result', { ...target, executionId, setId: 0 })).toMatchObject({ ok: true, data: { rows: [[42]], connectionId, executionId, truncated: false } });
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('reports result TTL expiry without replaying the completed write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-agent-ttl-'));
  const filename = join(dir, 'target.db');
  const db = new Database(filename); db.exec('CREATE TABLE sample(value INTEGER)');
  const app = await createApp({ resultTtlMs: 10 });
  try {
    const runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
    const connectionId = (await app.inject({ method:'POST',url:'/api/v1/connections',payload:{engine:'sqlite',name:'ttl',filename} })).json().id;
    const controller = new AbortController();
    const tools = createAgentTools({ runtimeId,mode:'execute',allowedConnectionIds:[connectionId],signal:controller.signal,invoke:async(operation,input)=>{
      const route=routeForDesktopOperation(operation,input);const response=await app.inject({...route,payload:route.payload as Record<string,unknown>});return {statusCode:response.statusCode,body:response.json()};
    }});
    const target={runtimeId,connectionId};
    const proposal=await tools.execute('prepare','propose_sql',{...target,sql:'INSERT INTO sample VALUES (1); SELECT value FROM sample'});
    expect(proposal.ok).toBe(true); const planId=(proposal as {data:{planId:string}}).data.planId;
    await app.inject({method:'POST',url:`/api/v1/approvals/${planId}/decision`,payload:{decision:'approve'}});
    const started=await tools.execute('execute','execute_plan',{...target,planId});
    const executionId=(started as {data:{executionId:string}}).data.executionId;
    expect(await tools.waitForExecution(executionId,controller.signal)).toMatchObject({ok:true,data:{status:'succeeded'}});
    await new Promise(resolve=>setTimeout(resolve,25));
    expect(await tools.execute('result','get_result',{...target,executionId,setId:1})).toMatchObject({ok:false,code:'RESULT_EXPIRED'});
    expect(db.prepare('SELECT count(*) AS n FROM sample').get()).toEqual({n:1});
    expect((await app.inject(`/api/v1/executions/${executionId}`)).json().status).toBe('succeeded');
  }finally{await app.close();db.close();rmSync(dir,{recursive:true,force:true});}
});

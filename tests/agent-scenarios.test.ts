import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.js';

async function wait(app: Awaited<ReturnType<typeof createApp>>, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = (await app.inject(`/api/v1/ai/runs/${id}`)).json();
    if (state.status !== 'running') return state;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Agent did not yield');
}
const completion = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }));
it('reads two authorized SQLite targets in one run with separate approvals and result provenance', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-cross-'));
  let runtimeId = '';
  const ids: string[] = [];
  const plans: string[] = [];
  const results: unknown[] = [];
  let turn = 0;
  const app = await createApp({ ai: { apiKey: 'fixture', model: 'fixture' }, aiFetch: (async (_url, init) => {
    const messages = JSON.parse(String(init?.body)).messages;
    const last = messages.at(-1);
    const data = last.role === 'tool' ? JSON.parse(last.content).data : undefined;
    const call = (name: string, args: unknown) => completion({ role: 'assistant', content: null, tool_calls: [{ id: `call-${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    const target = (index: number) => ({ runtimeId, connectionId: ids[index] });
    switch (turn++) {
      case 0: return call('list_connections', {});
      case 1:
        expect(data.connections.map((item: { id: string }) => item.id)).toEqual(ids.slice(0, 2));
        return call('propose_sql', { ...target(0), sql: 'SELECT label FROM items' });
      case 2: plans[0] = data.planId; return call('propose_sql', { ...target(1), sql: 'SELECT label FROM items' });
      case 3: plans[1] = data.planId; return call('execute_plan', { ...target(0), planId: plans[0] });
      case 4: return call('get_result', { ...target(0), executionId: data.executionId, setId: 0 });
      case 5: results.push(data); return call('execute_plan', { ...target(1), planId: plans[1] });
      case 6: return call('get_result', { ...target(1), executionId: data.executionId, setId: 0 });
      default: results.push(data); return completion({ role: 'assistant', content: 'Both sources read.' });
    }
  }) as typeof fetch });
  try {
    runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
    for (const label of ['first', 'second', 'excluded']) {
      const filename = join(dir, `${label}.db`);
      const db = new Database(filename); db.exec('CREATE TABLE items(label TEXT)'); db.prepare('INSERT INTO items VALUES (?)').run(label); db.close();
      ids.push((await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: label, filename } })).json().id);
    }
    const body = { runtimeId, clientRequestId: randomUUID(), request: 'Compare both sources', mode: 'execute', allowedConnectionIds: ids.slice(0, 2) };
    const id = (await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: body })).json().id;
    for (const connectionId of ids.slice(0, 2)) {
      const paused = await wait(app, id);
      expect(paused).toMatchObject({ status: 'awaiting_approval', pendingApproval: { connectionId, runtimeId } });
      await app.inject({ method: 'POST', url: `/api/v1/approvals/${paused.pendingApproval.planId}/decision`, payload: { decision: 'approve' } });
      await app.inject({ method: 'POST', url: `/api/v1/ai/runs/${id}/resume` });
    }
    expect(await wait(app, id)).toMatchObject({ status: 'succeeded' });
    expect(results).toMatchObject([{ runtimeId, connectionId: ids[0], rows: [['first']] }, { runtimeId, connectionId: ids[1], rows: [['second']] }]);
    expect((await app.inject(`/api/v1/executions?connectionId=${ids[2]}`)).json()).toEqual([]);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('retains committed steps, stops after a partial failure, and never replays on resubmit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-agent-partial-'));
  const filename = join(dir, 'target.db');
  const db = new Database(filename); db.exec('CREATE TABLE items(label TEXT)'); db.close();
  let target = { runtimeId: '', connectionId: '' };
  let turn = 0;
  const app = await createApp({ ai: { apiKey: 'fixture', model: 'fixture' }, aiFetch: (async (_url, init) => {
    const messages = JSON.parse(String(init?.body)).messages;
    const last = messages.at(-1);
    const name = turn++ === 0 ? 'propose_sql' : 'execute_plan';
    if (turn > 2) throw new Error('Model must not continue after failed execution');
    const args = name === 'propose_sql' ? { ...target, sql: "INSERT INTO items VALUES ('committed'); INSERT INTO missing_table VALUES (1); INSERT INTO items VALUES ('must-not-run')" } : { ...target, planId: JSON.parse(last.content).data.planId };
    return completion({ role: 'assistant', content: null, tool_calls: [{ id: `call-${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  }) as typeof fetch });
  try {
    target.runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
    target.connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'partial', filename } })).json().id;
    const body = { runtimeId: target.runtimeId, clientRequestId: randomUUID(), request: 'Make changes', mode: 'execute', allowedConnectionIds: [target.connectionId] };
    const id = (await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: body })).json().id;
    const paused = await wait(app, id);
    await app.inject({ method: 'POST', url: `/api/v1/approvals/${paused.pendingApproval.planId}/decision`, payload: { decision: 'approve' } });
    await app.inject({ method: 'POST', url: `/api/v1/ai/runs/${id}/resume` });
    const failed = await wait(app, id);
    expect(failed.status).toBe('failed');
    expect(failed.activity.at(-1).result.data.results.map((step: { status: string }) => step.status)).toEqual(['succeeded', 'failed', 'skipped']);
    expect((await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: body })).json()).toMatchObject({ id, replayed: true });
    expect(turn).toBe(2);
    const verify = new Database(filename);
    try { expect(verify.prepare('SELECT label FROM items').all()).toEqual([{ label: 'committed' }]); } finally { verify.close(); }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('suggestion mode refuses a model execution request even for a plan it just created', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-agent-suggest-'));
  const filename = join(dir, 'target.db');
  const db = new Database(filename); db.exec('CREATE TABLE items(label TEXT)'); db.close();
  let target = { runtimeId: '', connectionId: '' };
  let turn = 0;
  const app = await createApp({ ai: { apiKey: 'fixture', model: 'fixture' }, aiFetch: (async (_url, init) => {
    const last = JSON.parse(String(init?.body)).messages.at(-1);
    const name = turn++ === 0 ? 'propose_sql' : 'execute_plan';
    const args = name === 'propose_sql' ? { ...target, sql: "INSERT INTO items VALUES ('must-not-run')" } : { ...target, planId: JSON.parse(last.content).data.planId };
    return completion({ role: 'assistant', content: null, tool_calls: [{ id: `call-${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  }) as typeof fetch });
  try {
    target.runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
    target.connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'suggest', filename } })).json().id;
    const id = (await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: { runtimeId: target.runtimeId, clientRequestId: randomUUID(), request: 'Draft only', mode: 'suggest', allowedConnectionIds: [target.connectionId] } })).json().id;
    expect(await wait(app, id)).toMatchObject({ status: 'failed' });
    expect((await app.inject(`/api/v1/executions?connectionId=${target.connectionId}`)).json()).toEqual([]);
    const verify = new Database(filename);
    try { expect(verify.prepare('SELECT * FROM items').all()).toEqual([]); } finally { verify.close(); }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('cancels only its owned execution and keeps its execution ID visible for outcome verification', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-agent-cancel-'));
  const filename = join(dir, 'target.db');
  const blocker = new Database(filename); blocker.exec('CREATE TABLE items(label TEXT); BEGIN EXCLUSIVE');
  let target = { runtimeId: '', connectionId: '' };
  let turn = 0;
  const app = await createApp({ ai: { apiKey: 'fixture', model: 'fixture' }, aiFetch: (async (_url, init) => {
    const last = JSON.parse(String(init?.body)).messages.at(-1);
    const name = turn++ === 0 ? 'propose_sql' : 'execute_plan';
    const args = name === 'propose_sql' ? { ...target, sql: "INSERT INTO items VALUES ('late')" } : { ...target, planId: JSON.parse(last.content).data.planId };
    return completion({ role: 'assistant', content: null, tool_calls: [{ id: `call-${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  }) as typeof fetch });
  try {
    target.runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
    target.connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'cancel', filename } })).json().id;
    const manualPlan = (await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId: target.connectionId, source: 'human', sql: 'SELECT * FROM items' } })).json().id;
    const manual = (await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: manualPlan } })).json().executionId;
    const id = (await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: { runtimeId: target.runtimeId, clientRequestId: randomUUID(), request: 'Insert a row', mode: 'execute', allowedConnectionIds: [target.connectionId] } })).json().id;
    const paused = await wait(app, id);
    await app.inject({ method: 'POST', url: `/api/v1/approvals/${paused.pendingApproval.planId}/decision`, payload: { decision: 'approve' } });
    await app.inject({ method: 'POST', url: `/api/v1/ai/runs/${id}/resume` });
    let owned: string | undefined;
    for (let i = 0; i < 50; i++) {
      const history = (await app.inject(`/api/v1/executions?connectionId=${target.connectionId}`)).json();
      owned = history.find((entry: { id: string }) => entry.id !== manual)?.id;
      if (owned) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(owned).toBeTruthy();
    const cancelled = (await app.inject({ method: 'POST', url: `/api/v1/ai/runs/${id}/cancel` })).json();
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.activity.some((entry: { result: { data?: { executionId?: string } } }) => entry.result.data?.executionId === owned)).toBe(true);
    expect(cancelled.error).toMatch(/unknown/);
    expect((await app.inject(`/api/v1/executions/${manual}`)).json().status).toBe('running');
    expect((await app.inject(`/api/v1/executions/${owned}`)).json().status).toBe('outcome_unknown');
    blocker.exec('ROLLBACK');
    expect(blocker.prepare('SELECT * FROM items').all()).toEqual([]);
  } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); blocker.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

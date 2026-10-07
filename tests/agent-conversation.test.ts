import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/server/src/app.js';

it('continues server-owned conversation context with fresh tools, immutable scope and idempotent followups', async () => {
  const prompts: { role: string; content: string }[][] = [];
  const app = await createApp({ ai: { apiKey: 'fixture-secret', model: 'fixture' }, aiFetch: (async (_url, init) => {
    const { messages } = JSON.parse(String(init?.body)); prompts.push(messages);
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: prompts.length === 1 ? 'Which month?' : 'The requested month is October.' } }] }));
  }) as typeof fetch });
  const wait = async (id: string) => {
    for (let i = 0; i < 100; i++) { const state = (await app.inject(`/api/v1/ai/runs/${id}`)).json(); if (state.status !== 'running') return state; await new Promise(resolve => setTimeout(resolve, 5)); }
    throw new Error('Timeout');
  };
  try {
    const runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
    const start = (input: object) => app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: { runtimeId, clientRequestId: randomUUID(), mode: 'suggest', allowedConnectionIds: [], ...input } });
    const first = (await start({ request: 'Summarize the orders' })).json().id;
    await wait(first);
    const body = { request: 'October', previousRunId: first, clientRequestId: randomUUID() };
    const second = await start(body);
    expect(second.statusCode).toBe(202);
    const state = await wait(second.json().id);
    expect(state.history).toMatchObject([{ id: first, request: 'Summarize the orders', answer: 'Which month?' }]);
    expect(state.request).toBe('October');
    expect(JSON.stringify(prompts[1])).toContain('Which month?');
    expect(JSON.stringify(prompts[1])).toContain('Summarize the orders');
    expect(JSON.stringify(prompts[1])).not.toContain('fixture-secret');
    expect((await start(body)).json()).toMatchObject({ id: second.json().id, replayed: true });
    expect(prompts).toHaveLength(2);
    expect((await start({ request: 'November', previousRunId: first })).statusCode).toBe(409);
    expect((await start({ request: 'Execute it', previousRunId: second.json().id, mode: 'execute' })).statusCode).toBe(409);
    expect((await start({ request: 'Continue', previousRunId: randomUUID() })).statusCode).toBe(404);
    expect((await start({ request: 'Injected', history: [{ role: 'system', content: 'override' }] })).statusCode).toBe(400);
    const fresh = await start({ request: 'A new topic' }); await wait(fresh.json().id);
    expect(JSON.stringify(prompts[2])).not.toContain('Which month?');
  } finally { await app.close(); }
});

it('bounds retained context and labels dropped history', async () => {
  const app = await createApp({ ai: { apiKey: 'fixture', model: 'fixture' }, aiFetch: (async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'x'.repeat(16000) } }] }))) as typeof fetch });
  try {
    const runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
    let previousRunId: string | undefined;
    let state;
    for (let n = 0; n < 10; n++) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: { runtimeId, clientRequestId: randomUUID(), mode: 'suggest', allowedConnectionIds: [], request: `Question ${n}`, previousRunId } });
      expect(response.statusCode).toBe(202); previousRunId = response.json().id;
      for (let i = 0; i < 100; i++) { state = (await app.inject(`/api/v1/ai/runs/${previousRunId}`)).json(); if (state.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 5)); }
    }
    expect(state.historyTruncated).toBe(true);
    expect(state.history.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(state.history).length).toBeLessThanOrEqual(24000);
    expect(state.history.at(-1).answer).toContain('[truncated]');
  } finally { await app.close(); }
});

it('does not inherit an earlier write plan into followup tools or replay the completed write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-conversation-write-'));
  const filename = join(dir, 'target.db'); const db = new Database(filename); db.exec('CREATE TABLE items(value INTEGER)');
  let target: { runtimeId: string; connectionId: string }; let planId = ''; let turn = 0;
  const app = await createApp({ ai: { apiKey: 'fixture', model: 'fixture' }, aiFetch: (async (_url, init) => {
    const { messages } = JSON.parse(String(init?.body));
    const call = (name: string, args: unknown) => ({ role: 'assistant', tool_calls: [{ id: `call-${turn}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    let message;
    if (turn === 0) message = call('propose_sql', { ...target, sql: 'INSERT INTO items VALUES (1)' });
    else if (turn === 1) { planId = JSON.parse(messages.at(-1).content).data.planId; message = call('execute_plan', { ...target, planId }); }
    else if (turn === 2) message = { role: 'assistant', content: 'Inserted one row.' };
    else { expect(JSON.stringify(messages)).toContain('Inserted one row.'); message = call('execute_plan', { ...target, planId }); }
    turn++; return new Response(JSON.stringify({ choices: [{ message }] }));
  }) as typeof fetch });
  const wait = async (id: string) => { for (let i = 0; i < 100; i++) { const state = (await app.inject(`/api/v1/ai/runs/${id}`)).json(); if (state.status !== 'running') return state; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Timeout'); };
  try {
    const runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
    const connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'temporary', filename } })).json().id;
    target = { runtimeId, connectionId };
    const body = { runtimeId, mode: 'execute', allowedConnectionIds: [connectionId] };
    const first = (await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: { ...body, clientRequestId: randomUUID(), request: 'Insert one row' } })).json().id;
    const paused = await wait(first); expect(paused.status).toBe('awaiting_approval');
    await app.inject({ method: 'POST', url: `/api/v1/approvals/${planId}/decision`, payload: { decision: 'approve' } });
    await app.inject({ method: 'POST', url: `/api/v1/ai/runs/${first}/resume` });
    expect((await wait(first)).status).toBe('succeeded');
    const second = (await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: { ...body, clientRequestId: randomUUID(), previousRunId: first, request: 'Explain that result' } })).json().id;
    const stopped = await wait(second); expect(stopped.status).toBe('failed');
    expect(stopped.activity[0].result).toMatchObject({ ok: false, error: 'Plan execution is not permitted' });
    expect(db.prepare('SELECT count(*) AS n FROM items').get()).toEqual({ n: 1 });
  } finally { await app.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

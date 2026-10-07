import { expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

it('saves encrypted AI settings, exposes no key, discovers models and applies settings without restarting', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-ai-settings-')); const masterKey = randomBytes(32).toString('base64');
  const sent: { url: string; authorization: string | null; body: string }[] = [];
  const aiFetch = (async (url, init) => { sent.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization'), body: String(init?.body ?? '') }); return new Response(JSON.stringify(String(url).endsWith('/models') ? { data: [{ id: 'deepseek-flash' }] } : { choices: [{ message: { role: 'assistant', content: 'ready' } }] })); }) as typeof fetch;
  let app = await createApp({ dataDir: dir, masterKey, aiFetch });
  try {
    expect((await app.inject('/api/v1/ai/settings')).statusCode).toBe(200);
    const body = { revision: 0, provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'private-fixture-key' };
    const saved = await app.inject({ method: 'PUT', url: '/api/v1/ai/settings', payload: body });
    expect(saved.statusCode).toBe(200); expect(saved.json()).toMatchObject({ revision: 1, configured: true, hasApiKey: true }); expect(saved.body).not.toContain(body.apiKey);
    const runtime = (await app.inject('/api/v1/runtime')).json(); expect(runtime.capabilities.aiConfigured).toBe(true);
    const discovered = await app.inject({ method: 'POST', url: '/api/v1/ai/models', payload: { provider: body.provider, baseUrl: body.baseUrl } });
    expect(discovered.json()).toEqual({ models: ['deepseek-flash'] });
    const run = await app.inject({ method: 'POST', url: '/api/v1/ai/runs', payload: { runtimeId: runtime.runtimeId, request: 'Hello', mode: 'suggest', allowedConnectionIds: [], clientRequestId: randomUUID() } });
    expect(run.statusCode).toBe(202);
    for (let i = 0; i < 50 && sent.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(sent[1].authorization).toBe('Bearer private-fixture-key'); expect(JSON.parse(sent[1].body).model).toBe(body.model); expect(sent[1].body).not.toContain(body.apiKey);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/ai/settings', payload: { ...body, revision: 0 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/ai/settings', payload: { ...body, revision: 1, apiKey: '', baseUrl: 'https://another.example/v1' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/ai/models', payload: { provider: 'deepseek', baseUrl: 'https://another.example/v1' } })).statusCode).toBe(400);
    await app.close(); app = await createApp({ dataDir: dir, masterKey, aiFetch });
    expect((await app.inject('/api/v1/ai/settings')).json()).toMatchObject({ configured: true, hasApiKey: true, model: body.model });
    await app.close(); expect(readFileSync(join(dir, 'metadata.db')).includes(Buffer.from(body.apiKey))).toBe(false);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('fails closed without secret storage and never returns upstream errors containing credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dbpilot-no-key-'));
  const app = await createApp({ dataDir: dir, aiFetch: (async () => { throw new Error('secret-upstream-key'); }) as typeof fetch });
  try {
    expect((await app.inject({ method: 'PUT', url: '/api/v1/ai/settings', payload: { revision: 0, provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'secret-upstream-key' } })).statusCode).toBe(503);
    const response = await app.inject({ method: 'POST', url: '/api/v1/ai/models', payload: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKey: 'secret-upstream-key' } });
    expect(response.statusCode).toBe(502); expect(response.body).not.toContain('secret-upstream-key');
    expect((await app.inject({ method: 'POST', url: '/api/v1/ai/models', payload: { provider: 'deepseek', baseUrl: 'https://name:password@api.deepseek.com', apiKey: 'x' } })).statusCode).toBe(400);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('supports compatible providers without DeepSeek-specific options and blocks redirect credential forwarding', async () => {
  const { agentCompletion } = await import('../packages/ai-core/src/deepseek.js');
  await agentCompletion({ config: { provider: 'openai-compatible', baseUrl: 'https://custom.example/v1', model: 'custom-model', apiKey: 'fixture' }, messages: [{ role: 'user', content: 'hello' }], tools: [], signal: new AbortController().signal, fetchImpl: (async (url, init) => {
    expect(String(url)).toBe('https://custom.example/v1/chat/completions'); expect(init?.redirect).toBe('error'); expect(JSON.parse(String(init?.body))).not.toHaveProperty('thinking');
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hello' } }] }));
  }) as typeof fetch });
});

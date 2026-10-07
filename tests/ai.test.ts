import { describe, expect, it, vi } from 'vitest';
import { analyzeRows, draftSql } from '../packages/ai-core/src/deepseek.js';

describe('DeepSeek SQL drafting', () => {
  it('sends schema and returns a non-executed, classified proposal', async () => {
    const mock = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(init.headers).toMatchObject({ authorization: 'Bearer test-key' });
      const body = JSON.parse(String(init.body));
      expect(body.messages[1].content).toContain('items');
      expect(body.messages[1].content).not.toContain('test-key');
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'propose_sql', arguments: JSON.stringify({ sql: 'SELECT name FROM items', explanation: 'List names' }) } }] } }] }), { status: 200 });
    });
    const result = await draftSql({ request: 'List names', schema: [{ name: 'items' }], config: { apiKey: 'test-key', model: 'test-model' }, fetchImpl: mock as unknown as typeof fetch });
    expect(result.steps).toMatchObject([{ kind: 'read', decision: 'allow' }]);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('rejects insecure remote endpoints', async () => {
    await expect(draftSql({ request: 'list', schema: [], config: { apiKey: 'key', model: 'model', baseUrl: 'http://example.com' } })).rejects.toThrow('HTTPS');
  });
  it('marks analyzed result context as partial when rows are limited', async () => {
    const mock = vi.fn(async (_url: URL, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.messages[1].content).toContain('"truncated":true');
      expect(body.messages[1].content).not.toContain('test-key');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Only the visible rows can be summarized.' } }] }), { status: 200 });
    });
    const result = await analyzeRows({ request: 'Summarize', columns: ['name'], rows: [['a']], truncated: true, config: { apiKey: 'test-key', model: 'test-model' }, fetchImpl: mock as unknown as typeof fetch });
    expect(result).toEqual({ answer: 'Only the visible rows can be summarized.', analyzedRows: 1, partial: true });
  });
});

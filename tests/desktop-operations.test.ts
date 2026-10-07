import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { operationForDesktopRequest, routeForDesktopOperation } from '../packages/runtime-client/src/desktop-operations.js';

const id = '123e4567-e89b-42d3-a456-426614174000';

describe('desktop operation allowlist', () => {
  it.each([['GET', 'policy.get'], ['PUT', 'policy.update']])('maps policy %s through named IPC', (method, operation) => {
    const body = { revision: 0, rules: [] };
    const request = operationForDesktopRequest(method, '/api/v1/command-policy', body);
    expect(request.operation).toBe(operation);
    expect(routeForDesktopOperation(request.operation, request.input)).toMatchObject({ method, url: '/api/v1/command-policy' });
    const source = readFileSync(new URL('../apps/desktop/preload.cjs', import.meta.url), 'utf8');
    let exposed: Record<string, unknown> = {};
    runInNewContext(source, { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, api: typeof exposed) => { exposed = api; } }, ipcRenderer: { invoke: async () => ({}) } }) });
    expect(exposed[operation]).toBeTypeOf('function');
  });
  it.each([['POST', '/api/v1/ai/test', 'ai.test'], ['GET', '/api/v1/ai/runs', 'ai.list'], ['POST', '/api/v1/ai/runs', 'ai.start'], ['GET', `/api/v1/ai/runs/${id}`, 'ai.get'], ['POST', `/api/v1/ai/runs/${id}/resume`, 'ai.resume'], ['POST', `/api/v1/ai/runs/${id}/cancel`, 'ai.cancel']])('maps Agent operation %s %s', (method, url, operation) => {
    const request = operationForDesktopRequest(method, url);
    expect(request.operation).toBe(operation);
    expect(routeForDesktopOperation(request.operation, request.input)).toMatchObject({ method, url });
  });
  it.each([['GET', '/api/v1/ai/settings', 'ai.settings'], ['PUT', '/api/v1/ai/settings', 'ai.configure'], ['POST', '/api/v1/ai/models', 'ai.models']])('maps AI settings %s %s', (method, url, operation) => {
    const body = { provider: 'deepseek' };
    const request = operationForDesktopRequest(method, url, body);
    expect(request.operation).toBe(operation);
    expect(routeForDesktopOperation(request.operation, request.input)).toMatchObject({ method, url });
    let exposed: Record<string, unknown> = {};
    runInNewContext(readFileSync(new URL('../apps/desktop/preload.cjs', import.meta.url), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, api: typeof exposed) => { exposed = api; } }, ipcRenderer: { invoke: async () => ({}) } }) });
    expect(exposed[operation]).toBeTypeOf('function');
  });
  it('preserves explicit database targets and exposes database discovery', () => {
    for (const url of [`/api/v1/connections/${id}/databases`, `/api/v1/connections/${id}/tables?database=main&cursor=abc`, `/api/v1/connections/${id}/schema?database=main&schema=main&table=items`, `/api/v1/connections/${id}/schema?database=${encodeURIComponent('库 & / ?')}`]) {
      const request = operationForDesktopRequest('GET', url);
      expect(routeForDesktopOperation(request.operation, request.input)).toEqual({ method: 'GET', url });
    }
    expect(() => routeForDesktopOperation('connections.schema', { id, database: '' })).toThrow();
  });
  it('maps unsaved connection test through the desktop bridge', () => {
    const body = { engine: 'sqlite', name: 'draft', filename: '/tmp/draft.db' };
    const request = operationForDesktopRequest('POST', '/api/v1/connections/test', body);
    expect(request.operation).toBe('connections.testDraft');
    expect(routeForDesktopOperation(request.operation, request.input)).toEqual({ method: 'POST', url: '/api/v1/connections/test', payload: body });
  });
  it('maps a named result page operation to one fixed API route', () => {
    const request = operationForDesktopRequest('GET', `/api/v1/executions/${id}/results/0?cursor=abc`);
    expect(request.operation).toBe('executions.resultPage');
    expect(routeForDesktopOperation(request.operation, request.input)).toEqual({ method: 'GET', url: `/api/v1/executions/${id}/results/0?cursor=abc` });
  });
  it('maps execution history with a connection identifier', () => {
    const request = operationForDesktopRequest('GET', `/api/v1/executions?connectionId=${id}`);
    expect(request.operation).toBe('executions.list');
    expect(routeForDesktopOperation(request.operation, request.input)).toEqual({ method: 'GET', url: `/api/v1/executions?connectionId=${id}` });
  });
  it('exposes execution history through the desktop preload bridge', async () => {
    let exposed: Record<string, (input: unknown) => Promise<unknown>> | undefined;
    const calls: unknown[][] = [];
    const source = readFileSync(new URL('../apps/desktop/preload.cjs', import.meta.url), 'utf8');
    runInNewContext(source, {
      require: () => ({
        contextBridge: { exposeInMainWorld: (_name: string, api: typeof exposed) => { exposed = api; } },
        ipcRenderer: { invoke: async (...args: unknown[]) => { calls.push(args); return { statusCode: 200 }; } }
      })
    });
    expect(exposed?.['executions.list']).toBeTypeOf('function');
    await exposed?.['executions.list']({ id });
    expect(calls).toEqual([['dbpilot:invoke', 'executions.list', { id }]]);
  });
  it('rejects arbitrary paths and invalid identifiers', () => {
    expect(() => operationForDesktopRequest('POST', '/api/v1/admin/shell')).toThrow();
    expect(() => routeForDesktopOperation('connections.delete', { id: '../etc/passwd' })).toThrow();
  });
});

it('exposes a write-only clipboard action through one fixed desktop channel',async()=>{
 let api:Record<string,(input:unknown)=>Promise<unknown>>={};const calls:unknown[][]=[];
 runInNewContext(readFileSync(new URL('../apps/desktop/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name:string,value:typeof api)=>{api=value;}},ipcRenderer:{invoke:async(...args:unknown[])=>{calls.push(args);}}})});
 await api.copyText('SELECT 42;');expect(calls).toEqual([['dbpilot:clipboard:write','SELECT 42;']]);expect(api.readClipboard).toBeUndefined();
});

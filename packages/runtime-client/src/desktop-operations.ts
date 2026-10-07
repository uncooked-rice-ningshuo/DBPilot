import { z } from 'zod';
import { schemaCatalogQuery, tableCatalogQuery } from '../../protocol/src/index.js';

export type DesktopOperation =
  | 'ai.test' | 'ai.settings' | 'ai.configure' | 'ai.models' | 'policy.get' | 'policy.update' | 'runtime.info' | 'connections.list' | 'connections.create' | 'connections.update' | 'connections.delete'
  | 'connections.test' | 'connections.testDraft' | 'connections.databases' | 'connections.tables' | 'connections.schema' | 'plans.prepare' | 'plans.get' | 'approvals.decide'
  | 'executions.start' | 'executions.list' | 'executions.get' | 'executions.cancel' | 'executions.resultPage'
  | 'ai.list' | 'ai.draft' | 'ai.analysis' | 'ai.start' | 'ai.get' | 'ai.resume' | 'ai.cancel';

const uuid = z.string().uuid();
const resultIndex = z.number().int().nonnegative();
type RequestRoute = { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: unknown };

export function routeForDesktopOperation(operation: DesktopOperation, input: unknown): RequestRoute {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const id = () => encodeURIComponent(uuid.parse(value.id));
  switch (operation) {
    case 'ai.test': return { method:'POST', url:'/api/v1/ai/test', payload:value.body };
    case 'ai.list': return { method: 'GET', url: '/api/v1/ai/runs' };
    case 'ai.settings': return { method: 'GET', url: '/api/v1/ai/settings' };
    case 'ai.configure': return { method: 'PUT', url: '/api/v1/ai/settings', payload: value.body };
    case 'ai.models': return { method: 'POST', url: '/api/v1/ai/models', payload: value.body };
    case 'policy.get': return { method: 'GET', url: '/api/v1/command-policy' };
    case 'policy.update': return { method: 'PUT', url: '/api/v1/command-policy', payload: value.body };
    case 'runtime.info': return { method: 'GET', url: '/api/v1/runtime' };
    case 'connections.list': return { method: 'GET', url: '/api/v1/connections' };
    case 'connections.create': return { method: 'POST', url: '/api/v1/connections', payload: value.body };
    case 'connections.update': return { method: 'PUT', url: `/api/v1/connections/${id()}`, payload: value.body };
    case 'connections.delete': return { method: 'DELETE', url: `/api/v1/connections/${id()}` };
    case 'connections.test': return { method: 'POST', url: `/api/v1/connections/${id()}/test` };
    case 'connections.testDraft': return { method: 'POST', url: '/api/v1/connections/test', payload: value.body };
    case 'connections.databases': return { method: 'GET', url: `/api/v1/connections/${id()}/databases` };
    case 'connections.tables':
    case 'connections.schema': {
      const query = (operation === 'connections.tables' ? tableCatalogQuery : schemaCatalogQuery).parse(value);
      const params = Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
      return { method: 'GET', url: `/api/v1/connections/${id()}/${operation === 'connections.tables' ? 'tables' : 'schema'}${params ? `?${params}` : ''}` };
    }
    case 'plans.prepare': return { method: 'POST', url: '/api/v1/command-plans', payload: value.body };
    case 'plans.get': return { method: 'GET', url: `/api/v1/command-plans/${id()}` };
    case 'approvals.decide': return { method: 'POST', url: `/api/v1/approvals/${id()}/decision`, payload: value.body };
    case 'executions.start': return { method: 'POST', url: '/api/v1/executions', payload: value.body };
    case 'executions.list': return { method: 'GET', url: `/api/v1/executions?connectionId=${id()}` };
    case 'executions.get': return { method: 'GET', url: `/api/v1/executions/${id()}` };
    case 'executions.cancel': return { method: 'POST', url: `/api/v1/executions/${id()}/cancel` };
    case 'executions.resultPage': {
      const index = resultIndex.parse(value.index);
      const cursor = value.cursor === undefined ? '' : `?cursor=${encodeURIComponent(z.string().max(2048).parse(value.cursor))}`;
      return { method: 'GET', url: `/api/v1/executions/${id()}/results/${index}${cursor}` };
    }
    case 'ai.draft': return { method: 'POST', url: '/api/v1/ai/drafts', payload: value.body };
    case 'ai.analysis': return { method: 'POST', url: '/api/v1/ai/analysis', payload: value.body };
    case 'ai.start': return { method: 'POST', url: '/api/v1/ai/runs', payload: value.body };
    case 'ai.get': return { method: 'GET', url: `/api/v1/ai/runs/${id()}` };
    case 'ai.resume': return { method: 'POST', url: `/api/v1/ai/runs/${id()}/resume` };
    case 'ai.cancel': return { method: 'POST', url: `/api/v1/ai/runs/${id()}/cancel` };
    default: throw new Error('Unsupported desktop operation');
  }
}

export function operationForDesktopRequest(method: string, path: string, body?: unknown): { operation: DesktopOperation; input: unknown } {
  const url = new URL(path, 'http://local.invalid');
  const pathname = url.pathname;
  const direct: Record<string, DesktopOperation> = {
    'POST /api/v1/ai/test': 'ai.test', 'GET /api/v1/ai/runs': 'ai.list', 'GET /api/v1/ai/settings': 'ai.settings', 'PUT /api/v1/ai/settings': 'ai.configure', 'POST /api/v1/ai/models': 'ai.models',
    'GET /api/v1/command-policy': 'policy.get', 'PUT /api/v1/command-policy': 'policy.update',
    'GET /api/v1/runtime': 'runtime.info', 'GET /api/v1/connections': 'connections.list',
    'POST /api/v1/connections': 'connections.create', 'POST /api/v1/connections/test': 'connections.testDraft', 'POST /api/v1/command-plans': 'plans.prepare',
    'POST /api/v1/executions': 'executions.start', 'POST /api/v1/ai/drafts': 'ai.draft',
    'POST /api/v1/ai/analysis': 'ai.analysis', 'POST /api/v1/ai/runs': 'ai.start'
  };
  const matched = direct[`${method} ${pathname}`];
  if (matched) return { operation: matched, input: { body } };
  if (method === 'GET' && pathname === '/api/v1/executions') return { operation: 'executions.list', input: { id: url.searchParams.get('connectionId') } };
  const patterns: { method: string; pattern: RegExp; operation: DesktopOperation; input: (match: RegExpMatchArray) => unknown }[] = [
    { method: 'GET', pattern: /^\/api\/v1\/ai\/runs\/([^/]+)$/, operation: 'ai.get', input: match => ({ id: match[1] }) },
    { method: 'POST', pattern: /^\/api\/v1\/ai\/runs\/([^/]+)\/resume$/, operation: 'ai.resume', input: match => ({ id: match[1] }) },
    { method: 'POST', pattern: /^\/api\/v1\/ai\/runs\/([^/]+)\/cancel$/, operation: 'ai.cancel', input: match => ({ id: match[1] }) },
    { method: 'PUT', pattern: /^\/api\/v1\/connections\/([^/]+)$/, operation: 'connections.update', input: match => ({ id: match[1], body }) },
    { method: 'DELETE', pattern: /^\/api\/v1\/connections\/([^/]+)$/, operation: 'connections.delete', input: match => ({ id: match[1] }) },
    { method: 'POST', pattern: /^\/api\/v1\/connections\/([^/]+)\/test$/, operation: 'connections.test', input: match => ({ id: match[1] }) },
    { method: 'GET', pattern: /^\/api\/v1\/connections\/([^/]+)\/databases$/, operation: 'connections.databases', input: match => ({ id: match[1] }) },
    { method: 'GET', pattern: /^\/api\/v1\/connections\/([^/]+)\/tables$/, operation: 'connections.tables', input: match => ({ id: match[1], database: url.searchParams.get('database') ?? undefined, cursor: url.searchParams.get('cursor') ?? undefined }) },
    { method: 'GET', pattern: /^\/api\/v1\/connections\/([^/]+)\/schema$/, operation: 'connections.schema', input: match => ({ id: match[1], database: url.searchParams.get('database') ?? undefined, schema: url.searchParams.get('schema') ?? undefined, table: url.searchParams.get('table') ?? undefined }) },
    { method: 'GET', pattern: /^\/api\/v1\/command-plans\/([^/]+)$/, operation: 'plans.get', input: match => ({ id: match[1] }) },
    { method: 'POST', pattern: /^\/api\/v1\/approvals\/([^/]+)\/decision$/, operation: 'approvals.decide', input: match => ({ id: match[1], body }) },
    { method: 'GET', pattern: /^\/api\/v1\/executions\/([^/]+)$/, operation: 'executions.get', input: match => ({ id: match[1] }) },
    { method: 'POST', pattern: /^\/api\/v1\/executions\/([^/]+)\/cancel$/, operation: 'executions.cancel', input: match => ({ id: match[1] }) },
    { method: 'GET', pattern: /^\/api\/v1\/executions\/([^/]+)\/results\/(\d+)$/, operation: 'executions.resultPage', input: match => ({ id: match[1], index: Number(match[2]), cursor: url.searchParams.get('cursor') ?? undefined }) }
  ];
  for (const candidate of patterns) {
    const match = pathname.match(candidate.pattern);
    if (method === candidate.method && match) return { operation: candidate.operation, input: candidate.input(match) };
  }
  throw new Error('Unsupported desktop request');
}

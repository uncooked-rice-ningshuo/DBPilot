import { toolOutputSchemas, executionStateOutput } from './tool-outputs.js';
import { z } from 'zod';
import { agentTodo, agentConnectionDraft, type AgentResultSource } from '../../protocol/src/index.js';
import { randomUUID } from 'node:crypto';
import type { DesktopOperation } from '../../runtime-client/src/desktop-operations.js';

export type ToolRuntime = (operation: DesktopOperation, input: unknown) => Promise<{ statusCode: number; body: unknown }>;
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string; code?: string };
class ToolRuntimeFailure extends Error { constructor(readonly status: number, readonly operation: DesktopOperation) { super('Runtime operation rejected'); } }
const target = { runtimeId: z.string().uuid(), connectionId: z.string().uuid() };
const resourceId = z.string().min(1).max(100);
export const commandReference = {
  ls: { example: 'ls -lah', description: '列出当前目录的文件，包括隐藏项和可读大小。' },
  pwd: { example: 'pwd', description: '显示当前工作目录。' },
  head: { example: 'head -n 20 example.log', description: '查看文件开头 20 行。' },
  tail: { example: 'tail -n 20 example.log', description: '查看文件末尾 20 行；-f 会持续跟踪。' },
  grep: { example: "grep -n 'pattern' example.log", description: '检索匹配文本并显示行号。' },
  wc: { example: 'wc -l example.log', description: '统计文件行数。' },
} as const;
export const todoSchema = agentTodo;
export type AgentTodo = z.infer<typeof todoSchema>;
const definitions = {
  get_selected_result: { description: 'Read up to 50 rows from the exact existing result snapshot explicitly selected by the user. Does not execute SQL. Snapshot expiry must be reported, never rerun the original query.', schema: z.strictObject({}) },
  request_connection: { description: 'Offer a non-secret connection draft for the user to review in the connection form. Does not connect or save. Never include passwords, keys, file paths or TLS/SSH policy. User must create a new conversation after saving to authorize the connection.', schema: agentConnectionDraft },
  update_todo: { description: 'Replace this run’s task checklist (up to 12 items, at most one in progress). Planning metadata only, never proof of SQL execution. Use for multi-step requests; mark complete only with evidence.', schema: z.strictObject({ items: z.array(todoSchema).max(12).refine(items => new Set(items.map(item => item.id)).size === items.length && items.filter(item => item.status === 'in_progress').length <= 1) }) },
  command_reference: { description: 'Return fixed Linux command help only. Does not execute a shell command or access files. Available commands: ls, pwd, head, tail, grep, wc.', schema: z.strictObject({ command: z.enum(['ls', 'pwd', 'head', 'tail', 'grep', 'wc']) }) },
  list_connections: { description: 'Discover authorized connections in this Runtime; no credentials are returned.', schema: z.strictObject({}) },
  connect_database: { description: 'Test a saved authorized connection. Does not create a persistent session.', schema: z.strictObject(target) },
  list_databases: { description: 'List accessible databases on an authorized connection before choosing a query target.', schema: z.strictObject(target) },
  search_schema: { description: 'Find table names in an authorized database using bounded catalog pages. Does not load columns. Follow nextCursor with the same target/search until exhausted, then use describe_table for selected tables. Empty matches with nextCursor do not mean no table exists.', schema: z.strictObject({ ...target, database: z.string().min(1).max(256).optional(), search: z.string().max(100).optional(), cursor: z.string().min(1).max(4096).optional() }) },
  describe_table: { description: 'Load column metadata for one exact authorized schema/table after discovering its name. Does not execute SQL supplied by the model.', schema: z.strictObject({ ...target, database: z.string().min(1).max(256).optional(), schema: z.string().min(1).max(256), table: z.string().min(1).max(256) }) },
  propose_sql: { description: 'Prepare an exact SQL plan for a fixed target. This never executes SQL.', schema: z.strictObject({ ...target, database: z.string().min(1).max(256).optional(), sql: z.string().min(1).max(20_000) }) },
  execute_plan: { description: 'Execute a plan created by this run, when current policy allows it or after trusted user approval. Otherwise return awaiting_approval.', schema: z.strictObject({ ...target, planId: resourceId }) },
  get_execution_status: { description: 'Read the status of an execution owned by this run.', schema: z.strictObject({ ...target, executionId: resourceId }) },
  get_result: { description: 'Read up to 50 rows of one execution snapshot; never reruns SQL.', schema: z.strictObject({ ...target, executionId: resourceId, setId: z.number().int().nonnegative() }) },
  cancel_query: { description: 'Request cancellation of this run’s execution. Writes may have an unknown outcome.', schema: z.strictObject({ ...target, executionId: resourceId }) },
};
export function createAgentTools(options: {
  resultSource?: AgentResultSource;
  runtimeId: string; mode: 'suggest' | 'execute'; allowedConnectionIds: string[];
  invoke: ToolRuntime; signal: AbortSignal; maxCalls?: number;
  beforeTool?: (name: string, args: unknown, context: { toolCallId: string; stepId: number }) => void;
}) {
  const allowed = new Set(options.allowedConnectionIds);
  const plans = new Map<string, string>();
  const executions = new Map<string, string>();
  const cache = new Map<string, { fingerprint: string; result: Promise<ToolResult> }>();
  let todos: AgentTodo[] = [];
  let calls = 0;
  let executionFailed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const request = async (operation: DesktopOperation, input: unknown) => {
    const response = await options.invoke(operation, input);
    if (response.statusCode >= 400) throw new ToolRuntimeFailure(response.statusCode, operation);
    return response.body as Record<string, unknown>;
  };
  const invoke = async (name: keyof typeof definitions, input: unknown, toolCallId: string): Promise<ToolResult> => {
    try {
      if (options.signal.aborted) return { ok: false, error: 'Run cancelled' };
      if (++calls > (options.maxCalls ?? 32)) return { ok: false, error: 'Tool call budget exceeded' };
      const parsed = definitions[name].schema.safeParse(input);
      if (!parsed.success) return { ok: false, error: 'Invalid tool arguments' };
      const args = parsed.data as { runtimeId?: string; connectionId?: string; database?: string; sql?: string; search?: string; planId?: string; executionId?: string; setId?: number; cursor?: string; schema?: string; table?: string; items?: AgentTodo[]; command?: keyof typeof commandReference };
      if (!['list_connections', 'update_todo', 'command_reference', 'request_connection', 'get_selected_result'].includes(name) && (args.runtimeId !== options.runtimeId || !allowed.has(args.connectionId!))) return { ok: false, error: 'Target is not authorized for this run' };
      if (name === 'execute_plan' && (options.mode !== 'execute' || executionFailed || plans.get(args.planId!) !== args.connectionId)) return { ok: false, error: 'Plan execution is not permitted' };
      if (['get_execution_status', 'get_result', 'cancel_query'].includes(name) && executions.get(args.executionId!) !== args.connectionId) return { ok: false, error: 'Execution is not owned by this run' };
      if (name === 'get_selected_result' && (!options.resultSource || !allowed.has(options.resultSource.connectionId))) return { ok:false, error:'No authorized user-selected result' };
      options.beforeTool?.(name, parsed.data, { toolCallId, stepId: calls });
      let data: unknown;
      switch (name) {
        case 'get_selected_result': {
          const selected = options.resultSource!;
          const result = await request('executions.resultPage', { id: selected.executionId, index: selected.setId });
          const rows = (result.rows as unknown[][]).slice(0, 50);
          data = { runtimeId: options.runtimeId, ...selected, selectedByUser: true, columns: result.columns, rows, truncated: !!result.truncated || !!result.nextCursor || (result.rows as unknown[]).length > rows.length };
          break;
        }
        case 'request_connection':
          data = { draft: parsed.data, created: false, requiresUserInput: true };
          break;
        case 'update_todo':
          todos = structuredClone(args.items!);
          data = { items: todos, planningOnly: true };
          break;
        case 'command_reference':
          data = { command: args.command, ...commandReference[args.command!], executed: false, referenceOnly: true };
          break;
        case 'list_connections': {
          const response = await options.invoke('connections.list', {});
          if (response.statusCode >= 400 || !Array.isArray(response.body)) throw new Error();
          data = { runtimeId: options.runtimeId, connections: response.body.filter(item => allowed.has(item.id)).map(({ id, name, engine, version, database }) => ({ id, name, engine, version, database })) };
          break;
        }
        case 'connect_database':
          await request('connections.test', { id: args.connectionId });
          data = { runtimeId: options.runtimeId, connectionId: args.connectionId, connected: true, persistentSession: false };
          break;
        case 'list_databases':
          data = { runtimeId: options.runtimeId, ...await request('connections.databases', { id: args.connectionId }) };
          break;
        case 'search_schema': {
          let cursor = args.cursor, database: unknown, scanned = 0;
          let matches: {schema:string;name:string;columns:unknown[]}[] = [];
          for (let page = 0; page < 5; page++) {
            options.signal.throwIfAborted();
            const catalog = await request('connections.tables', { id: args.connectionId, database: args.database, cursor });
            database = catalog.database;
            const tables = catalog.tables as {schema:string;name:string;columns:unknown[]}[];
            scanned += tables.length;
            matches = tables.filter(table => !args.search || table.name.toLowerCase().includes(args.search.toLowerCase()));
            cursor = catalog.nextCursor as string | undefined;
            if (matches.length || !cursor) break;
          }
          data = { runtimeId: options.runtimeId, connectionId: args.connectionId, database, tables: matches, nextCursor: cursor, scanned, truncated: !!cursor };
          break;
        }
        case 'describe_table': {
          const schema = await request('connections.schema', { id: args.connectionId, database: args.database, schema: args.schema, table: args.table });
          data = { runtimeId: options.runtimeId, connectionId: args.connectionId, database: schema.database, tables: schema.tables, truncated: !!schema.truncated };
          break;
        }
        case 'propose_sql': {
          const plan = await request('plans.prepare', { body: { connectionId: args.connectionId, database: args.database, sql: args.sql, source: 'ai', clientRequestId: randomUUID() } });
          plans.set(plan.id as string, args.connectionId!);
          data = { runtimeId: options.runtimeId, connectionId: args.connectionId, database: plan.database, planId: plan.id, steps: plan.steps, status: 'prepared', requiresUserApproval: plan.approvalRequired !== false };
          break;
        }
        case 'execute_plan': {
          for (const id of executions.keys()) {
            const state = executionStateOutput.parse(await request('executions.get', { id }));
            if (state.status !== 'succeeded') {
              if (state.status !== 'running') executionFailed = true;
              return { ok: false, error: state.status === 'running' ? 'Wait for the current execution before starting another plan' : 'A previous execution did not succeed; dependent work stopped' };
            }
          }
          const plan = await request('plans.get', { id: args.planId });
          if (plan.connectionId !== args.connectionId) throw new Error();
          if (!plan.approved && plan.approvalRequired !== false) {
            data = { runtimeId: options.runtimeId, connectionId: args.connectionId, database: plan.database, planId: args.planId, steps: plan.steps, status: 'awaiting_approval' };
            break;
          }
          const started = await request('executions.start', { body: { planId: args.planId } });
          executions.set(started.executionId as string, args.connectionId!);
          data = { ...started, runtimeId: options.runtimeId, connectionId: args.connectionId };
          break;
        }
        case 'get_execution_status': {
          const state = executionStateOutput.parse(await request('executions.get', { id: args.executionId }));
          if (['failed', 'cancelled', 'outcome_unknown'].includes(state.status as string)) executionFailed = true;
          data = { ...state, runtimeId: options.runtimeId, connectionId: args.connectionId };
          break;
        }
        case 'get_result': {
          const result = await request('executions.resultPage', { id: args.executionId, index: args.setId });
          const rows = (result.rows as unknown[][]).slice(0, 50);
          data = { runtimeId: options.runtimeId, connectionId: args.connectionId, executionId: args.executionId, setId: args.setId, columns: result.columns, rows, truncated: !!result.truncated || !!result.nextCursor || (result.rows as unknown[]).length > rows.length };
          break;
        }
        case 'cancel_query':
          data = await request('executions.cancel', { id: args.executionId });
          executionFailed = true;
          break;
      }
      data = toolOutputSchemas[name].parse(data);
      if (JSON.stringify(data).length > 20_000) return { ok: false, error: 'Tool result exceeds context budget; narrow the request' };
      return { ok: true, data };
    } catch (error) {
      if (error instanceof ToolRuntimeFailure && error.operation === 'executions.resultPage' && error.status === 410) return { ok:false, code:'RESULT_EXPIRED', error:'Result snapshot expired or was evicted. Execution history remains available. Do not rerun SQL or replay writes to recover the result.' };
      if (error instanceof ToolRuntimeFailure && error.operation === 'plans.get' && [404,410].includes(error.status)) return { ok:false, code:'PLAN_EXPIRED', error:'Plan expired or is unavailable. No execution was started by this call; a new user request and fresh plan are required.' };
      return { ok: false, error: 'Tool operation failed or was rejected; do not assume it had no effect' };
    }
  };
  return {
    todos: () => structuredClone(todos),
    definitions: Object.entries(definitions).filter(([name]) => name !== 'get_selected_result' || !!options.resultSource).map(([name, value]) => ({ type: 'function' as const, function: { name, description: value.description, parameters: z.toJSONSchema(value.schema) } })),
    execute(callId: string, name: string, args: unknown): Promise<ToolResult> {
      if (!Object.hasOwn(definitions, name)) return Promise.resolve({ ok: false, error: 'Unregistered tool' });
      const fingerprint = JSON.stringify({ name, args });
      const previous = cache.get(callId);
      if (previous) return previous.fingerprint === fingerprint ? previous.result : Promise.resolve({ ok: false, error: 'Tool call ID reused with different arguments' });
      const result = queue.then(() => invoke(name as keyof typeof definitions, args, callId));
      queue = result;
      cache.set(callId, { fingerprint, result });
      return result;
    },
    async cancelOwnedExecutions() {
      await queue;
      await Promise.allSettled([...executions.keys()].map(id => options.invoke('executions.cancel', { id })));
      return Promise.all([...executions].map(async ([id, connectionId]): Promise<ToolResult> => {
        let state: Record<string, unknown>;
        try {
          const deadline = Date.now() + 35_000;
          do {
            state = executionStateOutput.parse(await request('executions.get', { id }));
            if (state.status !== 'running') break;
            await new Promise(resolve => setTimeout(resolve, 100));
          } while (Date.now() < deadline);
          if (state.status === 'running') state = { ...state, status: 'outcome_unknown', cancellationUnconfirmed: true };
        } catch { state = { status: 'outcome_unknown', cancellationUnconfirmed: true }; }
        return { ok: true, data: { ...state, executionId: id, runtimeId: options.runtimeId, connectionId, cancellationRequested: true } };
      }));
    },
    async waitForExecution(id: string, signal: AbortSignal): Promise<ToolResult> {
      const connectionId = executions.get(id);
      if (!connectionId) return { ok: false, error: 'Execution is not owned by this run' };
      while (!signal.aborted) {
        const state = executionStateOutput.parse(await request('executions.get', { id }));
        if (state.status !== 'running') {
          if (state.status !== 'succeeded') executionFailed = true;
          return { ok: true, data: { ...state, executionId: id, runtimeId: options.runtimeId, connectionId } };
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const state = executionStateOutput.parse(await request('executions.get', { id }));
      return { ok: true, data: { ...state, executionId: id, runtimeId: options.runtimeId, connectionId, cancellationRequested: true } };
    },
  };
}

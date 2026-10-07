import { RuntimeLease } from '../../../packages/storage/src/runtime-lease.js';
import { withSshTunnel } from './ssh-tunnel.js';
import { postgresTls, mysqlTlsOptions } from './tls-options.js';
import { PLAN_TTL_MS, AGENT_TIME_BUDGET_MS, DEFAULT_RESULT_TTL_MS } from '../../../packages/core/src/budgets.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { startSqliteWorker } from './sqlite-process.js';
import Database from '../../../packages/storage/src/native-database.mjs';
import { Client as PgClient, Query as PgQuery, type QueryArrayConfig } from 'pg';
import mysql from 'mysql2/promise';
import mysqlRaw from 'mysql2';
import { connectionInput, databaseName, tableCatalogQuery, tableCatalogCursor, schemaCatalogQuery, prepareInput, agentRunInput, policyUpdateInput, aiSettingsInput, aiModelsInput, aiTestInput, type ConnectionInput } from '../../../packages/protocol/src/index.js';
import { commandRules, evaluateSqlPolicy, type CommandRule } from '../../../packages/core/src/command-policy.js';
import { ExecutionEvents, type ExecutionEvent } from '../../../packages/core/src/events.js';
import { boundedRows, ResultAccumulator, RESULT_ROW_LIMIT, RESULT_BYTE_LIMIT } from '../../../packages/core/src/results.js';
import { ConnectionStore, type SavedConnection } from '../../../packages/storage/src/connections.js';
import { ExecutionJournal } from '../../../packages/storage/src/executions.js';
import { PlanStore, type StoredPlan } from '../../../packages/storage/src/plans.js';
import { AuditStore, hashSql } from '../../../packages/storage/src/audit.js';
import { AiSettingsStore } from '../../../packages/storage/src/ai-settings.js';
import { PolicyStore } from '../../../packages/storage/src/policy.js';
import { runtimeIdentity } from '../../../packages/storage/src/runtime-identity.js';
import { analyzeRows, draftSql, agentCompletion, listAiModels, probeAgentModel, type DeepSeekConfig } from '../../../packages/ai-core/src/deepseek.js';
import { ModelFailure } from '../../../packages/ai-core/src/model-errors.js';
import { AgentRunStore } from '../../../packages/storage/src/agent-runs.js';
import { AgentRun, conversationContext } from '../../../packages/ai-core/src/agent.js';
import { createAgentTools } from '../../../packages/ai-core/src/tools.js';
import { routeForDesktopOperation } from '../../../packages/runtime-client/src/desktop-operations.js';
import { connectionFailure } from './connection-errors.js';
import { isUncertainDatabaseFailure, UnknownWriteOutcome } from './query-failures.js';
import { createPostgresClient, createMysqlClient, createMysqlStreamingClient, mysqlValueOptions } from './driver-values.js';

import { listTablePage, CATALOG_PAGE_SIZE } from './catalog.js';

type Profile = SavedConnection;
type Plan = StoredPlan;

function matchesCurrentPolicy(plan: Plan, engine: ConnectionInput['engine'], rules: CommandRule[], policyHash: string | undefined): boolean {
  try {
    if (plan.policyHash !== policyHash) return false;
    const current = evaluateSqlPolicy(plan.steps.map(step => step.sql).join('\n;\n'), { engine, connectionId: plan.connectionId, source: plan.source }, rules);
    return current.length === plan.steps.length && current.every((step, index) =>
      step.decision !== 'deny' && step.kind === plan.steps[index].kind && step.decision === plan.steps[index].decision);
  } catch { return false; }
}
type StepResult = { status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled' | 'outcome_unknown'; columns?: string[]; rows?: unknown[][]; affectedRows?: number; truncated?: boolean; rolledBack?: boolean; error?: string };
type ExecutionState = { id: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown'; results: StepResult[]; finishedAt?: number };
class QueryInterrupted extends Error { constructor(readonly outcomeUnknown: boolean, timedOut = false) { super(timedOut ? (outcomeUnknown ? 'Query time budget exceeded; outcome is unknown' : 'Query time budget exceeded; query cancelled') : outcomeUnknown ? 'Query outcome is unknown' : 'Query cancelled'); } }
type SchemaTable = { schema: string; name: string; columns: { name: string; type: string; nullable: boolean }[] };
async function withMysqlConnectionErrors<T>(client: mysqlRaw.Connection, operation: () => Promise<T>): Promise<T> {
  let onError!: (error: Error) => void;
  const disconnected = new Promise<T>((_resolve, reject) => { onError = reject; client.once('error', onError); });
  try { return await Promise.race([operation(), disconnected]); }
  finally { client.removeListener('error', onError); }
}
export async function createApp(options: { commandRules?: CommandRule[]; dataDir?: string; masterKey?: string; logger?: boolean; webRoot?: string; ai?: DeepSeekConfig; aiFetch?: typeof fetch; allowedHosts?: string[]; allowedOrigins?: string[]; resultTtlMs?: number; resultCacheBytes?: number; queryTimeoutMs?: number; maxConcurrentExecutions?: number; runtimeMode?: 'desktop-local' | 'web-server' } = {}) {
commandRules.parse(options.commandRules ?? []);
const maxConcurrentExecutions = options.maxConcurrentExecutions ?? 4;
if (!Number.isSafeInteger(maxConcurrentExecutions) || maxConcurrentExecutions < 1 || maxConcurrentExecutions > 32) throw new Error('Invalid execution concurrency limit (1-32)');
const queryTimeoutMs = options.queryTimeoutMs ?? 30_000;
if (!Number.isSafeInteger(queryTimeoutMs) || queryTimeoutMs < 1 || queryTimeoutMs > 30_000) throw new Error('Invalid query time budget (1-30000 ms)');
const resultTtlMs = options.resultTtlMs ?? DEFAULT_RESULT_TTL_MS;
if (!Number.isSafeInteger(resultTtlMs) || resultTtlMs < 1 || resultTtlMs > 24 * 60 * 60_000) throw new Error('Invalid result TTL (1-86400000 ms)');
const lease = new RuntimeLease(options.dataDir);
const resourceClosers: (() => void)[] = [];
let resultSweep: ReturnType<typeof setInterval> | undefined;
const manage = <T extends { close(): void }>(resource: T): T => { resourceClosers.push(() => resource.close()); return resource; };
const closeResources = () => {
  clearInterval(resultSweep);
  const failures: unknown[] = [];
  for (const close of resourceClosers.splice(0).reverse()) { try { close(); } catch (error) { failures.push(error); } }
  try { lease.close(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, 'Runtime resource cleanup failed');
};
try {
const runtimeId = runtimeIdentity(options.dataDir);
const connections = manage(new ConnectionStore(options.dataDir, options.masterKey));
const aiSettings = manage(new AiSettingsStore(options.dataDir, options.masterKey, options.ai));
try { connections.list(); aiSettings.validateSecrets(); }
catch { throw new Error('Secret store could not be unlocked; use the original workspace master key.'); }
const journal = manage(new ExecutionJournal(options.dataDir));
const plans = manage(new PlanStore(options.dataDir));
const audit = manage(new AuditStore(options.dataDir));
const policy = manage(new PolicyStore(options.dataDir, options.commandRules));
const executions = new Map<string, ExecutionState>();
const controllers = new Map<string, AbortController>();
const activeTasks = new Set<Promise<void>>();
const agentRuns = new Map<string, AgentRun>();
const agentStore = manage(new AgentRunStore(options.dataDir));
const events = new ExecutionEvents();
const resultCacheBytes = options.resultCacheBytes ?? 200 * 1024 * 1024;
if (!Number.isSafeInteger(resultCacheBytes) || resultCacheBytes < 1) throw new Error('Invalid result cache budget');
function currentExecution(id: string): ExecutionState | undefined {
  const execution = executions.get(id);
  if (execution?.finishedAt && Date.now() - execution.finishedAt > resultTtlMs) { executions.delete(id); events.delete(id); return undefined; }
  return execution;
}
function pruneResultCache() {
  const snapshots: { step: StepResult; bytes: number }[] = [];
  let total = 0;
  for (const execution of executions.values()) {
    for (const step of execution.results) {
      if (!step.rows || !step.columns) continue;
      const bytes = Buffer.byteLength(JSON.stringify(step.columns)) + step.rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)), 0);
      snapshots.push({ step, bytes });
      total += bytes;
    }
  }
  for (const snapshot of snapshots) {
    if (total <= resultCacheBytes) break;
    snapshot.step.rows = undefined;
    total -= snapshot.bytes;
  }
}
resultSweep = setInterval(() => { for (const id of executions.keys()) currentExecution(id); plans.pruneExpiredUnconsumed(Date.now() - PLAN_TTL_MS); }, 60_000);
resultSweep.unref();
const app = Fastify({ logger: options.logger ?? false, bodyLimit: 1024 * 1024 });
const allowedHosts = new Set(options.allowedHosts ?? ['localhost', '127.0.0.1']);
const allowedOrigins = new Set(options.allowedOrigins ?? []);
app.addHook('onRequest', async (request, reply) => {
  let hostname = '';
  try { hostname = new URL(`http://${request.headers.host}`).hostname; } catch { /* Invalid Host */ }
  if (!allowedHosts.has(hostname)) return reply.code(403).send({ error: 'Invalid Host header' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return reply.code(403).send({ error: 'Cross-origin request denied' });
    const origin = request.headers.origin;
    if (origin) {
      const scheme = request.protocol;
      let expectedOrigin = '';
      try { expectedOrigin = new URL(`${scheme}://${request.headers.host}`).origin; } catch { /* Invalid Host */ }
      if (origin !== expectedOrigin && !allowedOrigins.has(origin)) return reply.code(403).send({ error: 'Invalid Origin header' });
    }
  }
});
await app.register(cors, { origin: false });
if (options.webRoot) {
  if (!existsSync(options.webRoot)) throw new Error(`Web build not found: ${options.webRoot}`);
  await app.register(fastifyStatic, { root: options.webRoot, prefix: '/' });
}
app.addHook('preClose', async () => {
  await Promise.allSettled([...agentRuns.values()].map(run => run.cancel('Runtime shutting down; completed steps are retained')));
  for (const controller of controllers.values()) controller.abort('runtime-shutdown');
  await Promise.allSettled([...activeTasks]);
});
app.addHook('onClose', async () => closeResources());

function publicProfile(profile: Profile) {
  const { password: _password, ...safe } = profile.engine === 'sqlite' ? { ...profile, password: undefined } : profile;
  if (safe.engine !== 'sqlite' && safe.ssh) { const { password: _sshPassword, ...ssh } = safe.ssh; return { ...safe, ssh: { ...ssh, hasPassword: !!_sshPassword } }; }
  return safe;
}
function fail(reply: { code: (n: number) => { send: (v: unknown) => unknown } }, status: number, message: string, code?: string) {
  return reply.code(status).send({ error: message, ...(code ? { code } : {}) });
}
async function probeConnection(profile: ConnectionInput): Promise<void> { return withSshTunnel(profile, effective => probeConnectionDirect(effective)); }
async function probeConnectionDirect(profile: ConnectionInput): Promise<void> {
  if (profile.engine === 'sqlite') {
    const db = new Database(profile.filename, { readonly: true, fileMustExist: true });
    db.close();
  } else if (profile.engine === 'postgres') {
    const client = createPostgresClient({ host: profile.host, port: profile.port, database: profile.database || 'postgres', user: profile.user, password: profile.password, ssl: postgresTls(profile), connectionTimeoutMillis: 5000 });
    try { await client.connect(); } finally { await client.end().catch(() => {}); }
  } else {
    const client = await createMysqlClient({ ...mysqlValueOptions, host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ...mysqlTlsOptions(profile), connectTimeout: 5000 });
    await client.end();
  }
}
async function run(profile: Profile, sql: string, signal: AbortSignal, mayWrite: boolean): Promise<StepResult> { return withSshTunnel(profile, effective => runDirect(effective, sql, signal, mayWrite), signal); }
async function runDirect(profile: Profile, sql: string, signal: AbortSignal, mayWrite: boolean): Promise<StepResult> {
  if (profile.engine === 'sqlite') {
    return new Promise<StepResult>((resolve, reject) => {
      const worker = startSqliteWorker({ filename: profile.filename, sql });
      let settled = false;
      const interrupt = () => { if (!settled) { cleanup(); worker.once('exit', () => reject(new QueryInterrupted(mayWrite, signal.reason === 'query-timeout'))); worker.kill('SIGKILL'); } };
      const timer = setTimeout(interrupt, 30_000);
      signal.addEventListener('abort', interrupt, { once: true });
      const cleanup = () => { settled = true; clearTimeout(timer); signal.removeEventListener('abort', interrupt); };
      worker.once('message', (result: StepResult) => { if (!settled) { cleanup(); if (result.status === 'failed') reject(new Error(result.error)); else resolve(result); } });
      worker.once('error', error => { if (!settled) { cleanup(); reject(mayWrite ? new UnknownWriteOutcome() : error); } });
      worker.once('exit', code => { if (!settled) { cleanup(); reject(mayWrite ? new UnknownWriteOutcome() : new Error(`SQLite worker exited: ${code}`)); } });
      if (signal.aborted) interrupt();
    });
  }
  if (profile.engine === 'postgres') {
    const config = { host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ssl: postgresTls(profile), connectionTimeoutMillis: 5000, query_timeout: mayWrite ? 30000 : 0 };
    const client = createPostgresClient(config);
    if (signal.aborted) throw new QueryInterrupted(mayWrite, signal.reason === 'query-timeout');
    await client.connect();
    let cancelPromise: Promise<void> | undefined;
    const interrupt = () => {
      if (cancelPromise) return;
      const backendId = (client as PgClient & { processID?: number }).processID;
      cancelPromise = (async () => {
        if (!backendId) { await client.end(); return; }
        const canceller = createPostgresClient(config);
        try {
          await canceller.connect();
          await canceller.query('SELECT pg_cancel_backend($1)', [backendId]);
        } catch { await client.end().catch(() => {}); }
        finally { await canceller.end().catch(() => {}); }
      })();
    };
    signal.addEventListener('abort', interrupt, { once: true });
    const readTimeout = mayWrite ? undefined : setTimeout(interrupt, 30_000);
    try {
      if (signal.aborted) throw new QueryInterrupted(mayWrite, signal.reason === 'query-timeout');
      if (!mayWrite) {
        const collector = new ResultAccumulator(serialize);
        const result = await new Promise<StepResult>((resolve, reject) => {
          let columns: string[] = [];
          const query = new PgQuery({ text: sql, rowMode: 'array' } as QueryArrayConfig);
          query.on('row', (row, result) => {
            if (result) columns = result.fields.map((field: { name: string }) => field.name);
            collector.push(row as unknown[]);
            if (collector.truncated) interrupt();
          });
          query.on('error', error => {
            if (collector.truncated && !signal.aborted && (error as { code?: string }).code === '57014') resolve({ status: 'succeeded', columns, rows: collector.rows, truncated: true });
            else reject(error);
          });
          query.on('end', result => resolve({ status: 'succeeded', columns: result.fields.map(field => field.name), rows: collector.rows, affectedRows: result.rowCount ?? undefined, truncated: collector.truncated }));
          client.query(query);
        });
        if (signal.aborted) throw new QueryInterrupted(false, signal.reason === 'query-timeout');
        return result;
      }
      const result = await client.query({ text: sql, rowMode: 'array' });
      if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
      const bounded = boundedRows(result.rows as unknown[][], serialize);
      return { status: 'succeeded', columns: result.fields.map(f => f.name), rows: bounded.rows, affectedRows: result.rowCount ?? undefined, truncated: bounded.truncated };
    } catch (error) { if (signal.aborted) throw new QueryInterrupted(mayWrite, signal.reason === 'query-timeout'); if (mayWrite && isUncertainDatabaseFailure(error)) throw new UnknownWriteOutcome(); throw error; }
    finally { if (readTimeout) clearTimeout(readTimeout); signal.removeEventListener('abort', interrupt); if (cancelPromise) await cancelPromise; await client.end().catch(() => {}); }
  }
  if (!mayWrite) {
    const client = createMysqlStreamingClient({ ...mysqlValueOptions, host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ...mysqlTlsOptions(profile), multipleStatements: false, connectTimeout: 5000 });
    let cancelPromise: Promise<void> | undefined;
    const interrupt = () => { if (cancelPromise) return; cancelPromise = cancelMysqlQuery(profile, client.threadId).catch(() => { client.destroy(); }); };
    signal.addEventListener('abort', interrupt, { once: true });
    try {
      if (signal.aborted) throw new QueryInterrupted(false, signal.reason === 'query-timeout');
      const collector = new ResultAccumulator(serialize);
      const result = await withMysqlConnectionErrors(client, () => new Promise<StepResult>((resolve, reject) => {
        let columns: string[] = [];
        const stream = client.query({ sql, rowsAsArray: true }).stream();
        stream.on('fields', (fields: { name: string }[]) => { columns = fields.map(field => field.name); });
        stream.on('data', (row: unknown[]) => { collector.push(row); if (collector.truncated) interrupt(); });
        stream.once('error', error => {
          if (collector.truncated && !signal.aborted && (error as { code?: string }).code === 'ER_QUERY_INTERRUPTED') resolve({ status: 'succeeded', columns, rows: collector.rows, truncated: true });
          else reject(error);
        });
        stream.once('end', () => resolve({ status: 'succeeded', columns, rows: collector.rows, truncated: collector.truncated }));
      }));
      if (signal.aborted) throw new QueryInterrupted(false, signal.reason === 'query-timeout');
      return result;
    } catch (error) { if (signal.aborted) throw new QueryInterrupted(false, signal.reason === 'query-timeout'); throw error; }
    finally { signal.removeEventListener('abort', interrupt); if (cancelPromise) await cancelPromise; client.destroy(); }
  }
  if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
  const client = await createMysqlClient({ ...mysqlValueOptions, host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ...mysqlTlsOptions(profile), multipleStatements: false, connectTimeout: 5000 });
  let cancelPromise: Promise<void> | undefined;
  const interrupt = () => { if (cancelPromise) return; cancelPromise = cancelMysqlQuery(profile, client.threadId).catch(() => { client.destroy(); }); };
  signal.addEventListener('abort', interrupt, { once: true });
  try {
    if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
    // The shared plan budget owns cancellation. Driver timers can survive a
    // fatal socket error and keep an otherwise closed Runtime alive.
    const [rows, fields] = await client.query({ sql });
    if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
    if (Array.isArray(rows)) {
      const columns = fields?.map(f => f.name) ?? [];
      const bounded = boundedRows(rows.map(row => Object.values(row as object)), serialize);
      return { status: 'succeeded', columns, rows: bounded.rows, truncated: bounded.truncated };
    }
    return { status: 'succeeded', affectedRows: (rows as mysql.ResultSetHeader).affectedRows };
  } catch (error) { if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout'); if (isUncertainDatabaseFailure(error)) throw new UnknownWriteOutcome(); throw error; }
  finally { signal.removeEventListener('abort', interrupt); if (cancelPromise) await cancelPromise; if (!signal.aborted) await client.end(); else client.destroy(); }
}
async function cancelMysqlQuery(profile: Profile & { engine: 'mysql' }, threadId: number): Promise<void> {
  if (!Number.isSafeInteger(threadId) || threadId < 1) throw new Error('MySQL connection ID is unavailable');
  const canceller = await createMysqlClient({ ...mysqlValueOptions, host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ...mysqlTlsOptions(profile), connectTimeout: 5000 });
  try { await canceller.query(`KILL QUERY ${threadId}`); }
  finally { await canceller.end(); }
}
async function runSqliteTransaction(profile: Profile & { engine: 'sqlite' }, steps: Plan['steps'], signal: AbortSignal, onStep: (index: number, result: StepResult) => void): Promise<{ status: 'succeeded' | 'failed'; index?: number; rolledBack?: boolean }> {
  return new Promise((resolve, reject) => {
    const worker = startSqliteWorker({ filename: profile.filename, steps: steps.map(step => step.sql) });
    let settled = false;
    const cleanup = () => { settled = true; clearTimeout(timer); signal.removeEventListener('abort', interrupt); };
    const interrupt = () => { if (!settled) { cleanup(); worker.once('exit', () => reject(new QueryInterrupted(true, signal.reason === 'query-timeout'))); worker.kill('SIGKILL'); } };
    const timer = setTimeout(interrupt, 30_000);
    signal.addEventListener('abort', interrupt, { once: true });
    worker.on('message', (message: { type: 'step'; index: number; result: StepResult } | { type: 'finish'; status: 'succeeded' | 'failed'; index?: number; rolledBack?: boolean }) => {
      if (settled) return;
      if (message.type === 'step') onStep(message.index, message.result);
      else { cleanup(); resolve(message); }
    });
    worker.once('error', error => { if (!settled) { cleanup(); reject(new UnknownWriteOutcome()); } });
    worker.once('exit', code => { if (!settled) { cleanup(); reject(new UnknownWriteOutcome()); } });
    if (signal.aborted) interrupt();
  });
}
async function runPostgresTransaction(profile: Profile & { engine: 'postgres' }, steps: Plan['steps'], signal: AbortSignal, onStep: (index: number, result: StepResult) => void): Promise<{ status: 'succeeded' | 'failed' | 'outcome_unknown'; index?: number; rolledBack?: boolean }> { return withSshTunnel(profile, effective => runPostgresTransactionDirect(effective, steps, signal, onStep), signal); }
async function runPostgresTransactionDirect(profile: Profile & { engine: 'postgres' }, steps: Plan['steps'], signal: AbortSignal, onStep: (index: number, result: StepResult) => void): Promise<{ status: 'succeeded' | 'failed' | 'outcome_unknown'; index?: number; rolledBack?: boolean }> {
  const config = { host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ssl: postgresTls(profile), connectionTimeoutMillis: 5000, query_timeout: 0 };
  const client = createPostgresClient(config);
  if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
  await client.connect();
  let cancelPromise: Promise<void> | undefined;
  const interrupt = () => {
    if (cancelPromise) return;
    const backendId = (client as PgClient & { processID?: number }).processID;
    cancelPromise = (async () => {
      if (!backendId) { await client.end(); return; }
      const canceller = createPostgresClient(config);
      try { await canceller.connect(); await canceller.query('SELECT pg_cancel_backend($1)', [backendId]); }
      catch { await client.end().catch(() => {}); }
      finally { await canceller.end().catch(() => {}); }
    })();
  };
  signal.addEventListener('abort', interrupt, { once: true });
  const timeout = setTimeout(interrupt, 30_000);
  let inTransaction = false;
  try {
    for (const [index, step] of steps.entries()) {
      if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
      onStep(index, { status: 'running' });
      try {
        let result: StepResult;
        if (step.kind === 'read') {
          const collector = new ResultAccumulator(serialize);
          result = await new Promise<StepResult>((resolve, reject) => {
            const query = new PgQuery({ text: step.sql, rowMode: 'array' } as QueryArrayConfig);
            query.on('row', row => collector.push(row as unknown[]));
            query.on('error', reject);
            query.on('end', completed => resolve({ status: 'succeeded', columns: completed.fields.map(field => field.name), rows: collector.rows, truncated: collector.truncated }));
            client.query(query);
          });
        } else {
          const completed = await client.query({ text: step.sql, rowMode: 'array' });
          const bounded = boundedRows(completed.rows as unknown[][], serialize);
          result = { status: 'succeeded', columns: completed.fields.length ? completed.fields.map(field => field.name) : undefined, rows: completed.fields.length ? bounded.rows : undefined, affectedRows: completed.rowCount ?? undefined, truncated: bounded.truncated };
        }
        if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
        if (index === 0) inTransaction = true;
        if (index === steps.length - 1) inTransaction = false;
        onStep(index, result);
      } catch (error) {
        if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
        let rolledBack = false;
        if (inTransaction) {
          try { await client.query('ROLLBACK'); rolledBack = true; inTransaction = false; }
          catch { /* Final transaction state unknown */ }
        }
        return { status: rolledBack ? 'failed' : 'outcome_unknown', index, rolledBack };
      }
    }
    return { status: 'succeeded' };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', interrupt);
    if (cancelPromise) await cancelPromise;
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  }
}
async function runMysqlTransaction(profile: Profile & { engine: 'mysql' }, steps: Plan['steps'], signal: AbortSignal, onStep: (index: number, result: StepResult) => void): Promise<{ status: 'succeeded' | 'failed' | 'outcome_unknown'; index?: number; rolledBack?: boolean }> { return withSshTunnel(profile, effective => runMysqlTransactionDirect(effective, steps, signal, onStep), signal); }
async function runMysqlTransactionDirect(profile: Profile & { engine: 'mysql' }, steps: Plan['steps'], signal: AbortSignal, onStep: (index: number, result: StepResult) => void): Promise<{ status: 'succeeded' | 'failed' | 'outcome_unknown'; index?: number; rolledBack?: boolean }> {
  const client = createMysqlStreamingClient({ ...mysqlValueOptions, host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ...mysqlTlsOptions(profile), multipleStatements: false, connectTimeout: 5000 });
  if (signal.aborted) { client.destroy(); throw new QueryInterrupted(true, signal.reason === 'query-timeout'); }
  await new Promise<void>((resolve, reject) => client.connect(error => error ? reject(error) : resolve()));
  let cancelPromise: Promise<void> | undefined;
  const interrupt = () => { if (cancelPromise) return; cancelPromise = cancelMysqlQuery(profile, client.threadId).catch(() => { client.destroy(); }); };
  signal.addEventListener('abort', interrupt, { once: true });
  const timeout = setTimeout(interrupt, 30_000);
  let inTransaction = false;
  const command = (sql: string) => new Promise<StepResult>((resolve, reject) => client.query({ sql, rowsAsArray: true }, (error, rows) => {
    if (error) reject(error);
    else resolve({ status: 'succeeded', affectedRows: (rows as mysql.ResultSetHeader).affectedRows });
  }));
  try {
    for (const [index, step] of steps.entries()) {
      if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
      onStep(index, { status: 'running' });
      try {
        let result: StepResult;
        if (step.kind === 'read') {
          const collector = new ResultAccumulator(serialize);
          result = await withMysqlConnectionErrors(client, () => new Promise<StepResult>((resolve, reject) => {
            let columns: string[] = [];
            const stream = client.query({ sql: step.sql, rowsAsArray: true }).stream();
            stream.on('fields', (fields: { name: string }[]) => { columns = fields.map(field => field.name); });
            stream.on('data', (row: unknown[]) => collector.push(row));
            stream.once('error', reject);
            stream.once('end', () => resolve({ status: 'succeeded', columns, rows: collector.rows, truncated: collector.truncated }));
          }));
        } else result = await command(step.sql);
        if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
        if (index === 0) inTransaction = true;
        if (index === steps.length - 1) inTransaction = false;
        onStep(index, result);
      } catch (error) {
        if (signal.aborted) throw new QueryInterrupted(true, signal.reason === 'query-timeout');
        let rolledBack = false;
        if (inTransaction) {
          try { await command('ROLLBACK'); rolledBack = true; inTransaction = false; }
          catch { /* Final transaction state unknown */ }
        }
        return { status: rolledBack ? 'failed' : 'outcome_unknown', index, rolledBack };
      }
    }
    return { status: 'succeeded' };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', interrupt);
    if (cancelPromise) await cancelPromise;
    if (inTransaction) await command('ROLLBACK').catch(() => {});
    client.destroy();
  }
}

function resolveDatabase(profile: Profile, requested?: string): Profile {
  const database = requested === undefined ? (profile.engine === 'sqlite' ? 'main' : profile.database) : databaseName.parse(requested);
  if (profile.engine === 'sqlite') {
    if (database !== 'main') throw new Error('Invalid SQLite target');
    return profile;
  }
  if (!database) throw new Error('Database selection required');
  return { ...profile, database };
}
async function discoverDatabases(profile: Profile): Promise<{ name: string }[]> { return withSshTunnel(profile, effective => discoverDatabasesDirect(effective)); }
async function discoverDatabasesDirect(profile: Profile): Promise<{ name: string }[]> {
  if (profile.engine === 'sqlite') return [{ name: 'main' }];
  if (profile.engine === 'postgres') {
    const client = createPostgresClient({ host: profile.host, port: profile.port, database: profile.database || 'postgres', user: profile.user, password: profile.password, ssl: postgresTls(profile), connectionTimeoutMillis: 5000, query_timeout: 15000 });
    try {
      await client.connect();
      const result = await client.query("SELECT datname AS name FROM pg_database WHERE datallowconn AND NOT datistemplate AND has_database_privilege(datname, 'CONNECT') ORDER BY datname");
      return result.rows as { name: string }[];
    } finally { await client.end().catch(() => {}); }
  }
  const client = await createMysqlClient({ ...mysqlValueOptions, host: profile.host, port: profile.port, user: profile.user, password: profile.password, ...mysqlTlsOptions(profile), connectTimeout: 5000 });
  try {
    const [rows] = await client.query({ sql: 'SHOW DATABASES', timeout: 15000 });
    return (rows as { Database: string }[]).map(row => ({ name: row.Database }));
  } finally { await client.end(); }
}

async function inspect(profile: Profile, target?: { schema: string; name: string }): Promise<SchemaTable[]> { return withSshTunnel(profile, effective => inspectDirect(effective, target)); }
async function inspectDirect(profile: Profile, target?: { schema: string; name: string }): Promise<SchemaTable[]> {
  if (profile.engine === 'sqlite') {
    const db = new Database(profile.filename, { readonly: true, fileMustExist: true });
    try {
      const names = (target ? (target.schema === 'main' ? db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").all(target.name) : []) : db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 2000").all()) as { name: string }[];
      return names.map(({ name }) => ({ schema: 'main', name, columns: (db.prepare('SELECT name, type, "notnull" FROM pragma_table_info(?)').all(name) as { name: string; type: string; notnull: number }[]).map(c => ({ name: c.name, type: c.type, nullable: !c.notnull })) }));
    } finally { db.close(); }
  }
  if (profile.engine === 'postgres') {
    const client = createPostgresClient({ host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ssl: postgresTls(profile), connectionTimeoutMillis: 5000, query_timeout: 30000 });
    await client.connect();
    try {
      const result = await client.query(`SELECT table_schema, table_name, column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ${target ? 'AND table_schema = $1 AND table_name = $2' : ''} ORDER BY table_schema, table_name, ordinal_position LIMIT 5000`, target ? [target.schema, target.name] : []);
      const tables = new Map<string, SchemaTable>();
      for (const row of result.rows as { table_schema: string; table_name: string; column_name: string; data_type: string; is_nullable: string }[]) {
        const key = `${row.table_schema}\0${row.table_name}`;
        if (!tables.has(key)) tables.set(key, { schema: row.table_schema, name: row.table_name, columns: [] });
        tables.get(key)!.columns.push({ name: row.column_name, type: row.data_type, nullable: row.is_nullable === 'YES' });
      }
      return [...tables.values()];
    } finally { await client.end(); }
  }
  const client = await createMysqlClient({ ...mysqlValueOptions, host: profile.host, port: profile.port, database: profile.database, user: profile.user, password: profile.password, ...mysqlTlsOptions(profile), connectTimeout: 5000 });
  try {
    const [rows] = await client.query({ sql: `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? ${target ? 'AND TABLE_SCHEMA = ? AND TABLE_NAME = ?' : ''} ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT 5000`, timeout: 15000 }, target ? [profile.database, target.schema, target.name] : [profile.database]);
    const tables = new Map<string, SchemaTable>();
    for (const row of rows as { TABLE_SCHEMA: string; TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string; IS_NULLABLE: string }[]) {
      if (!tables.has(row.TABLE_NAME)) tables.set(row.TABLE_NAME, { schema: row.TABLE_SCHEMA, name: row.TABLE_NAME, columns: [] });
      tables.get(row.TABLE_NAME)!.columns.push({ name: row.COLUMN_NAME, type: row.DATA_TYPE, nullable: row.IS_NULLABLE === 'YES' });
    }
    return [...tables.values()];
  } finally { await client.end(); }
}
function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value instanceof Date) return value.toISOString();
  return value;
}

app.get('/api/v1/runtime', async () => ({ protocolVersion: 1, runtimeId, storage: { persistent: !!options.dataDir }, mode: options.runtimeMode ?? 'web-server', engines: ['sqlite', 'postgres', 'mysql'], limits: { resultTtlMs, planTtlMs: PLAN_TTL_MS, agentTimeBudgetMs: AGENT_TIME_BUDGET_MS, resultRows: RESULT_ROW_LIMIT, resultBytes: RESULT_BYTE_LIMIT, resultCacheBytes, queryTimeoutMs, maxConcurrentExecutions }, capabilities: { schemas: true, aiConfigured: aiSettings.view().configured, transactions: { sqlite: true, postgres: true, mysql: true }, readOnlyTransaction: false, streaming: { sqlite: true, postgres: true, mysql: true }, cancelMode: { sqlite: 'worker-termination', postgres: 'query-cancel', mysql: 'query-kill' }, explain: false, multipleResults: false, parameterStyle: { sqlite: '?', postgres: '$n', mysql: '?' } } }));
app.get('/api/v1/ai/settings', async () => aiSettings.view());
app.put('/api/v1/ai/settings', async (request, reply) => {
  if (!aiSettings.view().writable) return fail(reply, 403, 'AI 配置由环境变量管理；移除环境配置并重启后可在界面编辑');
  const parsed = aiSettingsInput.safeParse(request.body);
  if (!parsed.success) return fail(reply, 400, 'AI 配置格式无效，请检查供应商、模型和接口地址');
  if (!aiSettings.resolveKey(parsed.data)) return fail(reply, 400, '请输入 API Key；切换供应商或地址时不能沿用旧密钥');
  try { return aiSettings.update(parsed.data, () => audit.append({ action: 'ai_settings_changed', status: 'saved' })) ?? fail(reply, 409, '配置已在其他窗口更新，请重新加载'); }
  catch { return fail(reply, 503, '加密存储或审计不可用，配置未保存。持久化 Runtime 需要配置主密钥'); }
});
app.post('/api/v1/ai/test', async (request, reply) => {
  const parsed = aiTestInput.safeParse(request.body);
  if (!parsed.success) return fail(reply, 400, '请检查 API 地址、模型 ID 和密钥格式');
  const apiKey = aiSettings.resolveKey(parsed.data);
  if (!apiKey) return fail(reply, 400, '请输入此供应商和地址的 API Key');
  try {
    audit.append({ action:'model_outbound', status:'model_probe' });
    return await probeAgentModel({ ...parsed.data, apiKey }, options.aiFetch);
  } catch (error) { return fail(reply, 502, error instanceof ModelFailure ? error.message : '模型测试失败，请检查配置和网络'); }
});
app.post('/api/v1/ai/models', async (request, reply) => {
  const parsed = aiModelsInput.safeParse(request.body);
  if (!parsed.success) return fail(reply, 400, '接口地址无效，请使用 HTTPS 或本机 HTTP，不含账号、查询或片段');
  const apiKey = aiSettings.resolveKey(parsed.data);
  if (!apiKey) return fail(reply, 400, '请输入此供应商和地址的 API Key');
  try {
    audit.append({ action: 'model_outbound', status: 'models' });
    return { models: await listAiModels({ ...parsed.data, apiKey, model: '' }, options.aiFetch) };
  } catch { return fail(reply, 502, '无法获取模型列表，请检查地址、API Key 和网络；也可手动填写模型 ID'); }
});
app.post('/api/v1/ai/runs', async (request, reply) => {
  const parsed = agentRunInput.safeParse(request.body);
  if (!parsed.success) return fail(reply, 400, 'Invalid Agent run request');
  const aiConfig = aiSettings.config();
  if (!aiConfig?.apiKey || !aiConfig.model) return fail(reply, 503, 'AI is not configured');
  const input = parsed.data;
  if (input.runtimeId !== runtimeId || input.allowedConnectionIds.some(id => !connections.get(id))) return fail(reply, 403, 'Agent target is unavailable');
  const fingerprint = hashSql(JSON.stringify(input));
  const previous = agentStore.byRequest(input.clientRequestId);
  if (previous) return previous.requestHash === fingerprint
    ? previous.available ? reply.code(202).send({ id: previous.id, replayed: true }) : fail(reply, 410, 'Agent request was already handled but its conversation expired; no automatic replay') : fail(reply, 409, 'Agent request ID reused');
  if ([...agentRuns.values()].some(run => ['running', 'awaiting_approval', 'cancelling'].includes(run.snapshot().status))) return fail(reply, 409, 'The workspace Agent already has an active run');
  const scopeSignature = JSON.stringify({ mode: input.mode, ids: [...new Set(input.allowedConnectionIds)].sort() });
  const parent = input.previousRunId ? agentStore.get(input.previousRunId) : undefined;
  if (input.previousRunId && !parent) return fail(reply, 404, 'Previous conversation unavailable; start a new conversation without replaying writes');
  if (parent && (parent.signature !== scopeSignature || parent.nextRunId)) return fail(reply, 409, 'Conversation scope changed or another followup exists; reload or start a new conversation');
  if (input.resultSource) {
    const source = input.resultSource;
    const plan = plans.findByExecutionId(source.executionId);
    if (!input.allowedConnectionIds.includes(source.connectionId) || plan?.connectionId !== source.connectionId) return fail(reply, 403, 'Selected result is outside the authorized connection scope');
    const execution = currentExecution(source.executionId);
    const result = execution?.results[source.setId];
    if (!execution) return fail(reply, 410, '所选结果快照已过期或被释放，不会重新执行 SQL。', 'RESULT_EXPIRED');
    if (execution.status === 'running' || result?.status !== 'succeeded' || !result.columns) return fail(reply, 409, 'Selected result is not complete');
    if (!result.rows) return fail(reply, 410, '所选结果快照已过期或被释放，不会重新执行 SQL。', 'RESULT_EXPIRED');
  }
  const context = parent ? conversationContext(parent.snapshot) : undefined;
  const controller = new AbortController();
  const config = { ...aiConfig };
  const runId = randomUUID();
  const model = { provider: config.provider ?? 'deepseek', id: config.model };
  const tools = createAgentTools({ resultSource: input.resultSource, runtimeId, mode: input.mode, allowedConnectionIds: input.allowedConnectionIds, signal: controller.signal,
    beforeTool: (name, args, context) => { audit.append({ action: 'agent_tool', runId, ...context, status: name, sqlHash: hashSql(JSON.stringify(args)) }); },
    invoke: async (operation, params) => {
      const route = routeForDesktopOperation(operation, params);
      const response = await app.inject({ ...route, headers: { host: [...allowedHosts][0] }, payload: route.payload as Record<string, unknown> });
      return { statusCode: response.statusCode, body: response.json() };
    },
  });
  const run = new AgentRun({ id: runId, model, resultSource: input.resultSource, runtimeId, mode: input.mode, request: input.request, allowedConnectionIds: input.allowedConnectionIds, ...context, tools, controller,
    onChange: snapshot => agentStore.save(snapshot),
    complete: async (messages, signal, onText) => {
      audit.append({ action: 'model_outbound', runId, modelId: model.id, provider: model.provider, status: 'agent', sqlHash: hashSql(JSON.stringify(messages)) });
      return agentCompletion({ messages, tools: tools.definitions, config, signal, onText, fetchImpl: options.aiFetch });
    },
  });
  const id = run.snapshot().id;
  agentStore.begin({ snapshot: run.snapshot(), signature: scopeSignature, requestId: input.clientRequestId, requestHash: fingerprint, createdAt: Date.now() }, input.previousRunId);
  agentRuns.set(id, run);
  for (const retainedId of agentRuns.keys()) if (!agentStore.get(retainedId)) agentRuns.delete(retainedId);
  void run.start();
  return reply.code(202).send({ id });
});
app.get('/api/v1/ai/runs', async () => ({ persistent: agentStore.persistent, runs: agentStore.all().filter(record => !record.nextRunId).reverse().map(record => ({ id: record.snapshot.id, request: record.snapshot.history[0]?.request.slice(0, 100) ?? record.snapshot.request.slice(0, 100), status: record.snapshot.status, mode: record.snapshot.mode, createdAt: record.createdAt })) }));
app.get<{ Params: { id: string } }>('/api/v1/ai/runs/:id', async (request, reply) => {
  const run = agentRuns.get(request.params.id);
  const snapshot = run?.snapshot() ?? agentStore.get(request.params.id)?.snapshot;
  return snapshot ?? fail(reply, 404, 'Agent run unavailable; no automatic replay');
});
app.post<{ Params: { id: string } }>('/api/v1/ai/runs/:id/resume', async (request, reply) => {
  const run = agentRuns.get(request.params.id);
  if (!run) return fail(reply, 404, 'Agent run unavailable; no automatic replay');
  const pending = run.snapshot().pendingApproval;
  if (!pending || !plans.get(pending.planId)?.approved) return fail(reply, 403, 'Trusted approval is required');
  return run.resume() ? reply.code(202).send({ id: request.params.id }) : fail(reply, 409, 'Agent run cannot resume');
});
app.post<{ Params: { id: string } }>('/api/v1/ai/runs/:id/cancel', async (request, reply) => {
  const run = agentRuns.get(request.params.id);
  if (!run) return fail(reply, 404, 'Agent run unavailable');
  const pending = run.snapshot().pendingApproval;
  if (pending) plans.decide(pending.planId, 'reject');
  await run.cancel();
  return run.snapshot();
});
app.post<{ Body: { connectionId?: string; request?: string } }>('/api/v1/ai/drafts', async (request, reply) => {
  const aiConfig = aiSettings.config();
  if (!aiConfig?.apiKey || !aiConfig.model) return fail(reply, 503, 'AI is not configured');
  if (typeof request.body?.request !== 'string' || !request.body.request.trim() || request.body.request.length > 4000) return fail(reply, 400, 'Invalid AI request');
  const profile = request.body.connectionId ? connections.get(request.body.connectionId) : undefined;
  if (!profile) return fail(reply, 404, 'Connection not found');
  try { audit.append({ action: 'model_outbound', connectionId: profile.id, status: 'draft', sqlHash: hashSql(request.body.request) }); }
  catch { return fail(reply, 503, 'Audit storage unavailable'); }
  try {
    return await draftSql({ request: request.body.request, schema: await inspect(profile), config: aiConfig, fetchImpl: options.aiFetch });
  } catch { return fail(reply, 502, 'SQL draft generation failed'); }
});
app.post<{ Body: { executionId?: string; setId?: number; request?: string } }>('/api/v1/ai/analysis', async (request, reply) => {
  const aiConfig = aiSettings.config();
  if (!aiConfig?.apiKey || !aiConfig.model) return fail(reply, 503, 'AI is not configured');
  if (typeof request.body?.request !== 'string' || !request.body.request.trim() || request.body.request.length > 4000) return fail(reply, 400, 'Invalid AI request');
  const execution = request.body.executionId ? currentExecution(request.body.executionId) : undefined;
  const result = Number.isSafeInteger(request.body.setId) ? execution?.results[request.body.setId!] : undefined;
  if (!execution || !result?.columns || !result.rows) return fail(reply, result?.columns ? 410 : 404, result?.columns ? 'RESULT_EXPIRED' : 'Result set not found');
  try { audit.append({ action: 'model_outbound', executionId: execution.id, status: 'analysis', sqlHash: hashSql(request.body.request) }); }
  catch { return fail(reply, 503, 'Audit storage unavailable'); }
  try { return await analyzeRows({ request: request.body.request, columns: result.columns, rows: result.rows, truncated: result.truncated ?? false, config: aiConfig, fetchImpl: options.aiFetch }); }
  catch { return fail(reply, 502, 'Result analysis failed'); }
});
app.get('/api/v1/connections', async () => connections.list().map(publicProfile));
app.post('/api/v1/connections', async (request, reply) => {
  const parsed = connectionInput.safeParse(request.body);
  if (!parsed.success) return fail(reply, 400, 'Invalid connection configuration');
  try { audit.append({ action: 'connection_change_intent', status: 'create' }); }
  catch { return fail(reply, 503, 'Audit storage unavailable'); }
  let created: Profile;
  try { created = connections.add(parsed.data); }
  catch (error) {
    return fail(reply, 503, error instanceof Error && error.message.includes('DBPILOT_MASTER_KEY')
      ? '无法保存网络数据库连接：DBPilot Runtime 未配置有效的 DBPILOT_MASTER_KEY 或 DBPILOT_MASTER_KEY_FILE'
      : '连接设置保存失败；请检查 Runtime 存储状态');
  }
  try { audit.append({ action: 'connection_changed', connectionId: created.id, status: 'created' }); }
  catch { return fail(reply, 503, 'Connection created; audit completion unavailable'); }
  return reply.code(201).send(publicProfile(created));
});
app.put<{ Params: { id: string } }>('/api/v1/connections/:id', async (request, reply) => {
  const parsed = connectionInput.safeParse(request.body);
  if (!parsed.success) return fail(reply, 400, 'Invalid connection configuration');
  if (!connections.get(request.params.id)) return fail(reply, 404, 'Connection not found');
  try { audit.append({ action: 'connection_change_intent', connectionId: request.params.id, status: 'update' }); }
  catch { return fail(reply, 503, 'Audit storage unavailable'); }
  let updated: Profile | undefined;
  try { updated = connections.update(request.params.id, parsed.data); }
  catch { return fail(reply, 503, '连接设置保存失败；请检查 Runtime 的主密钥配置和存储状态'); }
  if (!updated) return fail(reply, 404, 'Connection not found');
  try { audit.append({ action: 'connection_changed', connectionId: updated.id, status: 'updated' }); }
  catch { return fail(reply, 503, 'Connection updated; audit completion unavailable'); }
  return publicProfile(updated);
});
app.delete<{ Params: { id: string } }>('/api/v1/connections/:id', async (request, reply) => {
  if (!connections.get(request.params.id)) return fail(reply, 404, 'Connection not found');
  try { audit.append({ action: 'connection_change_intent', connectionId: request.params.id, status: 'delete' }); }
  catch { return fail(reply, 503, 'Audit storage unavailable'); }
  if (!connections.delete(request.params.id)) return fail(reply, 404, 'Connection not found');
  try { audit.append({ action: 'connection_changed', connectionId: request.params.id, status: 'deleted' }); }
  catch { return fail(reply, 503, 'Connection deleted; audit completion unavailable'); }
  return reply.code(204).send();
});
app.post<{ Body: ConnectionInput & { editingId?: string } }>('/api/v1/connections/test', async (request, reply) => {
  const parsed = connectionInput.safeParse(request.body);
  if (!parsed.success) return fail(reply, 400, '连接参数不完整或格式不正确');
  let profile = parsed.data;
  if (request.body?.editingId && profile.engine !== 'sqlite') {
    const previous = connections.get(request.body.editingId);
    if (!previous || previous.engine !== profile.engine) return fail(reply, 404, '原连接不存在，无法使用已保存密码');
    profile = connections.resolveSecrets(profile, previous);
  }
  try { await probeConnection(profile); return { ok: true }; }
  catch (error) { return fail(reply, 502, connectionFailure(profile, error)); }
});
app.post<{ Params: { id: string } }>('/api/v1/connections/:id/test', async (request, reply) => {
  const profile = connections.get(request.params.id);
  if (!profile) return fail(reply, 404, 'Connection not found');
  try { await probeConnection(profile); return { ok: true }; }
  catch (error) { return fail(reply, 502, connectionFailure(profile, error)); }
});
app.get<{ Params: { id: string } }>('/api/v1/connections/:id/databases', async (request, reply) => {
  const profile = connections.get(request.params.id);
  if (!profile) return fail(reply, 404, 'Connection not found');
  try { return { connectionId: profile.id, databases: await discoverDatabases(profile) }; }
  catch (error) { return fail(reply, 502, connectionFailure(profile, error)); }
});
app.get<{ Params: { id: string } }>('/api/v1/connections/:id/tables', async (request, reply) => {
  const saved = connections.get(request.params.id);
  if (!saved) return fail(reply, 404, 'Connection not found');
  const parsed = tableCatalogQuery.safeParse(request.query);
  if (!parsed.success) return fail(reply, 400, 'Invalid table catalog query');
  let profile: Profile; let after: { schema: string; name: string } | undefined;
  try {
    profile = resolveDatabase(saved, parsed.data.database);
    if (parsed.data.cursor) {
      const cursor = tableCatalogCursor.parse(JSON.parse(Buffer.from(parsed.data.cursor, 'base64url').toString('utf8')));
      if (cursor.connectionId !== profile.id || cursor.version !== profile.version || cursor.database !== (profile.engine === 'sqlite' ? 'main' : profile.database)) throw new Error('Stale cursor');
      after = cursor;
    }
  } catch { return fail(reply, 400, 'Invalid database or catalog cursor; reload the directory'); }
  try {
    const rows = await listTablePage(profile, after);
    const tables = rows.slice(0, CATALOG_PAGE_SIZE).map(table => ({ ...table, columns: [] }));
    const database = profile.engine === 'sqlite' ? 'main' : profile.database;
    const nextCursor = rows.length > CATALOG_PAGE_SIZE ? Buffer.from(JSON.stringify({ connectionId: profile.id, version: profile.version, database, ...tables[tables.length - 1] })).toString('base64url') : undefined;
    return { connectionId: profile.id, database, tables, nextCursor };
  } catch { return fail(reply, 502, 'Table catalog inspection failed'); }
});
app.get<{ Params: { id: string }; Querystring: { database?: string } }>('/api/v1/connections/:id/schema', async (request, reply) => {
  const saved = connections.get(request.params.id);
  if (!saved) return fail(reply, 404, 'Connection not found');
  const parsed = schemaCatalogQuery.safeParse(request.query);
  if (!parsed.success) return fail(reply, 400, 'Invalid schema target');
  let profile: Profile;
  try { profile = resolveDatabase(saved, parsed.data.database); }
  catch { return fail(reply, 400, 'Select a valid database to inspect'); }
  try {
    const tables = await inspect(profile, parsed.data.table ? { schema: parsed.data.schema!, name: parsed.data.table } : undefined);
    const truncated = profile.engine === 'sqlite' ? tables.length >= 2000 : tables.reduce((count, table) => count + table.columns.length, 0) >= 5000;
    return { connectionId: profile.id, database: profile.engine === 'sqlite' ? 'main' : profile.database, tables, truncated };
  }
  catch { return fail(reply, 502, 'Schema inspection failed'); }
});
app.get('/api/v1/command-policy', async () => policy.get());
app.put('/api/v1/command-policy', async (request, reply) => {
  if (policy.get().readOnly) return fail(reply, 403, '规则由配置文件管理，界面只读；移除配置文件设置并重启后可编辑');
  const parsed = policyUpdateInput.safeParse(request.body);
  if (!parsed.success) return fail(reply, 400, '规则格式无效：自动执行必须指定精确 SQL');
  try {
    const updated = policy.update(parsed.data.revision, parsed.data.rules, (sqlHash, revision) => audit.append({ action: 'policy_changed', sqlHash, status: String(revision) }));
    return updated ?? fail(reply, 409, '规则已被其他窗口修改，请重新加载后再保存');
  } catch { return fail(reply, 503, '策略或审计保存失败，规则未更改'); }
});
app.post('/api/v1/command-plans', async (request, reply) => {
  const { rules, policyHash } = policy.snapshot();
  const parsed = prepareInput.safeParse(request.body);
  if (!parsed.success) return fail(reply, 400, 'Invalid plan request');
  plans.pruneExpiredUnconsumed(Date.now() - PLAN_TTL_MS);
  const fingerprint = (version: number) => createHash('sha256').update(JSON.stringify({ connectionId: parsed.data.connectionId, connectionVersion: version, sql: parsed.data.sql, source: parsed.data.source, database: parsed.data.database })).digest('hex');
  if (parsed.data.clientRequestId) {
    const existing = plans.findByClientRequestId(parsed.data.clientRequestId);
    if (existing) return existing.requestHash === fingerprint(existing.connectionVersion)
      ? { ...existing, approvalRequired: existing.source === 'ai' && !existing.approved && !existing.consumed && existing.steps.some(step => step.decision === 'ask'), replayed: true }
      : fail(reply, 409, 'Client request ID was used for a different plan');
  }
  const profile = connections.get(parsed.data.connectionId);
  if (!profile) return fail(reply, 404, 'Connection not found');
  let targetProfile: Profile;
  try { targetProfile = resolveDatabase(profile, parsed.data.database); } catch { return fail(reply, 400, 'Select a database before preparing SQL'); }
  let steps;
  try { steps = evaluateSqlPolicy(parsed.data.sql, { engine: profile.engine, connectionId: profile.id, source: parsed.data.source }, rules); }
  catch { return fail(reply, 400, 'Invalid SQL'); }
  const plan: Plan = { database: targetProfile.engine === 'sqlite' ? 'main' : targetProfile.database, policyHash, id: randomUUID(), connectionId: profile.id, connectionVersion: profile.version, steps, source: parsed.data.source, approved: false, consumed: false, createdAt: Date.now(), clientRequestId: parsed.data.clientRequestId, requestHash: parsed.data.clientRequestId ? fingerprint(profile.version) : undefined };
  try { plans.add(plan); audit.append({ action: 'plan_created', planId: plan.id, connectionId: profile.id, sqlHash: hashSql(parsed.data.sql) }); }
  catch { return fail(reply, 503, 'Plan storage unavailable'); }
  return { ...plan, approvalRequired: parsed.data.source === 'ai' && steps.some(s => s.decision === 'ask') };
});
app.get<{ Params: { id: string } }>('/api/v1/command-plans/:id', async (request, reply) => {
  const plan = plans.get(request.params.id);
  return plan && Date.now() - plan.createdAt <= PLAN_TTL_MS
    ? { ...plan, approvalRequired: plan.source === 'ai' && !plan.approved && !plan.consumed && plan.steps.some(step => step.decision === 'ask') }
    : fail(reply, 404, 'Plan expired or unavailable');
});
app.post<{ Params: { id: string }; Body: { decision?: string } }>('/api/v1/approvals/:id/decision', async (request, reply) => {
  const { rules, policyHash } = policy.snapshot();
  const plan = plans.get(request.params.id);
  if (!plan || plan.consumed || Date.now() - plan.createdAt > PLAN_TTL_MS) return fail(reply, 404, 'Plan expired or unavailable');
  if (request.body?.decision !== 'approve' && request.body?.decision !== 'reject') return fail(reply, 400, 'Invalid decision');
  if (request.body.decision === 'reject') {
    try { audit.append({ action: 'approval_decided', planId: plan.id, connectionId: plan.connectionId, status: 'rejected' }); }
    catch { return fail(reply, 503, 'Audit storage unavailable'); }
    plans.decide(plan.id, 'reject'); return { status: 'rejected' };
  }
  if (plan.steps.some(s => s.decision === 'deny')) return fail(reply, 403, 'Plan includes unsupported SQL');
  const profile = connections.get(plan.connectionId);
  if (!profile || profile.version !== plan.connectionVersion) return fail(reply, 409, 'Connection changed');
  if (!matchesCurrentPolicy(plan, profile.engine, rules, policyHash)) return fail(reply, 403, 'SQL policy changed; prepare a new plan');
  try { audit.append({ action: 'approval_decided', planId: plan.id, connectionId: plan.connectionId, status: 'approved' }); }
  catch { return fail(reply, 503, 'Audit storage unavailable'); }
  if (!plans.decide(plan.id, 'approve')) return fail(reply, 409, 'Plan decision already recorded');
  return { status: 'approved' };
});
app.post<{ Body: { planId?: string } }>('/api/v1/executions', async (request, reply) => {
  const { rules, policyHash } = policy.snapshot();
  const plan = request.body?.planId ? plans.get(request.body.planId) : undefined;
  if (plan?.consumed && plan.executionId) return reply.code(202).send({ executionId: plan.executionId, replayed: true });
  if (!plan || plan.consumed || Date.now() - plan.createdAt > PLAN_TTL_MS) return fail(reply, 404, 'Plan expired or unavailable');
  if (plan.steps.some(s => s.decision === 'deny')) return fail(reply, 403, 'Plan includes unsupported SQL');
  if (plan.source === 'ai' && !plan.approved && plan.steps.some(step => step.decision === 'ask')) return fail(reply, 403, 'Approval required');
  const savedProfile = connections.get(plan.connectionId);
  if (!savedProfile || savedProfile.version !== plan.connectionVersion) return fail(reply, 409, 'Connection changed');
  let profile: Profile;
  try { profile = resolveDatabase(savedProfile, plan.database); } catch { return fail(reply, 409, 'Database target changed; prepare a new plan'); }
  if (!matchesCurrentPolicy(plan, profile.engine, rules, policyHash)) return fail(reply, 403, 'SQL policy changed; prepare a new plan');
  if (controllers.size >= maxConcurrentExecutions) return fail(reply, 429, 'Runtime execution limit reached; wait for a running query to finish or cancel it');
  const execution: ExecutionState = { id: randomUUID(), status: 'running', results: plan.steps.map(() => ({ status: 'pending' })) };
  const intent = { connectionId: plan.connectionId, sqlHash: hashSql(plan.steps.map(step => step.sql).join(';')) };
  if (!options.dataDir) audit.append({ action: 'execution_intent', planId: plan.id, executionId: execution.id, ...intent });
  try { if (!plans.claim(plan.id, execution.id, options.dataDir ? intent : undefined)) return fail(reply, 409, 'Plan was already claimed'); }
  catch { return fail(reply, 503, 'Execution intent storage unavailable'); }
  const controller = new AbortController();
  const budgetTimer = setTimeout(() => controller.abort('query-timeout'), queryTimeoutMs);
  controllers.set(execution.id, controller);
  executions.set(execution.id, execution);
  journal.save(execution);
  events.publish(execution.id, 'started');
  const task = (async () => {
    if (plan.steps.some(step => step.kind === 'transaction')) {
      execution.results[0] = { status: 'running' };
      journal.save(execution);
      try {
        const onStep = (index: number, result: StepResult) => {
          execution.results[index] = result;
          pruneResultCache();
          if (profile.engine === 'sqlite' && result.status !== 'running' && index + 1 < execution.results.length) execution.results[index + 1] = { status: 'running' };
          journal.save(execution);
          events.publish(execution.id, 'step', { index, status: result.status });
        };
        const outcome = profile.engine === 'sqlite'
          ? await runSqliteTransaction(profile, plan.steps, controller.signal, onStep)
          : profile.engine === 'postgres'
            ? await runPostgresTransaction(profile, plan.steps, controller.signal, onStep)
            : await runMysqlTransaction(profile, plan.steps, controller.signal, onStep);
        execution.status = outcome.status;
        if (outcome.status !== 'succeeded' && outcome.index !== undefined) {
          const failedIndex = outcome.index;
          execution.results[failedIndex] = { status: outcome.status, error: 'Database command failed', rolledBack: outcome.rolledBack };
          if (outcome.rolledBack) execution.results = execution.results.map((result, index) => index < failedIndex && index > 0 ? { ...result, rolledBack: true } : result);
        }
        if (plan.steps.at(-1)?.sql.trim().toUpperCase().startsWith('ROLLBACK') && outcome.status === 'succeeded') execution.results = execution.results.map((result, index) => index > 0 && index < execution.results.length - 1 ? { ...result, rolledBack: true } : result);
      } catch (error) {
        execution.status = error instanceof QueryInterrupted || error instanceof UnknownWriteOutcome ? 'outcome_unknown' : 'failed';
        const index = execution.results.findIndex(result => result.status === 'running');
        if (index >= 0) execution.results[index] = { status: execution.status, error: error instanceof QueryInterrupted || error instanceof UnknownWriteOutcome ? error.message : 'Database command failed' };
      }
    } else {
    for (const [index, step] of plan.steps.entries()) {
      if (controller.signal.aborted) { execution.status = 'cancelled'; break; }
      execution.results[index] = { status: 'running' };
      journal.save(execution);
      events.publish(execution.id, 'step', { index, status: 'running' });
      try { execution.results[index] = await run(profile, step.sql, controller.signal, step.kind !== 'read'); pruneResultCache(); journal.save(execution); events.publish(execution.id, 'step', { index, status: 'succeeded' }); }
      catch (error) {
        execution.status = error instanceof UnknownWriteOutcome ? 'outcome_unknown' : error instanceof QueryInterrupted ? error.outcomeUnknown ? 'outcome_unknown' : 'cancelled' : 'failed';
        execution.results[index] = { status: execution.status, error: error instanceof QueryInterrupted || error instanceof UnknownWriteOutcome ? error.message : 'Database command failed' };
        journal.save(execution); events.publish(execution.id, 'step', { index, status: execution.status }); break;
      }
    }
    }
    if (execution.status === 'running') execution.status = controller.signal.aborted ? 'cancelled' : 'succeeded';
    if (execution.status !== 'succeeded') execution.results = execution.results.map(result => result.status === 'pending' ? { status: 'skipped' } : result);
    execution.finishedAt = Date.now();
    journal.save(execution);
    try { audit.append({ action: 'execution_finished', planId: plan.id, executionId: execution.id, connectionId: plan.connectionId, status: execution.status }); }
    catch { execution.status = 'outcome_unknown'; journal.save(execution); }
    events.publish(execution.id, execution.status === 'succeeded' ? 'completed' : execution.status === 'cancelled' ? 'cancelled' : execution.status === 'outcome_unknown' ? 'outcome_unknown' : 'failed');
  })().catch(() => {
    execution.status = 'outcome_unknown';
    execution.finishedAt = Date.now();
    execution.results = execution.results.map(result => result.status === 'running' ? { ...result, status: 'outcome_unknown' } : result.status === 'pending' ? { status: 'skipped' } : result);
    try { journal.save(execution); } catch { /* Restart recovery retains the persistent execution intent. */ }
    events.publish(execution.id, 'outcome_unknown');
  }).finally(() => {
    clearTimeout(budgetTimer);
    controllers.delete(execution.id);
    activeTasks.delete(task);
  });
  activeTasks.add(task);
  return reply.code(202).send({ executionId: execution.id });
});
app.get<{ Querystring: { connectionId?: string } }>('/api/v1/executions', async (request, reply) => {
  const connectionId = request.query.connectionId;
  const connection = connectionId ? connections.get(connectionId) : undefined;
  if (!connection) return fail(reply, 404, 'Connection not found');
  return plans.listExecuted(connection.id).map(plan => {
    const execution = currentExecution(plan.executionId!) ?? journal.get(plan.executionId!);
    return {
      id: plan.executionId,
      connection: connection.name,
      database: plan.database,
      sql: plan.steps.map(step => step.sql).join(';\n'),
      startedAt: plan.createdAt,
      status: execution?.status ?? 'outcome_unknown',
      steps: plan.steps.map((step, index) => ({
        sql: step.sql,
        status: execution?.results[index]?.status ?? 'outcome_unknown',
        affectedRows: execution?.results[index]?.affectedRows,
        truncated: execution?.results[index]?.truncated,
        rolledBack: execution?.results[index]?.rolledBack,
        error: execution?.results[index]?.error
      })),
      resultAvailable: !!currentExecution(plan.executionId!)?.results.some(result => result.rows && result.columns)
    };
  });
});
app.get<{ Params: { id: string } }>('/api/v1/executions/:id', async (request, reply) => {
  const execution = currentExecution(request.params.id);
  if (execution) return { id: execution.id, status: execution.status, results: execution.results.map(({ rows, ...result }) => ({ ...result, resultAvailable: !!rows && !!result.columns })) };
  return journal.get(request.params.id) ?? fail(reply, 404, 'Execution not found');
});
app.post<{ Params: { id: string } }>('/api/v1/executions/:id/cancel', async (request, reply) => {
  const execution = currentExecution(request.params.id);
  if (!execution) return fail(reply, 404, 'Execution not found');
  if (execution.status !== 'running') return { status: execution.status, accepted: false };
  try { audit.append({ action: 'cancel_requested', executionId: execution.id, status: 'accepted' }); }
  catch { return fail(reply, 503, 'Audit storage unavailable'); }
  controllers.get(execution.id)?.abort();
  return { status: 'cancel_pending', accepted: true, mode: 'best_effort' };
});
app.get<{ Params: { id: string }; Querystring: { afterSeq?: string } }>('/api/v1/executions/:id/events', async (request, reply) => {
  const afterSeq = request.query.afterSeq === undefined ? 0 : Number(request.query.afterSeq);
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) return fail(reply, 400, 'Invalid event sequence');
  currentExecution(request.params.id);
  const replay = events.replay(request.params.id, afterSeq);
  if (!replay) return journal.get(request.params.id) ? fail(reply, 409, 'EVENT_GAP') : fail(reply, 404, 'Execution not found');
  if (replay.gap) return fail(reply, 409, 'EVENT_GAP');
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (event: ExecutionEvent) => reply.raw.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  for (const event of replay.events) send(event);
  const execution = currentExecution(request.params.id);
  if (!execution || execution.status !== 'running') { reply.raw.end(); return; }
  const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
  const unsubscribe = events.subscribe(request.params.id, event => {
    send(event);
    if (['completed', 'failed', 'cancelled', 'outcome_unknown'].includes(event.type)) { clearInterval(heartbeat); unsubscribe(); reply.raw.end(); }
  });
  request.raw.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
});
app.get<{ Params: { id: string; setId: string }; Querystring: { cursor?: string; limit?: string } }>('/api/v1/executions/:id/results/:setId', async (request, reply) => {
  const execution = currentExecution(request.params.id);
  if (!execution) return journal.get(request.params.id) ? fail(reply, 410, 'RESULT_EXPIRED') : fail(reply, 404, 'Result not found');
  const stepIndex = Number(request.params.setId);
  const limit = request.query.limit === undefined ? 200 : Number(request.query.limit);
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) return fail(reply, 400, 'Invalid result page request');
  const result = execution.results[stepIndex];
  if (!result?.rows || !result.columns) return fail(reply, result?.columns ? 410 : 404, result?.columns ? 'RESULT_EXPIRED' : 'Result set not found');
  let offset = 0;
  if (request.query.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(request.query.cursor, 'base64url').toString('utf8')) as { executionId?: string; stepIndex?: number; offset?: number };
      if (decoded.executionId !== execution.id || decoded.stepIndex !== stepIndex || !Number.isSafeInteger(decoded.offset) || decoded.offset! < 0) return fail(reply, 400, 'Invalid result cursor');
      offset = decoded.offset!;
    } catch { return fail(reply, 400, 'Invalid result cursor'); }
  }
  const rows = result.rows.slice(offset, offset + limit);
  const nextOffset = offset + rows.length;
  const nextCursor = nextOffset < result.rows.length ? Buffer.from(JSON.stringify({ executionId: execution.id, stepIndex, offset: nextOffset })).toString('base64url') : null;
  return { executionId: execution.id, setId: stepIndex, columns: result.columns, rows, nextCursor, truncated: result.truncated ?? false };
});

return app;
} catch (error) { try { closeResources(); } catch { /* Preserve the startup error. */ } throw error; }
}

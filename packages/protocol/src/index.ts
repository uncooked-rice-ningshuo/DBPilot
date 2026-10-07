import { z } from 'zod';

export const sshConnection = z.strictObject({
  host:z.string().trim().min(1).max(253), port:z.number().int().min(1).max(65535).default(22), user:z.string().min(1).max(200),
  password:z.string().max(4096), hostFingerprint:z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
});
const tlsFields = {
  ssh: sshConnection.optional(),
  tlsCa: z.string().trim().max(128000).refine(value => !value || (value.startsWith('-----BEGIN CERTIFICATE-----') && value.endsWith('-----END CERTIFICATE-----') && !value.includes('PRIVATE KEY')), 'CA must be PEM certificates only').optional(),
  tlsServerName: z.string().trim().max(253).refine(value => !value || /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(value), 'Invalid TLS server name').optional(),
};
export const connectionInput = z.discriminatedUnion('engine', [
  z.object({ engine: z.literal('sqlite'), name: z.string().min(1), filename: z.string().min(1) }),
  z.object({ engine: z.literal('postgres'), name: z.string().min(1), host: z.string().min(1), port: z.number().int().min(1).max(65535).default(5432), database: z.string().trim().max(256).default(''), user: z.string().min(1), password: z.string(), ssl: z.boolean().default(false), ...tlsFields }),
  z.object({ engine: z.literal('mysql'), name: z.string().min(1), host: z.string().min(1), port: z.number().int().min(1).max(65535).default(3306), database: z.string().trim().max(256).default(''), user: z.string().min(1), password: z.string(), ssl: z.boolean().default(false), ...tlsFields })
]);
export type ConnectionInput = z.infer<typeof connectionInput>;
export const databaseName = z.string().min(1).max(256).refine(value => !value.includes('\0'), 'Invalid database name');
export const databaseCatalog = z.object({ connectionId: z.string().uuid(), databases: z.array(z.object({ name: databaseName })), truncated: z.boolean().optional() });
export const schemaCatalog = z.object({ connectionId: z.string().uuid(), database: databaseName, tables: z.array(z.object({ schema: z.string(), name: z.string(), columns: z.array(z.object({ name: z.string(), type: z.string(), nullable: z.boolean() })) })), truncated: z.boolean().optional() });
export const tableCatalog = schemaCatalog.extend({ nextCursor: z.string().optional() });
export const tableCatalogQuery = z.object({ database: databaseName.optional(), cursor: z.string().min(1).max(4096).optional() });
export const tableCatalogCursor = z.object({ connectionId: z.string().uuid(), version: z.number().int(), database: databaseName, schema: z.string().max(256), name: z.string().max(256) });
export const schemaCatalogQuery = z.object({ database: databaseName.optional(), schema: databaseName.optional(), table: databaseName.optional() }).refine(value => (value.schema === undefined) === (value.table === undefined));

export const prepareInput = z.object({ database: databaseName.optional(), connectionId: z.string().uuid(), sql: z.string().min(1), source: z.enum(['human', 'ai']).default('human'), clientRequestId: z.string().uuid().optional() });
export type PrepareInput = z.infer<typeof prepareInput>;

export const agentResultSource = z.strictObject({ executionId: z.string().uuid(), connectionId: z.string().uuid(), setId: z.number().int().nonnegative() });
export type AgentResultSource = z.infer<typeof agentResultSource>;
export const agentRunInput = z.strictObject({
  runtimeId: z.string().uuid(), clientRequestId: z.string().uuid(),
  previousRunId: z.string().uuid().optional(), resultSource: agentResultSource.optional(),
  request: z.string().trim().min(1).max(4000), mode: z.enum(['suggest', 'execute']),
  allowedConnectionIds: z.array(z.string().uuid()).max(100),
});

export const commandRules = z.array(z.strictObject({
  connectionId: z.string().uuid(),
  kind: z.enum(['read', 'write', 'schema', 'transaction']),
  decision: z.enum(['allow', 'ask', 'deny']),
  exactSql: z.string().min(1).max(20_000).optional(),
}).refine(rule => rule.decision !== 'allow' || !!rule.exactSql, { message: 'Automatic execution requires exact SQL' })).max(256);
export type CommandRule = z.infer<typeof commandRules>[number];

export const policyUpdateInput = z.strictObject({ revision: z.number().int().nonnegative(), rules: commandRules });
export const policySettings = z.strictObject({ revision: z.number().int().nonnegative(), rules: commandRules, readOnly: z.boolean(), persistent: z.boolean(), source: z.enum(['configuration', 'workspace']) });
export type PolicySettings = z.infer<typeof policySettings>;

export const aiProvider = z.enum(['deepseek', 'openai-compatible']);
export const aiBaseUrl = z.string().trim().url().max(2000).refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)));
}, 'Use HTTPS or loopback HTTP without credentials, query or fragment').transform(value => value.replace(/\/+$/, ''));
export const aiModelsInput = z.strictObject({ provider: aiProvider, baseUrl: aiBaseUrl, apiKey: z.string().trim().max(4096).optional() });
export const aiTestInput = aiModelsInput.extend({ model: z.string().trim().min(1).max(200) });
export const aiTestResult = z.object({ model:z.string(),toolCalling:z.literal(true) });
export const aiSettingsInput = aiModelsInput.extend({ revision: z.number().int().nonnegative(), model: z.string().trim().min(1).max(200) });
export const aiSettingsView = z.object({ revision: z.number().int().nonnegative(), provider: aiProvider, baseUrl: z.string(), model: z.string(), hasApiKey: z.boolean(), configured: z.boolean(), persistent: z.boolean(), writable: z.boolean(), source: z.enum(['environment', 'workspace']), storageReady: z.boolean() });
export type AiSettingsView = z.infer<typeof aiSettingsView>;

/** Non-secret suggestions only; saving remains a user action in the connection form. */
export const agentConnectionDraft = z.strictObject({
  engine: z.enum(['sqlite', 'postgres', 'mysql']), name: z.string().trim().min(1).max(120),
  host: z.string().trim().min(1).max(253).optional(), port: z.number().int().min(1).max(65535).optional(),
  database: z.string().max(256).optional(), user: z.string().max(200).optional(),
});
export type AgentConnectionDraft = z.infer<typeof agentConnectionDraft>;
export const agentTodo = z.strictObject({ id: z.string().min(1).max(64), text: z.string().trim().min(1).max(200), status: z.enum(['pending', 'in_progress', 'completed']) });
export const agentStatus = z.enum(['running', 'awaiting_approval', 'cancelling', 'succeeded', 'failed', 'cancelled']);
export const agentSnapshot = z.object({
  id: z.string().uuid(), runtimeId: z.string().uuid(), request: z.string().max(4000), mode: z.enum(['suggest', 'execute']),
  allowedConnectionIds: z.array(z.string().uuid()).max(100),
  history: z.array(z.object({ id: z.string().uuid(), request: z.string(), answer: z.string().optional(), error: z.string().optional(), status: z.string(), evidence: z.string(), truncated: z.boolean() })).max(6),
  resultSource: agentResultSource.optional(), model: z.object({ provider: z.string().max(100), id: z.string().max(200) }).optional(),
  historyTruncated: z.boolean(), status: agentStatus, deadlineAt: z.number().optional(), answer: z.string().max(16000).optional(), error: z.string().optional(),
  todos: z.array(agentTodo).max(12).optional(),
  pendingApproval: z.object({ runtimeId: z.string().uuid(), connectionId: z.string().uuid(), database: z.string().optional(), planId: z.string(), steps: z.array(z.object({sql:z.string(),kind:z.string(),decision:z.string()})) }).optional(),
  activity: z.array(z.object({ tool: z.string(), result: z.discriminatedUnion('ok', [z.object({ok:z.literal(true),data:z.unknown()}),z.object({ok:z.literal(false),error:z.string(),code:z.string().optional()})]) })).max(64),
});
export const agentHistoryList = z.object({ persistent: z.boolean(), runs: z.array(z.object({id:z.string().uuid(),request:z.string().max(100),status:agentStatus,mode:z.enum(['suggest','execute']),createdAt:z.number()})).max(32) });

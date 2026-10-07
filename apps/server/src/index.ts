import { createApp } from './app.js';
import { resolveServerStorage } from './server-storage.js';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const storage = resolveServerStorage();
const policyRules = process.env.DBPILOT_COMMAND_RULES_FILE ? JSON.parse(readFileSync(process.env.DBPILOT_COMMAND_RULES_FILE, 'utf8')) : undefined;
const app = await createApp({ commandRules: policyRules, dataDir: storage.dataDir, masterKey: storage.masterKey, logger: true, webRoot: process.env.DBPILOT_SERVE_WEB === '1' ? resolve(process.cwd(), 'dist/web') : undefined, allowedHosts: process.env.DBPILOT_PUBLIC_HOSTS ? process.env.DBPILOT_PUBLIC_HOSTS.split(',').map(host => host.trim()) : undefined, allowedOrigins: process.env.DBPILOT_ALLOWED_ORIGINS ? process.env.DBPILOT_ALLOWED_ORIGINS.split(',').map(origin => origin.trim()) : undefined, maxConcurrentExecutions: process.env.DBPILOT_MAX_CONCURRENT_EXECUTIONS ? Number(process.env.DBPILOT_MAX_CONCURRENT_EXECUTIONS) : undefined, queryTimeoutMs: process.env.DBPILOT_QUERY_TIMEOUT_MS ? Number(process.env.DBPILOT_QUERY_TIMEOUT_MS) : undefined, resultCacheBytes: process.env.DBPILOT_RESULT_CACHE_BYTES ? Number(process.env.DBPILOT_RESULT_CACHE_BYTES) : undefined, ai: process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_MODEL ? { apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL, baseUrl: process.env.DEEPSEEK_BASE_URL } : undefined });
app.log.info({ dataDir: storage.dataDir, persistent: storage.persistent }, storage.persistent ? 'Workspace metadata and Agent history are persistent' : 'Explicit ephemeral mode: connections and Agent history will be lost on shutdown');
await app.listen({ host: process.env.DBPILOT_HOST ?? '127.0.0.1', port: Number(process.env.DBPILOT_PORT ?? 3000) });

let closing: Promise<void> | undefined;
const shutdown = () => { closing ??= app.close().catch(() => { process.exitCode = 1; }); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from './native-database.mjs';
import type { z } from 'zod';
import { aiSettingsInput, type AiSettingsView } from '../../protocol/src/index.js';
import type { DeepSeekConfig } from '../../ai-core/src/deepseek.js';

type Saved = { revision: number; config?: DeepSeekConfig };
export class AiSettingsStore {
  private readonly db?: Database.Database;
  private readonly key?: Buffer;
  private memory: Saved = { revision: 0 };
  constructor(dataDir?: string, masterKey?: string, private readonly environment?: DeepSeekConfig) {
    if (masterKey) { this.key = Buffer.from(masterKey, 'base64'); if (this.key.length !== 32) throw new Error('Invalid master key'); }
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      this.db = new Database(join(dataDir, 'metadata.db')); this.db.pragma('journal_mode = WAL');
      this.db.exec("CREATE TABLE IF NOT EXISTS ai_settings(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, config TEXT)");
    }
  }
  private saved(): Saved {
    const row = this.db?.prepare('SELECT revision, config FROM ai_settings WHERE id=1').get() as { revision: number; config: string } | undefined;
    if (!row) return this.memory;
    const config = JSON.parse(row.config) as DeepSeekConfig;
    if (!this.key) throw new Error('Secret store unavailable');
    const [iv, tag, value] = config.apiKey.split(':');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64')); decipher.setAuthTag(Buffer.from(tag, 'base64'));
    config.apiKey = Buffer.concat([decipher.update(Buffer.from(value, 'base64')), decipher.final()]).toString('utf8');
    return { revision: row.revision, config };
  }
  validateSecrets(): void { this.saved(); }
  config(): DeepSeekConfig | undefined { return this.environment ?? this.saved().config; }
  view(): AiSettingsView {
    const config = this.config();
    return { revision: this.environment ? 0 : this.saved().revision, provider: config?.provider ?? 'deepseek', baseUrl: config?.baseUrl ?? 'https://api.deepseek.com', model: config?.model ?? 'deepseek-flash', hasApiKey: !!config?.apiKey, configured: !!(config?.apiKey && config.model), persistent: !!this.db, writable: !this.environment, source: this.environment ? 'environment' : 'workspace', storageReady: !this.db || !!this.key };
  }
  resolveKey(input: { provider: string; baseUrl: string; apiKey?: string }): string | undefined {
    if (input.apiKey) return input.apiKey;
    const previous = this.config();
    return previous && (previous.provider ?? 'deepseek') === input.provider && (previous.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '') === input.baseUrl ? previous.apiKey : undefined;
  }
  update(input: z.infer<typeof aiSettingsInput>, auditMemory: () => void): AiSettingsView | undefined {
    if (this.environment) throw new Error('Environment settings are read-only');
    if (this.db && !this.key) throw new Error('Secret store unavailable');
    const save = () => {
      if (this.saved().revision !== input.revision) return undefined;
      const apiKey = this.resolveKey(input); if (!apiKey) throw new Error('API key required');
      const config: DeepSeekConfig = { provider: input.provider, baseUrl: input.baseUrl, model: input.model, apiKey };
      const revision = input.revision + 1;
      if (this.db) {
        const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key!, iv);
        const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
        const stored = { ...config, apiKey: `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}` };
        this.db.prepare('INSERT INTO ai_settings VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,config=excluded.config').run(revision, JSON.stringify(stored));
        this.db.prepare('INSERT INTO audit_events(id,action,status,created_at) VALUES(?,?,?,?)').run(randomUUID(), 'ai_settings_changed', String(revision), Date.now());
      } else { auditMemory(); this.memory = { revision, config }; }
      return this.view();
    };
    return this.db ? this.db.transaction(save).immediate() : save();
  }
  close() { this.db?.close(); }
}

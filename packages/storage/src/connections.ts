import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from './native-database.mjs';
import type { ConnectionInput } from '../../protocol/src/index.js';

export type SavedConnection = ConnectionInput & { id: string; version: number };

export class ConnectionStore {
  private readonly memory = new Map<string, SavedConnection>();
  private readonly db?: Database.Database;
  private readonly key?: Buffer;

  constructor(dataDir?: string, masterKeyBase64?: string) {
    if (masterKeyBase64) {
      this.key = Buffer.from(masterKeyBase64, 'base64');
      if (this.key.length !== 32) throw new Error('DBPILOT_MASTER_KEY must be a base64 encoded 32-byte key');
    }
    if (dataDir) {
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      this.db = new Database(join(dataDir, 'metadata.db'));
      this.db.pragma('journal_mode = WAL');
      this.db.exec('CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, version INTEGER NOT NULL, config TEXT NOT NULL)');
    }
  }

  add(input: ConnectionInput): SavedConnection {
    if (this.db && input.engine !== 'sqlite' && !this.key) throw new Error('Persistent network connections require DBPILOT_MASTER_KEY');
    const profile: SavedConnection = { ...input, id: randomUUID(), version: 1 };
    if (this.db) {
      const config = this.encode(input);
      this.db.prepare('INSERT INTO connections(id, version, config) VALUES (?, ?, ?)').run(profile.id, profile.version, JSON.stringify(config));
    } else this.memory.set(profile.id, profile);
    return profile;
  }

  update(id: string, input: ConnectionInput): SavedConnection | undefined {
    const previous = this.get(id);
    if (!previous) return undefined;
    if (this.db && input.engine !== 'sqlite' && !this.key) throw new Error('Persistent network connections require DBPILOT_MASTER_KEY');
    const resolved = this.resolveSecrets(input, previous);
    const profile: SavedConnection = { ...resolved, id, version: previous.version + 1 };
    if (this.db) {
      const config = this.encode(resolved);
      this.db.prepare('UPDATE connections SET version = ?, config = ? WHERE id = ?').run(profile.version, JSON.stringify(config), id);
    } else this.memory.set(id, profile);
    return profile;
  }

  resolveSecrets(input: ConnectionInput, previous: SavedConnection): ConnectionInput {
    if (input.engine === 'sqlite' || previous.engine === 'sqlite' || input.engine !== previous.engine) return input;
    const tunnelIdentity = (ssh: typeof input.ssh) => ssh ? JSON.stringify([ssh.host, ssh.port, ssh.user, ssh.hostFingerprint]) : '';
    const sameDestination = input.host === previous.host && input.port === previous.port && input.user === previous.user
      && input.ssl === previous.ssl && (input.tlsCa ?? '') === (previous.tlsCa ?? '') && (input.tlsServerName ?? '') === (previous.tlsServerName ?? '')
      && tunnelIdentity(input.ssh) === tunnelIdentity(previous.ssh);
    const resolved = { ...input, password: input.password === '' && sameDestination ? previous.password : input.password };
    const ssh = input.ssh, old = previous.ssh;
    if (ssh && old && ssh.password === '' && ssh.host === old.host && ssh.port === old.port && ssh.user === old.user && ssh.hostFingerprint === old.hostFingerprint) resolved.ssh = { ...ssh, password: old.password };
    return resolved;
  }
  private encode(input: ConnectionInput) {
    return input.engine === 'sqlite' ? input : { ...input, password:this.encrypt(input.password), ...(input.ssh ? {ssh:{...input.ssh,password:this.encrypt(input.ssh.password)}} : {}) };
  }

  get(id: string): SavedConnection | undefined {
    if (!this.db) return this.memory.get(id);
    const row = this.db.prepare('SELECT version, config FROM connections WHERE id = ?').get(id) as { version: number; config: string } | undefined;
    if (!row) return undefined;
    const config = JSON.parse(row.config) as ConnectionInput;
    if (config.engine !== 'sqlite') {
      if (!this.key) throw new Error('Master key is required to unlock saved connections');
      config.password = this.decrypt(config.password);
      if (config.ssh) config.ssh.password = this.decrypt(config.ssh.password);
    }
    return { ...config, id, version: row.version };
  }

  list(): SavedConnection[] {
    if (!this.db) return [...this.memory.values()];
    const rows = this.db.prepare('SELECT id FROM connections ORDER BY rowid DESC').all() as { id: string }[];
    return rows.map(row => this.get(row.id)!);
  }

  delete(id: string): boolean {
    if (!this.db) return this.memory.delete(id);
    return this.db.prepare('DELETE FROM connections WHERE id = ?').run(id).changes > 0;
  }

  close() { this.db?.close(); }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key!, iv);
    const payload = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${payload.toString('base64')}`;
  }

  private decrypt(value: string): string {
    const [version, iv, tag, payload] = value.split(':');
    if (version !== 'v1' || !iv || !tag || payload === undefined) throw new Error('Unsupported encrypted secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key!, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload, 'base64')), decipher.final()]).toString('utf8');
  }
}

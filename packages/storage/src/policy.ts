import Database from './native-database.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { commandRules, type CommandRule, type PolicySettings } from '../../protocol/src/index.js';
import { hashSql } from './audit.js';

// Policy and its audit record commit together. Revision prevents stale saves and ABA approvals.
export class PolicyStore {
  private readonly db?: Database.Database;
  private memory = { revision: 0, rules: [] as CommandRule[] };
  constructor(dataDir?: string, private readonly configured?: CommandRule[]) {
    if (configured !== undefined) this.configured = commandRules.parse(configured);
    if (!dataDir) return;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new Database(join(dataDir, 'metadata.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec("CREATE TABLE IF NOT EXISTS command_policy (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, rules TEXT NOT NULL); INSERT OR IGNORE INTO command_policy VALUES(1, 0, '[]')");
  }
  get(): PolicySettings {
    const row = this.db?.prepare('SELECT revision, rules FROM command_policy WHERE id = 1').get() as { revision: number; rules: string } | undefined;
    const current = row ? { revision: row.revision, rules: commandRules.parse(JSON.parse(row.rules)) } : this.memory;
    return { ...current, rules: this.configured ?? current.rules, source: this.configured === undefined ? 'workspace' : 'configuration', readOnly: this.configured !== undefined, persistent: !!this.db };
  }
  snapshot() {
    const settings = this.get();
    const policyHash = settings.source === 'configuration'
      ? hashSql(JSON.stringify({ source: settings.source, rules: settings.rules, revision: settings.revision }))
      : settings.revision === 0 ? undefined : hashSql(JSON.stringify(settings));
    return { rules: settings.rules, policyHash };
  }
  update(revision: number, rules: CommandRule[], auditMemory: (hash: string, revision: number) => void): PolicySettings | undefined {
    if (this.configured !== undefined) throw new Error('Read-only policy');
    const parsed = commandRules.parse(rules);
    const save = () => {
      if (this.get().revision !== revision) return undefined;
      const next = revision + 1;
      const hash = hashSql(JSON.stringify(parsed));
      if (this.db) {
        this.db.prepare('UPDATE command_policy SET revision = ?, rules = ? WHERE id = 1').run(next, JSON.stringify(parsed));
        this.db.prepare('INSERT INTO audit_events(id, action, sql_hash, status, created_at) VALUES(?,?,?,?,?)').run(randomUUID(), 'policy_changed', hash, String(next), Date.now());
      } else {
        auditMemory(hash, next);
        this.memory = { revision: next, rules: parsed };
      }
      return this.get();
    };
    return this.db ? this.db.transaction(save).immediate() : save();
  }
  close() { this.db?.close(); }
}

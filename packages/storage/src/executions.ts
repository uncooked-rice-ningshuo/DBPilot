import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from './native-database.mjs';

export type RecordedStep = { status: string; affectedRows?: number; truncated?: boolean; rolledBack?: boolean; error?: string };
export type RecordedExecution = { id: string; status: string; results: RecordedStep[]; updatedAt: number; resultAvailable: false };

export class ExecutionJournal {
  private readonly db?: Database.Database;
  private readonly memory = new Map<string, RecordedExecution>();
  constructor(dataDir?: string) {
    if (!dataDir) return;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new Database(join(dataDir, 'metadata.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS executions (id TEXT PRIMARY KEY, status TEXT NOT NULL, results TEXT NOT NULL, updated_at INTEGER NOT NULL)');
    this.db.prepare("UPDATE executions SET status = 'outcome_unknown', updated_at = ? WHERE status = 'running'").run(Date.now());
  }
  save(input: { id: string; status: string; results: RecordedStep[] }) {
    const results = input.results.map(({ status, affectedRows, truncated, rolledBack, error }) => ({ status, affectedRows, truncated, rolledBack, error }));
    if (!this.db) {
      this.memory.set(input.id, { id: input.id, status: input.status, results, updatedAt: Date.now(), resultAvailable: false });
      // Retain status evidence independently of result rows, with a bounded ephemeral journal.
      if (this.memory.size > 10000) {
        const removable = [...this.memory.values()].find(item => item.status !== 'running');
        if (removable) this.memory.delete(removable.id);
      }
      return;
    }
    this.db?.prepare('INSERT INTO executions(id,status,results,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,results=excluded.results,updated_at=excluded.updated_at')
      .run(input.id, input.status, JSON.stringify(results), Date.now());
  }
  get(id: string): RecordedExecution | undefined {
    if (!this.db) return structuredClone(this.memory.get(id));
    const row = this.db?.prepare('SELECT id,status,results,updated_at FROM executions WHERE id=?').get(id) as { id: string; status: string; results: string; updated_at: number } | undefined;
    return row && { id: row.id, status: row.status, results: (JSON.parse(row.results) as RecordedStep[]).map(step => row.status === 'outcome_unknown' && step.status === 'running' ? { ...step, status: 'outcome_unknown' } : row.status === 'outcome_unknown' && step.status === 'pending' ? { ...step, status: 'skipped' } : step), updatedAt: row.updated_at, resultAvailable: false };
  }
  close() { this.db?.close(); }
}

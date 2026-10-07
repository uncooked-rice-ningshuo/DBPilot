import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionJournal } from '../packages/storage/src/executions.js';
import { PlanStore, type StoredPlan } from '../packages/storage/src/plans.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('durable command plans', () => {
  it('prunes expired unconsumed plans while retaining execution replay records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-plan-')); dirs.push(dir);
    const journal = new ExecutionJournal(dir);
    const plans = new PlanStore(dir);
    const base: StoredPlan = { id: 'expired', connectionId: 'connection-1', connectionVersion: 1, steps: [{ sql: 'SELECT 1', kind: 'read', decision: 'ask' }], source: 'human', approved: false, consumed: false, createdAt: 1, clientRequestId: 'request-1' };
    plans.add(base);
    plans.add({ ...base, id: 'claimed', clientRequestId: 'request-2' });
    expect(plans.claim('claimed', 'execution-1')).toBe(true);
    expect(plans.pruneExpiredUnconsumed(2)).toBe(1);
    expect(plans.findByClientRequestId('request-1')).toBeUndefined();
    expect(plans.get('claimed')?.executionId).toBe('execution-1');
    plans.close(); journal.close();
  });
  it('restores approval and atomically records one execution intent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-plan-')); dirs.push(dir);
    const journal = new ExecutionJournal(dir);
    const first = new PlanStore(dir);
    const plan: StoredPlan = { id: 'plan-1', connectionId: 'connection-1', connectionVersion: 1, steps: [{ sql: 'SELECT 1', kind: 'read', decision: 'ask' }], source: 'ai', approved: false, consumed: false, createdAt: Date.now() };
    first.add(plan);
    expect(first.decide(plan.id, 'approve')).toBe(true);
    first.close();
    const reopened = new PlanStore(dir);
    expect(reopened.get(plan.id)?.approved).toBe(true);
    expect(reopened.claim(plan.id, 'execution-1')).toBe(true);
    expect(reopened.claim(plan.id, 'execution-2')).toBe(false);
    expect(reopened.get(plan.id)?.executionId).toBe('execution-1');
    expect(journal.get('execution-1')?.status).toBe('running');
    expect(journal.get('execution-2')).toBeUndefined();
    reopened.close(); journal.close();
    const afterRestart = new ExecutionJournal(dir);
    expect(afterRestart.get('execution-1')?.status).toBe('outcome_unknown');
    afterRestart.close();
  });
});

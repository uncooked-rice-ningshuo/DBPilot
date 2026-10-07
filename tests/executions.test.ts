import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionJournal } from '../packages/storage/src/executions.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('execution journal', () => {
  it('retains completed status without result rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-execution-')); dirs.push(dir);
    const first = new ExecutionJournal(dir);
    first.save({ id: 'done', status: 'succeeded', results: [{ status: 'succeeded', affectedRows: 2 }] });
    first.close();
    const second = new ExecutionJournal(dir);
    expect(second.get('done')).toMatchObject({ status: 'succeeded', results: [{ status: 'succeeded', affectedRows: 2 }], resultAvailable: false });
    second.close();
  });
  it('marks an interrupted running execution as outcome unknown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-execution-')); dirs.push(dir);
    const first = new ExecutionJournal(dir);
    first.save({ id: 'pending', status: 'running', results: [{ status: 'succeeded' }] });
    first.close();
    const second = new ExecutionJournal(dir);
    expect(second.get('pending')).toMatchObject({ status: 'outcome_unknown', results: [{ status: 'succeeded' }] });
    second.close();
  });
  it('preserves per-step uncertainty and skips steps not started after restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-execution-')); dirs.push(dir);
    const first = new ExecutionJournal(dir);
    first.save({ id: 'multi', status: 'running', results: [{ status: 'succeeded' }, { status: 'running' }, { status: 'pending' }] });
    first.close();
    const second = new ExecutionJournal(dir);
    expect(second.get('multi')?.results.map(step => step.status)).toEqual(['succeeded', 'outcome_unknown', 'skipped']);
    second.close();
  });
});

it('retains bounded in-memory status evidence without result rows and returns isolated copies', () => {
  const journal = new ExecutionJournal();
  try {
    journal.save({id:'first',status:'succeeded',results:[{status:'succeeded',affectedRows:1,rows:[['not-retained']]} as any]});
    const result=journal.get('first')!;
    expect(JSON.stringify(result)).not.toContain('not-retained');
    result.results[0].status='changed';expect(journal.get('first')?.results[0].status).toBe('succeeded');
    for(let i=0;i<10000;i++)journal.save({id:`run-${i}`,status:'succeeded',results:[]});
    expect(journal.get('first')).toBeUndefined();expect(journal.get('run-9999')?.status).toBe('succeeded');
  }finally{journal.close();}
});

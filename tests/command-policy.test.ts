import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { evaluateSqlPolicy, commandRules } from '../packages/core/src/command-policy.js';

const connectionId = randomUUID();
const context = { connectionId, engine: 'sqlite' as const, source: 'ai' as const };
const allow = { connectionId, kind: 'read' as const, decision: 'allow' as const, exactSql: 'SELECT 42' };
describe('SQL command rules', () => {
  it('defaults AI SQL to ask while preserving direct human execution', () => {
    expect(evaluateSqlPolicy('SELECT 42', context, [])[0].decision).toBe('ask');
    expect(evaluateSqlPolicy('SELECT 42', { ...context, source: 'human' }, [])[0].decision).toBe('allow');
  });
  it('limits automatic execution to an exact SQL statement on an exact connection', () => {
    expect(evaluateSqlPolicy('SELECT 42', context, [allow])[0].decision).toBe('allow');
    expect(evaluateSqlPolicy('SELECT 43', context, [allow])[0].decision).toBe('ask');
    expect(evaluateSqlPolicy('SELECT 42', { ...context, connectionId: randomUUID() }, [allow])[0].decision).toBe('ask');
    expect(commandRules.safeParse([{ ...allow, exactSql: undefined }]).success).toBe(false);
  });
  it('gives deny then ask precedence, independently of ordering and source', () => {
    const ask = { connectionId, kind: 'read' as const, decision: 'ask' as const };
    const deny = { ...ask, decision: 'deny' as const };
    expect(evaluateSqlPolicy('SELECT 42', context, [allow, ask])[0].decision).toBe('ask');
    expect(evaluateSqlPolicy('SELECT 42', context, [deny, allow, ask])[0].decision).toBe('deny');
    expect(evaluateSqlPolicy('SELECT 42', { ...context, source: 'human' }, [allow, deny])[0].decision).toBe('deny');
  });
  it('cannot allow unsupported SQL or malformed transactions, and evaluates every step', () => {
    expect(evaluateSqlPolicy('VACUUM', context, [allow])[0].decision).toBe('deny');
    expect(evaluateSqlPolicy('BEGIN; SELECT 42', context, [allow]).every(step => step.decision === 'deny')).toBe(true);
    expect(evaluateSqlPolicy('SELECT 42; SELECT 43', context, [allow]).map(step => step.decision)).toEqual(['allow', 'ask']);
  });
});

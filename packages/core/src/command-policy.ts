import { prepareSql, type SqlStep } from './sql.js';

import { commandRules, type CommandRule } from '../../protocol/src/index.js';
export { commandRules, type CommandRule };
export type PolicyTarget = { connectionId: string; engine: 'sqlite' | 'postgres' | 'mysql'; source: 'ai' | 'human' };
export function evaluateSqlPolicy(sql: string, target: PolicyTarget, rules: CommandRule[]) {
  return prepareSql(sql, target.engine).map(step => {
    if (step.decision === 'deny') return step;
    const matching = rules.filter(rule => rule.connectionId === target.connectionId && rule.kind === step.kind
      && (rule.exactSql === undefined || rule.exactSql === step.sql));
    const decision: SqlStep['decision'] = matching.some(rule => rule.decision === 'deny') ? 'deny'
      : matching.some(rule => rule.decision === 'ask') ? 'ask'
      : matching.some(rule => rule.decision === 'allow') ? 'allow'
      : target.source === 'ai' ? 'ask' : step.decision;
    return { ...step, decision };
  });
}

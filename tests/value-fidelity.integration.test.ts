import { describe, expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';

const targets = [
  { engine: 'postgres' as const, enabled: process.env.DBPILOT_TEST_POSTGRES === '1', port: 55433, database: 'postgres', user: process.env.USER ?? 'ningshuo', password: '',
    sql: "SELECT 9007199254740993::bigint AS value, '-9223372036854775808'::bigint AS value, 12345678901234567890.123456789::numeric AS amount, DATE '2026-10-07' AS day, TIMESTAMP '2026-10-07 12:34:56.123456' AS local_time, NULL AS missing, 42::int AS small" },
  { engine: 'mysql' as const, enabled: process.env.DBPILOT_TEST_MYSQL === '1', port: 55434, database: 'dbpilot_test', user: 'root', password: 'dbpilot-test-only',
    sql: "SELECT CAST(9007199254740993 AS SIGNED) AS value, CAST(-9223372036854775808 AS SIGNED) AS value, CAST(12345678901234567890.123456789 AS DECIMAL(29,9)) AS amount, CAST('2026-10-07' AS DATE) AS day, CAST('2026-10-07 12:34:56.123456' AS DATETIME(6)) AS local_time, NULL AS missing, CAST(42 AS SIGNED) AS small" }
];

for (const target of targets) describe.skipIf(!target.enabled)(`${target.engine} value fidelity`, () => {
  it.each([false, true])('preserves exact numbers and wall-clock text (transaction=%s)', async transaction => {
    const app = await createApp();
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: target.engine, host: '127.0.0.1', port: target.port, database: target.database, user: target.user, password: target.password, name: 'fidelity', ssl: false } });
      expect(created.statusCode).toBe(201);
      const plan = await app.inject({ method: 'POST', url: '/api/v1/command-plans', payload: { connectionId: created.json().id, sql: transaction ? `BEGIN; ${target.sql}; COMMIT` : target.sql, source: 'human' } });
      expect(plan.statusCode).toBe(200);
      const started = await app.inject({ method: 'POST', url: '/api/v1/executions', payload: { planId: plan.json().id } });
      const id = started.json().executionId;
      let status = 'running';
      for (let attempt = 0; attempt < 100 && status === 'running'; attempt++) {
        status = (await app.inject(`/api/v1/executions/${id}`)).json().status;
        if (status === 'running') await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(status).toBe('succeeded');
      const page = (await app.inject(`/api/v1/executions/${id}/results/${transaction ? 1 : 0}`)).json();
      expect(page.columns).toEqual(['value', 'value', 'amount', 'day', 'local_time', 'missing', 'small']);
      expect(page.rows).toEqual([['9007199254740993', '-9223372036854775808', '12345678901234567890.123456789', '2026-10-07', '2026-10-07 12:34:56.123456', null, 42]]);
    } finally { await app.close(); }
  });
});

import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
for (const engine of ['postgres', 'mysql']) it.skipIf(process.env[`DBPILOT_TEST_${engine.toUpperCase()}`] !== '1').each(['read', 'transaction', 'write', 'transaction-write'])(`${engine} connection loss does not crash the Runtime (%s)`, mode => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'tests/fixtures/connection-loss.mjs', engine, mode], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
  expect(child.status, child.stderr).toBe(0);
  expect(JSON.parse(child.stdout.trim())).toMatchObject({ status: mode === 'read' ? 'failed' : 'outcome_unknown', runtimeHealthy: true, replayed: true });
}, 15000);

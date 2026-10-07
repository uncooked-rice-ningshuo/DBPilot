import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('runtime identity', () => {
  it.each([0, -1, NaN, Infinity, 86400001, 1.5])('rejects an invalid result TTL: %s', async resultTtlMs => {
    await expect(createApp({ resultTtlMs })).rejects.toThrow('Invalid result TTL');
  });
  it.each([0, -1, 33, NaN, 1.5])('rejects an invalid concurrency limit: %s', async maxConcurrentExecutions => {
    await expect(createApp({ maxConcurrentExecutions })).rejects.toThrow('Invalid execution concurrency limit');
  });
  it.each([0, -1, 30_001, NaN, 1.5])('rejects an invalid query budget: %s', async queryTimeoutMs => {
    await expect(createApp({ queryTimeoutMs })).rejects.toThrow('Invalid query time budget');
  });
  it('persists per data directory and advertises supported capabilities', async () => {
    const firstDir = mkdtempSync(join(tmpdir(), 'dbpilot-runtime-')); dirs.push(firstDir);
    const secondDir = mkdtempSync(join(tmpdir(), 'dbpilot-runtime-')); dirs.push(secondDir);
    const first = await createApp({ dataDir: firstDir, runtimeMode: 'desktop-local' });
    const firstInfo = (await first.inject('/api/v1/runtime')).json();
    expect(firstInfo).toMatchObject({ mode: 'desktop-local', capabilities: { aiConfigured: false, transactions: { sqlite: true, postgres: true, mysql: true } } });
    await first.close();
    const reopened = await createApp({ dataDir: firstDir });
    const other = await createApp({ dataDir: secondDir });
    try {
      expect((await reopened.inject('/api/v1/runtime')).json().runtimeId).toBe(firstInfo.runtimeId);
      expect((await other.inject('/api/v1/runtime')).json().runtimeId).not.toBe(firstInfo.runtimeId);
    } finally { await reopened.close(); await other.close(); }
  });
  it('reports AI configuration without exposing the API key', async () => {
    const app = await createApp({ ai: { apiKey: 'private-test-key', model: 'test-model' } });
    try {
      const response = await app.inject('/api/v1/runtime');
      expect(response.json().capabilities.aiConfigured).toBe(true);
      expect(response.body).not.toContain('private-test-key');
    } finally { await app.close(); }
  });
});

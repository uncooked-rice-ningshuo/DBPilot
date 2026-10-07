import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('self-hosted web', () => {
  it('serves the built UI and API from one Fastify instance', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dbpilot-web-')); dirs.push(dir);
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>DBPilot test</title>');
    const app = await createApp({ webRoot: dir });
    try {
      const page = await app.inject({ method: 'GET', url: '/' });
      const runtime = await app.inject({ method: 'GET', url: '/api/v1/runtime' });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('DBPilot test');
      expect(runtime.json().protocolVersion).toBe(1);
    } finally { await app.close(); }
  });
});

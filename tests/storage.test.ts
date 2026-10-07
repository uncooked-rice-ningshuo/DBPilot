import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ConnectionStore } from '../packages/storage/src/connections.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function tempDir() { const dir = mkdtempSync(join(tmpdir(), 'dbpilot-store-')); dirs.push(dir); return dir; }

describe('connection metadata storage', () => {
  it('restores SQLite connections after restart', () => {
    const dir = tempDir();
    const first = new ConnectionStore(dir);
    const saved = first.add({ engine: 'sqlite', name: 'sample', filename: '/tmp/sample.db' });
    first.close();
    const reopened = new ConnectionStore(dir);
    expect(reopened.get(saved.id)).toEqual(saved);
    reopened.close();
  });
  it('increments version while retaining an unchanged network password', () => {
    const dir = tempDir();
    const key = randomBytes(32).toString('base64');
    const store = new ConnectionStore(dir, key);
    const original = store.add({ engine: 'postgres', name: 'one', host: 'localhost', port: 5432, database: 'app', user: 'me', password: 'secret', ssl: false });
    const updated = store.update(original.id, { engine: 'postgres', name: 'two', host: 'localhost', port: 5432, database: 'app', user: 'me', password: '', ssl: false });
    expect(updated).toMatchObject({ version: 2, name: 'two', password: 'secret' });
    store.close();
  });
  it('encrypts network passwords and refuses persistence without a key', () => {
    const dir = tempDir();
    const input = { engine: 'postgres' as const, name: 'private', host: 'localhost', port: 5432, database: 'app', user: 'me', password: 'very-secret-password', ssl: false };
    const withoutKey = new ConnectionStore(dir);
    expect(() => withoutKey.add(input)).toThrow();
    withoutKey.close();
    const key = randomBytes(32).toString('base64');
    const store = new ConnectionStore(dir, key);
    const saved = store.add(input);
    store.close();
    expect(readFileSync(join(dir, 'metadata.db')).includes(Buffer.from(input.password))).toBe(false);
    const reopened = new ConnectionStore(dir, key);
    expect(reopened.get(saved.id)).toEqual(saved);
    reopened.close();
  });
});

it('does not reuse database credentials after changing destination or transport identity', () => {
  const store = new ConnectionStore();
  const input = { engine:'postgres' as const,name:'identity',host:'db.test',port:5432,database:'app',user:'reader',password:'saved-secret',ssl:true,tlsServerName:'db.test' };
  try {
    const original=store.add(input);
    for(const change of [{host:'other.test'},{port:5433},{user:'other'},{ssl:false},{tlsServerName:'other.test'},{tlsCa:'new CA'},{ssh:{host:'jump.test',port:22,user:'jump',password:'jump-secret',hostFingerprint:'SHA256:'+'A'.repeat(43)}}]) {
      expect(store.resolveSecrets({...input,...change,password:''},original)).toMatchObject({password:''});
    }
    expect(store.resolveSecrets({...input,name:'renamed',database:'other_db',password:''},original)).toMatchObject({password:'saved-secret'});
    expect(store.resolveSecrets({...input,host:'other.test',password:'new-secret'},original)).toMatchObject({password:'new-secret'});
  }finally{store.close();}
});

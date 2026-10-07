import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import Database from '../../../packages/storage/src/native-database.mjs';

export function serverProjectRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  let directory = start;
  while (true) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'dbpilot') return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Cannot locate DBPilot project root; configure the server from its installation directory');
    directory = parent;
  }
}
const profileSchema = z.strictObject({ dataDir: z.string().trim().min(1), masterKeyFile: z.string().trim().min(1).optional() });
function workspaceRequiresOriginalKey(filename: string): boolean {
  if (!existsSync(filename)) return false;
  let db: Database.Database | undefined;
  try {
    db = new Database(filename, { readonly: true, fileMustExist: true });
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(row => row.name));
    if (tables.has('connections') && (db.prepare("SELECT count(*) AS n FROM connections WHERE coalesce(json_extract(config,'$.engine'),'') != 'sqlite'").get() as {n:number}).n) return true;
    if (tables.has('ai_settings') && (db.prepare('SELECT count(*) AS n FROM ai_settings WHERE config IS NOT NULL').get() as {n:number}).n) return true;
    return false;
  } catch { return true; } // Unreadable/unknown metadata never justifies replacing a key.
  finally { db?.close(); }
}
/** CLI startup is persistent by default; createApp() remains explicitly configurable for tests/embedding. */
export function resolveServerStorage(env: NodeJS.ProcessEnv = process.env, projectRoot = serverProjectRoot()) {
  if (env.DBPILOT_EPHEMERAL && env.DBPILOT_EPHEMERAL !== '1') throw new Error('DBPILOT_EPHEMERAL must be 1 or unset');
  if (env.DBPILOT_EPHEMERAL === '1') {
    if (env.DBPILOT_DATA_DIR || env.DBPILOT_MASTER_KEY || env.DBPILOT_MASTER_KEY_FILE) throw new Error('Ephemeral mode cannot be combined with persistent storage settings');
    return { dataDir: undefined, masterKey: undefined, persistent: false };
  }
  if (env.DBPILOT_MASTER_KEY && env.DBPILOT_MASTER_KEY_FILE) throw new Error('Set only one of DBPILOT_MASTER_KEY or DBPILOT_MASTER_KEY_FILE');
  const profileDir = join(projectRoot, '.data');
  const profileFile = join(profileDir, 'server-profile.json');
  const profile = !env.DBPILOT_DATA_DIR && existsSync(profileFile) ? profileSchema.parse(JSON.parse(readFileSync(profileFile, 'utf8'))) : undefined;
  const dataDir = env.DBPILOT_DATA_DIR ? resolve(projectRoot, env.DBPILOT_DATA_DIR) : profile ? resolve(profileDir, profile.dataDir) : join(profileDir, 'runtime');
  const configuredKeyFile = env.DBPILOT_MASTER_KEY_FILE ? resolve(projectRoot, env.DBPILOT_MASTER_KEY_FILE) : profile?.masterKeyFile ? resolve(profileDir, profile.masterKeyFile) : undefined;
  const keyFile = configuredKeyFile ?? join(dataDir, 'secrets', 'master.key');
  let masterKey = env.DBPILOT_MASTER_KEY?.trim();
  if (!masterKey) {
    if (!existsSync(keyFile)) {
      if (configuredKeyFile || workspaceRequiresOriginalKey(join(dataDir, 'metadata.db'))) throw new Error('Existing workspace or configured key file has no master key. Restore the original DBPILOT_MASTER_KEY_FILE; DBPilot will not replace a lost key.');
      mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
      const temporary = `${keyFile}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(temporary, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600, flag: 'wx' });
      try {
        try { linkSync(temporary, keyFile); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      } finally { unlinkSync(temporary); }
    }
    const stat = lstatSync(keyFile);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Master key must be a regular file');
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('Master key file permissions must restrict access to its owner (0600)');
    masterKey = readFileSync(keyFile, 'utf8').trim();
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(masterKey) || Buffer.from(masterKey, 'base64').length !== 32) throw new Error('Master key must be a base64 encoded 32-byte key');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return { dataDir, masterKey, persistent: true };
}

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { rebuild } from '@electron/rebuild';

const [targetPlatform = process.platform, targetArch = process.arch] = process.argv.slice(2);
if (targetPlatform !== process.platform || targetArch !== process.arch) throw new Error('Build desktop native dependencies on the target OS and architecture; cross-compilation is not supported.');
const require = createRequire(import.meta.url);
const electron = require('electron');
const electronVersion = require('electron/package.json').version;
const sqliteRoot = dirname(require.resolve('better-sqlite3/package.json'));
const sqliteVersion = require('better-sqlite3/package.json').version;
const abi = execFileSync(electron, ['-e', 'process.stdout.write(process.versions.modules)'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 15000
}).trim();
const destination = resolve(`dist/server/native/better-sqlite3-${sqliteVersion}/electron-${abi}-${process.platform}-${process.arch}/better_sqlite3.node`);
function verify() {
  execFileSync(electron, ['-e', `const Database = require(${JSON.stringify(require.resolve('better-sqlite3'))}); const db = new Database(':memory:', { nativeBinding: ${JSON.stringify(destination)} }); if (db.prepare('SELECT 42 AS value').get().value !== 42) process.exit(1); db.close();`], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 15000, stdio: 'pipe'
  });
}
if (existsSync(destination)) {
  verify();
  console.log(`Desktop SQLite ready: Electron ABI ${abi} / ${process.platform}-${process.arch}`);
} else {
  // Rebuild only this private copy. Root node_modules remains usable by Node.
  const staging = mkdtempSync(join(tmpdir(), 'dbpilot-native-'));
  try {
    const modulePath = join(staging, 'node_modules/better-sqlite3');
    cpSync(sqliteRoot, modulePath, { recursive: true, filter: source => !['node_modules', 'build'].includes(source.slice(sqliteRoot.length + 1).split(/[\\/]/)[0]) });
    writeFileSync(join(staging, 'package.json'), JSON.stringify({ name: 'dbpilot-native-build', version: '1.0.0', dependencies: { 'better-sqlite3': sqliteVersion } }));
    console.log(`Building isolated SQLite for Electron ${electronVersion} (${abi})...`);
    await rebuild({ buildPath: staging, electronVersion, onlyModules: ['better-sqlite3'], force: true, buildFromSource: true });
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(modulePath, 'build/Release/better_sqlite3.node'), destination);
    try { verify(); } catch (error) { rmSync(destination, { force: true }); throw error; }
    console.log(`Desktop SQLite ready: Electron ABI ${abi} / ${process.platform}-${process.arch}`);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

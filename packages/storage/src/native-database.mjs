import Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Electron and its ELECTRON_RUN_AS_NODE query children share the Electron ABI.
// Keep Node's installed addon intact; never silently fall back across ABIs.
const version = createRequire(import.meta.url)('better-sqlite3/package.json').version;
const binding = process.versions.electron
  ? fileURLToPath(new URL(`../../../native/better-sqlite3-${version}/electron-${process.versions.modules}-${process.platform}-${process.arch}/better_sqlite3.node`, import.meta.url))
  : undefined;
const NativeDatabase = binding ? new Proxy(Database, {
  construct(target, args) {
    return new target(args[0], { ...args[1], nativeBinding: binding });
  },
  apply(target, _this, args) {
    return new target(args[0], { ...args[1], nativeBinding: binding });
  }
}) : Database;
export default NativeDatabase;

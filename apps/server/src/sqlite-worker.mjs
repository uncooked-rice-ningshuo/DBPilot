import Database from '../../../packages/storage/src/native-database.mjs';
import { Worker } from 'node:worker_threads';

// A synchronous native query blocks this thread, including IPC disconnect events.
// The watchdog never loads SQLite and can stop this process independently.
const ownerPid = Number(process.env.DBPILOT_SQLITE_OWNER_PID);
if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0 || ownerPid === process.pid) process.exit(1);
const watchdog = new Worker(new URL('./sqlite-parent-watch.mjs', import.meta.url), { workerData: { ownerPid } });
const watchdogReady = new Promise((resolve, reject) => {
  watchdog.once('online', resolve);
  watchdog.once('error', reject);
});

function serialize(value) {
  if (typeof value === 'bigint') return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (value instanceof Date) return value.toISOString();
  return value;
}

let db;
const send = message => new Promise((resolve, reject) => process.send(message, error => error ? reject(error) : resolve()));
process.once('message', async workerData => {
try {
  await watchdogReady;
  db = new Database(workerData.filename, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  if (workerData.steps) {
    for (const [index, sql] of workerData.steps.entries()) {
      try {
        const result = execute(sql);
        await send({ type: 'step', index, result });
      } catch {
        let rolledBack = false;
        if (db.inTransaction) {
          try { db.exec('ROLLBACK'); rolledBack = true; } catch { /* Final transaction state unknown */ }
        }
        await send({ type: 'finish', status: 'failed', index, rolledBack });
        break;
      }
      if (index === workerData.steps.length - 1) await send({ type: 'finish', status: 'succeeded' });
    }
  } else await send(execute(workerData.sql));
} catch {
  await send(workerData.steps ? { type: 'finish', status: 'failed', index: 0, rolledBack: false } : { status: 'failed', error: 'Database command failed' });
} finally {
  db?.close();
  await watchdog.terminate();
  if (process.connected) process.disconnect();
}
});

function execute(sql) {
  if (/^BEGIN(?:\s+TRANSACTION)?$/i.test(sql.trim())) { db.exec('BEGIN'); return { status: 'succeeded' }; }
  if (/^COMMIT(?:\s+TRANSACTION)?$/i.test(sql.trim())) { db.exec('COMMIT'); return { status: 'succeeded' }; }
  if (/^ROLLBACK(?:\s+TRANSACTION)?$/i.test(sql.trim())) { db.exec('ROLLBACK'); return { status: 'succeeded' }; }
  const statement = db.prepare(sql);
  if (statement.reader) {
    const columns = statement.columns().map(column => column.name);
    const rows = [];
    let bytes = 0;
    let truncated = false;
    for (const row of statement.safeIntegers(true).raw(true).iterate()) {
      if (rows.length >= 10_000) { truncated = true; break; }
      const serialized = row.map(serialize);
      const rowBytes = Buffer.byteLength(JSON.stringify(serialized));
      if (bytes + rowBytes > 20 * 1024 * 1024) { truncated = true; break; }
      rows.push(serialized); bytes += rowBytes;
    }
    return { status: 'succeeded', columns, rows, truncated };
  } else {
    return { status: 'succeeded', affectedRows: statement.run().changes };
  }
}

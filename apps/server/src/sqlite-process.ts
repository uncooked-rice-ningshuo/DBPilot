import { fork } from 'node:child_process';

// Isolate the native SQLite addon: terminating a thread inside an addon can
// abort the hosting Runtime. Killing this worker process cannot abort its parent.
export function startSqliteWorker(input: { filename: string; sql?: string; steps?: string[] }) {
  const child = fork(new URL('./sqlite-worker.mjs', import.meta.url), [], {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'advanced',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DBPILOT_SQLITE_OWNER_PID: String(process.pid) }
  });
  child.send(input, error => { if (error) child.emit('error', error); });
  return child;
}

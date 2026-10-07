import { createApp } from '../../dist/server/apps/server/src/app.js';

let runtime;
process.parentPort.on('message', async event => {
  const message = event.data;
  if (message?.kind === 'init') {
    try {
      runtime = await createApp({ dataDir: message.dataDir, masterKey: message.masterKey, ai: message.ai, runtimeMode: 'desktop-local' });
      process.parentPort.postMessage({ id: message.id, statusCode: 200, body: { ready: true } });
    } catch (error) {
      process.parentPort.postMessage({ id: message.id, statusCode: 500, body: { error: 'Local Core failed to start', code: error?.code === 'RUNTIME_IN_USE' ? 'RUNTIME_IN_USE' : undefined } });
    }
    return;
  }
  if (!runtime || message?.kind !== 'request') return;
  try {
    const response = await runtime.inject({ method: message.method, url: message.url, payload: message.payload, headers: { host: 'localhost' } });
    process.parentPort.postMessage({ id: message.id, statusCode: response.statusCode, body: response.body ? response.json() : null });
  } catch {
    process.parentPort.postMessage({ id: message.id, statusCode: 500, body: { error: 'Local Core request failed' } });
  }
});

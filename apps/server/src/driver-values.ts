import { Client, types, type ClientConfig } from 'pg';
import mysqlRaw from 'mysql2';

// Preserve database calendar values and fractional seconds. A JS Date would
// assume a timezone for DATE/TIMESTAMP and discard precision below milliseconds.
export function createPostgresClient(config: ClientConfig) {
  const client = new Client(config);
  // Active pg queries are rejected by the driver too. A later connection-level
  // error (for example while attempting rollback) must not crash the Runtime.
  client.on('error', () => {});
  for (const oid of [types.builtins.DATE, types.builtins.TIMESTAMP, types.builtins.TIMESTAMPTZ]) {
    client.setTypeParser(oid, value => value);
  }
  return client;
}

export function createMysqlStreamingClient(config: mysqlRaw.ConnectionOptions) {
  const client = mysqlRaw.createConnection({ ...config, ...(config.ssl ? { ssl: { ...(typeof config.ssl === 'object' ? config.ssl : {}), rejectUnauthorized: true, verifyIdentity: true } } : {}) });
  // Streaming queries additionally install a scoped rejection listener. Keep a
  // listener during idle/cleanup phases where no query promise remains active.
  client.on('error', () => {});
  return client;
}

export const mysqlValueOptions = {
  supportBigNumbers: true,
  bigNumberStrings: false,
  dateStrings: true
} as const;

export async function createMysqlClient(config: mysqlRaw.ConnectionOptions) {
  const client = createMysqlStreamingClient(config);
  try { await new Promise<void>((resolve,reject)=>client.connect(error=>error?reject(error):resolve())); }
  catch(error) { client.destroy(); throw error; }
  return client.promise();
}

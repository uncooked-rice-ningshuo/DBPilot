import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMysqlStreamingClient } from '../apps/server/src/driver-values.js';
it.skipIf(process.env.DBPILOT_TEST_MYSQL_TLS !== '1')('rejects a CA-trusted MySQL certificate for the wrong server identity', async () => {
  const ca=readFileSync('/private/tmp/dbpilot-validation-mysql-ca.pem','utf8');
  const client=createMysqlStreamingClient({host:'127.0.0.1',port:55434,user:'root',password:'dbpilot-test-only',database:'dbpilot_test',ssl:{ca},connectTimeout:3000});
  try { const accepted=await client.promise().query('SELECT 1').then(()=>true,()=>false); expect(accepted).toBe(false); }
  finally { client.destroy(); }
});

import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';
import { sshFixture } from './fixtures/ssh-server.js';
it.skipIf(process.env.DBPILOT_TEST_SSH!=='1'||process.env.DBPILOT_TEST_TLS!=='1').each(['postgres','mysql'] as const)('%s preserves certificate identity through an SSH loopback tunnel',async engine=>{
  const fixture=JSON.parse(readFileSync('/private/tmp/dbpilot-tls-fixture.json','utf8'));
  const port=engine==='mysql'?fixture.mysqlPort:fixture.postgresPort;
  const ssh=await sshFixture([port]);const app=await createApp();
  const profile={engine,name:'SSH TLS',host:'127.0.0.1',port,user:engine==='mysql'?'root':'postgres',password:engine==='mysql'?'dbpilot-tls-only':'',database:engine==='mysql'?'dbpilot_test':'postgres',ssl:true,tlsCa:readFileSync(join(fixture.certs,'ca.pem'),'utf8'),tlsServerName:'dbpilot.test',ssh:{host:'127.0.0.1',port:ssh.port,user:'fixture',password:'ssh-fixture-only',hostFingerprint:ssh.fingerprint}};
  try{
    expect((await app.inject({method:'POST',url:'/api/v1/connections/test',payload:profile})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/v1/connections/test',payload:{...profile,tlsServerName:'wrong.test'}})).statusCode).toBe(502);
    expect(ssh.metrics.forwards).toBe(2);
  }finally{await app.close();await ssh.close();}
});

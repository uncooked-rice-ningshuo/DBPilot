import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import mysql from 'mysql2/promise';
import { createApp } from '../apps/server/src/app.js';
import { sshFixture } from './fixtures/ssh-server.js';
it.skipIf(process.env.DBPILOT_TEST_SSH!=='1').each(['postgres','mysql'] as const)('%s reports unknown write outcomes on SSH loss and does not reconnect or replay',async engine=>{
  const config={host:'127.0.0.1',port:engine==='postgres'?55433:55434,database:engine==='postgres'?'postgres':'dbpilot_test',user:engine==='postgres'?(process.env.USER??'ningshuo'):'root',password:engine==='postgres'?'':'dbpilot-test-only'};
  const pg=engine==='postgres'?new Client(config):undefined;await pg?.connect();
  const my=engine==='mysql'?await mysql.createConnection(config):undefined;
  const table=`ssh_fault_${randomUUID().replaceAll('-','')}`;
  const ssh=await sshFixture([config.port]);const app=await createApp();
  try{
    if(pg)await pg.query(`CREATE TABLE ${table}(value INT)`);else await my!.query(`CREATE TABLE ${table}(value INT)`);
    const connectionId=(await app.inject({method:'POST',url:'/api/v1/connections',payload:{...config,engine,name:'SSH loss',ssl:false,ssh:{host:'127.0.0.1',port:ssh.port,user:'fixture',password:'ssh-fixture-only',hostFingerprint:ssh.fingerprint}}})).json().id;
    const sql=pg?`INSERT INTO ${table} SELECT 1 FROM pg_sleep(3)`:`INSERT INTO ${table} SELECT SLEEP(3)`;
    const planId=(await app.inject({method:'POST',url:'/api/v1/command-plans',payload:{connectionId,source:'human',sql}})).json().id;
    const executionId=(await app.inject({method:'POST',url:'/api/v1/executions',payload:{planId}})).json().executionId;
    let found=false;
    for(let i=0;i<100;i++){
      const rows=pg?(await pg.query('SELECT pid FROM pg_stat_activity WHERE query=$1',[sql])).rows:(await my!.query('SELECT ID FROM INFORMATION_SCHEMA.PROCESSLIST WHERE INFO=?',[sql]))[0] as unknown[];
      if(rows.length){found=true;break;}await new Promise(r=>setTimeout(r,10));
    }
    expect(found).toBe(true);ssh.disconnect();
    let status;
    for(let i=0;i<100;i++){status=(await app.inject(`/api/v1/executions/${executionId}`)).json().status;if(status!=='running')break;await new Promise(r=>setTimeout(r,10));}
    expect(status).toBe('outcome_unknown');
    const forwards=ssh.metrics.forwards;
    const repeated=await app.inject({method:'POST',url:'/api/v1/executions',payload:{planId}});
    expect(repeated.json()).toMatchObject({executionId,replayed:true});
    expect(ssh.metrics.forwards).toBe(forwards);expect((await app.inject('/api/v1/runtime')).statusCode).toBe(200);
  }finally{
    await app.close();await ssh.close();
    if(pg){await pg.query(`DROP TABLE IF EXISTS ${table}`);await pg.end();}else if(my){await my.query(`DROP TABLE IF EXISTS ${table}`);await my.end();}
  }
},15000);

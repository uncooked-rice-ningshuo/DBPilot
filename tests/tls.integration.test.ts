import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';

it.skipIf(process.env.DBPILOT_TEST_TLS !== '1').each(['postgres','mysql'] as const)('%s validates private CA and logical server identity across test/catalog/query paths',async engine=>{
  const fixture=JSON.parse(readFileSync('/private/tmp/dbpilot-tls-fixture.json','utf8'));
  const tlsCa=readFileSync(join(fixture.certs,'ca.pem'),'utf8');
  const profile={engine,name:'TLS fixture',host:'127.0.0.1',port:engine==='mysql'?fixture.mysqlPort:fixture.postgresPort,database:engine==='mysql'?'dbpilot_test':'postgres',user:engine==='mysql'?'root':'postgres',password:engine==='mysql'?'dbpilot-tls-only':'',ssl:true,tlsCa,tlsServerName:'dbpilot.test'};
  const app=await createApp();
  try{
    const tested=await app.inject({method:'POST',url:'/api/v1/connections/test',payload:profile});
    expect(tested.statusCode).toBe(200);
    for(const patch of [{tlsCa:undefined},{tlsServerName:'wrong.test'},{tlsServerName:undefined}]){
      const failed=await app.inject({method:'POST',url:'/api/v1/connections/test',payload:{...profile,...patch}});
      expect(failed.statusCode).toBe(502);expect(failed.body).not.toContain(profile.password || 'unused-password');
    }
    const created=await app.inject({method:'POST',url:'/api/v1/connections',payload:profile});expect(created.statusCode).toBe(201);
    const id=created.json().id;
    expect((await app.inject(`/api/v1/connections/${id}/databases`)).statusCode).toBe(200);
    expect((await app.inject(`/api/v1/connections/${id}/tables`)).statusCode).toBe(200);
    const plan=await app.inject({method:'POST',url:'/api/v1/command-plans',payload:{connectionId:id,source:'human',sql:'SELECT 73 AS value'}});
    const started=await app.inject({method:'POST',url:'/api/v1/executions',payload:{planId:plan.json().id}});
    expect(started.statusCode).toBe(202);
    let state;
    for(let i=0;i<100;i++){state=(await app.inject(`/api/v1/executions/${started.json().executionId}`)).json();if(state.status!=='running')break;await new Promise(r=>setTimeout(r,20));}
    expect(state.status).toBe('succeeded');
    expect((await app.inject(`/api/v1/executions/${started.json().executionId}/results/0`)).json().rows).toEqual([[73]]);
  }finally{await app.close();}
},20000);

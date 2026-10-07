import { expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
import { sshFixture } from './fixtures/ssh-server.js';

it.skipIf(process.env.DBPILOT_TEST_SSH!=='1').each(['postgres','mysql'] as const)('%s uses a pinned real SSH tunnel and rejects changed host keys before authentication',async engine=>{
  const port=engine==='mysql'?55434:55433;
  const ssh=await sshFixture([port]);
  const profile={engine,name:'SSH fixture',host:'127.0.0.1',port,database:engine==='mysql'?'dbpilot_test':'postgres',user:engine==='mysql'?'root':(process.env.USER??'ningshuo'),password:engine==='mysql'?'dbpilot-test-only':'',ssl:false,ssh:{host:'127.0.0.1',port:ssh.port,user:'fixture',password:'ssh-fixture-only',hostFingerprint:ssh.fingerprint}};
  const app=await createApp();
  try{
    expect((await app.inject({method:'POST',url:'/api/v1/connections/test',payload:profile})).statusCode).toBe(200);
    expect(ssh.metrics.forwards).toBeGreaterThan(0);
    const before=ssh.metrics.authentications;
    const mismatch=await app.inject({method:'POST',url:'/api/v1/connections/test',payload:{...profile,ssh:{...profile.ssh,hostFingerprint:'SHA256:'+'A'.repeat(43)}}});
    expect(mismatch.statusCode).toBe(502);expect(mismatch.body).toContain('指纹');expect(ssh.metrics.authentications).toBe(before);
    const auth=await app.inject({method:'POST',url:'/api/v1/connections/test',payload:{...profile,ssh:{...profile.ssh,password:'wrong'}}});
    expect(auth.statusCode).toBe(502);expect(auth.body).not.toContain('wrong');
    const created=await app.inject({method:'POST',url:'/api/v1/connections',payload:profile});expect(created.statusCode).toBe(201);expect(created.body).not.toContain('ssh-fixture-only');
    const id=created.json().id;
    expect((await app.inject(`/api/v1/connections/${id}/databases`)).statusCode).toBe(200);
    expect((await app.inject(`/api/v1/connections/${id}/tables`)).statusCode).toBe(200);
    const plan=(await app.inject({method:'POST',url:'/api/v1/command-plans',payload:{connectionId:id,source:'human',sql:'SELECT 91 AS value'}})).json();
    const started=(await app.inject({method:'POST',url:'/api/v1/executions',payload:{planId:plan.id}})).json();
    let state;for(let i=0;i<100;i++){state=(await app.inject(`/api/v1/executions/${started.executionId}`)).json();if(state.status!=='running')break;await new Promise(r=>setTimeout(r,20));}
    expect(state.status).toBe('succeeded');expect((await app.inject(`/api/v1/executions/${started.executionId}/results/0`)).json().rows).toEqual([[91]]);
  }finally{await app.close();await ssh.close();}
},20000);

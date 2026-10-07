import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectionStore } from '../packages/storage/src/connections.js';
import { createApp } from '../apps/server/src/app.js';

const profile={engine:'mysql' as const,name:'ssh',host:'127.0.0.1',port:3306,database:'test',user:'fixture',password:'database-secret',ssl:false,ssh:{host:'bastion.test',port:22,user:'fixture',password:'ssh-secret',hostFingerprint:'SHA256:'+'A'.repeat(43)}};
it('encrypts SSH passwords and preserves blank secrets only for an unchanged bastion identity',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dbpilot-ssh-secrets-')),key=randomBytes(32).toString('base64');
  let store=new ConnectionStore(dir,key);
  try{
    const first=store.add(profile);store.close();
    expect(readFileSync(join(dir,'metadata.db')).includes(Buffer.from('ssh-secret'))).toBe(false);
    store=new ConnectionStore(dir,key);expect(store.get(first.id)?.engine).toBe('mysql');
    const preserved=store.update(first.id,{...profile,password:'',ssh:{...profile.ssh,password:''}});
    expect(preserved?.engine!=='sqlite' && preserved?.ssh?.password).toBe('ssh-secret');
    const changed=store.update(first.id,{...profile,ssh:{...profile.ssh,password:'',host:'different.test'}});
    expect(changed?.engine!=='sqlite' && changed?.ssh?.password).toBe('');
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
it('never returns SSH credentials in public connection DTOs and rejects unpinned input',async()=>{
  const app=await createApp();
  try{
    const created=await app.inject({method:'POST',url:'/api/v1/connections',payload:profile});expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain('ssh-secret');expect(created.body).not.toContain('database-secret');expect(created.json().ssh.hasPassword).toBe(true);
    const list=await app.inject('/api/v1/connections');expect(list.body).not.toContain('ssh-secret');
    for(const hostFingerprint of ['',undefined,'auto','SHA256:short'])expect((await app.inject({method:'POST',url:'/api/v1/connections',payload:{...profile,ssh:{...profile.ssh,hostFingerprint}}})).statusCode).toBe(400);
  }finally{await app.close();}
});

// Run: node --import tsx scripts/validation/ssh-ui.mjs
import { createApp } from '../../dist/server/apps/server/src/app.js';
import { sshFixture } from '../../tests/fixtures/ssh-server.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const dir=mkdtempSync(join(tmpdir(),'dbpilot-ssh-ui-'));
const ssh=await sshFixture([55434]);
const app=await createApp({dataDir:dir,masterKey:randomBytes(32).toString('base64'),webRoot:resolve('dist/web')});
await app.inject({method:'POST',url:'/api/v1/connections',payload:{engine:'mysql',name:'SSH MySQL 验证',host:'127.0.0.1',port:55434,database:'dbpilot_test',user:'root',password:'dbpilot-test-only',ssl:false,ssh:{host:'127.0.0.1',port:ssh.port,user:'fixture',password:'ssh-fixture-only',hostFingerprint:ssh.fingerprint}}});
writeFileSync('/private/tmp/dbpilot-ssh-ui.json',JSON.stringify({port:ssh.port,fingerprint:ssh.fingerprint}),{mode:0o600});
await app.listen({host:'127.0.0.1',port:3140});console.log('SSH UI fixture: http://127.0.0.1:3140');
async function close(){await app.close();await ssh.close();rmSync(dir,{recursive:true,force:true});rmSync('/private/tmp/dbpilot-ssh-ui.json',{force:true});process.exit(0);}
process.once('SIGTERM',close);process.once('SIGINT',close);

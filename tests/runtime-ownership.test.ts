import { expect,it } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../apps/server/src/app.js';
it('rejects a second Runtime on the same data directory before recovering its Agent records',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-owner-'));let app=await createApp({dataDir:dir});
 try{
  let rejected=false;
  try{const duplicate=await createApp({dataDir:dir});await duplicate.close();}catch(error){rejected=(error as Error).message.includes('already in use');}
  expect(rejected).toBe(true);
  const runtimeId=(await app.inject('/api/v1/runtime')).json().runtimeId;
  await app.close();app=await createApp({dataDir:dir});
  expect((await app.inject('/api/v1/runtime')).json().runtimeId).toBe(runtimeId);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

it('releases ownership and open stores after a startup error',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-owner-failed-'));
 try{await expect(createApp({dataDir:dir,webRoot:join(dir,'missing-web')})).rejects.toThrow('Web build not found');const app=await createApp({dataDir:dir});await app.close();}finally{rmSync(dir,{recursive:true,force:true});}
});

it('refuses a live external owner and recovers only after that process exits',async()=>{
 const {spawn}=await import('node:child_process');const {pathToFileURL}=await import('node:url');const {resolve}=await import('node:path');const {RuntimeLease}=await import('../packages/storage/src/runtime-lease.js');
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-owner-process-'));
 const source=`import {RuntimeLease} from ${JSON.stringify(pathToFileURL(resolve('packages/storage/src/runtime-lease.ts')).href)};new RuntimeLease(${JSON.stringify(dir)});console.log('READY');setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source],{stdio:['ignore','pipe','pipe']});
 let output='';const exited=new Promise<void>(done=>child.once('exit',()=>done()));
 try{
  await new Promise<void>((done,reject)=>{const timer=setTimeout(()=>reject(Error('owner startup timeout: '+output)),10000);child.stdout.on('data',data=>{output+=data;if(output.includes('READY')){clearTimeout(timer);done();}});child.stderr.on('data',data=>{output+=data;});child.once('error',reject);});
  expect(()=>new RuntimeLease(dir)).toThrow('already in use');
  child.kill('SIGKILL');await exited;
  const recovered=new RuntimeLease(dir);recovered.close();
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}rmSync(dir,{recursive:true,force:true});}
},15000);

import {expect,it} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import Database from 'better-sqlite3';
function alive(pid:number){try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}}
it('terminates a busy SQLite worker after its owning Runtime process disappears',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-sqlite-owner-'));const filename=join(dir,'db');const db=new Database(filename);db.exec('CREATE TABLE sample(value INTEGER)');db.close();
 const source=`import {startSqliteWorker} from ${JSON.stringify(pathToFileURL(resolve('apps/server/src/sqlite-process.ts')).href)};const child=startSqliteWorker({filename:${JSON.stringify(filename)},sql:'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<500000000) SELECT sum(x) FROM n'});process.send({pid:child.pid});setInterval(()=>{},1000);`;
 const owner=spawn(process.execPath,['--import','tsx','--input-type=module','-e',source],{stdio:['ignore','ignore','ignore','ipc']});let workerPid=0;const exited=new Promise<void>(done=>owner.once('exit',()=>done()));
 try{
  workerPid=await new Promise<number>((done,reject)=>{const timer=setTimeout(()=>reject(Error('worker not started')),5000);owner.once('message',(message:any)=>{clearTimeout(timer);done(message.pid);});owner.once('error',reject);});
  await new Promise(r=>setTimeout(r,200));expect(alive(workerPid)).toBe(true);owner.kill('SIGKILL');await exited;
  for(let i=0;i<30&&alive(workerPid);i++)await new Promise(r=>setTimeout(r,100));
  expect(alive(workerPid)).toBe(false);
 }finally{if(workerPid&&alive(workerPid))process.kill(workerPid,'SIGKILL');if(owner.exitCode===null&&owner.signalCode===null){owner.kill('SIGKILL');await exited;}rmSync(dir,{recursive:true,force:true});}
},10000);

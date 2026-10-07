import {expect,it} from 'vitest';
import {execFile,execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {createServer,type Server} from 'node:https';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createApp} from '../apps/server/src/app.js';
it.skipIf(process.env.DBPILOT_TEST_DESKTOP!=='1')('real Electron HTTPS Remote validates CA and server identity before replacing the active workspace',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-https-'));const servers:Server[]=[];let remote:Awaited<ReturnType<typeof createApp>>|undefined;
 const openssl=(args:string[])=>execFileSync('openssl',args,{cwd:dir,stdio:'pipe',timeout:10000});
 try{
  openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem','-days','1','-subj','/CN=DBPilot HTTPS Fixture']);
  openssl(['req','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=localhost']);
  for(const name of ['valid','wrong']){
   writeFileSync(join(dir,`${name}.ext`),`subjectAltName=${name==='valid'?'IP:127.0.0.1':'DNS:wrong.invalid'}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`);
   openssl(['x509','-req','-in','server.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-out',`${name}.pem`,'-days','1','-extfile',`${name}.ext`]);
  }
  remote=await createApp();const runtimeId=(await remote.inject('/api/v1/runtime')).json().runtimeId;
  const urls:string[]=[];const hits=[0,0];
  for(const [index,name] of ['valid','wrong'].entries()){
   const server=createServer({key:readFileSync(join(dir,'server.key')),cert:readFileSync(join(dir,`${name}.pem`))},async(req,res)=>{
    hits[index]++;const response=await remote!.inject({method:'GET',url:req.url!,headers:{host:'127.0.0.1'}});res.writeHead(response.statusCode,{'content-type':'application/json'});res.end(response.body);
   });servers.push(server);await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));urls.push(`https://127.0.0.1:${(server.address() as {port:number}).port}`);
  }
  async function exercise(trusted:boolean){
   const userDir=join(dir,trusted?'trusted':'untrusted');const entry=join(dir,trusted?'trusted.mjs':'untrusted.mjs');
   const script=`(async()=>{const api=window.dbpilotDesktop;const local=(await api['runtime.info']({})).body.runtimeId;let rejected=false;try{await api.setTarget({kind:'remote',baseUrl:${JSON.stringify(urls[0])}});}catch{rejected=true;}
    if(${trusted}){if(rejected||(await api.getTarget()).runtimeId!==${JSON.stringify(runtimeId)})throw Error('Trusted certificate rejected');let mismatch=false;try{await api.setTarget({kind:'remote',baseUrl:${JSON.stringify(urls[1])}});}catch{mismatch=true;}if(!mismatch||(await api.getTarget()).runtimeId!==${JSON.stringify(runtimeId)}||(await api['runtime.info']({})).body.runtimeId!==${JSON.stringify(runtimeId)})throw Error('Hostname mismatch replaced current target');}
    else{if(!rejected||(await api.getTarget()).kind!=='local'||(await api['runtime.info']({})).body.runtimeId!==local)throw Error('Untrusted CA accepted or replaced local target');}
    return 'DBPILOT_HTTPS_READY';})()`;
   writeFileSync(entry,`import {app} from 'electron';app.setPath('userData',${JSON.stringify(userDir)});app.on('browser-window-created',(_event,window)=>window.webContents.once('did-finish-load',async()=>{try{console.log(await window.webContents.executeJavaScript(${JSON.stringify(script)}));}catch(e){console.log('FAILED: '+e.message);}finally{app.quit();}}));await import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/main.mjs')).href)});`);
   const env:NodeJS.ProcessEnv={...process.env,DBPILOT_DESKTOP_DATA_DIR:userDir};for(const key of ['ELECTRON_RUN_AS_NODE','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS','DEEPSEEK_API_KEY','DEEPSEEK_MODEL','DEEPSEEK_BASE_URL'])delete env[key];if(trusted)env.NODE_EXTRA_CA_CERTS=join(dir,'ca.pem');
   const executable=createRequire(import.meta.url)('electron') as string;
   const output=await new Promise<string>((done,reject)=>execFile(executable,[entry],{env,timeout:20000},(error,stdout)=>error?reject(error):done(stdout)));
   expect(output).toContain('DBPILOT_HTTPS_READY');
  }
  await exercise(false);expect(hits).toEqual([0,0]);await exercise(true);expect(hits[0]).toBeGreaterThan(0);expect(hits[1]).toBe(0);
 }finally{for(const server of servers){server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}await remote?.close();rmSync(dir,{recursive:true,force:true});}
},50000);

import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

it.skipIf(process.env.DBPILOT_TEST_DESKTOP !== '1')('persists Agent tools, todos and history through real Electron IPC and Local Core restart', async () => {
  const dir=mkdtempSync(join(tmpdir(),'dbpilot-desktop-agent-'));
  let modelCalls=0;
  const model=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body);modelCalls++;
    const calls=input.messages.filter((m:{role:string})=>m.role==='assistant').flatMap((m:{tool_calls?:unknown[]})=>m.tool_calls??[]);
    const tool=(name:string,args:unknown)=>({role:'assistant',tool_calls:[{id:`tool-${calls.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
    const message=calls.length===0?tool('update_todo',{items:[{id:'help',text:'Read command help',status:'in_progress'}]}):calls.length===1?tool('command_reference',{command:'ls'}):calls.length===2?tool('update_todo',{items:[{id:'help',text:'Read command help',status:'completed'}]}):{role:'assistant',content:'Reference only; no shell was executed.'};
    if(calls.length>=3){
      res.setHeader('content-type','text/event-stream');
      res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'Reference only; '},finish_reason:null}]})}\n\n`);
      setTimeout(()=>res.end(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'no shell was executed.'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`),350);
    }else{res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message}]}));}
  });
  await new Promise<void>(done=>model.listen(0,'127.0.0.1',done));
  const port=(model.address() as {port:number}).port;
  const run=async(restart:boolean)=>{
    const exercise=`(async()=>{
      const api=window.dbpilotDesktop;
      const call=async(op,input={})=>{const r=await api[op](input);if(r.statusCode>=400)throw Error(op+':'+JSON.stringify(r.body));return r.body;};
      const runtime=await call('runtime.info');
      const list=await call('ai.list');
      if(!list.persistent)throw Error('Not persistent');
      let id;
      if(${restart}){if(list.runs.length!==1)throw Error('History missing');id=list.runs[0].id;}
      else {if(list.runs.length)throw Error('Not isolated');id=(await call('ai.start',{body:{runtimeId:runtime.runtimeId,mode:'suggest',allowedConnectionIds:[],clientRequestId:crypto.randomUUID(),request:'Show ls help'}})).id;}
      let partial=false;
      for(let i=0;i<200;i++){
        const snapshot=await call('ai.get',{id});
        if(snapshot.status==='running' && snapshot.answer)partial=true;
        if(snapshot.status==='succeeded'){
          if(!${restart} && !partial)throw Error('No partial stream observed');
          if(snapshot.todos?.[0]?.status!=='completed')throw Error('Todo missing');
          if(!snapshot.activity.some(a=>a.tool==='command_reference'&&a.result.data.executed===false))throw Error('Reference evidence missing');
          return 'DBPILOT_AGENT_READY';
        }
        if(snapshot.status!=='running')throw Error('Agent failed: '+JSON.stringify(snapshot));
        await new Promise(r=>setTimeout(r,25));
      }
      throw Error('Agent timed out');
    })()`;
    const entry=join(dir,'entry.mjs');
    writeFileSync(entry,`import { app } from 'electron';
app.setPath('userData',${JSON.stringify(dir)});
app.on('browser-window-created',(_event,window)=>{window.webContents.once('did-finish-load',async()=>{try{console.log(await window.webContents.executeJavaScript(${JSON.stringify(exercise)}));}catch(error){console.log('AGENT_FAILED: '+error.message);}finally{app.quit();}});});
await import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/main.mjs')).href)});`);
    const env: NodeJS.ProcessEnv={...process.env,DBPILOT_DESKTOP_DATA_DIR:join(dir,'runtime'),DEEPSEEK_API_KEY:'fixture-only',DEEPSEEK_MODEL:'fixture-only',DEEPSEEK_BASE_URL:`http://127.0.0.1:${port}`};
    delete env.ELECTRON_RUN_AS_NODE;
    const executable=createRequire(import.meta.url)('electron') as string;
    const output=await new Promise<string>((done,reject)=>execFile(executable,[entry],{env,timeout:25000},(error,stdout)=>error?reject(error):done(stdout)));
    expect(output).toContain('DBPILOT_AGENT_READY');
  };
  try{await run(false);expect(modelCalls).toBe(4);await run(true);expect(modelCalls).toBe(4);}
  finally{await new Promise<void>((done,reject)=>model.close(error=>error?reject(error):done()));rmSync(dir,{recursive:true,force:true});}
},60000);

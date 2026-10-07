import { expect,it } from 'vitest';
import { createServer } from 'node:http';
import { agentCompletion } from '../packages/ai-core/src/deepseek.js';
it('finishes a real HTTP SSE response at DONE and releases the still-open transport',async()=>{
 let closed!:()=>void;const disconnected=new Promise<void>(done=>{closed=done;});let requests=0;
 const server=createServer((_req,res)=>{requests++;res.on('close',closed);res.writeHead(200,{'content-type':'text/event-stream'});res.write(`data: ${JSON.stringify({choices:[{index:0,delta:{content:'complete'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 try{
  const result=await agentCompletion({config:{apiKey:'fixture-only',model:'fixture',baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`},signal:AbortSignal.timeout(2000),messages:[{role:'user',content:'test'}],tools:[]});
  expect(result.content).toBe('complete');expect(requests).toBe(1);
  await Promise.race([disconnected,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('transport not released')),1500);timer.unref();})]);
 }finally{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});

import { expect, it } from 'vitest';
import { readCompletion } from '../packages/ai-core/src/completion-stream.js';
import { AgentRun } from '../packages/ai-core/src/agent.js';
import { createAgentTools } from '../packages/ai-core/src/tools.js';
import { randomUUID } from 'node:crypto';
const frame=(delta:unknown,finish_reason:string|null=null)=>`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason}]})}\r\n\r\n`;
function response(text:string,step=11){
  const bytes=new TextEncoder().encode(text);let index=0;
  return new Response(new ReadableStream({pull(controller){if(index===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(index,index+step));index=Math.min(bytes.length,index+step);}}),{headers:{'content-type':'text/event-stream'}});
}
it('assembles split UTF-8 frames and exposes partial text before completion',async()=>{
  const pieces:string[]=[];
  const result=await readCompletion(response(': keepalive\r\n\r\n'+frame({role:'assistant',content:'你'})+frame({content:'好'})+frame({},'stop')+'data: [DONE]\r\n\r\n',1),new AbortController().signal,text=>pieces.push(text));
  expect(result).toEqual({role:'assistant',content:'你好'});expect(pieces).toEqual(['你','你好']);
});
it('assembles ordered tool fragments without executing partial arguments',async()=>{
  const result=await readCompletion(response(frame({tool_calls:[{index:0,id:'call-1',type:'function',function:{name:'command_reference',arguments:'{"command":'}}]})+frame({tool_calls:[{index:0,function:{arguments:'"ls"}'}}]},'tool_calls')+'data: [DONE]\n\n'),new AbortController().signal);
  expect(result.tool_calls).toEqual([{id:'call-1',type:'function',function:{name:'command_reference',arguments:'{"command":"ls"}'}}]);
});
it('rejects truncated, malformed, over-budget, and unfinished streams',async()=>{
  for(const text of [frame({content:'partial'}),frame({},'length')+'data: [DONE]\n\n',frame({},'stop'),frame({tool_calls:[{index:0,id:'x',function:{name:'ls',arguments:'{}'}}]},'stop')+'data: [DONE]\n\n',frame({content:'x'.repeat(16001)},'stop')+'data: [DONE]\n\n','data: invalid\n\n']){
    await expect(readCompletion(response(text,1000),new AbortController().signal)).rejects.toThrow();
  }
});
it('accepts a single non-streaming response but rejects provider truncation',async()=>{
  const message={role:'assistant',content:'done'};
  expect(await readCompletion(new Response(JSON.stringify({choices:[{message,finish_reason:'stop'}]})),new AbortController().signal)).toEqual(message);
  await expect(readCompletion(new Response(JSON.stringify({choices:[{message,finish_reason:'length'}]})),new AbortController().signal)).rejects.toThrow('truncated');
});
it('cancels a stalled stream promptly on abort',async()=>{
  const controller=new AbortController();let cancelled=false;
  const task=readCompletion(new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}}),controller.signal);
  controller.abort(new Error('cancelled'));
  await expect(task).rejects.toThrow('cancelled');expect(cancelled).toBe(true);
});
it('stops the Agent without dispatch when a tool stream ends before DONE',async()=>{
  let dispatched=0;
  const runtimeId=randomUUID(),controller=new AbortController();
  const tools=createAgentTools({runtimeId,mode:'execute',allowedConnectionIds:[],signal:controller.signal,invoke:async()=>{dispatched++;return {statusCode:200,body:[]};}});
  const run=new AgentRun({runtimeId,mode:'execute',request:'test',controller,tools,complete:async(_messages,signal,onText)=>readCompletion(response(frame({tool_calls:[{index:0,id:'call',function:{name:'list_connections',arguments:'{}'}}]},'tool_calls')),signal,onText)});
  await run.start();expect(run.snapshot().status).toBe('failed');expect(dispatched).toBe(0);
});

it('finishes at the provider DONE marker even if the transport remains open', async () => {
  let cancelled=false;
  const source=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(frame({content:'finished'},'stop')+'data: [DONE]\n\n'));},cancel(){cancelled=true;}});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new Error('transport remained open')),100);
  try{expect(await readCompletion(new Response(source,{headers:{'content-type':'text/event-stream'}}),controller.signal)).toEqual({role:'assistant',content:'finished'});expect(cancelled).toBe(true);}finally{clearTimeout(timer);}
});

it('rejects contradictory JSON finish reasons before exposing callable tools',async()=>{
  const message={role:'assistant',tool_calls:[{id:'call',type:'function',function:{name:'list_connections',arguments:'{}'}}]};
  await expect(readCompletion(new Response(JSON.stringify({choices:[{message,finish_reason:'stop'}]})),new AbortController().signal)).rejects.toThrow();
  await expect(readCompletion(new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'done'},finish_reason:'tool_calls'}]})),new AbortController().signal)).rejects.toThrow();
});

it('rejects invalid UTF-8 rather than silently replacing bytes in model output',async()=>{
 const prefix=new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"');
 const suffix=new TextEncoder().encode('"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
 const bytes=new Uint8Array([...prefix,0xff,...suffix]);
 await expect(readCompletion(new Response(bytes,{headers:{'content-type':'text/event-stream'}}),new AbortController().signal)).rejects.toThrow();
});

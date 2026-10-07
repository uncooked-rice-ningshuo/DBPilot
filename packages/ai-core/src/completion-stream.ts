import { z } from 'zod';
import { assistantMessageSchema, type AssistantMessage } from './agent.js';

const chunkSchema = z.object({ choices: z.array(z.object({
  index: z.number().int(), finish_reason: z.string().nullable().optional(),
  delta: z.object({ content: z.string().nullable().optional(), role: z.literal('assistant').optional(),
    tool_calls: z.array(z.object({ index:z.number().int().min(0).max(7), id:z.string().max(128).optional(), type:z.literal('function').optional(), function:z.object({name:z.string().max(100).optional(),arguments:z.string().max(20000).optional()}).optional() })).max(8).optional(),
  }),
})).max(1) });

/** Assemble an entire provider message before returning any callable tool. */
export async function readCompletion(response: Response, signal: AbortSignal, onText?: (text: string) => void): Promise<AssistantMessage> {
  if (!response.body) throw new Error('Missing model response');
  const reader=response.body.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
  const streaming=response.headers.get('content-type')?.toLowerCase().includes('text/event-stream');
  let bytes=0, buffer='', content='', finished:string|undefined, done=false;
  const calls = new Map<number,{id:string;type:'function';function:{name:string;arguments:string}}>();
  const cancel=()=>{ void reader.cancel(signal.reason).catch(()=>{}); };
  signal.addEventListener('abort',cancel,{once:true});
  const event=(raw:string)=>{
    const data=raw.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if (!data) return;
    if (done) throw new Error('Data after stream completion');
    if (data==='[DONE]') { done=true; return; }
    const chunk=chunkSchema.parse(JSON.parse(data));
    for(const choice of chunk.choices){
      if(choice.index!==0 || finished) throw new Error('Unexpected model choice');
      if(choice.delta.content){
        content+=choice.delta.content;
        if(content.length>16000) throw new Error('Model content exceeds budget');
        onText?.(content);
      }
      for(const part of choice.delta.tool_calls??[]){
        const call=calls.get(part.index)??{id:'',type:'function' as const,function:{name:'',arguments:''}};
        call.id+=part.id??'';call.function.name+=part.function?.name??'';call.function.arguments+=part.function?.arguments??'';
        if(call.id.length>128||call.function.name.length>100||call.function.arguments.length>20000) throw new Error('Tool stream exceeds budget');
        calls.set(part.index,call);
      }
      if(choice.finish_reason){
        if(!['stop','tool_calls'].includes(choice.finish_reason)) throw new Error('Model output was truncated or rejected');
        finished=choice.finish_reason;
      }
    }
  };
  try {
    while(true){
      signal.throwIfAborted();
      const chunk=await reader.read();
      signal.throwIfAborted();
      if(chunk.done)break;
      bytes+=chunk.value.byteLength;
      if(bytes>(streaming ? 1024 * 1024 : 128000))throw new Error('Model response exceeds budget');
      buffer+=decoder.decode(chunk.value,{stream:true});
      if(streaming){
        let match:RegExpExecArray|null;
        while((match=/\r?\n\r?\n/.exec(buffer))){const raw=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);event(raw);}
        if(done)break;
      }
    }
    buffer+=decoder.decode();
    if(!streaming){
      const result=z.object({choices:z.array(z.object({message:assistantMessageSchema,finish_reason:z.string().nullable().optional()})).length(1)}).parse(JSON.parse(buffer)).choices[0];
      if(result.finish_reason && !['stop','tool_calls'].includes(result.finish_reason))throw new Error('Model output was truncated or rejected');
      if(result.finish_reason && !!result.message.tool_calls?.length !== (result.finish_reason === 'tool_calls'))throw new Error('Contradictory model finish reason');
      return result.message;
    }
    if(buffer.trim())event(buffer);
    if(!done || !finished || (calls.size>0)!==(finished==='tool_calls'))throw new Error('Incomplete model stream');
    const toolCalls=[...calls].sort(([a],[b])=>a-b);
    if(toolCalls.some(([index],position)=>index!==position))throw new Error('Missing tool stream fragment');
    return assistantMessageSchema.parse({role:'assistant',content:content||null,...(calls.size?{tool_calls:toolCalls.map(([,call])=>call)}:{})});
  } finally {signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

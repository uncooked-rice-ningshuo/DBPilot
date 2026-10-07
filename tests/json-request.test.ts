import {expect,it,vi} from 'vitest';
import {requestRuntimeJson,runtimeRequestTimeoutMs} from '../packages/runtime-client/src/json-request.js';
it('bounds a stalled POST without retrying or claiming the operation was cancelled',async()=>{
 const fetchImpl=vi.fn((_url,init)=>new Promise<Response>((_done,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))) as unknown as typeof fetch;
 await expect(requestRuntimeJson('/api/v1/ai/runs',{method:'POST',body:'{}'},{fetchImpl,timeoutMs:10})).rejects.toMatchObject({code:'RUNTIME_TIMEOUT'});expect(fetchImpl).toHaveBeenCalledTimes(1);
});
it('keeps the deadline active while the JSON body is still arriving',async()=>{
 const fetchImpl:typeof fetch=async(_url,init)=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));init?.signal?.addEventListener('abort',()=>controller.error(new Error('aborted')),{once:true});}}),{status:200});
 await expect(requestRuntimeJson('/api/v1/runtime',{}, {fetchImpl,timeoutMs:10})).rejects.toMatchObject({code:'RUNTIME_TIMEOUT'});
});
it('retains caller cancellation and distinguishes malformed success from HTTP errors',async()=>{
 const controller=new AbortController();const error=new Error('caller stopped');
 const fetchImpl:typeof fetch=async(_url,init)=>new Promise((_done,reject)=>init?.signal?.addEventListener('abort',()=>reject(error),{once:true}));
 const pending=requestRuntimeJson('/api/v1/runtime',{signal:controller.signal},{fetchImpl});controller.abort();await expect(pending).rejects.toBe(error);
 await expect(requestRuntimeJson('/api/v1/runtime',{}, {fetchImpl:async()=>new Response('{')})).rejects.toMatchObject({code:'RUNTIME_PROTOCOL'});
 expect(await requestRuntimeJson('/api/v1/runtime',{}, {fetchImpl:async()=>new Response('bad gateway',{status:502})})).toEqual({statusCode:502,body:null});
 expect(await requestRuntimeJson('/api/v1/connections/id',{method:'DELETE'}, {fetchImpl:async()=>new Response(null,{status:204})})).toEqual({statusCode:204,body:null});
});
it('allows the 60-second model probe to finish within the transport budget',()=>{
 expect(runtimeRequestTimeoutMs('/api/v1/ai/test')).toBe(70000);expect(runtimeRequestTimeoutMs('https://localhost/api/v1/ai/test')).toBe(70000);expect(runtimeRequestTimeoutMs('/api/v1/runtime')).toBe(35000);
});

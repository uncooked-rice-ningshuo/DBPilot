import { expect, it } from 'vitest';
import { createApp } from '../apps/server/src/app.js';
const input={provider:'deepseek' as const,baseUrl:'https://api.deepseek.com',model:'fixture',apiKey:'private-fixture-key'};
it('tests actual model tool support without saving config, exposing keys or sending database data',async()=>{
  let calls=0;
  const app=await createApp({aiFetch:async(_url,init)=>{
    calls++;const body=JSON.parse(String(init?.body));
    expect(body.messages).toHaveLength(2);expect(JSON.stringify(body)).not.toContain(input.apiKey);
    expect(body.tool_choice).toEqual({type:'function',function:{name:'dbpilot_probe'}});
    expect(body.tools).toHaveLength(1);expect(body.stream).toBe(true);
    return new Response(JSON.stringify({choices:[{message:{role:'assistant',tool_calls:[{id:'probe',type:'function',function:{name:'dbpilot_probe',arguments:'{"ok":true}'}}]},finish_reason:'tool_calls'}]}));
  }});
  try{
    const result=await app.inject({method:'POST',url:'/api/v1/ai/test',payload:input});
    expect(result.statusCode).toBe(200);expect(result.json()).toEqual({model:'fixture',toolCalling:true});
    expect(calls).toBe(1);expect((await app.inject('/api/v1/ai/settings')).json().configured).toBe(false);
    expect((await app.inject('/api/v1/ai/runs')).json().runs).toEqual([]);
  }finally{await app.close();}
});
it('reports safe provider errors and rejects unsupported tool responses',async()=>{
  for(const status of [200,401,429,404,500]){
    const app=await createApp({aiFetch:async()=>new Response(status===200?JSON.stringify({choices:[{message:{role:'assistant',content:'hello'}}]}):input.apiKey,{status})});
    try{
      const result=await app.inject({method:'POST',url:'/api/v1/ai/test',payload:input});
      expect(result.statusCode).toBe(502);expect(result.body).not.toContain(input.apiKey);
      expect(result.json().error).toContain(({200:'工具',401:'认证',429:'限流',404:'不存在',500:'HTTP 500'} as Record<number,string>)[status]);
    }finally{await app.close();}
  }
});
it('does not forward a saved key to a different probe target and validates sources',async()=>{
  let calls=0;const app=await createApp({ai:{...input},aiFetch:async()=>{calls++;throw Error(input.apiKey);}});
  try{
    expect((await app.inject({method:'POST',url:'/api/v1/ai/test',payload:{provider:input.provider,baseUrl:'https://another.example',model:input.model}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/v1/ai/test',headers:{origin:'https://evil.example'},payload:input})).statusCode).toBe(403);
    expect(calls).toBe(0);
    const result=await app.inject({method:'POST',url:'/api/v1/ai/test',payload:input});
    expect(result.statusCode).toBe(502);expect(result.body).not.toContain(input.apiKey);
  }finally{await app.close();}
});

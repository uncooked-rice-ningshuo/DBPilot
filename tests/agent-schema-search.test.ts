import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../apps/server/src/app.js';
import {createAgentTools} from '../packages/ai-core/src/tools.js';
import {routeForDesktopOperation} from '../packages/runtime-client/src/desktop-operations.js';
it('searches beyond the old schema cap and loads columns only for the selected table',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dbpilot-agent-schema-'));const filename=join(dir,'db');const db=new Database(filename);
 db.transaction(()=>{for(let i=0;i<2105;i++)db.exec(`CREATE TABLE t_${String(i).padStart(4,'0')} (value INTEGER)`);})();db.close();
 const app=await createApp();let columnRequests=0;
 try{
  const runtimeId=(await app.inject('/api/v1/runtime')).json().runtimeId;
  const connectionId=(await app.inject({method:'POST',url:'/api/v1/connections',payload:{engine:'sqlite',name:'large',filename}})).json().id;
  const tools=createAgentTools({runtimeId,mode:'suggest',allowedConnectionIds:[connectionId],signal:new AbortController().signal,invoke:async(operation,input)=>{if(operation==='connections.schema')columnRequests++;const route=routeForDesktopOperation(operation,input);const r=await app.inject({...route,payload:route.payload as Record<string,unknown>});return {statusCode:r.statusCode,body:r.json()};}});
  let cursor:string|undefined;let found:any;let scans=0;
  do{const result=await tools.execute(String(scans++),'search_schema',{runtimeId,connectionId,database:'main',search:'2104',cursor});expect(result.ok).toBe(true);const data=(result as any).data;found=data.tables.find((t:any)=>t.name==='t_2104')??found;cursor=data.nextCursor;}while(cursor&&scans<5);
  expect(found).toMatchObject({schema:'main',name:'t_2104',columns:[]});expect(columnRequests).toBe(0);
  const detail=await tools.execute('detail','describe_table',{runtimeId,connectionId,database:'main',schema:'main',table:'t_2104'});
  expect(detail).toMatchObject({ok:true,data:{tables:[{name:'t_2104',columns:[{name:'value',type:'INTEGER',nullable:true}]}]}});expect(columnRequests).toBe(1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});

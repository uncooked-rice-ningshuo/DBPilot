import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {createApp} from '../../dist/server/apps/server/src/app.js';
const {chromium}=await import(process.env.DBPILOT_PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'dbpilot-expiry-ui-'));const filename=join(dir,'db');new Database(filename).close();let modelCalls=0;
const app=await createApp({webRoot:resolve('dist/web'),resultTtlMs:4000,ai:{apiKey:'fixture-only',model:'fixture'},aiFetch:async()=>{modelCalls++;return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'Unexpected model call'}}]}));}});let browser;
try{
 const connection=(await app.inject({method:'POST',url:'/api/v1/connections',payload:{engine:'sqlite',name:'Expiry fixture',filename}})).json();
 const url=await app.listen({host:'127.0.0.1',port:0});browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1200,height:800}});
 await page.goto(url);await page.getByText('临时存储',{exact:true}).waitFor();await page.getByRole('button',{name:'Expiry fixture SQLite',exact:true}).click();await page.getByRole('button',{name:'打开 SQL 控制台',exact:true}).first().click();
 await page.getByRole('button',{name:'执行 SQL',exact:true}).click();await page.getByRole('region',{name:'查询结果表格'}).getByRole('cell',{name:'1',exact:true}).last().waitFor();
 const entries=(await app.inject(`/api/v1/executions?connectionId=${connection.id}`)).json();assert.equal(entries.length,1);
 await new Promise(r=>setTimeout(r,4100));
 const result=page.waitForResponse(r=>r.url().endsWith('/ai/runs')&&r.request().method()==='POST');
 await page.getByRole('button',{name:'新对话分析当前结果',exact:true}).click();assert.equal((await result).status(),410);
 await page.waitForTimeout(150);
 assert.equal(await page.getByRole('button',{name:'新对话分析当前结果',exact:true}).count(),0,'expired result remains offered to AI');
 assert.ok((await page.locator('.result-note').innerText()).includes('不会自动重跑'));
 assert.equal((await app.inject(`/api/v1/executions?connectionId=${connection.id}`)).json().length,1);assert.equal(modelCalls,0);
 console.log('Expired selected result removed from AI input; no model call or SQL replay.');
}finally{if(browser)await browser.close();await app.close();rmSync(dir,{recursive:true,force:true});}

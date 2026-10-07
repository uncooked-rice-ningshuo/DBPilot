import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../../dist/server/apps/server/src/app.js';
const {chromium}=await import(process.env.DBPILOT_PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'dbpilot-history-ui-'));let modelCalls=0;
const app=await createApp({dataDir:dir,webRoot:resolve('dist/web'),ai:{apiKey:'fixture-only',model:'fixture'},aiFetch:async()=>{modelCalls++;return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'Retained history answer'}}]}));}});let browser;
try{
 const runtimeId=(await app.inject('/api/v1/runtime')).json().runtimeId;
 const {id}=(await app.inject({method:'POST',url:'/api/v1/ai/runs',payload:{runtimeId,clientRequestId:randomUUID(),mode:'suggest',allowedConnectionIds:[],request:'Retained history question'}})).json();
 for(let i=0;i<100;i++){const run=(await app.inject(`/api/v1/ai/runs/${id}`)).json();if(run.status==='succeeded')break;if(i===99)throw Error('Fixture timeout');await new Promise(r=>setTimeout(r,10));}
 const url=await app.listen({host:'127.0.0.1',port:0});browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1200,height:800}});
 await page.goto(url);await page.getByText('持久保存',{exact:true}).waitFor();
 await page.route('**/api/v1/ai/runs',route=>process.argv[2]==='timeout'?undefined:route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture unavailable'})}),{times:1});
 await page.getByRole('button',{name:'对话历史',exact:true}).click();await page.getByRole('alert').filter({hasText:'读取对话历史失败'}).waitFor({timeout:45000});
 if(process.argv[2]==='timeout')assert.ok((await page.getByRole('alert').filter({hasText:'读取对话历史失败'}).innerText()).includes('请求超时'));
 assert.equal(await page.getByText('仅保存在当前运行期间。',{exact:true}).count(),0);assert.equal(await page.getByText('暂无对话。',{exact:true}).count(),0);
 await page.getByRole('button',{name:'刷新历史',exact:true}).click();await page.getByText('保存在当前 Runtime，重启后可恢复。',{exact:true}).waitFor();
 await page.getByRole('button',{name:/Retained history question/}).click();await page.getByText('Retained history answer',{exact:true}).waitFor();
 await page.reload();await page.getByText('Retained history answer',{exact:true}).waitFor();assert.equal(modelCalls,1);
 console.log('History read failure is explicit; refresh and page reload restore the saved answer without another model call.');
}finally{if(browser)await browser.close();await app.close();rmSync(dir,{recursive:true,force:true});}

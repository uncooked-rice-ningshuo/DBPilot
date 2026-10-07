import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import Database from 'better-sqlite3';
import {createApp} from '../../dist/server/apps/server/src/app.js';
const {chromium}=await import(process.env.DBPILOT_PLAYWRIGHT_MODULE||'playwright');const dir=mkdtempSync(join(tmpdir(),'dbpilot-cancel-race-'));const filename=join(dir,'db');new Database(filename).close();const app=await createApp({webRoot:resolve('dist/web')});let browser;let release;
try{
 const connection=(await app.inject({method:'POST',url:'/api/v1/connections',payload:{engine:'sqlite',name:'Cancel fixture',filename}})).json();const ids=[];
 for(const value of [101,202]){const plan=(await app.inject({method:'POST',url:'/api/v1/command-plans',payload:{connectionId:connection.id,source:'human',sql:`SELECT ${value} AS value`}})).json();const id=(await app.inject({method:'POST',url:'/api/v1/executions',payload:{planId:plan.id}})).json().executionId;ids.push(id);for(let i=0;i<100;i++){if((await app.inject(`/api/v1/executions/${id}`)).json().status==='succeeded')break;await new Promise(r=>setTimeout(r,20));}}
 const url=await app.listen({host:'127.0.0.1',port:0});browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1200,height:800}});
 await page.route(`**/executions/${ids[0]}`,async route=>{const response=await route.fetch();const state=await response.json();await route.fulfill({json:{...state,status:'running'}});},{times:1});
 let intercepted;const ready=new Promise(r=>intercepted=r);const held=new Promise(r=>release=r);let fulfilled;const completed=new Promise(r=>fulfilled=r);
 await page.route(`**/executions/${ids[0]}/cancel`,async route=>{const response=await route.fetch();assert.deepEqual(await response.json(),{status:'succeeded',accepted:false});intercepted();await held;await route.fulfill({response});fulfilled();});
 await page.goto(url);await page.getByRole('button',{name:'Cancel fixture SQLite',exact:true}).click();await page.getByRole('button',{name:'打开 SQL 控制台',exact:true}).first().click();await page.getByRole('tab',{name:/执行记录/}).click();await page.locator('.history-entry').filter({hasText:'SELECT 101 AS value'}).click();
 await page.getByRole('tab',{name:/SQL 编辑/}).click();await page.getByRole('button',{name:'取消执行',exact:true}).click();await ready;
 if(process.argv[2]==='switch'){await page.getByRole('tab',{name:/执行记录/}).click();await page.locator('.history-entry').filter({hasText:'SELECT 202 AS value'}).click();await page.getByRole('region',{name:'查询结果表格'}).getByRole('cell',{name:'202',exact:true}).waitFor();}
 release();await completed;await page.waitForTimeout(150);assert.equal(await page.locator('.data-meta').getByText('成功',{exact:true}).count(),1,'late cancel response overwrote completed execution');
 const value=process.argv[2]==='switch'?'202':'101';assert.equal(await page.getByRole('region',{name:'查询结果表格'}).getByRole('cell',{name:value,exact:true}).count(),1);assert.equal((await app.inject(`/api/v1/executions?connectionId=${connection.id}`)).json().length,2);
 console.log('Late cancellation preserves the completed or newly selected execution; no SQL replay.');
}finally{release?.();if(browser)await browser.close();await app.close();rmSync(dir,{recursive:true,force:true});}

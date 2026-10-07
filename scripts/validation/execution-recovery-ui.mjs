import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {createApp} from '../../dist/server/apps/server/src/app.js';
const {chromium}=await import(process.env.DBPILOT_PLAYWRIGHT_MODULE||'playwright');
const dir=mkdtempSync(join(tmpdir(),'dbpilot-execution-recovery-'));const filename=join(dir,'db');const fixture=new Database(filename);fixture.exec('CREATE TABLE sample(value INTEGER)');fixture.close();const app=await createApp({webRoot:resolve('dist/web')});let browser;
try{
 const connection=(await app.inject({method:'POST',url:'/api/v1/connections',payload:{engine:'sqlite',name:'Recovery fixture',filename}})).json();
 const url=await app.listen({host:'127.0.0.1',port:0});browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1200,height:800}});
 await page.goto(url);await page.getByRole('button',{name:'Recovery fixture SQLite',exact:true}).click();await page.getByRole('button',{name:'打开 SQL 控制台',exact:true}).first().click();
 if(process.argv.includes('write')){await page.locator('.monaco-editor textarea').focus();await page.keyboard.press(process.platform==='darwin'?'Meta+A':'Control+A');await page.keyboard.insertText('INSERT INTO sample(value) VALUES (1) RETURNING value;');}
 await page.route('**/events?afterSeq=*',route=>process.argv.includes('timeout')?undefined:route.abort());
 await page.route(/\/api\/v1\/executions\/[^/?]+$/,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture offline'})}),{times:1});
 await page.getByRole('button',{name:'执行 SQL',exact:true}).click();await page.getByText(/状态读取中断/).first().waitFor({timeout:45000});
 await page.locator('.monaco-editor textarea').focus();await page.keyboard.press(process.platform==='darwin'?'Meta+Enter':'Control+Enter');await page.waitForTimeout(150);
 assert.equal((await app.inject(`/api/v1/executions?connectionId=${connection.id}`)).json().length,1,'keyboard bypassed active execution guard');
 await page.getByRole('button',{name:'刷新执行状态',exact:true}).click();await page.getByRole('region',{name:'查询结果表格'}).getByRole('cell',{name:'1',exact:true}).last().waitFor();
 assert.equal((await app.inject(`/api/v1/executions?connectionId=${connection.id}`)).json().length,1);
 assert.equal(await page.locator('.execution-read-warning').count(),0);assert.equal(await page.getByRole('button',{name:'执行 SQL',exact:true}).isEnabled(),true);
 if(process.argv.includes('write')){const check=new Database(filename,{readonly:true});try{assert.equal(check.prepare('SELECT count(*) AS n FROM sample').get().n,1,'write repeated');}finally{check.close();}}
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'mobile layout overflow');
 console.log('Interrupted execution status recovered through GET only; SQL execution count remains one.');
}finally{if(browser)await browser.close();await app.close();rmSync(dir,{recursive:true,force:true});}

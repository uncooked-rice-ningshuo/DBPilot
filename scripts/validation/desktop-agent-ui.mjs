import Database from 'better-sqlite3';
// DBPILOT_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/validation/desktop-agent-ui.mjs [packaged-executable]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createApp } from '../../dist/server/apps/server/src/app.js';
const { _electron: electron } = await import(process.env.DBPILOT_PLAYWRIGHT_MODULE || 'playwright');
const dir=mkdtempSync(join(tmpdir(),'dbpilot-agent-ui-desktop-'));
const filename=join(dir,'fixture.db');const db=new Database(filename);db.exec('CREATE TABLE sample(value INTEGER); INSERT INTO sample VALUES(42)');db.close();
let requests=0;let executionTarget;
function reply(input){
  requests++;
  const call=(name,args)=>({role:'assistant',tool_calls:[{id:`fixture-${requests}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  if(input.tool_choice)return call('dbpilot_probe',{ok:true});
  if(input.messages.at(-1)?.content==='Markdown demo')return {role:'assistant',content:'## SQL\n\n```sql\nSELECT 42 AS answer;\n```'};
  const previous=input.messages.filter(m=>m.role==='assistant').flatMap(m=>m.tool_calls??[]);
  if(input.messages.some(m=>m.role==='user'&&m.content==='Execution demo')){
    if(!previous.length)return call('propose_sql',{...executionTarget,sql:'SELECT 42 AS answer'});
    if(previous.at(-1).function.name==='propose_sql')return call('execute_plan',{...executionTarget,planId:JSON.parse(input.messages.at(-1).content).data.planId});
    return {role:'assistant',content:'Execution snapshot ready.'};
  }
  if(input.messages.some(m=>m.role==='system'&&m.content?.startsWith('User selected this existing snapshot:')))return previous.length?{role:'assistant',content:'Selected snapshot analysis; no SQL replay.'}:call('get_selected_result',{});
  if(input.messages.some(m=>m.role==='user'&&m.content==='连接草稿演示'))return previous.length?{role:'assistant',content:'请核对连接草稿，尚未建立连接。'}:call('request_connection',{engine:'postgres',name:'Desktop 草稿',host:'127.0.0.1',port:55433,database:'postgres',user:'reader'});
  if(previous.length===0)return call('update_todo',{items:[{id:'help',text:'查看命令说明',status:'in_progress'}]});
  if(previous.length===1)return call('command_reference',{command:'ls'});
  if(previous.length===2)return call('update_todo',{items:[{id:'help',text:'查看命令说明',status:'completed'}]});
  return {role:'assistant',content:'ls -lah 列出目录内容。这里只提供固定说明，没有执行 Shell。'};
}
const model=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:reply(JSON.parse(body))}]}));});
await new Promise(done=>model.listen(0,'127.0.0.1',done));
const modelUrl=`http://127.0.0.1:${model.address().port}`;
const remote=await createApp({dataDir:join(dir,'remote'),masterKey:Buffer.alloc(32,7).toString('base64'),ai:{apiKey:'fixture-only',model:'fixture',baseUrl:modelUrl}});
remote.addHook('onResponse',async(request,reply)=>{if(request.url.includes('/approvals/')||request.url.endsWith('/resume'))console.log('fixture decision',request.url,reply.statusCode);});
const remoteUrl=await remote.listen({host:'127.0.0.1',port:0});
const env={...process.env,DBPILOT_DESKTOP_DATA_DIR:join(dir,'local'),DEEPSEEK_API_KEY:'fixture-only',DEEPSEEK_MODEL:'fixture',DEEPSEEK_BASE_URL:modelUrl};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
  app=await electron.launch({executablePath:process.argv[2]?resolve(process.argv[2]):createRequire(import.meta.url)('electron'),args:process.argv[2]?[]:[resolve('.')],env,timeout:30000});
  const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');
  mkdirSync('output/playwright',{recursive:true});
  for(const mode of ['local','remote']){
    if(mode==='remote'){await page.evaluate(async baseUrl=>window.dbpilotDesktop.setTarget({kind:'remote',baseUrl}),remoteUrl);await page.reload();}
    await page.getByText('持久保存',{exact:true}).waitFor();
    await page.getByRole('textbox',{name:'发送给 AI 助手'}).fill('待办演示');
    await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.getByText('ls -lah 列出目录内容。这里只提供固定说明，没有执行 Shell。',{exact:true}).waitFor();
    assert.equal(await page.getByRole('region',{name:'任务待办'}).getByText('已完成',{exact:true}).count(),1);
    const boxes=await page.evaluate(()=>{const u=document.querySelector('.chat-bubble.user').getBoundingClientRect();const a=document.querySelector('.chat-bubble.assistant').getBoundingClientRect();return{ux:u.x,ax:a.x,uw:u.width,aw:a.width,cw:document.querySelector('.chat-scroll').clientWidth};});
    assert.ok(boxes.ux>boxes.ax&&boxes.uw<boxes.cw&&boxes.aw<boxes.cw);
    await page.getByRole('button',{name:'命令规则',exact:true}).click();
    const drawer=await page.getByRole('dialog').boundingBox();const size=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));
    assert.ok(Math.abs(drawer.x+drawer.width-size.w)<2&&drawer.height>=size.h-2);
    await page.keyboard.press('Escape');await page.getByRole('button',{name:'新对话',exact:true}).click();
    assert.ok(await page.getByRole('textbox',{name:'发送给 AI 助手'}).evaluate(el=>el===document.activeElement));
    await page.getByRole('textbox',{name:'发送给 AI 助手'}).fill('连接草稿演示');await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.getByRole('button',{name:'查看连接草稿',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'连接名称',exact:true}).inputValue(),'Desktop 草稿');
    assert.equal(await page.getByRole('textbox',{name:'密码',exact:true}).inputValue(),'');
    assert.ok(await page.getByRole('checkbox',{name:'启用 TLS'}).isChecked());
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.getByRole('button',{name:'对话历史',exact:true}).click();
    await page.getByRole('dialog').getByText('待办演示',{exact:true}).waitFor();
    await page.screenshot({path:`output/playwright/desktop-agent-${mode}.png`});
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'新对话',exact:true}).click();
    await page.getByRole('textbox',{name:'发送给 AI 助手'}).fill('Markdown demo');await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.getByRole('button',{name:'复制代码',exact:true}).click();
    await page.getByText('代码已复制，尚未执行。',{exact:true}).waitFor();
    assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'SELECT 42 AS answer;');
    assert.equal(await page.evaluate(async()=>{try{await window.dbpilotDesktop.copyText('x'.repeat(16001));return false;}catch{return true;}}),true);
    assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'SELECT 42 AS answer;');
    await page.evaluate(async filename=>{const r=await window.dbpilotDesktop['connections.create']({body:{engine:'sqlite',name:'Desktop results',filename}});if(r.statusCode!==201)throw Error('fixture connection failed');},filename);
    await page.reload();
    await page.getByRole('button',{name:'Desktop results SQLite',exact:true}).click();
    await page.getByRole('button',{name:'打开 SQL 控制台',exact:true}).first().click();
    await page.getByRole('button',{name:'执行 SQL',exact:true}).click();
    await page.getByRole('button',{name:'新对话分析当前结果',exact:true}).click();
    await page.getByText('Selected snapshot analysis; no SQL replay.',{exact:true}).waitFor();
    await page.screenshot({path:`output/playwright/desktop-agent-analysis-${mode}.png`});
    executionTarget=await page.evaluate(async()=>{const runtime=await window.dbpilotDesktop['runtime.info']({});const connections=await window.dbpilotDesktop['connections.list']({});return {runtimeId:runtime.body.runtimeId,connectionId:connections.body.find(c=>c.name==='Desktop results').id};});
    await page.getByRole('button',{name:'新对话',exact:true}).click();
    await page.getByRole('combobox',{name:'Agent 模式'}).click();await page.getByRole('option',{name:'执行模式',exact:true}).click();
    await page.getByRole('textbox',{name:'发送给 AI 助手'}).fill('Execution demo');await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.getByRole('region',{name:'确认 Agent 数据库操作'}).waitFor();
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.getByRole('button',{name:'展开 AI 对话',exact:true}).click();
    assert.equal(await page.locator('.center-pane').isVisible(),false);
    await page.screenshot({path:`output/playwright/desktop-agent-inline-approval-${mode}.png`});
    await page.getByRole('button',{name:'确认执行以上 SQL',exact:true}).click();
    await page.getByText('Execution snapshot ready.',{exact:true}).waitFor();
    const countBefore=await page.evaluate(async connectionId=>(await window.dbpilotDesktop['executions.list']({id:connectionId})).body.length,executionTarget.connectionId);
    await page.getByRole('button',{name:'查看执行结果',exact:true}).click();
    await page.getByRole('cell',{name:'42',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'恢复工作区布局',exact:true}).count(),0);
    const countAfter=await page.evaluate(async connectionId=>(await window.dbpilotDesktop['executions.list']({id:connectionId})).body.length,executionTarget.connectionId);
    assert.equal(countBefore,countAfter);
    await page.screenshot({path:`output/playwright/desktop-agent-grid-${mode}.png`});
    await page.getByRole('button',{name:'新对话',exact:true}).click();
    await page.getByRole('textbox',{name:'发送给 AI 助手'}).fill('Execution demo');await page.getByRole('button',{name:'发送',exact:true}).click();
    await page.getByRole('button',{name:'拒绝并停止',exact:true}).click();
    await page.locator('.agent-progress').getByText('已取消',{exact:true}).waitFor();
    assert.equal(await page.getByRole('region',{name:'确认 Agent 数据库操作'}).count(),0);
    assert.equal(await page.evaluate(async connectionId=>(await window.dbpilotDesktop['executions.list']({id:connectionId})).body.length,executionTarget.connectionId),countAfter);
    console.log(`${mode}: bubbles, todos, rule drawer, new-chat focus, connection draft, history, Markdown copy and selected result passed`);
  }
}catch(error){if(app){const page=await app.firstWindow();console.error(await page.locator('.chat-pane').innerText());await page.screenshot({path:'output/playwright/desktop-agent-failure.png'});}throw error;}finally{if(app)await app.close();await remote.close();await new Promise(done=>model.close(done));rmSync(dir,{recursive:true,force:true});}

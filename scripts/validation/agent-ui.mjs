// Isolated browser-validation fixture. Simulated model, real temporary SQLite.
// Run after pnpm build; never uses saved user connections or model credentials.
import { createApp } from '../../dist/server/apps/server/src/app.js';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'dbpilot-agent-ui-'));
const filename = join(dir, 'validation.db');
new Database(filename).close();
let target;
const aiFetch = async (_url, init) => {
  const { messages, tool_choice } = JSON.parse(init.body);
  if (tool_choice?.function?.name === 'dbpilot_probe') return new Response(JSON.stringify({ choices:[{message:{role:'assistant',tool_calls:[{id:'probe',type:'function',function:{name:'dbpilot_probe',arguments:'{"ok":true}'}}]},finish_reason:'tool_calls'}] }));
  const last = messages.at(-1);
  if (last.role === 'user' && last.content === '流式演示') {
    const parts = ['这是', '逐步返回的', '模拟模型回答。', '没有执行', '任何数据库操作。'];
    let index = 0, timer;
    return new Response(new ReadableStream({
      start(controller) {
        const send = () => {
          if (index < parts.length) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: parts[index++] }, finish_reason: null }] })}\n\n`)); timer = setTimeout(send, 600); }
          else { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`)); controller.close(); }
        }; send();
      },
      cancel() { clearTimeout(timer); },
    }), { headers: { 'content-type': 'text/event-stream' } });
  }
  const previousCalls = messages.filter(message => message.role === 'assistant').flatMap(message => message.tool_calls ?? []);
  const call = (name, args) => ({ role: 'assistant', content: null, tool_calls: [{ id: `call-${previousCalls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const data = last.role === 'tool' ? JSON.parse(last.content).data : undefined;
  let message;
  const todoDemo = messages.some(item => item.role === 'user' && item.content === '待办演示');
  if (last.role === 'user' && last.content === '\u6392\u7248\u6f14\u793a') {
    message = {role:'assistant',content:'## SQL \u793a\u4f8b\n\n- \u5148\u68c0\u67e5\u76ee\u6807\n- \u8fd9\u91cc\u6ca1\u6709\u6267\u884c SQL\n\n```sql\nSELECT 42 AS answer;\n```\n\n| \u5b57\u6bb5 | \u503c |\n| --- | --- |\n| answer | 42 |\n\n![remote](https://tracking.invalid/pixel)\n\n<script>window.injected=true</script>\n\n[x](javascript:alert%281%29)'};
  }
  else if (messages.some(item => item.role === 'system' && item.content?.startsWith('User selected this existing snapshot:'))) {
    message = !previousCalls.length ? call('get_selected_result', {}) : { role: 'assistant', content: `Selected snapshot: ${JSON.stringify(data.rows)}; no SQL was replayed.` };
  }
  else if (messages.some(item => item.role === 'user' && item.content === '连接草稿演示')) {
    message = !previousCalls.length ? call('request_connection', { engine: 'postgres', name: 'Agent 连接草稿', host: '127.0.0.1', port: 55433, database: 'postgres', user: process.env.USER }) : { role: 'assistant', content: '连接草稿已准备，请核对表单并填写凭据。保存后开始新对话；当前没有建立连接或执行SQL。' };
  }
  else if (todoDemo) {
    const tool = previousCalls.at(-1)?.function.name;
    if (!tool) message = call('update_todo', { items: [{ id: 'help', text: '查看 ls 命令说明', status: 'in_progress' }] });
    else if (tool === 'update_todo' && previousCalls.length === 1) message = call('command_reference', { command: 'ls' });
    else if (tool === 'command_reference') message = call('update_todo', { items: [{ id: 'help', text: '查看 ls 命令说明', status: 'completed' }] });
    else message = { role: 'assistant', content: 'ls -lah 用于列出目录内容；此处仅提供说明，没有执行 Shell 或读取文件。' };
  }
  else if (last.role === 'user' && last.content === 'Explain previous result') message = { role: 'assistant', content: messages.some(item => item.content?.includes('Prior conversation reference') && item.content.includes('42')) ? 'Previous result was 42; no SQL was executed in this followup.' : 'No prior result in context.' };
  else if (!previousCalls.length) message = call('list_connections', {});
  else if (previousCalls.at(-1).function.name === 'list_connections') message = call('propose_sql', { ...target, sql: 'SELECT 42 AS answer' });
  else if (previousCalls.at(-1).function.name === 'propose_sql') message = messages[0].content.includes('Mode: suggest.') ? { role: 'assistant', content: '已生成 SQL 建议，尚未执行。' } : call('execute_plan', { ...target, planId: data.planId });
  else if (previousCalls.at(-1).function.name === 'execute_plan') message = call('get_result', { ...target, executionId: data.executionId, setId: 0 });
  else message = { role: 'assistant', content: `SQLite 实际返回：${JSON.stringify(data.rows)}。这是模拟模型的 UI 验证结果。` };
  return new Response(JSON.stringify({ choices: [{ message }] }));
};
const app = await createApp({ dataDir: dir, masterKey: randomBytes(32).toString('base64'), webRoot: resolve('dist/web'), ai: { apiKey: 'fixture-only', model: 'fixture-only' }, aiFetch });
const runtimeId = (await app.inject('/api/v1/runtime')).json().runtimeId;
const connectionId = (await app.inject({ method: 'POST', url: '/api/v1/connections', payload: { engine: 'sqlite', name: 'Agent 验证库', filename } })).json().id;
target = { runtimeId, connectionId };
await app.listen({ host: '127.0.0.1', port: 3139 });
console.log('Agent UI fixture: http://127.0.0.1:3139 (simulated model, temporary SQLite)');
async function close() { await app.close(); rmSync(dir, { recursive: true, force: true }); process.exit(0); }
process.once('SIGINT', close); process.once('SIGTERM', close);

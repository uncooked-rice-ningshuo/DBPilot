import { MarkdownMessage } from '@ui/components/markdown-message';
import { agentSnapshot, agentConnectionDraft, type AgentConnectionDraft, type AgentResultSource } from '../../protocol/src/index.js';
import { AgentHistory } from './AgentHistory';
import { pollAgent } from '../../runtime-client/src/agent-poll.js';
import { notify } from '@ui/notify';
import { AppIcon } from '@ui/icons';
import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@ui/components/button';
import { Textarea } from '@ui/components/textarea';
import { Badge } from '@ui/components/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/components/select';
import type { AgentSnapshot } from '../../ai-core/src/agent.js';

type Connection = { id: string; name: string; engine: string };
type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
const statusNames = { running: '处理中', cancelling: '正在取消，请等待', awaiting_approval: '等待确认', succeeded: '已完成', failed: '已停止，请核对', cancelled: '已取消' };
const toolNames: Record<string, string> = { describe_table: '\u8bfb\u53d6\u5355\u8868\u5b57\u6bb5', get_selected_result: '\u8bfb\u53d6\u6240\u9009\u7ed3\u679c\u5feb\u7167', request_connection: '填写连接草稿', update_todo: '更新待办', command_reference: '命令参考', list_databases: '发现数据库', list_connections: '发现连接', connect_database: '测试连接', search_schema: '检索表结构', propose_sql: '生成 SQL 计划', execute_plan: '执行计划', get_result: '读取结果', get_execution_status: '查看执行状态', cancel_query: '取消查询' };
const kindNames: Record<string, string> = { read: '读取', write: '修改数据', schema: '修改结构', transaction: '事务控制', unknown: '不支持' };
export function AgentPanel({ runtimeId, configured, connections, selectedId, api, onDraft, onActiveChange, onConnectionDraft, onViewExecution, onResultExpired, expanded, onToggleExpanded, selectedResult, children, settings }: {
  runtimeId: string; configured: boolean; connections: Connection[]; selectedId: string; api: Api;
  expanded: boolean; onToggleExpanded: () => void;
  selectedResult?: AgentResultSource;
  onResultExpired: (source: AgentResultSource) => void;
  onConnectionDraft: (draft: AgentConnectionDraft) => void;
  onViewExecution: (executionId: string, connectionId: string) => void;
  onDraft: (sql: string, connectionId: string, database?: string) => void; onActiveChange: (active: boolean) => void; children?: React.ReactNode; settings?: React.ReactNode;
}) {
  const [mode, setMode] = useState<'suggest' | 'execute'>('suggest');
  const [scope, setScope] = useState('all');
  const [request, setRequest] = useState('');
  const [run, setRun] = useState<AgentSnapshot>();
  const [watchId, setWatchId] = useState<string>();
  const [missingRun, setMissingRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pollGeneration, setPollGeneration] = useState(0);
  const [connectionWarning, setConnectionWarning] = useState('');
  const setError = notify.error;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const followLatest = useRef(true);
  const pendingRequest = useRef<{ signature: string; id: string } | undefined>(undefined);
  const active = !missingRun && (!!watchId && !run || !!run && ['running', 'awaiting_approval', 'cancelling'].includes(run.status));
  const pending = run?.pendingApproval;
  const target = connections.find(connection => connection.id === pending?.connectionId);
  useEffect(() => {
    if (followLatest.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [run?.id, run?.answer, run?.activity.length, run?.status]);
  useEffect(() => { onActiveChange(!!active); }, [active, onActiveChange]);
  useEffect(() => {
    if (!runtimeId) return;
    setRun(undefined); setMissingRun(false); setConnectionWarning('');
    setWatchId(sessionStorage.getItem(`dbpilot-agent-${runtimeId}`) ?? undefined);
  }, [runtimeId]);
  useEffect(() => { if (run?.error) notify.error(run.error, { id: `agent:${run.id}`, title: 'AI 任务已停止，请核对' }); }, [run?.id, run?.error]);
  useEffect(() => {
    if (!watchId) return;
    return pollAgent({
      read: async () => agentSnapshot.parse(await api(`/ai/runs/${watchId}`)),
      onSnapshot: next => { setRun(next); setMode(next.mode); setMissingRun(false); setConnectionWarning(''); },
      onUnavailable: (error, retrying) => {
        const unavailable = [404, 410].includes((error as { status?: number })?.status ?? 0);
        if (unavailable) { setMissingRun(true); }
        setConnectionWarning(unavailable ? '任务已不可恢复，请核对执行历史后开始新对话。不会重放 SQL。' : retrying ? '连接暂时中断，正在重新读取任务状态…' : '暂时无法读取任务状态。请恢复连接后刷新状态，勿重复执行写入。');
      },
    });
  }, [watchId, api, pollGeneration]);
  function newConversation() {
    setWatchId(undefined); setMissingRun(false); setRun(undefined); setConnectionWarning(''); setError(''); setRequest(''); pendingRequest.current = undefined;
    sessionStorage.removeItem(`dbpilot-agent-${runtimeId}`);
    followLatest.current = true; queueMicrotask(() => inputRef.current?.focus());
  }
  function openConversation(id: string) {
    followLatest.current = true;
    setRun(undefined); setMissingRun(false); setConnectionWarning('');
    setWatchId(id); setPollGeneration(value => value + 1);
    sessionStorage.setItem(`dbpilot-agent-${runtimeId}`, id);
    pendingRequest.current = undefined; setRequest('');
  }
  async function start(resultSource?: AgentResultSource) {
    if (!configured || !runtimeId || active || busy || missingRun || (!resultSource && !request.trim())) return;
    setBusy(true); setError('');
    const body = { runtimeId, request: resultSource ? request.trim() || '请分析我选择的结果快照，总结主要发现并说明截断或样本限制。' : request.trim(), mode: resultSource ? 'suggest' : mode, previousRunId: resultSource ? undefined : run?.id, resultSource, allowedConnectionIds: resultSource ? [resultSource.connectionId] : run?.allowedConnectionIds ?? (scope === 'current' ? [selectedId].filter(Boolean) : connections.map(connection => connection.id)) };
    const signature = JSON.stringify(body);
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, id: crypto.randomUUID() };
    try {
      const { id } = await api<{ id: string }>('/ai/runs', { method: 'POST', body: JSON.stringify({ ...body, clientRequestId: pendingRequest.current.id }) });
      openConversation(id);
    } catch (e) {
      if (resultSource && (e as { code?: string }).code === 'RESULT_EXPIRED') onResultExpired(resultSource);
      setError((e as Error).message);
    }
    finally { setBusy(false); }
  }
  async function decide(approve: boolean) {
    if (!run || busy) return;
    setBusy(true); setError('');
    try {
      if (approve && pending) {
        await api(`/approvals/${pending.planId}/decision`, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) });
        await api(`/ai/runs/${run.id}/resume`, { method: 'POST' });
      } else await api(`/ai/runs/${run.id}/cancel`, { method: 'POST' });
     
      setRun(await api<AgentSnapshot>(`/ai/runs/${run.id}`));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <aside className="chat-pane" aria-label="工作区 AI 助手">
    <div className="chat-header"><div className="chat-title"><span className="assistant-icon"><AppIcon name="sparkles" size={17} /></span><div><strong>工作区 AI 助手</strong><small>可发现连接，无需先打开表</small></div></div><div className="chat-header-actions"><Button variant="ghost" size="sm" aria-label={expanded ? "恢复工作区布局" : "展开 AI 对话"} title={expanded ? "恢复工作区布局" : "展开 AI 对话"} aria-pressed={expanded} onClick={onToggleExpanded}><AppIcon name={expanded ? "collapse" : "expand"} /></Button><Button variant="ghost" size="sm" aria-label="新对话" title="新对话" disabled={!!active || busy || (!run && !missingRun)} onClick={newConversation}><AppIcon name="messagePlus" /></Button><AgentHistory api={api} disabled={!!active || busy} onSelect={openConversation} />{settings}</div></div>
    <div className="chat-scroll" ref={scrollRef} onScroll={event => { const node = event.currentTarget; followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}>
      <p className="agent-intro">{configured ? '建议模式生成 SQL；执行模式在你确认具体目标与 SQL 后执行。追问会保留最近对话；每轮操作重新检查权限。新对话可切换模式和连接范围。' : 'AI 尚未配置。点击右上方“AI 设置”，选择供应商和模型并填写 API Key。'}</p>
      {!!run && <div className="agent-conversation-info"><small>本轮授权 {run.allowedConnectionIds?.length ?? 0} 个连接 · {run.mode === 'suggest' ? '建议模式' : '执行模式'}{run.model ? ` · ${run.model.id}` : ''}</small></div>}
      {connectionWarning && <div className="agent-connection-warning" role="status"><p>{connectionWarning}</p><Button variant="outline" size="sm" onClick={() => setPollGeneration(value => value + 1)}>刷新任务状态</Button></div>}
      {run?.historyTruncated && <p>较早或较长的上下文已截断，请补充关键条件。</p>}
      {run?.history?.map(turn => <React.Fragment key={turn.id}><div className="chat-bubble user"><small className="message-author">你</small><p>{turn.request}</p></div><div className="chat-bubble assistant"><small className="message-author">DBPilot</small><MarkdownMessage text={turn.answer ?? turn.error ?? turn.status} canCopy={turn.status === 'succeeded'} />{turn.truncated && <small>此轮历史已截断</small>}<details><summary>历史工具记录 · {turn.status}</summary><pre>{turn.evidence}</pre></details></div></React.Fragment>)}
      {run?.request && <div className="chat-bubble user"><small className="message-author">你</small><p>{run.request}</p></div>}
      {run && <div aria-live="polite" className="agent-progress">
        <Badge variant="outline">{statusNames[run.status]}</Badge>
        {!!run.todos?.length && <section className="agent-todos" aria-label="任务待办"><strong>任务待办</strong><small>计划进度 · 执行结果以工具记录为准</small><ol>{run.todos.map(item => <li key={item.id} data-status={item.status}><span>{({ pending: '待处理', in_progress: '进行中', completed: '已完成' })[item.status]}</span>{item.text}</li>)}</ol></section>}
        {run.activity.map((item, index) => {
          const data = item.result.ok ? item.result.data as { connectionId?: string; database?: string; planId?: string; executionId?: string; status?: string; steps?: { sql: string }[] } : undefined;
          const outcome = data?.status ? ({ succeeded: '成功', failed: '失败', running: '执行中', cancelled: '已取消', outcome_unknown: '结果待核对' } as Record<string, string>)[data.status] : undefined;
          const connectionDraft = item.tool === 'request_connection' && item.result.ok ? agentConnectionDraft.safeParse((item.result.data as { draft?: unknown })?.draft) : undefined;
          return <div className="agent-tool" key={index}>
            <details><summary>{toolNames[item.tool] ?? item.tool} · {outcome ?? (item.result.ok ? '已返回' : '未成功')}</summary><pre>{JSON.stringify(item.result, null, 2)}</pre></details>
            {item.tool === 'execute_plan' && data?.executionId && data.connectionId && <Button variant="outline" size="sm" disabled={!!active} onClick={() => onViewExecution(data.executionId!, data.connectionId!)}>查看执行结果</Button>}
            {connectionDraft?.success && <div><p>连接尚未建立。请在表单中核对目标并填写凭据，保存后开始新对话以授权使用。</p><Button variant="outline" size="sm" disabled={!!active} onClick={() => onConnectionDraft(connectionDraft.data)}>查看连接草稿</Button></div>}
            {item.tool === 'propose_sql' && data?.steps && <Button variant="outline" size="sm" onClick={() => onDraft(data.steps!.map(step => step.sql).join(';\n'), data.connectionId!, data.database)}>放入 SQL 编辑器</Button>}
          </div>;
        })}
        {run.answer && <div className="chat-bubble assistant"><small className="message-author">DBPilot{run.status === 'running' ? ' · 正在输出' : run.status !== 'succeeded' ? ' · 未完成的回答' : ''}</small><MarkdownMessage text={run.answer} canCopy={run.status === 'succeeded'} /></div>}
        {run.error && <details><summary>失败详情</summary><p>{run.error}</p></details>}
        {pending && <section className="agent-approval" aria-label="确认 Agent 数据库操作"><h3>确认 Agent 数据库操作</h3>
        <p>目标：{target?.name ?? pending?.connectionId} · {target?.engine ?? ''}{pending?.database ? ` / ${pending.database}` : ''}</p>
        {run?.deadlineAt && <p>本轮确认截止：{new Date(run.deadlineAt).toLocaleTimeString()}。超时后任务停止，已完成步骤仍保留。</p>}
        <small>Runtime：{runtimeId}<br />连接 ID：{pending?.connectionId}</small>
        <div className="agent-approval-steps">{pending?.steps.map((step, index) => <section key={index}><strong>步骤 {index + 1} · {kindNames[step.kind] ?? step.kind}{step.decision === 'deny' ? ' · 禁止执行' : ''}</strong><pre>{step.sql}</pre></section>)}</div>
        <p>{pending?.steps.some(step => ['write', 'schema'].includes(step.kind)) ? '此计划会修改数据或结构，影响行数尚未知。先前成功的步骤不会因后续失败自动回滚。' : '此计划将读取数据库；结果可能交给已配置模型分析。'}</p>
        <div className="agent-controls"><Button variant="outline" disabled={busy} onClick={() => void decide(false)}>拒绝并停止</Button><Button disabled={busy || pending?.steps.some(step => step.decision === 'deny')} onClick={() => void decide(true)}>确认执行以上 SQL</Button></div>
        </section>}
        {active && !pending && <Button variant="outline" disabled={busy || run.status === 'cancelling'} onClick={() => void decide(false)}><AppIcon name="stop" />取消 Agent 任务</Button>}
      </div>}
      {selectedResult && <div className="agent-selected-result"><Button variant="outline" disabled={!configured || !!active || busy || missingRun} onClick={() => void start(selectedResult)}><AppIcon name="sparkles" />新对话分析当前结果</Button><small>仅发送所选快照的最多50行及字段名；不会重新执行SQL。可先在输入框填写分析要求。</small></div>}
      {children}
    </div>
    <div className="chat-composer">
      <div className="agent-controls agent-preferences">
        <Select value={mode} onValueChange={value => setMode(value as 'suggest' | 'execute')} disabled={!!run || busy}>
          <SelectTrigger size="sm" aria-label="Agent 模式" className="agent-preference"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="suggest">建议模式</SelectItem><SelectItem value="execute">执行模式</SelectItem></SelectContent>
        </Select>
        <Select value={scope} onValueChange={setScope} disabled={!!run || busy}>
          <SelectTrigger size="sm" aria-label="Agent 连接范围" className="agent-preference"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">所有连接</SelectItem><SelectItem value="current" disabled={!selectedId}>仅当前连接</SelectItem></SelectContent>
        </Select>
      </div>
      <Textarea ref={inputRef} aria-label="发送给 AI 助手" value={request} disabled={!configured || !!active || busy || missingRun} placeholder={configured ? '描述任务，或指定要使用的连接…' : 'AI 尚未配置'} onChange={event => setRequest(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void start(); } }} />
      <div className="chat-compose-footer"><span>Enter 发送 · Shift+Enter 换行</span><Button size="sm" onClick={() => void start()} disabled={!configured || !!active || busy || missingRun || !request.trim()}><AppIcon name={busy ? "loader" : "send"} className={busy ? "icon-spin" : undefined} />发送</Button></div>
    </div>

  </aside>;
}

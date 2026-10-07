import { notify } from '@ui/notify';
import { AppIcon } from '@ui/icons';
import React, { useState } from 'react';
import { Button } from '@ui/components/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@ui/components/dialog';
import { Label } from '@ui/components/label';
import { Textarea } from '@ui/components/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/components/select';
import { policySettings, policyUpdateInput, type PolicySettings as Settings, type CommandRule } from '../../protocol/src/index.js';

type Props = { connections: { id: string; name: string }[]; api: <T>(path: string, init?: RequestInit) => Promise<T> };
export function PolicySettings({ connections, api }: Props) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>();
  const [rules, setRules] = useState<CommandRule[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setNotice = notify.success;
  async function load() {
    setBusy(true); setError(''); setNotice('');
    try { const data = policySettings.parse(await api('/command-policy')); setSettings(data); setRules(data.rules); }
    catch (err) { notify.error(err instanceof Error ? err.message : '加载失败', { title: '加载规则失败' }); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!settings) return;
    const input = policyUpdateInput.safeParse({ revision: settings.revision, rules });
    if (!input.success) { setError('规则格式无效：自动执行必须填写精确 SQL，最多 256 条规则。'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const data = policySettings.parse(await api('/command-policy', { method: 'PUT', body: JSON.stringify(input.data) }));
      setSettings(data); setRules(data.rules); setNotice(`已保存版本 ${data.revision}，未执行的旧计划已失效。`);
    } catch (err) { notify.error(err instanceof Error ? err.message : '保存失败', { title: '保存规则失败' }); }
    finally { setBusy(false); }
  }
  function change(index: number, patch: Partial<CommandRule>) { setRules(current => current.map((rule, i) => i === index ? { ...rule, ...patch } : rule)); setNotice(''); }
  const disabled = busy || !settings || settings.readOnly;
  return <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
    <DialogTrigger asChild><Button variant="ghost" size="sm" onClick={() => { setSettings(undefined); void load(); }}><AppIcon name="shield" />命令规则</Button></DialogTrigger>
    <DialogContent placement="right" className="policy-modal">
      <DialogTitle>命令规则</DialogTitle>
      <DialogDescription>拒绝优先于确认，确认优先于自动执行。未匹配的 AI SQL 需要确认；人工 SQL 直接执行，但仍受拒绝规则约束。</DialogDescription>
      {settings && <p>{settings.readOnly ? '配置文件管理 · 只读，修改文件后重启生效' : `工作区规则 · 版本 ${settings.revision} · ${settings.persistent ? '持久保存' : '仅本次运行，重启丢失'}`}</p>}
      <p>自动执行必须匹配完整 SQL（含空格与大小写，不含分隔分号）。保存立即生效；已开始执行的任务继续，未执行旧计划需重新生成。</p>
      <details className="policy-builtins"><summary>内置工具与固定规则</summary><ul><li>数据库：连接草稿、读取所选快照、发现连接、测试连接、检索结构、生成 SQL、执行计划、查看结果与取消。</li><li>任务：更新待办；最多12项，同时最多一项进行中。</li><li>命令参考：ls、pwd、head、tail、grep、wc；仅返回说明，不执行 Shell。</li><li>模型不能修改规则或确认操作；写入失败不自动重放。</li><li>当前优先固有工具，Skill 与 MCP 尚未接入。</li></ul></details>
      <div className="policy-rule-list">
        {rules.map((rule, index) => <fieldset key={index} disabled={disabled} className="policy-rule">
          <legend>规则 {index + 1}</legend>
          <Label htmlFor={`policy-connection-${index}`}>目标连接</Label>
          <Select disabled={disabled} value={rule.connectionId} onValueChange={connectionId => change(index, { connectionId })}>
            <SelectTrigger id={`policy-connection-${index}`}><SelectValue /></SelectTrigger>
            <SelectContent>{!connections.some(c => c.id === rule.connectionId) && <SelectItem value={rule.connectionId}>已删除连接 · {rule.connectionId}</SelectItem>}{connections.map(c => <SelectItem key={c.id} value={c.id}>{c.name} · {c.id.slice(0, 8)}</SelectItem>)}</SelectContent>
          </Select>
          <Label htmlFor={`policy-kind-${index}`}>命令类型</Label>
          <Select disabled={disabled} value={rule.kind} onValueChange={kind => change(index, { kind: kind as CommandRule['kind'] })}><SelectTrigger id={`policy-kind-${index}`}><SelectValue /></SelectTrigger><SelectContent>{Object.entries({ read: '读取', write: '写入', schema: '结构变更', transaction: '事务控制' }).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          <Label htmlFor={`policy-decision-${index}`}>处理方式</Label>
          <Select disabled={disabled} value={rule.decision} onValueChange={decision => change(index, { decision: decision as CommandRule['decision'] })}><SelectTrigger id={`policy-decision-${index}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ask">需要确认</SelectItem><SelectItem value="deny">拒绝</SelectItem><SelectItem value="allow">自动执行</SelectItem></SelectContent></Select>
          <Label htmlFor={`policy-sql-${index}`}>精确 SQL{rule.decision === 'allow' ? '（必填）' : '（留空匹配该类型全部命令）'}</Label>
          <Textarea id={`policy-sql-${index}`} value={rule.exactSql ?? ''} maxLength={20000} onChange={event => change(index, { exactSql: event.target.value || undefined })} />
          <Button variant="outline" disabled={disabled} onClick={() => { setRules(current => current.filter((_, i) => i !== index)); setNotice(''); }}><AppIcon name="trash" />删除规则 {index + 1}</Button>
        </fieldset>)}
        {!rules.length && settings && <p>尚无自定义规则。</p>}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="policy-actions">
        <Button variant="outline" disabled={disabled || !connections.length || rules.length >= 256} onClick={() => { setRules(current => [...current, { connectionId: connections[0].id, kind: 'read', decision: 'ask' }]); setNotice(''); }}><AppIcon name="plus" />添加规则</Button>
        <Button variant="outline" disabled={busy} onClick={() => void load()}><AppIcon name="refresh" />重新加载</Button>
        <Button disabled={disabled} onClick={() => void save()}><AppIcon name="save" />{busy ? '处理中…' : '保存规则'}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}

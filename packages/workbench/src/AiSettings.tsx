import { notify } from '@ui/notify';
import { AppIcon } from '@ui/icons';
import React, { useState } from 'react';
import { Button } from '@ui/components/button';
import { Input } from '@ui/components/input';
import { Label } from '@ui/components/label';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@ui/components/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui/components/select';
import { aiSettingsView, aiSettingsInput, aiModelsInput, aiTestInput, aiTestResult, type AiSettingsView } from '../../protocol/src/index.js';

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
export function AiSettings({ api, onConfigured }: { api: Api; onConfigured: (configured: boolean) => void }) {
  const [open, setOpen] = useState(false); const [data, setData] = useState<AiSettingsView>();
  const [provider, setProvider] = useState<'deepseek' | 'openai-compatible'>('deepseek');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com'); const [model, setModel] = useState('deepseek-flash'); const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const setNotice = notify.success;
  async function load() {
    setBusy(true); setError(''); setNotice(''); setApiKey('');
    try { const next = aiSettingsView.parse(await api('/ai/settings')); setData(next); setProvider(next.provider); setBaseUrl(next.baseUrl); setModel(next.model); setModels([]); }
    catch (e) { notify.error((e as Error).message, { title: 'AI 配置操作失败' }); } finally { setBusy(false); }
  }
  async function discover() {
    if (!aiModelsInput.safeParse({ provider, baseUrl, apiKey: apiKey || undefined }).success) { setError('请填写有效的 API 地址和密钥。'); return; }
    setBusy(true); setError(''); setNotice('');
    try { const next = await api<{ models: string[] }>('/ai/models', { method: 'POST', body: JSON.stringify({ provider, baseUrl, apiKey: apiKey || undefined }) }); setModels(next.models); setNotice(next.models.length ? `连接成功，获取到 ${next.models.length} 个模型。` : '接口可达，但未返回模型；请手动填写。'); }
    catch (e) { notify.error((e as Error).message, { title: 'AI 配置操作失败' }); } finally { setBusy(false); }
  }
  async function testModel() {
    const parsed = aiTestInput.safeParse({ provider, baseUrl, model, apiKey: apiKey || undefined });
    if (!parsed.success) { setError('请填写有效 API 地址、模型 ID 和密钥。'); return; }
    setBusy(true); setError('');
    try { const result = aiTestResult.parse(await api('/ai/test', { method:'POST', body:JSON.stringify(parsed.data) })); setNotice(`${result.model} 模型响应及工具调用测试通过。`); }
    catch (error) { notify.error((error as Error).message, { title:'模型测试失败' }); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!data) return;
    if (!aiSettingsInput.safeParse({ revision: data.revision, provider, baseUrl, model, apiKey: apiKey || undefined }).success) { setError('请检查 API 地址、模型 ID 和密钥格式。'); return; }
    setBusy(true); setError(''); setNotice('');
    try { const next = aiSettingsView.parse(await api('/ai/settings', { method: 'PUT', body: JSON.stringify({ revision: data.revision, provider, baseUrl, model, apiKey: apiKey || undefined }) })); setData(next); setApiKey(''); onConfigured(next.configured); setNotice('已保存，下次 AI 请求立即使用此配置。'); }
    catch (e) { notify.error((e as Error).message, { title: 'AI 配置操作失败' }); } finally { setBusy(false); }
  }
  const disabled = busy || !data?.writable;
  return <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (!value) setApiKey(''); } }}>
    <DialogTrigger asChild><Button variant="ghost" size="sm" onClick={() => { setData(undefined); void load(); }}><AppIcon name="settings" />AI 设置</Button></DialogTrigger>
    <DialogContent className="ai-settings-modal"><DialogTitle>配置 AI 助手</DialogTitle><DialogDescription>选择供应商与模型，配置由当前运行端保存。API Key 仅用于向你指定的接口认证，不进入对话。</DialogDescription>
      <form onSubmit={event => void save(event)} className="ai-settings-form">
        <Label htmlFor="ai-provider">供应商</Label><Select value={provider} disabled={disabled} onValueChange={value => { setProvider(value as typeof provider); setBaseUrl(value === 'deepseek' ? 'https://api.deepseek.com' : ''); setModel(value === 'deepseek' ? 'deepseek-flash' : ''); setApiKey(''); setModels([]); setNotice(''); }}><SelectTrigger id="ai-provider"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="deepseek">DeepSeek</SelectItem><SelectItem value="openai-compatible">自定义 OpenAI 兼容接口</SelectItem></SelectContent></Select>
        <Label htmlFor="ai-base-url">API 地址</Label><Input id="ai-base-url" type="url" required value={baseUrl} disabled={disabled} placeholder="https://api.example.com/v1" onChange={e => { setBaseUrl(e.target.value); setModels([]); setNotice(''); }} />
        <Label htmlFor="ai-api-key">API Key {data?.hasApiKey ? '· 已设置' : ''}</Label><Input id="ai-api-key" type="password" autoComplete="new-password" spellCheck={false} maxLength={4096} value={apiKey} disabled={disabled} placeholder={data?.hasApiKey ? '留空保留原密钥；更换接口需重新填写' : '输入供应商提供的 API Key'} onChange={e => setApiKey(e.target.value)} />
        <div className="ai-model-heading"><Label htmlFor="ai-model">模型 ID</Label><Button type="button" variant="outline" size="sm" disabled={busy || !data || !baseUrl} onClick={() => void discover()}><AppIcon name={busy ? "loader" : "plug"} className={busy ? "icon-spin" : undefined} />获取模型列表</Button></div>
        {!!models.length && <Select disabled={disabled} value={models.includes(model) ? model : undefined} onValueChange={setModel}><SelectTrigger aria-label="选择可用模型"><SelectValue placeholder="从接口返回的模型中选择" /></SelectTrigger><SelectContent>{models.map(id => <SelectItem key={id} value={id}>{id}</SelectItem>)}</SelectContent></Select>}
        <Input id="ai-model" required maxLength={200} value={model} disabled={disabled} placeholder="选择模型或手动输入模型 ID" onChange={e => setModel(e.target.value)} />
        <Button type="button" variant="outline" disabled={busy || !data || !model || !baseUrl} onClick={() => void testModel()}><AppIcon name="plug" />测试模型与工具</Button>
        <small>发送固定测试内容，不发送数据库数据；测试不保存配置。</small>
        <p className="settings-help">{!data ? '正在读取配置…' : data.source === 'environment' ? '当前配置来自环境变量，为只读。移除环境配置并重启后可在这里编辑。' : data?.persistent ? '密钥加密保存。正在进行的任务继续使用开始时的配置。' : '当前运行端未设置数据目录：配置仅保留到重启。'}</p>
        {data?.writable && !data.storageReady && <p role="alert">运行端尚未配置加密主密钥，暂时不能保存。请设置 DBPILOT_MASTER_KEY_FILE 后重启运行端。</p>}
        {error && <p role="alert">{error}</p>}
        <div className="policy-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => void load()}><AppIcon name="refresh" />重新加载</Button><Button type="submit" disabled={disabled || !data?.storageReady}><AppIcon name="save" />{busy ? '处理中…' : '保存 AI 配置'}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

import { agentHistoryList } from '../../protocol/src/index.js';
import React, { useState } from 'react';
import { Button } from '@ui/components/button';
import { AppIcon } from '@ui/icons';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@ui/components/dialog';

type Entry = { id: string; request: string; status: string; mode: string; createdAt: number };
export function AgentHistory({ api, disabled, onSelect }: { api: <T>(path: string) => Promise<T>; disabled: boolean; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<{ persistent: boolean; runs: Entry[] }>();
  async function load() {
    setLoading(true); setHistory(undefined); setError('');
    try { setHistory(agentHistoryList.parse(await api('/ai/runs'))); }
    catch (error) { setError((error as Error).message); }
    finally { setLoading(false); }
  }
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button variant="ghost" size="sm" disabled={disabled} aria-label="对话历史" title="对话历史" onClick={() => void load()}><AppIcon name="history" /></Button></DialogTrigger>
    <DialogContent placement="right" className="agent-history-drawer">
      <DialogTitle>对话历史</DialogTitle>
      <DialogDescription>保留最近 32 轮任务及有界上下文。打开历史只恢复对话，不执行 SQL。</DialogDescription>
      {loading ? <p role="status">正在读取…</p> : error ? <p role="alert">读取对话历史失败：{error}。请恢复连接后刷新；读取失败不代表已保存的对话被删除。</p> : history && <p>{history.persistent ? '保存在当前 Runtime，重启后可恢复。' : '仅保存在当前运行期间。'}</p>}
      <div className="agent-history-list">{history?.runs.map(entry => <Button variant="outline" className="agent-history-entry" key={entry.id} onClick={() => { onSelect(entry.id); setOpen(false); }}><strong>{entry.request}</strong><small>{entry.mode === 'suggest' ? '建议' : '执行'} · {({ running: '处理中', cancelling: '正在取消，请等待', awaiting_approval: '待确认', succeeded: '已完成', failed: '已停止，请核对', cancelled: '已取消' } as Record<string, string>)[entry.status] ?? entry.status} · {new Date(entry.createdAt).toLocaleString()}</small></Button>)}</div>
      {!loading && history?.runs.length === 0 && <p>暂无对话。</p>}
      <Button variant="outline" disabled={loading} onClick={() => void load()}>刷新历史</Button>
    </DialogContent>
  </Dialog>;
}

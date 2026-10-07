import { requestRuntimeJson } from '../../runtime-client/src/json-request.js';
import { mergeResultPage, resultPageKey, type ResultPage, type ResultPages } from './result-pages.js';
import type { AgentConnectionDraft } from '../../protocol/src/index.js';
import { Toaster } from "@ui/components/sonner";
import { notify } from "@ui/notify";
import { connectionInput, schemaCatalog } from "../../protocol/src/index.js";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@ui/components/button";
import { Input } from "@ui/components/input";
import { Textarea } from "@ui/components/textarea";
import { Label } from "@ui/components/label";
import { Dialog, DialogContent, DialogTitle } from "@ui/components/dialog";
import { Tabs, TabsList, TabsTrigger } from "@ui/components/tabs";
import { Card } from "@ui/components/card";
import { Badge } from "@ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui/components/select";
import { PolicySettings } from "./PolicySettings.js";
import { AiSettings } from "./AiSettings.js";
import { ConnectionNavigator, type NavigationConnection } from "./ConnectionNavigator.js";
import { PaneDivider } from "./PaneDivider.js";
import { AppIcon } from "@ui/icons";
import { AgentPanel } from "./AgentPanel.js";
import { ResultGrid } from "./ResultGrid.js";
import { readExecutionStream } from "../../runtime-client/src/sse.js";
import { operationForDesktopRequest } from "../../runtime-client/src/desktop-operations.js";
import { requestError } from "../../runtime-client/src/errors.js";

const SqlEditor = React.lazy(() => import("./SqlEditor.js").then(module => ({ default: module.SqlEditor })));

type Connection = {
  id: string;
  version?: number;
  name: string;
  engine: "sqlite" | "postgres" | "mysql";
  filename?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  ssl?: boolean;
  tlsCa?: string;
  tlsServerName?: string;
  ssh?: { host:string; port:number; user:string; hostFingerprint:string; hasPassword?:boolean };
};
type Step = { sql: string; kind: string; decision: string };
type Plan = { connectionId: string; database?: string; id: string; steps: Step[]; approvalRequired: boolean };
type Execution = {
  id: string;
  status: string;
  results: {
    status: string;
    columns?: string[];
    rows?: unknown[][];
    affectedRows?: number;
    truncated?: boolean;
    resultAvailable?: boolean;
    rolledBack?: boolean;
    error?: string;
  }[];
  resultAvailable?: boolean;
};
type SchemaTable = {
  schema: string;
  name: string;
  columns: { name: string; type: string; nullable: boolean }[];
};
type HistoryStep = { sql: string; status: string; affectedRows?: number; truncated?: boolean; rolledBack?: boolean; error?: string };
type HistoryEntry = { id: string; sql: string; connection: string; database?: string; startedAt: number; status: string; steps?: HistoryStep[]; resultAvailable: boolean };
const executionStatusText: Record<string, string> = {
  pending: "等待中", running: "执行中", succeeded: "成功", failed: "失败",
  skipped: "已跳过", cancelled: "已取消", cancel_pending: "取消中", outcome_unknown: "结果待核对"
};
function statusText(status: string) { return executionStatusText[status] ?? status; }
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (window.dbpilotDesktop) {
    const { operation, input } = operationForDesktopRequest(
      init?.method ?? "GET",
      `/api/v1${path}`,
      init?.body ? JSON.parse(String(init.body)) : undefined,
    );
    const response = await window.dbpilotDesktop[operation](input);
    if (response.statusCode === 204) return undefined as T;
    if (response.statusCode >= 400) throw requestError(response.statusCode, response.body);
    return response.body as T;
  }
  const response = await requestRuntimeJson(`/api/v1${path}`, {
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
  });
  if (response.statusCode === 204) return undefined as T;
  if (response.statusCode >= 400) throw requestError(response.statusCode, response.body);
  return response.body as T;
}
export function Workbench() {
  const [aiExpanded, setAiExpanded] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [engine, setEngine] = useState<Connection["engine"]>("sqlite");
  const [name, setName] = useState("");
  const [filename, setFilename] = useState("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [ssl, setSsl] = useState(false);
  const [tlsCa, setTlsCa] = useState("");
  const [tlsServerName, setTlsServerName] = useState("");
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState(""); const [sshPort, setSshPort] = useState("22");
  const [sshUser, setSshUser] = useState(""); const [sshPassword, setSshPassword] = useState("");
  const [sshFingerprint, setSshFingerprint] = useState("");
  const sshInput = sshEnabled ? { host:sshHost, port:Number(sshPort), user:sshUser, password:sshPassword, hostFingerprint:sshFingerprint.trim() } : undefined;
  const [connectionTest, setConnectionTest] = useState<
    "idle" | "testing" | "success" | "failed"
  >("idle");
  const [formConnectionTest, setFormConnectionTest] = useState<"idle" | "testing" | "success" | "failed">("idle");
  const [rowTests, setRowTests] = useState<Record<string, { status: string; message: string }>>({});
  const [connectionId, setConnectionId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [sql, setSql] = useState("SELECT 1;");
  const [aiConfigured, setAiConfigured] = useState(false);
  const [runtimeId, setRuntimeId] = useState("");
  const [runtimePersistent, setRuntimePersistent] = useState<boolean>();
  const [agentActive, setAgentActive] = useState(false);
  const [execution, setExecution] = useState<Execution | null>(null);
  const resultSelection = useRef(0);
  const [pages, setPages] = useState<ResultPages>({});
  const setError = notify.error;
  const [formError, setFormError] = useState("");
  const [selectedDatabase, setSelectedDatabase] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<Connection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const setDeleteError = notify.error;
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const [runtimeTarget, setRuntimeTarget] = useState<{
    kind: "local" | "remote";
    baseUrl?: string;
  }>({ kind: "local" });
  const [remoteUrl, setRemoteUrl] = useState("");
  const [connectionFormOpen, setConnectionFormOpen] = useState(false);
  const [runtimeSettingsOpen, setRuntimeSettingsOpen] = useState(false);
  const [activeView, setActiveView] = useState<"results" | "schema">("results");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [activeTable, setActiveTable] = useState<SchemaTable | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleTab, setConsoleTab] = useState<"sql" | "history" | "log">("sql");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [commandLog, setCommandLog] = useState<{ id: string; time: number; text: string }[]>([]);
  const visibleLog = React.useMemo(() => [
    ...[...history].reverse().flatMap(item => (item.steps ?? []).map((step, index) => ({
      id: `${item.id}-${index}`,
      time: item.startedAt,
      text: `SQL ${index + 1} · ${statusText(step.status)} · ${step.sql}${step.affectedRows === undefined ? '' : ` · 影响 ${step.affectedRows} 行`}${step.rolledBack ? ' · 已回滚' : ''}${step.truncated ? ' · 结果已截断' : ''}${step.error ? ` · ${step.error}` : ''}`
    }))),
    ...commandLog
  ].sort((a, b) => a.time - b.time), [history, commandLog]);
  const [submitting, setSubmitting] = useState(false);
  const [executionReadWarning, setExecutionReadWarning] = useState<{ id: string; message: string }>();
  const [refreshingExecution, setRefreshingExecution] = useState(false);
  const pendingPrepare = useRef<{ signature: string; id: string } | null>(null);
  useEffect(() => { setFormConnectionTest("idle"); setFormError(""); }, [engine, name, filename, host, port, database, user, password, ssl, tlsCa, tlsServerName, sshEnabled, sshHost, sshPort, sshUser, sshPassword, sshFingerprint, editingId, connectionFormOpen]);
  function logCommand(text: string) {
    setCommandLog((previous) => [...previous, { id: crypto.randomUUID(), time: Date.now(), text }].slice(-200));
  }
  useEffect(() => {
    void api<Connection[]>("/connections")
      .then(setConnections)
      .catch((e) => setError(e.message));
    void api<{ runtimeId: string; storage?: { persistent: boolean }; capabilities?: { aiConfigured?: boolean } }>("/runtime")
      .then((runtime) => { setRuntimeId(runtime.runtimeId); setRuntimePersistent(runtime.storage?.persistent); setAiConfigured(runtime.capabilities?.aiConfigured === true); })
      .catch(() => setAiConfigured(false));
  }, []);
  useEffect(() => {
    if (window.dbpilotDesktop)
      void window.dbpilotDesktop
        .getTarget()
        .then((target) => {
          setRuntimeTarget(target);
          setRemoteUrl(target.baseUrl ?? "");
        })
        .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    setHistory([]);
    setCommandLog([]);
    let current = true;
    if (connectionId) void api<HistoryEntry[]>(`/executions?connectionId=${encodeURIComponent(connectionId)}`)
      .then(items => { if (current) setHistory(items); }).catch((e) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [connectionId]);
  async function createConnection(event: React.FormEvent) {
    event.preventDefault();
    setFormError("");
    try {
      const input =
        engine === "sqlite"
          ? { engine, name, filename }
          : {
              engine,
              name,
              host,
              port: Number(port),
              database,
              user,
              password,
              ssl, tlsCa: tlsCa || undefined, tlsServerName: tlsServerName || undefined, ssh: sshInput,
            };
      if (!connectionInput.safeParse(input).success) { setFormError("请检查必填信息、端口范围和文件路径。"); return; }
      const saved = await api<Connection>(
        editingId ? `/connections/${editingId}` : "/connections",
        { method: editingId ? "PUT" : "POST", body: JSON.stringify(input) },
      );
      setConnections((previous) =>
        editingId
          ? previous.map((connection) =>
              connection.id === editingId ? saved : connection,
            )
          : [...previous, saved],
      );
      resultSelection.current++;
      setConnectionId(saved.id);
      setSelectedDatabase(saved.engine === "sqlite" ? "main" : saved.database ?? "");
      setPassword("");
      setEditingId("");
      setConnectionTest("idle");
      setActiveTable(null);
      setExecution(null);
      setPages({});
      setConnectionFormOpen(false);
      notify.success(`连接「${saved.name}」已保存`);
    } catch (e) {
      notify.error((e as Error).message, { title: "保存连接失败" });
    }
  }
  function requestDelete(connection: NavigationConnection, trigger?: HTMLButtonElement) {
    const saved = connections.find(item => item.id === connection.id);
    if (!saved) return;
    deleteTrigger.current = trigger ?? null;
    setDeleteCandidate(saved); setDeleteError(""); setConnectionFormOpen(false);
  }
  async function deleteConnection() {
    if (!deleteCandidate || deleting) return;
    const id = deleteCandidate.id; setDeleting(true); setDeleteError("");
    try {
      await api(`/connections/${id}`, { method: 'DELETE' });
      setConnections(previous => previous.filter(connection => connection.id !== id));
      if (connectionId === id) { resultSelection.current++; setConnectionId(''); setSelectedDatabase(''); setExecution(null); setActiveTable(null); setPages({}); setHistory([]); }
      notify.success(`已删除连接记录「${deleteCandidate.name}」，数据库内容保留。`);
      setDeleteCandidate(null);
    } catch (e) { setDeleteError((e as Error).message); }
    finally { setDeleting(false); }
  }
  function editConnection(id = connectionId) {
    const selected = connections.find(
      (connection) => connection.id === id,
    );
    if (!selected) return;
    setEditingId(selected.id);
    setEngine(selected.engine);
    setName(selected.name);
    setFilename(selected.filename ?? "");
    setHost(selected.host ?? "127.0.0.1");
    setPort(
      String(selected.port ?? (selected.engine === "postgres" ? 5432 : 3306)),
    );
    setDatabase(selected.database ?? "");
    setUser(selected.user ?? "");
    setPassword("");
    setSsl(selected.ssl ?? false);
    setTlsCa(selected.tlsCa ?? ""); setTlsServerName(selected.tlsServerName ?? "");
    setSshEnabled(!!selected.ssh); setSshHost(selected.ssh?.host ?? ""); setSshPort(String(selected.ssh?.port ?? 22));
    setSshUser(selected.ssh?.user ?? ""); setSshPassword(""); setSshFingerprint(selected.ssh?.hostFingerprint ?? "");
    setConnectionTest("idle");
    setFormError("");
    setFormConnectionTest("idle");
  }
  async function switchRuntime(kind: "local" | "remote") {
    if (!window.dbpilotDesktop) return;
    if (
      (execution?.status === "running" || agentActive) &&
      !window.confirm(
        "当前查询或 Agent 任务尚未结束。切换后不会取消任务，结果视图将清空。继续吗？",
      )
    )
      return;
    try {
      await window.dbpilotDesktop.setTarget(
        kind === "local" ? { kind } : { kind, baseUrl: remoteUrl },
      );
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function pickSqliteFile() {
    const path = await window.dbpilotDesktop?.pickSqliteFile();
    if (path) setFilename(path);
  }
  async function runSql(query = sql, target = { connectionId, database: selectedDatabase }) {
    if (!target.connectionId || !query.trim() || submitting || busy) return;
    const targetConnection = connections.find(item => item.id === target.connectionId);
    if (targetConnection?.engine !== "sqlite" && !target.database) { setError("\u8bf7\u5148\u5728\u5de6\u4fa7\u9009\u62e9\u8981\u6267\u884c SQL \u7684\u6570\u636e\u5e93"); return; }
    setError("");
    setSubmitting(true);
    const signature = JSON.stringify({ ...target, sql: query });
    if (pendingPrepare.current?.signature !== signature)
      pendingPrepare.current = { signature, id: crypto.randomUUID() };
    try {
      const nextPlan = await api<Plan>("/command-plans", {
        method: "POST",
        body: JSON.stringify({
          connectionId: target.connectionId,
          database: target.database || undefined,
          sql: query,
          source: "human",
          clientRequestId: pendingPrepare.current.id,
        }),
      });
      pendingPrepare.current = null;
      if (nextPlan.steps.some((step) => step.decision === "deny")) {
        setError("这段 SQL 包含当前策略不支持的命令，未执行。请修改后重试。");
        logCommand("命令被策略拒绝，未执行");
      } else {
        await execute(nextPlan, query);
      }
    } catch (e) {
      setError((e as Error).message);
      logCommand(`提交失败：${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }
  async function execute(nextPlan: Plan, query = sql) {
    const selection = ++resultSelection.current;
    let startedId: string | undefined;
    const reportReadFailure = (error: unknown) => {
      const message = `执行请求或状态读取中断：${(error as Error).message}。操作可能已经完成，请先刷新状态或查看执行历史；不会自动重跑 SQL。`;
      if (selection === resultSelection.current) { setExecutionReadWarning({ id: startedId ?? '', message }); setError(message); }
      logCommand(message);
    };
    setExecutionReadWarning(undefined);
    setError("");
    setPages({});
    try {
      const { executionId } = await api<{ executionId: string }>(
        "/executions",
        { method: "POST", body: JSON.stringify({ planId: nextPlan.id }) },
      );
      startedId = executionId;
      if (selection === resultSelection.current) setHistory((previous) => [{ id: executionId, sql: query, connection: connections.find(item => item.id === nextPlan.connectionId)?.name ?? "", database: nextPlan.database, startedAt: Date.now(), status: "running", steps: nextPlan.steps.map(step => ({ sql: step.sql, status: 'pending' })), resultAvailable: true }, ...previous].slice(0, 50));
      if (selection === resultSelection.current) {
        setExecution({ id: executionId, status: "running", results: [] });
        setActiveView("results"); setActiveResultIndex(0);
      }
      let notified = false;
      const refresh = async () => {
        const snapshot = await api<Execution>(`/executions/${executionId}`);
        setExecution(previous => previous?.id === snapshot.id && ["running", "cancel_pending"].includes(previous.status) ? snapshot : previous);
        if (!notified && !["running", "cancel_pending"].includes(snapshot.status)) {
          notified = true;
          const failures = snapshot.results.filter(result => result.error).map(result => result.error).join("；");
          if (failures || ["failed", "partially_succeeded", "outcome_unknown"].includes(snapshot.status))
            notify.error(failures || statusText(snapshot.status), { id: `execution:${executionId}`, title: `SQL ${statusText(snapshot.status)}` });
        }
        setHistory((previous) => previous.map((item) => item.id === executionId ? {
          ...item, status: snapshot.status,
          steps: (item.steps ?? []).map((step, index) => ({ ...step, ...snapshot.results[index] }))
        } : item));
        if (!["running", "cancel_pending"].includes(snapshot.status))
          await Promise.all(
            snapshot.results.map((result, index) =>
              result.columns && result.resultAvailable !== false ? loadPage(executionId, index) : Promise.resolve(),
            ),
          );
        return snapshot.status;
      };
      let afterSeq = 0;
      for (let attempt = 0; !window.dbpilotDesktop && attempt < 3; attempt++) {
        try {
        const response = await fetch(
          `/api/v1/executions/${executionId}/events?afterSeq=${afterSeq}`,
          { signal: AbortSignal.timeout(35_000) },
        );
        if (!response.ok) break;
        const completed = await readExecutionStream(response, (event) => {
          afterSeq = event.seq;
          if (event.type === "step") {
            void refresh().catch(() => {}); // Final state read below reports persistent failures.
          }
        });
        if (completed) break;
        } catch { break; } // A broken stream falls back to reading the same execution.
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      if (["running", "cancel_pending"].includes(await refresh())) {
        const poll = async () => {
          try {
            if (["running", "cancel_pending"].includes(await refresh())) setTimeout(() => void poll(), 400);
          } catch (error) { reportReadFailure(error); }
        };
        setTimeout(() => void poll(), 400);
      }
    } catch (e) {
      reportReadFailure(e);
    }
  }
  async function refreshDisplayedExecution() {
    if (!execution || refreshingExecution) return;
    const id = execution.id, selection = resultSelection.current;
    setRefreshingExecution(true);
    try {
      const snapshot = await api<Execution>(`/executions/${id}`);
      if (selection !== resultSelection.current) return;
      setExecution(previous => previous?.id === id && !["running", "cancel_pending"].includes(previous.status) && ["running", "cancel_pending"].includes(snapshot.status) ? previous : snapshot); setExecutionReadWarning(undefined);
      setHistory(previous => previous.map(item => item.id === id ? { ...item, status: snapshot.status, steps: (item.steps ?? []).map((step, index) => ({ ...step, ...snapshot.results[index] })) } : item));
      if (!["running", "cancel_pending"].includes(snapshot.status)) await Promise.all(snapshot.results.map((result, index) => result.columns && result.resultAvailable !== false ? loadPage(id, index) : Promise.resolve()));
    } catch (error) {
      if (selection === resultSelection.current) setExecutionReadWarning({ id, message: `状态读取中断：${(error as Error).message}。请稍后刷新，不会自动重跑 SQL。` });
    } finally { setRefreshingExecution(false); }
  }
  async function openHistory(item: HistoryEntry) {
    const selection = ++resultSelection.current;
    setExecution(null);
    setSelectedDatabase(item.database ?? selected?.database ?? (selected?.engine === "sqlite" ? "main" : ""));
    setSql(item.sql);
    setActiveTable(null);
    setActiveView("results");
    setActiveResultIndex(0);
    setPages({});
    try {
      const snapshot = await api<Execution>(`/executions/${item.id}`);
      if (selection !== resultSelection.current) return;
      setExecution(snapshot);
      await Promise.all(snapshot.results.map((result, index) => result.columns && result.resultAvailable !== false ? loadPage(item.id, index) : Promise.resolve()));
    } catch (e) { if (selection === resultSelection.current) setError((e as Error).message); }
  }
  async function openAgentExecution(executionId: string, targetId: string) {
    const selection = ++resultSelection.current;
    try {
      const target = connections.find(item => item.id === targetId);
      if (!target) throw new Error('目标连接已不存在，请核对执行记录。');
      const entries = await api<HistoryEntry[]>(`/executions?connectionId=${encodeURIComponent(targetId)}`);
      const entry = entries.find(item => item.id === executionId);
      if (!entry) throw new Error('执行记录已不可用，不会重新运行 SQL。');
      const snapshot = await api<Execution>(`/executions/${executionId}`);
      if (selection !== resultSelection.current) return;
      setAiExpanded(false);
      setConnectionId(targetId);
      setSelectedDatabase(entry.database ?? target.database ?? (target.engine === 'sqlite' ? 'main' : ''));
      setSql(entry.sql); setActiveTable(null); setActiveView('results');
      setActiveResultIndex(0); setPages({}); setExecution(snapshot);
      await Promise.all(snapshot.results.map((result, index) => result.columns && result.resultAvailable !== false ? loadPage(executionId, index) : Promise.resolve()));
    } catch (error) { if (selection === resultSelection.current) setError((error as Error).message); }
  }
  async function loadPage(executionId: string, index: number, cursor?: string) {
    try {
      const path = `/executions/${executionId}/results/${index}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await api<ResultPage>(path);
      setPages(previous => mergeResultPage(previous, executionId, index, page, cursor));
    } catch (e) {
      if ((e as Error).message === "RESULT_EXPIRED") {
        setExecution((previous) => previous?.id === executionId ? { ...previous, results: previous.results.map((result, resultIndex) => resultIndex === index ? { ...result, resultAvailable: false } : result) } : previous);
        setHistory((previous) => previous.map((item) => item.id === executionId ? { ...item, resultAvailable: false } : item));
      } else setError((e as Error).message);
    }
  }
  async function cancelExecution() {
    if (!execution || execution.status !== "running") return;
    const id = execution.id, selection = resultSelection.current;
    try {
      const decision = await api<{ status: Execution['status']; accepted: boolean }>(`/executions/${id}/cancel`, { method: "POST" });
      if (selection !== resultSelection.current) return;
      setExecution((previous) =>
        previous?.id === id && ["running", "cancel_pending"].includes(previous.status) ? { ...previous, status: decision.status } : previous,
      );
      if (!decision.accepted) await refreshDisplayedExecution();
    } catch (e) {
      if (selection === resultSelection.current) setError((e as Error).message);
    }
  }
  const selected = connections.find(
    (connection) => connection.id === connectionId,
  );
  const activeResult = execution?.results[activeResultIndex];
  const activePage = execution ? pages[resultPageKey(execution.id, activeResultIndex)] : undefined;
  const busy =
    execution?.status === "running" || execution?.status === "cancel_pending";
  const quote = selected?.engine === "mysql" ? "`" : '"';
  function selectNavigation(connection: NavigationConnection, database?: string, table?: SchemaTable) {
    if (busy || submitting) { setError("\u5f53\u524d\u67e5\u8be2\u5c1a\u672a\u7ed3\u675f\uff0c\u8bf7\u5148\u7b49\u5f85\u5b8c\u6210\u6216\u53d6\u6d88\u6267\u884c"); return; }
    resultSelection.current++;
    setConnectionId(connection.id); setSelectedDatabase(database ?? "");
    setActiveTable(table ?? null); setActiveView("results"); setExecution(null); setPages({}); setError("");
    if (table) {
      // Resolve only this table's columns; late responses cannot replace a newer selection.
      void api(`/connections/${connection.id}/schema?database=${encodeURIComponent(database ?? "")}&schema=${encodeURIComponent(table.schema)}&table=${encodeURIComponent(table.name)}`)
        .then(value => { const loaded = schemaCatalog.parse(value).tables[0]; if (loaded) setActiveTable(current => current === table ? loaded : current); })
        .catch(e => notify.error((e as Error).message, { id: `columns:${connection.id}:${database}:${table.schema}:${table.name}`, title: `「${table.name}」字段读取失败` }));
      const quote = connection.engine === "mysql" ? "`" : '\"';
      const identifier = [table.schema, table.name].filter(Boolean).map(part => `${quote}${part.replaceAll(quote, quote + quote)}${quote}`).join(".");
      const query = `SELECT * FROM ${identifier} LIMIT 100;`;
      setSql(query); setConsoleOpen(false);
      void runSql(query, { connectionId: connection.id, database: database ?? "" });
    }
  }
  async function testConnectionRow(id: string) {
    setRowTests(current => ({ ...current, [id]: { status: 'testing', message: '测试中…' } }));
    try { await api(`/connections/${id}/test`, { method: 'POST' }); setRowTests(current => ({ ...current, [id]: { status: 'success', message: '连接正常' } })); notify.success(`连接「${connections.find(item => item.id === id)?.name ?? ''}」可正常访问`, { id: `connection-test:${id}`, title: '测试连接成功' }); }
    catch (e) { setRowTests(current => ({ ...current, [id]: { status: 'failed', message: (e as Error).message } })); notify.error((e as Error).message, { id: `connection-test:${id}`, title: '测试连接失败' }); }
  }
  async function testConnectionForm() {
    setFormConnectionTest("testing");
    setFormError("");
    const input = engine === "sqlite"
      ? { engine, name: name.trim() || "测试连接", filename }
      : { engine, name: name.trim() || "测试连接", host, port: Number(port), database, user, password, ssl, tlsCa: tlsCa || undefined, tlsServerName: tlsServerName || undefined, ssh: sshInput };
    if (!connectionInput.safeParse(input).success) { setFormError("请检查连接信息和端口范围后再测试。"); setFormConnectionTest("idle"); return; }
    try {
      await api<{ ok: boolean }>("/connections/test", {
        method: "POST",
        body: JSON.stringify({ ...input, editingId: editingId || undefined }),
      });
      setFormConnectionTest("success");
      notify.success("当前填写的连接信息可正常访问数据库", { id: "connection-form-test", title: "测试连接成功" });
    } catch (e) {
      setFormConnectionTest("failed");
      notify.error((e as Error).message, { id: "connection-form-test", title: "测试连接失败" });
    }
  }
  function openNewConnection() {
    setEditingId("");
    setName("");
    setFilename("");
    setDatabase("");
    setUser("");
    setPassword("");
    setSsl(false); setTlsCa(""); setTlsServerName("");
    setSshEnabled(false); setSshHost(""); setSshPort("22"); setSshUser(""); setSshPassword(""); setSshFingerprint("");
    setConnectionTest("idle");
    setError("");
    setFormError("");
    setConnectionFormOpen(true);
  }
  function openAgentConnectionDraft(draft: AgentConnectionDraft) {
    openNewConnection();
    setEngine(draft.engine); setName(draft.name); setHost(draft.host ?? '');
    setPort(String(draft.port ?? (draft.engine === 'postgres' ? 5432 : 3306)));
    setDatabase(draft.database ?? ''); setUser(draft.user ?? '');
    setSsl(draft.engine !== 'sqlite');
  }
  return (
    <>
    <Toaster />
    <div className={`app-shell${aiExpanded ? " ai-expanded" : ""}`}>
      <aside className="sidebar" aria-label="工作区导航">
        <div className="brand">
          <span className="brand-mark"><AppIcon name="databaseZap" size={19} /></span>
          <div>
            <strong>DBPilot</strong>
            <small>DATABASE WORKSPACE</small>
          </div>
        </div>
        <div className="sidebar-main">
          <div className="sidebar-heading">
            <span>工作区</span>
            <Badge variant="secondary">{connections.length}</Badge>
          </div>
          <Button
            variant="outline"
            className="new-connection" id="new-connection"
            onClick={openNewConnection}
          >
            <AppIcon name="plus" /> 新建连接
          </Button>
          <ConnectionNavigator connections={connections} selectedId={connectionId} selectedDatabase={selectedDatabase} selectedTable={activeTable} api={api} onSelect={selectNavigation} onEdit={id => { editConnection(id); setConnectionFormOpen(true); }} onDelete={requestDelete} onTest={id => void testConnectionRow(id)} tests={rowTests} />
        </div>
        <div className="sidebar-footer">
          <span>DBPilot</span>
          <span>
            {window.dbpilotDesktop
              ? runtimeTarget.kind === "remote"
                ? "Remote"
                : "Local"
              : "Web Server"}
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>工作区</span>
            <span>/</span>
            <strong>{selected?.name ?? "未选择连接"}</strong>
            {selectedDatabase && <><span>/</span><strong>{selectedDatabase}</strong></>}
            {activeTable && (
              <>
                <span>/</span>
                <strong>{activeTable.name}</strong>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {runtimePersistent !== undefined && <Badge variant={runtimePersistent ? 'outline' : 'destructive'} title={runtimePersistent ? '连接、AI设置与会话保存在当前Runtime，重启后恢复；查询结果行仍有时限。' : '当前Runtime只使用内存，连接、AI设置与会话将在重启后丢失。'}>{runtimePersistent ? '持久保存' : '临时存储'}</Badge>}
            <PolicySettings connections={connections} api={api} />
            {window.dbpilotDesktop && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRuntimeSettingsOpen(true)}
              >
                <AppIcon name={runtimeTarget.kind === "local" ? "monitor" : "server"} />{runtimeTarget.kind === "local" ? "本地运行" : "远端运行"}
              </Button>
            )}
          </div>
        </header>
        <div className="main-grid">
          <main className="center-pane">
            <div className="data-toolbar">
              <div className="data-context">
                <span className="context-icon"><AppIcon name={activeTable ? "table" : execution ? "terminal" : "database"} size={19} /></span>
                <div>
                  <strong>
                    {activeTable
                      ? activeTable.name
                      : execution
                        ? "查询结果"
                        : "数据工作区"}
                  </strong>
                  <small>
                    {activeTable
                      ? `${activeTable.schema || selected?.name} · ${selected?.name}`
                      : selected
                        ? selected.name
                        : "选择左侧的连接或数据表"}
                  </small>
                </div>
              </div>
              <div className="data-actions">
                {activeTable && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void runSql()}
                    disabled={submitting || busy}
                  >
                    <AppIcon name="refresh" />刷新数据
                  </Button>
                )}
                {!consoleOpen && <Button variant="outline" size="sm" onClick={() => { setConsoleTab("sql"); setConsoleOpen(true); }}><AppIcon name="terminal" />打开 SQL 控制台</Button>}
              </div>
            </div>

            {consoleOpen && (
              <section className="console-panel expanded" aria-label="SQL 控制台">
                <div className="console-tabs" role="tablist" aria-label="控制台视图">
                  <Button variant={consoleTab === "sql" ? "secondary" : "ghost"} size="sm" role="tab" aria-selected={consoleTab === "sql"} onClick={() => setConsoleTab("sql")}><AppIcon name="terminal" />SQL 编辑器</Button>
                  <Button variant={consoleTab === "history" ? "secondary" : "ghost"} size="sm" role="tab" aria-selected={consoleTab === "history"} onClick={() => setConsoleTab("history")}><AppIcon name="history" />执行记录 <span>{history.length}</span></Button>
                  <Button variant={consoleTab === "log" ? "secondary" : "ghost"} size="sm" role="tab" aria-selected={consoleTab === "log"} onClick={() => setConsoleTab("log")}><AppIcon name="log" />命令日志</Button>
                  <span className="console-connection">{selected?.name ?? "未选择连接"}{selectedDatabase ? ` / ${selectedDatabase}` : ""}</span>
                  <Button variant="ghost" size="sm" className="console-close" onClick={() => setConsoleOpen(false)} aria-label="收起 SQL 控制台">收起</Button>
                </div>
                <div className="console-content">
                  {consoleTab === "sql" ? <>
                  <React.Suspense fallback={<div className="sql-editor" role="status">正在加载 SQL 编辑器…</div>}><SqlEditor
                    value={sql}
                    onChange={(value) => {
                      setSql(value);
                      if (activeTable) {
                        const identifier = [activeTable.schema, activeTable.name]
                          .filter(Boolean)
                          .map((part) => `${quote}${part.replaceAll(quote, quote + quote)}${quote}`)
                          .join(".");
                        if (value !== `SELECT * FROM ${identifier} LIMIT 100;`)
                          setActiveTable(null);
                      }
                    }}
                    onExecute={() => void runSql()}
                  /></React.Suspense>
                  <div className="console-actions">
                    <span>⌘ / Ctrl + Enter 执行</span>
                    <div className="console-action-buttons">
                      {execution && <span className="console-execution-status">执行{statusText(execution.status)}</span>}
                      {busy && <Button variant="outline" size="sm" onClick={() => void cancelExecution()}>{execution?.status === "cancel_pending" ? "取消已请求" : "取消执行"}</Button>}
                      <Button size="sm" onClick={() => void runSql()} disabled={!connectionId || (selected?.engine !== "sqlite" && !selectedDatabase) || !sql.trim() || submitting || busy}>
                        <AppIcon name={submitting ? "loader" : "play"} className={submitting ? "icon-spin" : undefined} />{submitting ? "执行中…" : "执行 SQL"}
                      </Button>
                    </div>
                  </div>
                  </> : consoleTab === "history" ? (
                    <div className="console-history" role="tabpanel">
                      {history.length === 0 ? <p>本次会话还没有执行记录。</p> : history.map((item) => (
                        <Button variant="ghost" className="history-entry" key={item.id} onClick={() => void openHistory(item)}>
                          <span><strong>{statusText(item.status)}</strong><small>{new Date(item.startedAt).toLocaleString()} · {item.connection}{item.database ? ` / ${item.database}` : ""}{item.resultAvailable ? "" : " · 无可用结果快照"}</small></span>
                          <code>{item.sql}</code>
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className="console-log" role="tabpanel" aria-label="命令日志">
                      {visibleLog.length === 0 ? <p>还没有命令日志。</p> : visibleLog.map((item) => (
                        <div key={item.id}><time>{new Date(item.time).toLocaleTimeString()}</time><code>{item.text}</code></div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}
            <Card className="data-panel">
              <div className="data-panel-header">
                <Tabs
                  value={activeView}
                  onValueChange={(value) =>
                    setActiveView(value as "results" | "schema")
                  }
                >
                  <TabsList variant="line" className="data-tabs">
                    <TabsTrigger value="results"><AppIcon name="table" />数据</TabsTrigger>
                    <TabsTrigger value="schema"><AppIcon name="columns" />结构</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="data-meta">
                  {activeView === "results" && execution && <Button variant="ghost" size="sm" disabled={refreshingExecution} onClick={() => void refreshDisplayedExecution()} aria-label="刷新执行状态" title="只读取原执行状态，不重新执行 SQL"><AppIcon name="refresh" className={refreshingExecution ? "icon-spin" : undefined} />刷新状态</Button>}
                  {activeView === "results" && execution && (
                    <Badge variant="secondary">{statusText(execution.status)}</Badge>
                  )}
                  {activeView === "results" && activePage && <span>{activePage.rows.length} 行已加载</span>}
                  {activeView === "results" && activeResult?.truncated && (
                    <Badge variant="outline">已截断</Badge>
                  )}
                </div>
              </div>
              {execution && executionReadWarning?.id === execution.id && <p className="result-note execution-read-warning" role="status">{executionReadWarning.message}</p>}
              {activeView === "schema" ? (
                <div className="structure-view">
                  {activeTable ? (
                    <>
                      <div className="structure-heading">
                        <strong>{activeTable.name}</strong>
                        <span>{activeTable.columns.length ? `${activeTable.columns.length} 个字段` : "字段尚未加载或不可见"}</span>
                      </div>
                      <div className="structure-table">
                        <div className="structure-row structure-head">
                          <span>字段</span>
                          <span>类型</span>
                          <span>可为空</span>
                        </div>
                        {activeTable.columns.map((column) => (
                          <div className="structure-row" key={column.name}>
                            <span>{column.name}</span>
                            <span>{column.type}</span>
                            <span>{column.nullable ? "是" : "否"}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state">
                      <span className="empty-icon"><AppIcon name="table" size={28} /></span>
                      <strong>选择一张数据表</strong>
                      <p>表结构会在这里展示，左侧导航只保留表层级。</p>
                    </div>
                  )}
                </div>
              ) : activeResult ? (
                <div className="data-result">
                  <div className="result-summary">
                    <span>
                      结果 {activeResultIndex + 1} · {statusText(activeResult.status)}
                    </span>
                    <span>
                      {activeResult.affectedRows !== undefined
                        ? `影响 ${activeResult.affectedRows} 行`
                        : execution?.id.slice(0, 8)}
                    </span>
                  </div>
                  {execution?.resultAvailable === false && !activeResult.columns && (
                    <div className="result-note">结果快照已过期，执行状态和 SQL 历史仍可查看，不会自动重跑。需要新数据时，请单独执行只读查询。</div>
                  )}
                  {activeResult.rolledBack && (
                    <div className="result-note">此步骤已回滚</div>
                  )}
                  {activeResult.columns && activeResult.resultAvailable === false && (
                    <div className="result-note">结果快照已过期或因缓存容量释放，SQL 和执行状态仍保留，不会自动重跑。需要新数据时，请单独执行只读查询。</div>
                  )}
                  {activeResult.columns && activeResult.resultAvailable !== false && (
                    <ResultGrid
                      columns={activeResult.columns}
                      rows={activePage?.rows ?? []}
                    />
                  )}
                  {activeResult.columns && activeResult.resultAvailable !== false && (
                    <div className="grid-footer">
                      <span>{activePage?.rows.length ?? 0} 行 · {activeResult.columns.length} 列</span>
                      <span>{activePage?.nextCursor ? "还有更多数据" : "当前结果已加载"}</span>
                    </div>
                  )}
                  {activeResult.resultAvailable !== false && execution?.resultAvailable !== false && activePage?.nextCursor && (
                    <div className="load-more">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void loadPage(
                            execution!.id,
                            activeResultIndex,
                            activePage.nextCursor!,
                          )
                        }
                      >
                        加载更多行
                      </Button>
                    </div>
                  )}
                  {execution && execution.results.length > 1 && (
                    <div className="result-steps">
                      {execution.results.map((result, index) => (
                        <Button
                          variant={
                            index === activeResultIndex ? "secondary" : "ghost"
                          }
                          size="sm"
                          key={index}
                          onClick={() => setActiveResultIndex(index)}
                        >
                          结果 {index + 1} · {statusText(result.status)}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-icon"><AppIcon name="table" size={28} /></span>
                  <strong>
                    {activeTable
                      ? `${activeTable.name} 的数据`
                      : "打开数据库表"}
                  </strong>
                  <p>
                    {activeTable
                      ? "正在加载表数据，执行结果会显示在这里。"
                      : "从左侧选择连接与表，数据会显示在这里。"}
                  </p>
                  {!activeTable && !consoleOpen && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConsoleOpen(true)}
                    >
                      <AppIcon name="terminal" />打开 SQL 控制台
                    </Button>
                  )}
                </div>
              )}
            </Card>
          </main>
          <PaneDivider />
          <AgentPanel onResultExpired={source => setExecution(previous => previous?.id === source.executionId ? { ...previous, results: previous.results.map((result, index) => index === source.setId ? { ...result, resultAvailable: false } : result) } : previous)} expanded={aiExpanded} onToggleExpanded={() => setAiExpanded(value => !value)} onViewExecution={(id, targetId) => void openAgentExecution(id, targetId)} selectedResult={execution && execution.status !== "running" && activeResult?.columns && activeResult.resultAvailable !== false ? {executionId:execution.id,setId:activeResultIndex,connectionId} : undefined} onConnectionDraft={openAgentConnectionDraft} settings={<AiSettings api={api} onConfigured={setAiConfigured} />} runtimeId={runtimeId} configured={aiConfigured} connections={connections} selectedId={connectionId} api={api} onActiveChange={setAgentActive} onDraft={(draft, targetId, targetDatabase) => { if (busy || submitting) { setError("请先等待当前查询完成或取消执行。"); return; } resultSelection.current++; if (targetId !== connectionId || (targetDatabase ?? "") !== selectedDatabase) { setExecution(null); setPages({}); } setAiExpanded(false); setConnectionId(targetId); setSelectedDatabase(targetDatabase ?? connections.find(item => item.id === targetId)?.database ?? ""); setSql(draft); setConsoleOpen(true); setConsoleTab("sql"); setActiveTable(null); }}>
          </AgentPanel>
        </div>
      </div>
      <Dialog open={connectionFormOpen} onOpenChange={setConnectionFormOpen}>
        <DialogContent className="connection-modal" showCloseButton={false}>
          <div className="modal-header">
            <div>
              <span className="overline">DATABASE CONNECTION</span>
              <DialogTitle>{editingId ? "编辑连接" : "新建连接"}</DialogTitle>
            </div>
            <Button
              className="modal-close"
              onClick={() => setConnectionFormOpen(false)}
              aria-label="关闭"
            >
              <AppIcon name="close" />
            </Button>
          </div>
          <form
            onSubmit={async (event) => {
              await createConnection(event);
            }}
          >
            <div className="modal-fields">
              <Label>
                连接名称
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：生产数据仓库"
                  required
                />
              </Label>
              <Label>
                数据库类型
                <Select
                  value={engine}
                  onValueChange={(value) => {
                    setEngine(value as Connection["engine"]);
                    setPort(value === "postgres" ? "5432" : "3306");
                  }}
                >
                  <SelectTrigger aria-label="数据库类型">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sqlite">SQLite</SelectItem>
                    <SelectItem value="postgres">PostgreSQL</SelectItem>
                    <SelectItem value="mysql">MySQL</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              {engine === "sqlite" ? (
                <div className="file-field">
                  <Label htmlFor="connection-filename">数据库文件路径</Label>
                  <div className="file-input">
                    <Input id="connection-filename"
                      value={filename}
                      onChange={(e) => setFilename(e.target.value)}
                      placeholder="/data/sample.db"
                      required
                    />
                    {window.dbpilotDesktop &&
                      runtimeTarget.kind === "local" && (
                        <Button
                          type="button"
                          onClick={() => void pickSqliteFile()}
                        >
                          浏览
                        </Button>
                      )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="field-row">
                    <Label>
                      主机
                      <Input
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        required
                      />
                    </Label>
                    <Label>
                      端口
                      <Input
                        type="number"
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                        required
                      />
                    </Label>
                  </div>
                  <Label>
                    默认数据库（可选）
                    <Input
                      value={database}
                      onChange={(e) => setDatabase(e.target.value)}
                      placeholder="留空，连接后选择数据库"
                    />
                  </Label>
                  <Label>
                    用户名
                    <Input
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                      required
                    />
                  </Label>
                  <Label>
                    密码
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={editingId ? "目标和安全配置未变时，留空保留" : "输入密码"}
                    />
                  </Label>
                  {editingId && <small>更换主机、端口、账号、TLS或SSH身份后，请重新填写数据库密码；留空不会沿用旧密码。</small>}
                  <Label className="ssl-option">
                    <Input
                      type="checkbox"
                      checked={ssl}
                      onChange={(e) => setSsl(e.target.checked)}
                    />
                    <span>启用 TLS · 验证 CA 与服务器名</span>
                  </Label>
                  <details className="ssh-settings"><summary>SSH 隧道</summary>
                    {editingId && <small>更换主机、端口、账号、TLS或SSH身份后，请重新填写数据库密码；留空不会沿用旧密码。</small>}
                  <Label className="ssl-option"><Input type="checkbox" checked={sshEnabled} onChange={event => setSshEnabled(event.target.checked)} /><span>通过 SSH 跳板机连接</span></Label>
                    {sshEnabled && <div className="ssh-fields">
                      <Label htmlFor="ssh-host">SSH 主机</Label><Input id="ssh-host" value={sshHost} onChange={event=>setSshHost(event.target.value)} required />
                      <Label htmlFor="ssh-port">SSH 端口</Label><Input id="ssh-port" type="number" min={1} max={65535} value={sshPort} onChange={event=>setSshPort(event.target.value)} required />
                      <Label htmlFor="ssh-user">SSH 用户名</Label><Input id="ssh-user" value={sshUser} onChange={event=>setSshUser(event.target.value)} required />
                      <Label htmlFor="ssh-password">SSH 密码</Label><Input id="ssh-password" type="password" autoComplete="new-password" value={sshPassword} onChange={event=>setSshPassword(event.target.value)} placeholder={editingId ? '留空仅保留同一跳板机身份的密码' : '跳板机密码'} />
                      <Label htmlFor="ssh-fingerprint">已核验的主机指纹</Label><Input id="ssh-fingerprint" value={sshFingerprint} onChange={event=>setSshFingerprint(event.target.value)} placeholder="SHA256:…" required />
                      <small>请从服务器管理员或可信渠道核对 SHA256 指纹。指纹变化会阻断连接；不会自动接受新密钥。上方数据库地址由跳板机访问。</small>
                    </div>}
                  </details>
                  {ssl && <>
                    <Label htmlFor="tls-server-name">证书服务器名</Label>
                    <Input id="tls-server-name" value={tlsServerName} maxLength={253} placeholder="留空使用连接主机名" onChange={event => setTlsServerName(event.target.value)} />
                    <small>MySQL 使用 IP 地址连接时，请填写证书中的 DNS 名称。此字段不改变实际连接地址。</small>
                    <Label htmlFor="tls-ca">私有 CA 证书（PEM，可选）</Label>
                    <Textarea id="tls-ca" value={tlsCa} maxLength={128000} placeholder="-----BEGIN CERTIFICATE-----" spellCheck={false} onChange={event => setTlsCa(event.target.value)} />
                    <small>留空使用系统信任库；仅粘贴公开 CA 证书，不要填写私钥。</small>
                  </>}
                </>
              )}
              {formError && (
                <div className="modal-error" role="alert">
                  {formError}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <Button type="button" variant="outline" className="quiet-button" onClick={() => void testConnectionForm()} disabled={formConnectionTest === "testing"}>
                {formConnectionTest === "testing" ? "测试中…" : "测试连接"}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="outline" className="danger-button"
                  onClick={() => {
                    const connection = connections.find(item => item.id === editingId);
                    if (connection) requestDelete(connection);
                  }}
                >
                  删除连接
                </Button>
              )}
              <Button
                type="button"
                variant="outline" className="quiet-button"
                onClick={() => setConnectionFormOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" className="primary-button">
                <AppIcon name={editingId ? "save" : "plus"} />{editingId ? "保存修改" : "创建连接"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!deleteCandidate} onOpenChange={open => { if (!open && !deleting) setDeleteCandidate(null); }}>
        <DialogContent className="delete-connection-modal" onCloseAutoFocus={event => { event.preventDefault(); const trigger = deleteTrigger.current; if (trigger?.isConnected) trigger.focus(); else document.getElementById('new-connection')?.focus(); }}>
          <DialogTitle>删除连接记录</DialogTitle>
          <p>确定删除连接「{deleteCandidate?.name}」？这会移除保存的连接配置，不会删除数据库、表或数据。</p>
          <p className="settings-help">{deleteCandidate?.engine === 'sqlite' ? deleteCandidate.filename : `${deleteCandidate?.host ?? ''}:${deleteCandidate?.port ?? ''}${deleteCandidate?.database ? ` / ${deleteCandidate.database}` : ' · 服务器连接'}`}</p>
          <div className="policy-actions"><Button variant="outline" disabled={deleting} onClick={() => setDeleteCandidate(null)}>取消</Button><Button variant="destructive" disabled={deleting} onClick={() => void deleteConnection()}><AppIcon name={deleting ? 'loader' : 'trash'} className={deleting ? 'icon-spin' : undefined} />{deleting ? '正在删除…' : '确认删除'}</Button></div>
        </DialogContent>
      </Dialog>
      {runtimeSettingsOpen && (
        <Dialog
          open={runtimeSettingsOpen}
          onOpenChange={setRuntimeSettingsOpen}
        >
          <DialogContent
            className="connection-modal runtime-modal"
            showCloseButton={false}
          >
            <div className="modal-header">
              <div>
                <span className="overline">RUNTIME TARGET</span>
                <DialogTitle>运行目标</DialogTitle>
              </div>
              <Button
                className="modal-close"
                onClick={() => setRuntimeSettingsOpen(false)}
                aria-label="关闭"
              >
                <AppIcon name="close" />
              </Button>
            </div>
            <div className="modal-fields">
              <p>
                当前：
                {runtimeTarget.kind === "local"
                  ? "本地 Core"
                  : runtimeTarget.baseUrl}
              </p>
              <Label>
                远端地址
                <Input
                  value={remoteUrl}
                  onChange={(e) => setRemoteUrl(e.target.value)}
                  placeholder="https://your-server.example"
                />
              </Label>

            </div>
            <div className="modal-actions">
              <Button
                variant="outline" className="quiet-button"
                onClick={() => void switchRuntime("local")}
              >
                使用本地
              </Button>
              <Button
                className="primary-button"
                onClick={() => void switchRuntime("remote")}
                disabled={!remoteUrl.trim()}
              >
                连接远端 <AppIcon name="arrowRight" />
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
    </>
  );
}

# AI 数据库管理工具

## 同类产品技术调研与架构建议

目标：本地 / 服务器部署 · Web / Desktop 双端 · AI 原生集成 · 远程数据库访问

> 结论预览  推荐采用「共享 Web UI + TypeScript Core Service + Electron 桌面壳 + Server Runtime」的双运行时架构。桌面端由 Electron Main/本地 Node 服务直接使用数据库原生驱动；Web 端通过服务端 API 代理数据库连接。AI 层优先使用原生 TypeScript fetch/SDK + Tool Calling，不强依赖 LangChain；MCP 作为对外 Agent 接口而不是内部必选总线。

文档包含：同类开源工具分析、技术栈/协议清单、架构选型、AI 接入方式、远程连接、安全模型、部署方式及 MVP 路线图。

## 1. 项目目标与关键约束

你要做的并不是一个单纯的 SQL 编辑器，而是一个可以在本地桌面与服务器 Web 两种形态运行的 AI-native 数据库工作台。架构设计的核心，是把 UI、数据库连接能力、AI Agent 能力和部署形态解耦。

| 目标 | 工程含义 | 关键约束 |
| --- | --- | --- |
| Web + Desktop | 同一套前端尽量复用，桌面提供本地系统能力 | 浏览器不能直接使用任意 TCP 数据库协议 |
| 本地 + 服务器部署 | 桌面可单机运行，服务器可 Docker 化 | 连接配置、密钥、文件路径与权限模型需兼容两种模式 |
| AI 原生接入 | 自然语言转 SQL、解释、优化、执行计划、Agent 工具调用 | 优先原生 TS/Python，不把框架绑定到 LangChain/LlamaIndex |
| 远程数据库访问 | 支持公网、内网、SSH/Bastion、TLS | 需要数据库原生驱动、SSH Tunnel、证书与连接池 |
| 未来可扩展 | 更多数据库、插件、MCP、团队协作 | 数据库能力需要统一 Adapter/Driver 接口 |

> 最重要的技术事实  浏览器端 JavaScript 无法像 Node/Electron 那样任意打开 TCP Socket 去直连 PostgreSQL/MySQL。因此 Web 版本必须通过服务器端连接数据库；桌面版本则可以让 Electron Main/本地 Node Runtime 直接使用 pg、mysql2、mssql 等驱动。这也是 DbGate、Outerbase Studio 等项目采用“浏览器 UI + 后端/桌面桥接层”的根本原因。

## 2. 同类开源工具调研

本次重点选择能够直接影响技术选型的项目，而不是只比较 UI 功能。以下项目分别代表了 Web/Desktop 复用、AI SQL、企业数据库治理、浏览器数据引擎等方向。

| 项目 | 定位 | 主要技术/形态 | 对你的参考价值 |
| --- | --- | --- | --- |
| DbGate | 跨平台数据库管理器 | Svelte + Node.js/Express + TS/JS + Electron；Web 可单 Docker 部署 | 与你目标最接近的 Web/Desktop 双运行时参考 |
| Chat2DB | AI 数据库客户端 | 桌面 + Web + Docker；AI SQL；现版本社区版 local-first | 参考 AI SQL、连接管理与产品形态 |
| CloudBeaver / DBeaver | 通用数据库管理器 | CloudBeaver: TS/React + Java Server；DBeaver 复用 JDBC 驱动平台 | 参考 Driver abstraction、SSH Tunnel、权限与多数据库支持 |
| Outerbase Studio | 轻量浏览器数据库 GUI | Web-first；Desktop 是 Electron wrapper，用桌面能力补足浏览器驱动限制 | 非常直观地说明 Web 与 Desktop 连接能力的边界 |
| Bytebase | 数据库治理 / DevOps | Web Server；REST/gRPC；RBAC、审计、SQL Review、MCP | 参考团队模式、安全审计、Agent 权限 |
| Mako | AI-native SQL Client | React/Vite + Hono/Node + 多 DB drivers + Vercel AI SDK + DuckDB-WASM | 参考 AI-first 架构、浏览器分析和 TypeScript 后端 |
| MindsDB Engine | AI/数据查询引擎 | Python 为主；同时暴露 HTTP、MySQL wire、PostgreSQL wire | 参考“一个引擎，多协议入口”设计 |

### 2.1 DbGate：最接近你的工程形态

DbGate 的设计目标明确写出了：前端 Svelte、后端 Node.js + Express + 数据库驱动、JavaScript/TypeScript、桌面 Electron；同一项目既能作为服务器上的 Web 应用运行，也能作为 Windows/Linux/macOS Electron 应用运行。开发模式也明确区分 API、Web 与 Electron app。

- 可复用的核心思想：把数据库连接能力放在 Node runtime，而不是 UI 组件内部。

- Web 模式：Browser → HTTP API → Node Backend → DB Driver → Database。

- Desktop 模式：Renderer → Electron IPC / Local API → Main/Node Runtime → DB Driver → Database。

- 插件化驱动非常适合后续支持更多数据库。

### 2.2 Chat2DB：AI 与数据库客户端融合

Chat2DB 直接覆盖了“Windows/macOS 本地安装 + 服务器部署 + Web 访问 + AI SQL”的产品形态。其公开资料强调自然语言转 SQL、SQL 解释、SQL 优化建议，并支持 MySQL、PostgreSQL、Oracle、SQL Server、ClickHouse、SQLite 等多数据库。当前社区路线强调 local-first、自定义 AI model 和 MCP 支持。

- 值得借鉴：AI 不应只是聊天侧栏，而要与 schema、SQL Editor、执行结果形成上下文闭环。

- 值得借鉴：连接信息、安全凭据和 AI provider 配置都需要独立配置域。

- 不建议照搬：Java 后端并非你的必要条件；如果你希望 TS-first，可用 Node 驱动层实现同样抽象。

### 2.3 CloudBeaver / DBeaver：数据库驱动与远程连接能力

DBeaver 的优势在于成熟的 database connectivity abstraction：JDBC、SQL parser、SSH 等被抽成平台能力；CloudBeaver 则复用 DBeaver 后端能力，提供 TypeScript/React Web UI，并支持服务器部署、SSH tunnel、用户/角色安全模型与 Kubernetes。

- 关键启发：数据库能力层应该独立于 UI；每种数据库实现统一的 connect / metadata / query / transaction / cancel / explain 接口。

- SQL 方言与语法解析应单独抽象，不要把 MySQL/PostgreSQL 差异散落在 UI。

### 2.4 Outerbase Studio：浏览器能力边界的典型案例

Outerbase Studio 是 browser-first 的数据库 GUI，但其 Desktop 版本明确使用 Electron wrapper，并说明桌面版本用来支持浏览器环境中不容易实现的 MySQL/PostgreSQL 驱动。这与本项目的核心技术约束完全一致。

> 架构判断  不要追求“浏览器直接连接所有数据库”。更稳妥的产品定义是：Web UI 通过 Database Gateway 访问数据；Desktop UI 可以选择 Local Direct Mode 或 Remote Gateway Mode。这样既满足本地开发，又支持企业内网与服务器集中管理。

### 2.5 Bytebase：权限、审计和 AI Agent 的企业参考

Bytebase 当前定位是数据库治理控制平面，强调 change management、fine-grained RBAC、JIT access、数据脱敏、审计日志，并提供 MCP Server 与 Text-to-SQL。它对你的价值主要在“当 AI 可以执行 SQL 后，怎样控制风险”。

- AI 生成 SQL ≠ AI 自动执行 SQL。查询、DDL、DML、危险命令需要不同权限和确认策略。

- 每次 AI tool invocation 应写审计日志：用户、连接、SQL、参数、执行时间、行数、错误和审批状态。

### 2.6 Mako：TypeScript-first 的 AI-native 参考

Mako 的公开架构采用 React + Vite 前端、Hono + Node.js API、多个数据库 Driver、Monaco SQL Editor，并使用 Vercel AI SDK 进行多模型抽象；其 dashboard 还使用 DuckDB-WASM、Arrow/Parquet 等浏览器分析技术。

- 与你最贴近的点：AI Agent 与 DB Drivers 同处服务端 TypeScript runtime，可以保持整个核心链路为 TS。

- 后续若加入本地分析/大结果集，可考虑 Apache Arrow + DuckDB-WASM，而不是把所有查询结果转成巨大 JSON。

## 3. 建议的总体技术架构

> 推荐主线  React（或 Vue）共享 UI + TypeScript Core + Electron Desktop + Node Server。Python 仅作为可选能力进程，用于模型推理、Notebook、复杂数据科学任务；不要让 Python 成为 Web/Desktop 两套代码之间的强制中间层。

```text
┌──────────────────────── Shared UI ────────────────────────┐
│ React/Vue + TypeScript + Monaco + DataGrid + AI Chat     │
└───────────────┬───────────────────────┬──────────────────┘
                │                       │
        Desktop Runtime             Web Runtime
                │                       │
      Electron preload/IPC          HTTPS REST/SSE
                │                       │
      ┌─────────▼────────┐       ┌──────▼──────────┐
      │ Local Core       │       │ Server Core     │
      │ Node/TypeScript  │       │ Node/TypeScript │
      └─────────┬────────┘       └──────┬──────────┘
                │                       │
      ┌─────────▼───────────────────────▼──────────┐
      │ Database / AI Core                         │
      │ Driver Adapters · SSH · Secrets · AI Tools│
      └───────┬───────────────┬───────────────────┘
              │               │
        DB Wire/TLS       AI HTTP/SSE
              │               │
     PostgreSQL/MySQL/...  LLM Providers / Local Models

Optional: MCP Server (stdio locally / Streamable HTTP remotely)
```

### 3.1 前端层

| 模块 | 推荐技术 | 理由 |
| --- | --- | --- |
| 框架 | React + TypeScript（或继续使用熟悉的 Vue 3） | 两者都适合 Web/Electron 共用；React 在 AI SDK/数据工具生态稍丰富 |
| 构建 | Vite | 桌面与 Web 都轻量，Electron 集成成熟 |
| SQL Editor | Monaco Editor | 语法高亮、补全、快捷键和大文本处理成熟 |
| 结果表格 | AG Grid / TanStack Table + 虚拟列表 | 数据库结果需要列固定、虚拟滚动、复制、筛选 |
| 状态管理 | Zustand / Pinia | 保持 UI 状态简单，不与数据库连接生命周期混杂 |
| 请求层 | fetch + typed API client | 尽量保持原生；SSE 可直接读取 ReadableStream |

### 3.2 Core Server / Desktop Core

| 能力 | TypeScript 推荐 | 备注 |
| --- | --- | --- |
| HTTP API | Hono / Fastify | Hono 足够轻；Fastify 插件生态更成熟；早期不必上 NestJS |
| PostgreSQL | pg | 成熟的 Node PostgreSQL driver |
| MySQL/MariaDB | mysql2 | Promise API、prepared statements |
| SQL Server | mssql / tedious | Node 生态常见方案 |
| SQLite | better-sqlite3 / sqlite3 | 桌面本地数据库优先 better-sqlite3 |
| MongoDB | mongodb official driver | 直接使用官方 Node driver |
| SSH Tunnel | ssh2 | 支持 jump host / local forwarding，可包装成 TunnelManager |
| TLS | Node tls + driver SSL options | 证书、CA、client cert 均由连接 profile 管理 |
| 密钥存储 | Electron safeStorage / OS keychain；服务端 KMS/加密文件 | 不要将密码明文写入浏览器 localStorage |
| SQL parsing | node-sql-parser / ANTLR grammar（逐步引入） | 先做 statement 分类和风险识别，再扩展完整 AST |

### 3.3 Electron 是否合适？

适合，而且对第一版尤其合适。Electron 的主进程拥有 Node/系统能力，Renderer 保持 Web UI；官方推荐通过 contextIsolation + preload + contextBridge 暴露最小 API，并使用 IPC 与 Main 进程通信。这样共享 UI 的成本最低。

| 方案 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- |
| Electron | Node 生态与 DB driver 完整；Web 复用最直接；开发快 | 包体和内存较大 | 第一版首选 |
| Tauri 2 | 包体小；系统 WebView；Rust 后端安全边界好 | 数据库/SSH/AI 逻辑若坚持 TS 会多一层 Rust bridge | 后续对包体敏感再评估 |
| 纯浏览器 PWA | 部署最简单 | 不能直接使用任意数据库 TCP driver / 本地 SSH 能力受限 | 只作为 Web UI，不作为完整本地客户端 |

## 4. 必要的通信协议与连接协议

这里建议把“应用协议”和“数据库协议”分开。你的产品内部无需自己实现 PostgreSQL/MySQL wire protocol，优先让成熟 driver 处理；你需要设计的是 UI ↔ Core、Core ↔ AI、Core ↔ Remote Agent 的协议。

| 层级 | 协议/机制 | 使用场景 | 建议 |
| --- | --- | --- | --- |
| Browser ↔ Server | HTTPS + REST/JSON | 连接管理、schema、query、settings | 主 API |
| Browser ↔ Server | SSE / HTTP streaming | LLM token、Agent step、查询进度、日志 | AI streaming 首选 |
| Browser ↔ Server | WebSocket | 终端、双向实时 session、多路事件 | 按需，不要所有接口都 WebSocket |
| Electron Renderer ↔ Main | Electron IPC + contextBridge | 文件、Keychain、本地 DB、SSH、本地进程 | 桌面专用 |
| Core ↔ PostgreSQL | PostgreSQL wire over TCP/TLS | 数据库连接 | 使用 pg driver |
| Core ↔ MySQL | MySQL Client/Server Protocol over TCP/TLS | 数据库连接 | 使用 mysql2 driver |
| Core ↔ Remote Network | SSH2 / SSH port forwarding | Bastion / 内网 DB | 非常必要 |
| Core ↔ LLM | HTTPS JSON + SSE/streaming | OpenAI-compatible / Anthropic / Gemini / self-host | Provider Adapter |
| AI Agent ecosystem | MCP: JSON-RPC + stdio / Streamable HTTP | 让外部 AI/IDE 调用你的 DB tools | 建议作为扩展接口 |
| Service ↔ Service | REST；必要时 gRPC | 未来多进程/多服务 | MVP 先 REST，别过早复杂化 |

### 4.1 为什么 AI Streaming 推荐 SSE / HTTP Stream

AI 回答和 Agent 执行天然是“客户端发一次请求，服务端持续推送 token / tool event”。SSE 是单向 server→client，浏览器支持成熟，部署和代理配置通常比 WebSocket 简单；如果你直接使用 fetch ReadableStream，也可以做 NDJSON/event-stream。只有需要客户端与服务端持续双向交互的 session，才优先 WebSocket。

### 4.2 MCP 在这个产品里应该放在哪

MCP 不建议作为数据库客户端内部每一层之间的“万能 RPC”。更合理的定位是：你的应用本身可以充当 MCP Host/Client，也可以对外暴露 MCP Server。官方 MCP 使用 JSON-RPC，并定义 stdio（本地子进程）和 Streamable HTTP（远程）两种标准 transport。

- 本地桌面：可暴露 stdio MCP server，让 Codex/Claude Code/其他 Host 调用 query、describe_schema、explain_sql 等工具。

- 服务器：暴露带认证的 Streamable HTTP MCP endpoint。

- 内部 UI → Core 仍用 typed API/IPC，调试和性能更直接。

## 5. AI 层：尽可能“原生”的实现方式

> 建议  第一版不要引入重型 Agent 框架。用 TypeScript 自己实现 ProviderAdapter + Message/Tool schema + Tool Executor + Approval Gate，已经足够覆盖自然语言转 SQL、SQL 解释、优化和可控执行。

```typescript
interface LLMProvider {
  stream(messages, tools, options): AsyncIterable<AIEvent>
}

interface DatabaseTool {
  name: string
  inputSchema: JSONSchema
  execute(ctx, input): Promise<ToolResult>
}

AI loop:
User → collect schema context → LLM → tool_call
→ policy/approval → execute DB tool → tool_result → LLM → answer
```

AI 定位为对话式、工具驱动的数据库 Agent，采用单 Agent + 多个受控工具。用户以自然语言提出任务，Agent 理解需求、检索 Schema、制定步骤、生成 SQL、检查风险、取得必要确认、执行并解释结果；信息不足时追问，修改后的 SQL 重新经过执行策略。

同一 Agent 提供建议模式与执行模式：建议模式仅解释、生成或修改 SQL；执行模式在授权范围内调用数据库工具。用户既可手写 SQL，也可让 AI 修改已有 SQL，再选择自行执行或交由 Agent 执行。模式切换不自动授权或执行旧草稿，首版无需多 Agent。

### 5.1 推荐的 AI Tool 集合

| Tool | 职责 | 默认权限 |
| --- | --- | --- |
| list_connections | 列出可用连接（不泄露密码） | 只读 |
| get_schema / search_schema | 按需读取 database/schema/table/column/index | 只读 |
| generate_sql | 生成新 SQL 或修改用户已有 SQL | 无执行权限 |
| explain_query | 生成执行计划；ANALYZE 按真实执行风险控制 | 只读/受控 |
| run_select | 只允许 SELECT / SHOW / DESCRIBE 等 | 按策略授权或确认，限制行数/超时 |
| run_mutation | INSERT/UPDATE/DELETE | 写权限 + 明确计划 + 必要确认 |
| run_ddl | CREATE/ALTER/DROP | 结构变更权限 + 明确确认 |
| cancel_query | 取消当前执行 | 允许 |
| export_result | 导出 CSV/JSON/Parquet | 按文件权限 |

### 5.2 Schema 上下文不要一次性全塞给模型

数据库稍大时，完整 schema 会迅速占满上下文。推荐建立轻量 Schema Catalog：连接后抓取 database/schema/table/column/index/comment 等元数据，本地缓存并支持搜索；AI 先用 search_schema 找候选表，再读取少量详细 schema。后续可以为表名、字段注释、业务描述建立 embedding，但不是 MVP 必需。

### 5.3 Python 放在哪里最合适

如果未来要支持本地模型、Notebook、Pandas/Polars、ML 或复杂数据分析，可以增加独立 Python Worker。主应用仍由 TS Core 调度：

- TS Core → spawn Python subprocess（本地）或 HTTP/gRPC（服务端）。

- Python Worker 只处理明确的数据科学/推理任务，不持有所有连接与权限逻辑。

- 这样 Web/Desktop 的连接、安全、审计仍保持一套 TypeScript 实现。

### 5.4 数据库操作能力与统一执行入口

系统应支持查询、新增、修改、删除数据，以及按数据库能力开放的表、字段、索引创建、修改和删除。只读是权限配置，不是 AI 能力上限。SQL 脚本、交互事务、用户授权及实例管理按具体能力逐项开放，管理操作使用独立权限。

用户手写 SQL、AI 生成或修改 SQL、后续界面数据编辑，统一进入执行计划、权限与风险检查、必要确认、数据库执行和审计链路。AI 与人工入口不能绕过同一策略。具体页面布局和 UI 功能细节暂不展开。

例如给订单表添加备注字段并查询缺少备注的订单，Agent 拆分结构变更与查询，展示目标、SQL 和影响；获授权后逐步执行，结构变更后刷新 Schema。后续步骤失败时报告部分完成，不自动重放已完成的写入。

## 6. 数据库 Driver 抽象建议

```typescript
interface DatabaseAdapter {
  connect(profile): Promise<Connection>
  testConnection(profile): Promise<TestResult>

  listDatabases(ctx): Promise<DatabaseInfo[]>
  listSchemas(ctx): Promise<SchemaInfo[]>
  listTables(ctx, filter): Promise<TableInfo[]>
  describeTable(ctx, table): Promise<TableDetail>

  query(ctx, sql, params?, options?): AsyncIterable<QueryEvent>
  cancel(queryId): Promise<void>
  begin/commit/rollback(...)

  explain(ctx, sql): Promise<ExplainResult>
  capabilities(): DatabaseCapabilities
}

PostgresAdapter | MySQLAdapter | SQLiteAdapter | MongoAdapter | ...
```

Adapter 必须返回统一结果模型，但不要过度“抹平”数据库特性。建议 capabilities() 声明是否支持 schemas、transactions、explain、cancel、stored procedures、multiple result sets 等，让 UI 和 AI 根据能力动态工作。

## 7. 远程服务器访问设计

### 7.1 三种连接模式

| 模式 | 链路 | 适用场景 |
| --- | --- | --- |
| Direct Local | Desktop → DB | 本机/局域网开发数据库，最低延迟 |
| SSH Tunnel | Desktop/Server → SSH Bastion → DB | 企业内网、云主机、跳板机 |
| Gateway | Browser/Desktop → HTTPS → AI DB Server → DB | 团队共享连接、统一审计、Web 版本 |

### 7.2 SSH Tunnel 需要支持的字段

- SSH host / port / username；password 或 private key；private-key passphrase。

- 支持 local forwarding：Core 在本机建立临时端口，再让数据库 driver 连接 127.0.0.1:localPort。

- 可选 ProxyJump / 多跳，但建议第二阶段再做。

- SSH session 与 DB connection pool 生命周期应分离管理，并能健康检查与自动重连。

### 7.3 TLS 与证书

数据库连接 Profile 应统一保存 sslMode、CA certificate、client certificate、client private key、serverName 等字段。服务端 Web 模式还应强制 UI ↔ Server 使用 HTTPS，并对 session/token 做过期和撤销。

## 8. 安全模型：AI 数据库工具必须从第一版考虑

| 风险 | 建议控制 |
| --- | --- |
| AI 误执行 DELETE/DROP | SQL 分类 + 分级授权 + 必要确认；只读为可选策略，DML/DDL 受对应权限控制 |
| Prompt injection 诱导读取敏感表 | 连接/Schema/表级 Allowlist；AI tool 层再次鉴权 |
| 数据库密码泄露给模型 | Prompt 永远不包含密码；连接凭据仅在 Core 中使用 |
| SQL 返回数据泄露 | 可配置敏感列 mask；发送给 LLM 前再做数据裁剪/脱敏 |
| Web 用户越权 | Server Core 做 RBAC，不信任前端传来的 connectionId 权限 |
| Electron RCE | contextIsolation=true；nodeIntegration=false；contextBridge 白名单 API |
| MCP 远程暴露 | Streamable HTTP 必须认证、校验 Origin，并限定工具权限 |
| 审计缺失 | 记录 AI 请求、tool call、SQL、连接、用户、结果元信息与错误 |

执行策略综合操作者、目标环境、数据库账号权限、语句类型和影响范围判断。查询可按策略直接执行或确认；DML 需写权限，DDL 需结构变更权限，无条件 UPDATE/DELETE、DROP 等需更严格授权。影响行数预估仅供参考，不能保证执行时数据未变化。

确认不能提升用户或数据库账号权限。审批绑定确切 SQL、参数、目标及配置版本，变更后重新审批；只读工具不能执行写入 CTE 或有副作用操作。未知语句拒绝执行。事务、DDL 回滚能力按方言声明，已提交或不可回滚操作不能承诺撤销；提交后断线时报告结果未知，不自动重试。

## 9. 部署形态建议

### 9.1 Desktop 单机版

```text
Electron Renderer (shared UI)
      │ IPC
Electron Main / Local Core (Node/TS)
      ├─ DB drivers
      ├─ SSH tunnel
      ├─ local encrypted connection store
      └─ LLM provider / local model endpoint
```

优点是无需服务器即可使用，对本机数据库和公司 VPN 内数据库非常友好。连接凭据优先使用系统 Keychain/Electron safeStorage；配置数据库可使用 SQLite。

### 9.2 Self-hosted Web

```text
Browser
   │ HTTPS REST + SSE
Reverse Proxy (Nginx/Caddy)
   │
AI DB Server (Node/TS)
   ├─ API/Auth/RBAC/Audit
   ├─ DB drivers + pools + SSH
   ├─ AI agent/tools
   └─ metadata DB (Postgres/SQLite)

Docker Compose → later Kubernetes if needed
```

MVP 自托管建议 Docker Compose：app + metadata database（可先 SQLite/Postgres）即可。无需一开始拆成微服务。

### 9.3 Desktop 连接 Remote Server

这是非常值得支持的一种模式：Electron UI 可以切换 RuntimeTarget。Local Runtime 用于本地直连；Remote Runtime 直接调用服务器 API，从而获得团队共享连接、权限、审计和统一 AI 配置。UI 层不需要重写。

## 10. 推荐代码仓库结构

```text
apps/
  web/                    # Vite React/Vue UI
  desktop/                # Electron main + preload + packaging
  server/                 # Hono/Fastify HTTP server
packages/
  ui/                     # shared UI components
  protocol/               # shared request/event types, zod schemas
  db-core/                # adapters, query runner, metadata
  db-postgres/
  db-mysql/
  db-sqlite/
  ssh/                     # tunnel manager
  ai-core/                 # provider adapters + agent loop + tools
  security/                # policy, SQL classification, approvals
  storage/                 # encrypted settings / metadata
  mcp-server/              # optional MCP exposure
workers/
  python/                  # optional notebook / model / analytics worker
```

## 11. 第一阶段技术选型建议（可直接立项）

| 类别 | 建议选型 | 优先级 |
| --- | --- | --- |
| UI | React + TypeScript + Vite + Monaco | P0 |
| Desktop | Electron + contextBridge/IPC + electron-builder | P0 |
| Server | Node.js + TypeScript + Hono 或 Fastify | P0 |
| API | REST/JSON + SSE streaming | P0 |
| DB | PostgreSQL(pg) + MySQL(mysql2) + SQLite(better-sqlite3) | P0 |
| SSH | ssh2 | P0 |
| AI | 原生 provider adapter；OpenAI-compatible API 起步 | P0 |
| Agent | 自研轻量 tool loop + JSON Schema/Zod + approval gate | P0 |
| 配置存储 | SQLite；服务端后续可 PostgreSQL | P0 |
| Secret | safeStorage/keychain；服务端 AES/KMS/secret manager abstraction | P0 |
| MCP | stdio + Streamable HTTP | P1 |
| 大结果集 | Arrow/Parquet + DuckDB-WASM | P2 |
| Python Worker | FastAPI/stdio 子进程任选 | P2 |

## 12. MVP 路线图

1. 先做“连接 + SQL Editor + Result Grid”：PostgreSQL、MySQL、SQLite；桌面 Local Runtime 与 Web Server Runtime 共用 db-core。

2. 加入 Schema Explorer、metadata cache、SSH Tunnel、TLS、连接测试、查询取消和超时。

3. 加入对话式数据库 Agent：Schema 检索 → 制定步骤 → 生成或修改 SQL → 分级授权与必要确认 → 查询或受控 DML/DDL → 解释实际结果。提供建议与执行两种模式。

4. 建立统一 SQL risk classifier、approval gate 与审计，区分查询、DML、DDL 和管理操作；人工与 AI 共用执行链。受控增删改和已验证 DDL 纳入 MVP，脚本、交互事务和管理能力逐项细化。

5. 加入 Remote Runtime：桌面客户端可连接自托管 Server，Web/Desktop 完全共享 API types。

6. 再做 MCP、团队 RBAC、数据脱敏、Arrow/Parquet、本地模型与 Python Worker。

## 13. 最终建议

> 架构结论  最适合你的不是“Electron + Python 后端”这种两套技术强耦合，而是「TypeScript 单核心、双 Runtime」。同一套 db-core / ai-core 在 Desktop Node runtime 与 Server Node runtime 中运行；共享 Web UI 通过 IPC 或 HTTPS 与 Core 通信。这样开发成本最低、代码复用率最高，也最接近 DbGate/Mako/Outerbase 的成熟实践。

如果后续产品重点变成“AI 数据分析/Notebook/本地模型”，再增加 Python Worker；如果重点变成“企业数据库治理”，再沿 Bytebase 思路增加 RBAC、审批、审计和 MCP；如果重点变成“大结果集交互分析”，再沿 Mako 思路引入 Arrow/Parquet + DuckDB-WASM。

## 14. 参考资料

[1] DbGate GitHub README — https://github.com/dbgate/dbgate。Web/Desktop 技术栈：Svelte、Node/Express、TypeScript/JavaScript、Electron。

[2] Chat2DB GitHub — https://github.com/OtterMind/Chat2DB。AI 数据库客户端；Desktop/Web/Docker、custom AI model、MCP。

[3] DBeaver GitHub — https://github.com/dbeaver/dbeaver。JDBC、插件化数据库连接、SQL parser、SSH 等。

[4] CloudBeaver GitHub — https://github.com/dbeaver/cloudbeaver。Web 数据库管理器；Java server + TypeScript/React；SSH 与安全模型。

[5] Outerbase Studio GitHub — https://github.com/outerbase/studio。Browser-first GUI；Electron Desktop 补充浏览器无法使用的数据库驱动能力。

[6] Bytebase GitHub — https://github.com/bytebase/bytebase。数据库治理、RBAC、审计、Text-to-SQL、MCP Server。

[7] Mako GitHub — https://github.com/mako-ai/mako。React/Vite + Hono/Node + DB drivers + AI + DuckDB-WASM/Arrow/Parquet。

[8] MindsDB Engine GitHub — https://github.com/mindsdb/engine。同时提供 HTTP、MySQL wire、PostgreSQL wire 的查询引擎。

[9] Electron Process Model — https://www.electronjs.org/docs/latest/tutorial/process-model。Main/Renderer、context isolation。

[10] Electron IPC — https://www.electronjs.org/docs/latest/tutorial/ipc。Main/Renderer IPC 模式。

[11] Tauri Architecture — https://v2.tauri.app/concept/architecture/。Rust + OS WebView 的桌面架构。

[12] PostgreSQL Protocol — https://www.postgresql.org/docs/18/protocol.html。PostgreSQL Frontend/Backend wire protocol。

[13] MySQL Client/Server Protocol — https://dev.mysql.com/doc/dev/mysql-server/latest/PAGE_PROTOCOL.html。MySQL client/server protocol、TLS 等。

[14] MDN Server-Sent Events — https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events。SSE 单向流式通信。

[15] MCP Transports — https://modelcontextprotocol.io/specification/2025-03-26/basic/transports。MCP JSON-RPC、stdio、Streamable HTTP。

[16] MCP Architecture — https://modelcontextprotocol.io/specification/2025-06-18/architecture。MCP Host/Client/Server 与 capability negotiation。

说明：本文基于 2026-09-17 可公开检索的项目 README、官方文档和协议文档整理。开源项目版本与架构可能继续变化，落地前建议锁定具体 commit/tag 再做依赖审计。

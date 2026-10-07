# DBPilot Project State

更新日期：2026-10-07

本文件是实现进度的事实记录。每新增功能，须同步更新对应条目的状态、文件和验证结果。设计目标以 `docs/AI数据库管理工具总体技术架构设计.md` 为准；本文件只记录实际代码，不将设计稿视为已交付。

## 当前阶段

阶段 A 退出条件尚未满足，B 已有较多基础闭环，C 已有受控多轮 Agent API 和共享 UI 的模拟模型/真实数据库验收，真实模型仍待联调。F098–F132已补固有工具/待办、规则抽屉、左右聊天气泡、历史持久化、流式回答、连接草稿、统一结果分析、分页找表/单表字段、Markdown、安全输出校验、对话区内确认、执行结果网格入口与任务来源记录；TTL、取消、TLS、固定指纹SSH及Runtime目录所有权已有对应验证。默认CLI持久化和已有3连接恢复已验证，错误密钥启动拒绝，历史读取失败不再误报临时存储。已有使用 shadcn/ui 的共享 Web 工作台与 Server 查询链；macOS arm64 桌面 Local/loopback Remote、编辑器键盘与 Worker、未签名应用包启动/查询/重启已实际验证，DMG 已生成。Windows、跨主机 HTTPS、签名公证、完整安全边界和完整工作区级 Agent 仍待交付。不能将功能条目数量换算为首版完成率。开发约束见 `AGENTS.md`。

## 已实现功能

| ID | 功能 | 涉及文件 | 验证 | 限制 |
|---|---|---|---|---|
| F001 | pnpm/TypeScript 工程、Web 构建 | `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `apps/web/vite.config.ts` | `pnpm build` 通过 | 尚无桌面构建 |
| F002 | Web 连接表单、SQL 编辑、预检和结果显示 | `apps/web/src/main.tsx`, `apps/web/src/style.css` | Web 构建通过 | Monaco 和虚拟表格已由 F047 补齐 |
| F003 | SQLite、PostgreSQL、MySQL 连接及测试接口 | `packages/protocol/src/index.ts`, `apps/server/src/app.ts` | SQLite 冒烟、PostgreSQL 16.13 本机实例、MySQL 8.0 临时容器连接与查询集成测试通过 | TLS见F104，SSH见F105；跨主机生产环境待验收 |
| F004 | SQL 拆分、保守分类、多命令计划与逐条执行 | `packages/core/src/sql.ts`, `apps/server/src/app.ts`, `tests/sql.test.ts` | SQL 单测 4 项通过；SQLite 查询冒烟通过 | 非完整方言解析；未知语法拒绝；完整显式事务块已由 F035/F041/F043 补齐，交互式事务未实现 |
| F005 | AI 来源计划的显式审批门槛及一次性计划消费 | `apps/server/src/app.ts` | API 集成测试通过 | 可信用户确认边界和可配置策略规则未完成；审批持久化已由 F024 补齐，Web Origin 防护见 F057 |
| F006 | Fastify 应用与监听入口分离；API 集成测试覆盖 AI 审批、重复消费、拒绝未知 SQL 和部分成功 | `apps/server/src/app.ts`, `apps/server/src/index.ts`, `tests/api.test.ts` | `pnpm test` 6/6 通过；`pnpm build` 通过 | 测试只覆盖 SQLite |
| F007 | 连接 Schema 浏览接口与 Web Schema 浏览（早期含字段树，F048 已改为仅表树） | `apps/server/src/app.ts`, `apps/web/src/main.tsx`, `apps/web/src/style.css`, `tests/api.test.ts`, `tests/mysql.integration.test.ts` | SQLite 与 MySQL 8.0 Schema 查询通过；`pnpm build` 通过 | PostgreSQL Schema 真实目标尚未验证；每次选择连接重新读取 |
| F008 | 可选 SQLite 连接元数据持久化；网络数据库密码 AES-256-GCM 加密保存 | `packages/storage/src/connections.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`, `tests/storage.test.ts`, `README.md` | `pnpm test` 9/9 通过；`pnpm build` 通过 | 主密钥由部署者提供；尚未接入系统 Keychain/KMS |
| F009 | 执行状态日志持久化；重启后运行中任务标为 `outcome_unknown` | `packages/storage/src/executions.ts`, `apps/server/src/app.ts`, `tests/executions.test.ts` | `pnpm test` 11/11 通过；`pnpm build` 通过 | 仅记录状态和步骤摘要；结果行不持久化，重启后不可读取；计划持久化见 F024 |
| F010 | 单次执行结果快照的分页 API，cursor 绑定执行和结果集 | `apps/server/src/app.ts`, `tests/api.test.ts` | `pnpm test` 12/12 通过；`pnpm build` 通过 | 快照仍在内存；现行单结果上限见 F058，总缓存上限见 F060 |
| F011 | Web 结果表按分页 API 加载，执行快照不再携带全部行 | `apps/web/src/main.tsx`, `apps/server/src/app.ts`, `tests/api.test.ts` | `pnpm test` 12/12 通过；`pnpm build` 通过 | 浏览器交互尚无自动化 E2E；结果仍在服务端内存 |
| F012 | 执行 SSE 事件流、`afterSeq` 重放和有界事件缺口报告 | `packages/core/src/events.ts`, `apps/server/src/app.ts`, `tests/events.test.ts`, `tests/api.test.ts` | `pnpm test` 14/14 通过；`pnpm build` 通过 | 事件缓存仅在内存，重启后返回 `EVENT_GAP` |
| F013 | SQLite SQL 在独立 Worker 执行，30 秒超时后终止 Worker | `apps/server/src/sqlite-worker.mjs`, `apps/server/src/app.ts`, `tests/api.test.ts` | 异步 SQLite API 测试通过；`pnpm test` 14/14，`pnpm build` 通过 | Worker 每次查询启动，尚无池化 |
| F014 | 执行取消接口；SQLite 读取取消、写入中断结果未知 | `apps/server/src/app.ts`, `packages/core/src/events.ts`, `tests/api.test.ts` | SQLite 锁阻塞下取消测试通过；PostgreSQL/MySQL 原生取消另有真实实例测试 | 连接建立阶段取消仍受连接超时限制 |
| F015 | Web 执行中取消按钮与取消请求状态 | `apps/web/src/main.tsx` | `pnpm build` 通过；后端取消测试 15/15 通过 | 浏览器按钮交互尚无 E2E |
| F016 | 删除连接 API 与 Web 操作；删除后旧计划拒绝执行 | `packages/storage/src/connections.ts`, `apps/server/src/app.ts`, `apps/web/src/main.tsx`, `apps/web/src/style.css`, `tests/api.test.ts` | 计划失效集成测试通过；`pnpm test` 16/16，`pnpm build` 通过 | 已开始的执行继续使用启动时的连接配置快照；删除不取消进行中的任务 |
| F017 | 自托管 Web 单端口静态文件服务及 Docker Compose 配置 | `apps/server/src/app.ts`, `apps/server/src/index.ts`, `Dockerfile`, `compose.yaml`, `.dockerignore`, `tests/web-serving.test.ts`, `README.md` | 同实例 Web/API 测试通过；`pnpm test` 17/17，`pnpm build` 通过；`docker compose config --quiet` 通过 | 镜像构建卡在 Docker Hub 基础镜像元数据获取，未完成容器运行验证；仍只适合受控网络部署 |
| F018 | 可配置 DeepSeek SQL 草稿：发送所选连接 Schema、校验结构化返回、仅写入编辑器 | `packages/ai-core/src/deepseek.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/web/src/main.tsx`, `apps/web/src/style.css`, `tests/ai.test.ts`, `tests/api.test.ts`, `compose.yaml`, `README.md` | Provider 模拟响应与 API 测试通过；`pnpm test` 20/20，`pnpm build` 通过 | 未用真实 DeepSeek Key 验证；尚非多轮 Agent 或自动工具执行 |
| F019 | 已完成查询的有界结果直接交 DeepSeek 分析，提示部分结果并在 Web 展示回答 | `packages/ai-core/src/deepseek.ts`, `apps/server/src/app.ts`, `apps/web/src/main.tsx`, `apps/web/src/style.css`, `tests/ai.test.ts`, `tests/api.test.ts` | 模拟模型与现有执行结果集成测试通过；`pnpm test` 22/22，`pnpm build` 通过 | 未用真实 DeepSeek Key 验证；最多 100 行/20,000 字符，超限拒绝 |
| F020 | 查询结果快照同时受行数与 20 MiB 字节预算约束（行数现为 10,000，见 F058） | `packages/core/src/results.ts`, `apps/server/src/app.ts`, `apps/server/src/sqlite-worker.mjs`, `tests/results.test.ts` | 行数/字节截断测试通过；`pnpm test` 23/23，`pnpm build` 通过 | 普通网络读取超限提前取消已由 F080 补齐；事务内读取仍排空，写入返回结果仍缓冲 |
| F021 | Web 通过 fetch 消费执行 SSE，断线重试后回退快照轮询 | `packages/runtime-client/src/sse.ts`, `apps/web/src/main.tsx`, `tests/sse-client.test.ts` | 跨 chunk 事件解析测试通过；`pnpm test` 24/24，`pnpm build` 通过 | 浏览器真实断线场景尚无 E2E 验证 |
| F022 | 更新连接配置并递增版本；旧计划失效，Web 可编辑配置 | `packages/storage/src/connections.ts`, `apps/server/src/app.ts`, `apps/web/src/main.tsx`, `apps/web/src/style.css`, `tests/storage.test.ts`, `tests/api.test.ts` | 版本失效和保留原密码测试通过；`pnpm test` 26/26，`pnpm build` 通过 | 网络连接修改时留空密码表示保留原密码；尚无专用 Secret 输入流程 |
| F023 | 服务端 Host 白名单，默认只接受 loopback 主机名 | `apps/server/src/app.ts`, `apps/server/src/index.ts`, `compose.yaml`, `README.md`, `tests/api.test.ts` | 恶意 Host 拒绝测试通过；`pnpm test` 27/27，`pnpm build`、`docker compose config --quiet` 通过 | 自定义域名需要设置 `DBPILOT_PUBLIC_HOSTS`；仍需完整部署层访问控制 |
| F024 | 计划与审批持久化；一次性领取和执行意图同一 SQLite 事务；重试返回原 `executionId` | `packages/storage/src/plans.ts`, `apps/server/src/app.ts`, `tests/plans.test.ts`, `tests/api.test.ts` | 重启恢复、重复领取与提交重试测试通过；`pnpm test` 29/29，`pnpm build` 通过 | 计划有效期 10 分钟；SQL 计划正文保存在元数据库中 |
| F025 | `clientRequestId` 对计划创建去重；相同请求重放、不同 SQL 拒绝；Web 失败重试保留 ID | `packages/protocol/src/index.ts`, `packages/storage/src/plans.ts`, `apps/server/src/app.ts`, `apps/web/src/main.tsx`, `tests/api.test.ts` | 跨重启重放与冲突测试通过；`pnpm test` 29/29，`pnpm build` 通过 | API 仍允许旧客户端不提供 ID；后续协议版本应收紧为必填 |
| F026 | 结果快照按 TTL 从内存释放；分页返回 `RESULT_EXPIRED`，执行状态仍可读取 | `apps/server/src/app.ts`, `packages/core/src/events.ts`, `tests/api.test.ts` | 结果过期与状态保留测试通过；`pnpm test` 30/30，`pnpm build` 通过 | 默认 10 分钟，访问时及每分钟清理；结果行不持久化 |
| F027 | 服务端编译为可直接运行的 JavaScript，并复制 SQLite Worker；容器改用编译产物启动 | `tsconfig.server.json`, `scripts/copy-runtime.mjs`, `package.json`, `Dockerfile` | `pnpm build` 通过；编译后的 Fastify 注入冒烟返回 HTTP 200 | 容器镜像尚未完成运行验证 |
| F028 | 桌面端具名操作协议、Web 适配、Electron Main/Preload/Utility 进程骨架；支持本地 Core 和 HTTPS Remote 目标配置 | `packages/runtime-client/src/desktop-operations.ts`, `apps/desktop/main.mjs`, `apps/desktop/preload.cjs`, `apps/desktop/utility.mjs`, `apps/web/src/main.tsx`, `apps/web/src/desktop.d.ts`, `package.json`, `tests/desktop-operations.test.ts`, `README.md` | 操作路由测试通过；`pnpm test` 32/32、`pnpm build` 通过 | Electron 二进制安装脚本经提权重试仍 `fetch failed`，尚无实际桌面启动或安装包验证；Remote 需要部署端访问控制 |
| F029 | 过期且未消费计划自动清理，释放 SQL 正文和请求 ID；已领取计划保留以支持执行重试 | `packages/storage/src/plans.ts`, `apps/server/src/app.ts`, `tests/plans.test.ts` | 持久化清理与已领取计划保留测试通过；`pnpm test` 33/33、`pnpm build` 通过 | 访问新计划时及每分钟清理；历史已消费计划暂无保留期策略 |
| F030 | 多命令执行逐步骤记录 `pending/running/succeeded/failed/skipped/cancelled/outcome_unknown`；失败后展示未执行步骤，重启后标出不确定步骤 | `apps/server/src/app.ts`, `packages/storage/src/executions.ts`, `tests/api.test.ts`, `tests/executions.test.ts` | 部分成功、取消和重启恢复测试通过；`pnpm test` 34/34、`pnpm build` 通过 | 完整显式事务块见 F035/F041/F043；目标数据库提交和元数据日志不能原子化 |
| F031 | 持久化审计事件：计划生成、审批、执行意图/结束、取消；仅记 SQL 哈希；审计意图写入失败时拒绝执行 | `packages/storage/src/audit.ts`, `apps/server/src/app.ts`, `tests/audit.test.ts` | 故障注入证明审计不可写时目标库无写入；`pnpm test` 36/36、`pnpm build` 通过 | 审计与计划/执行状态尚非同一事务；本地 SQLite 审计不防篡改 |
| F032 | 连接配置变更前后审计和模型数据出站审计；审计不可写时禁止模型请求 | `packages/storage/src/audit.ts`, `apps/server/src/app.ts`, `tests/audit.test.ts` | 连接生命周期和模型出站故障注入测试通过；`pnpm test` 38/38、`pnpm build` 通过 | Secret 更换只作为连接变更记录，尚无单独 Secret 事件；审计与连接元数据非同一事务，完成事件失败需人工核对；模型请求只记录类型及请求哈希 |
| F033 | PostgreSQL 读取查询按驱动行事件增量收集，结果快照受行数和字节上限约束 | `apps/server/src/app.ts`, `packages/core/src/results.ts`, `tests/results.test.ts`, `tests/postgres.integration.test.ts` | 增量收集单测及 PostgreSQL 16.13 的 1200 行截断集成测试通过 | 普通读取提前取消已由 F080 补齐；事务内读取仍排空，写入返回结果仍缓冲 |
| F034 | MySQL 读取查询使用驱动可读流，逐行有界收集；仍保留单语句模式 | `apps/server/src/app.ts`, `packages/core/src/results.ts`, `tests/mysql.integration.test.ts` | MySQL 8.0 真实实例 1200 行截断测试通过 | 普通读取提前取消已由 F080 补齐；事务内读取仍排空，写入返回结果仍缓冲 |
| F035 | SQLite 完整显式事务块在同一 Worker/物理连接运行；支持 `BEGIN`、`COMMIT`、`ROLLBACK`，失败尝试回滚并标注步骤 | `packages/core/src/sql.ts`, `apps/server/src/sqlite-worker.mjs`, `apps/server/src/app.ts`, `packages/storage/src/executions.ts`, `apps/web/src/main.tsx`, `tests/sql.test.ts`, `tests/api.test.ts` | 实际 SQLite 提交、显式回滚、语句失败回滚测试通过；`pnpm test` 41/41、`pnpm build` 通过 | Worker 中断的最终提交状态保守标为未知；PostgreSQL/MySQL 已另行支持 |
| F036 | 持久化执行时在同一元数据库事务内完成计划领取、执行状态意图与审计意图 | `packages/storage/src/plans.ts`, `apps/server/src/app.ts`, `tests/audit.test.ts` | 审计故障注入证明三项一同回滚、目标库未访问；`pnpm test` 41/41、`pnpm build` 通过 | 仅元数据库内部原子；目标数据库提交仍无法与元数据库原子化；无数据目录的开发模式只使用进程内记录 |
| F037 | Runtime ID 按数据目录持久化，握手报告模式及数据库能力 | `packages/storage/src/runtime-identity.ts`, `apps/server/src/app.ts`, `apps/desktop/utility.mjs`, `tests/runtime-identity.test.ts` | 重启不变、不同目录隔离及能力测试通过；`pnpm test` 42/42、`pnpm build` 通过 | 尚未将 `runtimeId + workspaceId` 绑定到全部资源与缓存；无数据目录模式每次启动生成新 ID |
| F038 | Desktop Remote 切换前验证协议版本和 Runtime ID；切换后重载界面清空旧结果和订阅，运行任务切换前提示 | `packages/runtime-client/src/handshake.ts`, `apps/desktop/main.mjs`, `apps/web/src/main.tsx`, `tests/handshake.test.ts` | 握手校验测试通过；`pnpm test` 43/43、`pnpm build` 通过 | Electron 实际窗口和远端部署联调仍待验证；运行中的远端任务不会自动取消 |
| F039 | PostgreSQL 读取与写入取消发送 `pg_cancel_backend`，读取标记取消、写入保守标记结果未知 | `apps/server/src/app.ts`, `tests/postgres.integration.test.ts` | PostgreSQL 16.13 临时实例验证读取、1200 行截断、DML、读写取消与后续查询；完整套件 44/44、`pnpm build` 通过 | 同账号需有取消自己会话的权限；连接建立阶段取消仍受 5 秒连接超时限制；尚未验证 TLS/远端部署 |
| F040 | MySQL 取消通过独立连接发送 `KILL QUERY`，读取标记取消、写入标记结果未知 | `apps/server/src/app.ts`, `tests/mysql.integration.test.ts` | MySQL 8.0 真实实例读写取消测试通过 | 同账号需具备取消自己会话的权限；连接建立阶段取消仍受连接超时限制 |
| F041 | PostgreSQL 完整显式事务块固定单个客户端连接，按步骤执行并在失败时回滚；30 秒计划超时发送取消请求 | `packages/core/src/sql.ts`, `apps/server/src/app.ts`, `tests/sql.test.ts`, `tests/postgres.integration.test.ts` | PostgreSQL 16.13 真实实例验证提交、显式回滚和语句失败回滚；`DBPILOT_TEST_POSTGRES=1 pnpm test` 45/45、`pnpm build` 通过 | 只开放完整块的有限语法；取消与断连期间无法证明最终提交状态时保守标为未知 |
| F042 | MySQL 8.0 真实实例验证连接、Schema、1200 行截断、DML 和读写取消；修正写入取消后的结果未知判定 | `apps/server/src/app.ts`, `tests/mysql.integration.test.ts` | 临时容器集成测试通过；`DBPILOT_TEST_MYSQL=1 pnpm test` 45/45、`pnpm build` 通过 | TLS/SSH 与远端部署未验证；普通读取超限取消见 F080 |
| F043 | MySQL 完整显式 DML 事务块固定单个连接，失败回滚，预检拒绝块内 DDL 隐式提交风险 | `packages/core/src/sql.ts`, `apps/server/src/app.ts`, `tests/sql.test.ts`, `tests/mysql.integration.test.ts` | MySQL 8.0 真实实例提交、显式回滚和失败回滚测试通过；`DBPILOT_TEST_MYSQL=1 pnpm test` 45/45 | 仅开放完整块和有限语法；无法证明最终提交状态时保守标为未知 |
| F044 | Web 三栏 SQL 工作台：连接侧栏与弹窗、可搜索 Schema 树、一键写入表查询、带行号编辑器、计划确认、分步骤结果表、AI 辅助面板、响应式布局；桌面运行目标设置保留 | `packages/workbench/src/Workbench.tsx`, `apps/web/src/style.css`, `README.md` | `pnpm test` 43/43（4 个需真实数据库的集成测试跳过）；`pnpm build` 通过；浏览器实际完成 SQLite 连接、Schema 读取、SQL 预检、执行和 3 行结果显示 | Monaco 与虚拟滚动已由 F047 补齐；浏览器自动化 E2E 和桌面二进制仍待验证 |
| F045 | 按架构文档接入 Tailwind 4 与官方 shadcn/ui：共享 Button、Input、Textarea、Label、Select、Dialog、Tabs、Card、Badge 等组件及主题；工作台从 Web 入口移至 `packages/workbench`，Web/Electron 共用 | `AGENTS.md`, `components.json`, `.npmrc`, `package.json`, `pnpm-lock.yaml`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`, `apps/web/src/style.css`, `packages/ui/src/`, `packages/ui/README.md`, `packages/workbench/src/Workbench.tsx` | 官方 CLI 生成组件；`pnpm test` 43/43（真实数据库 4 项跳过）、`pnpm build` 通过；浏览器验证 shadcn Dialog 打开及焦点 | Monaco、TanStack Table/Virtual 已由 F047 接入；桌面端视觉/键盘验收仍待完成 |
| F046 | 连接设置支持网络连接 TLS 开关，选中连接可调用现有测试 API，并在顶部显示测试中/成功/失败状态 | `packages/workbench/src/Workbench.tsx`, `apps/web/src/style.css` | `pnpm build` 通过；SQLite 连接测试 API 已有真实数据库验证 | TLS 只提供布尔开关，尚无自定义 CA/客户端证书或 SSH 配置；本轮未在真实网络数据库验证 TLS |
| F047 | 接入 Monaco SQL 编辑器、Worker、SQL 高亮和 Ctrl/Cmd+Enter；结果网格改用 TanStack Table/Virtual 行虚拟化 | `packages/workbench/src/SqlEditor.tsx`, `packages/workbench/src/ResultGrid.tsx`, `packages/workbench/src/Workbench.tsx`, `package.json`, `pnpm-lock.yaml` | `pnpm test` 43/43、`pnpm build` 通过；浏览器看到 Monaco 编辑区及 SQLite 3 行结果表 | SQLite Web 万行加载与虚拟滚动已由 F058 验证，精确性能指标及桌面验收未完成；Monaco 已由 F054 拆分 |
| F048 | 共享工作台重排为左侧连接/表树、中央数据与结构视图、可展开 SQL 控制台（位置已由 F055 调整）、右侧对话区；全站使用 shadcn/ui 默认黑白中性色并放大字号、间距和表格 | `packages/workbench/src/Workbench.tsx`, `packages/workbench/src/workbench.css`, `packages/ui/src/theme.css`, `apps/web/src/style.css` | 浏览器桌面和窄视口检查；真实 SQLite 表点击后数据出现在中央，侧栏不再列字段；`pnpm build` 通过 | 右侧仍是单轮 SQL 草稿/结果分析接口，尚非完整多轮 Agent；桌面窗口未验收 |
| F049 | 普通 SELECT 由 SQL 控制台按钮或 Ctrl/Cmd+Enter 直接执行；点表直接加载数据；控制台提供执行记录和带 SQL/状态的命令日志 | `packages/core/src/sql.ts`, `packages/workbench/src/Workbench.tsx`, `packages/workbench/src/workbench.css`, `tests/sql.test.ts`, `tests/api.test.ts`, `tests/ai.test.ts` | SQLite 浏览器验证点表直接得到 3 行；手动输入 `SELECT name, city FROM customers ORDER BY id` 后单击执行直接得到 3 行 2 列，执行记录和命令日志内容均可见 | 逐步骤命令日志已由 F056 持久可见；提交失败等页面消息仍只在当前会话；手动写入确认交互已由 F051 移除 |
| F050 | 执行记录从已领取计划和执行状态读取，按连接列出最近 50 次 SQL 与结果状态；配置数据目录时重启后仍可查看，Web/桌面共用 API 路由 | `packages/storage/src/plans.ts`, `apps/server/src/app.ts`, `packages/runtime-client/src/desktop-operations.ts`, `packages/workbench/src/Workbench.tsx`, `tests/api.test.ts`, `tests/desktop-operations.test.ts` | 持久化 Runtime 重启后可列出 SQL、成功状态、结果数据过期标记；`pnpm test` 45/45、`pnpm build` 通过 | 结果行仍只在内存快照里；重启或 TTL 到期后可看记录与状态，不能恢复结果行；桌面 preload 漏暴露已由 F054 修复，真实桌面端尚未验收 |
| F051 | 按用户修正手动 SQL 交互：输入后一次点击或快捷键即运行所有已支持的 SQL，删除“执行前确认”面板；不支持语句仍拒绝，结果/错误进入上方区域与日志 | `AGENTS.md`, `packages/workbench/src/Workbench.tsx`, `packages/workbench/src/SqlEditor.tsx` | 浏览器用临时 SQLite 执行 `UPDATE customers SET city = 'Hangzhou' WHERE id = 1`，单击后直接显示成功、影响 1 行，无第二次确认；`pnpm test` 45/45、`pnpm build` 通过 | 手动写入不再二次确认；AI 自主操作仍走独立授权；SQL 方言识别仍是保守子集 |
| F052 | 数据区、执行记录和控制台状态使用中文状态文本，避免直接暴露 `succeeded/failed` 等内部枚举 | `packages/workbench/src/Workbench.tsx` | `pnpm test` 45/45、`pnpm build` 通过 | 命令日志保留底层状态枚举，便于排查；尚未做完整国际化 |
| F053 | 数据网格增加已加载行搜索、列头升降序排序和匹配行数反馈；沿用 TanStack Table/Virtual 与 shadcn/ui Input/Button | `packages/workbench/src/ResultGrid.tsx`, `packages/workbench/src/workbench.css` | 浏览器对 SQLite 3 行数据搜索 `Chen` 得到 1 行，按 `name` 排序得到 Chen/Lin/Wang；`pnpm test` 45/45、`pnpm build` 通过 | 搜索、排序只作用于当前已加载结果，分页未加载数据不参与；万行基础滚动见 F058，精确性能指标未验收 |
| F054 | SQL 控制台打开时才加载 Monaco 编辑器及其 CSS；补齐桌面 preload 的 `executions.list` 暴露，使执行记录操作可从共享工作台进入 IPC | `packages/workbench/src/Workbench.tsx`, `apps/desktop/preload.cjs`, `tests/desktop-operations.test.ts` | `pnpm test` 46/46（4 项真实数据库集成测试跳过）、`pnpm build` 通过；构建入口 JS 545.68 KB，Monaco 独立 JS 2282.94 KB；浏览器展开控制台后看到 Monaco 编辑区；preload 桥接调用测试通过 | 只验证 Web 浏览器与桌面 preload 隔离测试；Electron 二进制下载失败，真实桌面窗口/Worker/IPC 尚未验收；仍需 10,000 行性能测试 |
| F055 | 参照 DataGrip 的工作区层级与 WhoDB 的数据浏览密度，SQL 编辑器改在结果/结构区上方；去掉数据区外层 Card 留白与边框、结构表内框及重复控制台入口；保留 shadcn/ui Tabs、Button、Card 等实际组件 | `packages/workbench/src/Workbench.tsx`, `packages/workbench/src/workbench.css`, `PROJECT_STATE.md` | `pnpm test` 46/46（4 项真实数据库集成测试跳过）、`pnpm build` 通过；浏览器用临时 SQLite 表验证 3 行数据网格、3 字段结构视图及 SQL 编辑器展开/Monaco 加载 | Web 1280px 视口已检查；Desktop Local/Remote 窗口、窄视口和 10,000 行流畅度仍需验收 |
| F056 | 命令日志从已持久化的计划 SQL 与逐步骤执行结果重建；重开页面仍显示每条 SQL 的状态、影响行数、回滚、截断和错误；页面内提交错误继续作为临时日志显示 | `apps/server/src/app.ts`, `packages/workbench/src/Workbench.tsx`, `tests/api.test.ts` | 持久化 Runtime 重启后的历史接口含步骤 SQL/状态断言通过；新浏览器页面连接 SQLite 后在“命令日志”看到此前 `SELECT name FROM items ORDER BY id` 成功记录；`pnpm test` 46/46（4 项真实数据库测试跳过）、`pnpm build` 通过 | 日志是计划和最终步骤状态的重建视图，不保留每次状态变化的精确时间或标准输出；无数据目录模式重启后不会保存；旧版 Runtime 只返回历史摘要时日志为空 |
| F057 | Web API 的非读取请求校验同源 `Origin` 与 `Sec-Fetch-Site`，拒绝跨站、不同端口与不透明来源；部署可显式配置 HTTPS 公开来源，Vite 开发命令仅允许本机 5173 来源 | `apps/server/src/app.ts`, `apps/server/src/index.ts`, `scripts/dev-server.mjs`, `package.json`, `tests/api.test.ts`, `README.md` | API 注入测试验证跨站拒绝、同源放行、无来源头本地调用和显式 HTTPS 代理来源；`pnpm test` 48/48（4 项真实数据库测试跳过）、`pnpm build` 通过 | 无来源头的非浏览器请求仍依赖监听地址、Host 检查及桌面 IPC 来源边界；部署在反向代理后需正确设置公开来源，尚未完成公网部署验收 |
| F058 | SQLite、PostgreSQL、MySQL 的单结果快照上限提升到 10,000 行并保持 20 MiB 字节预算；修正数据面板滚动高度和虚拟行高，使大结果只挂载可视区域的行 | `packages/core/src/results.ts`, `apps/server/src/sqlite-worker.mjs`, `apps/server/src/app.ts`, `packages/workbench/src/ResultGrid.tsx`, `packages/workbench/src/workbench.css`, `tests/api.test.ts`, `tests/postgres.integration.test.ts`, `tests/mysql.integration.test.ts`, `README.md` | SQLite API 对 10,001 行查询按同一快照分页取回恰好 10,000 行且标记截断；浏览器逐页加载 10,000 行，滚动至最后一行，DOM 仅挂载约 15–16 行；`pnpm test` 49/49（4 项真实数据库测试跳过）、`pnpm build` 通过 | 本轮大结果与滚动实测仅覆盖 SQLite Web；PostgreSQL/MySQL 更新后的 10,000 行集成用例待真实实例重跑；尚无精确 FPS/资源指标；总缓存预算由 F060 补齐 |
| F059 | 修复已保存连接的“测试连接”空 POST 被 JSON 头触发 400；新建/编辑弹窗支持保存前测试，服务端共用 SQLite/PostgreSQL/MySQL 探测逻辑并给出可操作错误信息，桌面具名操作同步映射 | `packages/workbench/src/Workbench.tsx`, `packages/workbench/src/workbench.css`, `apps/server/src/app.ts`, `packages/runtime-client/src/desktop-operations.ts`, `apps/desktop/preload.cjs`, `tests/api.test.ts`, `tests/desktop-operations.test.ts` | API 测试覆盖已存/未存 SQLite 成功、缺失文件与参数错误；桌面路由测试通过；浏览器实测缺失文件显示明确原因、有效文件先测后存、顶部复测正常、点表返回 100 行；`pnpm test` 51/51（4 项真实数据库测试跳过）、`pnpm build` 通过 | PostgreSQL/MySQL 连接探测本轮未接真实实例复测；桌面 UI 仍受 Electron 二进制下载失败阻碍 |
| F060 | 结果快照增加默认 200 MiB 运行时总数据预算；超限先释放旧快照行，保留执行状态与 SQL 历史；Web 工作台展示过期提示，Runtime 握手报告预算 | `apps/server/src/app.ts`, `apps/server/src/index.ts`, `packages/workbench/src/Workbench.tsx`, `tests/api.test.ts`, `README.md` | SQLite API 使用 35 字节预算验证第二次查询后旧结果返回 410、状态仍成功、历史标记不可用、新结果可分页；真实浏览器查看被释放的旧结果显示中文提示；`pnpm test` 52/52（4 项真实数据库测试跳过）、`pnpm build` 通过 | 预算按 JSON 行与列的字节数计算，不含 JS 对象和驱动内部内存；旧快照按执行插入顺序释放；本轮浏览器仅验证 SQLite Web，桌面窗口仍未实测 |
| F061 | 连接表单错误与工作区错误状态分离；API 路由 404 给出前后端版本不一致提示；将用户正在使用的 3137 旧服务更新为当前构建并保留 SQLite 连接 ID/配置 | `packages/workbench/src/Workbench.tsx`, `packages/runtime-client/src/errors.ts`, `tests/request-errors.test.ts`；本机 3137 Runtime | 直接请求 3137 的旧 `/api/v1/connections/test` 复现 404，旧 `/executions` 亦缺失、握手仅报告 1000 行；更新后测试接口返回 200、原连接 ID 不变、握手报告 10000 行；真实 Chrome 页面验证新建和编辑弹窗测试成功、编辑弹窗无效路径只在弹窗报错、关闭后工作区无残留、顶部测试成功、表仍显示 3 行；`pnpm test` 54/54（4 项真实数据库测试跳过）、`pnpm build` 通过 | 旧 3137 Runtime 未设置数据目录，旧会话的执行历史与结果无法迁移；之后的临时元数据目录已由 F064 迁至仓库忽略的 `.data/runtime-3137`；桌面窗口本轮未实测 |
| F062 | Runtime 握手明确报告 AI 是否已配置且不回显密钥；共享工作台在未配置时解释原因，禁用发送和结果分析入口，避免无效请求 | `apps/server/src/app.ts`, `packages/workbench/src/Workbench.tsx`, `tests/runtime-identity.test.ts` | API 测试覆盖未配置/已配置状态及密钥不泄漏；浏览器在未配置 Runtime 上选择连接、读取 3 行结果后确认发送、输入和分析按钮均禁用且有中文说明；`pnpm test` 55/55（4 项真实数据库测试跳过）、`pnpm build` 通过 | `aiConfigured` 仅表示配置项存在，不证明模型网络连通或工具调用正常；尚未用真实 DeepSeek Key 验证，也未实现完整 Agent |
| F063 | MySQL/PostgreSQL 连接测试按网络超时、端口拒绝、DNS、认证、库名、TLS 失败返回安全且可操作的原因；MySQL 容器内网地址超时提示 Runtime 所在机器与端口映射关系 | `apps/server/src/connection-errors.ts`, `apps/server/src/app.ts`, `tests/connection-errors.test.ts` | 本机直连用户提供的 `172.18.0.7:3306` 在 3 秒内超时，本机 Docker 无运行容器；错误映射 8 项测试覆盖分类且不泄漏连接数据；`pnpm test` 63/63（4 项真实数据库测试跳过）、`pnpm build` 通过 | 当时缺少外网可达地址；之后用户提供的外网地址已由 F064 完成实际验证 |
| F064 | 本机 Web Runtime 支持从 `DBPILOT_MASTER_KEY_FILE` 读取主密钥；缺密钥时保存连接返回明确配置错误；3137 服务配置受限权限密钥文件、将元数据迁入持久目录，并完成 MySQL 连接的测试、保存、重启恢复与 Schema 浏览 | `apps/server/src/index.ts`, `apps/server/src/app.ts`, `tests/api.test.ts`, `README.md`；忽略目录 `.data/secrets/master.key`、`.data/runtime-3137/metadata.db` | 浏览器用用户提供的外网 MySQL 参数测试成功、创建连接成功，真实 Schema 显示 28 张表；元数据密码字段为 `v1:` 加密格式，API 不回显密码；3137 Runtime 重启后保存连接复测 `{"ok":true}`，Schema 仍可读取 28 张表；缺密钥与重启恢复 API 回归通过；`pnpm test` 64/64（4 项其他真实数据库测试跳过）、`pnpm build` 通过 | 当前密钥文件仅在这台 Mac 的本地仓库忽略目录，需与元数据一同备份且不可丢失；尚未将 Web Runtime 集成系统 Keychain/KMS；未读取实际业务表数据或验证写入 |
| F065 | SQLite 查询与事务内结果无损保留 64 位整数：安全范围内仍为数字，超范围转十进制字符串；重复列名按位置保留 | `apps/server/src/sqlite-worker.mjs`, `tests/api.test.ts` | 真实 SQLite API 测试先复现 9007199254740993 被舍入，再验证正负 64 位边界、普通整数、NULL、小数、时间文本及重复列，普通/事务两路径通过；66 项测试通过、4 项网络 DB 跳过，构建通过 | SQLite REAL 仍遵循数据库浮点语义；本轮未验收浏览器或桌面；PG/MySQL 精度矩阵后续补齐 |
| F066 | PostgreSQL 日期/时间保留数据库文本与微秒；MySQL 保留超安全范围整数、日期与时间文本，避免 Runtime 时区转换；统一应用到查询与事务连接 | `apps/server/src/driver-values.ts`, `apps/server/src/app.ts`, `tests/value-fidelity.integration.test.ts`, `README.md` | 临时 PostgreSQL 16.13/MySQL 8.0 真实测试先复现舍入、日期偏移和微秒丢失；修复后两数据库普通/事务路径的精确数值、日期、微秒、NULL、重复列通过；含现有万行截断/事务/取消的完整套件 74/74，构建通过 | 日期/时间以数据库会话文本为准；复杂数组/自定义类型、完整时区矩阵未验收；浏览器与桌面未在本轮重跑 |
| F067 | 所有执行计划共用墙钟时间预算，默认 30 秒，可下调；到期通过原取消入口中断，读取标为取消、写入/事务保守标为结果未知，后续步骤停止 | `apps/server/src/app.ts`, `apps/server/src/index.ts`, `tests/query-budget.integration.test.ts`, `tests/api.test.ts`, `tests/runtime-identity.test.ts`, `README.md` | PG/MySQL 真实慢查询及慢写入验证超时、后续步骤 skipped、同计划重试不重放、数据库无迟到写入、后续查询可用；SQLite 锁等待下读/写/事务超时通过；82/82 测试与构建通过 | 取消为 best effort；网络建连和取消控制连接可能增加完成延迟；预算不等于保证目标已回滚；Schema/连接探测不属于执行计划预算 |
| F068 | SQLite 目标查询改为可终止的独立工作进程；取消等待进程退出；大结果等待 IPC 发送完成才断开通道 | `apps/server/src/sqlite-process.ts`, `apps/server/src/sqlite-worker.mjs`, `apps/server/src/app.ts`, `docs/AI数据库管理工具总体技术架构设计.md`, `README.md` | 真实回归曾复现线程强制终止时 better-sqlite3 引发 V8 fatal error；独立进程后锁等待取消、事务、精度和万行快照通过，82/82 测试与构建通过 | 每次执行启动一个进程，未池化；Electron 子进程/原生模块兼容性尚未实测；此项不代表桌面交付 |
| F069 | Runtime 执行并发限额默认 4，可配置 1–32；超额返回 429 且不消费计划，完成或取消后释放名额，重复提交既有计划仍返回原执行 | `apps/server/src/app.ts`, `apps/server/src/index.ts`, `tests/api.test.ts`, `tests/runtime-identity.test.ts`, `README.md` | SQLite 锁等待真实测试验证超额拒绝、计划可重试、同执行去重及取消释放；78 项通过、10 项网络 DB 测试未启用，构建通过 | 限制执行计划，不限制连接探测、Schema 或模型请求；不存在自动执行队列，需用户再次发起 |
| F070 | Runtime 优雅关闭时先取消并等待活动执行，再关闭元数据；处理 SIGINT/SIGTERM；后台执行异常保守记录结果未知并释放计时器与并发名额 | `apps/server/src/app.ts`, `apps/server/src/index.ts`, `tests/api.test.ts` | SQLite 锁等待下关闭/重启验证读取取消、写入未知、重提原计划不重放；编译后的独立 Runtime 收到真实 SIGTERM 后退出码 0，元数据库状态为 cancelled；含真实 PG/MySQL 的完整套件 90/90，构建通过 | 突然断电、SIGKILL 不走优雅关闭，仍依赖重启恢复标记；网络驱动取消完成受网络条件影响；桌面 Main 退出流程尚未联调 |
| F071 | SQL 风险分类识别由普通注释隔开的锁定语法；保守拒绝 MySQL/MariaDB 可执行注释和嵌套块注释 | `packages/core/src/sql.ts`, `tests/sql.test.ts` | 新增 8 个回归用例，其中 5 个先复现旧分类器放行；修复后 88 项测试通过、10 项网络数据库测试未启用，构建通过 | 仍是保守关键词子集，不是完整方言解析；字符串中的注释标记可能被保守拒绝；副作用函数和可信确认仍待补齐；本项未重新验收真实网络数据库或 UI |
| F072 | SELECT 仅允许已列出的函数/表达式子集；拒绝未知、带引号或 Schema 限定的调用，以及不支持的转义/注释歧义，保留字符串中的注释文本 | `packages/core/src/sql.ts`, `tests/sql.test.ts`, `tests/postgres.integration.test.ts` | 12 个新增失败用例先复现函数/注释误放行；完整真实 PG/MySQL 套件 116/116 与构建通过；新增真实 PostgreSQL 序列验证人工/AI 均不能经审批或执行绕过 setval 拒绝，序列未变 | 保守子集会拒绝未列出的合法函数；不保证数据库自定义重载、视图或运算符无副作用，仍需数据库最小权限；未完成完整方言解析或可信 UI 审批边界 |
| F073 | 审批与首次执行都重新计算当前 SQL 策略，旧计划分类/决策不一致时要求重新生成；审批同时验证连接版本 | `apps/server/src/app.ts`, `tests/api.test.ts` | 持久化旧版误放行计划测试先复现审批返回 200，修复后审批/执行均 403 且不消费计划；107 项通过、11 项网络数据库测试未启用，构建通过 | 已执行计划的重复提交仍返回原执行，绝不重放；本项不是可配置策略或完整审批来源隔离 |
| F074 | 受控 Agent 工具注册/执行器：8 个具名工具、严格参数、Runtime/连接授权、建议模式禁执行、计划与执行归属、调用去重、预算及安全错误；共用 Runtime 命名操作路径 | `packages/ai-core/src/tools.ts`, `tests/agent-tools.test.ts`, `tests/agent-tools.integration.test.ts` | 7 项专门测试通过，真实 SQLite 经 Runtime 完成生成计划、等待确认、可信入口审批、执行与读取 42；验证目标/参数伪造、凭据隔离、取消和审计失败拒绝，TypeScript 检查通过 | 尚未接模型循环/UI；connect_database 仅探测连接，不提供长期租约；工具上下文仅内存；默认 AI SQL 须确认，精确自动规则由 F085 补齐 |
| F075 | 工作区单活跃 Agent API 与 DeepSeek 多轮工具协议：连接发现、计划、审批暂停/恢复、结果反馈；建议/执行模式、时间/轮数/工具/上下文预算、取消与关闭清理、内存请求去重 | `packages/ai-core/src/agent.ts`, `packages/ai-core/src/deepseek.ts`, `packages/ai-core/src/tools.ts`, `packages/protocol/src/index.ts`, `apps/server/src/app.ts`, `packages/storage/src/audit.ts`, `tests/agent.test.ts`, `tests/agent-api.test.ts` | 模拟 Provider + 真实 SQLite 贯通多轮发现、计划、暂停、外部审批、执行与结果 42 回答；伪造 resume、重复请求、并行 Run 拒绝通过；完整真实 PG/MySQL 套件 128/128 与构建通过 | 未真实 DeepSeek 联调；非流输出；运行上下文与最多 32 条 Run 记录仅内存，重启不恢复/不重放；当前一个 Runtime 等同一个工作区；跨对话历史、连接新建/修改工具、持久租约、UI 与桌面联调仍待补齐；内部命名操作复用现有 HTTP 应用路径，尚未拆出独立 Application Service |
| F076 | 共享工作区 Agent 面板：无当前表也可发送、建议/执行模式、连接范围、工具记录、精确 SQL/目标/影响审批、拒绝/取消、刷新恢复；新增桌面命名操作 | `packages/workbench/src/AgentPanel.tsx`, `packages/workbench/src/Workbench.tsx`, `packages/workbench/src/workbench.css`, `packages/runtime-client/src/desktop-operations.ts`, `apps/desktop/preload.cjs`, `tests/desktop-operations.test.ts`, `scripts/validation/agent-ui.mjs` | 真实 Chrome + 3139 隔离 Runtime + 模拟模型 + 真实 SQLite：未选连接建议生成、执行模式审批、确认后返回 42、刷新恢复、拒绝停止；执行历史仅 1 次成功，建议/拒绝均未执行；审批截图 `output/playwright/agent-approval.png`；121 项测试通过、11 项网络 DB 未启用，构建通过 | 模型为专用验证 fixture，不代表真实 DeepSeek 集成；Electron Local/Remote 尚未运行验收；每次发送为独立任务，跨任务对话历史待补；未更新用户 3137 运行进程 |
| F077 | Agent 真实 SQLite 验收补齐：单 Runtime 双授权连接来源绑定、未授权连接隔离、部分提交后停止、重复提交不重放、建议模式拒绝模型主动执行 | `tests/agent-scenarios.test.ts` | 3 项端到端 API 场景通过：两次精确审批得到 first/second 各自来源；第三连接无执行；失败计划状态为 succeeded/failed/skipped 且仅保留首步写入；建议模式写入数为 0；TypeScript 检查通过 | 模型响应为受控 fixture，尚不代表真实模型理解或跨 PostgreSQL/MySQL 的 Agent 联调；不新增数据库驱动能力 |
| F078 | DDL 分类收紧为表/索引操作；拒绝用户、角色、数据库、系统配置、扩展、虚拟/外部表及 CREATE-AS 查询 | `packages/core/src/sql.ts`, `tests/sql.test.ts`, `tests/ddl.integration.test.ts` | 8 项先复现旧策略误放行；74 项 SQL/API/Agent 回归通过、构建通过；真实 SQLite/PostgreSQL/MySQL 分别完成建表、写入、唯一索引、加列、读取保留 NULL、删除索引与表的 7 步流程 | 仍为保守词法子集；不覆盖完整 DDL 语法、表达式索引/默认表达式或数据库自定义对象的全部副作用；更多 DDL 需单独验证 |
| F079 | Agent 执行开始即记录来源，取消后保留执行 ID 与数据库状态；覆盖派发/取消竞态，界面区分执行中、成功、失败和结果待核对 | `packages/ai-core/src/agent.ts`, `packages/ai-core/src/tools.ts`, `packages/workbench/src/AgentPanel.tsx`, `tests/agent.test.ts`, `tests/agent-scenarios.test.ts` | 先复现取消后执行 ID 丢失及派发竞态；修复后 8 项 Agent 回归通过、TypeScript 检查通过；真实 SQLite 锁等待下 Agent 写入取消标为 outcome_unknown，手动读取仍 running，目标无迟到写入；此前界面改动构建通过 | 取消为请求，数据库最终状态仍以执行历史为准；派发竞态用受控端口时序验证，真实 SQLite 验证的是运行中取消；网络故障下可能仍需人工核对 |
| F080 | PostgreSQL/MySQL 普通读取超出行/字节预算后原生取消，保留截断快照并允许后续步骤继续；用户取消与超时仍按原语义处理 | `apps/server/src/app.ts`, `tests/result-stop.integration.test.ts`, `README.md` | 真实 PG/MySQL 先复现慢尾部耗尽 2.5 秒计划预算导致取消；修复后两项测试合计约 236ms，快照截断且后续 SELECT 42 成功；完整真实数据库 155/155 测试通过，构建通过 | 原生取消是 best effort，存在网络缓冲和取消往返延迟；显式事务内读取仍排空以保留事务语义；写入返回结果仍缓冲；236ms 为测试耗时，不是性能承诺 |
| F081 | PostgreSQL/MySQL 连接级错误不再冒泡崩溃 Runtime；MySQL 流式查询监听连接断开，使用全计划预算避免断连遗留计时器 | `apps/server/src/driver-values.ts`, `apps/server/src/app.ts`, `tests/connection-loss.integration.test.ts`, `tests/fixtures/connection-loss.mjs` | 隔离子进程先复现 MySQL 普通/事务查询及 PostgreSQL 事务断连崩溃，再复现 MySQL 遗留计时器挂起；修复后真实 PG/MySQL 四项断连测试均正常退出，读取 failed、事务 outcome_unknown；超限/预算回归共 8 项通过，构建通过 | 仅验证强制关闭测试实例内唯一标记查询连接；断电、提交确认丢失及所有网络故障类型未穷尽；普通写入断连分类已由 F082 补齐，事务内写入断连见 F084，提交确认丢失仍待扩展 |
| F082 | 普通 PostgreSQL/MySQL 写入在连接丢失、服务端终止或相关传输失败时保守标为 outcome_unknown；MySQL 写入改用全计划预算避免遗留计时器 | `apps/server/src/query-failures.ts`, `apps/server/src/app.ts`, `tests/query-failures.test.ts`, `tests/connection-loss.integration.test.ts`, `tests/fixtures/connection-loss.mjs` | 先复现 PostgreSQL 写入误标 failed、MySQL 写入断连后进程挂起；修复后两驱动读取/事务/写入共 6 项断连测试通过，重复提交仍返回原执行；完整真实 SQLite/PG/MySQL 套件 171/171 和构建通过 | 故障注入在执行中终止连接，未模拟提交后确认包丢失的所有时序；错误分类为保守映射，事务内写入断连见 F084，SQLite 异常退出见 F083 |
| F083 | SQLite 工作进程异常退出或 IPC 错误时，写入和事务保守标为 outcome_unknown；读取仍 failed，计划不重放 | `apps/server/src/app.ts`, `tests/sqlite-worker-loss.test.ts` | 真实 fork 子进程 SIGKILL 注入先复现两项误报；修复后三场景通过，完整真实数据库套件 174/174、构建通过 | 注入发生在进程启动时，未证明提交后回执丢失时序；父进程强退后的孤儿进程清理已由F116补齐macOS验证 |
| F084 | MySQL 显式事务写入断连后清理不再等待遗留的逐语句超时计时器；统一依赖计划预算 | `apps/server/src/app.ts`, `tests/connection-loss.integration.test.ts`, `tests/fixtures/connection-loss.mjs` | 真实 MySQL 事务写入断连先复现子进程 10 秒不退出；修复后 PG/MySQL 读取、写入、事务读取、事务写入 8 场景均退出且结果状态正确，不重放；完整 176/176 与构建通过 | 仍未模拟 COMMIT 完成后确认包丢失；保留既有构建大 chunk/上游注释警告 |
| F085 | 用户配置的 SQL 规则基础：指定连接/类型/精确 SQL 的 allow、ask、deny，deny 优先；AI 默认 ask，人工同受 deny 约束；策略摘要绑定持久计划，变更后未执行计划失效，Agent 按明确 allow 自动执行 | `packages/core/src/command-policy.ts`, `packages/storage/src/plans.ts`, `apps/server/src/app.ts`, `apps/server/src/index.ts`, `packages/ai-core/src/tools.ts`, `packages/ai-core/src/agent.ts`, `tests/command-policy.test.ts`, `tests/command-policy-api.test.ts`, `tests/agent-tools.integration.test.ts`, `README.md` | 先复现规则未生效、AI SELECT 审批标志不一致、Agent 强制等待 allow 计划审批；真实 SQLite 验证自动执行、混合组确认、不重放与重启后策略失效；真实三数据库全套 182/182 通过，随后新增混合写入回归 2/2 通过；构建通过 | Server 用 DBPILOT_COMMAND_RULES_FILE 启动加载，未提供 UI、热更新或 Desktop Local 配置；自动规则必须精确 SQL，不支持对象通配/参数约束表达式；可信审批来源完整隔离仍待完成，真实模型和桌面未验收 |

| F086 | 共享工作台规则编辑/保存与版本冲突反馈，HTTP/具名 IPC 共用 DTO；规则和审计同事务持久化、即时生效；文件配置只读优先，旧计划绑定递增修订 | `packages/protocol/src/index.ts`, `packages/storage/src/policy.ts`, `packages/storage/src/audit.ts`, `apps/server/src/app.ts`, `packages/runtime-client/src/desktop-operations.ts`, `apps/desktop/preload.cjs`, `packages/workbench/src/PolicySettings.tsx`, `packages/workbench/src/Workbench.tsx`, `packages/workbench/src/workbench.css`, `tests/policy-settings.test.ts`, `tests/desktop-operations.test.ts`, `README.md` | 先红后绿覆盖规则 API 与 IPC；版本冲突、重启持久化、规则恢复后旧审批失效、审计失败回滚、文件只读通过；真实三数据库 187/187 通过；构建通过；隔离浏览器验证新增、自动执行必填、保存/重载、Escape 后焦点恢复，截图 `output/playwright/policy-settings.png` | 无 dataDir 时仅内存；精确 SQL 限制保留；桌面仅桥接及构建验证，实际窗口未验收；完整可信确认隔离未完成，模型 fixture 不能代表真实模型 |

| F087 | Agent 连续对话：服务端保存有界历史，追问固定模式/授权连接，防止过期分支覆盖；每轮新建工具状态，旧审批/计划不继承；共享 UI 展示历史、刷新恢复及新对话 | `packages/protocol/src/index.ts`, `packages/ai-core/src/agent.ts`, `apps/server/src/app.ts`, `packages/workbench/src/AgentPanel.tsx`, `tests/agent-conversation.test.ts`, `scripts/validation/agent-ui.mjs`, `README.md` | 先红后绿复现追问不支持；追问上下文、幂等、并发分支、范围变更、伪造历史、截断测试通过；真实 SQLite 验证旧写入计划不继承且仅写入一行；三数据库回归 190/190，构建通过；浏览器验证获批读取 42、追问不执行、刷新保留、新对话解锁，截图 `output/playwright/agent-conversation.png` | 模型为 fixture；历史最多 6 轮/24,000 字符并另有单项截断，仅内存，最多 32 Run；Runtime 重启不恢复；无流输出，真实模型及实际桌面仍待验收 |

| F088 | 修复 Electron ESM 主入口等待 ready 的启动死锁，实际窗口可加载共享工作台；恢复官方 Electron 44.5.1 二进制 | `apps/desktop/main.mjs`, `tests/desktop-bootstrap.test.ts` | 真实 Electron 启动探针先超时；改为 ready 回调后窗口及 IPC 能运行；`DBPILOT_TEST_DESKTOP=1 pnpm exec vitest run tests/desktop-bootstrap.test.ts` 1/1 通过，构建通过；截图 `output/playwright/desktop-window.png` | 仅证明 macOS 窗口启动；Local Core 明确因 better-sqlite3 ABI 127 与 Electron ABI 149 不匹配而失败，数据库、Remote、Windows、安装包尚未验收；不能称桌面已交付 |

| F089 | 工作台固定视口、侧栏树/对话区独立滚动，细滚动条；工作区/AI 可拖动分隔条含键盘操作与本机宽度记忆；测试/设置移至连接行并固定操作目标 | `packages/workbench/src/Workbench.tsx`, `packages/workbench/src/PaneDivider.tsx`, `packages/workbench/src/AgentPanel.tsx`, `packages/workbench/src/workbench.css`, `scripts/validation/workbench-ui.mjs` | 隔离真实浏览器 120 表：页面和侧栏高 712px，树内容 3811px 在 522px 内滚动；拖动/方向键、非当前连接编辑、真实 SQLite 结果通过；780px/390px 宽度页面无整体溢出；构建通过 | 宽度仅本机保存，窄屏上下排列；实际桌面三模式未重验 |
| F090 | AI 设置 UI：DeepSeek/自定义兼容供应商、地址、模型选择与手输、密钥输入、获取模型测试、保存即时生效；密钥加密、不回显、跨地址不复用；版本冲突与审计原子保存；HTTP/具名 IPC 共用 | `packages/workbench/src/AiSettings.tsx`, `packages/protocol/src/index.ts`, `packages/storage/src/ai-settings.ts`, `packages/storage/src/audit.ts`, `packages/ai-core/src/deepseek.ts`, `apps/server/src/app.ts`, `packages/runtime-client/src/desktop-operations.ts`, `apps/desktop/preload.cjs`, `tests/ai-settings.test.ts`, `tests/desktop-operations.test.ts`, `README.md`, `docs/plans/2026-10-07-workbench-layout-ai-settings.md` | 新接口先红后绿；加密落盘、重启、冲突、跨地址密钥隔离、错误不泄密、兼容请求参数通过；浏览器获取模型/保存/清空密钥输入/即时 Agent 回复通过；真实三数据库 196 通过、1 桌面测试未启用；构建通过 | 模型为模拟端点，真实 DeepSeek/其他供应商未验收；持久化须配置主密钥，无 dataDir 仅内存；环境 AI 配置优先只读；实际桌面仍受既有 ABI 问题阻塞 |

## 2026-10-07 文档与历史对话核对

下表保留 F071 之前的审计快照，后续实现与限制以 F071–F086 和“当前阶段”为准。F085 的 UI、热更新、Desktop Local 配置入口缺口已由 F086 补齐代码，实际桌面窗口仍未验收。

本次对照架构 §11–§13、架构确认对话、初始实现对话及后续 UI/连接修复对话，并抽查当前 SQL 分类、协议、DeepSeek、桌面入口和测试代码。以下是对既有功能的审计，不新增已交付功能 ID。

| 范围 | 当前结论 | 证据与缺口 |
|---|---|---|
| Web 数据库工作台 | 已有可操作的基础闭环 | F045–F061：真实 shadcn/ui、共享组件、Monaco、数据/结构、执行历史、命令日志、虚拟网格；历史浏览器验证主要为 SQLite，尚缺自动化 E2E 与三模式键盘/焦点验收 |
| 三数据库执行 | 已实现并有部分真实验证 | F003/F035/F039–F043：历史 SQLite/PG/MySQL 查询、DML、事务与取消；并非精度、时区、NULL、重复列、断连等完整矩阵全部通过；更新后的 PG/MySQL 万行用例尚待真实重跑 |
| 最近 MySQL 连接修复 | 已完成限定范围验证 | F064 与最新对话一致：测试、加密保存、重启恢复、28 张表 Schema；未验证该业务库实际数据读取或写入 |
| 结果与执行可靠性 | 基础机制已实现 | 同次执行快照、10,000 行/20 MiB/TTL/200 MiB 总数据预算、SSE、取消、幂等与部分完成；超限提前取消、完整故障矩阵及历史留存仍缺 |
| 命令策略与安全 | 部分完成 | 已有分类、计划审批持久化、审计、Origin/Host 检查；分类仍为关键词子集，缺用户可配 allow/ask/deny 规则、可信确认归属及完整副作用/越权验证。客户端可传 source，不能以当前审批测试宣称已防伪造确认 |
| AI MVP | 尚未完成 | `deepseek.ts` 仅单轮 SQL 草稿和最多 100 行结果分析，`stream: false`；没有完整 Agent Loop、工具注册/执行、建议/执行双模式、跨连接任务、连接管理工具或真实模型验证 |
| Desktop Local/Remote | 代码骨架，未交付 | 具名 IPC、Utility、握手、切换、safeStorage 代码存在；缺实际窗口、原生模块、Worker、双模式联调、macOS/Windows 安装包验收。历史阻碍为 Electron 二进制下载失败，本轮未重试下载 |
| 部署与凭据 | 部分完成 | 本机 Web 与加密元数据可用；Docker 仅配置/代码，未完成镜像运行；TLS 仅开关，SSH 未实现；缺完整加密链路、安装升级、签名、备份恢复验收 |

本轮重新运行 `pnpm test`：64 通过、4 跳过（真实 PostgreSQL/MySQL），`pnpm build` 通过。构建仍提示较大 JS chunk。未重跑浏览器、桌面、真实网络数据库或模型；上述历史实测不能表述为本轮重新验收。

首版门槛是 A–C 全部退出条件。MongoDB、其他模型、MCP、Notebook、Arrow/Parquet 和大结果导出属于 D/E；直接网格编辑及跨 Runtime 任务不按已确认首版必需项计缺口。手动 SQL 一次点击执行以最新用户约束和 F051 为准，不沿用早期文档的二次确认表述。

## 2026-10-07 本轮接续与交接

本轮完成 F071–F084。最新 `DBPILOT_TEST_POSTGRES=1 DBPILOT_TEST_MYSQL=1 pnpm test` 为 176/176 通过，`pnpm build` 通过；仍有既有大 chunk/上游注释构建警告。Agent 的模型响应为 fixture，数据库为真实 SQLite；浏览器已验证建议、审批、执行、拒绝和刷新恢复。真实模型、Electron 和 Windows 均未交付。用户 3137 Runtime 本轮未重启，仓库构建已更新。

隔离 UI 验收服务 3139 及 `dbpilot-agent` 浏览器会话已关闭；可用 `node scripts/validation/agent-ui.mjs` 在构建后重建验证环境。截图为 `output/playwright/agent-approval.png`。PostgreSQL 55433 与 MySQL 55434 专用测试实例保留给接续开发；不得用已保存的业务连接做测试写入。

接续时优先补齐 Agent 连接管理/对话、可配命令规则、TLS/SSH、真实模型和桌面验证；SQLite 工作进程异常退出和 MySQL 事务内写入断连已由 F083/F084 覆盖，仍需扩展提交确认丢失与孤儿进程清理矩阵。保留所有未跟踪文件，不清理或重置仓库。按用户额度规则，每个可验证增量后检查用量；最近检查额度剩余约 89%，任一适用窗口剩余不超过 40% 时停止启动新任务。

## 下一步（按依赖顺序）

1. 完成共享工作台的桌面键盘、焦点与 10,000 行精确 FPS/资源验收；Web SQLite 已验证可加载和滚动。
2. 完善网络数据库连接反馈、Schema 搜索与大结果体验，补浏览器自动化 E2E。
3. 补可信客户端确认边界、可配置命令规则与完整审计；未消费计划过期清理已有 F029，已消费历史保留策略仍未完成。
4. 补 TLS/SSH 配置与真实加密链路验证、事务内大结果策略；扩大方言事务语法覆盖。
5. 启动并打包 Electron，验证 Local/Remote 协议一致性与原生模块加载.
6. 在已有受控 Agent 上补连接管理、跨任务会话、真实模型、流输出和桌面验证。

## 验证记录

- 2026-10-07：Electron 安装脚本本轮经网络权限重试仍 `fetch failed`，桌面启动未验收；继续完成 F065/F066 数据精度验证。

- 2026-10-06：`pnpm build` 通过；`pnpm test` 4/4 通过。
- 2026-10-06：本机 SQLite API 冒烟：创建临时连接 → 预检 `SELECT id, name FROM sample` → 执行 → 得到 `[[1,"ok"]]`。
- 2026-10-06：`pnpm test` 6/6 通过，包含真实 SQLite API 注入测试；`pnpm build` 通过。
- 2026-10-06：Schema API 的 SQLite 表和字段测试通过；`pnpm test` 7/7，`pnpm build` 通过。
- 2026-10-06：连接配置持久化与密码加密测试通过；`pnpm test` 9/9，`pnpm build` 通过。
- 2026-10-06：执行状态重启恢复测试通过；`pnpm test` 11/11，`pnpm build` 通过。
- 2026-10-06：结果分页和无效 cursor 测试通过；`pnpm test` 12/12，`pnpm build` 通过。
- 2026-10-06：快照不携带行数据的 API 断言通过；Web 分页加载编译通过。
- 2026-10-06：SSE 接口与事件缓存测试通过；`pnpm test` 14/14，`pnpm build` 通过。
- 2026-10-06：SQLite Worker 后异步执行测试通过；`pnpm test` 14/14，`pnpm build` 通过。
- 2026-10-06：SQLite 读/写取消状态测试通过；`pnpm test` 15/15，`pnpm build` 通过。
- 2026-10-06：Web 取消按钮编译通过；`pnpm test` 15/15，`pnpm build` 通过。
- 2026-10-06：删除连接使旧计划失效的 API 测试通过；`pnpm test` 16/16，`pnpm build` 通过。
- 2026-10-06：同端口静态 Web 与 API 测试通过；`pnpm test` 17/17，`pnpm build` 通过。
- 2026-10-06：DeepSeek 草稿模拟响应及 API 测试通过；`pnpm test` 20/20，`pnpm build` 通过。
- 2026-10-06：已有查询结果的模型分析测试通过；`pnpm test` 22/22，`pnpm build` 通过。
- 2026-10-06：结果字节预算与截断测试通过；`pnpm test` 23/23，`pnpm build` 通过。
- 2026-10-06：Web SSE 解析测试通过；`pnpm test` 24/24，`pnpm build` 通过。
- 2026-10-06：连接版本更新与旧计划失效测试通过；`pnpm test` 26/26，`pnpm build` 通过。
- 2026-10-06：Host 白名单测试通过；`pnpm test` 27/27，`pnpm build` 和 Compose 配置检查通过。
- 2026-10-06：计划/审批重启恢复和一次性执行意图测试通过；`pnpm test` 29/29，`pnpm build` 通过。
- 2026-10-06：`clientRequestId` 的跨重启重放及冲突测试通过；`pnpm test` 29/29，`pnpm build` 通过。
- 2026-10-06：结果过期后释放及状态保留测试通过；`pnpm test` 30/30，`pnpm build` 通过。
- 2026-10-06：编译后的服务端 Fastify 注入冒烟返回 HTTP 200；桌面操作路由测试通过；`pnpm test` 32/32，`pnpm build` 通过。
- 2026-10-06：Electron 安装脚本经提权网络重试仍报 `TypeError: fetch failed`，桌面运行和打包验证待网络恢复。
- 2026-10-06：计划过期清理与已领取记录保留测试通过；`pnpm test` 33/33，`pnpm build` 通过。
- 2026-10-06：逐步骤状态及中断恢复测试通过；`pnpm test` 34/34，`pnpm build` 通过。
- 2026-10-06：审计事件及写入失败拒绝执行测试通过；`pnpm test` 36/36，`pnpm build` 通过。
- 2026-10-06：连接变更和模型出站审计测试通过；`pnpm test` 38/38，`pnpm build` 通过。
- 2026-10-06：PostgreSQL 读取结果增量收集测试通过；`pnpm test` 39/39，`pnpm build` 通过。
- 2026-10-06：MySQL 读取路径改为可读流，现有回归 39/39 和构建通过；真实目标待验证。
- 2026-10-06：SQLite 同连接事务提交和回滚集成测试通过；`pnpm test` 41/41，`pnpm build` 通过。
- 2026-10-06：执行状态、计划领取和审计意图同事务故障注入通过；`pnpm test` 41/41，`pnpm build` 通过。
- 2026-10-06：Runtime ID 持久化及能力握手测试通过；`pnpm test` 42/42，`pnpm build` 通过。
- 2026-10-06：远端握手校验和桌面切换状态清理代码通过构建；`pnpm test` 43/43，`pnpm build` 通过。
- 2026-10-06：PostgreSQL 16.13 临时实例真实连接、读取截断、写入与读写取消测试通过；`DBPILOT_TEST_POSTGRES=1 pnpm test` 44/44，`pnpm build` 通过；实例已停止。
- 2026-10-06：PostgreSQL 16.13 同连接事务提交、显式回滚和失败回滚通过；含真实 PG 的完整套件 45/45，构建通过；临时实例已停止。
- 2026-10-06：MySQL 8.0 临时容器真实连接、Schema、读取截断、DML、读写取消及事务提交/回滚通过；`DBPILOT_TEST_MYSQL=1 pnpm test` 45/45、构建通过；容器已停止。
- 2026-10-06：三栏 Web 工作台在本地浏览器完成 SQLite 连接创建、Schema 读取、`SELECT id, name, city FROM customers ORDER BY id` 预检和执行，结果显示 3 行；窄视口布局检查通过。`pnpm test` 43/43（真实 PostgreSQL/MySQL 4 项跳过），`pnpm build` 通过。

- 2026-10-06：按 `AGENTS.md` 引入 shadcn/ui 官方组件和 Tailwind，页面迁移为共享 workbench；`pnpm test` 43/43、`pnpm build` 通过，浏览器确认 Dialog 渲染与焦点。
- 2026-10-06：重做黑白工作台，接入 Monaco Worker 与 TanStack Table/Virtual；SQLite 表点击直接执行 SELECT 并显示 3 行，控制台记录可见；`pnpm test` 43/43、`pnpm build` 通过。视觉参照 WhoDB 的数据网格密度与留白，布局保持项目自己的三栏结构。
- 2026-10-06：新增按连接查询执行历史接口与桌面操作映射，持久化数据目录重启后仍可看到 SQL 和状态；`pnpm test` 45/45、`pnpm build` 通过。
- 2026-10-06：按用户明确修正，删除手动 SQL 的“执行前确认”步骤，点击执行直接运行已支持命令；同步更新 `AGENTS.md` 的人工/AI 授权规则。
- 2026-10-06：Monaco 按需加载、桌面执行记录 preload 暴露修复；`pnpm test` 46/46、`pnpm build` 通过，浏览器展开 SQL 控制台后可见编辑器；Electron 二进制安装仍因 `fetch failed` 受阻。
- 2026-10-07：工作台改为平面分区，SQL 编辑器位于数据/结构结果之上；浏览器使用临时 SQLite 连接检查 3 行网格与 3 字段结构，构建和 46 项测试通过。
- 2026-10-07：Web API 加入同源请求检查；跨站、异端口与不透明来源的写入请求测试均返回 403，同源与桌面式调用通过；48 项测试和构建通过。
- 2026-10-07：结果快照上限扩至 10,000 行；SQLite API 与浏览器全量分页验证通过。浏览器加载 10,000 行时只挂载约 15–16 个网格行，能滚动到第 10,000 行。
- 2026-10-07：命令日志从执行历史的逐步骤结果重建；持久化 Runtime 重启测试和独立浏览器页面的旧 SQL 日志显示通过；`pnpm test` 46/46、`pnpm build` 通过。
- 2026-10-07：修复“测试连接”400 并补连接表单测试；真实浏览器从无连接开始完成缺失文件提示、有效 SQLite 测试、保存、顶部复测和读取 `perf_rows` 100 行。API/桌面映射测试通过；`pnpm test` 51/51（4 项真实数据库测试跳过）、`pnpm build` 通过。
- 2026-10-07：结果快照增加默认 200 MiB 总数据预算，SQLite API 缩小预算测试旧结果 410 与历史保留；浏览器中旧结果可见过期提示。`pnpm test` 52/52（4 项真实数据库测试跳过）、`pnpm build` 通过。
- 2026-10-07：排查用户实际 Chrome `127.0.0.1:3137`，发现昨晚启动的旧编译服务缺少新连接测试及执行历史接口，直接请求复现 404 `Not Found`；替换为当前构建并保留唯一 SQLite 连接 ID/配置。表单错误独立显示，实际页面验证新建/编辑/顶部测试和失败后关闭弹窗；`pnpm test` 54/54（4 项真实数据库测试跳过）、`pnpm build` 通过。
- 2026-10-07：Runtime 增加不含密钥的 AI 配置状态；浏览器验证未配置时提示明确且发送/分析不可点，数据库连接和 3 行查询仍正常；`pnpm test` 55/55（4 项真实数据库测试跳过）、`pnpm build` 通过。
- 2026-10-07：排查 whoDB 可连接而本机 DBPilot 无法连接的 MySQL 地址；本机到 `172.18.0.7:3306` TCP 超时，尚未进入认证。连接测试增加按错误码分类的安全提示；`pnpm test` 63/63（4 项真实数据库测试跳过）、`pnpm build` 通过。需取得该 MySQL 的主机可访问地址和映射端口，或将 DBPilot Runtime 部署到同一容器网络后才能完成实际登录验证。
- 2026-10-07：用户提供可达 MySQL 地址后，确认测试连接成功但保存因 3137 Runtime 缺少主密钥返回 400。新增密钥文件启动方式与明确错误，将 3137 元数据迁至 `.data/runtime-3137` 并配置独立密钥；浏览器完成测试、保存、28 张表浏览，重启后已保存连接再次测试成功；`pnpm test` 64/64（4 项其他真实数据库测试跳过）、`pnpm build` 通过。

## 已知风险

- 当前服务端只适合本机开发。没有账号、可信审批来源隔离、完整 SQL 解析、完整审计覆盖和系统 Secret Store；不要对公网开放。
- PostgreSQL/MySQL 普通读取已实现超限提前取消；显式事务内读取仍排空完整查询，写入返回结果仍由驱动缓冲。
- 普通多命令计划中的成功写入不会因后续失败而自动回滚；SQLite/PostgreSQL/MySQL 有限语法的完整显式事务块已支持，更多方言语法待补。

- 2026-10-07 补充：F083/F084 进程与事务写入故障注入完成，176/176 测试及构建通过。新会话交接被自动审批拒绝，未创建新会话；已继续在当前会话完成上述增量。

## 2026-10-07 命令规则接续

F085 已完成限定范围后端规则与 Agent 执行接入。当前用户授权持续推进首版，每个可验证增量后检查额度，任一适用窗口剩余 ≤40% 时不启动下一项并汇总；允许因上下文向其他会话交接。用户 3137 Runtime 未重启，业务连接未用于写入测试。下一步补规则 UI/桌面配置与可信确认边界，再推进 Agent 连接管理、连续对话、真实模型和 TLS/SSH。

## 2026-10-07 F086–F087 接续

共享规则编辑与连续对话均已有实现和限定范围验收；最新三数据库回归 190/190 通过，构建通过。浏览器规则配置、焦点恢复、连续追问与刷新恢复通过，模型依然为 fixture。最新额度剩余 84%，未到 40% 停止阈值，应继续实质开发。用户 3137 Runtime 未重启，业务连接未用于写入测试。

正在恢复 Electron 44.5.1 官方二进制下载：Node 安装脚本长时间无输出，curl 官方地址可达但单连接慢，已确认 HTTP 206 支持分段；下载到临时目录并校验项目固定 SHA-256 后才可安装。桌面仍未验收，不能将下载开始计为交付。

### 桌面恢复的实际结果与下一步

Electron 44.5.1 官方 macOS arm64 ZIP 已从 GitHub 官方地址分段下载并通过包内固定 SHA-256 `1d75703019bb16461ae65f3081d7e6f5c0b11e901d0ccb5c343bcf7bcdd6435c`，解压在 `node_modules/electron/dist`，`path.txt` 已配置。下载阻碍已解除，下一步不能继续沿用“Electron 未下载”旧结论。

实际 Electron `process.versions.modules` 为 149，现有 better-sqlite3 12.11.1 原生模块为 Node ABI 127，直接加载报告 ABI 不匹配。必须实现桌面和 Server 原生依赖隔离并验证 SQLite 元数据/工作进程，不要直接重建唯一 Node 原生文件导致 Server 回归。当前仍未实现隔离。另一个启动死锁已由 F088 修复并用真实窗口测试验证：ESM 顶层等待 ready 改为 `app.whenReady().then(...)`。参考官方 ESM 生命周期说明：https://www.electronjs.org/docs/latest/tutorial/esm 。

临时诊断脚本 `/private/tmp/dbpilot-desktop-validation.mjs` 使用缓存 Playwright Electron API 启动 `/private/tmp/dbpilot-desktop-validation-entry.mjs`，入口创建临时 userData 后加载仓库主入口，模型配置从测试子进程环境中移除。脚本当前捕捉 Runtime 错误并截图，实际输出仍为 Local Core failed to start。可复用但不能把 exit 0 当作 Core 已可用。已验证 ZIP 留在 `/private/tmp/dbpilot-electron-verified.zip`，下载分段和脚本也在临时目录。

交接状态：尝试创建接续会话两次均被自动审批审查拒绝。第二次已读取来源会话 01a114e8-9124-7d23-a701-c579466a900c 的原始 userMessage 核对授权，但审查仍要求用户在当前会话明确批准交接；因此未创建任何新会话，未绕过限制。最新额度剩余 83%。所有当前改动保留；3139 隔离验收服务与 dbpilot-policy 浏览器已关闭，无下载或桌面探针仍在运行。下一步是解决桌面 SQLite ABI149/Node ABI127 隔离。

## F091 桌面 SQLite 原生依赖隔离

- 行为：为 Electron 独立编译 SQLite 原生模块，按版本、ABI、系统和架构加载；Node 服务继续使用原模块。元数据、连接检查与查询子进程共用选择入口；打包禁止重建根依赖。
- 文件：`packages/storage/src/native-database.mjs`、`native-database.d.mts`、存储模块、`apps/server/src/app.ts`、`sqlite-worker.mjs`、`scripts/prepare-desktop-native.mjs`、`scripts/copy-runtime.mjs`、`package.json`、`pnpm-lock.yaml`、`tests/desktop-native.test.ts`、`docs/plans/2026-10-07-desktop-native-isolation.md`。
- 证据：macOS arm64 编译成功，真实 Electron Runtime 返回200；Renderer IPC→Core→SQLite子进程查询42成功，随后Node重新打开同一临时数据库成功；全启用回归198/198通过，构建通过。
- 限制：F088/F090的ABI阻碍已解除；Windows、安装包、完整桌面UI和Remote仍待验收。首次准备需要C++工具链与官方头文件下载。不支持跨系统编译。未访问或重启现有3137服务。

## F092 桌面编辑器与 Remote 验收

- 行为：桌面 CSP 允许 Monaco 动态主题/布局样式，脚本和 Worker 仍限于打包资源；阻止内联脚本、表单提交和 base URL 修改。
- 文件：`apps/desktop/main.mjs`、`tests/desktop-bootstrap.test.ts`、`tests/desktop-remote.test.ts`、`docs/plans/2026-10-07-desktop-native-isolation.md`。
- 证据：真实 Electron 中修改前复现 style-src 拦截，修改后无样式拦截；输入 SQL 并按 Cmd+Enter 返回42；`app://dbpilot/assets/editor.worker-*.js` 启动且消息处理函数存在；截图 `output/playwright/desktop-editor-after.png`。桌面三项测试通过，包含内联脚本仍被拦截、Local查询、Remote HTTP查询73/拒绝不安全URL/切回Local保持身份与连接隔离。
- 限制：验证平台为 macOS arm64 开发态；Remote 使用 loopback HTTP 隔离 Runtime，不代表跨主机 HTTPS、Windows、安装包或真实模型已经通过。Worker 已验证加载，但未覆盖所有语言服务行为。

## F093 macOS 开发应用包与隔离配置目录

- 行为：补充开发版本0.1.0-dev，完成macOS arm64应用包与DMG构建；主进程支持绝对路径环境变量 `DBPILOT_DESKTOP_DATA_DIR`，用于独立配置目录，沿用safeStorage密钥机制。
- 文件：`package.json`、`.gitignore`、`apps/desktop/main.mjs`、桌面测试文件、`scripts/validation/desktop-packaged.mjs`、`README.md`。
- 证据：electron-builder生成 `output/desktop-pack/mac-arm64/DBPilot.app` 与 `DBPilot-0.1.0-dev-arm64.dmg`；真实打包应用报告isPackaged=true，确认临时配置路径，本地查询子进程返回42；退出重启后Runtime身份、连接、成功执行记录均保留。验证脚本退出0并清理临时目录。
- 限制：未签名/未公证，仍使用默认原生应用图标；DMG仅生成，未安装到Applications或验证Gatekeeper。Windows未构建。F094后已重新打包，真实应用包再次通过SVG图标显示、本地查询与重启恢复验证。

## F094 Iconify 统一图标

- 行为：引入 `@iconify/react` 6.0.2 和 `@iconify-icons/lucide` 2.0.16，使用离线渲染器与逐个静态图标数据；统一品牌、连接/表树、工具栏、SQL/结果/结构、AI操作、排序、加载与弹窗/下拉框图标，移除字符图标和lucide-react直接依赖；补充同风格favicon。
- 文件：`packages/ui/src/icons.tsx`、`packages/ui/src/components/{select,dialog}.tsx`、`packages/ui/README.md`、`packages/workbench/src/{Workbench,AgentPanel,AiSettings,PolicySettings,ResultGrid}.tsx`、`workbench.css`、`apps/web/index.html`、`apps/web/public/favicon.svg`、`package.json`、`pnpm-lock.yaml`。
- 证据：构建通过；真实三数据库及桌面全套199/199通过；隔离浏览器查询/设置弹窗正常，146个SVG图标、无外部资源请求，1365×900及390×844页面无整体溢出；截图 `output/playwright/iconify-{workbench,results,settings,mobile}.png`。
- 限制：只包含本地图标集中的所需图标，无在线搜索/下载图标功能；按钮文字和无障碍名称保留，装饰图标aria-hidden；加载动画尊重减少动态效果设置。未更新现有3137服务。

## 2026-10-07 本轮界面优化交付边界

按用户五项要求完成 F089/F090，具体操作及验收见 `docs/plans/2026-10-07-workbench-layout-ai-settings.md`。最终浏览器另确认非当前连接的修改/保存/测试操作成功，刷新后 API Key 仅显示“已设置”，输入框仍为空。额度检查剩余 81%。

现有 3137 服务尚未检查或升级：自动审批审查拒绝读取其连接标识/执行状态/配置状态，认为涉及潜在业务元数据；已请求用户授权后再检查并升级。未绕过限制，全部功能在临时数据库和模拟模型端点的 3139 验收环境验证。没有使用用户业务连接或真实 API Key。

## F095 服务器级连接、层级导航与连接记录删除

- 行为：PostgreSQL/MySQL默认数据库可留空，按账号权限发现数据库并选择查询目标；连接/数据库/Schema表分组独立折叠，提供全部展开/收起和侧栏顶部跨连接搜索。每条连接提供测试、设置、删除确认；重复记录按ID单独移除，不删除底层数据库。精确数据库固化到计划、幂等指纹及历史，Agent工具和Desktop IPC共用同一目标解析。切换连接时丢弃过期历史响应。
- 文件：`packages/workbench/src/ConnectionNavigator.tsx`、`Workbench.tsx`、`AgentPanel.tsx`、`workbench.css`、`packages/protocol/src/index.ts`、`packages/storage/src/plans.ts`、`packages/runtime-client/src/desktop-operations.ts`、`packages/ai-core/src/{tools,agent}.ts`、`apps/server/src/app.ts`、`apps/desktop/preload.cjs`、`tests/connection-catalog.test.ts`、桌面/Agent相关测试、`scripts/validation/navigation-ui.mjs`、`README.md`、`docs/plans/2026-10-07-connection-navigation.md`。
- 证据：真实三数据库及Electron全回归205/205通过；构建通过；最终历史隔离/截断标记修正后相关17项测试再次通过。真实PG/MySQL无默认库发现与两库相同SQL分别41/42、执行不可换库及幂等冲突验证通过；Electron IPC目录/Schema/查询通过。浏览器已验收跨未展开连接搜索、独立折叠、全展开/收起、PG跨库表查询、空默认库保存测试、删除取消焦点恢复、重复记录只删一个且库仍可读；桌面及390px窄屏无页面溢出，截图见导航说明。
- 限制（后由F096更新）：F095交付时目录有SQLite2,000表/视图、PG/MySQL5,000字段元数据上限；F096已解除导航目录的该限制，旧全库Schema/AI检索仍有预算。PG无默认库使用postgres发现入口，需要CONNECT权限。外部DDL后需刷新目录页面。真实模型、Windows及跨主机HTTPS未验证；未访问/升级用户3137服务。


## F096 大目录分页与字段按需加载

- 行为：导航/跨连接搜索使用每页200个表名的键集分页，逐页读取所有可见表名；点击表后单独读取该表字段。游标绑定连接ID/版本/数据库，不能跨库复用；特殊标识符使用参数化字段查询。旧全库Schema接口保持有界预算与截断标记。连接被修改或删除后，忽略迟到目录响应。
- 文件：`apps/server/src/catalog.ts`、`app.ts`、`packages/protocol/src/index.ts`、`packages/runtime-client/src/desktop-operations.ts`、`apps/desktop/preload.cjs`、`packages/workbench/src/{ConnectionNavigator,Workbench}.tsx`、`tests/connection-catalog.test.ts`、`tests/desktop-{operations,native}.test.ts`、`scripts/validation/navigation-ui.mjs`、README及连接导航说明。
- 证据：真实三数据库203项及最新构建后三个真实Electron测试全部通过（合计206），构建通过；SQLite2,105表完整分页，PG/MySQL206表跨两页无重漏、游标目标错配400、单表字段及空格/引号表名验证通过。浏览器两个2,105表连接跨页搜索命中末尾表，搜索25个目录请求且不预读字段，点击后加载2列；全展开/收起及390px无页面溢出，截图见导航文档。
- 限制：目录是实时元数据，扫描期间的外部DDL不提供快照一致性；刷新页面可重载。搜索首次要读取全部表名，目录树尚未虚拟化，未宣称十万节点性能通过。AI旧全库Schema工具仍有预算。Windows、真实模型和跨主机HTTPS验收不在本增量内。

## F097 全局 Toast 与控件状态收敛

- 行为：操作成功/失败统一到右下角固定通知层，位于弹窗/下拉框上方，不撑开局部布局；重复错误去重、最多可见3条、可关闭和悬停暂停。表单格式校验留在表单内，执行日志/部分完成证据保留。AI选择器缩至28px，统一锚定下拉菜单；标签页只保留单一下划线，去掉重复边框/底色/阴影和双线交叉动画，键盘焦点继续可见。连接弹窗次要按钮采用明确变体。
- 文件：`packages/ui/src/components/sonner.tsx`、`packages/ui/src/notify.ts`、共享`button/select/tabs/dialog`、`icons.tsx`、`packages/workbench/src/{Workbench,AgentPanel,AiSettings,PolicySettings,ConnectionNavigator}.tsx`、`workbench.css`、`packages/ui/README.md`、依赖清单/锁文件、`scripts/validation/desktop-packaged.mjs`、`docs/plans/2026-10-07-global-notifications.md`。
- 证据：Sonner2.0.8实际安装，构建通过，最新三个真实Electron测试通过。浏览器连接测试前后行/弹窗尺寸相同；真实缺失SQLite文件失败通知位于遮罩上方且关闭不关闭弹窗；空路径本地校验保留；AI模拟502及模型列表成功均走全局通知；SQL拼写/真实缺失字段错误均提示且编辑器不位移。标签border0、shadownone、单一下划线，方向键正常；390px通知不越界、页面无新增溢出。
- 限制：真实模型、Windows、跨主机HTTPS及完整屏幕阅读器矩阵未验证；通知是瞬时反馈，执行历史仍为持久证据。未访问/升级3137服务。Sonner安装曾因默认网络路径超时，切为单次IPv4安装后完成；未读取被审批拒绝的npm凭据配置。

F097打包补充：最新macOS arm64应用包/DMG已重新生成，包含F095–F097全部变更。真实打包应用验证全局Toast位于配置弹窗上方且未被aria-hidden隐藏、弹窗矩形不变、关闭Toast后Dialog仍可见并能编辑准确命名的文件路径输入框；SQLite查询42、重启后Runtime/连接/执行状态保留均通过。原脚本超时来自桌面“浏览”按钮混入输入标签，已修正htmlFor/id关联，不能误记为真实弹窗关闭故障。所有本轮临时浏览器/服务和打包验收目录已清理。

## F098 Agent 固有工具、待办与聊天/规则抽屉

- 行为：新增严格校验的 `update_todo`（最多12项、唯一ID、最多一个进行中项、每轮隔离）与 `command_reference`（ls/pwd/head/tail/grep/wc固定参考，明确未执行）；工具继续经过审计、取消和调用预算。新对话固定在聊天顶部；用户右侧、助手左侧、按内容宽度排布并标明说话人。规则编辑改为右侧全高抽屉，规则列表独立滚动、操作区固定，复用shadcn/Radix焦点机制。
- 文件：`packages/ai-core/src/{tools,agent}.ts`、`packages/workbench/src/{AgentPanel,PolicySettings}.tsx`、`workbench.css`、`packages/ui/src/components/dialog.tsx`、`packages/ui/README.md`、`tests/agent-tools.test.ts`、`docs/plans/2026-10-07-agent-foundation.md`。
- 证据：工具/Agent相关15项测试及构建通过；完整普通回归183通过/28条件测试跳过（含F099的3个轮询测试）。真实浏览器临时SQLite+模拟模型发送生成建议成功，用户x1080/宽106，助手x874/宽185.84，聊天区宽340，无横向溢出；规则添加并保存版本1成功。抽屉首次实测暴露Tailwind独立translate残留，已从右侧变体移除居中类并通过边界断言，Escape关闭后可继续聊天。
- 限制：Linux命令仅静态说明，不执行Shell、不读文件；待办是模型计划，不是执行证据。未宣称真实模型、Windows或桌面本轮UI矩阵已验证。会话持久化、流式输出继续推进；未修改用户3137运行实例。

## F099 Agent 只读状态重连

- 行为：任务状态读取采用最多5次连续失败的退避重试；持续观察等待确认状态，避免超时取消后界面仍显示可确认。404/410/权限拒绝立即停止重试，显示明确提示与手动刷新入口。恢复失败保留会话标识；只重试GET，不重发创建/确认/执行。迟到响应在切换会话后丢弃。HTTP/IPC错误携带状态码。
- 文件：`packages/runtime-client/src/{agent-poll,errors}.ts`、`packages/workbench/src/AgentPanel.tsx`、`tests/agent-poll.test.ts`。
- 证据：重试恢复、等待审批轮询、终态停止、404/410及退避上限、卸载后迟到响应共3测试通过，错误展示2测试通过；构建通过。实际网络中断UI验收继续进行。
- 限制：轮询不是实时流；Runtime不可达时无法证明数据库是否完成，需恢复后核对执行历史，不允许自动重放写入。

## F100 Agent 有界会话持久化与历史入口

- 行为：当前Runtime在metadata.db保存最近32轮Agent快照、待办、工具结果及原请求幂等信息；有dataDir时跨重启恢复。历史抽屉列出各对话最新轮次，可打开并继续；每轮工具权限重新建立。启动时将未完成记录标为失败/中断并删除待确认UI信息，不恢复执行循环。上下文仍限制6轮/24000字符，单快照1MiB预算。父子分支与新增记录同事务提交，旧分支拒绝继续。
- 文件：`packages/storage/src/agent-runs.ts`、`packages/ai-core/src/agent.ts`、`apps/server/src/app.ts`、`packages/protocol/src/index.ts`、`packages/workbench/src/{AgentHistory,AgentPanel}.tsx`、`packages/runtime-client/src/desktop-operations.ts`、`apps/desktop/preload.cjs`、`tests/{agent-persistence,desktop-operations}.test.ts`。
- 证据：重启后读历史/去重不触发模型、新请求带历史、分支跨重启保护、中断恢复清除确认、32条上限/事务回滚测试通过；最新相关21项测试与构建通过。模型为fixture，浏览器与本轮桌面验收继续推进。
- 限制：会话含有界查询结果与文本，保存在本机元数据库，使用数据目录文件权限保护，未另做整库加密；配置密钥继续独立加密不进入会话。保留上限是轮数，不承诺无限历史。恢复记录不恢复结果快照/旧审批；执行日志仍是数据库执行证据。

F098–F100 浏览器补验：1200px真实浏览器完成待办更新/命令参考/最终回答、新对话、历史抽屉恢复；390px页面与聊天头均无横向溢出。人为拦截两次任务GET请求后显示重连提示并自动恢复最终回答，期间POST创建次数断言为1。截图 `output/playwright/agent-history-todo.png`。F100独立请求账本保留淘汰任务的去重凭据，旧ID返回410不重放，最多100,000条后拒绝新任务；持久化/淘汰测试通过。

## F101 模型流式回答与完整工具调用门槛

- 行为：模型请求启用SSE，逐步呈现回答并标注正在输出；仅在完整完成原因/[DONE]与参数校验通过后执行工具。处理跨chunk/UTF-8、多工具参数分片、取消与1MiB传输预算、16,000字符回答预算。非流式兼容响应仍可直接读取，不重发请求。模型单调用60秒，现有Agent总预算5分钟。失败的部分回答明确标注未完成；滚动到底部时跟随新内容，阅读历史时不强制跳转。
- 文件：`packages/ai-core/src/{completion-stream,deepseek,agent}.ts`、`apps/server/src/app.ts`、`packages/workbench/src/AgentPanel.tsx`、`tests/completion-stream.test.ts`、`scripts/validation/agent-ui.mjs`、Agent基础设计说明。
- 证据：流分片、UTF-8、工具组装、截断/断流/超预算/取消、不完整工具零dispatch六项测试通过；浏览器捕获到“DBPilot · 正在输出”和部分文字“这是”，随后完成完整回答，截图 `output/playwright/agent-stream-partial.png`。截至本增量真实三数据库及Electron回归220/220通过，构建通过。
- 限制：模型为可控fixture；真实供应商待用户授权使用现有配置。浏览器到Runtime仍为700ms状态轮询，未宣称逐token SSE到Renderer；纯文本渲染，未增加Markdown解析。

## F102 所选模型工具能力测试与错误分类

- 行为：AI设置拆分模型列表和“测试模型与工具”；后者发送固定提示/无副作用probe定义，核对确切工具返回，不访问数据库、不保存配置或会话。认证、限流、模型不存在、网络/TLS、输出协议错误分别给出安全提示，不透传供应商正文/密钥。共享POST DTO与Desktop具名IPC。
- 文件：`packages/ai-core/src/{deepseek,model-errors,agent}.ts`、`packages/protocol/src/index.ts`、`apps/server/src/app.ts`、`packages/runtime-client/src/desktop-operations.ts`、`apps/desktop/preload.cjs`、`packages/workbench/src/AiSettings.tsx`、`tests/{ai-model-probe,desktop-operations}.test.ts`。
- 证据：探测成功/无会话保存、模型不支持、401/429/404/500、密钥目标绑定与跨站拒绝通过；与流式/配置/IPC合计29项测试通过，构建通过。模拟模型浏览器按钮已触发，最终提示继续核验。
- 限制：探测通过仅证明当次模型响应与工具契约，不代表真实数据库任务成功。真实账号测试待明确授权；未访问3137服务。

F100–F102 桌面/浏览器补验：真实Electron Local通过具名IPC完成待办/命令参考，退出并再次启动同一临时Runtime后，历史/待办/证据保留，模型总调用次数仍为4，确认没有自动恢复执行。新增 `tests/desktop-agent.test.ts`。浏览器模型设置点击“测试模型与工具”显示 `fixture-only 模型响应及工具调用测试通过`；没有创建新的对话或数据库执行。

## F103 TTL 生命周期与无数据目录执行证据

- 行为：集中计划10分钟、Agent5分钟和默认结果10分钟预算；校验结果TTL为1ms–24h，Runtime握手公开各预算。审批UI展示本轮截止时间；超时任务拒绝resume。Agent读取过期结果明确返回RESULT_EXPIRED并停止，不重跑SQL。
- 根因修复：原先无dataDir时ExecutionJournal不保存任何状态，结果TTL删除内存结果后，执行GET返回404，Agent可能无法观察已完成操作。现改为独立保存最多10,000条内存状态摘要（不含结果行），结果过期只释放数据；持久模式仍使用现有SQLite日志。
- 文件：`packages/core/src/budgets.ts`、`packages/storage/src/executions.ts`、`apps/server/src/app.ts`、`packages/ai-core/src/{agent,tools}.ts`、`packages/protocol/src/index.ts`、`packages/workbench/src/AgentPanel.tsx`、`tests/{agent,agent-tools.integration,executions,runtime-identity}.test.ts`。
- 证据：新增真实SQLite写入+读取过期测试先复现等待执行阶段404，修复后33项相关回归通过；过期后返回410且底层行数仍1、执行状态仍succeeded。审批超时不dispatch、非法TTL参数、内存记录隔离/10,000条上限测试通过，构建通过。
- 限制：内存状态仍随Runtime退出丢失；10,000条之外历史可能仅剩计划记录，不能推断写入结果。结果缓存过期不等于数据库断线，恢复数据需要用户发起新查询，不能自动重放写入。

## F104 TLS 私有 CA、服务器名与统一连接路径

- 行为：网络连接增加可选PEM CA/逻辑证书服务器名；PostgreSQL显式验证CA及指定身份，MySQL统一流式/Promise工厂强制rejectUnauthorized/verifyIdentity。MySQL逻辑身份与实际TCP目标分开，测试、目录、Schema、读写、事务、取消连接均使用相同TLS配置。通过IP连接MySQL时要求提供证书DNS名称，拒绝驱动的localhost身份回退，不提供关闭验证开关。共享连接表单支持保存/编辑这些字段。
- 根因与证据：专用MySQL已有CA可信但主机名不符时，原驱动路径实际SELECT成功，失败测试明确得到expected false/actual true；修复后拒绝。独立临时PG/MySQL TLS实例使用短期CA及dbpilot.test证书，正确身份可测试/列库/列表/执行SELECT 73，缺CA/错误名称/缺逻辑名称均502拒绝，3项真实TLS测试通过。
- 文件：`apps/server/src/{tls-options,driver-values,app,catalog,connection-errors}.ts`、`packages/protocol/src/index.ts`、`packages/workbench/src/Workbench.tsx`、`tests/tls-driver.test.ts`、`tests/tls.integration.test.ts`、`scripts/validation/tls-fixture.mjs`。
- 限制：MySQL仅含IP SAN且无DNS名称的证书暂不支持；没有关闭校验绕过。TLS浏览器操作与更广泛驱动矩阵继续复验；SSH未在本增量实现。证书为临时测试证书，非用户生产配置。测试实例仅loopback55435/55436，与现有55433/55434及用户3137隔离。


F104补验：浏览器私有CA/服务器名连接测试与保存通过；真实三数据库、TLS及Electron全量237项通过。MySQL主机名错误回归独立通过。

## F105 固定指纹 SSH 隧道与断线语义

- 行为：PG/MySQL支持单跳SSH密码认证、用户预先核验的SHA256主机指纹；每次数据库操作拥有独立loopback转发租约，最多32个，无Shell/SFTP、自动信任或重连重放。测试、目录、查询、事务、取消共用隧道路径，SSH+TLS保留原证书逻辑身份。SSH密码单独加密保存、接口不回显；编辑时仅相同跳板机身份可复用空密码。
- 文件：`apps/server/src/{ssh-tunnel,connection-errors,app,catalog}.ts`、`packages/storage/src/connections.ts`、`packages/protocol/src/index.ts`、`packages/workbench/src/{Workbench.tsx,workbench.css}`、`tests/fixtures/ssh-server.ts`、`tests/{ssh.integration,ssh-secrets,ssh-tls.integration,ssh-loss.integration,desktop-ssh}.test.ts`、`scripts/validation/ssh-ui.mjs`、`docs/plans/2026-10-07-ssh-connectivity.md`、依赖清单与锁文件。
- 证据：真实ssh2协议服务器连接真实PG/MySQL，正确指纹成功、错误指纹在认证前拒绝、认证失败安全返回；SSH+TLS正确证书成功/错误名称拒绝；写入中断报告outcome_unknown，重复旧计划不增加连接或执行。真实Electron Local经具名IPC测试与保存成功。最新构建通过，51文件246项完整回归全部通过，日志`/private/tmp/dbpilot-ssh-full-tests.log`。
- 限制：首增量仅密码认证，私钥/代理/多跳未实现；使用真实SSH协议fixture，尚未对独立OpenSSH服务器验收。ssh2可选native加速未启用，已验证纯JS路径及Electron可运行。浏览器确认SSH密码不回显，留空测试连接实际返回200，截图`output/playwright/ssh-connection.png`。未访问用户3137实例。


## F106 Agent 连接草稿与凭据表单交接

- 行为：固有工具request_connection只整理非秘密字段，无Runtime调用，不保存或连接数据库。聊天显示查看草稿入口，用户点击后预填共享连接表单；网络草稿默认启用TLS，密码与SQLite路径由用户在表单填写。保存仍为人工操作，当前会话授权不会扩大，需新对话使用新连接。长连接表单固定标题和操作区，字段区独立滚动。
- 文件：`packages/protocol/src/index.ts`、`packages/ai-core/src/{tools,agent}.ts`、`packages/workbench/src/{AgentPanel,Workbench}.tsx`、`workbench.css`、`tests/agent-tools.test.ts`、`scripts/validation/agent-ui.mjs`、`docs/plans/2026-10-07-agent-connection-draft.md`。
- 证据：新增测试先失败后通过，拒绝密码/SSL/SSH/审批额外参数、不扩展授权及零dispatch；相关15项测试、构建通过。浏览器模型fixture生成草稿，点击前连接POST为0，表单名称正确、密码空、TLS开启，截图`output/playwright/agent-connection-draft.png`。
- 限制：不是模型自动创建连接；不在聊天收集凭据，不接Skills/MCP。真实模型尚待授权测试。Desktop共用表单，但此增量桌面UI仍待验收。


F098–F106 桌面UI补验：`scripts/validation/desktop-agent-ui.mjs`以真实Electron窗口在Local与loopback Remote两种模式完成聊天左右布局、待办、规则抽屉右贴边/全高、Escape、新对话输入焦点、连接草稿无密码/TLS默认启用、历史抽屉验证。模型为fixture，截图`output/playwright/desktop-agent-{local,remote}.png`。F106后全量247项真实数据库/桌面回归通过。

## F107 Agent 取消完成前保持任务锁

- 根因：原cancel方法在数据库取消/在途模型请求结束前就设置cancelled，其他请求能在清理间隙启动新的Agent。新增cancelling状态，UI禁用新任务、轮询继续，Runtime单Agent锁持续到清理完成；重复取消共享同一Promise。执行取消后最多35秒读取终态，仍运行/读取失败明确outcome_unknown，不重放写入；取消证据更新已有执行项而非遗失最终状态。
- 文件：`packages/ai-core/src/{agent,tools}.ts`、`packages/protocol/src/index.ts`、`packages/runtime-client/src/agent-poll.ts`、`packages/storage/src/agent-runs.ts`、`apps/server/src/app.ts`、`packages/workbench/src/{AgentPanel,AgentHistory}.tsx`、`tests/{agent,agent-tools,agent-poll,agent-api}.test.ts`。
- 证据：状态竞态测试先红后绿；API在模型请求尚未结束时取消，GET返回cancelling且新任务409，迟到回答丢弃；取消后连续读取直到终态且启动计数仍1，相关19项测试通过。完整构建/回归继续验证。
- 限制：取消不是回滚，35秒后仍未确认的数据库操作可能继续运行，必须按执行记录核对；该状态不证明数据库端停止。Runtime重启把cancelling记录视为中断且不重放。

F107补验：最新51文件249项真实数据库/TLS/SSH/Electron回归及构建通过。macOS arm64应用与DMG重新生成，打包应用Local/Remote的Agent交互、SQLite查询42、重启恢复与Toast/表单均通过。打包曾停在重复Electron下载，改用已安装同版本electronDist完成；未签名/公证。此包截至F107，后续代码增量需重新打包。

## F108 所选结果分析统一到 Agent 对话

- 行为：移除工作台独立分析聊天状态，“新对话分析当前结果”以建议模式启动Agent，只授权所选结果连接。Runtime用执行计划核对executionId/connectionId/setId，要求结果完成且未过期。get_selected_result仅读精确快照最多50行，保留截断与执行来源；不拥有/取消用户执行。分析、后续追问、取消、历史和新对话共用Agent机制。
- 文件：`packages/protocol/src/index.ts`、`packages/storage/src/plans.ts`、`packages/ai-core/src/{tools,agent}.ts`、`apps/server/src/app.ts`、`packages/workbench/src/{Workbench,AgentPanel}.tsx`、`workbench.css`、`tests/{agent-selected-result,agent-tools}.test.ts`、`scripts/validation/agent-ui.mjs`、`docs/plans/2026-10-07-agent-selected-result.md`。
- 证据：真实SQLite先写入42再分析，底层计数仍1；范围外请求403，过期410且模型调用不增；拒绝工具目标伪造、取消Agent不取消用户查询，相关12项通过，构建通过。浏览器查询SELECT 1后分析成功，分析阶段执行POST为0，新对话不残留旧回答且历史可见；截图`output/playwright/agent-selected-result.png`。
- 限制：模型为fixture，前50行不是全量统计，宽数据仍受工具上下文预算约束。旧/ai/analysis接口保留兼容但共享UI不再调用；新分析进入新会话，原会话保留历史。此增量尚未打包。

## F109 模型流结束与协议一致性

- 根因：模型发出有效[DONE]但HTTP保持打开时，旧解析器继续等待EOF，最终误报超时。现收到完整finish_reason与[DONE]即完成并取消reader释放连接；同一已缓冲数据中的尾随非法事件仍拒绝。JSON兼容响应若提供finish_reason则必须与工具调用存在性一致；严格UTF-8解码，损坏字节不静默替换进工具参数。
- 文件：`packages/ai-core/src/completion-stream.ts`、`tests/{completion-stream,model-stream-http}.test.ts`。
- 证据：保持打开流与矛盾finish_reason测试先失败，修复后流/模型探测12项通过；分片/取消/预算和不完整工具零dispatch继续通过。真实HTTP SSE释放测试继续验证。
- 限制：仍以完整结束标记为工具执行前提，不兼容缺[DONE]的非标准SSE；可兼容完整JSON响应，未宣称真实供应商已验收。

F109真实HTTP补验：本机SSE服务发送finish_reason/[DONE]后故意保持响应打开，Agent立即返回完整内容且服务器观察到连接释放；仅一个模型请求。`tests/model-stream-http.test.ts`通过。

## F110 Agent 模型身份与审计关联

- 行为：每轮快照保存实际provider/model ID，聊天显示实际使用模型，配置后续变化不改写旧记录。工具审计记录可信runId、顺序stepId和toolCallId，模型出站审计关联runId与实际模型；参数仅保存哈希。元数据库启动时为旧audit表增列，不删除历史。
- 文件：`packages/storage/src/audit.ts`、`packages/ai-core/src/{agent,tools}.ts`、`packages/protocol/src/index.ts`、`apps/server/src/app.ts`、`packages/workbench/src/AgentPanel.tsx`、`tests/agent-provenance.test.ts`。
- 证据：来源测试先失败后通过，任务模型为fixture-model且工具审计精确关联创建的runId/reference-1:0/step1；快照与审计均不含fixture密钥。相关16项测试及类型检查通过。
- 限制：模型标识来自本轮配置，不证明服务端实际部署模型版本；本地审计不防拥有文件权限者篡改，未记原始参数/模型正文。

F110补验：旧audit表带已有记录升级后记录保留；修改配置并重启后，旧对话仍保留原模型fixture-model且没有新模型调用；6项审计/来源测试通过。

## F111 Runtime 数据目录单进程所有权

- 根因：此前第二个Runtime能打开同一元数据库，启动恢复会把第一个实例的活跃Agent/执行记录误标为中断，并绕过内存单Agent锁。新增SQLite事务领取的本机进程所有权，在初始化其他存储/恢复之前拒绝活跃所有者；仅确定同主机PID不存在时接管。正常关闭按随机token释放，旧实例不能释放新所有者。启动异常统一关闭已初始化存储和定时器。
- 文件：`packages/storage/src/runtime-lease.ts`、`apps/server/src/app.ts`、`tests/runtime-ownership.test.ts`。
- 证据：重复createApp测试先得到未拒绝，修复后拒绝；正常关闭重开Runtime身份相同，Web目录缺失启动失败后可重开；真实独立Node进程存活时拒绝、SIGKILL退出后可接管。与持久化恢复合计5项通过，类型检查通过。
- 限制：仅本机普通文件系统；其他主机/无法核验PID保守拒绝，PID复用可能导致保守阻断。旧版本不识别新所有权表，升级需先关闭旧Runtime；未提供共享网络盘运行支持。

F111补验：完整55文件260项真实数据库/TLS/SSH/Electron回归与构建通过。

## F113 固有工具输出结构校验

- 行为：所有固有工具的成功返回先经各自Zod输出结构校验、去除未声明字段，再进入模型上下文；执行状态读取与取消核对亦校验状态枚举与步骤结构。保留上下文大小预算，格式异常停止任务，不能作为执行成功证据。
- 文件：`packages/ai-core/src/tool-outputs.ts`、`packages/ai-core/src/tools.ts`、`tests/agent-tools.test.ts`。
- 证据：注入Runtime额外password字段先复现流入工具返回，修复后剔除；异常数据库列表拒绝。26项Agent工具/真实SQLite/多连接/所选结果回归通过。依赖安装完成后进行完整构建。
- 限制：数据库查询值仍是用户授权的模型输入，输出校验不进行数据内容脱敏；每个结果最多50行、1000列及20,000字符预算，超过预算拒绝而不伪造全量结果。

## F114 Agent 分页找表与单表字段工具

- 行为：search_schema改为复用真实分页表目录，每次最多扫描5页/1000个表名，找到匹配页即返回，未耗尽时给nextCursor；不会一次读取全库字段。新增describe_table要求明确schema/table，只读取一个目标表字段。系统提示明确空匹配但有cursor不代表不存在，需继续检索。
- 文件：`packages/ai-core/src/{tools,tool-outputs,agent}.ts`、`packages/workbench/src/AgentPanel.tsx`、`tests/agent-schema-search.test.ts`。
- 证据：真实SQLite2,105表检索命中最后的t_2104，找表阶段字段请求0，describe后字段请求1并返回INTEGER字段；新测试先失败后通过，与工具/真实SQLite合计16项通过。
- 限制：目录不是执行快照，外部DDL期间可能变化；Agent仍受32工具/12模型轮/5分钟预算，不承诺任意大目录可完整扫描。名称匹配为包含匹配；单表字段1000列/20,000字符上限，需报告截断/预算失败。

## F112 安全 Markdown 聊天排版与代码复制

- 行为：共享UI实际安装react-markdown10.1.0/remark-gfm4.0.1，助手当前回答与历史支持标题、列表、代码及表格；代码块使用shadcn按钮复制，未完成回答禁用复制。禁用原始HTML、远程图片和非HTTP(S)链接，不增加代码执行入口。代码/表格在气泡内滚动。
- 文件：`packages/ui/src/components/markdown-message.tsx`、`packages/ui/README.md`、`packages/workbench/src/AgentPanel.tsx`、`workbench.css`、依赖清单/锁文件、`tests/markdown-message.test.tsx`、`scripts/validation/agent-ui.mjs`。
- 证据：脚本/iframe/图片/危险链接渲染测试与未完成代码禁用测试通过，构建通过。浏览器实际复制内容为SELECT 42 AS answer;，脚本未执行、远程图片请求0；390px无页面溢出，截图`output/playwright/agent-markdown{,-mobile}.png`。
- 限制：代码未做语法高亮；远程图片显示文字占位，复制不等于执行。依赖安装先遇到官方registry长等待/ECONNRESET，保留缓存后以短超时重试完成；没有使用替代自制Markdown解析器。

F108/F112桌面补验：真实Electron Local和loopback Remote都通过统一结果分析、Markdown排版与代码复制。首次复制被既有权限策略阻止，新增校验可信窗口来源、最多16,000字符的只写剪贴板IPC，保留全局权限拒绝策略，不暴露读取接口；超长文本实际拒绝且原测试剪贴板内容不变。涉及`apps/desktop/{main.mjs,preload.cjs}`、`apps/web/src/desktop.d.ts`、共享Markdown组件；20项桥接/渲染测试通过，真实窗口脚本`scripts/validation/desktop-agent-ui.mjs`两模式全部通过。

## F115 Desktop Core 进程恢复与来源隔离

- 行为：IPC挂起请求绑定具体Utility实例，旧实例退出只拒绝自己的请求，不清除新实例/新请求。初始化失败只终止自身实例；数据目录占用通过固定错误码给出可操作提示，不透传启动异常细节。读取可在Core退出后重新初始化，不重发写入。
- 文件：`apps/desktop/{main.mjs,utility.mjs}`、`packages/storage/src/runtime-lease.ts`、`scripts/validation/desktop-core-recovery.mjs`。
- 证据：代码检查发现旧exit回调使用全局child/pending可能影响新实例，现按实例隔离；真实Electron连续3次SIGKILL专用Core后，通过并发只读IPC恢复，Runtime ID不变、已提交执行仍succeeded、实际SQLite写入计数始终1。构建与JS语法检查通过。
- 限制：仅验证本机macOS进程恢复与已完成写入；进程崩溃期间的活跃远端写入仍可能结果未知，不能据此宣称回滚或Windows验证通过。

## F116 SQLite 查询进程随 Runtime 退出

- 行为：查询子进程启动独立 watchdog 线程，每100ms检查创建它的 Runtime PID；仅确认父进程不存在时终止自身。检查线程不加载 SQLite，原生同步查询阻塞期间也能清理。正常查询结束主动终止 watchdog。
- 文件：`apps/server/src/sqlite-{process.ts,worker.mjs,parent-watch.mjs}`、`scripts/copy-runtime.mjs`、`tests/sqlite-owner-loss.test.ts`。
- 证据：专用 Runtime 运行长递归 SQLite 查询后 SIGKILL，先复现查询子进程残留，修复后退出；完整真实数据库/TLS/SSH/桌面回归58文件266项通过，构建通过。
- 限制：验证环境为macOS；PID复用极端情形可能延迟检测。终止进程不证明先前写入未提交，崩溃中的写入继续使用结果未知语义，不能自动重放。

## F117 Agent 执行快照打开到共享网格

- 行为：Agent执行记录提供“查看执行结果”，按工具返回的连接/执行ID查找持久执行记录与原快照，恢复准确数据库和SQL并打开现有虚拟结果网格；只发读取请求。连接或记录缺失直接报告，不重跑。
- 文件：`packages/workbench/src/{AgentPanel,Workbench}.tsx`、`scripts/validation/desktop-agent-ui.mjs`。
- 证据：真实Electron Local和loopback Remote经用户确认读取42，点击查看后虚拟表显示42，前后执行记录数量相同；构建通过。
- 限制：结果仍受原有TTL和内存预算；过期快照不恢复数据行。历史上下文中的工具文本目前不提供独立按钮，需打开对应历史任务。

## F118 AI 确认留在对话区域

- 行为：按用户新增原则，AI待确认操作直接显示在聊天滚动区，包含目标、精确SQL、影响、截止时间、确认/拒绝按钮；移除确认Dialog和额外“查看待确认SQL”入口。规则管理继续使用侧边抽屉。原则写入AGENTS.md。
- 文件：`AGENTS.md`、`packages/workbench/src/AgentPanel.tsx`、`workbench.css`、`scripts/validation/desktop-agent-ui.mjs`。
- 证据：真实Electron Local/Remote断言待确认区域可见且Dialog数量为0，确认后执行完成且可查看42；构建通过。拒绝补验Local/Remote均通过：卡片消失、任务取消、执行数不增加。390px真实浏览器无横向溢出，确认后读取42并打开原快照网格。
- 限制：确认不会扩展本轮授权范围，模型不能替代用户按下按钮；真实模型尚未联调。

## F119 Desktop Remote 无请求体操作

- 行为：Remote仅在存在JSON请求体时设置content-type，避免空POST被Fastify拒绝；恢复Agent继续/取消、连接测试和执行取消的传输。未添加写入重试。
- 文件：`apps/desktop/main.mjs`、`tests/desktop-remote.test.ts`。
- 证据：实际Remote UI确认接口200但resume400先复现；真实Electron测试先失败后通过。修复后resume202，Local/Remote完整确认与结果查看均完成；无待确认计划的resume正常403，取消/连接测试正常响应。
- 限制：验证为本机HTTP Remote；不代表跨主机HTTPS及Windows已验证。

## F120 展开 AI 对话

- 行为：聊天标题栏可展开/恢复布局，隐藏数据区而保持同一个Agent组件及任务状态；窄屏同时隐藏导航，为确认卡片和长SQL提供阅读空间。查看执行结果或放入SQL编辑器时恢复数据区。
- 文件：`packages/workbench/src/{Workbench,AgentPanel}.tsx`、`workbench.css`、`packages/ui/src/icons.tsx`。
- 证据：390px浏览器实际展示完整目标/SQL/影响与确认按钮，无Dialog、无页面横向溢出；确认SELECT42后查看原结果网格自动恢复布局，构建通过。截图`output/playwright/agent-inline-approval-mobile.png`。
- 限制：展开状态仅本次页面，刷新恢复默认；不修改授权连接/模式或任务状态。

## F121 Agent 真实网络数据库闭环验收

- 行为/范围：对既有Agent工具链补充真实PostgreSQL与MySQL联合场景，不新增工具或扩大权限。
- 文件：`tests/agent-network.integration.test.ts`。
- 证据：同一任务发现两连接、列数据库、分页找表、单表字段、生成两计划、分别精确确认、读取两原始快照；DECIMAL大数小数与NULL保真、连接/执行来源正确。两引擎分别验证首条写入已提交、第二条失败、第三条跳过，重复提交同请求返回原任务且实际只有1行；3项通过，随机测试表已清理。
- 限制：模型为fixture；数据库为隔离loopback实例，不代表真实模型或业务库验收。

F117–F120打包补验：最新macOS arm64 DBPilot.app/DMG已生成。真实打包应用的Local和loopback Remote通过聊天区确认（Dialog数量0）、拒绝后无新增执行、展开布局、查看42原始网格自动恢复布局，以及聊天/待办/规则抽屉/历史/Markdown复制/所选结果分析。全量回归58文件266项通过；随后新增F121三个网络Agent场景通过。安装包未签名/未公证，Windows仍未验收。

## F122 结果选择与分页响应竞态

- 行为：浏览器分页缓存按执行ID+结果集索引隔离；重复/过时游标不重复追加，迟到的首屏不回退已加载分页。历史/Agent结果打开使用选择序号，旧读取不能覆盖用户的新选择；后台执行更新只更新同一仍活跃执行，不回退终态。切换目标的SQL草稿清除原目标结果。
- 文件：`packages/workbench/src/{Workbench.tsx,result-pages.ts}`、`tests/result-pages.test.ts`、`scripts/validation/result-snapshot-ui.mjs`。
- 证据：真实Chrome+临时HTTP/SQLite，延迟101旧记录的分页或执行状态，切换202后均先复现表格被替换，修复后两场景保留202；分页重复/乱序/首屏迟到2项单测通过，构建通过。
- 限制：读取仍可能在后台完成，但不会渲染到另一执行。此增量不增加SQL重试或改变服务端快照TTL。

## F123 数据库凭据复用绑定目标与传输身份

- 行为：编辑/测试草稿时，空数据库密码仅在主机、端口、用户、TLS配置及SSH身份均不变时沿用；改名和同服务器默认库切换可保留。显式新密码优先，SSH自身密码仍只绑定同一跳板机身份。表单提示同步说明。
- 文件：`packages/storage/src/connections.ts`、`packages/workbench/src/Workbench.tsx`、`tests/storage.test.ts`、`tests/mysql.integration.test.ts`、README。
- 证据：先复现改主机仍返回旧密码，修复后相关9项存储/SSH/AI配置测试通过；真实MySQL验证原目标留空成功、改目标草稿不复用且不修改原配置、保存变更后不再携带原密码，3项通过。
- 限制：不迁移或更换现有已保存凭据；只有后续编辑/测试草稿使用新规则。

## F124 过期所选结果从 AI 输入入口移除

- 行为：所选快照过期/释放返回稳定RESULT_EXPIRED错误码；共享UI只对该错误标记对应执行/结果集不可用并移除分析入口，保留执行证据，不把所有410都误判为结果过期。过期说明明确单独执行只读查询，不建议重跑整段历史SQL。
- 文件：`apps/server/src/app.ts`、`packages/runtime-client/src/errors.ts`、`packages/workbench/src/{AgentPanel,Workbench}.tsx`、`tests/request-errors.test.ts`、`scripts/validation/result-expiry-ui.mjs`。
- 证据：真实Chrome+4秒TTL临时Runtime，先复现410后按钮仍可重复提交，修复后分析入口移除、过期说明可见、模型调用0、SQL执行仍1次；8项相关单测/真实SQLite与构建通过。
- 限制：本地已显示的结果需要下一次服务端读取才能知道TTL到期，不增加后台轮询或重放。

## F125 默认持久化启动与本地旧连接恢复

- 行为：CLI普通启动默认使用安装目录`.data/runtime`并生成一次私有文件密钥；固定非秘密server-profile可选择现有目录/密钥。显式环境配置优先，只有DBPILOT_EPHEMERAL=1使用内存。已有元数据丢失密钥时拒绝替换密钥。Runtime返回storage.persistent，启动日志报告目录而不报告密钥。底层createApp测试接口保持可选内存行为。
- 文件：`apps/server/src/{index,server-storage,app}.ts`、`tests/server-storage.test.ts`、`tests/server-restart.test.ts`、README；本机忽略文件`.data/server-profile.json`。
- 证据：用户报告后检查当前3000为内存、连接/会话0；旧`.data/runtime-3137/metadata.db`仍有3连接28执行且没有AI会话表。先用SQLite一致性backup保存到`.data/backups/runtime-3137-before-persistence-fix.db`（0600），再固定原目录和原密钥路径；当前3000运行标识与旧目录一致，连接3、会话持久化true。未查询目标业务数据库、未调用用户真实模型、未输出密钥或连接正文。
- 验证：4项启动目录/私有密钥复用/环境覆盖/丢失密钥拒绝/显式临时模式测试通过；独立真实CLI进程SIGTERM后重启，SQLite与网络连接、加密AI设置、会话回答、Runtime ID及请求去重保留，模型只调用1次、密钥字节不变、元数据无明文测试凭据；构建通过。
- 限制：旧内存AI会话没有可恢复的落盘记录；查询结果行仍按设计不跨重启保存。文件密钥依靠操作系统文件权限，并非Keychain/KMS；WindowsACL和容器实际启动尚未因此宣称完成。当前仓库的旧工作区恢复配置在Git忽略目录，不能通过克隆仓库获得用户数据。

F125补充：源码开发入口和编译后CLI入口均已实际跨进程重启验证。旧SQLite-only元数据可安全首次生成密钥；存在网络/AI加密凭据但缺原密钥、或元数据不可读取时仍拒绝替换。启动相关单测扩为5项，全量上一轮62文件279项通过（新增SQLite-only兼容随后单独通过）。

## F126 工作区存储状态与构建配置隔离

- 行为：共享工作台顶部显示“持久保存”或“临时存储”，说明连接/AI记录是否跨重启保留；旧Runtime未报告状态时不猜测。Docker构建排除.env系列、npm本机配置及浏览器验证产物，数据目录/数据库文件继续排除。
- 文件：`packages/workbench/src/Workbench.tsx`、`.dockerignore`、`scripts/validation/{desktop-agent-ui,result-expiry-ui}.mjs`。
- 证据：真实Electron Local/Remote均显示持久保存并通过完整AI交互；独立真实Chrome的显式内存Runtime显示临时存储且过期分析不调用模型/重放SQL；构建通过。
- 容器阻碍：本轮实际docker build仍在node:22-bookworm-slim元数据下载失败，配置的镜像源返回EOF；未创建验证容器，不能据此宣称容器启动/重启验收。没有修改用户Docker镜像源或已有数据库容器。


## F127 启动时校验原工作区密钥

- 行为：创建Runtime后、执行/Agent恢复前验证全部已保存连接及AI配置可用原密钥解密；错误密钥拒绝启动，统一错误不输出凭据，释放资源与目录所有权，允许恢复正确密钥后再次打开。环境AI配置不跳过磁盘AI密钥校验。
- 文件：`apps/server/src/app.ts`、`packages/storage/src/ai-settings.ts`、`tests/runtime-secrets.test.ts`、README。
- 证据：两个错误密钥测试先失败，修复后连接/AI记录保留且正确密钥重开通过；相关12项通过，构建通过，完整真实数据库/SSH/TLS/Electron/编译CLI矩阵63文件282项通过。
- 限制：不能恢复已经丢失的主密钥，不自动更换密钥；密钥轮换不在此增量。

## F128 历史抽屉区分读取失败与无记录

- 行为：历史读取错误直接显示在抽屉中，可刷新；请求失败不误报临时存储或空历史，成功后再显示Runtime持久状态。
- 文件：`packages/workbench/src/AgentHistory.tsx`、`scripts/validation/agent-history-ui.mjs`。
- 证据：真实Chrome、临时持久Runtime，拦截一次历史GET为503；错误状态可见且无临时/空历史误提示；手动刷新打开原回答、页面重载仍恢复，模拟模型始终仅调用1次。构建通过。
- 限制：仍只保留最近32轮及有界上下文；不增加历史无限归档或自动写入重试。

F125中断补验：编译CLI在模拟模型等待中SIGKILL，重启后原已完成回答保留、中断任务标失败；以相同请求ID重提只返回原记录，模型调用总数不增加。真实子进程测试通过，未操作用户业务库。

## F129 桌面包排除旧构建产物

- 行为：electron-builder显式只收录dist/server和dist/web，不再递归收录dist内旧DMG、blockmap及Electron.app。打包验收检查必要文件、禁止旧产物和工作区数据。
- 文件：`package.json`、`scripts/validation/desktop-packaged.mjs`。
- 证据：修复前读取实际app.asar确认存在旧DMG与嵌套Electron.app；修复后DMG约155MiB（原约1.1GiB），包内容检查、真实打包应用SQLite查询/重启持久化通过；同一包Local/Remote完整AI聊天、内联确认/拒绝、待办、规则/历史抽屉、Markdown复制、结果分析/原网格及持久标识验收通过。
- 构建：网络重复下载缓慢，本轮使用已安装同版本Electron 44.5.1（`--config.electronDist=node_modules/electron/dist`）完成打包，未改变运行配置。
- 限制：仍为未签名macOS arm64验收包；没有据此声称Windows或正式发布通过。

## F130 Desktop Remote HTTPS 身份校验验收

- 行为/文件：`tests/desktop-https.test.ts`使用独立短期CA、正确IP证书、错误服务器名证书，真实Electron通过原Remote入口切换。
- 证据：未信任CA时拒绝且保留Local；显式信任测试CA后正确证书握手成功；同CA错误服务器名仍被拒绝且保留已连接Remote；错误证书服务器收到的HTTP请求为0。测试通过，未修改系统信任库或放宽TLS。
- 限制：这是loopback HTTPS及Node额外CA验收，不等同跨主机网络、代理、Windows或生产证书部署验收。

## F131 Runtime JSON 请求有界等待

- 行为：Web与Desktop Remote共享请求超时，覆盖响应头及JSON正文，不自动重试。默认35秒，AI测试为70秒以容纳模型60秒上限；Local IPC使用同一预算。超时提示操作可能已完成，要求先核对状态/历史；成功响应JSON损坏显式报告协议错误，不伪装成空数据。
- 文件：`packages/runtime-client/src/json-request.ts`、`packages/workbench/src/Workbench.tsx`、`apps/desktop/main.mjs`、`tests/json-request.test.ts`、`scripts/validation/agent-history-ui.mjs`。
- 证据：4项挂起POST/正文/主动取消/非法JSON/预算测试通过；真实Chrome挂起一次历史读取35秒后显示超时，手动刷新和重载恢复原回答，模型仍只调用1次；真实Electron Local/HTTP及HTTPS Remote/Agent相关8项通过，构建通过。
- 限制：截止请求等待不代表服务器操作被取消；SSE执行流另走自己的读取逻辑。此处没有改变SQL查询预算或增加POST重放。


## F132 SQL 状态中断的只读恢复

- 行为：Web执行事件流35秒有界等待，断流后读取同一个executionId；状态仍不可用时报告“状态读取中断/操作可能已完成”，不误称SQL执行失败。数据面板增加“刷新状态”，只读取状态与原快照；后台轮询失败有捕获，cancel_pending继续跟踪。执行中编辑器快捷键与按钮使用相同提交保护。
- 文件：`packages/workbench/src/Workbench.tsx`、`scripts/validation/execution-recovery-ui.mjs`、README。
- 证据：真实Chrome先复现无中断提示/恢复入口，修复后状态流断开+一次503可只读恢复SELECT；进一步在临时SQLite执行INSERT RETURNING后挂起流35秒、状态GET失败、快捷键尝试、手动刷新，最终原网格1、执行记录1、数据库行数1，没有重放。构建通过。
- 限制：刷新不会重启已停止的数据库操作；POST响应丢失且拿不到executionId时仍需从执行历史核对，不凭超时假定失败。

## F133 迟到的取消响应不覆盖当前执行

- 行为：取消响应绑定原executionId和当前选择序号，只更新同一仍活跃执行；服务器报告已完成且未接受取消时读取原终态，不固定写成cancel_pending。切换历史后忽略旧取消响应和错误。
- 文件：`packages/workbench/src/Workbench.tsx`、`scripts/validation/cancel-race-ui.mjs`。
- 证据：真实Chrome/SQLite先复现取消响应晚到将新选已完成结果改成取消中；修复后切换历史和原执行已完成两种场景均保留成功状态与正确101/202网格，执行数仍2，构建通过。
- 收尾：F130–F132全量65文件288项通过；新增只读状态恢复在390px无横向溢出，最新上一版安装包Local/Remote AI完整界面验收通过。用户要求当前任务结束后停止，F133完成后不再开展新任务。

最终收尾（用户要求停止）：F133已同步到macOS arm64 DMG/应用，最后打包应用的包内容隔离、SQLite查询、重启持久化及界面布局冒烟通过。已停止本任务3139/3140临时Agent/SSH UI服务并清理专用TLS数据库夹具；用户3000服务、恢复的工作区/备份及原有数据库保留。持续推进目标已暂停，不再开启新工作；真实模型、Windows、跨主机生产网络与正式签名仍未宣称验收。

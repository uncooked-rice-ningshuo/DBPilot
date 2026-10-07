# DBPilot

DBPilot 是按 `docs/` 架构文档开发的个人数据库工作区。当前提供三栏 Web 工作台、单实例 Fastify API、SQLite/PostgreSQL/MySQL 连接、手动 SQL 一键执行、数据网格、执行记录和 AI 辅助入口。功能进度与限制见 `PROJECT_STATE.md`，开发约束见 `AGENTS.md`。UI 使用 React、Tailwind CSS、shadcn/ui、Monaco 和 TanStack Table/Virtual，基础组件位于 `packages/ui`，共享工作台位于 `packages/workbench`。

## 启动

需要 Node.js 22 和 pnpm 10。

```bash
pnpm install
pnpm dev:server
```

另开终端：

```bash
pnpm dev:web
```

浏览器打开 Vite 输出的地址。服务端默认只监听 `127.0.0.1:3000`。普通启动默认将连接、AI设置、会话、规则和执行记录持久保存到安装目录的 `.data/runtime`，并首次生成 `.data/runtime/secrets/master.key`（目录0700、文件0600，后续复用）。SQLite文件路径仍指服务端上已存在的目标数据库文件。查询结果行是有期限的内存快照，重启后不会恢复；不会自动重跑SQL。

可以通过 `DBPILOT_DATA_DIR` 指定固定数据目录；`DBPILOT_MASTER_KEY` 或 `DBPILOT_MASTER_KEY_FILE` 指定已有32字节base64主密钥，二者不能同时设置。已有加密元数据缺少原密钥或密钥无法解密已有记录时启动失败，不会生成替代密钥或清空工作区。备份必须保留元数据和原密钥，密钥不得提交Git或输出日志。自托管文件密钥目前不是系统Keychain/KMS；不要把此版本直接暴露公网。

本项目的 `.data/server-profile.json` 可固定目录与密钥文件路径，路径相对于 `.data`，文件本身不含密钥。环境变量优先。例如恢复现有工作区可配置：

```json
{"dataDir":"runtime-3137","masterKeyFile":"secrets/master.key"}
```

只有显式设置 `DBPILOT_EPHEMERAL=1` 才使用临时内存模式（不能与持久化环境变量混用）。底层 `createApp()` 测试/嵌入接口仍可显式不传dataDir使用内存。启动日志会报告实际目录和是否持久化，不输出密钥。

单端口本机运行：先执行 `pnpm build`，再以 `DBPILOT_SERVE_WEB=1 pnpm start:server` 启动，打开 `http://127.0.0.1:3000`。Docker Compose 可使用 `docker compose up --build`；Compose 默认只把端口映射到宿主机 `127.0.0.1`，连接元数据存入命名卷。空卷首次启动会生成并复用卷内私有密钥；也可显式提供原 `DBPILOT_MASTER_KEY` 或密钥文件。自定义反向代理域名需加入逗号分隔的 `DBPILOT_PUBLIC_HOSTS`，默认仅允许 `localhost` 和 `127.0.0.1`。若 HTTPS 在反向代理终止，还需将公开页面的精确来源（例如 `https://db.example.com`）加入 `DBPILOT_ALLOWED_ORIGINS`。Web API 的写入请求会校验 `Origin` 和浏览器的 `Sec-Fetch-Site`，跨站来源被拒绝。`pnpm dev:server` 仅在开发命令中额外允许本机 Vite 5173 端口。无来源头的非浏览器/桌面 IPC 调用继续由各自的来源边界处理。

工作区 Agent 和结果分析可在“AI 设置”中选择供应商、模型并填写 API Key；也兼容 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL` 和可选的 `DEEPSEEK_BASE_URL`。Agent 可在未打开表时发现授权连接并检索 Schema，支持同一 Runtime 内多个连接。建议模式只生成计划；执行模式展示精确 SQL、目标和影响，由用户确认后执行。每次发送为独立任务，工作区同时只允许一个活动任务；取消保留已完成步骤和执行 ID，写入结果可能未知。模型工具没有审批、改权限、任意 HTTP 或 shell 能力。结果工具最多发送 50 行，原独立结果分析最多 100 行，均携带截断标记。当前只完成模拟模型配合真实数据库的验证，尚未用真实 DeepSeek 账号联调。

Agent 当前上限为 5 分钟、12 轮模型请求、32 次工具调用及 80,000 字符消息上下文。最近32轮任务和有界对话保存到当前Runtime元数据库（未配置dataDir时仅内存）；聊天顶部可新建或打开历史。重启后未完成任务标为中断，不恢复执行或沿用旧审批。独立请求去重账本防止已淘汰任务被重复提交重放，上限100,000条。模型支持流式回答；工具参数完整校验前不执行。Agent可通过request_connection准备非秘密连接草稿，用户在共享表单核对/补充凭据并保存，随后开始新对话授权；自动连接创建/修改和长期会话租约尚未实现。

桌面端开发启动使用 `pnpm desktop`。本地模式在 Electron Utility Process 中运行 Core，并通过具名 IPC 操作调用；Remote 模式在界面中填写 HTTPS Runtime 地址。macOS arm64 开发态与未签名应用包已通过真实 SQLite 查询、重启恢复和 loopback HTTP Remote 验证；Windows、签名/公证、跨主机 HTTPS 尚未验收。
远端目标保存前会检查 `/api/v1/runtime` 的协议版本和 Runtime ID；切换目标会重载界面，清空旧结果与事件订阅。普通启动的 Runtime ID 跨重启保持稳定。

## 结果值表示

SQLite 安全整数范围内返回数字，超范围的 64 位整数返回十进制字符串；PostgreSQL BIGINT/NUMERIC 使用驱动的精确字符串表示，MySQL 超安全范围整数及 DECIMAL 保留字符串。PostgreSQL DATE/TIMESTAMP/TIMESTAMPTZ 与 MySQL 日期时间保留数据库会话文本及小数秒，不再经 JavaScript Date 按 Runtime 本机时区转换。无时区值不会被附加时区。结果列按位置存储，重复列名不会覆盖，NULL 保留为空值。复杂数组、自定义类型及完整时区矩阵仍待扩展验证。

## 当前执行语义

- Runtime 默认最多同时运行 4 个执行计划，`DBPILOT_MAX_CONCURRENT_EXECUTIONS` 可设为 1–32。超额返回 429，不领取或消费新计划；正在运行的查询结束或取消后可再次提交。重复提交同一个已领取计划始终返回原执行，不占新名额，也不重放 SQL。

- 执行计划共用默认 30 秒时间预算，可用 `DBPILOT_QUERY_TIMEOUT_MS` 下调到 1–30000 毫秒；包含建连及多步骤执行。预算到期请求数据库取消，读取标记取消，写入或事务无法证明最终结果时标记未知，不重放；取消完成可能受网络与驱动响应影响。SQLite 目标 SQL 在独立工作进程运行，取消等待进程退出，避免原生模块线程终止影响 Runtime。macOS arm64 桌面端该路径已通过真实查询验收。

- 手动 SQL 控制台点击“执行 SQL”或按 Ctrl/Cmd+Enter 后直接运行已支持的语句，无第二次确认；内部仍生成不可变计划并按步骤记录结果。AI 自主发起的计划继续要求授权。
- 设置 `DBPILOT_DATA_DIR` 时，计划、审批决定与执行状态写入元数据 SQLite。执行提交原子领取计划并写入执行意图；用同一计划重复提交会返回原 `executionId`。
- SELECT 仅支持保守函数/表达式子集，未知函数、可执行或嵌套注释、歧义转义拒绝。DML 支持 INSERT/UPDATE/DELETE，DDL 限于 CREATE TABLE/INDEX、ALTER TABLE、DROP TABLE/INDEX；用户/角色/数据库/扩展管理及 CREATE-AS 查询不支持。未知语句、WITH、EXPLAIN 和过程体拒绝。审批与首次执行重新校验当前策略及连接版本。
- 一次计划可包含多条语句，按顺序执行；任何一步失败即停止，之前成功的写入不会回滚。
- SQLite、PostgreSQL 和 MySQL 可使用受限语法的完整 `BEGIN; ...; COMMIT` 或 `BEGIN; ...; ROLLBACK` 块；各步骤固定一个物理连接，失败时尝试回滚，界面标记已回滚步骤。MySQL 块内 DDL 会在预检时拒绝。
- 执行快照按计划顺序显示每一步状态。后续未启动步骤标为 `skipped`；进程中断时正在执行的步骤标为 `outcome_unknown`，不会自动重放写入。
- 设置 `DBPILOT_DATA_DIR` 后，计划、审批、执行意图与结束、取消请求写入审计表；普通审计只存 SQL 哈希。审计意图不可写时拒绝发起数据库执行。
- 持久化模式下，领取计划、写入执行状态意图和审计意图在同一个元数据库事务内完成；目标数据库提交与元数据库仍不能组成原子事务。
- 连接变更与模型请求出站也记入审计；审计不可写时不发送模型请求。连接元数据与审计写入目前不在同一事务中。
- 执行记录按连接展示最近 50 次 SQL 和状态，普通启动可跨重启查看；结果行仍只在有期限的内存快照中。逐步骤命令日志由持久执行记录重建；页面内提交错误只保留在当前会话。
- 结果快照最多展示 10,000 行，返回 `truncated` 标记。
- PostgreSQL/MySQL 普通读取逐行收集，超限后通过原生取消提前停止，保留带截断标记的同次执行快照。显式事务内读取仍排空查询流，以保留事务语义；写入返回结果仍由驱动缓冲。PostgreSQL 16.13 和 MySQL 8.0 已验证超限后的慢尾部被提前终止且后续步骤可执行。
- 结果快照默认保留 10 分钟，并共用 200 MiB 的结果数据预算（可通过 `DBPILOT_RESULT_CACHE_BYTES` 调整）。达到预算时先释放旧快照；分页返回 `RESULT_EXPIRED`，工作台会明确不会自动重跑，SQL历史和执行状态仍保留；需要新数据时单独执行只读查询。

## 仍需实现

这不是架构文档中 A–C 阶段的完整交付。macOS Local/loopback Remote和开发包已有实际验证，PG/MySQL私有CA与服务器名TLS已验证；SSH私钥认证、Windows、跨主机HTTPS、系统Secret Store、可靠SQL方言解析、真实模型联调、完整审计边界和正式签名打包仍待完成。当前 SQL 分类是保守子集，不能证明视图、运算符或数据库自定义重载没有副作用，仍需数据库最小权限。服务端主密钥使用私有文件或部署者显式配置，尚未接入系统密钥存储。

运行 `pnpm test` 和 `pnpm build` 验证当前代码。
本机 PostgreSQL 集成测试可在临时实例监听 `127.0.0.1:55433` 且当前系统用户可连接时运行 `DBPILOT_TEST_POSTGRES=1 pnpm test`；MySQL 8.0 集成测试可在临时实例监听 `127.0.0.1:55434` 且账号与测试配置匹配时运行 `DBPILOT_TEST_MYSQL=1 pnpm test`。两套测试分别覆盖查询截断、DML、读写取消和显式事务。

### SQL 命令规则（限定范围）

Web Server 可通过 `DBPILOT_COMMAND_RULES_FILE=/absolute/path/rules.json` 加载用户维护的 JSON 数组；启动时校验，修改后重启生效。示例：

```json
[
  { "connectionId": "00000000-0000-4000-8000-000000000001", "kind": "read", "decision": "allow", "exactSql": "SELECT 42" },
  { "connectionId": "00000000-0000-4000-8000-000000000001", "kind": "schema", "decision": "deny" }
]
```

使用实际连接 ID。`kind` 支持 `read/write/schema/transaction`；`deny > ask > allow`，规则同时约束人工和 AI。自动规则必须同时指定连接、类型和精确单条 SQL（按拆分后去掉首尾空白的语句匹配，不含末尾分号），不支持正则、前缀或表名通配。未匹配的 AI SQL 默认 ask；人工点击执行仍直接运行支持且未被 deny 的语句。未知 SQL 和不支持的事务不能由规则放行。混合计划中有 ask 时，整组执行前确认一次。

规则摘要绑定到持久化计划；规则变化后旧的未执行计划必须重新生成，已有执行的重复请求只返回原执行 ID。规则文件不进入模型，没有模型可调用的策略修改工具。共享工作台已经提供规则抽屉与即时保存；Desktop Local和Remote使用同一策略路径。

### 工作台命令规则

顶部“命令规则”可新增、修改、删除连接级 allow/ask/deny 规则，保存后立即生效。自动执行要求精确 SQL；拒绝优先于确认，确认优先于允许，不支持的 SQL 始终拒绝。规则面向整个当前 Runtime，不随左侧选中的连接变化。

有 `DBPILOT_DATA_DIR` 时规则和递增版本保存在元数据库；无数据目录时界面明确提示仅本次运行。保存请求携带读取版本，其他窗口已保存时返回冲突，保留草稿供核对；“重新加载”会用服务端版本替换草稿。规则和审计摘要同事务保存，审计不写明文 SQL。规则保存使未执行旧计划失效，已开始任务继续，重复提交已消费计划仍返回原执行标识。

`DBPILOT_COMMAND_RULES_FILE` 的显式配置优先（空数组也算配置），此时界面只读。文件修改须重启生效；不会覆盖元数据库中的规则，移除该环境变量并重启后恢复工作区设置。Desktop Local 使用相同持久化 API，经 `policy.get` / `policy.update` 具名 IPC；Remote 操作目标服务器的设置。模型工具不提供规则修改操作。macOS Local和loopback Remote已完成规则抽屉实际窗口验收。

### Agent 连续对话

同一对话的追问携带前一轮 Run ID，历史由 Runtime 提供，客户端不能上传 system/tool 历史。对话固定模式和授权连接集合；点击“新对话”后可以调整。每轮创建独立工具状态，旧计划、审批和执行句柄不继承；历史仅作参考，必要的新操作仍需生成新计划并按当前策略审批。

最近历史最多 6 轮、24,000 字符，单轮长问题/回答/工具记录另有截断并在界面提示。普通启动时刷新和重启均从本Runtime元数据库恢复；最多32个Run被淘汰的较早记录不再提供。显式临时模式重启会丢失记录。未完成任务重启后标为中断，不会自动重发问题或重放写入。失败和未知结果会进入历史，后续模型仍须报告并核对已有操作。当前验证使用模拟模型和真实SQLite/PostgreSQL/MySQL，真实DeepSeek对话质量仍待验收；流式协议和实际HTTP分块已验证。

### 工作台布局与 AI 设置

左侧数据库树、工作区、AI 消息区在固定视口内分别滚动。连接行右侧的插头图标用于测试，设置图标用于编辑该连接；顶部不再放连接级操作。工作区与 AI 面板之间的分隔条可拖动，支持方向键、Shift+方向键、Home/End，双击恢复默认，宽度会保存在本机。窄屏改为上下排列。

点击 AI 面板标题栏“AI 设置”，选择 DeepSeek 或自定义 OpenAI 兼容接口，填写地址、模型和 API Key。“获取模型 / 测试连接”会请求目标供应商的 models 接口；也可手动输入模型 ID。保存后无需重启，新 AI 请求立即使用配置。

普通服务端启动使用持久化目录和自动生成一次的私有主密钥，加密保存AI配置；也可显式配置 DBPILOT_MASTER_KEY_FILE（或既有 DBPILOT_MASTER_KEY）。底层嵌入接口没有主密钥时不会明文落盘，无数据目录时只保留在内存。环境变量显式提供的 AI 配置优先并只读，需移除后重启才能改由界面维护。更换供应商/地址必须重新输入 API Key，留空仅在地址不变时保留原密钥。已保存密钥不回显，模型没有修改配置的工具。

详见 [本次设计与验收记录](docs/plans/2026-10-07-workbench-layout-ai-settings.md)。真实供应商工具调用能力需单独联调，本次表单验收使用模拟端点。

### 桌面原生依赖

`pnpm desktop` 自动在隔离目录准备 Electron 的 SQLite 模块，不覆盖 Node 服务使用的模块。也可单独运行 `pnpm desktop:native`；首次运行需要系统 C++ 工具链及网络下载 Electron 头文件。macOS arm64 和 Windows x64 安装包须在对应平台构建。实现、验收及限制见 [桌面原生依赖隔离](docs/plans/2026-10-07-desktop-native-isolation.md)。

桌面可在启动时设置绝对路径 `DBPILOT_DESKTOP_DATA_DIR` 来使用独立配置目录；默认仍使用系统应用数据目录。该选项只能通过主进程启动环境设置，UI/Agent 无法修改。可用 `scripts/validation/desktop-packaged.mjs <可执行文件路径>` 验证打包应用的临时配置目录、SQLite 查询和重启持久化；此脚本需要 Playwright（可用 `DBPILOT_PLAYWRIGHT_MODULE` 指定本地模块路径）。开发验收包未签名、未公证，不代表正式发布验收完成。

### Iconify 图标

Web 与桌面共用 `packages/ui/src/icons.tsx`：Iconify React 离线组件配合 Lucide 图标数据，逐个导入，不请求 CDN 或 Iconify API。连接、表、SQL、AI、设置、排序、加载提示及基础组件保持一致的线性图标与尺寸。新增图标和上游来源说明见 [共享 UI 文档](packages/ui/README.md)。

## 连接导航与数据库选择

PostgreSQL/MySQL 的“默认数据库”可留空：保存服务器连接后展开左侧根节点，再选择账号可访问的数据库。PostgreSQL 无默认库时用 `postgres` 作为发现入口；若账号不能连接它，请填写一个有权连接的默认库。SQLite 使用文件连接，对应 `main`。

连接、数据库和 Schema/表分组均可独立收起；顶部提供展开全部、收起全部，以及跨已保存连接的名称搜索。首次搜索会读取各连接的数据库和表结构（最多三个数据库请求并发），不读取表中数据。每条连接旁提供测试、设置和删除；删除确认只清除该条连接配置，不删除数据库文件、表或数据。

选择的数据库会固化到 SQL 计划与执行历史中，执行请求不能临时换库。服务器连接未选择数据库时不能执行 SQL；AI 通过 `list_databases` 发现目标，再向 Schema/计划工具传递 `database`。HTTP 与 Desktop IPC 使用同一路径。

表目录按每页 200 项连续读取，点击表时才加载该表字段，避免字段总量限制截掉靠后的表；读取失败会提示搜索可能不完整。旧的全库 Schema 接口仍有有界字段读取；Agent通过分页表名检索和单表字段工具按需读取，并携带游标或截断标记。搜索索引在当前页面内缓存，外部 DDL 后需刷新页面重新加载。详见 [连接导航说明](docs/plans/2026-10-07-connection-navigation.md)。

## 操作通知与控件

连接测试、AI服务测试及SQL错误等反馈统一显示在右下角固定通知层，打开弹窗时仍可见；不会撑高工作区或表单。可手动关闭，悬停暂停消失；输入格式错误仍在表单内显示。数据/结构标签仅使用下划线选中态，AI模式和连接范围使用紧凑选择器。详细交互和验收见 [全局通知说明](docs/plans/2026-10-07-global-notifications.md)。


## Agent 工具、恢复与模型检测

先提供固有数据库工具、`update_todo`待办和`command_reference`固定Linux命令参考。ls/pwd/head/tail/grep/wc仅返回说明，不执行Shell、不读取文件。待办不是数据库执行证据。Skill与MCP尚未接入。命令规则在右侧抽屉查看和编辑，模型不能自行修改。聊天支持左右气泡、Markdown代码复制和展开布局；“查看执行结果”打开原始快照网格，结果过期不会重跑SQL。

“获取模型列表”只检测模型目录；“测试模型与工具”向所选模型发送固定测试内容并核验工具调用，既不访问数据库，也不保存配置。认证/限流/协议错误有独立提示。模型单次请求60秒，Agent总时限5分钟；确认卡片在对话区域显示精确目标、SQL、影响和截止时间，不弹出确认窗口。状态读取失败自动有界退避，重连只读取状态，不重发数据库操作。

对话与有界结果证据可能含业务数据，保存在当前Runtime的metadata.db中，受数据目录权限保护；配置密钥仍走独立加密存储。最近32轮不是无限聊天存档。结果快照默认10分钟；过期后执行状态保留，无dataDir时最多保留10,000条内存状态，Runtime重启仍会丢失这些临时记录。

## 数据库 TLS

勾选TLS后始终验证CA与服务器身份。可粘贴公开的私有CA PEM证书（不含私钥），留空使用系统信任库。证书服务器名可与实际TCP地址分开：例如连接IP，但证书签发给`db.example.com`。MySQL通过IP连接时必须填写证书DNS名称；仅有IP SAN、无DNS名称的MySQL证书目前保守拒绝。测试、目录、查询、事务及取消路径共用TLS配置，没有关闭证书验证的开关。

隔离TLS验收：`node scripts/validation/tls-fixture.mjs`创建临时PG/MySQL与短期证书，使用loopback55435/55436；`DBPILOT_TEST_TLS=1 pnpm exec vitest run tests/tls.integration.test.ts`运行正反例；结束后用`node scripts/validation/tls-fixture.mjs stop`清理该脚本创建的资源。此脚本当前依赖macOS Homebrew PostgreSQL16与本机mysql:8.0 Docker镜像。


网络连接可选单跳SSH密码认证：填写跳板机地址、用户名及从可信渠道核对的SHA256主机指纹。数据库地址由跳板机访问；TLS服务器名仍填写数据库证书身份。指纹变化将拒绝连接，程序不会自动接受或重放写入。SSH密码加密保存，编辑留空仅保留同一跳板机身份的密码。当前不支持私钥、代理或多跳。

同一数据目录一次只运行一个 Runtime。新版本通过事务记录进程所有权，活跃实例存在时拒绝重复启动；同机进程崩溃退出后可恢复。升级时先关闭旧版本 Runtime（旧版本不识别所有权表）。不支持多个主机共享同一数据目录。

编辑网络连接时，数据库密码留空仅在主机、端口、账号、TLS和SSH身份均未改变时保留。更换这些信息后需重新填写密码；仅改名或切换同一服务器的默认数据库可继续使用已保存密码。测试草稿与保存遵循同一规则。


连接中断时，数据面板的“刷新状态”只读取原执行及快照，不重新执行SQL。Web/Remote普通JSON请求最多等待35秒，AI工具调用测试最多70秒；等待超时不代表数据库操作失败或被取消，先核对原执行历史。SQL事件流中断会退回读取原状态，仍不可用时显示中断提示；查询进行中时按钮和编辑器快捷键都不再提交第二次执行。

<div align="center">

# DBPilot

**把数据库浏览、SQL 查询与 AI 协作放进同一个工作区。**

面向个人开发者的数据库工作台 · SQLite / PostgreSQL / MySQL · Web / Desktop

[快速开始](#快速开始) · [AI 协作](#ai-协作) · [使用指南](docs/usage.md) · [开发指南](#参与开发) · [项目状态](PROJECT_STATE.md)

</div>

---

DBPilot 将连接导航、SQL 编辑器、结果网格和 AI 对话整合在一个界面中。你可以自行编写并执行 SQL，也可以让 AI 检索表结构、生成查询、分析结果，并在命令策略允许的范围内协助执行任务。

项目面向个人单用户使用，无需注册或登录。Web 与桌面端共用工作台，人工操作与 AI 操作共用数据库执行和策略入口。

> **开发预览版**：当前版本为 `0.1.0-dev`，首版尚未完成全部验收。Web 已有数据库基础闭环，macOS arm64 已完成部分桌面实测；真实模型、Windows、跨主机生产网络与正式签名发布仍待验证。具体证据与限制以 [PROJECT_STATE.md](PROJECT_STATE.md) 为准。

## 核心能力

| 能力 | 你可以做什么 |
| --- | --- |
| **数据库导航** | 管理 SQLite、PostgreSQL、MySQL 连接，选择数据库，搜索表名，查看字段结构。 |
| **SQL 工作区** | 使用 Monaco 编辑 SQL，通过按钮或 `Ctrl/Cmd + Enter` 执行，查看逐步骤状态和执行历史。 |
| **结果浏览** | 在虚拟化网格中查看同一次执行的结果快照，最多展示 10,000 行，并明确提示截断与过期。 |
| **工作区 AI** | 在授权连接范围内发现数据库、检索 Schema、生成 SQL、分析结果，支持连续对话与流式回答。 |
| **命令策略** | 在规则抽屉中配置 `allow / ask / deny`；需要确认的 AI 操作在对话中展示目标、SQL 和影响。 |
| **连接保护** | 网络数据库支持 CA 与服务器身份校验，以及固定主机指纹的单跳 SSH 密码认证。 |
| **工作区恢复** | 普通启动持久保存连接、AI 设置、对话、规则和执行记录；中断任务不会自动恢复执行。 |

## 快速开始

### 1. 准备环境

- Node.js **22**
- pnpm **10**（仓库固定为 `10.26.0`）
- 一个可访问的 SQLite 文件，或 PostgreSQL / MySQL 数据库

在仓库根目录安装依赖：

```bash
pnpm install
```

### 2. 启动 Web 工作台

在第一个终端启动 Runtime（负责连接、策略和查询执行的服务）：

```bash
pnpm dev:server
```

在第二个终端启动前端：

```bash
pnpm dev:web
```

打开 Vite 输出的地址，通常为 `http://localhost:5173`。Runtime 默认监听 `127.0.0.1:3000`。

### 3. 执行第一条查询

1. 在工作台中新增连接，选择数据库类型并填写连接信息。
2. SQLite 填写 **Runtime 所在机器上已存在的数据库文件路径**；PostgreSQL / MySQL 可先保存服务器连接，再在导航树中选择数据库。
3. 在 SQL 编辑器输入以下语句，点击“执行 SQL”或按 `Ctrl/Cmd + Enter`：

```sql
SELECT 42 AS answer;
```

结果网格将显示 `answer` 列。手动执行支持的 SQL 无需二次确认；命令拒绝规则仍然生效。

**无需配置 AI 即可使用数据库浏览和 SQL 查询。**

## AI 协作

在 AI 面板中打开“AI 设置”，选择 DeepSeek 或自定义 OpenAI 兼容接口，填写地址、模型与 API Key 并保存。配置对后续请求立即生效。

- **建议模式**：检索所需结构并生成建议或计划，供你核对。
- **执行模式**：按当前命令规则运行任务；`ask` 操作必须在对话内确认，明确匹配 `allow` 的操作可自动执行，`deny` 操作拒绝执行。

可以从这些任务开始：

> “列出这个数据库里的表，说明各表的用途。”
>
> “根据订单表结构，生成按月统计订单金额的 SQL。”
>
> “分析我选中的查询结果，并指出结论受到哪些数据限制。”

每个 Runtime 同时只允许一个活动 Agent 任务。对话可以使用同一 Runtime 中多个已授权连接；模型不能自行扩大权限、修改命令规则或代替用户确认。

“获取模型列表”只检查模型目录；“测试模型与工具”用于检查所选模型的工具调用能力。兼容接口不代表模型行为已经验收，当前集成证据主要来自模拟模型配合真实数据库。

**数据边界**：使用 AI 时，相关 Schema、问题和有界结果可能发送给你配置的模型服务；对话及有界结果证据也可能保存到本地元数据库。配置密钥不进入模型上下文、不回显。

## 运行方式

| 模式 | 工作方式 | 当前验证范围 |
| --- | --- | --- |
| **Web** | 浏览器连接独立 Runtime，可使用开发服务或单端口部署。 | 已有真实数据库与浏览器验证；Docker 镜像运行尚未完成验收。 |
| **Desktop Local** | Electron 内运行本地 Runtime，通过具名 IPC 调用。 | macOS arm64 开发态与未签名应用包已有查询、重启恢复验证。 |
| **Desktop Remote** | 桌面工作台连接指定 Runtime，切换前校验协议与身份。 | 已有 loopback 联调与限定 HTTPS 身份校验；跨主机生产部署待验收。 |

### 单端口 Web

```bash
pnpm build
DBPILOT_SERVE_WEB=1 pnpm start:server
```

打开 `http://127.0.0.1:3000`。上述环境变量写法适用于 macOS / Linux shell；PowerShell 请先设置 `$env:DBPILOT_SERVE_WEB="1"`，再运行 `pnpm start:server`。

### 桌面开发

```bash
pnpm desktop
```

命令会构建前端与服务端，并在隔离目录准备 Electron 的 SQLite 原生依赖。首次运行需要系统 C++ 工具链和网络访问。详细要求见 [桌面原生依赖说明](docs/plans/2026-10-07-desktop-native-isolation.md)。Windows 和正式签名安装包仍待验收。

Docker Compose、反向代理和远端配置见 [使用与配置指南](docs/usage.md)。当前无账号与多用户访问控制，请在本机或受控网络中使用。

## 存储与执行约定

- **默认持久化**：普通服务端启动使用 `.data/runtime`，首次生成私有主密钥。可通过 `DBPILOT_DATA_DIR` 指定数据目录；同一目录一次只允许一个 Runtime 使用。
- **备份需要原密钥**：恢复工作区必须同时保留元数据和原主密钥。已有加密记录缺少原密钥或解密失败时，启动会被拒绝。服务端文件密钥尚未接入系统 Keychain / KMS。
- **结果有期限**：查询结果是内存快照，默认保留 10 分钟，重启后失效；执行记录保留不代表结果行永久保存。结果过期不会自动重跑 SQL。
- **失败不等于回滚**：多语句按顺序运行，失败后停止；显式事务之外，之前成功的写入不会自动回滚。取消、断连或进程中断可能产生“结果未知”，应先核对原执行记录。
- **写入不自动重放**：刷新状态和重连读取原执行状态，不重新执行 SQL。
- **SQL 范围有限**：当前仅支持保守的 SQL 子集，包括读取、常见 DML、部分 DDL 和完整显式事务块；未知语法拒绝执行，`WITH`、`EXPLAIN` 和过程体等尚不支持。

完整的规则匹配、事务限制、数值精度、TLS / SSH 和资源预算说明见 [使用指南](docs/usage.md)。

## 参与开发

### 技术栈与目录

前端使用 **React + TypeScript + Vite + shadcn/ui + Tailwind CSS**，SQL 编辑器使用 **Monaco**，结果网格使用 **TanStack Table / Virtual**；Runtime 使用 **Fastify**，桌面容器使用 **Electron**。

```text
apps/
  web/               Web 入口
  server/            Runtime API 与数据库执行
  desktop/           Electron 主进程、Preload 与 Utility Process
packages/
  ui/                共享基础组件与主题
  workbench/         连接导航、SQL 工作区与 AI 面板
  protocol/          共享 DTO 与运行时校验
  runtime-client/    HTTP / IPC 客户端
  core/              SQL 分类、命令策略与执行基础
  ai-core/           模型接入与 Agent 工具编排
  storage/           元数据、设置与执行记录
scripts/validation/  集成与界面验收脚本
tests/               单元与集成测试
docs/                架构、使用指南与专项设计记录
```

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev:server` | 启动 Runtime 开发服务 |
| `pnpm dev:web` | 启动 Web 开发服务 |
| `pnpm test` | 运行测试；需要真实外部服务的用例须另行启用 |
| `pnpm build` | 类型检查并构建 Web 与服务端 |
| `pnpm desktop` | 构建并启动 Electron |
| `pnpm pack:mac` | 构建 macOS arm64 DMG |
| `pnpm pack:win` | 构建 Windows x64 安装包，须在对应平台验证 |

真实 PostgreSQL / MySQL / TLS 测试需要专用实例，准备要求见 [使用指南](docs/usage.md)。请勿使用业务数据库运行测试写入。

开发前阅读 [开发约束](AGENTS.md) 与 [总体技术架构](docs/AI数据库管理工具总体技术架构设计.md)。新增功能时同步更新 `PROJECT_STATE.md`，记录行为、文件、验证证据与限制；编译通过或 mock 测试通过不能替代真实数据库、桌面或模型验收。

## 文档与后续方向

| 文档 | 内容 |
| --- | --- |
| [使用与配置指南](docs/usage.md) | 持久化、环境配置、命令规则、执行语义及连接设置 |
| [项目状态](PROJECT_STATE.md) | 实际完成情况、验证证据和已知限制的唯一进度记录 |
| [总体技术架构](docs/AI数据库管理工具总体技术架构设计.md) | 产品范围、模块边界、交付阶段与验收要求 |
| [共享 UI 说明](packages/ui/README.md) | shadcn/ui 来源、组件约定与图标说明 |

首版聚焦技术验证、数据库基础闭环与 AI MVP。接下来需要补齐真实模型联调、Windows 与跨主机部署验收、完整安全边界及正式发布链路。MongoDB、MCP、Notebook 等属于后续扩展范围。

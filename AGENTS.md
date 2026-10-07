# DBPilot 开发约束

本文件适用于整个仓库。产品范围与技术要求以 `docs/AI数据库管理工具总体技术架构设计.md` 为准；此处只摘录开发中必须持续执行的规则。每次实现新功能，更新 `PROJECT_STATE.md` 的功能、涉及文件、验证与限制，不把设计或编译成功记为已交付。

## 首版范围

- 首版为架构文档 §11 的 A–C 阶段：技术验证、数据库基础闭环、AI MVP。D/E 阶段（MongoDB、其他模型、MCP、Notebook 等）不作为首版门槛。
- 个人单用户、无注册/登录/RBAC；Web、Desktop Local、Desktop Remote 三种模式；首发 SQLite、PostgreSQL、MySQL；桌面首发 macOS 和 Windows。
- 人工与 AI 的数据库操作共用命令策略和执行入口。手动 SQL 控制台由用户点击“执行 SQL”或按快捷键后直接运行，不再增加执行前确认页；不支持的命令仍拒绝。AI 自主发起的 ask 命令必须展示精确 SQL、目标与影响，由可信 UI 确认。失败必须报告部分完成，写入不能自动重放。
- Agent 是工作区级、单 Agent、受控工具驱动；支持建议与执行模式、连接发现/建立、Schema 检索、跨同一 Runtime 内多个授权连接的任务、SQL 生成/修改、结果分析。模型不能修改权限或伪造用户确认。

## UI 实现规则（架构文档 §2.3–§2.4、§13 D02）

- AI 对话中的用户确认放在对话区域内，展示精确目标、内容与影响及确认/拒绝操作，不新增确认弹窗。命令规则等设置使用抽屉查看与编辑。

- 使用 **React + TypeScript + Vite + shadcn/ui + Tailwind CSS**。必须实际安装并使用 shadcn/ui 组件构建按钮、表单、对话框、标签页、面板等通用界面；仅仿造视觉样式不算完成。
- 共享基础组件与主题在 `packages/ui`，连接导航、SQL 工作区和工作区级 AI 面板组合在 `packages/workbench`。Web 和 Electron Renderer 共用这些组件，不在页面入口复制两套实现。记录 shadcn 上游来源、版本与本地改动。
- SQL 编辑器使用 Monaco，验证 Worker、键盘和主题；结果网格使用 TanStack Table/Virtual，不能以普通 table 或仅后端分页代替行虚拟化。10,000 行有界单元格需要实际测试流畅度。
- 主题、键盘操作和焦点管理在 Web、Desktop Local、Desktop Remote 验收。具体三栏布局是当前实现选择，不是架构文档的强制布局。

## Runtime、连接与数据

- HTTP 与 IPC 使用共享 DTO、运行时校验及版本协商；所有人工、AI、未来 MCP 执行均经过相同 Application/Policy/Query 路径，不能让 UI 或模型直连裸 Driver。
- PostgreSQL、MySQL、SQLite 的事务、取消、超时、精度、时区、NULL、重复列名和截断要用真实目标数据库验证。未知 SQL 方言和风险类别保守拒绝。
- 结果按同一次执行快照分页，有行数、字节、TTL、总缓存与查询时间预算；不能通过向原 SQL 追加 LIMIT 或重跑 OFFSET 实现分页。
- TLS 验证 CA 和服务器名；SSH 校验并固定主机指纹；连接/重连不重放写入。配置凭据走 Secret Store，不回显、不进 Prompt、日志或普通消息历史。
- 服务器默认 loopback；保留同源/Origin 与跨站请求防护、桌面 IPC 来源校验。无账号不等于无执行来源边界。

## 验证与状态文档

- 按架构文档 §12.1 的场景验证 Web、Desktop Local、Desktop Remote、真实数据库、Agent 工具与安全失败路径；mock 测试不能证明真实驱动、桌面打包或模型集成。
- `PROJECT_STATE.md` 是实际完成状态的唯一进度记录。功能条目必须包含 ID、行为、文件、证据、限制；发现旧条目不准确时同步修正。
- 依赖安装或工具受阻时，保留已完成的独立工作，写明具体阻碍并继续其他可推进项；不要用自制替代品冒充指定组件。

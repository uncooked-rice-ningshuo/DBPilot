# 工作台布局与 AI 设置优化

日期：2026-10-07。对应 PROJECT_STATE 的 F089、F090。

## 本次行为

1. 工作台固定为视口高度（100dvh），侧边栏与页面同高。数据库/表树、对话消息和工作区各自处理滚动，不由长列表撑高整个页面；侧栏的新建连接与底部状态保持可见。
2. 滚动条采用细轨道、圆角滑块与悬停反馈；保留系统滚动能力及键盘操作。
3. 工作区与 AI 面板之间增加 8px 分隔条。拖动可调整宽度；聚焦后左右键每次调整 10px，Shift+方向键调整 40px，Home/End 到边界，双击恢复默认。AI 面板约束为 260–600px，并预留工作区宽度。宽度保存在本机 localStorage，不保存凭据。窄屏自动上下排列，隐藏横向拖动条。
4. 每条连接右侧提供“测试连接”和“连接设置”图标按钮，支持键盘及可访问名称。测试状态显示在该行下方；设置、测试和删除绑定被操作连接，未选中连接也可操作。顶部移除这两个按钮，保留工作区级命令规则和桌面运行目标。
5. AI 面板标题栏增加“AI 设置”。供应商支持 DeepSeek 与自定义 OpenAI 兼容接口；可填写地址、模型 ID、API Key，并通过“获取模型 / 测试连接”读取供应商 models 接口。选择返回模型或手动填写均可，保存后新请求立即生效，正在执行的任务保持原配置快照。

## AI 配置与密钥

- HTTP：`GET/PUT /api/v1/ai/settings`，`POST /api/v1/ai/models`。桌面共用 DTO 和 Runtime 路径，具名 IPC 为 `ai.settings`、`ai.configure`、`ai.models`。
- 环境变量 DEEPSEEK_API_KEY + DEEPSEEK_MODEL 显式提供时优先，界面只读；移除环境配置并重启后改用界面保存的配置，不静默覆盖。
- 有数据目录时，API Key 通过 AES-256-GCM 加密保存到元数据库；需要既有 Secret Store 主密钥（Web：DBPILOT_MASTER_KEY_FILE 或 DBPILOT_MASTER_KEY；桌面沿用 safeStorage 主密钥）。没有主密钥则拒绝持久化，界面明确提示。无数据目录时仅内存保存，重启失效。
- 保存响应只返回 hasApiKey，不返回密钥或密文。保存与关闭弹窗会清空密钥输入框。留空仅在供应商与地址不变时保留密钥；变更供应商或地址必须重新输入，模型列表请求亦遵循同一约束。
- 请求地址仅允许 HTTPS 或 loopback HTTP，禁止 URL 内账号、查询与片段，禁止跟随重定向。上游错误使用固定提示，不把响应正文或异常内容送回页面。
- 保存带修订号，冲突返回 409；配置和审计同一事务。审计不记录 API Key。模型工具没有配置修改入口。
- 自定义兼容接口须实现 Chat Completions 工具调用协议；不发送 DeepSeek 专用 thinking 参数。模型列表成功只证明接口认证/列表可用，不等于该模型工具调用已通过验收。

## 文件

共享界面：`packages/workbench/src/{Workbench,AgentPanel,AiSettings,PaneDivider}.tsx`、`workbench.css`。通用表单/按钮/对话框/选择组件仍使用 packages/ui 中实际引入的 shadcn/ui。

后端：`packages/protocol/src/index.ts`、`packages/storage/src/ai-settings.ts`、`packages/storage/src/audit.ts`、`packages/ai-core/src/deepseek.ts`、`apps/server/src/app.ts`。桌面桥：`packages/runtime-client/src/desktop-operations.ts`、`apps/desktop/preload.cjs`。

## 验收证据与限制

- `DBPILOT_TEST_POSTGRES=1 DBPILOT_TEST_MYSQL=1 pnpm test`：196 通过、1 桌面启动用例未启用；构建通过，保留既有大 chunk/上游注释警告。
- `tests/ai-settings.test.ts`：配置热生效、密钥加密落盘与不回显、配置重启恢复、冲突、跨地址不复用密钥、缺主密钥拒绝保存、上游错误不泄露、兼容供应商请求参数。
- `tests/desktop-operations.test.ts`：新增三项 AI 配置路由和 preload 暴露检查。
- 隔离浏览器：120 张表，视口/文档/侧栏高度均 712px，树内容 3811px 在 522px 区域内滚动；方向键和拖动生效；非当前连接设置目标正确；读取真实 SQLite 行成功。780×720 与 390×844 下文档宽高未超视口。
- AI 表单使用模拟模型端点，验证获取模型列表、保存后密钥框为空及后续 Agent 回复。未使用用户 API Key，没有真实 DeepSeek 或其他供应商调用验收。
- 截图：`output/playwright/workbench-layout.png`、`ai-settings.png`、`workbench-mobile.png`。可用 `node scripts/validation/workbench-ui.mjs` 启动临时 SQLite/加密配置/模拟模型环境（3139），不访问保存的业务连接。
- Electron 本地原生模块 ABI 兼容问题仍是既有阻碍，本次没有声称完成桌面 Local/Remote 实际验收。

## 官方参考

DeepSeek 当前模型列表和 API 地址以供应商返回为准，不硬编码固定模型枚举：
- https://api-docs.deepseek.com/zh-cn/api/list-models/
- https://api-docs.deepseek.com/api/create-chat-completion/

默认模型 ID 为 deepseek-flash；用户可获取实际列表或手动更换。

# 桌面 SQLite 原生依赖隔离

## 问题与实现

Electron 44.5.1 使用 ABI 149，Node 开发服务使用 ABI 127。共用 `node_modules/better-sqlite3/build/Release/better_sqlite3.node` 会使其中一种 Runtime 加载失败。

`pnpm desktop:native` 将已安装的 better-sqlite3 源码复制到临时目录，使用固定版本 `@electron/rebuild` 针对已安装 Electron 编译，结果写入 `dist/server/native/better-sqlite3-版本/electron-ABI-系统-架构/`。构建后必须由真实 Electron 打开内存数据库并查询成功，才视为可用；缓存命中也执行该检查。临时源码自动清理，不覆盖 Node 原生文件。

`packages/storage/src/native-database.mjs` 为所有元数据存储、SQLite 连接检查和查询子进程统一选择模块。Node 沿用包默认模块；Electron（包括 ELECTRON_RUN_AS_NODE 查询子进程）通过 better-sqlite3 的 nativeBinding 指定独立模块，不以错误 ABI 的文件降级替代。

`pnpm desktop` 自动构建并准备原生模块。安装包包含 dist 下原生文件并解包 `.node`；关闭 electron-builder 对根依赖的自动重建。macOS arm64、Windows x64 打包命令要求在对应系统和架构执行，不支持从 macOS 跨编译 Windows SQLite。首次编译需要官方 Electron 头文件下载和系统 C++ 工具链。

## 证据

- 修复前真实 Electron 返回 `Local Core failed to start`，直接加载原生模块复现 127/149 不匹配。
- macOS arm64 从源码编译成功；真实 Electron Runtime 返回 200 和 `desktop-local`。
- `tests/desktop-native.test.ts` 使用临时 userData/SQLite 文件，走真实 Renderer preload → IPC → utilityProcess → 查询子进程，创建和测试连接、准备计划、执行 SELECT 并读取 `[[42]]`；之后 Node 再打开同一临时数据库成功。
- `DBPILOT_TEST_DESKTOP=1 DBPILOT_TEST_POSTGRES=1 DBPILOT_TEST_MYSQL=1 pnpm test`：198/198 通过。PostgreSQL/MySQL 使用专用隔离测试库。
- `pnpm build` 通过，保留既有 bundle 大小告警。

## 边界

本增量只确认 macOS 开发态的本地 Runtime 和 SQLite 查询链路；Windows、安装包、Monaco Worker/主题/键盘、Desktop Remote、真实模型仍分别验收。未检查或重启用户 3137 服务，未读取业务数据库。

## 后续 F092：桌面编辑器与 Remote

真实窗口展开 Monaco 时复现 CSP 阻止动态样式。已将样式限定调整为 `style-src 'self' 'unsafe-inline'`，脚本仍为 `script-src 'self'`，Worker 明确限于 `self`，并增加 `base-uri 'none'`、`form-action 'none'`。回归测试确认动态样式可用且内联脚本仍被拦截。

macOS 真实键盘输入 SQL、Cmd+Enter 执行并显示42通过；打包的 editor.worker 脚本成功启动，Worker 消息处理函数已注册。截图见 `output/playwright/desktop-editor-after.png`。

`tests/desktop-remote.test.ts` 使用随机端口隔离 HTTP Runtime：真实 Electron 完成握手、远程查询73、拒绝非安全HTTP地址且保留当前目标、切回Local后身份不变且连接不混用。桌面三项回归通过。此证据不覆盖跨主机HTTPS、完整语言服务、Windows或安装包。

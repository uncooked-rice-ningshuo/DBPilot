# 连接导航与跨数据库目标

## 用户行为

- PostgreSQL/MySQL 可不填默认数据库保存服务器连接。展开连接后列出账号可见数据库，选择数据库后浏览 Schema、表和视图。无需先指定某张表。
- PostgreSQL 使用 `postgres` 或用户填写的默认数据库作为发现入口；没有该入口的 CONNECT 权限时，应填写另一个有权连接的默认数据库。MySQL 使用不选择数据库的会话发现目录。SQLite 对应文件中的 main。
- 根连接、数据库、Schema/表分组均有独立展开状态；顶部提供展开全部和收起全部。折叠本身不删除连接。
- 搜索位于侧栏顶部，匹配连接名、主机、数据库、Schema、表名组成的路径；未选中或未展开的连接也参与检索。首次检索分页读取表名，不读取全库字段或业务行。每批最多三个数据库请求；失败目标不阻止其他连接。
- 每条连接旁提供测试、设置和删除。删除显示名称与端点/文件路径并要求确认，仅删除指定 ID 的配置。取消恢复原按钮焦点；删除后另一个同名连接和底层数据库仍保留。

## 执行与共享边界

`GET /api/v1/connections/:id/databases` 返回可见数据库目录；`GET /api/v1/connections/:id/tables?database=...&cursor=...` 每页返回最多200个表名；游标绑定连接ID、版本与数据库，以名称键集翻页。`GET /api/v1/connections/:id/schema?database=...&schema=...&table=...` 按需读取指定表字段；省略schema/table则保留全库有界检索。共享 DTO 验证响应，HTTP 和具名 Desktop IPC 使用同一 Runtime 路由。

`POST /api/v1/command-plans` 的可选 `database` 字段在准备时解析为精确目标并保存到计划。服务器连接没有默认库又未传目标时返回400；SQLite 仅允许 main。执行时使用保存的数据库，仍检查连接版本和命令策略；执行提交中的其他数据库不能改写计划。幂等指纹包含数据库，历史返回该目标。切换导航后点击表使用该节点的显式目标，避免 React 状态更新间隙导致误投。

Agent 增加 `list_databases`，Schema 和 SQL 计划工具接收数据库；待审批数据与界面显示精确目标。授权范围仍是连接，不允许模型绕过策略、确认或 Secret Store。这里只验证工具/模型 fixture，没有宣称真实模型联调通过。

## 验收证据

- 完整真实 PostgreSQL、MySQL、SQLite 及 macOS Electron 回归205/205通过，构建通过；后续历史响应隔离和AI截断标记修正后构建及相关17项测试通过。
- 新建两个 PostgreSQL/MySQL 临时数据库，服务器连接不指定默认库即可发现；相同SQL分别返回41/42，执行请求不能更换数据库；计划数据库跨存储重启保留。
- 真实 Electron Renderer IPC 验证数据库发现、指定 main 的 Schema 和查询；Remote 既有回归同时通过。
- 独立浏览器使用临时SQLite和真实PostgreSQL：未展开时跨两个同名连接搜索；根/数据库/表分组独立折叠、展开全部/收起全部；同名跨库表查询分别41/42；无匹配提示；空默认库保存/测试；重复连接删除取消与确认、剩余连接仍可查询。
- 1365×900、390×844的文档滚动宽高等于视口，目录在侧栏内部滚动。截图：`output/playwright/navigation-expanded.png`、`navigation-mobile.png`、`navigation-server.png`。
- 复现 fixture：先构建，再运行 `node scripts/validation/navigation-ui.mjs`，要求专用 PostgreSQL 测试实例127.0.0.1:55433；退出清理本次随机创建的数据库、SQLite和配置目录。

## 当前限制

F096 已将导航目录改为按名称分页读取，不再受旧版2,000表或5,000字段上限影响。旧全库Schema/AI检索仍保留SQLite2,000对象、PG/MySQL5,000字段预算及截断标记。目录分页是实时元数据，不是查询结果快照：扫描期间外部DDL可能改变目录，需要刷新重新读取。首次跨连接搜索仍需读取全部表名，大规模网络目录可能耗时；超过数千节点的树尚未虚拟化。目录缓存只在当前页面内使用，连接版本变化会失效；外部DDL后需刷新页面。

Windows、跨主机HTTPS、真实模型未在本增量验收。未访问或升级现有3137服务，未使用其连接或凭据。macOS包为未签名开发产物，不代表Gatekeeper或正式发行验收。


## F096 分页目录补充验收

- 三数据库回归203项通过，最新构建后三个真实Electron测试通过，合计206项；构建通过。
- SQLite2,105张表分页完整覆盖，无重复；PG/MySQL各206个表跨两页覆盖，跨数据库复用游标返回400；指定表字段单独返回。含空格、双引号的SQLite名称正常读取。
- 浏览器对两个各2,105表的连接搜索 `example_999`，共25次目录请求（含PostgreSQL三个数据库），搜索阶段无Schema字段请求；点击后结构面板显示2个字段。缓存后全部展开约984ms（本机单次观察，不作为性能保证），全部收起和390px窄屏边界正常。截图 `navigation-paged-schema.png`、`navigation-paged-mobile.png`。
- 大目录fixture可设置 `DBPILOT_NAV_TABLE_COUNT=2105`；其余启动要求和清理方式同上。

# 全局操作通知与控件状态统一

## 交互约定

操作反馈统一显示为右下角 Toast：连接测试/保存/删除、AI 配置与服务测试、规则加载/保存失败、SQL 提交/执行错误、Agent 请求错误和目录读取失败。通知通过 body Portal 渲染，位于 Dialog/Select 之上，不占页面或弹窗布局空间。桌面距离右边/底边20px，窄屏12px；最多可见3条，成功默认4.5秒、错误8秒、警告10秒，可关闭、悬停暂停；重复错误以稳定ID更新，避免轮询堆积。

输入格式、必填内容、端口和规则格式等客户端校验仍在表单区域。通知不是操作日志：SQL历史/命令日志、Agent工具记录、失败详情与部分完成状态继续保留，重要写入结果不能只依赖会消失的提示。错误Toast不会自动重试或重放SQL。

共享Dialog对通知层的外部点击不执行关闭，因此点击“关闭提示”不会误关配置或审批弹窗。通知区有中文无障碍名称和live region；按钮保留中文名称，装饰图标不参与朗读。

## 控件样式

- AI模式、连接范围保持原行为，改为28px紧凑选择器、11px字号和轻背景，宽度随文本分配；普通配置表单保留正常控件高度。
- 下拉菜单统一采用锚定触发器的popper，内容碰撞边界8px，统一小字号、选中勾与悬停背景；移除触发器底层阴影。
- 数据/结构和SQL控制台标签以单一下划线表示选中，不再叠加边框、底色或阴影；下划线不交叉淡入，避免短暂双选中。
- 键盘焦点使用独立细轮廓，保留方向键切换。共享outline按钮移除阴影；连接弹窗测试/取消/删除显式采用次要按钮变体，避免被主按钮底色覆盖。

## 实现来源

安装Sonner2.0.8，使用官方shadcn new-york-v4 Sonner组件适配，详情与上游地址见 `packages/ui/README.md`。通知与组件位于 `packages/ui`，操作接入位于共享 `packages/workbench`，Web与Electron Renderer使用同一实现。图标沿用离线Iconify，没有新增图标网络请求。

shadcn CLI依赖安装受默认网络路径超时影响，公共npm地址通过IPv4请求验证后使用 `NODE_OPTIONS=--dns-result-order=ipv4first` 的单次pnpm命令完成安装；未修改全局网络配置。曾被自动审批拒绝的 `.npmrc` 读取没有执行，也未使用凭据配置排查。

## 验收

- 构建通过；最新真实Electron渲染/CSP、SQLite IPC和Local/Remote三个测试通过。三数据库206项基线（203服务端/共享测试+3桌面）见F096，本增量未改变数据库执行语义。
- 浏览器1365×900：测试连接成功前后连接行矩形完全相同；缺失SQLite路径导致真实测试失败，弹窗矩形不变；Toast距右/底20px，elementFromPoint命中通知而非遮罩，未被aria-hidden隐藏；关闭提示后弹窗仍可编辑。
- 空路径就地校验保留。AI测试失败使用502 fixture，错误前后弹窗矩形相同；成功fixture返回2个模型，使用全局成功提示，没有真实模型调用。
- SQL拼写错误不改变编辑器矩形；真实SQLite缺失字段执行失败显示“SQL失败”Toast，错误仍在执行日志中保留。
- 选中标签计算样式为border0、box-shadownone、透明背景；只有当前标签伪元素opacity1，非选中为0；方向键切换通过。AI选择器实测28px。
- 390×844通知左12px、右12px，页面scrollWidth/scrollHeight等于视口。截图：`output/playwright/toast-over-dialog.png`、`toast-sql-error.png`、`toast-mobile.png`、`compact-select-tabs.png`。

Windows、跨主机HTTPS、真实模型与完整屏幕阅读器矩阵未在本增量验证；未访问或升级用户现有3137服务。

打包复验补充：桌面“浏览”按钮原先嵌入文件路径Label，导致输入框无障碍名称混入按钮文字，验收脚本按精确名称定位失败。已改为htmlFor/id显式关联，并直接断言关闭通知后Dialog仍可见；通知Portal额外阻断自身指针/点击冒泡，隔离Radix延迟外部点击处理。这次超时不能记为已证实的“弹窗被关闭”。

最终macOS arm64包复验通过：`scripts/validation/desktop-packaged.mjs`实际确认Toast覆盖层命中、无aria-hidden、弹窗矩形恒定、关闭通知后Dialog可见且文件路径仍可编辑；真实SQLite查询及重启恢复同时通过。应用包/DMG为未签名开发产物，未安装到Applications。

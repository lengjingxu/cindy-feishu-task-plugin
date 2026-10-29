# Host 兼容性与验证范围

## 结论

0.15.5 仅交付开发源码，不是已完成的飞书任务产品，也不提供完整兼容安装包。新增的 inspect_host_support 不需要凭据，检查的是当前适配器入口，不代表安全存储不存在或完整流程可用。

0.15.4 删除 minCindyVersion 导致 MANIFEST_INVALID，这只证明 schemaVersion 3 缺必填字段，**不是运行时能力缺口的证据**。目前没有已核实支持完整业务依赖的正式版本，不能为了打包而填写 0.1.118 或 0.1.120。源码清单仍不满足发行条件；不能将“故意不能打包”当作解决目标。

正式随包 plugin-manifest.md 第 58–63 行要求该字段表示插件实际依赖的首个正式版本，供发布服务选择兼容 release，**不是单纯的 schema 加载版本**。plugin-compatibility.md 第 6–12 行另要求运行时能力检测。只读检查、隔离 VM 和 Forge 成功都不能证明同一完整插件已兼容。

## 可复现证据

审计对象为 /Applications/Cindy.app/Contents/Resources，版本 0.1.120，sourceCommit 为 b3dd8436228135aa8be9827d204e4e5eaf9316b4，builtAt 为 2026-10-29T00:19:45.253+08:00。该来源提交未从公开仓库解析，不能用公开 beta tag 或测试分支替代。

运行 npm run build 后执行 npm run audit:host；也可执行 node scripts/audit-installed-host.cjs 并传入目标应用 Resources 目录。

脚本只读 app.asar 和随包作者文档；在隔离 VM 中执行实际 preload、Node bootstrap 及插件 worker 的无副作用能力检查。它不调用真实 IPC、不打开授权、不访问网络、不读取用户凭据/数据库、不派发或取消任务。静态字符串只用作索引，不能单凭“没搜到”推导功能不存在。

[本次审计结果及 SHA-256](host-contract-0.1.120.json) 包含可复查文件指纹。它属于安装产物静态核验及隔离协议执行，**不是正式 Host 安装验收或真实闭环**。

| 边界 | 正式公开证据 | 对本插件的结论 |
| --- | --- | --- |
| Node 权限 | 随包 §4.12.3：当前系统账号可读写文件、联网；bootstrap 仅暴露 spawnEntry、bindDeviceAuthorization、bindAuthorization | 飞书 SDK、HTTP、长连接、队列可由插件维护；不需要新增飞书专用 Core 业务 |
| SDK 注册 | §4.12.5：device/browser 只开授权页，CLI 继续轮询、保存、校验；成功须晚于实际领取保存校验 | 不能把 bindHostServices 说成 SDK 天然依赖；当前适配器使用它只是现有实现选择 |
| Host 凭据 | §4.12.1：设置页 /secrets/key PUT 写 safeStorage；secretBindings 按 method/entry 注入 Node | 支持用户填写凭据。不是 Node 新授权结果写回接口；不能将 SDK secret 经 stdout/BC 转给页面代存 |
| 插件自管凭据 | §4.12.5 允许 CLI 自管；正式 bootstrap 无 owner 数据目录接口，cwd 为系统临时目录 | 可设计自己的安全存储，但必须解决命名、权限、撤权及身份隔离；不能声称自动获得 Cindy 账号隔离，不能写包目录或临时目录冒充持久化 |
| 账本 | §4.10：fs root=data 支持读写列删；workdir/save 仅 write | Journal 可保持由插件维护、使用公开 fs；它不能读取过户文件，也不是密钥保险库 |
| 文件过户 | §4.7：dir_deposit 只有 token/file_count/total_bytes/rel_paths；uploadDir 接受票据与当前 callId | 路径/文件字节不交插件。Node 没有票据解引用接口；不能扫描 Agent 目录替代 |
| 上传鉴权 | §4.7：cindy.fetch 过滤页面 Authorization；凭据来自 network.secrets/connections/OAuth | uploadDir 已存在。缺的是 Node 动态飞书 token 与 Host 票据上传的安全组合，而非“没有上传能力” |
| 静态 exchange | §2、§4.7：静态 bodyFormat 只有一个占位符，实际代码对 JSON 值转义 | 固定 appId + 用户填写 appSecret 可定义静态交换；不能从动态 envelope 拆出 appId/appSecret，也不能为扫码后的任意多应用修改已批准 manifest。不是本需求的等价架构 |
| 伙伴投递 | 实际 preload 与 PluginTargetSlot 均只有 list/resolve/send/cancel；§4.11.3 描述普通内容投递 | accepted 不是独立伙伴任务范围授权；额外 delegation 可能被忽略，禁止据此宣称独立执行 |
| 取消及结束 | §4.11.3、实际取消分支仅 cancelled/runningWorkMayHaveStarted，无 settled | 不能据取消或纯文字回报解除原伙伴在途占位；已有 needs_input/排队任务保持原状 |
| 普通任务 | tasks.create/send/getRun/listRuns/readMessages 仅适用插件自建普通任务 | 不可把伙伴 taskId 交 tasks API 读结果；不以普通任务替代指定伙伴 |

## 保留的业务与最小缺口

飞书 SDK 注册、订阅、任务资料、预约（无开始日期的循环用截止日期）、队列、多应用映射、进度和结果协议仍属于插件。自主计时器不依赖页面操作；暂停阻止后续项与新唤醒，等待已开始单项结束，不能撤回已发请求。退出 Cindy 后不会继续执行。

在保留动态扫码多应用、Host 文件过户与真实关联伙伴执行的条件下，正式版本缺少两项关键组合：**动态鉴权票据上传**与**范围受限的伙伴执行及可信 settled 回执**。另有插件自管安全凭据尚未实现/验证，不能混同为必然要改 Core 的缺口。见 [最小公开协议方案](minimal-host-contract.md)。

测试构建 33c0b30a3173e2c9afcec6fe8357f82f3cc733c9 仅作旧适配器参考。公开 v0.1.119 / v0.1.120-beta 不是上述安装构建。本阶段没有改 Core、现有安装或真实任务。

## 本阶段检查

本地 Node v26.7.0：构建通过，163 项单测、90 项模拟 Host UI 检查通过。新增检查覆盖无需凭据的能力查询、未声明伙伴执行能力的如实报告、普通请求不捕获授权/上传扩展。正式 ASAR 的真实 Node bootstrap 在隔离 VM 中执行本插件 bundle，返回 authorization=true、hostServicesEntry=false、childSpawn=true。

没有执行真实安装、扫码、上传或伙伴闭环。本阶段未生成 .cindy，故无安装包校验值。新增工具和 setup.requires=[] 让无凭据的支持检查可被发现，业务动作仍保留自身认证/授权检查；未增加文件、网络、Node 或伙伴权限。

清单仍保留测试适配器的 agent.delegation、secretBindings.saveMethods/settingsMethod 声明，以便旧测试代码的权限需求可审查；这些不是正式版已实现能力，也不授予权限。inspect_host_support 只探测入口，不调用或验证 scoped execution/settled。

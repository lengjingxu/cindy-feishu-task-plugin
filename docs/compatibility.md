# Host 兼容性与验证范围

## 当前结论（2026-11-10）

飞书任务插件 0.15.13 的 `minCindyVersion` 为 **0.1.124**：这是所需公开接口首次进入正式版本的边界。真实完整闭环已在用户当前安装的 **macOS Cindy 0.1.130 构建**通过。0.1.124 的结论来自不可变源码和随包契约核对，尚未在该旧版单独运行真实飞书闭环；最低接口版本不等于每个后续版本都已实测。

仅支持 macOS：凭据由插件自管 macOS Keychain 保存。其他操作系统明确返回 `CREDENTIAL_PLATFORM_UNSUPPORTED`，不写明文、不采用替代存储。运行时仍要求 `execution`、`receiptQuery`、`settled` 均可用；普通 send 的 accepted 不代表执行能力就绪。

## 最低正式版本的依据

- [Cindy PR #7868](https://github.com/makecindy/cindy/pull/7868) 于提交 `018663ea63294a566c83a7faaf62805905220572` 合入，补齐动态鉴权票据上传与范围受限伙伴执行回执。
- [正式 v0.1.124](https://github.com/makecindy/cindy/releases/tag/v0.1.124) 指向 `a5bd13c69b9f984ebee5fe32c737e489b6ab47dc`，包含上述提交。`v0.1.121` 不包含；`v0.1.122-beta` 已包含，但不作为最低正式版本；不存在 `v0.1.122`、`v0.1.123` 正式 tag。
- 在该固定提交核对 preload、Node bootstrap/Host services、targets slot 及作者契约：`bindHostServices().authenticatedFetch()` 可组合动态 Node 鉴权与 Host `uploadDir`；targets 支持 capabilities/list/resolve/send/get/cancel，委派声明 `receiptQuery` 与 `settled`，get 返回真实执行标识与终态。
- 固定源码证据：[Node 入口](https://github.com/makecindy/cindy/blob/a5bd13c69b9f984ebee5fe32c737e489b6ab47dc/apps/desktop/src/main/cindy-brain/nodeRuntimeWorkerProcess.ts#L259)、[鉴权上传](https://github.com/makecindy/cindy/blob/a5bd13c69b9f984ebee5fe32c737e489b6ab47dc/apps/desktop/src/main/cindy-brain/nodeHostServicesClient.ts#L40)、[伙伴执行及收据](https://github.com/makecindy/cindy/blob/a5bd13c69b9f984ebee5fe32c737e489b6ab47dc/apps/desktop/src/main/cindy-brain/pluginTargetSlot.ts#L131)、[真实审核接线](https://github.com/makecindy/cindy/blob/a5bd13c69b9f984ebee5fe32c737e489b6ab47dc/apps/desktop/src/main/maker-ipc/register.ts#L18512)。
- 既有公开 fs、Node 请求/通知、授权和子进程能力在该版本保留。插件不依赖私有数据库、扫描伙伴工作目录或未公开的文件解引用入口。

版本证据只说明客户端接口，不保证飞书应用权限、订阅、账号和伙伴模型已配置。运行时检查和真实错误处理继续生效。

## 当前安装构建与公开 tag 的差异

实际验收对象 `/Applications/Cindy.app` 显示 0.1.130，随包 `cindy-source.json` 记录 `sourceCommit=c0252b6d594ce8cd1ee6da900fbadfb70c5c8c23`、构建时间 `2026-11-10T11:47:42.875+08:00`。该提交未能从公开仓库解析，不能与官方 [v0.1.130](https://github.com/makecindy/cindy/releases/tag/v0.1.130) 的 `999f7b8b415b17d246acaed7fe07880439fcaf72` 混同。

因此真实验收只覆盖上述已安装构建；官方 tag 的源码契约核对不能替代官方发行二进制或 0.1.124 的独立完整实测。已直接审计实际安装的 preload、Node bootstrap 与主进程包，文件指纹及隔离协议执行见 [0.1.130 安装产物审计](host-contract-0.1.130.json)。隔离审计不接真实 IPC、网络、凭据或任务，不能单独当作完整验收。

## 真实闭环验收

同一原位更新实例保留原账号、伙伴映射和账本，恢复已有钥匙串凭据后执行专用测试：

| 环节 | 结果 |
| --- | --- |
| 飞书创建任务与事件接收 | 通过 |
| 关联伙伴实际执行与开工进度 | 通过，进度独立读回 |
| 真实 UTF-8 文本生成 | 48 字节，标记加一个 LF |
| 结果文字与 Host 票据文件上传 | 通过，声明文件与交接目录严格一致 |
| 飞书完成状态、文字与附件读回 | done=true、agentStatus=4，附件归属与字节数一致 |
| 附件下载 | 与原内容逐字节一致，SHA256 已持久化 |
| Host 执行终态 | settled=true、completed |
| 专用任务清理 | 删除后独立读回 absent=true |
| 原记录保留 | 原三个任务完整对象与测试前基线一致 |

本轮含人工纠正伙伴两处调用错误后重新测试：`ghost_call` 参数必须放在顶层 `args`，不是 `arguments`；顶层 `dir` 必须仅交接声明的文件，不能把含历史文件的公共目录整体上传。第一轮正确拒绝不匹配目录；第二轮全部通过。未放宽上传校验、未修改业务代码。

私密原始任务标识、账号信息、下载内容和完整回执仅保存在作者本地 `output/acceptance-0.15.13/`，不进入仓库或安装包。

## 尚未覆盖

本轮使用已有账号恢复，未重新扫码注册新应用。未对官方 0.1.124/0.1.130 发行二进制分别做完整闭环，也未验收跨设备授权、其他操作系统、长期断线补收或循环任务两期自然执行。自动化测试使用模拟 Host，不能补足这些真实场景。

旧 0.1.120 缺口、配套开发 Host 及 0.15.11 历史结果见 [历史兼容记录](compatibility-history.md)，不再作为当前安装构建缺少接口的结论。

## 0.15.17 接收恢复与受控执行验证（2026-11-12）

当前正式 macOS Cindy 0.1.133：原位更新重启插件运行时后，在没有点击“开启接收”的情况下自动连接；保存的接收意愿、应用、伙伴和原基线保留。另有启动暂时失败自动恢复、三次上限、暂停保护、并发去重与历史回执查询失败隔离测试。未为此中断整个客户端的其他在途伙伴任务。

用户创建的原生智能体任务必须使用开工事件提供的真实 `execution_id`。官方 API Explorer 当前元数据将其定义为 PATCH 顶层、评论/步骤 JSON 顶层及附件上传 multipart 字段；不能用 SDK 旧字段清单推断该字段不需要，也不能以任务 GUID 或 Cindy 执行编号代替。真实原生任务已验证开工进度、结果全文及完成状态 `done=true / agentStatus=4`；纯文字任务没有声明或上传文件，本轮不增加文件上传的真实验收范围。

- 官方 PATCH 元数据：https://open.feishu.cn/api_explorer/v1/api_definition?project=task&version=v2&resource=task&apiName=patch
- 本轮保留原任务，不运行专用测试的自动清理。
- 新任务拒绝延迟旧轮次重放；新轮次只有在原宿主执行已明确结算且失败记录完整保存后才能接续。
- 旧版将结果全文重复放入进度字段触发明确的 `99992402` 校验拒绝；提供受限显式修正，只替换该进度，保留原拒绝证据和已核验正文。传输未知、其他错误或其他写入不能使用此修正。

### 完整客户端退出重启（2026-11-12）

正式安装的 `/Applications/Cindy.app` 0.1.133、个人实例插件 0.15.17 已补验完整退出重启：通过正常退出链路结束旧主进程，再重新打开同一安装应用；旧 PID 54001 消失，新 PID 64719。客户端生命周期日志记录 `before-quit`、关闭插件运行时及新的启动过程。

重启后仅打开插件应用设置查看，未点击开启接收；真实界面显示原应用、原伙伴“接收中”。账本独立对比确认 `receivingRequested=true`、原 `baseline`/`assignmentBaseline`、应用/伙伴和任务 GUID 集合不变，已完成任务仍为 `done=true / agentStatus=4`。截图及前后对比证据保存在本地 `output/full-client-restart/`，未上传包含其他工作内容的整窗截图。临时重新启动辅助进程已撤销。

本项只证明完整退出重启后的接收恢复，不代表长期断网补收、受控执行轮次下的真实文件上传或循环任务两期自然执行已验收。

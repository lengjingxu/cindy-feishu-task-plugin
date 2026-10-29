# Host 兼容性

插件的飞书业务、页面、队列及回报逻辑均在本仓库。Cindy 只提供通用插件接口和审核接线。

| 必要能力 | 用途 |
| --- | --- |
| Node secretBindings.saveMethods / settingsMethod | 设置页授权及凭据安全保存 |
| 带鉴权的文件上传桥接 | 将实际产物上传至原飞书任务 |
| agent.delegation、targets.capabilities / send | 向绑定伙伴委派受限任务 |
| 输入、取消与 settled 回执及 Auto 审核接线 | 确认执行归属，保护在途占位 |

2026-10-29 核对官方 tag `v0.1.119`，commit `0694ed7e001e027a031ffed21a088bd1975132de`：其 [manifest](https://github.com/makecindy/cindy/blob/0694ed7e001e027a031ffed21a088bd1975132de/packages/plugin-protocol/src/manifest.ts) 尚无 delegation、saveMethods、settingsMethod 声明，不能作为本插件完整支持版本。

本地验收构建源码基于 `33c0b30a3173e2c9afcec6fe8357f82f3cc733c9`；这是测试构建记录，不是正式支持版本承诺。相关 [Core PR #7718](https://github.com/makecindy/cindy/pull/7718) 在本次检查时为 CLOSED、未合并。仓库不会自动修改或重开该 PR。

当前 minCindyVersion 沿用开发期格式基线 0.1.118。正式上架前必须验证实际发布的 Host，填写真实支持的最低版本，并在该版本完成安装、授权、执行、文件及状态回报。缺少能力时保留错误，不改用普通消息冒充委派成功。

## 0.1.120 绑定提示核验

2026-10-29，运行客户端报告 currentVersion=0.1.120，当前渠道没有可安装更新。只读检查实际安装包的 package.json 和 `.vite/build/nodeRuntimeWorkerProcess.js`：版本确为 0.1.120，Node 工作进程没有 `bindHostServices`，因此插件的 binding/restore 返回 hostServices=false，应用设置不展示绑定按钮。

该安装构建的来源元数据为 `b3dd8436228135aa8be9827d204e4e5eaf9316b4`，公开仓库未能解析这个提交；以上结论来自实际安装包，不能把它等同于公开 beta tag。公开 `v0.1.120-beta` 的 commit 为 `b0c217c98b2346bb32a34821241992ba52918a86`，其 manifest 同样未包含 delegation、saveMethods、settingsMethod。

0.15.3 将“请更新 Cindy 后绑定应用”改为“当前 Cindy 缺少此插件的绑定接口”，并把 HTTP 失败和响应格式错误分开报告。插件文案修正不能补齐宿主能力。永久解决仍需通用接口合入 Cindy、发布兼容构建并完成真实闭环验收；不预设一个尚未验证的最低正式版本。

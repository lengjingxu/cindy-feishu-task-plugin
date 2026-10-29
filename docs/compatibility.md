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

# Host 兼容性

插件的飞书业务、页面、队列及回报逻辑均在本仓库。Cindy 只提供通用插件接口和审核接线。

| 现有测试适配器使用的能力（不是正式版架构要求） | 用途 |
| --- | --- |
| Node secretBindings.saveMethods / settingsMethod | 设置页授权及凭据安全保存 |
| 带鉴权的文件上传桥接 | 将实际产物上传至原飞书任务 |
| agent.delegation、targets.capabilities / send | 向绑定伙伴委派受限任务 |
| 输入、取消与 settled 回执及 Auto 审核接线 | 确认执行归属，保护在途占位 |

2026-10-29 核对官方 tag `v0.1.119`，commit `0694ed7e001e027a031ffed21a088bd1975132de`：其 [manifest](https://github.com/makecindy/cindy/blob/0694ed7e001e027a031ffed21a088bd1975132de/packages/plugin-protocol/src/manifest.ts) 尚无 delegation、saveMethods、settingsMethod 声明，不能作为本插件完整支持版本。

本地验收构建源码基于 `33c0b30a3173e2c9afcec6fe8357f82f3cc733c9`；这是测试构建记录，不是正式支持版本承诺。相关 [Core PR #7718](https://github.com/makecindy/cindy/pull/7718) 在本次检查时为 CLOSED、未合并。仓库不会自动修改或重开该 PR。

0.15.4 已撤下未经验证的 minCindyVersion: 0.1.118。schemaVersion 3 要求该字段，因此当前源码应被 Forge 拒绝打包；不使用占位版本或降级 schema 绕过。正式上架前必须验证实际发布的 Host，填写真实支持的最低版本，并在该版本完成安装、授权、执行、文件及状态回报。缺少能力时保留错误，不改用普通消息冒充委派成功。

## 0.1.120 绑定提示核验

2026-10-29，运行客户端报告 currentVersion=0.1.120，当前渠道没有可安装更新。只读检查实际安装包的 package.json 和 `.vite/build/nodeRuntimeWorkerProcess.js`：版本确为 0.1.120，Node 工作进程没有 `bindHostServices`，因此插件的 binding/restore 返回 hostServices=false，应用设置不展示绑定按钮。

该安装构建的来源元数据为 `b3dd8436228135aa8be9827d204e4e5eaf9316b4`，公开仓库未能解析这个提交；以上结论来自实际安装包，不能把它等同于公开 beta tag。公开 `v0.1.120-beta` 的 commit 为 `b0c217c98b2346bb32a34821241992ba52918a86`，其 manifest 同样未包含 delegation、saveMethods、settingsMethod。

0.15.3 将“请更新 Cindy 后绑定应用”改为“当前 Cindy 缺少此插件的绑定接口”，并把 HTTP 失败和响应格式错误分开报告。插件文案修正不能补齐宿主能力。后续须基于正式版实际公开契约选择插件架构；不能由当前适配器缺接口推导出必须改 Cindy Core。未验证前不预设最低正式版本，也不宣称可独立闭环。

## 插件自主调度（0.15.4）

预约与安全重试由插件自己的计时器驱动，不再依赖连接心跳或用户打开页面。到期仍重新读取飞书任务，保留固定伙伴、冻结未知投递及原有重试规则。忙碌伙伴每分钟检查；较远预约最多每分钟校时。暂停、监听结束、断开前清除计时器。暂停阻止后续队列项和新唤醒，并等待正在处理的单项结束；已经发出的请求不能撤回。循环仍由飞书生成下一期，无开始日期使用截止日期。

计时器运行在插件已有常驻逻辑页中，不表示退出 Cindy 后还会执行，也没有新增系统服务、后台守护或权限。测试使用虚构数据和可控时钟；不代表正式客户端或真实飞书任务已经验收。

## 待核验的最小边界

- 凭据：SDK 注册业务归插件；安全保存与恢复选择哪条正式公开路径仍待核验，不无条件要求 saveMethods/settingsMethod。
- 执行：真实伙伴任务的授权、身份与 settled 回执必须有公开协议，普通消息不能替代。
- 文件：真实文件过户和鉴权上传必须核对正式协议，不能把测试 authenticatedFetch 当作唯一方案。
- 持久化：插件维护账本和队列；正式 Host 的 Node 权限、持久化位置与隔离契约须验证后决定。

本阶段未选择或实装新的凭据架构，未读取宿主私有数据，未改动真实在途任务。完整独立使用目标仍未达成。

## 本阶段验证记录

2026-10-29：本地 Node v26.7.0，构建完成，160 项单测、90 项模拟 Host UI 检查通过。新增 6 项自主调度测试，覆盖无心跳到期派发、忙碌伙伴、日期延期、暂停恢复、未知投递与读取失败退避。未执行真实授权或飞书闭环。

Forge 对当前源码实际返回 MANIFEST_INVALID：schemaVersion 3 必须声明 minCindyVersion。没有生成新的 .cindy 包，无法给出安装包校验值；未改用其它打包方式。权限声明没有新增，测试构建的绑定及委派声明仍存在，尚未重构成正式版架构。

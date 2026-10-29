# 飞书任务 · Cindy 插件

将飞书应用关联到 Cindy 伙伴。飞书向应用指派任务后，插件交给对应伙伴执行，并回报进度、结果与产物。

本仓库独立维护源码、测试和 `.cindy` 安装包，无需把飞书业务代码放入 Cindy 主仓库。

## 看看它如何协作

[介绍与交互演示](docs/demo/feishu-task.html)：下载这一份 HTML 即可离线打开。12 项虚构任务、4 位伙伴，支持按状态、清单、伙伴和创建人分组，点击任务查看执行记录、预览和下载演示文件。

![虚构数据任务看板](docs/demo/task-board.png)

[任务详情与回报截图](docs/demo/task-result.png)。演示页面不连接飞书，不代表实际线上验收结果。运行 `node scripts/capture-demo.cjs` 可重现截图并检查交互。

## 当前发行

**0.15.3 为工程预览版，尚未在 Cindy 插件市场上架。**

当前已验证的运行环境是包含通用认证与伙伴委派扩展的 Cindy 测试构建。官方 `v0.1.119`、`v0.1.120-beta` 及本次核验的 `0.1.120` 安装构建尚不满足这些接口要求，普通正式版用户请等待兼容版本。清单中的 `minCindyVersion: 0.1.118` 是现有格式基线，不代表该正式版本能运行完整流程；正式上架前必须替换为实际验证通过的最低版本。见 [兼容性](docs/compatibility.md)。

[下载预览安装包](https://github.com/lengjingxu/cindy-feishu-task-plugin/releases) · [Cindy](https://github.com/makecindy/cindy)

## 功能

- 在应用设置扫码或打开授权链接，创建或选择飞书应用，关联处理伙伴。最多四个独立应用连接。
- 接收飞书任务，按状态、清单、伙伴或创建人分组查看；详情展示描述、日期、直接子任务、附件和进度。
- 有开始日期时预约执行；循环任务无开始日期时使用截止日期。清单分组保留在插件内。
- 固定伙伴处理任务，完成后回报原飞书任务；产物支持打开和下载。
- 按应用隔离凭据和记录，保留原任务伙伴映射及未知投递状态，避免盲目重复执行。

## 开发与测试

需要 Node.js 22 和 npm。

```sh
npm ci
npm run build
npm test
npx playwright install chrome
npm run test:ui
```

UI 测试使用模拟 Host，覆盖明暗模式及 320–1360px；通过不代表飞书线上闭环通过。真实循环任务的两期自然执行仍待验收，跨设备授权及长期断线补收也未完成端到端验收。

## 打包与发布

在 Cindy 中使用插件创作工具 `ghost_forge_pack`，将 `dir` 指向本仓库 `plugin/` 的绝对路径。工具校验后生成 `feishu-task-bridge-<version>.cindy`。安装包通过 GitHub Releases 独立发布；Cindy 市场提审另走已安装实例的发布预检和审核流程。

后续更新通过分支、测试和 PR 合并到最新 `main`，再发布与提交一致的安装包。发布步骤见 [发布说明](docs/releasing.md)。

## 目录

- `src/`：插件后台、任务队列、认证与飞书协议。
- `plugin/`：清单、页面、图标与构建产物。
- `test/`、`scripts/`：自动测试和构建。
- `docs/`：兼容性与发布流程。

公开仓库不包含真实任务记录、账号凭据、人员信息或私人验收截图。随包依赖的许可见 [第三方声明](plugin/THIRD_PARTY_NOTICES.md)。

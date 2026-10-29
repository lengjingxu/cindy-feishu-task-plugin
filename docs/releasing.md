# 独立发布

> 0.15.4 当前仅为开发源码：未核实最低正式 Host 版本，Forge 实测因缺少 minCindyVersion 拒绝打包。以下流程须待正式契约及真实闭环验收后执行，不填占位版本绕过。

1. 从最新 main 建分支；修改源码与必要测试。版本需同步 package.json、package-lock.json、plugin/ghost.json，并填写 releaseNotes。
2. 运行 npm ci、npm run build、npm test、npm run test:ui。用 Cindy Forge 校验并打包 plugin 目录，确认包与构建内容一致。
3. 检查已有 PR、最新远端 main 及可合并性；通过检查后合并 PR，本地同步 main。
4. 针对合并提交创建 GitHub tag 和 Release，上传 .cindy 及 SHA256SUMS。测试构建依赖未解除时只能标为预览，不设为稳定最新版。
5. 正式支持的 Cindy 版本和真实闭环验收都通过后，才更新最低版本并准备 Cindy 插件市场提审。市场发布需从已安装、已使用的确切实例进行预检；GitHub Release 不等于市场上架。

## 公开内容

只提交源码、模拟测试、依赖声明、公共文档及必要静态资源。真实授权、任务回执和截图留在本地，evidence、output、dist 不进入 Git。历史私密实验记录不推送到公开仓库。

## 首次预览

0.15.2 基于 0.15.1 功能快照建立独立公开发行，整理包内文档并让 UI 测试自动创建输出目录。未改变线上任务、伙伴对应关系或正在排队的循环验收。

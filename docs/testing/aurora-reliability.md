# Aurora 测试范围与旧套件诊断

更新日期：2026-09-30

## 命令与范围

| 命令 | 覆盖范围 | 当前结果 |
|---|---|---|
| `npm test` | 默认运行 `test/aurora/*.test.js`；脚本把排序后的测试文件显式传给 Node，并原样传递测试进程退出码 | 96 项通过（2026-09-30，含游戏库模型、入口和未知状态安全回归） |
| `npm run test:aurora` | 与 `npm test` 相同的 Aurora 专项测试入口 | 96 项通过（2026-09-30，含游戏库模型、入口和未知状态安全回归） |
| `npm run test:legacy` | 保留原命令 `node --test --test-concurrency=1 test/*.test.js`，用于诊断原版 Swapper 顶层测试 | 281 项：268 通过、11 失败、2 跳过；与执行前基线相同 |

Aurora 专项包含包校验、复制/代理切换、备份与还原、事务恢复、持久化、服务互斥、主进程 IPC 和 renderer 行为。本轮还验证了两条跨模块路径：成功修复通过主进程实际追加 Aurora 历史记录；选择了嵌套 exe 时，renderer 将 exe 的父目录作为安装目标，而不是 Steam 库根目录。

默认入口不是全仓测试，也不代表旧 Swapper 的所有共享逻辑都通过。不要据此宣称“全仓测试全绿”。

## 旧套件基线中的 11 项失败

下表的“本轮新增”指相对于本轮开始执行计划前的基线；11 项当时已失败，均不是本轮改动首次引入。Aurora 使用情况按实际生产路径区分；“非 Aurora”不等于相关代码已经从仓库删除。

| 测试文件与名称 | 基线症状 | 生产引用与 Aurora 关系 | 本轮新增 |
|---|---|---|---|
| `test/backend-profile.test.js` — `a tampered profile is still refused outright` | 断言路径逃逸配置必须抛错，但未抛错。该 fixture 用 Windows 反斜杠路径；基线运行于 macOS，模块按宿主 `path` 解析，不能据此断言 Windows 目标行为。 | `src/core/backend-manager.js` 的旧 Swapper 配置恢复路径；Aurora 使用独立的 `src/aurora/` 安装记录，不加载 backend profile。 | 否 |
| `test/community-strings.test.js` — `the BETA badge is a sibling of the title, not inside it` | 找不到旧社区标题节点。 | 社区 renderer 文案/标记；社区 IPC 和 renderer 代码仍在仓库中，但不参与 Aurora 安装、修复或还原。 | 否 |
| `test/library-xbox.test.js` — `a package that is not a junction is still listed, named from its package` | 期望 `/var/...`，macOS 返回等价的 `/private/var/...` 临时目录。 | `src/library.js` 的通用发现模块仍由主进程游戏库入口使用；Xbox 分支不属于 Aurora 第一版的 Steam/手动目录范围。此项表现为 macOS 临时目录别名差异。 | 否 |
| `test/overlay-update.test.js` — `an updated overlay build replaces the copy the previous one installed` | Overlay 列表拒绝链接目录：`Linked library directories are not allowed.` | 旧 Overlay 管理/安装代码仍存在；Aurora 服务不调用 Overlay 模块，且 Overlay 明确不属于 Aurora 功能范围。 | 否 |
| `test/overlay-update.test.js` — `a current overlay installation survives the replacement check` | 同上，Overlay 列表拒绝链接目录。 | 同上；属于旧 Overlay 路径，不是 Aurora 安装记录或恢复路径。 | 否 |
| `test/overlay-update.test.js` — `another game keeps its overlay when this one is updated` | 同上，Overlay 列表拒绝链接目录。 | 同上；属于旧 Overlay 路径。 | 否 |
| `test/overlay-update.test.js` — `a protected Xbox executable uses the architecture found by the game scanner` | 准备 Overlay 时遇到同一链接目录拒绝错误。 | 旧 Overlay + Xbox 兼容路径；Aurora 第一版不安装 Overlay，也不承诺 Xbox 扫描。 | 否 |
| `test/payload-guidance.test.js` — `from source it still says the thing a developer needs` | macOS 下实际路径以 `/` 拼接，测试要求 Windows 风格的 `C:\src\app\payload`。 | `main.js` 的旧 Swapper payload 缺失提示仍被旧安装 IPC 使用；Aurora 校验用户选择的本地解压包，走独立的包校验路径。 | 否 |
| `test/payload-guidance.test.js` — `without a temp path it still names the folder in a form a person can paste` | `%TEMP%/DLSS5-Swapper` 使用了 macOS 的 `/`，测试要求反斜杠。 | 同一旧 payload 指引；不是 Aurora 发布包定位或 `runtime_sync.ps1` 调用路径。 | 否 |
| `test/release-227.test.js` — `the community page carries its new controls, hidden until the server offers them` | HTML 中缺少旧社区页的 `communityGpuField`。 | 社区页面/发布控件属于旧社区功能；相关代码仍保留，但不在 Aurora 安装主链路。 | 否 |
| `test/shader-compiler.test.js` — `the install retires the stale compiler and Restore gives it back` | `retireOldShaderCompiler()` 返回 `false`，测试期望 `true`。 | `src/core/apply.js` 的旧 Swapper 安装/还原逻辑；Aurora 的 `src/aurora/install.js` 不调用该清理逻辑。 | 否 |

### 解释与后续

- 上述失败均已存在于基线；本轮不删除顶层测试、不跳过测试，也不修改其业务断言来消除红灯。
- 本轮初次复跑还暴露了 `test/library-grouping.test.js` 的 VM 启动夹具没有提供 `process` 和新增的 Aurora service 依赖。已只补足该测试夹具的运行时输入（没有改业务断言）；随后两项通过，旧套件恢复为与基线完全相同的 11 项失败。
- 有几项是 macOS 与 Windows 路径语义不同（profile fixture、payload 路径、`/private/var`），不能把 macOS 的失败直接外推为 Windows 故障；反过来也不能仅凭这一点宣称 Windows 已验证。
- Overlay、社区、旧 Swapper payload/backend/shader 代码仍可能作为遗留功能被主进程或 preload 引用。它们不属于 Aurora 操作服务，但“非 Aurora 路径”不等于“全仓无影响”；这些失败继续由 `test:legacy` 暴露，后续应按各自功能是否仍要支持单独决定修复或移除。
- 本轮 Aurora 回归验证补足了历史写入和安装目标解析；未发现这 11 项失败来自 Aurora 的包校验、文件复制、事务恢复或 Aurora IPC 路径。

## 最终自审补充

- 自审发现，语法有效但路径字段被改动的本地安装记录/事务，可能让 Restore 或崩溃恢复读写游戏目录之外的文件，事务清理也可能递归删除任意路径。
- 已新增 `src/aurora/paths.js`，在安装规划、手动还原、自动回滚和快照清理前校验相对目标、备份根、事务目录及目录内符号链接；启动恢复还会跳过同一游戏目录的路径别名冲突。
- 前一轮新增回归覆盖路径穿越、越界备份读取、游戏目录符号链接、越界快照清理和 Windows 大小写路径别名冲突；当时 `npm test` 为 72 项通过，本次追加恢复回归后为 78 项通过。
- 独立只读审查覆盖了部分路径/事务/安装还原代码，没有确认 Critical 或 Important 问题，但未覆盖完整 diff；不能视为完整独立审查。

## 2026-09-29 最终验收记录

- 环境：macOS（electron-builder 报告 Darwin 24.6.0）、Node.js v24.20.0、Electron 33.4.11、electron-builder 25.1.8。
- `npm test`：72 通过、0 失败。
- `npm run test:legacy`：281 项，268 通过、11 失败、2 跳过；11 项名称与基线相同。
- `git diff --check`：通过。
- 后续服务恢复缺陷修复：脚本阶段显式 Restore 以事务 `nextRecord` 还原；复制阶段显式 Restore 先通过快照回滚，再用 `previousRecord` 完成用户请求。恢复状态不明、持久化失败或正式 Restore 失败时保留事务/记录或正确的重试记录。
- 修复回归：脚本恢复新旧记录不同、脚本 Restore 失败重试、复制快照回滚后继续 Restore、游戏/PowerShell 进程运行或状态未知、恢复提交存储失败、正式 Restore 失败后重试均验证实际临时文件副作用。
- 更新后 `npm test`：78 通过、0 失败；目标服务测试 `node --test test/aurora/service.test.js`：16 通过、0 失败。
- 更新后 `npm run test:legacy`：281 项，268 通过、11 失败、2 跳过；11 个失败名称与执行前基线一致。失败分布包括配置路径、UI 标记、Xbox 路径、Overlay、payload 文案、社区控件和 shader compiler，不能概括为仅社区页/Overlay。
- Windows x64 portable 构建：成功。为保留原有 `dist/Aurora-Swapper-0.1.0-portable.exe`，新包输出到隔离目录：`/Users/tangxuan/Deverloper/workspace/doc/.worktrees/aurora-swapper/dist/aurora-reliability-2026-09-29/Aurora-Swapper-0.1.0-portable.exe`。
- 文件大小：76,025,035 字节（约 73 MiB）。
- SHA-256：`ac12b269d6f9e80fbe3ab60dab41f0e720394fb5cd03b4bcbc7892f6d371f5c4`。
- Mac Electron 冒烟：用临时 `userData` `/tmp/aurora-swapper-smoke.d8j8OD/data` 和假游戏目录启动了应用；由于 Mac 锁屏且无法自动解锁，未能检查窗口、六页、详情/右键反馈或异常提示，因此不计为 UI 验收通过。临时数据未删除。

### Windows 待验收

以下均未在 Windows 上执行；portable 构建成功不等于 Windows 运行或 NSIS 卸载验证成功。

| 项目 | 状态 |
|---|---|
| 初次安装 → Check → Restore，验证参数与逐字节恢复 | 未执行，待 Windows 验收 |
| 已安装后重装复制失败，验证旧安装与长期备份不变 | 未执行，待 Windows 验收 |
| 覆盖原 `dxgi` → 切换 `winmm` → Restore | 未执行，待 Windows 验收 |
| Install 返回非零，验证 incomplete、输出与 Restore | 未执行，待 Windows 验收 |
| Restore 返回非零或缺少关键脚本，验证不删除且记录保留 | 未执行，待 Windows 验收 |
| 复制/脚本阶段中断后重启，验证事务恢复策略 | 未执行，待 Windows 验收 |
| 游戏运行时分别从详情与右键尝试还原 | 未执行，待 Windows 验收 |
| NSIS 卸载再安装，验证同一 userData 记录与备份可继续还原 | 未执行；本轮未构建或运行 NSIS 安装包 |

# Aurora Swapper 可靠性修复执行计划

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Luna 在现有 worktree 内串行执行，不创建新任务或并行修改同一组文件。以复现测试和验收结果为完成依据。

**Goal:** 修复重复安装、代理切换、异常中断、还原入口和卸载时的文件恢复问题，并建立真正覆盖 Aurora 的测试入口。

**Architecture:** 保留 Electron 壳和纯 Node 安装模块。区分“恢复原游戏的长期备份”和“恢复本次操作前状态的事务快照”；主进程负责持久化、进程检查和操作互斥，核心模块通过注入依赖接受测试。

**Tech Stack:** 现有 CommonJS、Node 内置测试、Electron、electron-builder；不引入数据库或新运行时依赖。

**Spec:** 先完整阅读 `docs/superpowers/specs/2026-09-26-aurora-swapper-design.md`，再阅读 `docs/superpowers/plans/2026-09-26-aurora-swapper.md`。旧计划是背景，不要重新执行导入 Swapper 等已完成步骤。本计划是针对六项审查发现的增量修复。

## 工作位置和边界

- 唯一开发目录：`<repo>/.worktrees/aurora-swapper`。
- 分支必须为 `aurora-swapper`。不合并 main，不切换分支，不在主仓库修改代码。
- 本文只是一份方案。此前用户要求“不修改 src/aurora/”；任务 1–4 的实施需要对此作有限例外。用户交付本文并明确要求按本文实施时，执行范围为下列 JS 安装封装及测试，不涉及 Aurora 本体。如果后续指令仍明确禁止修改该目录，则只能执行不依赖这些修改的任务并报告冲突，不能声称六项全部解决。
- 不修改/引入 Aurora C++ 源码，不修改用户提供的发布包和 `runtime_sync.ps1`，不运行 `setup_windows.bat`。
- 仅 Windows 执行 `runtime_sync.ps1` 的 Install / Check / Restore；Mac 使用临时目录与假 runner。
- 保持六页 UI、七种代理、中文默认文案和本地发布包模式，不增加自动下载、社区、Overlay 或其他安装路线。
- 保留现有未提交改动；审查时存在未跟踪 `.DS_Store`，不要提交或删除它。
- 不顺手重构 `src/core/apply.js` 或清理全部上游代码。
- 按任务验证并记录结果。只在用户要求提交时创建本地提交；不 push、不发布。

## 审查基线与完成规则

2026-09-28 在 Mac 上验证：`node --test test/aurora/*.test.js` 为 16 通过；旧 `npm test` 为 281 项、268 通过、11 失败、2 跳过，且不包含 Aurora 子目录。

已在临时目录复现：

1. 安装成功后再次安装，第二个文件复制失败，会删除先前存在的代理 DLL。
2. 游戏原有 dxgi.dll，覆盖安装后切换 winmm.dll，再还原；程序返回成功，但原始 dxgi.dll 未恢复，备份已失去记录引用。

基线是参考，执行者必须重新运行并记录当前结果。不能把 11 项失败统称为社区/Overlay：还包括路径校验、Xbox、payload 文案和 shader compiler。

## Review Focus

- 已安装游戏重装时中途复制失败：字节内容恢复至重装前，首次原始备份不变（任务 1）。
- 旧代理覆盖过游戏原文件、升级包减少文件：不丢失恢复原文件的责任，不删除未知文件（任务 2）。
- 中断发生在复制中、脚本运行中、脚本结束但最终保存前：重启仍能识别并恢复，不显示无依据的安装成功（任务 3）。
- 同一目录的大小写/尾分隔符变化，以及右键还原与详情页并发：命中相同记录、相同锁、相同进程检查（任务 4）。
- 卸载应用后重新安装：记录与备份仍在；损坏 JSON 不被静默清空（任务 3、6、7）。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `src/aurora/copy.js` | 文件计划、长期备份、逐次操作快照、回滚 |
| `src/aurora/install.js` | 安装/还原阶段编排与注入的持久化回调 |
| `src/aurora/store.js` | 原子写入，旧记录兼容，禁止静默丢记录 |
| 新建 `src/aurora/transaction.js` | 快照清单持久化与恢复；不依赖 Electron |
| 新建 `src/aurora/service.js` | 主进程可测试的操作锁、路径查找、exe 解析与入口编排 |
| `main.js`、`preload.js`、`src/renderer/renderer.js` | 连接服务、统一操作入口、恢复提示 |
| `package.json`、`build/installer.nsh` | 测试入口和卸载保留数据 |
| `test/aurora/*.test.js` | 核心回归、故障注入、服务/入口测试 |
| 新建 `scripts/test-aurora.js` | 无 shell glob 的测试文件收集与执行 |
| 新建 `docs/testing/aurora-reliability.md` | 测试范围、旧失败分类、Windows 验收证据 |

## 执行前：确认现场

- [ ] 在指定 worktree 执行 `pwd`、`git branch --show-current`、`git status --short`；读取适用的 AGENTS.md。
- [ ] 阅读上述设计、旧计划和本计划；检查实际函数而非依赖旧行号。
- [ ] 运行 `node --test test/aurora/*.test.js` 和 `npm test`，在验收文档记录平台、Node 版本、失败测试名称与基线。
- [ ] 检查新建文件是否已存在；若有后续实现，复用并验证，不覆盖。

### Task 1: 修复重复安装回滚

**Files:** `src/aurora/copy.js`；新增 `test/aurora/copy-reinstall.test.js`。

**Interfaces:** 保持 `planCopy(input)` 与 `applyCopy(plan, deps)` 的现有调用兼容；为计划增加可序列化的逐次操作快照信息。`applyCopy` 失败返回 `{ok:false,error:'copy-failed',message,rollbackFailed?:true}`。

- [ ] 先写三个失败测试：已有 added 代理重装失败后内容仍是旧 Aurora；已有 replaced 文件重装失败后内容仍是重装前内容；两个场景的长期原始备份字节不变。用显式 files 顺序和现有 failOn 注入，不能依赖目录遍历顺序。
- [ ] 运行 `node --test test/aurora/copy-reinstall.test.js`，确认失败原因是回滚缺陷。
- [ ] 为本次将写入/删除的每个目标，在执行变更前保存存在状态与内容；快照放在 userData 备份目录下的唯一事务目录，不放游戏目录。长期原始备份只在首次覆盖时创建，不能被重装覆盖。
- [ ] 失败按逆序恢复快照；本次新增文件才删除。本次写入开始后即纳入回滚范围，包括复制先写入部分字节再抛错的目标；删除操作也可回滚。
- [ ] 增加“copyFileSync 先破坏目标再抛错”和“回滚自身失败”的测试。回滚失败保留快照，返回明确失败，不清除恢复证据。
- [ ] 运行新测试及 `node --test test/aurora/*.test.js`，全部通过后进入任务 2。

### Task 2: 修复切换代理与记录遗漏

**Files:** `src/aurora/copy.js`、必要的 `src/aurora/install.js`；新增 `test/aurora/proxy-switch.test.js`。

**Interfaces:** `record.files` 继续使用 `{rel,action:'added'|'replaced',backup?}`；旧记录无需破坏性迁移。

- [ ] 写失败测试：原 dxgi.dll 内容为 ORIGINAL，安装 dxgi → 切换 winmm → restore，最终 dxgi 内容为 ORIGINAL、winmm 不存在，返回成功。
- [ ] 写失败测试：旧代理 action 为 added 时切换只移除旧 Aurora；旧代理 action 为 replaced 时切换立即放回原始文件；缺少旧代理备份时在任何写入前返回失败。
- [ ] 写失败测试：新发布包移除了上次安装的 readme.txt，新安装记录仍保留该文件恢复责任，最终还原可删除它或恢复原内容。
- [ ] 运行 `node --test test/aurora/proxy-switch.test.js` 确认失败。
- [ ] 切换旧代理使用“删除 added / 恢复 replaced”操作，并纳入任务 1 回滚。只有该操作成功后，提交的新记录才移除旧代理条目。
- [ ] 合并未被新发布包覆盖的旧记录，按不区分大小写的相对路径去重；保留长期 backup 引用。对未知同名 DLL 仍要求覆盖确认，不扫描后直接删除其他代理名。
- [ ] 增加 dxgi → winmm → dxgi → restore 测试，确认原始备份不会被 Aurora 内容替换；执行全部 Aurora 测试。

备注：“只保留一个代理”指本工具安装的 Aurora 代理。恢复的原生 DLL 不应为了满足数量断言而被删除。

### Task 3: 先持久化再修改，并支持中断恢复

**Files:** `src/aurora/store.js`、`src/aurora/transaction.js`、`src/aurora/copy.js`、`src/aurora/install.js`、`main.js`、必要的 renderer 提示；新增 `test/aurora/transaction.test.js`，扩展 store 测试。

**Interfaces:**

- Store 保留 `packageRoot/records/gameDirs`，增加 `transactions`，旧文件缺此字段时视为空对象。
- 事务：`{id,gameDir,phase,previousRecord,nextRecord,snapshotDir}`，phase 为 `prepared|copying|script-running|needs-recovery`。快照清单必须包含所有目标原先是否存在及快照位置。
- `installGame(input,deps)` 增加可等待的 `deps.checkpoint(transaction)`，生产入口必须提供；现有纯模块测试可提供空回调。此回调抛错时禁止继续到下一修改阶段。
- `recoverTransaction(transaction,deps)`：仅 prepared/copying 自动恢复任务 1 的快照；script-running/needs-recovery 返回需要显式还原的状态，不自动重跑脚本。

- [ ] 先写 store 测试：临时文件写入/rename 失败时旧 store 仍是完整 JSON；损坏 JSON 报错并保留文件，不能返回空 records；旧 store 可读。
- [ ] 实现同目录临时文件写入、文件同步、关闭、rename 替换；清理仅限本次临时文件。无法替换时保留旧文件并报告错误，不能先删旧 store。此操作不宣称完全抵抗所有硬件断电。
- [ ] 写顺序测试：checkpoint(prepared/copying) 成功后才发生首个游戏文件写入；checkpoint(script-running) 成功后才调用 runner。持久化失败不得继续修改。
- [ ] 在修改游戏文件前完成所有必要快照、长期备份并持久化事务清单；执行复制前标 copying，启动脚本前标 script-running。成功时在同一次 store 更新中提交新记录并移除事务，再清理本次快照。
- [ ] Install 非零保留文件与可还原记录、status=incomplete；不能当复制失败回滚。runner 抛错或最终 store 保存失败也保留事务和快照，向 UI 返回需恢复状态。
- [ ] 增加三个模拟重启测试：复制阶段中断恢复旧内容/旧记录；脚本阶段中断保留新文件并允许显式 Restore；脚本成功但最终保存失败不会显示无记录的成功。
- [ ] script-running 中断时，重启将 nextRecord 暴露为 incomplete，保留事务。修复不能将未解决的事务直接标为成功；允许用户调用 Restore。Restore 成功后才清除事务/记录，失败保持不动。不推断或重写 runtime_sync.ps1 的内部状态。
- [ ] 启动恢复只能在对应游戏未运行且无本应用遗留脚本进程占用的情况下执行；不能确认时保留事务，提示关闭游戏/相关脚本后重试，不自动删除。增加假进程检查返回 true/null 的测试。
- [ ] 为复制回滚本身失败和恢复阶段再次失败补测试：证据仍保留，后续可重试。启动若检测到 store 损坏，禁用修改操作并显示实际文件位置，不能初始化空文件覆盖。
- [ ] 运行 `node --test test/aurora/*.test.js`。

限制：本任务恢复的是应用侧文件事务和记录，不承诺 Mac 假 runner 已验证真实 Aurora 脚本的崩溃恢复。真实脚本行为列入 Windows 待验证项。

### Task 4: 统一还原入口、路径身份和操作锁

**Files:** 新 `src/aurora/service.js`、`main.js`、`preload.js`、`src/renderer/renderer.js`；新增 `test/aurora/service.test.js`、`test/aurora/restore-entry.test.js`。

**Interfaces:**

- `gameKey(gameDir, platform=process.platform)`：绝对路径规范化、尾分隔符统一，Windows 不区分大小写；不把 Mac 大小写语义硬改成 Windows。Windows 路径测试使用 path.win32。
- `createAuroraService(deps).run(action,{gameDir,exePath})`：action 为 install/check/restore，由服务统一加锁、查记录、检查进程、执行和更新 store。install 另传 proxy/overwriteConfirmed。
- 同一规范目录已有操作时返回 `{ok:false,error:'operation-in-progress'}`；锁在 finally 释放。

- [ ] 写服务测试：右键没有传 exe 时从游戏库缓存/安装时记录的 exe 获取候选；running=true 时 runner 和文件操作均未调用。
- [ ] 写路径测试：Windows 的大小写、斜杠和尾分隔符变化命中同一个旧记录与同一个锁。读取旧 key 使用规范化比较，保留兼容；如果多个旧 key 冲突，不静默覆盖备份引用，报告需处理。
- [ ] 写并发测试：两个同游戏操作只有一个执行；不同游戏可执行，但最后保存需读取最新 store，两个结果都保留；异常后锁释放。
- [ ] 将主进程三个 Aurora IPC 委托服务，主进程依据已知 exe 验证游戏状态；不能把渲染层 null 当作已关闭。
- [ ] 保持原设计：确实无法确认进程时仍可普通安装/修复/还原，但所有入口必须明确返回并显示“未能确认游戏已关闭。”；任务 3 自动恢复采取更保守策略。明确 running=true 必须阻止。
- [ ] 详情页和右键菜单复用同一渲染层操作函数，显示失败、未确认关闭和恢复提示；右键操作也受 jobRunning 状态约束。保留主进程锁作为最终保障。
- [ ] 用假 window.lab 的行为测试验证右键真正调用统一入口并展示警告；不要只用源码字符串匹配作为验收。
- [ ] 运行全部 Aurora 测试。

### Task 5: 建立可用且透明的测试入口

**Files:** `package.json`、新 `scripts/test-aurora.js`、`docs/testing/aurora-reliability.md`；必要的公共模块回归测试。

- [ ] 保留现有顶层测试文件，不删除、不批量 skip，不修改业务断言来消除失败。
- [ ] 添加 `test:legacy`，保持原 `node --test --test-concurrency=1 test/*.test.js` 的诊断范围；添加 `test:aurora` 使用 Node 收集 `test/aurora` 下全部 .test.js 并传给测试进程，传播非零退出码。默认 `npm test` 执行 `test:aurora`。
- [ ] 默认入口还必须覆盖本轮改动所依赖的公共逻辑：历史写入、安装目录查找、主进程入口和 renderer 入口。可在 Aurora 目录新增针对生产调用的测试；不能仅因测试通过就称覆盖全部公共模块。
- [ ] 在验收文档逐项记录当前 11 个旧失败：测试文件/名称、症状、生产引用是否仍被 Aurora 使用、是否本轮新增。仍在 Aurora 路径上的失败必须定位并提供对应有效回归；不能直接归为废弃功能。若发现需要超出本计划的大改，报告具体阻塞而非掩盖。
- [ ] 执行 `npm test` 验证原 16 个和新增回归均实际运行；故意让测试子进程失败验证脚本退出码传播，再撤销该临时试验。
- [ ] 执行 `npm run test:legacy`，比较基线，记录差异；交付明确说明默认测试范围，不能说“全仓测试全绿”。

### Task 6: 保留卸载后的恢复能力

**Files:** `package.json`、`build/installer.nsh`；新增 `test/aurora/package-config.test.js`。

- [ ] 设置 NSIS `deleteAppDataOnUninstall: false`，保持 appId 和 userData 路径不变，不创建自动清理备份流程。
- [ ] 卸载提示改为：`卸载 Aurora Swapper 不会还原游戏文件。请先在应用内对游戏执行“还原原始文件”。安装记录和备份保存在本机应用数据目录，卸载时将保留；请勿手动删除。` 保留取消卸载和更新时不弹窗的现有行为。
- [ ] 把 NSIS 文件名统一为 `Aurora-Swapper-Setup-${version}.exe`；不顺带开启 Linux 发布或重写构建链。
- [ ] 添加打包配置测试，验证数据保留、appId 不变、portable 命名不回退。人工核对 NSIS 提示不再声称备份在游戏目录。
- [ ] 执行 `npm test`。注意 portable 构建成功不等于验证 NSIS 卸载行为。

### Task 7: 最终验收与交付

- [ ] 在设计文档增加简短“可靠性补充”：先持久化、事务快照、旧代理恢复、统一入口、卸载保留数据。保留产品原有目标与非目标。
- [ ] 执行 `npm test`、`npm run test:legacy`、`git diff --check`；记录真实结果和剩余失败。
- [ ] Mac 打开 Electron 检查六页、详情/右键反馈、记录异常提示。只使用隔离的测试 userData 和假游戏目录，不操作用户真实游戏。
- [ ] 在 Mac 按以下原命令生成 Windows x64 portable；不运行 `npm run build`，它目前含旧 payload prebuild，不在本轮扩大改造：

```bash
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" npx electron-builder --win portable --x64
```

- [ ] 记录产物绝对路径及 SHA-256。构建失败时保留日志并准确说明原因，不用旧包替代本轮产物。
- [ ] 在 Windows 可用时，以隔离假游戏和最小脚本执行下表；没有 Windows 就标“未执行，待 Windows 验收”，不要把 Mac 测试当通过。

| Windows 验收 | 必须观察到的结果 |
| --- | --- |
| 初次安装 → Check → Restore | 参数正确，原文件逐字节恢复，新增文件移除 |
| 已安装后重装复制失败 | 旧安装完整保留，长期备份未改变 |
| 原 dxgi 被覆盖 → winmm → Restore | 原 dxgi 恢复，Aurora winmm 移除 |
| Install 返回非零 | incomplete，可查看输出、可 Restore |
| Restore 返回非零或缺少关键脚本 | 无应用侧删除、记录不丢 |
| 复制/脚本阶段中断后重启 | 识别事务，不无条件重跑脚本或清除记录 |
| 游戏运行时从详情/右键还原 | 两者均拒绝，文件不变 |
| NSIS 卸载再重装（需另构建安装版） | 同一 userData 记录和备份仍在，可继续还原 |

- [ ] 最终报告列出：完成任务、改动文件、测试计数、旧失败分类、构建结果、Windows 已执行/未执行项。未通过 Windows 的部分明确保留为待验收。
- [ ] 不合并 main、不 push、不清除用户数据，不自动发起新任务。

## 给 Luna 的执行提示词

请在 `<repo>/.worktrees/aurora-swapper` 的 `aurora-swapper` 分支，按 `docs/superpowers/plans/2026-09-28-aurora-reliability.md` 依次执行任务 0–7。本次允许为该计划限定的可靠性修复修改 `src/aurora/` 的 JS 安装封装和测试；不要修改 Aurora 本体、发布包或 runtime_sync.ps1。先复现再修复，保持现有未提交改动，不合并 main、不 push。不要重做旧计划的 Swapper 导入。能在 Mac 验证的测试和 portable 打包做完；Windows 条件不具备时列出准确的待验收项，不宣称已经验证。最后汇报各任务、测试结果、剩余失败和产物路径。

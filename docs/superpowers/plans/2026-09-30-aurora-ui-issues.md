# Aurora 界面问题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修好中文界面、空库添加游戏、关于页归属信息，并让首页发布包区与搜索区可折叠，提供没有排序冲突的四种排序。

**Architecture:** 保留现有 Electron 主进程、preload、渲染器和 `aurora-library-model` 边界。界面翻译与折叠状态由渲染器管理；持久排序和通过本程序启动的时间由主进程状态保存；关于页的外链仍通过现有固定目的地白名单打开。

**Tech Stack:** Electron 33、原生 HTML/CSS/JavaScript、Node `node:test`。

**Spec:** `docs/superpowers/specs/2026-09-26-aurora-swapper-design.md`；本计划更新其中“最近操作排序”和“设置里的来源分组”规则，实施时同步修订该设计文档。

## Global Constraints

- 仅在 `/Users/tangxuan/Deverloper/workspace/doc/.worktrees/aurora-swapper` 的 `aurora-swapper` 分支实施；保留现有未提交改动。
- 不修改 `src/aurora/` 的安装核心，不调用 `setup_windows.bat`，不把 Aurora 发布包打入应用。
- 关于页署名 `spikejulia`；原界面来源为 Rakan Alkhaldi 的 DLSS 5 Swapper 2.2.7（MIT），Aurora 本体单列 GPL-3.0 与上游来源。
- 当前工作树没有 Git remote，也没有已确认的 Aurora Swapper 仓库／Release URL。外链配置前必须取得项目地址；未确认时“开发者 GitHub”可指向 `https://github.com/SpikeJulia`，应用“最新版本”入口不指向旧 Swapper 或 Aurora 本体的 Release。
- “最近游玩”只统计通过 Aurora Swapper 成功启动的游戏，不用安装、修复、还原时间冒充游玩时间；未记录的游戏按名称排序。

## Review Focus

1. 中文隐藏游戏弹窗的标题、说明、确认、取消和左上角品牌均为 Aurora 文案；切换语言后立即生效（任务 1）。
2. 空库中间的“添加游戏”直接打开系统目录选择器；取消后库与配置文件均不变化，选中后卡片出现（任务 2）。
3. 发布包从未就绪、无效、损坏转为就绪时折叠默认值正确；收起后状态仍可见，键盘可操作（任务 4）。
4. 最近游玩无时间、同时间、启动失败、启动后重开、旧分组设置迁移时顺序稳定，且不会混入 Aurora 操作历史（任务 5）。
5. 关于页没有跳去原版 Swapper 的“GitHub/最新版”按钮；保留 MIT 和 GPL 的正确归属及用户的圆形二维码（任务 3）。

---

### Task 1：中文文案与遗留设置

**Files:** `src/renderer/i18n.js`、`src/renderer/ask.js`、`src/renderer/renderer.js`、`main.js`、`test/aurora/renderer-i18n.test.js`。

**Interfaces:** 继续使用 `t(key, ...args)`；`ask()` 默认品牌为 `Aurora Swapper`。中文补齐 `hideTitle`、`hideConfirm(name)`、`menuHide`、`setHidden`、`setHiddenNone`、`setUnhide`、`setTray`/`setTrayHint`、`setAutoScan`/`setAutoScanHint` 等实际可见键。技术名与游戏名保留原文。

- [x] 写 `renderer-i18n.test.js`：切到 `zh` 后，隐藏游戏弹窗相关键均返回中文，游戏名完整插入；设置可见键不回退英文；`ask()` 默认品牌为 Aurora Swapper。
- [x] 运行 `node --test test/aurora/renderer-i18n.test.js`，确认新增断言先失败。
- [x] 补齐文案；用现有语言切换刷新路径更新动态设置和弹窗。社区页面已从五页导航删除，设置里的“社区通知”行一并移除，并关闭该版本遗留的后台社区通知轮询，避免开关消失后仍在工作。其余已有设置保持功能。
- [x] 运行定向测试，并在应用里切换中英文检查隐藏弹窗和设置页。

### Task 2：空库添加游戏可用

**Files:** `src/renderer/renderer.js`、`test/aurora/library-entry.test.js`；若现有 UI 测试夹具妨碍验证，仅修正 `scripts/test-game-filters-ui.js` 中与当前 `installOptions()` 返回值不符的夹具断言。

**Interfaces:** 新建 `addSingleGame()` 作为顶部菜单“添加单个游戏”和空状态按钮的共用入口，内部只调用一次 `window.lab.addGame()`，非空结果交给现有 `finishAddedGame(dir)`。顶部的 `addGameMenu` 仍只负责打开菜单。

- [x] 加入空库点击交互回归：点击中间按钮观察系统目录选择器；取消不添加；选择有效目录后只生成一张卡片。
- [x] 跑定向测试／UI 验证，先确认现有空状态按钮只会打开顶部菜单。
- [x] 两处按钮共用 `addSingleGame()`；空状态按钮文案改为“添加单个游戏”，旁边可提供“添加游戏库文件夹”入口，分别调用现有 IPC；异常显示可见反馈。
- [x] 重测空库、已有游戏、筛选无结果三种页面，不让“清除筛选”误打开选目录。

### Task 3：关于页保留原版版式，改成当前项目内容

**Files:** `src/renderer/index.html`、`src/renderer/renderer.js`、`src/renderer/style.css`、`src/renderer/i18n.js`、`src/renderer/i18n-extra.js`、`src/core/project-links.js`、`test/aurora/package-download-ui.test.js`、`test/aurora/renderer-i18n.test.js`、`test/rendering-api.test.js`、`docs/superpowers/specs/2026-09-26-aurora-swapper-design.md`。

**Interfaces:** 原版卡片结构、双按钮、分隔线、支持区域、圆形二维码及页脚布局不变。`projectUrl(key)` 仍只接受固定白名单；项目仓库明确后 `github` 指向本项目，发布页明确后 `releases` 指向本项目发布页；原版 Swapper、Aurora 上游使用不同 key 或正文链接，并准确标注来源。未发布阶段 `releases` 返回 `null`，界面按钮禁用。

- [x] 更新外链测试：`github`／`releases` 不再是 `rakanki911/DLSS5-Swapper`；原版仓库和 Aurora 上游各有正确来源标识，未知 key 被拒绝。
- [x] 运行定向测试，先复现旧链接断言，再确认更新后的测试通过。
- [x] 将标题和说明改为“Aurora Swapper：为游戏安装、修复和还原 OptiScaler Aurora”；当前开发者署名 `spikejulia`。另列“基于 DLSS 5 Swapper 2.2.7（Rakan Alkhaldi，MIT）”和“使用 OptiScaler Aurora（GPL-3.0）”，说明 Aurora 发布包由用户选择或下载，不随应用分发。保留现有赞赏二维码。
- [x] 应用仓库和 Release 尚未明确公开，GitHub 入口标为“开发者 GitHub”并指向 `https://github.com/spikejulia`，最新版按钮显示“尚未发布”且不可点击。未把原版 Swapper 或 Aurora 运行库的 Release 伪装成本应用最新版。
- [x] 检查中英文、深浅色、最小窗口宽度排版；二维码缩略图可点开大图并可关闭，手机可扫描。

### Task 4：发布包与搜索区折叠

**Files:** `src/renderer/index.html`、`src/renderer/renderer.js`、`src/renderer/style.css`、`src/renderer/i18n.js`、`test/aurora/library-entry.test.js`。

**Interfaces:** 发布包区分离 `packageSummary` 和 `packageDetails`；按钮用 `aria-expanded`、`aria-controls`，状态文字始终可见。搜索区分离 `libraryToolsToggle` 和 `libraryToolsBody`；状态筛选标签、计数和游戏卡片在折叠时保持可见。

- [x] 测试默认规则：未指定、无效、记录损坏均默认展开；就绪默认收起，用户可手动展开／收起；状态变化时重新套用默认值。搜索排序区默认展开，可独立折叠。
- [x] 运行定向测试确认现状没有上述按钮及状态规则。
- [x] 加折叠标题行和 chevron，按钮都可用 Enter／Space 操作；发布包收起时仍显示“就绪／未就绪”和当前目录摘要。搜索区收起时若有搜索／高级筛选条件，标题标记“筛选已启用”，避免看不到隐藏条件却以为游戏丢失。
- [x] 窄屏检验折叠后的操作不挡住卡片；重新扫描、添加游戏、状态筛选不随折叠隐藏。

### Task 5：四种排序与“最近游玩”数据

**Files:** `src/renderer/index.html`、`src/renderer/renderer.js`、`src/renderer/aurora-library-model.js`、`src/renderer/i18n.js`、`main.js`、`preload.js`、`test/aurora/library-model.test.js`、`test/aurora/library-entry.test.js`、`docs/superpowers/specs/2026-09-26-aurora-swapper-design.md`。

**Interfaces:** 排序值固定为 `played`、`store`、`name-asc`、`name-desc`。主进程状态保存 `librarySort` 与 `lastLaunchedAt[keyFor(gameDir)]`；`boot()` 返回这两项，`set-library-sort` IPC 只接受四个值，preload 暴露 `setLibrarySort(sort)`。现有 `launch` IPC 成功仍返回 `null`，成功启动后主进程写入时间、渲染器同步内存中的时间并重绘列表；重启时以 `boot()` 的持久记录为准。库模型用只读的 `lastLaunchedAt` 作纯函数排序，时间必须是有效正数。`store` 模式按既有来源顺序分段、各段名称 A–Z；其余模式全库平铺。

- [x] 写模型测试：最近游玩按成功启动时间倒序、无记录按名称兜底、同时间稳定；分组按既有来源顺序，组内按名称 A–Z；A–Z 与 Z–A 跨全库排序；操作历史不影响游玩顺序。
- [x] 跑 `node --test test/aurora/library-model.test.js`，确认新增测试先失败。
- [x] 实现数据保存和四种排序。游戏可能在 Steam 等应用里直接启动，本版不统计那部分；界面在“最近游玩”旁写明“仅记录通过本程序启动”。启动失败、取消、仅打开详情或运行安装／修复时不更新游玩时间。
- [x] 删除设置页“按商店分组”开关：首页 `store` 排序是唯一分组控制。升级旧配置时若尚无 `librarySort`，`groupGamesByStore !== false` 映射为 `store`，否则映射为 `name-asc`；之后只写新键。其他三种排序均为全库平铺，切换后不再被旧分组开关覆盖。
- [x] 验证重启后排序和成功启动时间保留；语言切换、筛选、包区折叠不重置排序。

### Task 6：整体验收与打包

**Files:** 无额外功能文件；仅修正本计划引起的测试夹具或文档差异。

- [x] 运行 `npm test`（132/132）、新增定向测试（40/40）、相关 `node --check` 与 `git diff --check`；旧的可选 `test:ui` 在排序流程前因仍断言已移除的 Feeder/native 路由而失败，已单独记录，不并入本次回归。
- [x] 在 Mac Electron 窗口验证中英文设置、空库、折叠及排序；空库添加游戏和关于页的视觉／交互检查见 Task 2、Task 3 记录。Windows 文件选择器、真实游戏启动与便携包运行留给 Windows 实机复核。
- [x] 用 `ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" npx electron-builder --win portable --x64` 重新打包（exit 0）；检查 `dist/Aurora-Swapper-0.1.0-portable.exe` 为 Windows PE portable 自解压程序，并确认 ASAR 包含四种排序、游玩提示、启动记录逻辑及圆形赞赏码资源。
- [x] 汇报改动、测试数量、Windows 待验项、安装包路径与 GitHub／Release 链接当前指向；仓库无 git remote，About 的开发者链接指向 `https://github.com/spikejulia`，应用 Release 尚未发布，入口保持禁用。

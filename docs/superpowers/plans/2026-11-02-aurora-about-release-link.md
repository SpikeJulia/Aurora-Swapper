# 关于页发布链接与上游更新检查（2026-11-02）

## 起因

v0.1.0 发布后，软件"关于"页第二个按钮仍写着"尚未发布"，与仓库已经公开 v0.1.0 的事实矛盾。

查证：`src/core/project-links.js` 的 `releases` 槽为 `null`，`src/renderer/index.html` 里是一个 `disabled` 的按钮，文案写死"尚未发布"。这是设计阶段的占位——`docs/superpowers/plans/2026-09-30-aurora-ui-issues.md:57` 写明"发布页明确后 `releases` 指向本项目发布页……未发布阶段 `releases` 返回 `null`，界面按钮禁用"。发布页已经明确，占位应当撤除。

## 决定

- 按钮文案用固定的"下载与更新"（用户拍板），永远指向 `releases/latest`，不写版本号，避免发新版后文案过期说谎。
- 按钮从禁用 `<button>` 改为 `<a data-project="releases">`，走既有的 `open-project` 白名单通道，不新增打开路径。
- 关于页两个按钮的品牌色从上游绿 `#4eaf00`／`#9bdd54` 改为品牌紫 `var(--accent)`（暗色主题 `#c56bff`）。
- `main.js` 的 `update-check` 原先查上游 `rakanki911/DLSS5-Swapper` 的 Release，改为查本项目 `SpikeJulia/Aurora-Swapper`。该 handler 目前没有调用点（`showUpdateNotice()` 未被调用，依赖的 `#statusUpdate` 元素也不存在），所以此前没人看到误报；改掉是为了不让它成为定时炸弹。
- 版本 0.1.0 → 0.1.1。

## 改动清单

| 文件 | 改动 |
| --- | --- |
| `src/core/project-links.js` | `releases` 由 `null` 改为本项目发布页 URL |
| `src/renderer/index.html` | 禁用按钮 → 可点链接，文案键改 `aboutDownloads` |
| `src/renderer/i18n.js` | `aboutUnreleased` → `aboutDownloads`（en: Download & updates／zh: 下载与更新） |
| `src/renderer/style.css` | `.about-link` 改品牌紫，删除 `.about-link-disabled:disabled` 死规则 |
| `main.js` | `update-check` 改查本项目仓库，User-Agent 改 `Aurora-Swapper/` |
| `package.json`／`package-lock.json` | 版本 0.1.0 → 0.1.1 |
| `test/rendering-api.test.js` | 断言 `projectUrl('releases')` 等于新 URL |
| `test/aurora/package-download-ui.test.js` | 断言关于页含 releases 链接、不含旧占位文案；i18n 键改 `aboutDownloads` |
| `test/update-check.test.js` | 新增：更新检查必须查本项目仓库，不得出现 rakanki911 |
| `test/api-override-ipc.test.js` | `open-project('releases')` 由 false 改为 true 并校验 URL |

## 验证

- `npm test`：169 passed / 0 failed。
- `npm run test:legacy`：284 tests，271 pass，11 fail，2 skip。失败清单与改动前基线（283／270／11／2）逐条一致，无新增失败。
- CDP 实机核验：关于页两个按钮均为 `<a>`，computed color `rgb(161, 0, 227)`，第二个指向 `https://github.com/SpikeJulia/Aurora-Swapper/releases/latest`。

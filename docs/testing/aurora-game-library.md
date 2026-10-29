# Aurora 游戏库验收记录

更新日期：2026-09-30

## 已实现范围

- 首页与游戏页合并为默认的“游戏库”，侧栏保留游戏库、插件、历史、设置、关于五页。
- 游戏库使用纯展示模型读取游戏目录、Aurora 记录和操作历史；`incomplete` 优先于 `installed`，未知记录和损坏记录不会伪装成未安装。
- 未知 Aurora 记录状态会显示为“状态待确认”，并在详情页禁用安装、修复和还原，避免 renderer 猜测记录含义。
- 支持状态筛选、名称/目录搜索、最近操作/名称排序、API、DLSS 和插件筛选，并区分空库与无匹配结果。
- 添加单个游戏、添加文件夹和拖入目录复用现有 IPC；重复目录不会生成重复卡片，筛选隐藏的新游戏会显示“查看此游戏”。
- 发布包状态条与设置页共用选择逻辑；取消选择不改变配置，无效包保留校验原因，记录损坏时禁用选择和修改。
- 操作成功或失败后都刷新实际 Aurora 状态；刷新使用递增请求编号，旧响应不能覆盖新状态。
- 历史页承载持久操作历史和本次运行日志；清空日志不删除持久历史。

## 自动验证

工作目录：`/Users/tangxuan/Deverloper/workspace/doc/.worktrees/aurora-swapper`

| 命令 | 结果 |
|---|---|
| `node --test test/aurora/library-model.test.js test/aurora/library-entry.test.js` | 17 通过、0 失败 |
| `npm test` | 96 通过、0 失败 |
| `node --check src/renderer/renderer.js` | 通过 |
| `node --check main.js` | 通过 |
| `git diff --check` | 通过 |

纯模型回归覆盖目录边界、Windows 别名、重复记录、安装未完成优先级、损坏 store、历史排序、状态筛选、添加去重和发布包能力矩阵。

## Windows portable 构建

- 命令：`ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" npx electron-builder --win portable --x64`
- 产物：`/Users/tangxuan/Deverloper/workspace/doc/.worktrees/aurora-swapper/dist/Aurora-Swapper-0.1.0-portable.exe`
- 大小：76,027,651 bytes；SHA-256：`bca0c03001d43d808b666afdb500a88b9a9ea208988f4d3f503e6c23798d7ad3`
- 只确认构建成功；尚未在 Windows 上启动该产物或走安装/修复/还原流程。

## 已执行的 Mac Electron 冒烟

- 在开发 worktree 运行 `npm start`，确认窗口标题为 `Aurora Swapper`，默认打开合并后的“游戏库”页面。
- 截图确认五项侧栏、Aurora 发布包状态条、搜索、排序、更多筛选、四个状态计数和空库引导均已渲染。
- 当前 CUA 点击通道在切换页面时返回 `noWindowsAvailable`，因此历史页/设置页的点击路径未计为通过；不把这次截图当作完整手工验收。

## 设计演示

实现前的静态交互演示仍保留在：

- `docs/prototypes/aurora-game-library.html`
- `docs/prototypes/aurora-game-library-preview.png`

演示只使用示例数据，不替代 Electron 游戏目录和 Windows Aurora 操作验收。

## 尚未执行的人工验收

- 1280×800、1024×768、760px 窗口下的实际 Electron 布局检查（本次截图未覆盖这些尺寸）。
- 隔离 `userData` 下的取消选择、无效发布包、损坏记录、拖入文件而非目录提示。
- Windows x64 假游戏目录：添加 → 安装 → 刷新状态 → 修复 → 还原。
- Windows 上的脚本退出失败、安装未完成恢复、游戏运行中阻止操作和右键还原。
- Windows portable 包启动、首次运行和卸载后保留 userData 的检查。

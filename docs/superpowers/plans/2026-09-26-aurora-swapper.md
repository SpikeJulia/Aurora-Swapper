# Aurora Swapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows Electron app, developed on Mac, that installs, repairs, and restores a user-supplied OptiScaler Aurora package from a Swapper-style library.

**Architecture:** Pure Node modules under `src/aurora/` decide package validity, file copies, proxy rename, and PowerShell arguments. They never spawn PowerShell themselves. After those modules pass `node --test` on Mac, DLSS5-Swapper v2.2.7 is copied in as the Electron shell. New IPC handlers call the modules. The game sheet's old Feeder/ReShade picker is replaced by Aurora controls. `src/core/apply.js` is not modified.

**Tech Stack:** Node.js built-in test runner, Electron 33 (from Swapper 2.2.7), existing Swapper renderer.

## Global Constraints

- Product display name is `Aurora Swapper`. `appId` is `local.aurora.swapper`. Do not keep `com.rakan.dlss5swapper`.
- Start from DLSS5-Swapper tag `v2.2.7`, commit `3b3b0efb5472df7fc806d7aff31c1d95819500c5`. Keep its MIT license and the credit to Rakan Alkhaldi.
- Do not vendor Aurora source, the Aurora `.7z`, or any `nvngx` DLL.
- Do not run `setup_windows.bat`.
- PowerShell runs only when `process.platform === 'win32'`.
- Sidebar keeps Home, Games, Add-ons, History, Settings, About. Remove Chat, Community, and Overlay.
- No Feeder, RenoDX, Multipass, emulator install, or dgVoodoo path is offered in the UI.
- No Epic, GOG, Xbox, or full-disk scan is added.
- Default UI language code is `zh`. New copy is Chinese. Do not translate the other 36 languages.
- Install target is the directory of the selected game exe, not the Steam library root.
- One proxy DLL per game: `dxgi.dll`, `winmm.dll`, `version.dll`, `dbghelp.dll`, `d3d12.dll`, `wininet.dll`, `winhttp.dll`.
- A package is valid only when it is an extracted directory containing `OptiScaler.dll` and `runtime_sync.ps1` and not containing `OptiScaler.sln`.
- Records and backups live in Electron `userData`, never inside the game directory.
- If `runtime_sync.ps1` is missing while `OptiScaler/RuntimeSync` exists, restore deletes nothing.
- A failed addon copy does not roll back a successful Aurora install.

---

### Task 1: Package validation

**Files:**
- Create: `src/aurora/package.js`
- Test: `test/aurora/package.test.js`

**Interfaces:**
- Consumes: Node `fs`, `path`
- Produces: `validatePackage(root) -> { ok: true, root, dllName: 'OptiScaler.dll', scriptName: 'runtime_sync.ps1' } | { ok: false, reason: 'not-directory' | 'archive' | 'source-tree' | 'missing-dll' | 'missing-script' }`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validatePackage } = require('../../src/aurora/package');

function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-pkg-'));
}

test('accepts an extracted release directory', () => {
  const root = temp();
  fs.writeFileSync(path.join(root, 'OptiScaler.dll'), 'dll');
  fs.writeFileSync(path.join(root, 'runtime_sync.ps1'), 'ps1');
  assert.deepEqual(validatePackage(root), {
    ok: true, root, dllName: 'OptiScaler.dll', scriptName: 'runtime_sync.ps1'
  });
});

test('rejects a 7z path, a source tree, and a directory missing either file', () => {
  const root = temp();
  const archive = path.join(root, 'OptiScaler_Aurora.7z');
  fs.writeFileSync(archive, '7z');
  assert.equal(validatePackage(archive).reason, 'archive');
  fs.writeFileSync(path.join(root, 'OptiScaler.sln'), 'sln');
  fs.writeFileSync(path.join(root, 'OptiScaler.dll'), 'dll');
  fs.writeFileSync(path.join(root, 'runtime_sync.ps1'), 'ps1');
  assert.equal(validatePackage(root).reason, 'source-tree');
  fs.rmSync(path.join(root, 'OptiScaler.sln'));
  fs.rmSync(path.join(root, 'runtime_sync.ps1'));
  assert.equal(validatePackage(root).reason, 'missing-script');
  assert.equal(validatePackage(path.join(root, 'missing')).reason, 'not-directory');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/aurora/package.test.js`

Expected: FAIL with `Cannot find module '../../src/aurora/package'`

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';
const fs = require('fs');
const path = require('path');

function validatePackage(root) {
  if (typeof root !== 'string' || root === '') return { ok: false, reason: 'not-directory' };
  if (root.toLowerCase().endsWith('.7z')) return { ok: false, reason: 'archive' };
  let stat;
  try { stat = fs.statSync(root); } catch { return { ok: false, reason: 'not-directory' }; }
  if (!stat.isDirectory()) return { ok: false, reason: 'not-directory' };
  if (fs.existsSync(path.join(root, 'OptiScaler.sln'))) return { ok: false, reason: 'source-tree' };
  if (!fs.existsSync(path.join(root, 'OptiScaler.dll'))) return { ok: false, reason: 'missing-dll' };
  if (!fs.existsSync(path.join(root, 'runtime_sync.ps1'))) return { ok: false, reason: 'missing-script' };
  return { ok: true, root, dllName: 'OptiScaler.dll', scriptName: 'runtime_sync.ps1' };
}

module.exports = { validatePackage };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/aurora/package.test.js`

Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/aurora/package.js test/aurora/package.test.js
git commit -m "Add Aurora package validation."
```

### Task 2: Known-game presets

**Files:**
- Create: `src/aurora/games.js`
- Test: `test/aurora/games.test.js`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces: `matchKnownGame({ dirName, exeName }) -> { id, proxy, note } | null`
- Produces: `PROXY_FILES` array of the seven DLL names, in the spec order
- `proxy` is one of `PROXY_FILES`. Unknown games return `null`. The caller uses `dxgi.dll` when the result is `null`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchKnownGame, PROXY_FILES } = require('../../src/aurora/games');

test('matches the four tested games from either folder or exe name', () => {
  assert.equal(matchKnownGame({ dirName: 'Neverness to Everness', exeName: 'game.exe' }).proxy, 'winmm.dll');
  assert.equal(matchKnownGame({ dirName: 'bin', exeName: '异环.exe' }).id, 'neverness');
  assert.match(matchKnownGame({ dirName: 'The Witcher 3', exeName: 'witcher3.exe' }).note, /OptiFG/);
  assert.equal(matchKnownGame({ dirName: 'Onimusha', exeName: 'a.exe' }).proxy, 'dxgi.dll');
  assert.equal(matchKnownGame({ dirName: 'Blood of Dawnwalker', exeName: 'a.exe' }).id, 'dawnwalker');
  assert.equal(matchKnownGame({ dirName: '黎明行者之血', exeName: 'a.exe' }).id, 'dawnwalker');
});

test('returns null for an unknown game and lists only the seven proxies', () => {
  assert.equal(matchKnownGame({ dirName: 'Hades', exeName: 'Hades.exe' }), null);
  assert.deepEqual(PROXY_FILES, [
    'dxgi.dll', 'winmm.dll', 'version.dll', 'dbghelp.dll', 'd3d12.dll', 'wininet.dll', 'winhttp.dll'
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/aurora/games.test.js`

Expected: FAIL with `Cannot find module '../../src/aurora/games'`

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';

const PROXY_FILES = [
  'dxgi.dll', 'winmm.dll', 'version.dll', 'dbghelp.dll', 'd3d12.dll', 'wininet.dll', 'winhttp.dll'
];

const KNOWN = [
  {
    id: 'neverness',
    names: ['neverness to everness', '异环'],
    proxy: 'winmm.dll',
    note: 'dxgi.dll 可能被报非法模块。Run inside the upscaler 不建议开。'
  },
  {
    id: 'onimusha',
    names: ['onimusha', '鬼武者'],
    proxy: 'dxgi.dll',
    note: 'Run inside the upscaler 会花屏，保持关。'
  },
  {
    id: 'witcher3',
    names: ['the witcher 3', 'witcher3', '巫师3', '巫师 3'],
    proxy: 'dxgi.dll',
    note: '游戏内超分选 DLSS，关掉原生帧生成。进游戏后按 Insert：FG Input = OptiFG (Upscaler)，FG Output = DLSSG，FG Nvngx Replacement = None (Real DLSSG)。保存后完全退出再开，进场景后再开 DLSSG，选 2X–6X。'
  },
  {
    id: 'dawnwalker',
    names: ['blood of dawnwalker', 'dawnwalker', '黎明行者之血'],
    proxy: 'dxgi.dll',
    note: 'DLSS 5 和 6X 可以同时开。'
  }
];

function matchKnownGame({ dirName = '', exeName = '' } = {}) {
  const hay = `${dirName}\n${exeName}`.toLowerCase();
  const found = KNOWN.find(game => game.names.some(name => hay.includes(name.toLowerCase())));
  if (!found) return null;
  return { id: found.id, proxy: found.proxy, note: found.note };
}

module.exports = { matchKnownGame, PROXY_FILES };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/aurora/games.test.js`

Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/aurora/games.js test/aurora/games.test.js
git commit -m "Add known-game Aurora presets."
```

### Task 3: Copy plan, proxy rename, and rollback

**Files:**
- Create: `src/aurora/copy.js`
- Test: `test/aurora/copy.test.js`

**Interfaces:**
- Consumes: `PROXY_FILES` from `src/aurora/games.js`
- Produces: `planCopy({ packageRoot, gameDir, files, proxy, record, overwriteConfirmed })`
- Produces: `applyCopy(plan, fsAdapters)` where `fsAdapters` is Node `fs` plus `path`
- `files` is an array of paths relative to `packageRoot`, using `/`
- `record` is `{ proxy: string|null, files: [{ rel, action: 'added'|'replaced' }] } | null`
- Return of `planCopy`: `{ ok: false, error: 'bad-proxy' | 'proxy-exists' } | { ok: true, operations, nextRecord }`
- `operations` items: `{ op: 'backup', rel, from, to }`, `{ op: 'write', rel, from, to }`, `{ op: 'delete', rel }`
- `OptiScaler.dll` is written as the chosen proxy name, not as `OptiScaler.dll`
- `OptiScaler.sln` is skipped
- A previous recorded proxy different from the new one becomes a `delete` operation
- An existing target proxy not listed in `record.files` yields `proxy-exists` unless `overwriteConfirmed === true`

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planCopy, applyCopy } = require('../../src/aurora/copy');

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-copy-')); }

test('writes the dll under the proxy name and can roll back a failed copy', () => {
  const pkg = dir();
  const game = dir();
  const backup = dir();
  fs.writeFileSync(path.join(pkg, 'OptiScaler.dll'), 'DLL');
  fs.writeFileSync(path.join(pkg, 'runtime_sync.ps1'), 'PS');
  fs.writeFileSync(path.join(pkg, 'OptiScaler.sln'), 'NO');
  const plan = planCopy({
    packageRoot: pkg,
    gameDir: game,
    backupDir: backup,
    files: ['OptiScaler.dll', 'runtime_sync.ps1', 'OptiScaler.sln'],
    proxy: 'winmm.dll',
    record: null,
    overwriteConfirmed: false
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.nextRecord.proxy, 'winmm.dll');
  assert.deepEqual(plan.nextRecord.files.map(file => file.rel).sort(), ['runtime_sync.ps1', 'winmm.dll']);
  const result = applyCopy(plan, { fs, path, failOn: 'runtime_sync.ps1' });
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(game, 'winmm.dll')), false);
  assert.equal(fs.existsSync(path.join(game, 'OptiScaler.sln')), false);
});

test('refuses an unrecorded existing proxy and deletes only the recorded old proxy', () => {
  const pkg = dir();
  const game = dir();
  fs.writeFileSync(path.join(pkg, 'OptiScaler.dll'), 'DLL');
  fs.writeFileSync(path.join(game, 'dxgi.dll'), 'ORIGINAL');
  const blocked = planCopy({
    packageRoot: pkg, gameDir: game, backupDir: dir(),
    files: ['OptiScaler.dll'], proxy: 'dxgi.dll', record: null, overwriteConfirmed: false
  });
  assert.equal(blocked.error, 'proxy-exists');
  fs.writeFileSync(path.join(game, 'winmm.dll'), 'OLD-AURORA');
  const plan = planCopy({
    packageRoot: pkg, gameDir: game, backupDir: dir(),
    files: ['OptiScaler.dll'], proxy: 'dxgi.dll', overwriteConfirmed: true,
    record: { proxy: 'winmm.dll', files: [{ rel: 'winmm.dll', action: 'added' }] }
  });
  applyCopy(plan, { fs, path });
  assert.equal(fs.readFileSync(path.join(game, 'dxgi.dll'), 'utf8'), 'DLL');
  assert.equal(fs.existsSync(path.join(game, 'winmm.dll')), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/aurora/copy.test.js`

Expected: FAIL with `Cannot find module '../../src/aurora/copy'`

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';
const path = require('path');
const { PROXY_FILES } = require('./games');

function relPosix(value) { return value.split(path.sep).join('/'); }

function planCopy({ packageRoot, gameDir, backupDir, files, proxy, record, overwriteConfirmed }) {
  if (!PROXY_FILES.includes(proxy)) return { ok: false, error: 'bad-proxy' };
  const recorded = new Set((record?.files || []).map(file => file.rel.toLowerCase()));
  const targetRel = proxy;
  const targetAbs = path.join(gameDir, proxy);
  const targetIsRecorded = recorded.has(proxy.toLowerCase());
  if (require('fs').existsSync(targetAbs) && !targetIsRecorded && overwriteConfirmed !== true) {
    return { ok: false, error: 'proxy-exists' };
  }
  const operations = [];
  const nextFiles = [];
  for (const file of files) {
    const rel = relPosix(file);
    if (rel.toLowerCase() === 'optiscaler.sln') continue;
    const from = path.join(packageRoot, file);
    const destRel = rel.toLowerCase() === 'optiscaler.dll' ? targetRel : rel;
    const dest = path.join(gameDir, destRel);
    if (require('fs').existsSync(dest)) {
      operations.push({ op: 'backup', rel: destRel, from: dest, to: path.join(backupDir, destRel) });
      nextFiles.push({ rel: destRel, action: 'replaced' });
    } else {
      nextFiles.push({ rel: destRel, action: 'added' });
    }
    operations.push({ op: 'write', rel: destRel, from, to: dest });
  }
  if (record?.proxy && record.proxy.toLowerCase() !== proxy.toLowerCase()) {
    operations.push({ op: 'delete', rel: record.proxy, to: path.join(gameDir, record.proxy) });
  }
  return {
    ok: true,
    operations,
    nextRecord: { proxy, files: nextFiles }
  };
}

function applyCopy(plan, { fs, path: nodePath, failOn = null }) {
  const done = [];
  try {
    for (const op of plan.operations) {
      if (op.op === 'backup') {
        fs.mkdirSync(nodePath.dirname(op.to), { recursive: true });
        fs.copyFileSync(op.from, op.to);
      } else if (op.op === 'write') {
        if (failOn && op.rel === failOn) throw new Error('forced failure');
        fs.mkdirSync(nodePath.dirname(op.to), { recursive: true });
        fs.copyFileSync(op.from, op.to);
      } else if (op.op === 'delete') {
        if (fs.existsSync(op.to)) fs.rmSync(op.to);
      }
      done.push(op);
    }
    return { ok: true };
  } catch (error) {
    for (const op of done.reverse()) {
      if (op.op === 'write') {
        const backup = plan.operations.find(item => item.op === 'backup' && item.rel === op.rel);
        if (backup && fs.existsSync(backup.to)) fs.copyFileSync(backup.to, op.to);
        else fs.rmSync(op.to, { force: true });
      }
    }
    return { ok: false, error: 'copy-failed', message: error.message };
  }
}

module.exports = { planCopy, applyCopy };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/aurora/copy.test.js`

Expected: PASS, 2 tests. If delete removes the wrong file, fix only the `to` path as specified in Step 3 and rerun.

- [ ] **Step 5: Commit**

```bash
git add src/aurora/copy.js test/aurora/copy.test.js
git commit -m "Plan Aurora file copy, proxy rename, and rollback."
```

### Task 4: PowerShell arguments and restore decision

**Files:**
- Create: `src/aurora/script.js`
- Test: `test/aurora/script.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `powershellCommand(scriptPath, mode, installDir) -> { file: 'powershell', args: string[] }`
- Produces: `restoreDecision({ scriptExists, runtimeSyncExists, exitCode }) -> 'stop' | 'delete-recorded'`
- `mode` must be `Install`, `Check`, or `Restore`. Anything else throws `bad-mode`.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { powershellCommand, restoreDecision } = require('../../src/aurora/script');

test('builds the three Aurora modes', () => {
  const command = powershellCommand('C:/game/runtime_sync.ps1', 'Check', 'C:/game');
  assert.deepEqual(command, {
    file: 'powershell',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:/game/runtime_sync.ps1', '-Mode', 'Check', '-InstallDir', 'C:/game']
  });
  assert.equal(powershellCommand('a', 'Install', 'b').args[6], 'Install');
  assert.equal(powershellCommand('a', 'Restore', 'b').args[6], 'Restore');
  assert.throws(() => powershellCommand('a', 'Remove', 'b'), /bad-mode/);
});

test('restore deletes recorded files only after a clean script result', () => {
  assert.equal(restoreDecision({ scriptExists: true, runtimeSyncExists: true, exitCode: 1 }), 'stop');
  assert.equal(restoreDecision({ scriptExists: false, runtimeSyncExists: true, exitCode: null }), 'stop');
  assert.equal(restoreDecision({ scriptExists: true, runtimeSyncExists: true, exitCode: 0 }), 'delete-recorded');
  assert.equal(restoreDecision({ scriptExists: false, runtimeSyncExists: false, exitCode: null }), 'delete-recorded');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/aurora/script.test.js`

Expected: FAIL with `Cannot find module '../../src/aurora/script'`

- [ ] **Step 3: Write minimal implementation**

```js
'use strict';
const MODES = new Set(['Install', 'Check', 'Restore']);

function powershellCommand(scriptPath, mode, installDir) {
  if (!MODES.has(mode)) throw new Error('bad-mode');
  return {
    file: 'powershell',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Mode', mode, '-InstallDir', installDir]
  };
}

function restoreDecision({ scriptExists, runtimeSyncExists, exitCode }) {
  if (scriptExists && exitCode !== 0) return 'stop';
  if (!scriptExists && runtimeSyncExists) return 'stop';
  return 'delete-recorded';
}

module.exports = { powershellCommand, restoreDecision };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/aurora/script.test.js`

Expected: PASS, 2 tests

- [ ] **Step 5: Commit**

```bash
git add src/aurora/script.js test/aurora/script.test.js
git commit -m "Describe Aurora PowerShell modes and restore stops."
```

### Task 5: Install, check, and restore orchestration

**Files:**
- Create: `src/aurora/install.js`
- Test: `test/aurora/install.test.js`

**Interfaces:**
- Consumes: `validatePackage`, `planCopy`, `applyCopy`, `powershellCommand`, `restoreDecision`
- Produces: `installGame(input, deps)`, `checkGame(input, deps)`, `restoreGame(input, deps)`
- `deps.runner(command) -> Promise<{ code: number, stdout: string, stderr: string }>`
- `deps` also receives Node `fs` and `path`
- `input` fields: `{ packageRoot, gameDir, proxy, record, overwriteConfirmed, addons, gameRunning, backupDir }`
- `addons` is `[{ name, files: [{ rel, from }] }]`
- On Windows the caller passes a real runner. Tests pass a fake runner. This module never checks `process.platform` and never calls `child_process`.
- `gameRunning === true` returns `{ ok: false, error: 'game-running' }` and writes nothing.
- `gameRunning === null` is allowed and sets `unconfirmedClose: true` on success.
- Check and restore require `record` to be non-null. Otherwise `{ ok: false, error: 'not-installed' }`.
- Addon filename collision with a file in `nextRecord.files` skips that addon, sets `addonFailure` to the addon name, and still returns `ok: true, status: 'installed'`.
- Script exit code non-zero on install returns `{ ok: false, error: 'script-failed', status: 'incomplete', record: nextRecord }` and does not copy addons.
- Restore `stop` returns `{ ok: false, error: 'restore-blocked', record }` and leaves recorded files on disk.

- [ ] **Step 1: Write the failing test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installGame, checkGame, restoreGame } = require('../../src/aurora/install');

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-install-')); }

function fixture() {
  const packageRoot = dir();
  const gameDir = dir();
  const backupDir = dir();
  fs.writeFileSync(path.join(packageRoot, 'OptiScaler.dll'), 'DLL');
  fs.writeFileSync(path.join(packageRoot, 'runtime_sync.ps1'), 'echo ok');
  fs.writeFileSync(path.join(packageRoot, 'readme.txt'), 'hi');
  return { packageRoot, gameDir, backupDir };
}

test('install copies, renames, and requests Install mode', async () => {
  const fx = fixture();
  const calls = [];
  const result = await installGame({ ...fx, proxy: 'dxgi.dll', record: null, overwriteConfirmed: false, addons: [], gameRunning: false }, {
    fs, path, runner: async (command) => { calls.push(command); return { code: 0, stdout: '', stderr: '' }; }
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'installed');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'dxgi.dll')), true);
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'OptiScaler.dll')), false);
  assert.equal(calls[0].args[6], 'Install');
  assert.equal(calls[0].args[8], fx.gameDir);
});

test('a running game and a failed script do not copy addons', async () => {
  const fx = fixture();
  const running = await installGame({ ...fx, proxy: 'dxgi.dll', record: null, overwriteConfirmed: false, addons: [], gameRunning: true }, { fs, path, runner: async () => { throw new Error('no'); } });
  assert.equal(running.error, 'game-running');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'dxgi.dll')), false);
  const addon = dir();
  fs.writeFileSync(path.join(addon, 'extra.txt'), 'x');
  const failed = await installGame({
    ...fx, proxy: 'dxgi.dll', record: null, overwriteConfirmed: false, gameRunning: false,
    addons: [{ name: 'extra', files: [{ rel: 'extra.txt', from: path.join(addon, 'extra.txt') }] }]
  }, { fs, path, runner: async () => ({ code: 1, stdout: '', stderr: 'boom' }) });
  assert.equal(failed.status, 'incomplete');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'extra.txt')), false);
});

test('addon name collision is reported without removing Aurora', async () => {
  const fx = fixture();
  const result = await installGame({
    ...fx, proxy: 'dxgi.dll', record: null, overwriteConfirmed: false, gameRunning: null,
    addons: [{ name: 'clash', files: [{ rel: 'readme.txt', from: path.join(fx.packageRoot, 'readme.txt') }] }]
  }, { fs, path, runner: async () => ({ code: 0, stdout: '', stderr: '' }) });
  assert.equal(result.ok, true);
  assert.equal(result.addonFailure, 'clash');
  assert.equal(result.unconfirmedClose, true);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'readme.txt'), 'utf8'), 'hi');
});

test('check requests Check, and a blocked restore deletes nothing', async () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'DLL');
  fs.mkdirSync(path.join(fx.gameDir, 'OptiScaler', 'RuntimeSync'), { recursive: true });
  const record = { proxy: 'dxgi.dll', files: [{ rel: 'dxgi.dll', action: 'added' }] };
  const calls = [];
  const checked = await checkGame({ ...fx, record, gameRunning: false }, {
    fs, path, runner: async (command) => { calls.push(command); return { code: 0, stdout: 'ok', stderr: '' }; }
  });
  assert.equal(checked.ok, true);
  assert.equal(calls[0].args[6], 'Check');
  fs.rmSync(path.join(fx.gameDir, 'runtime_sync.ps1'), { force: true });
  const blocked = await restoreGame({ ...fx, record, gameRunning: false }, { fs, path, runner: async () => { throw new Error('no'); } });
  assert.equal(blocked.error, 'restore-blocked');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'dxgi.dll')), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/aurora/install.test.js`

Expected: FAIL with `Cannot find module '../../src/aurora/install'`

- [ ] **Step 3: Write minimal implementation**

Create `src/aurora/install.js` with this module. It must not import `child_process`.

```js
'use strict';
const path = require('path');
const { validatePackage } = require('./package');
const { planCopy, applyCopy } = require('./copy');
const { powershellCommand, restoreDecision } = require('./script');

function walk(fs, root, base = root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) walk(fs, abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

function outputOf(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n');
}

async function installGame(input, deps) {
  const { fs, path: nodePath, runner } = deps;
  const pathApi = nodePath || path;
  if (input.gameRunning === true) return { ok: false, error: 'game-running' };
  const pkg = validatePackage(input.packageRoot);
  if (!pkg.ok) return { ok: false, error: 'package-invalid', reason: pkg.reason };
  const files = walk(fs, input.packageRoot);
  const plan = planCopy({
    packageRoot: input.packageRoot,
    gameDir: input.gameDir,
    backupDir: input.backupDir,
    files,
    proxy: input.proxy,
    record: input.record,
    overwriteConfirmed: input.overwriteConfirmed
  });
  if (!plan.ok) return { ok: false, error: plan.error };
  const applied = applyCopy(plan, { fs, path: pathApi });
  if (!applied.ok) return { ok: false, error: 'copy-failed', message: applied.message };
  const ran = await runner(powershellCommand(pathApi.join(input.gameDir, 'runtime_sync.ps1'), 'Install', input.gameDir));
  if (ran.code !== 0) {
    return { ok: false, error: 'script-failed', status: 'incomplete', record: plan.nextRecord, output: outputOf(ran) };
  }
  let addonFailure = null;
  const taken = new Set(plan.nextRecord.files.map(file => file.rel.toLowerCase()));
  for (const addon of input.addons || []) {
    if ((addon.files || []).some(file => taken.has(String(file.rel).toLowerCase()))) {
      addonFailure = addon.name;
      continue;
    }
    for (const file of addon.files || []) {
      const dest = pathApi.join(input.gameDir, file.rel);
      fs.mkdirSync(pathApi.dirname(dest), { recursive: true });
      fs.copyFileSync(file.from, dest);
    }
  }
  return {
    ok: true,
    status: 'installed',
    record: { ...plan.nextRecord, status: 'installed' },
    addonFailure,
    unconfirmedClose: input.gameRunning === null,
    output: outputOf(ran)
  };
}

async function checkGame(input, deps) {
  if (!input.record) return { ok: false, error: 'not-installed' };
  if (input.gameRunning === true) return { ok: false, error: 'game-running' };
  const { path: nodePath, runner } = deps;
  const pathApi = nodePath || path;
  const ran = await runner(powershellCommand(pathApi.join(input.gameDir, 'runtime_sync.ps1'), 'Check', input.gameDir));
  const output = outputOf(ran);
  if (ran.code !== 0) return { ok: false, error: 'script-failed', status: 'incomplete', output };
  return { ok: true, status: 'installed', output };
}

async function restoreGame(input, deps) {
  if (!input.record) return { ok: false, error: 'not-installed' };
  if (input.gameRunning === true) return { ok: false, error: 'game-running' };
  const { fs, path: nodePath, runner } = deps;
  const pathApi = nodePath || path;
  const scriptPath = pathApi.join(input.gameDir, 'runtime_sync.ps1');
  const scriptExists = fs.existsSync(scriptPath);
  const runtimeSyncExists = fs.existsSync(pathApi.join(input.gameDir, 'OptiScaler', 'RuntimeSync'));
  let exitCode = null;
  let output = '';
  if (scriptExists) {
    const ran = await runner(powershellCommand(scriptPath, 'Restore', input.gameDir));
    exitCode = ran.code;
    output = outputOf(ran);
  }
  if (restoreDecision({ scriptExists, runtimeSyncExists, exitCode }) === 'stop') {
    return { ok: false, error: 'restore-blocked', record: input.record, output };
  }
  for (const file of input.record.files || []) fs.rmSync(pathApi.join(input.gameDir, file.rel), { force: true });
  return { ok: true, status: 'not-installed', record: null, output };
}

module.exports = { installGame, checkGame, restoreGame };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/aurora/install.test.js test/aurora/package.test.js test/aurora/games.test.js test/aurora/copy.test.js test/aurora/script.test.js`

Expected: PASS for every test.

- [ ] **Step 5: Commit**

```bash
git add src/aurora/install.js test/aurora/install.test.js
git commit -m "Orchestrate Aurora install, check, and restore."
```

### Task 6: Import the Swapper 2.2.7 shell

**Files:**
- Modify: `package.json`, `main.js`, `preload.js`, `src/renderer/index.html`, `LICENSE`
- Do not overwrite: `src/aurora/`, `test/aurora/`, `docs/`

**Interfaces:**
- Consumes: the upstream tree at commit `3b3b0efb5472df7fc806d7aff31c1d95819500c5`
- Produces: `npm start` opens an Electron window on Mac whose sidebar has exactly six items: Home, Games, Add-ons, History, Settings, About

- [ ] **Step 1: Copy the pinned tree without replacing Aurora modules**

```bash
git clone --branch v2.2.7 --depth 1 https://github.com/rakanki911/DLSS5-Swapper.git /tmp/dlss5-swapper-227
git -C /tmp/dlss5-swapper-227 rev-parse HEAD
```

Expected: `3b3b0efb5472df7fc806d7aff31c1d95819500c5`. If the printed hash differs, stop. Do not copy.

```bash
rsync -a --exclude '.git' --exclude 'node_modules' --exclude 'docs' /tmp/dlss5-swapper-227/ ./
```

Confirm `src/aurora/package.js` and `docs/superpowers/specs/2026-09-26-aurora-swapper-design.md` still exist.

- [ ] **Step 2: Remove the three pages from the shell**

In `src/renderer/index.html`, delete the `<button class="nav-item" data-view="chat">` block, the `data-view="community"` block, and the `data-view="overlays"` block. Delete `<section ... id="view-chat">`, `<section ... id="view-community">`, and `<section ... id="view-overlays">`. Delete the `<script>` tags whose `src` is `chat.js`, `community.js`, `overlay-panel.js`, `overlay-live.js`, or `overlay-gallery.js`.

In `package.json` set:

```json
"name": "aurora-swapper",
"version": "0.1.0",
"productName": "Aurora Swapper",
"description": "Install, repair, and restore OptiScaler Aurora for games in a local library.",
"author": "Aurora Swapper; interface based on DLSS 5 Swapper by Rakan Alkhaldi"
```

Inside the `build` object set `"appId": "local.aurora.swapper"` and `"productName": "Aurora Swapper"`. Leave `LICENSE` as MIT.

In `src/renderer/renderer.js` `paintBrand`, change the alt text and fallback text from `DLSS 5 Swapper` to `Aurora Swapper`.

- [ ] **Step 3: Boot in Chinese and ignore the removed views**

Find the saved-language read in `main.js` `ipcMain.handle('boot'`. When the saved language is missing, use `'zh'` before returning the boot payload. Do not delete `src/core/apply.js`.

- [ ] **Step 4: Install dependencies and open the window**

Run: `npm install`

Run: `npm start`

Expected: a window whose sidebar contains Home, Games, Add-ons, History, Settings, About, and does not contain Chat, Community, or Overlay. Close the window.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Import the Swapper shell and keep six Aurora pages."
```

### Task 7: Settings path and Aurora IPC

**Files:**
- Create: `src/aurora/store.js`
- Modify: `main.js`, `preload.js`
- Test: `test/aurora/store.test.js`

**Interfaces:**
- Consumes: `validatePackage`, `installGame`, `checkGame`, `restoreGame`
- Produces: `readStore(file)`, `writeStore(file, data)` with shape `{ packageRoot: string|null, records: { [gameDir: string]: { proxy, files, status } } }`
- Produces preload methods: `auroraState()`, `chooseAuroraPackage()`, `auroraInstall(gameDir, proxy, overwriteConfirmed)`, `auroraCheck(gameDir)`, `auroraRestore(gameDir)`
- Store file: `path.join(app.getPath('userData'), 'aurora-store.json')`
- Backup directory for a game: `path.join(app.getPath('userData'), 'aurora-backups', hash)` where `hash` is the lowercase resolved game dir run through `crypto.createHash('sha256')`
- `auroraInstall` uses `tasklist` on Windows. Off Windows, and when `tasklist` errors, pass `gameRunning: null`.
- After a successful install or check, `history.record(gameDir, { route: 'aurora', date: new Date().toISOString(), added: record.files.length, replaced: 0 }, action, path.basename(gameDir))` with `action` of `install` or `repair`.
- In `src/core/history.js` line 85, change the action allowlist from `['install', 'restore', 'recovery']` to `['install', 'restore', 'recovery', 'repair']`.

- [ ] **Step 1: Write the failing store test**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readStore, writeStore } = require('../../src/aurora/store');

test('round-trips the package path and one game record', () => {
  const file = path.join(os.tmpdir(), `aurora-store-${Date.now()}.json`);
  const data = { packageRoot: '/pkg', records: { '/game': { proxy: 'dxgi.dll', files: [], status: 'installed' } } };
  writeStore(file, data);
  assert.deepEqual(readStore(file), data);
  fs.rmSync(file, { force: true });
  assert.deepEqual(readStore(file), { packageRoot: null, records: {} });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/aurora/store.test.js`

Expected: FAIL with `Cannot find module '../../src/aurora/store'`

- [ ] **Step 3: Implement the store and the IPC handlers**

`readStore` returns `{ packageRoot: null, records: {} }` on `ENOENT`. `writeStore` writes pretty JSON.

In `preload.js`, inside the `lab` object, add:

```js
auroraState: () => ipcRenderer.invoke('aurora-state'),
chooseAuroraPackage: () => ipcRenderer.invoke('aurora-choose-package'),
auroraInstall: (gameDir, proxy, overwriteConfirmed) => ipcRenderer.invoke('aurora-install', gameDir, proxy, overwriteConfirmed),
auroraCheck: (gameDir) => ipcRenderer.invoke('aurora-check', gameDir),
auroraRestore: (gameDir) => ipcRenderer.invoke('aurora-restore', gameDir),
```

In `main.js`, add handlers that call the Task 5 functions with `fs`, `path`, and this runner:

```js
const { spawn } = require('child_process');
function runPowershell(command) {
  if (process.platform !== 'win32') {
    return Promise.resolve({ code: 1, stdout: '', stderr: 'PowerShell only runs on Windows' });
  }
  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}
```

`aurora-choose-package` uses `dialog.showOpenDialog({ properties: ['openDirectory'] })`, runs `validatePackage`, and on `ok: false` returns `{ ok: false, reason }` without saving. On success it saves `packageRoot`.

`aurora-install` loads the record for that `gameDir`. It does not call `src/core/apply.js`.

Enabled add-ons come from the existing state, not from a new picker:

```js
function enabledAddons() {
  const state = loadState();
  const enabled = new Set(state.addons || []);
  return addonLibrary()
    .filter(row => enabled.has(row.path))
    .map(row => ({
      name: row.name || path.basename(row.path),
      files: [{ rel: path.basename(row.path), from: row.path }]
    }));
}
```

Pass that array as `addons`. A game-running check on Windows:

```js
function queryGameRunning(exePath) {
  if (process.platform !== 'win32' || !exePath) return Promise.resolve(null);
  const image = path.basename(exePath);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/NH'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.toLowerCase().includes(image.toLowerCase()));
    });
  });
}
```

`execFile` comes from `child_process`. The sheet passes the selected exe path only for this check. The install directory remains `#auroraGameDir`.

- [ ] **Step 4: Run the store test and the Aurora suite**

Run: `node --test test/aurora/store.test.js test/aurora/*.test.js`

Expected: PASS. The glob may also run `store.test.js` twice; that is fine.

- [ ] **Step 5: Commit**

```bash
git add src/aurora/store.js test/aurora/store.test.js main.js preload.js src/core/history.js
git commit -m "Expose Aurora install, check, and restore over IPC."
```

### Task 8: Game sheet controls

**Files:**
- Modify: `src/renderer/renderer.js` around `installOptions` (line 751), the sheet template (lines 909-930), and `runJob` (line 1019)

**Interfaces:**
- Consumes: `window.lab.auroraState`, `auroraInstall`, `auroraCheck`, `auroraRestore`, `matchKnownGame` duplicated as a renderer copy is forbidden. The main process returns the preset.
- Add `auroraPreset(dirName, exeName)` to preload, implemented in main with `matchKnownGame`.

- [ ] **Step 1: Replace the backend picker**

Replace the body of `installOptions` so it returns only:

- a `<p id="auroraStatus">` whose text is `未安装`, `已安装`, or `安装未完成` from `window.lab.auroraState().records[dir]`
- when status is `installed`, a second line: `若启动器验证或更新过游戏，点修复。`
- `<select id="proxyChoice">` with the seven proxy filenames. Selected value is the record proxy, else the preset proxy, else `dxgi.dll`
- `<input id="auroraGameDir">` whose value is `dirname` of the selected exe, or `dir` when no exe is selected
- the preset `note` inside `<p id="auroraNote">` when `auroraPreset` returns non-null

Delete the ReShade / route / OptiScaler build `<select>` markup from this function. Do not call `routesFor` here.

- [ ] **Step 2: Replace the action buttons**

In the sheet template, replace the `sheet-actions` block with three buttons:

```html
<button class="btn-install" id="doInstall">安装 Aurora</button>
<button class="btn-restore" id="doRepair">修复运行库</button>
<button class="btn-restore" id="doRestore">还原原始文件</button>
<button class="btn-restore" id="doOpen">打开游戏目录</button>
```

`doOpen` calls the existing `window.lab.open` with the value of `#auroraGameDir`.

`doInstall` is disabled when `auroraState().packageRoot` is null. `doRepair` and `doRestore` are disabled when the record status is missing. Remove the `#shareResult` button.

Wire:

```js
$('doInstall').onclick = () => runAurora('install', dir);
$('doRepair').onclick = () => runAurora('check', dir);
$('doRestore').onclick = () => runAurora('restore', dir);
```

`runAurora('install')` reads `#proxyChoice` and `#auroraGameDir` and calls `window.lab.auroraInstall(gameDir, proxy, false)`. If the result error is `proxy-exists`, `window.confirm('目标代理 DLL 已存在，是否覆盖？')` and, on yes, call again with `true`. `check` calls `auroraCheck`. `restore` calls `auroraRestore`. Write `result.output` or `result.error` into `#job`. On `unconfirmedClose`, prepend `未能确认游戏已关闭。`

Leave `runJob` in the file unused rather than deleting the DLSS install path from `main.js`.

- [ ] **Step 3: Open the app and inspect one game sheet**

Run: `npm start`

Expected: opening a game no longer shows ReShade, Feeder, RenoDX, or OptiScaler DLSS-NR. It shows the proxy list, the directory field, 安装 Aurora, 修复运行库, and 还原原始文件. Close the window.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/renderer.js preload.js main.js
git commit -m "Replace the game sheet installer with Aurora actions."
```

### Task 9: Home summary and settings picker

**Files:**
- Modify: `src/renderer/index.html` `#view-home` and `#view-settings`
- Modify: `src/renderer/renderer.js` `renderRecent` and `renderSettings`

**Interfaces:**
- Consumes: `window.lab.auroraState()`, `window.lab.chooseAuroraPackage()`

- [ ] **Step 1: Add the home figures**

Inside `#view-home`, before Recent Games, add:

```html
<div id="auroraHome">
  <p id="auroraPackageLine">未指定 Aurora 发布包</p>
  <p id="auroraCounts">已安装 0 · 未安装 0</p>
</div>
```

In `renderRecent`, after the recent list is drawn, read `auroraState()`. If `package.ok` is true, set the package line to `已指定发布包`. Otherwise set it to `发布包无效：` plus `package.reason`, or `未指定 Aurora 发布包` when `packageRoot` is null. Count records whose `status === 'installed'` against `state.games.length`.

- [ ] **Step 2: Add the settings control**

In `renderSettings`, prepend a block with a button `#chooseAuroraPackage` labeled `指定 Aurora 发布包`. Its click handler calls `chooseAuroraPackage()` and then rerenders settings and the home line. Show the saved path in `<code id="auroraPackagePath">`.

Do not add a control for Epic, GOG, Xbox, or full-disk scan. Steam libraries stay on the scanner Swapper already has. Adding or removing a folder uses the existing `add-folder` and `remove-folder` actions. Do not write a new scanner.

In `#view-about`, set the title text to `Aurora Swapper` and add one paragraph: `界面代码 MIT，基于 Rakan Alkhaldi 的 DLSS 5 Swapper。Aurora 本体 GPL-3.0，发布包不在本仓库中。`

- [ ] **Step 3: Run the automated tests and open the window**

Run: `node --test test/aurora/*.test.js`

Expected: PASS.

Run: `npm start`

Expected: Home shows the package line and counts. Settings can open a directory picker. About contains the MIT and GPL sentence. Close the window.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/index.html src/renderer/renderer.js
git commit -m "Show Aurora package status on Home and Settings."
```

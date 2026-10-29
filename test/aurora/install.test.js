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

test('a replaced file is restored from its backup path', async () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.gameDir, 'readme.txt'), 'ORIGINAL');
  const installed = await installGame({
    ...fx, proxy: 'dxgi.dll', record: null, overwriteConfirmed: false, addons: [], gameRunning: false
  }, { fs, path, runner: async () => ({ code: 0, stdout: '', stderr: '' }) });
  const replaced = installed.record.files.find(file => file.rel === 'readme.txt');
  assert.equal(installed.ok, true);
  assert.equal(replaced.action, 'replaced');
  assert.equal(fs.readFileSync(replaced.backup, 'utf8'), 'ORIGINAL');
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'readme.txt'), 'utf8'), 'hi');
  const restored = await restoreGame({ ...fx, record: installed.record, gameRunning: false }, {
    fs, path, runner: async () => ({ code: 0, stdout: '', stderr: '' })
  });
  assert.equal(restored.ok, true);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'readme.txt'), 'utf8'), 'ORIGINAL');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'dxgi.dll')), false);
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'runtime_sync.ps1')), false);
});

test('a missing backup blocks restore and deletes nothing', async () => {
  const fx = fixture();
  fs.writeFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'AURORA');
  fs.writeFileSync(path.join(fx.gameDir, 'readme.txt'), 'AURORA');
  fs.writeFileSync(path.join(fx.gameDir, 'runtime_sync.ps1'), 'echo ok');
  const record = {
    proxy: 'dxgi.dll',
    files: [
      { rel: 'dxgi.dll', action: 'added' },
      { rel: 'readme.txt', action: 'replaced', backup: path.join(fx.backupDir, 'gone.txt') }
    ]
  };
  const blocked = await restoreGame({ ...fx, record, gameRunning: false }, {
    fs, path, runner: async () => ({ code: 0, stdout: '', stderr: '' })
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'restore-blocked');
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'AURORA');
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'readme.txt'), 'utf8'), 'AURORA');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'runtime_sync.ps1')), true);
});

test('restore rejects a persisted relative path that escapes the game directory', async () => {
  const fx = fixture();
  const outsideDir = dir();
  const outside = path.join(outsideDir, 'important.txt');
  fs.writeFileSync(outside, 'keep me');
  const rel = path.relative(fx.gameDir, outside);
  const result = await restoreGame({
    ...fx, record: { files: [{ rel, action: 'added' }] }, gameRunning: false
  }, { fs, path, runner: async () => ({ code: 0, stdout: '', stderr: '' }) });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'restore-blocked');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me');
});

test('restore rejects a persisted backup path outside Aurora backup storage', async () => {
  const fx = fixture();
  const gameFile = path.join(fx.gameDir, 'readme.txt');
  const outsideBackup = path.join(dir(), 'private.txt');
  fs.writeFileSync(gameFile, 'Aurora copy');
  fs.writeFileSync(outsideBackup, 'untrusted source');
  const result = await restoreGame({
    ...fx,
    record: { files: [{ rel: 'readme.txt', action: 'replaced', backup: outsideBackup }] },
    gameRunning: false
  }, { fs, path, runner: async () => ({ code: 0, stdout: '', stderr: '' }) });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'restore-blocked');
  assert.equal(fs.readFileSync(gameFile, 'utf8'), 'Aurora copy');
});

test('restore refuses a directory masquerading as an original-file backup before running the script', async () => {
  const fx = fixture();
  const gameFile = path.join(fx.gameDir, 'readme.txt');
  fs.writeFileSync(gameFile, 'Aurora copy');
  const backupPath = path.join(fx.backupDir, 'readme.txt');
  fs.mkdirSync(backupPath);
  let runnerCalled = false;
  const result = await restoreGame({
    ...fx,
    record: { files: [{ rel: 'readme.txt', action: 'replaced', backup: backupPath }] },
    gameRunning: false
  }, { fs, path, runner: async () => { runnerCalled = true; return { code: 0, stdout: '', stderr: '' }; } });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'restore-blocked');
  assert.equal(runnerCalled, false);
  assert.equal(fs.readFileSync(gameFile, 'utf8'), 'Aurora copy');
});

test('restore refuses a recorded path that crosses a game-directory symlink', async t => {
  const fx = fixture();
  const outsideDir = dir();
  const outside = path.join(outsideDir, 'important.txt');
  fs.writeFileSync(outside, 'keep me');
  const link = path.join(fx.gameDir, 'redirect');
  try {
    fs.symlinkSync(outsideDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code || error.message}`);
    return;
  }
  let runnerCalled = false;
  const result = await restoreGame({
    ...fx, record: { files: [{ rel: 'redirect/important.txt', action: 'added' }] }, gameRunning: false
  }, { fs, path, runner: async () => { runnerCalled = true; return { code: 0, stdout: '', stderr: '' }; } });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'restore-blocked');
  assert.equal(runnerCalled, false);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me');
});

test('an addon copy throw still returns installed', async () => {
  const fx = fixture();
  const addon = dir();
  const from = path.join(addon, 'extra.txt');
  fs.writeFileSync(from, 'x');
  const wrapped = Object.create(fs);
  wrapped.copyFileSync = (src, dest, ...rest) => {
    if (src === from) throw new Error('addon-copy-failed');
    return fs.copyFileSync(src, dest, ...rest);
  };
  const result = await installGame({
    ...fx, proxy: 'dxgi.dll', record: null, overwriteConfirmed: false, gameRunning: false,
    addons: [{ name: 'extra', files: [{ rel: 'extra.txt', from }] }]
  }, { fs: wrapped, path, runner: async () => ({ code: 0, stdout: '', stderr: '' }) });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'installed');
  assert.equal(result.record.status, 'installed');
  assert.equal(result.addonFailure, 'extra');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'dxgi.dll')), true);
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'runtime_sync.ps1')), true);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'readme.txt'), 'utf8'), 'hi');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'extra.txt')), false);
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

test('install checkpoints its snapshot before writes, then checkpoints script and commit', async () => {
  const fx = fixture();
  const events = [];
  const observedFs = Object.create(fs);
  observedFs.copyFileSync = (from, to, ...args) => {
    if (to.startsWith(fx.gameDir + path.sep) && from.startsWith(fx.packageRoot + path.sep)) {
      events.push(`write:${path.basename(to)}`);
    }
    return fs.copyFileSync(from, to, ...args);
  };
  const result = await installGame({
    ...fx, proxy: 'dxgi.dll', record: null, overwriteConfirmed: false, addons: [], gameRunning: false
  }, {
    fs: observedFs, path,
    checkpoint: async (transaction, commit) => {
      if (transaction) events.push(`checkpoint:${transaction.phase}`);
      else events.push(`checkpoint:commit:${commit.record.status}`);
    },
    runner: async () => { events.push('runner'); return { code: 0, stdout: '', stderr: '' }; }
  });

  assert.equal(result.ok, true);
  const position = name => events.findIndex(event => event.startsWith(name));
  assert.ok(position('checkpoint:prepared') >= 0);
  assert.ok(position('checkpoint:copying') > position('checkpoint:prepared'));
  assert.ok(position('write:') > position('checkpoint:copying'));
  assert.ok(position('checkpoint:script-running') > position('write:'));
  assert.ok(position('runner') > position('checkpoint:script-running'));
  assert.ok(position('checkpoint:commit:installed') > position('runner'));
});

test('failed copying checkpoint prevents game writes and script execution', async () => {
  const fx = fixture();
  let runnerCalled = false;
  const result = await installGame({
    ...fx, proxy: 'dxgi.dll', record: null, overwriteConfirmed: false, addons: [], gameRunning: false
  }, {
    fs, path,
    checkpoint: async transaction => {
      if (transaction && transaction.phase === 'copying') throw new Error('store unavailable');
    },
    runner: async () => { runnerCalled = true; return { code: 0, stdout: '', stderr: '' }; }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'checkpoint-failed');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'dxgi.dll')), false);
  assert.equal(runnerCalled, false);
});

test('a runner exception leaves an incomplete record and recoverable transaction', async () => {
  const fx = fixture();
  const phases = [];
  const result = await installGame({
    ...fx, proxy: 'dxgi.dll', record: null, overwriteConfirmed: false, addons: [], gameRunning: false
  }, {
    fs, path,
    checkpoint: async transaction => { if (transaction) phases.push(transaction.phase); },
    runner: async () => { throw new Error('PowerShell exited unexpectedly'); }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.needsRecovery, true);
  assert.equal(result.record.status, 'incomplete');
  assert.deepEqual(phases.slice(-2), ['script-running', 'needs-recovery']);
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'dxgi.dll')), true);
});

test('failed final record commit cannot report a successful install', async () => {
  const fx = fixture();
  const phases = [];
  const result = await installGame({
    ...fx, proxy: 'dxgi.dll', record: null, overwriteConfirmed: false, addons: [], gameRunning: false
  }, {
    fs, path,
    checkpoint: async (transaction, commit) => {
      if (transaction) phases.push(transaction.phase);
      if (!transaction && commit) throw new Error('disk full');
    },
    runner: async () => ({ code: 0, stdout: '', stderr: '' })
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.needsRecovery, true);
  assert.equal(result.record.status, 'incomplete');
  assert.equal(phases.at(-1), 'needs-recovery');
});

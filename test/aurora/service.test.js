'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gameKey, createAuroraService } = require('../../src/aurora/service');
const { prepareCopy, applyCopy } = require('../../src/aurora/copy');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function fixture({ store, platform = 'linux', gameRunning = false, powershellRunning = false,
  cachedExePath = null, runCheck, runInstall, runRestore, resolveExePath, backupDirFor, saveStore } = {}) {
  let saved = structuredClone(store || {
    packageRoot: '/package', records: {}, gameDirs: {}, transactions: {}
  });
  const calls = { install: [], check: [], restore: [], resolved: [] };
  const service = createAuroraService({
    platform,
    loadStore: () => structuredClone(saved),
    saveStore: next => {
      if (saveStore) return saveStore(next, value => { saved = structuredClone(value); });
      saved = structuredClone(next);
    },
    validatePackage: () => ({ ok: true, root: '/package' }),
    getBackupDir: dir => backupDirFor ? backupDirFor(dir) : `/backup/${dir.split(/[\\/]/).pop()}`,
    getAddons: () => [],
    resolveExePath: input => {
      calls.resolved.push(input);
      if (resolveExePath) return resolveExePath(input);
      return input.requestedExePath || (input.record && input.record.exePath) || cachedExePath;
    },
    queryGameRunning: async () => gameRunning,
    queryPowerShellRunning: async () => powershellRunning,
    runInstall: async input => {
      calls.install.push(input);
      if (runInstall) return runInstall(input);
      const record = { proxy: input.proxy, files: [], exePath: input.exePath, status: 'installed' };
      await input.checkpoint(null, { gameDir: input.storeKey, record });
      return { ok: true, status: 'installed', record };
    },
    runCheck: async input => {
      calls.check.push(input);
      return runCheck ? runCheck(input) : { ok: true, status: 'installed' };
    },
    runRestore: async input => {
      calls.restore.push(input);
      return runRestore ? runRestore(input) : { ok: true, status: 'not-installed', record: null };
    }
  });
  return { service, calls, getStore: () => structuredClone(saved) };
}

test('game keys normalize Windows aliases but retain macOS case sensitivity', () => {
  assert.equal(gameKey('C:\\Games\\Foo\\', 'win32'), gameKey('c:/games/foo', 'win32'));
  assert.notEqual(gameKey('/Games/Foo', 'darwin'), gameKey('/games/foo', 'darwin'));
  assert.equal(gameKey('/Games/Foo/../Foo/', 'darwin'), '/Games/Foo');
});

test('script-restore uses the transaction nextRecord even when an older record exists', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-service-script-restore-'));
  const gameDir = path.join(root, 'game');
  fs.mkdirSync(gameDir);
  fs.writeFileSync(path.join(gameDir, 'dxgi.dll'), 'old-aurora');
  fs.writeFileSync(path.join(gameDir, 'winmm.dll'), 'new-aurora');
  const oldRecord = { proxy: 'dxgi.dll', files: [{ rel: 'dxgi.dll', action: 'added' }], status: 'installed' };
  const nextRecord = { proxy: 'winmm.dll', files: [{ rel: 'winmm.dll', action: 'added' }], status: 'incomplete' };
  const storedTransaction = {
    gameDir, phase: 'needs-recovery', recoveryKind: 'script-restore', nextRecord,
    previousRecord: oldRecord, snapshotDir: path.join(root, 'snapshot'), snapshotManifest: []
  };
  const fx = fixture({
    store: { packageRoot: '/package', records: { [gameDir]: oldRecord }, transactions: { [gameDir]: storedTransaction } },
    runRestore: async input => {
      for (const file of input.record.files) fs.rmSync(path.join(input.gameDir, file.rel), { force: true });
      return { ok: true, status: 'not-installed' };
    }
  });

  const result = await fx.service.run('restore', { gameDir });

  assert.equal(result.ok, true);
  assert.deepEqual(fx.calls.restore[0].record, nextRecord);
  assert.equal(fs.existsSync(path.join(gameDir, 'winmm.dll')), false);
  assert.equal(fs.existsSync(path.join(gameDir, 'dxgi.dll')), true);
  assert.equal(Object.keys(fx.getStore().transactions).length, 0);
});

test('copy-rollback Restore reverts its snapshot then formally restores the previous install', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-service-copy-restore-'));
  const packageRoot = path.join(root, 'package');
  const gameDir = path.join(root, 'game');
  const backupDir = path.join(root, 'backups');
  for (const dir of [packageRoot, gameDir, backupDir]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(packageRoot, 'OptiScaler.dll'), 'new-payload');
  fs.writeFileSync(path.join(gameDir, 'dxgi.dll'), 'previous-aurora');
  fs.writeFileSync(path.join(gameDir, 'winmm.dll'), 'original-winmm');
  const previousRecord = { proxy: 'dxgi.dll', files: [{ rel: 'dxgi.dll', action: 'added' }], status: 'installed' };
  const nextRecord = { proxy: 'winmm.dll', files: [{ rel: 'winmm.dll', action: 'replaced', backup: 'winmm.dll' }], status: 'incomplete' };
  const transactionPlan = require('../../src/aurora/copy').planCopy({
    packageRoot, gameDir, backupDir, files: ['OptiScaler.dll'], proxy: 'winmm.dll',
    record: previousRecord, overwriteConfirmed: true
  });
  const prepared = prepareCopy(transactionPlan);
  assert.equal(prepared.ok, true);
  applyCopy(transactionPlan, { snapshotManifest: prepared.manifest });
  const transaction = {
    gameDir, phase: 'needs-recovery', recoveryKind: 'copy-rollback', previousRecord,
    nextRecord, snapshotDir: prepared.snapshotDir, snapshotManifest: prepared.manifest
  };
  const fx = fixture({
    store: { packageRoot: '/package', records: { [gameDir]: nextRecord }, transactions: { [gameDir]: transaction } },
    backupDirFor: () => backupDir,
    runRestore: async input => {
      assert.equal(fs.readFileSync(path.join(input.gameDir, 'dxgi.dll'), 'utf8'), 'previous-aurora');
      assert.equal(fs.readFileSync(path.join(input.gameDir, 'winmm.dll'), 'utf8'), 'original-winmm');
      assert.deepEqual(input.record, previousRecord);
      fs.rmSync(path.join(input.gameDir, 'dxgi.dll'));
      return { ok: true, status: 'not-installed' };
    }
  });

  const result = await fx.service.run('restore', { gameDir });

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(gameDir, 'dxgi.dll')), false);
  assert.equal(fs.readFileSync(path.join(gameDir, 'winmm.dll'), 'utf8'), 'original-winmm');
  assert.equal(Object.keys(fx.getStore().transactions).length, 0);
  assert.equal(Object.keys(fx.getStore().records).length, 0);
});

test('script-restore failure keeps both recovery records for retry', async () => {
  const gameDir = '/games/script-retry';
  const previousRecord = { proxy: 'dxgi.dll', files: [], status: 'installed' };
  const nextRecord = { proxy: 'winmm.dll', files: [], status: 'incomplete' };
  const transaction = { gameDir, phase: 'script-running', previousRecord, nextRecord, snapshotManifest: [] };
  let attempts = 0;
  const fx = fixture({
    store: { packageRoot: '/package', records: { [gameDir]: previousRecord }, transactions: { [gameDir]: transaction } },
    runRestore: async ({ record }) => {
      attempts++;
      assert.deepEqual(record, nextRecord);
      return attempts === 1 ? { ok: false, error: 'restore-blocked' } : { ok: true, status: 'not-installed' };
    }
  });

  const first = await fx.service.run('restore', { gameDir });
  assert.equal(first.error, 'restore-blocked');
  assert.deepEqual(fx.getStore().records[gameDir], previousRecord);
  assert.deepEqual(fx.getStore().transactions[gameDir], transaction);
  const retry = await fx.service.run('restore', { gameDir });
  assert.equal(retry.ok, true);
  assert.equal(Object.keys(fx.getStore().transactions).length, 0);
});

test('copy-rollback refuses running or unknown process state without touching files or clearing evidence', async () => {
  for (const state of [
    { gameRunning: true, powershellRunning: false },
    { gameRunning: null, powershellRunning: false },
    { gameRunning: false, powershellRunning: true },
    { gameRunning: false, powershellRunning: null }
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-service-process-'));
    const gameDir = path.join(root, 'game');
    fs.mkdirSync(gameDir);
    fs.writeFileSync(path.join(gameDir, 'dxgi.dll'), 'Aurora-in-progress');
    const snapshotDir = path.join(root, 'snapshot');
    fs.mkdirSync(snapshotDir);
    const snapshot = path.join(snapshotDir, '0000.snapshot');
    fs.writeFileSync(snapshot, 'original');
    const transaction = {
      gameDir, phase: 'needs-recovery', recoveryKind: 'copy-rollback',
      nextRecord: { proxy: 'dxgi.dll', files: [], status: 'incomplete' }, previousRecord: null,
      snapshotDir, snapshotManifest: [{ rel: 'dxgi.dll', to: path.join(gameDir, 'dxgi.dll'), existed: true, snapshot }]
    };
    const fx = fixture({
      ...state,
      store: { packageRoot: '/package', records: { [gameDir]: transaction.nextRecord }, transactions: { [gameDir]: transaction } },
      backupDirFor: () => root
    });

    const result = await fx.service.run('restore', { gameDir });

    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(path.join(gameDir, 'dxgi.dll'), 'utf8'), 'Aurora-in-progress');
    assert.equal(fs.existsSync(snapshot), true);
    assert.equal(Object.keys(fx.getStore().transactions).length, 1);
    assert.equal(fx.calls.restore.length, 0);
  }
});

test('failed recovery store commit keeps the transaction snapshot and never reports success', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-service-store-failure-'));
  const gameDir = path.join(root, 'game');
  const backupDir = path.join(root, 'backups');
  const snapshotDir = path.join(backupDir, '.transactions', '00000000-0000-4000-8000-000000000001');
  for (const dir of [gameDir, snapshotDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'new.dll'), 'new');
  fs.writeFileSync(path.join(snapshotDir, '0000.snapshot'), 'original');
  const snapshot = path.join(snapshotDir, '0000.snapshot');
  const record = { proxy: 'dxgi.dll', files: [], status: 'incomplete' };
  const transaction = {
    gameDir, phase: 'copying', previousRecord: null, nextRecord: record, snapshotDir,
    snapshotManifest: [{ rel: 'new.dll', to: path.join(gameDir, 'new.dll'), existed: true, snapshot }]
  };
  const fx = fixture({
    backupDirFor: () => backupDir,
    store: { packageRoot: '/package', records: { [gameDir]: record }, transactions: { [gameDir]: transaction } },
    saveStore: () => { throw new Error('disk full'); }
  });

  const result = await fx.service.run('restore', { gameDir });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'operation-failed');
  assert.equal(fs.readFileSync(path.join(gameDir, 'new.dll'), 'utf8'), 'original');
  assert.equal(fs.existsSync(snapshot), true);
  assert.equal(Object.keys(fx.getStore().transactions).length, 1);
  assert.equal(fx.calls.restore.length, 0);
});

test('formal Restore failure after copy rollback leaves the previous record retryable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-service-formal-retry-'));
  const gameDir = path.join(root, 'game');
  const backupDir = path.join(root, 'backups');
  const snapshotDir = path.join(backupDir, '.transactions', '00000000-0000-4000-8000-000000000002');
  for (const dir of [gameDir, snapshotDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, 'dxgi.dll'), 'current');
  fs.writeFileSync(path.join(snapshotDir, '0000.snapshot'), 'previous');
  const previousRecord = { proxy: 'dxgi.dll', files: [{ rel: 'dxgi.dll', action: 'added' }], status: 'installed' };
  const transaction = {
    gameDir, phase: 'needs-recovery', recoveryKind: 'copy-rollback', previousRecord,
    nextRecord: { proxy: 'winmm.dll', files: [], status: 'incomplete' }, snapshotDir,
    snapshotManifest: [{ rel: 'dxgi.dll', to: path.join(gameDir, 'dxgi.dll'), existed: true, snapshot: path.join(snapshotDir, '0000.snapshot') }]
  };
  let attempts = 0;
  const fx = fixture({
    backupDirFor: () => backupDir,
    store: { packageRoot: '/package', records: { [gameDir]: transaction.nextRecord }, transactions: { [gameDir]: transaction } },
    runRestore: async input => {
      attempts++;
      assert.deepEqual(input.record, previousRecord);
      if (attempts === 1) return { ok: false, error: 'restore-blocked' };
      fs.rmSync(path.join(input.gameDir, 'dxgi.dll'), { force: true });
      return { ok: true, status: 'not-installed' };
    }
  });

  const first = await fx.service.run('restore', { gameDir });
  assert.equal(first.error, 'restore-blocked');
  assert.equal(fs.readFileSync(path.join(gameDir, 'dxgi.dll'), 'utf8'), 'previous');
  assert.deepEqual(fx.getStore().records[gameDir], previousRecord);
  assert.equal(Object.keys(fx.getStore().transactions).length, 0);
  const retry = await fx.service.run('restore', { gameDir });
  assert.equal(retry.ok, true);
  assert.equal(fs.existsSync(path.join(gameDir, 'dxgi.dll')), false);
});

test('right-click style restore lookup can use a cached executable when no exe was passed', async () => {
  const gameDir = 'C:\\Games\\AuroraGame';
  const record = { proxy: 'dxgi.dll', files: [], status: 'installed' };
  const fx = fixture({
    platform: 'win32', cachedExePath: 'C:\\Games\\AuroraGame\\Game.exe',
    store: { packageRoot: '/package', records: { [gameDir]: record }, gameDirs: {}, transactions: {} }
  });

  const result = await fx.service.run('restore', { gameDir: 'c:/games/auroragame/', exePath: null });

  assert.equal(result.ok, true);
  assert.equal(fx.calls.restore[0].exePath, 'C:\\Games\\AuroraGame\\Game.exe');
  assert.equal(fx.calls.restore[0].backupDir, '/backup/auroragame');
  assert.deepEqual(fx.calls.resolved[0].record, record);
});

test('an executable recorded at install is used when a later entry point omits it', async () => {
  const gameDir = '/games/aurora';
  const record = { proxy: 'dxgi.dll', files: [], status: 'installed', exePath: '/games/aurora/Game.exe' };
  const fx = fixture({ store: { packageRoot: '/package', records: { [gameDir]: record }, gameDirs: {}, transactions: {} } });

  await fx.service.run('check', { gameDir });

  assert.equal(fx.calls.check[0].exePath, record.exePath);
});

test('a running game blocks the runner and all operation callbacks', async () => {
  const gameDir = '/games/aurora';
  const fx = fixture({
    gameRunning: true,
    store: { packageRoot: '/package', records: { [gameDir]: { files: [], status: 'installed' } }, gameDirs: {}, transactions: {} }
  });

  const result = await fx.service.run('restore', { gameDir });

  assert.equal(result.error, 'game-running');
  assert.equal(fx.calls.restore.length, 0);
  assert.equal(fx.calls.check.length, 0);
  assert.equal(fx.calls.install.length, 0);
});

test('legacy Windows keys are reused and conflicting aliases are never silently merged', async () => {
  const legacyKey = 'C:\\Games\\Aurora\\';
  const record = { proxy: 'dxgi.dll', files: [{ rel: 'dxgi.dll', action: 'added' }], status: 'incomplete' };
  const fx = fixture({
    platform: 'win32',
    store: { packageRoot: '/package', records: { [legacyKey]: record }, gameDirs: {}, transactions: {} }
  });
  const result = await fx.service.run('check', { gameDir: 'c:/games/aurora' });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(fx.getStore().records), [legacyKey]);
  assert.equal(fx.getStore().records[legacyKey].status, 'installed');

  const conflicted = fixture({
    platform: 'win32',
    store: { packageRoot: '/package', records: {
      'C:\\Games\\Aurora': record,
      'c:/games/aurora/': { ...record, files: [{ rel: 'other.dll', action: 'replaced', backup: 'other.bak' }] }
    }, gameDirs: {}, transactions: {} }
  });
  const conflict = await conflicted.service.run('restore', { gameDir: legacyKey });
  assert.equal(conflict.error, 'record-key-conflict');
  assert.equal(conflicted.calls.restore.length, 0);

  const transactionConflict = fixture({
    platform: 'win32',
    store: { packageRoot: '/package', records: {}, gameDirs: {}, transactions: {
      'C:\\Games\\Aurora': { phase: 'script-running' },
      'c:/games/aurora/': { phase: 'needs-recovery' }
    } }
  });
  const txConflict = await transactionConflict.service.run('restore', { gameDir: legacyKey });
  assert.equal(txConflict.error, 'transaction-key-conflict');
  assert.equal(transactionConflict.calls.restore.length, 0);
});

test('Windows aliases share one lock while another game can proceed concurrently', async () => {
  const firstDir = 'C:\\Games\\Aurora';
  const secondDir = 'C:\\Games\\Other';
  const gate = deferred();
  const firstStarted = deferred();
  let inFlight = 0;
  let maxInFlight = 0;
  const fx = fixture({
    platform: 'win32',
    store: { packageRoot: '/package', records: {
      [firstDir]: { files: [], status: 'installed' },
      [secondDir]: { files: [], status: 'installed' }
    }, gameDirs: {}, transactions: {} },
    runCheck: async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      firstStarted.resolve();
      await gate.promise;
      inFlight--;
      return { ok: true, status: 'installed' };
    }
  });

  const first = fx.service.run('check', { gameDir: firstDir });
  await firstStarted.promise;
  const alias = await fx.service.run('restore', { gameDir: 'c:/games/aurora/' });
  assert.equal(alias.error, 'operation-in-progress');
  const second = fx.service.run('check', { gameDir: secondDir });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(maxInFlight, 2);
  gate.resolve();
  await Promise.all([first, second]);
});

test('different-game saves merge against the latest store and preserve both records', async () => {
  const a = '/games/a';
  const b = '/games/b';
  const gate = deferred();
  const started = [];
  const fx = fixture({
    store: { packageRoot: '/package', records: {
      [a]: { files: [], status: 'incomplete' }, [b]: { files: [], status: 'incomplete' }
    }, gameDirs: {}, transactions: {} },
    runCheck: async input => {
      started.push(input.gameDir);
      if (started.length === 2) gate.resolve();
      await gate.promise;
      return { ok: true, status: 'installed' };
    }
  });

  await Promise.all([
    fx.service.run('check', { gameDir: a }),
    fx.service.run('check', { gameDir: b })
  ]);

  assert.equal(fx.getStore().records[a].status, 'installed');
  assert.equal(fx.getStore().records[b].status, 'installed');
});

test('unknown game state permits an ordinary operation but is returned as a warning', async () => {
  const gameDir = '/games/aurora';
  const fx = fixture({
    gameRunning: null,
    store: { packageRoot: '/package', records: { [gameDir]: { files: [], status: 'installed' } }, gameDirs: {}, transactions: {} }
  });

  const result = await fx.service.run('check', { gameDir });

  assert.equal(result.ok, true);
  assert.equal(result.unconfirmedClose, true);
  assert.equal(fx.calls.check.length, 1);
});

test('install checkpoints and commits under the reused key while persisting its executable', async () => {
  const storedKey = 'C:\\Games\\Aurora\\';
  const exePath = 'C:\\Games\\Aurora\\Game.exe';
  const fx = fixture({
    platform: 'win32', gameRunning: null, cachedExePath: exePath,
    store: { packageRoot: '/package', records: { [storedKey]: { files: [], status: 'incomplete' } }, gameDirs: {}, transactions: {} },
    runInstall: async input => {
      const record = { proxy: 'dxgi.dll', files: [], status: 'installed' };
      await input.checkpoint({
        gameDir: input.gameDir, phase: 'prepared', nextRecord: record,
        previousRecord: input.record, snapshotDir: '/backup/tx', snapshotManifest: []
      });
      await input.checkpoint(null, { gameDir: input.gameDir, record });
      return { ok: true, record };
    }
  });

  const result = await fx.service.run('install', {
    gameDir: 'c:/games/aurora', proxy: 'dxgi.dll', overwriteConfirmed: false
  });

  assert.equal(result.unconfirmedClose, true);
  assert.equal(fx.calls.install[0].exePath, exePath);
  assert.deepEqual(Object.keys(fx.getStore().records), [storedKey]);
  assert.equal(fx.getStore().records[storedKey].exePath, exePath);
  assert.equal(Object.keys(fx.getStore().transactions).length, 0);
});

test('an exception is reported and the operation lock is released in finally', async () => {
  const gameDir = '/games/aurora';
  let attempts = 0;
  const fx = fixture({
    store: { packageRoot: '/package', records: { [gameDir]: { files: [], status: 'incomplete' } }, gameDirs: {}, transactions: {} },
    runCheck: async () => {
      attempts++;
      if (attempts === 1) throw new Error('fixture failure');
      return { ok: true, status: 'installed' };
    }
  });

  const failed = await fx.service.run('check', { gameDir });
  const retried = await fx.service.run('check', { gameDir });

  assert.equal(failed.error, 'operation-failed');
  assert.equal(failed.message, 'fixture failure');
  assert.equal(retried.ok, true);
});

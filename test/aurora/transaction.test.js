'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planCopy, prepareCopy, applyCopy, cleanupSnapshot } = require('../../src/aurora/copy');
const { recoverTransaction } = require('../../src/aurora/transaction');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-transaction-'));
  const packageRoot = path.join(root, 'package');
  const gameDir = path.join(root, 'game');
  const backupDir = path.join(root, 'backups');
  for (const dir of [packageRoot, gameDir, backupDir]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(packageRoot, 'OptiScaler.dll'), 'Aurora');
  fs.writeFileSync(path.join(packageRoot, 'runtime_sync.ps1'), 'fake');
  fs.writeFileSync(path.join(gameDir, 'dxgi.dll'), 'ORIGINAL');
  const plan = planCopy({
    packageRoot, gameDir, backupDir,
    files: ['OptiScaler.dll', 'runtime_sync.ps1'],
    proxy: 'dxgi.dll', record: null, overwriteConfirmed: true
  });
  const prepared = prepareCopy(plan, { fs, path });
  assert.equal(prepared.ok, true);
  return { gameDir, backupDir, plan, prepared };
}

function transaction(fx, phase) {
  return {
    id: 'run-1',
    gameDir: fx.gameDir,
    phase,
    previousRecord: null,
    nextRecord: { ...fx.plan.nextRecord, status: 'incomplete' },
    snapshotDir: fx.prepared.snapshotDir,
    snapshotManifest: fx.prepared.manifest
  };
}

test('copy-phase recovery restores the previous game files and drops the transaction', () => {
  const fx = fixture();
  assert.equal(applyCopy(fx.plan, { fs, path, snapshotManifest: fx.prepared.manifest }).ok, true);

  const result = recoverTransaction(transaction(fx, 'copying'), {
    fs, path, gameDir: fx.gameDir, backupDir: fx.backupDir, gameRunning: false, powershellRunning: false
  });

  assert.equal(result.ok, true);
  assert.equal(result.record, null);
  assert.equal(result.transaction, null);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'ORIGINAL');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'runtime_sync.ps1')), false);
});

test('copy-phase recovery waits when game or PowerShell process state is running or unknown', () => {
  const fx = fixture();
  assert.equal(applyCopy(fx.plan, { fs, path, snapshotManifest: fx.prepared.manifest }).ok, true);

  const states = [
    { gameRunning: true, powershellRunning: false },
    { gameRunning: null, powershellRunning: false },
    { gameRunning: false, powershellRunning: true },
    { gameRunning: false, powershellRunning: null }
  ];
  let deferred;
  for (const state of states) {
    const result = recoverTransaction(transaction(fx, 'copying'), {
      fs, path, gameDir: fx.gameDir, backupDir: fx.backupDir, ...state
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'process-state-unknown');
    assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'Aurora');
    assert.ok(fs.existsSync(fx.prepared.manifest.find(item => item.rel === 'dxgi.dll').snapshot));
    deferred = result;
  }
  assert.equal(deferred.transaction.recoveryKind, 'copy-rollback');
  const retry = recoverTransaction(deferred.transaction, {
    fs, path, gameDir: fx.gameDir, backupDir: fx.backupDir, gameRunning: false, powershellRunning: false
  });
  assert.equal(retry.ok, true);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'ORIGINAL');
});

test('script-phase recovery preserves installed files and offers an incomplete record', () => {
  const fx = fixture();
  assert.equal(applyCopy(fx.plan, { fs, path, snapshotManifest: fx.prepared.manifest }).ok, true);
  let runnerCalled = false;

  const result = recoverTransaction(transaction(fx, 'script-running'), {
    fs, path, gameDir: fx.gameDir, backupDir: fx.backupDir, gameRunning: false, powershellRunning: false,
    runner: async () => { runnerCalled = true; }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'manual-restore-required');
  assert.equal(result.record.status, 'incomplete');
  assert.equal(result.transaction.phase, 'needs-recovery');
  assert.equal(runnerCalled, false);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'Aurora');
});

test('failed automatic rollback keeps its transaction snapshot for another attempt', () => {
  const fx = fixture();
  assert.equal(applyCopy(fx.plan, { fs, path, snapshotManifest: fx.prepared.manifest }).ok, true);
  const snapshot = fx.prepared.manifest.find(item => item.rel === 'dxgi.dll').snapshot;
  const failingFs = Object.create(fs);
  failingFs.copyFileSync = (from, to) => {
    if (from === snapshot && to === path.join(fx.gameDir, 'dxgi.dll')) throw new Error('restore failed');
    return fs.copyFileSync(from, to);
  };

  const result = recoverTransaction(transaction(fx, 'copying'), {
    fs: failingFs, path, gameDir: fx.gameDir, backupDir: fx.backupDir, gameRunning: false, powershellRunning: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'recovery-failed');
  assert.equal(result.transaction.phase, 'needs-recovery');
  assert.equal(fs.existsSync(snapshot), true);

  const retry = recoverTransaction(result.transaction, {
    fs, path, gameDir: fx.gameDir, backupDir: fx.backupDir, gameRunning: false, powershellRunning: false
  });
  assert.equal(retry.ok, true);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'ORIGINAL');
});

test('recovery refuses a persisted target outside the selected game and preserves it', () => {
  const fx = fixture();
  const outside = path.join(path.dirname(fx.gameDir), 'outside-important.txt');
  fs.writeFileSync(outside, 'keep me');
  const tx = {
    ...transaction(fx, 'copying'),
    snapshotManifest: [{ rel: '../outside-important.txt', to: outside, existed: false, snapshot: path.join(fx.prepared.snapshotDir, '0000.snapshot') }]
  };

  const result = recoverTransaction(tx, {
    fs, path, gameDir: fx.gameDir, backupDir: fx.backupDir,
    gameRunning: false, powershellRunning: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, 'unsafe-transaction');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep me');
});

test('snapshot cleanup refuses a persisted directory outside Aurora backup storage', () => {
  const fx = fixture();
  const outsideDir = path.join(path.dirname(fx.backupDir), '12345678-1234-4234-8234-123456789abc');
  fs.mkdirSync(outsideDir);
  const marker = path.join(outsideDir, 'keep.txt');
  fs.writeFileSync(marker, 'keep me');

  assert.throws(() => cleanupSnapshot({ snapshotDir: outsideDir }, { fs, path, backupDir: fx.backupDir }), /unsafe-(?:path|transaction)/);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'keep me');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planCopy, applyCopy } = require('../../src/aurora/copy');
const { restoreGame } = require('../../src/aurora/install');

function fixture(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-proxy-switch-'));
  const value = {
    packageRoot: path.join(root, 'package'),
    gameDir: path.join(root, 'game'),
    backupDir: path.join(root, 'backups')
  };
  for (const dir of Object.values(value)) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(value.packageRoot, 'OptiScaler.dll'), 'Aurora DLL');
  fs.writeFileSync(path.join(value.packageRoot, 'runtime_sync.ps1'), 'fake runtime script');
  for (const [name, contents] of Object.entries(files)) fs.writeFileSync(path.join(value.gameDir, name), contents);
  return value;
}

function plan(fx, record, proxy, files = ['OptiScaler.dll', 'runtime_sync.ps1']) {
  return planCopy({
    ...fx,
    files,
    proxy,
    record,
    overwriteConfirmed: true
  });
}

function apply(value) {
  return applyCopy(value, { fs, path });
}

function fakeRunner() {
  return async () => ({ code: 0, stdout: '', stderr: '' });
}

test('switching from an overwritten proxy restores the original before final restore', async () => {
  const fx = fixture({ 'dxgi.dll': 'ORIGINAL DXGI' });
  const first = plan(fx, null, 'dxgi.dll');
  assert.equal(apply(first).ok, true);
  const switched = plan(fx, first.nextRecord, 'winmm.dll');
  assert.equal(apply(switched).ok, true);

  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'ORIGINAL DXGI');
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'winmm.dll'), 'utf8'), 'Aurora DLL');
  const restored = await restoreGame({
    gameDir: fx.gameDir,
    backupDir: fx.backupDir,
    record: switched.nextRecord,
    gameRunning: false
  }, { fs, path, runner: fakeRunner() });

  assert.equal(restored.ok, true);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'ORIGINAL DXGI');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'winmm.dll')), false);
});

test('switching an added proxy removes only that recorded Aurora file', () => {
  const fx = fixture({ 'dxgi.dll': 'UNRELATED USER FILE' });
  const first = plan(fx, null, 'winmm.dll');
  assert.equal(apply(first).ok, true);
  const switched = plan(fx, first.nextRecord, 'version.dll');
  assert.equal(apply(switched).ok, true);

  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'UNRELATED USER FILE');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'winmm.dll')), false);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'version.dll'), 'utf8'), 'Aurora DLL');
});

test('switching fails before writes if the original proxy backup is missing', () => {
  const fx = fixture({ 'dxgi.dll': 'ORIGINAL DXGI' });
  const first = plan(fx, null, 'dxgi.dll');
  assert.equal(apply(first).ok, true);
  const recordedProxy = first.nextRecord.files.find(file => file.rel === 'dxgi.dll');
  fs.rmSync(recordedProxy.backup);

  const switched = plan(fx, first.nextRecord, 'winmm.dll');

  assert.equal(switched.ok, false);
  assert.equal(switched.error, 'restore-blocked');
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'Aurora DLL');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'winmm.dll')), false);
});

test('reinstall refuses a persisted original-backup path outside Aurora storage', () => {
  const fx = fixture({ 'dxgi.dll': 'Aurora DLL' });
  const outsideBackup = path.join(fx.packageRoot, 'untrusted.dll');
  fs.writeFileSync(outsideBackup, 'untrusted bytes');
  const record = {
    proxy: 'dxgi.dll',
    files: [{ rel: 'dxgi.dll', action: 'replaced', backup: outsideBackup }]
  };

  const switched = plan(fx, record, 'winmm.dll');

  assert.equal(switched.ok, false);
  assert.equal(switched.error, 'restore-blocked');
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'Aurora DLL');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'winmm.dll')), false);
});

test('files omitted from a new package retain their restore responsibility', async () => {
  const fx = fixture({ 'notes.txt': 'ORIGINAL NOTES' });
  fs.writeFileSync(path.join(fx.packageRoot, 'notes.txt'), 'Aurora notes');
  const first = plan(fx, null, 'dxgi.dll', ['OptiScaler.dll', 'runtime_sync.ps1', 'notes.txt']);
  assert.equal(apply(first).ok, true);

  const upgraded = plan(fx, first.nextRecord, 'dxgi.dll');
  assert.equal(apply(upgraded).ok, true);
  assert.ok(upgraded.nextRecord.files.some(file => file.rel === 'notes.txt'));
  const restored = await restoreGame({ gameDir: fx.gameDir, backupDir: fx.backupDir, record: upgraded.nextRecord, gameRunning: false }, {
    fs, path, runner: fakeRunner()
  });

  assert.equal(restored.ok, true);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'notes.txt'), 'utf8'), 'ORIGINAL NOTES');
});

test('cycling proxies keeps the original backup intact until final restore', async () => {
  const fx = fixture({ 'dxgi.dll': 'ORIGINAL DXGI' });
  const first = plan(fx, null, 'dxgi.dll');
  assert.equal(apply(first).ok, true);
  const originalBackup = first.nextRecord.files.find(file => file.rel === 'dxgi.dll').backup;
  const second = plan(fx, first.nextRecord, 'winmm.dll');
  assert.equal(apply(second).ok, true);
  const third = plan(fx, second.nextRecord, 'dxgi.dll');
  assert.equal(apply(third).ok, true);

  assert.equal(fs.readFileSync(originalBackup, 'utf8'), 'ORIGINAL DXGI');
  const restored = await restoreGame({ gameDir: fx.gameDir, backupDir: fx.backupDir, record: third.nextRecord, gameRunning: false }, {
    fs, path, runner: fakeRunner()
  });
  assert.equal(restored.ok, true);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'ORIGINAL DXGI');
  assert.equal(fs.existsSync(path.join(fx.gameDir, 'winmm.dll')), false);
});

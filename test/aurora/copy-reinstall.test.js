'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planCopy, applyCopy } = require('../../src/aurora/copy');

function fixture(originalNotes = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-reinstall-'));
  const packageRoot = path.join(root, 'package');
  const gameDir = path.join(root, 'game');
  const backupDir = path.join(root, 'backups');
  for (const dir of [packageRoot, gameDir, backupDir]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(packageRoot, 'OptiScaler.dll'), 'Aurora v1');
  fs.writeFileSync(path.join(packageRoot, 'runtime_sync.ps1'), 'script v1');
  if (originalNotes !== null) fs.writeFileSync(path.join(gameDir, 'notes.txt'), originalNotes);
  return { packageRoot, gameDir, backupDir };
}

function copyPlan(fx, record, files) {
  return planCopy({
    ...fx,
    files,
    proxy: 'dxgi.dll',
    record,
    overwriteConfirmed: true
  });
}

test('failed reinstall preserves a previously added Aurora proxy', () => {
  const fx = fixture();
  const files = ['OptiScaler.dll', 'runtime_sync.ps1'];
  const first = copyPlan(fx, null, files);
  assert.equal(applyCopy(first, { fs, path }).ok, true);

  fs.writeFileSync(path.join(fx.packageRoot, 'OptiScaler.dll'), 'Aurora v2');
  const second = copyPlan(fx, first.nextRecord, files);
  const result = applyCopy(second, { fs, path, failOn: 'runtime_sync.ps1' });

  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'Aurora v1');
});

test('failed reinstall restores replaced files to their pre-reinstall contents', () => {
  const fx = fixture('game-original');
  fs.writeFileSync(path.join(fx.packageRoot, 'notes.txt'), 'package v1');
  const files = ['OptiScaler.dll', 'notes.txt', 'runtime_sync.ps1'];
  const first = copyPlan(fx, null, files);
  assert.equal(applyCopy(first, { fs, path }).ok, true);

  fs.writeFileSync(path.join(fx.packageRoot, 'OptiScaler.dll'), 'Aurora v2');
  fs.writeFileSync(path.join(fx.packageRoot, 'notes.txt'), 'package v2');
  const second = copyPlan(fx, first.nextRecord, files);
  const result = applyCopy(second, { fs, path, failOn: 'notes.txt' });

  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'Aurora v1');
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'notes.txt'), 'utf8'), 'package v1');
});

test('failed reinstall never overwrites the original-game backup', () => {
  const fx = fixture('game-original');
  fs.writeFileSync(path.join(fx.packageRoot, 'notes.txt'), 'package v1');
  const files = ['OptiScaler.dll', 'notes.txt', 'runtime_sync.ps1'];
  const first = copyPlan(fx, null, files);
  assert.equal(applyCopy(first, { fs, path }).ok, true);
  const notes = first.nextRecord.files.find(file => file.rel === 'notes.txt');
  const originalBackup = fs.readFileSync(notes.backup);

  fs.writeFileSync(path.join(fx.packageRoot, 'notes.txt'), 'package v2');
  const second = copyPlan(fx, first.nextRecord, files);
  applyCopy(second, { fs, path, failOn: 'runtime_sync.ps1' });

  assert.deepEqual(fs.readFileSync(notes.backup), originalBackup);
  assert.equal(fs.readFileSync(notes.backup, 'utf8'), 'game-original');
});

test('copy that partially writes then throws is rolled back to the previous file', () => {
  const fx = fixture();
  const files = ['OptiScaler.dll', 'runtime_sync.ps1'];
  const first = copyPlan(fx, null, files);
  assert.equal(applyCopy(first, { fs, path }).ok, true);
  fs.writeFileSync(path.join(fx.packageRoot, 'OptiScaler.dll'), 'Aurora v2');
  const second = copyPlan(fx, first.nextRecord, files);
  const failingFs = Object.create(fs);
  failingFs.copyFileSync = (from, to) => {
    if (from === path.join(fx.packageRoot, 'OptiScaler.dll') && to === path.join(fx.gameDir, 'dxgi.dll')) {
      fs.writeFileSync(to, 'partial');
      throw new Error('disk full');
    }
    return fs.copyFileSync(from, to);
  };

  const result = applyCopy(second, { fs: failingFs, path });

  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(path.join(fx.gameDir, 'dxgi.dll'), 'utf8'), 'Aurora v1');
});

test('failed rollback reports the error and keeps its recovery snapshot', () => {
  const fx = fixture();
  const files = ['OptiScaler.dll', 'runtime_sync.ps1'];
  const first = copyPlan(fx, null, files);
  assert.equal(applyCopy(first, { fs, path }).ok, true);
  fs.writeFileSync(path.join(fx.packageRoot, 'OptiScaler.dll'), 'Aurora v2');
  const second = copyPlan(fx, first.nextRecord, files);
  const dxgiSnapshot = second.snapshots && second.snapshots.find(item => item.rel === 'dxgi.dll');
  const failingFs = Object.create(fs);
  failingFs.copyFileSync = (from, to) => {
    if (dxgiSnapshot && from === dxgiSnapshot.snapshot && to === path.join(fx.gameDir, 'dxgi.dll')) {
      throw new Error('rollback disk failure');
    }
    return fs.copyFileSync(from, to);
  };

  const result = applyCopy(second, { fs: failingFs, path, failOn: 'runtime_sync.ps1' });

  assert.equal(result.ok, false);
  assert.equal(result.rollbackFailed, true);
  assert.ok(dxgiSnapshot && fs.existsSync(dxgiSnapshot.snapshot));
});

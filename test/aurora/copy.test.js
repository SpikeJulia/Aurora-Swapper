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

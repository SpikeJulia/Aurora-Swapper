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

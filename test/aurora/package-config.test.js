'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../../package.json');

test('Windows uninstall retains app data and Aurora installer names stay stable', () => {
  assert.equal(pkg.build.appId, 'local.aurora.swapper');
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pkg.build.nsis.artifactName, 'Aurora-Swapper-Setup-${version}.exe');
  assert.equal(pkg.build.portable.artifactName, 'Aurora-Swapper-${version}-portable.exe');
});

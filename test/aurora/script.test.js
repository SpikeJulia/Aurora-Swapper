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

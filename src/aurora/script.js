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

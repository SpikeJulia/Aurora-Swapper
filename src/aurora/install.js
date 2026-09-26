'use strict';
const path = require('path');
const { validatePackage } = require('./package');
const { planCopy, applyCopy } = require('./copy');
const { powershellCommand, restoreDecision } = require('./script');

function walk(fs, root, base = root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) walk(fs, abs, base, out);
    else out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

function outputOf(result) {
  return [result.stdout, result.stderr].filter(Boolean).join('\n');
}

async function installGame(input, deps) {
  const { fs, path: nodePath, runner } = deps;
  const pathApi = nodePath || path;
  if (input.gameRunning === true) return { ok: false, error: 'game-running' };
  const pkg = validatePackage(input.packageRoot);
  if (!pkg.ok) return { ok: false, error: 'package-invalid', reason: pkg.reason };
  const files = walk(fs, input.packageRoot);
  const plan = planCopy({
    packageRoot: input.packageRoot,
    gameDir: input.gameDir,
    backupDir: input.backupDir,
    files,
    proxy: input.proxy,
    record: input.record,
    overwriteConfirmed: input.overwriteConfirmed
  });
  if (!plan.ok) return { ok: false, error: plan.error };
  const applied = applyCopy(plan, { fs, path: pathApi });
  if (!applied.ok) return { ok: false, error: 'copy-failed', message: applied.message };
  const ran = await runner(powershellCommand(pathApi.join(input.gameDir, 'runtime_sync.ps1'), 'Install', input.gameDir));
  if (ran.code !== 0) {
    return { ok: false, error: 'script-failed', status: 'incomplete', record: plan.nextRecord, output: outputOf(ran) };
  }
  let addonFailure = null;
  const taken = new Set(plan.nextRecord.files.map(file => file.rel.toLowerCase()));
  for (const addon of input.addons || []) {
    if ((addon.files || []).some(file => taken.has(String(file.rel).toLowerCase()))) {
      addonFailure = addon.name;
      continue;
    }
    for (const file of addon.files || []) {
      const dest = pathApi.join(input.gameDir, file.rel);
      fs.mkdirSync(pathApi.dirname(dest), { recursive: true });
      fs.copyFileSync(file.from, dest);
    }
  }
  return {
    ok: true,
    status: 'installed',
    record: { ...plan.nextRecord, status: 'installed' },
    addonFailure,
    unconfirmedClose: input.gameRunning === null,
    output: outputOf(ran)
  };
}

async function checkGame(input, deps) {
  if (!input.record) return { ok: false, error: 'not-installed' };
  if (input.gameRunning === true) return { ok: false, error: 'game-running' };
  const { path: nodePath, runner } = deps;
  const pathApi = nodePath || path;
  const ran = await runner(powershellCommand(pathApi.join(input.gameDir, 'runtime_sync.ps1'), 'Check', input.gameDir));
  const output = outputOf(ran);
  if (ran.code !== 0) return { ok: false, error: 'script-failed', status: 'incomplete', output };
  return { ok: true, status: 'installed', output };
}

async function restoreGame(input, deps) {
  if (!input.record) return { ok: false, error: 'not-installed' };
  if (input.gameRunning === true) return { ok: false, error: 'game-running' };
  const { fs, path: nodePath, runner } = deps;
  const pathApi = nodePath || path;
  const scriptPath = pathApi.join(input.gameDir, 'runtime_sync.ps1');
  const scriptExists = fs.existsSync(scriptPath);
  const runtimeSyncExists = fs.existsSync(pathApi.join(input.gameDir, 'OptiScaler', 'RuntimeSync'));
  let exitCode = null;
  let output = '';
  if (scriptExists) {
    const ran = await runner(powershellCommand(scriptPath, 'Restore', input.gameDir));
    exitCode = ran.code;
    output = outputOf(ran);
  }
  if (restoreDecision({ scriptExists, runtimeSyncExists, exitCode }) === 'stop') {
    return { ok: false, error: 'restore-blocked', record: input.record, output };
  }
  for (const file of input.record.files || []) fs.rmSync(pathApi.join(input.gameDir, file.rel), { force: true });
  return { ok: true, status: 'not-installed', record: null, output };
}

module.exports = { installGame, checkGame, restoreGame };

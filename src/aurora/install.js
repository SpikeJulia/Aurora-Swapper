'use strict';
const path = require('path');
const { validatePackage } = require('./package');
const { planCopy, prepareCopy, applyCopy, restoreCopy, cleanupSnapshot } = require('./copy');
const { powershellCommand, restoreDecision } = require('./script');
const { resolveRecorded, resolveRelative, validateRecord } = require('./paths');

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
  const checkpoint = typeof deps.checkpoint === 'function' ? deps.checkpoint : async () => {};
  const prepared = prepareCopy(plan, { fs, path: pathApi });
  if (!prepared.ok) return { ok: false, error: 'copy-failed', message: prepared.message };
  const cleanSnapshot = () => cleanupSnapshot({ snapshotDir: prepared.snapshotDir }, {
    fs, path: pathApi, backupDir: input.backupDir
  });
  let transaction = {
    id: pathApi.basename(plan.snapshotDir),
    gameDir: input.gameDir,
    exePath: input.exePath || null,
    phase: 'prepared',
    previousRecord: input.record || null,
    nextRecord: plan.nextRecord,
    snapshotDir: prepared.snapshotDir,
    snapshotManifest: prepared.manifest
  };
  try {
    await checkpoint(transaction);
    transaction = { ...transaction, phase: 'copying' };
    await checkpoint(transaction);
  } catch (error) {
    return { ok: false, error: 'checkpoint-failed', message: error.message, transaction };
  }

  const applied = applyCopy(plan, { fs, path: pathApi, snapshotManifest: prepared.manifest });
  if (!applied.ok) {
    if (applied.rollbackFailed) {
      transaction = { ...transaction, phase: 'needs-recovery', recoveryKind: 'copy-rollback' };
      try { await checkpoint(transaction); } catch { /* The previous copying checkpoint still references the snapshot. */ }
      return { ...applied, status: 'incomplete', needsRecovery: true, record: { ...plan.nextRecord, status: 'incomplete' } };
    }
    try {
      await checkpoint(null, { gameDir: input.gameDir, record: input.record || null });
      try { cleanSnapshot(); } catch { /* The committed store no longer references it. */ }
    } catch (error) {
      return { ok: false, error: 'checkpoint-failed', message: error.message, transaction };
    }
    return { ok: false, error: 'copy-failed', message: applied.message };
  }

  try {
    transaction = { ...transaction, phase: 'script-running' };
    await checkpoint(transaction);
  } catch (error) {
    const rolledBack = restoreCopy(prepared.manifest, {
      fs, path: pathApi, gameDir: input.gameDir, backupDir: input.backupDir,
      snapshotDir: prepared.snapshotDir
    });
    if (rolledBack.ok) {
      try {
        await checkpoint(null, { gameDir: input.gameDir, record: input.record || null });
        try { cleanSnapshot(); } catch { /* The committed store no longer references it. */ }
      } catch { /* The persisted copying checkpoint remains safe to replay. */ }
    } else {
      transaction = { ...transaction, phase: 'needs-recovery', recoveryKind: 'copy-rollback' };
      try { await checkpoint(transaction); } catch { /* Keep the last durable checkpoint and snapshot. */ }
    }
    return { ok: false, error: 'checkpoint-failed', message: error.message, needsRecovery: !rolledBack.ok };
  }

  let ran;
  try {
    ran = await runner(powershellCommand(pathApi.join(input.gameDir, 'runtime_sync.ps1'), 'Install', input.gameDir));
  } catch (error) {
    const record = { ...plan.nextRecord, status: 'incomplete' };
    transaction = { ...transaction, phase: 'needs-recovery', recoveryKind: 'script-restore', nextRecord: record };
    try { await checkpoint(transaction); } catch { /* script-running is also treated as incomplete during startup. */ }
    return {
      ok: false, error: 'script-failed', status: 'incomplete', needsRecovery: true,
      record, output: error.message
    };
  }
  const output = outputOf(ran);
  const installedRecord = { ...plan.nextRecord, status: ran.code === 0 ? 'installed' : 'incomplete' };
  if (ran.code !== 0) {
    try {
      await checkpoint(null, { gameDir: input.gameDir, record: installedRecord });
      try { cleanSnapshot(); } catch { /* The incomplete record is committed. */ }
    } catch (error) {
      transaction = {
        ...transaction, phase: 'needs-recovery', recoveryKind: 'script-restore',
        nextRecord: { ...plan.nextRecord, status: 'incomplete' }
      };
      try { await checkpoint(transaction); } catch { /* Keep the durable script-running checkpoint and its snapshot. */ }
      return {
        ok: false, error: 'script-failed', status: 'incomplete', needsRecovery: true,
        record: transaction.nextRecord, output: output || error.message
      };
    }
    return { ok: false, error: 'script-failed', status: 'incomplete', record: installedRecord, output };
  }
  let addonFailure = null;
  const taken = new Set(plan.nextRecord.files.map(file => file.rel.toLowerCase()));
  for (const addon of input.addons || []) {
    if ((addon.files || []).some(file => taken.has(String(file.rel).toLowerCase()))) {
      addonFailure = addon.name;
      continue;
    }
    try {
      for (const file of addon.files || []) {
        const dest = pathApi.join(input.gameDir, file.rel);
        fs.mkdirSync(pathApi.dirname(dest), { recursive: true });
        fs.copyFileSync(file.from, dest);
      }
    } catch {
      addonFailure = addon.name;
    }
  }
  try {
    await checkpoint(null, { gameDir: input.gameDir, record: installedRecord });
    try { cleanSnapshot(); } catch { /* The installed record is committed. */ }
  } catch (error) {
    transaction = {
      ...transaction, phase: 'needs-recovery', recoveryKind: 'script-restore',
      nextRecord: { ...plan.nextRecord, status: 'incomplete' }
    };
    try { await checkpoint(transaction); } catch { /* The script-running transaction still prevents a false success. */ }
    return {
      ok: false, error: 'checkpoint-failed', status: 'incomplete', needsRecovery: true,
      record: transaction.nextRecord, output: error.message
    };
  }
  return {
    ok: true,
    status: 'installed',
    record: installedRecord,
    addonFailure,
    unconfirmedClose: input.gameRunning === null,
    output
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
  let files;
  try {
    files = validateRecord(input.record, {
      gameDir: input.gameDir, backupDir: input.backupDir, fs, path: pathApi
    });
  } catch {
    return { ok: false, error: 'restore-blocked', record: input.record, output: '' };
  }
  const replaced = files.filter(file => file.action === 'replaced');
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
  let operations;
  try {
    operations = files.map(file => ({
      file,
      dest: resolveRelative(input.gameDir, file.rel, { fs, path: pathApi }),
      ...(file.action === 'replaced'
        ? { backup: resolveRecorded(input.backupDir, file.backup, { fs, path: pathApi }) }
        : {})
    }));
    if (operations.some(operation => operation.backup && !fs.existsSync(operation.backup))) throw new Error('missing-backup');
  } catch {
    return { ok: false, error: 'restore-blocked', record: input.record, output };
  }
  try {
    for (const operation of operations) {
      if (operation.backup) {
        fs.mkdirSync(pathApi.dirname(operation.dest), { recursive: true });
        fs.copyFileSync(operation.backup, operation.dest);
      }
    }
    for (const operation of operations) {
      if (operation.file.action === 'added') fs.rmSync(operation.dest, { force: true });
    }
  } catch {
    return { ok: false, error: 'restore-blocked', record: input.record, output };
  }
  return { ok: true, status: 'not-installed', record: null, output };
}

module.exports = { installGame, checkGame, restoreGame };

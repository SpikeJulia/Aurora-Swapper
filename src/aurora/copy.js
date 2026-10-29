'use strict';
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { PROXY_FILES } = require('./games');
const { resolveRelative, validateRecord, validateSnapshotDir, validateSnapshotManifest } = require('./paths');

function relPosix(value) { return value.split(path.sep).join('/'); }

function planCopy({ packageRoot, gameDir, backupDir, files, proxy, record, overwriteConfirmed }) {
  if (!PROXY_FILES.includes(proxy)) return { ok: false, error: 'bad-proxy' };
  let previousFiles;
  try {
    previousFiles = record ? validateRecord(record, { gameDir, backupDir }) : [];
  } catch {
    return { ok: false, error: 'restore-blocked' };
  }
  const switchingProxy = Boolean(record?.proxy && record.proxy.toLowerCase() !== proxy.toLowerCase());
  const previousProxyFile = switchingProxy
    ? previousFiles.find(item => String(item.rel).toLowerCase() === record.proxy.toLowerCase())
    : null;
  if (switchingProxy && (!previousProxyFile || !['added', 'replaced'].includes(previousProxyFile.action))) {
    return { ok: false, error: 'restore-blocked' };
  }
  const recorded = new Set(previousFiles.map(file => file.rel.toLowerCase()));
  const targetRel = proxy;
  let targetAbs;
  try { targetAbs = resolveRelative(gameDir, proxy); } catch { return { ok: false, error: 'unsafe-path' }; }
  const targetIsRecorded = recorded.has(proxy.toLowerCase());
  if (fs.existsSync(targetAbs) && !targetIsRecorded && overwriteConfirmed !== true) {
    return { ok: false, error: 'proxy-exists' };
  }
  const operations = [];
  const nextFiles = [];
  for (const file of files) {
    const rel = relPosix(file);
    if (rel.toLowerCase() === 'optiscaler.sln') continue;
    let from;
    const destRel = rel.toLowerCase() === 'optiscaler.dll' ? targetRel : rel;
    let dest;
    try {
      from = resolveRelative(packageRoot, rel);
      dest = resolveRelative(gameDir, destRel);
    } catch { return { ok: false, error: 'unsafe-path' }; }
    const prior = previousFiles.find(item => String(item.rel).toLowerCase() === destRel.toLowerCase());
    const keptBackup = prior && prior.action === 'replaced' && typeof prior.backup === 'string' && prior.backup
      ? prior.backup
      : null;
    if (keptBackup) {
      // The first overwrite already saved the original. Do not replace that backup with Aurora.
      nextFiles.push({ rel: destRel, action: 'replaced', backup: keptBackup });
    } else if (prior && prior.action === 'added') {
      nextFiles.push({ rel: destRel, action: 'added' });
    } else if (fs.existsSync(dest)) {
      let backupTo;
      try { backupTo = resolveRelative(backupDir, destRel); } catch { return { ok: false, error: 'unsafe-path' }; }
      operations.push({ op: 'backup', rel: destRel, from: dest, to: backupTo });
      nextFiles.push({ rel: destRel, action: 'replaced', backup: backupTo });
    } else {
      nextFiles.push({ rel: destRel, action: 'added' });
    }
    operations.push({ op: 'write', rel: destRel, from, to: dest });
  }
  const nextKeys = new Set(nextFiles.map(item => String(item.rel).toLowerCase()));
  for (const previous of previousFiles) {
    const key = String(previous.rel).toLowerCase();
    if (nextKeys.has(key)) continue;
    if (switchingProxy && key === record.proxy.toLowerCase()) continue;
    nextKeys.add(key);
    nextFiles.push({ ...previous });
  }
  if (switchingProxy) {
    const oldProxyKey = record.proxy.toLowerCase();
    for (let index = nextFiles.length - 1; index >= 0; index--) {
      if (String(nextFiles[index].rel).toLowerCase() === oldProxyKey) nextFiles.splice(index, 1);
    }
    const oldProxyPath = path.join(gameDir, previousProxyFile.rel);
    if (previousProxyFile.action === 'replaced') {
      operations.push({
        op: 'write', rel: previousProxyFile.rel, from: previousProxyFile.backup, to: oldProxyPath
      });
    } else {
      operations.push({ op: 'delete', rel: previousProxyFile.rel, to: oldProxyPath });
    }
  }
  const snapshotId = crypto.randomUUID();
  const snapshotDir = path.join(backupDir, '.transactions', snapshotId);
  const seenTargets = new Set();
  const snapshots = [];
  for (const op of operations) {
    if (op.op !== 'write' && op.op !== 'delete') continue;
    const key = path.resolve(op.to).toLowerCase();
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    snapshots.push({
      rel: op.rel,
      to: op.to,
      existed: fs.existsSync(op.to),
      snapshot: path.join(snapshotDir, `${String(snapshots.length).padStart(4, '0')}.snapshot`)
    });
  }
  return {
    ok: true,
    gameDir,
    backupDir,
    operations,
    nextRecord: { proxy, files: nextFiles },
    snapshotDir,
    snapshots
  };
}

function prepareCopy(plan, { fs: fsApi = fs, path: pathApi = path } = {}) {
  try {
    validateSnapshotManifest(plan.snapshots || [], {
      gameDir: plan.gameDir, backupDir: plan.backupDir, snapshotDir: plan.snapshotDir,
      fs: fsApi, path: pathApi
    });
    for (const item of plan.snapshots || []) {
      if (!item.existed) continue;
      fsApi.mkdirSync(pathApi.dirname(item.snapshot), { recursive: true });
      fsApi.copyFileSync(item.to, item.snapshot);
      fsApi.chmodSync(item.snapshot, 0o600);
      const fd = fsApi.openSync(item.snapshot, 'r+');
      try { fsApi.fsyncSync(fd); } finally { fsApi.closeSync(fd); }
    }
    return { ok: true, manifest: plan.snapshots || [], snapshotDir: plan.snapshotDir };
  } catch (error) {
    try {
      const safe = validateSnapshotDir(plan.snapshotDir, plan.backupDir, { fs: fsApi, path: pathApi });
      fsApi.rmSync(safe.path, { recursive: true, force: true });
    } catch { /* Game files are still untouched; invalid paths are never cleaned up. */ }
    return { ok: false, error: 'snapshot-failed', message: error.message };
  }
}

function restoreCopy(manifest, { fs: fsApi = fs, path: pathApi = path, gameDir, backupDir, snapshotDir } = {}) {
  try {
    validateSnapshotManifest(manifest, { gameDir, backupDir, snapshotDir, fs: fsApi, path: pathApi });
  } catch (error) {
    return { ok: false, message: error.message || 'unsafe-transaction' };
  }
  let failed = false;
  let message = '';
  for (const item of [...manifest].reverse()) {
    try {
      if (item.existed) {
        if (!fsApi.existsSync(item.snapshot)) throw new Error(`Missing recovery snapshot for ${item.rel}`);
        fsApi.mkdirSync(pathApi.dirname(item.to), { recursive: true });
        fsApi.copyFileSync(item.snapshot, item.to);
      } else {
        fsApi.rmSync(item.to, { force: true });
      }
    } catch (error) {
      failed = true;
      if (!message) message = error.message;
    }
  }
  return failed ? { ok: false, message } : { ok: true };
}

function cleanupSnapshot(manifest, { fs: fsApi = fs, path: pathApi = path, backupDir } = {}) {
  if (manifest && manifest.snapshotDir) {
    const safe = validateSnapshotDir(manifest.snapshotDir, backupDir, { fs: fsApi, path: pathApi });
    fsApi.rmSync(safe.path, { recursive: true, force: true });
  }
}

function applyCopy(plan, { fs: fsApi = fs, path: pathApi = path, failOn = null, snapshotManifest = null } = {}) {
  const prepared = snapshotManifest
    ? { ok: true, manifest: snapshotManifest, snapshotDir: plan.snapshotDir }
    : prepareCopy(plan, { fs: fsApi, path: pathApi });
  if (!prepared.ok) return prepared;
  try {
    for (const op of plan.operations) {
      if (op.op === 'backup') {
        fsApi.mkdirSync(pathApi.dirname(op.to), { recursive: true });
        fsApi.copyFileSync(op.from, op.to);
      } else if (op.op === 'write') {
        if (failOn && op.rel === failOn) throw new Error('forced failure');
        fsApi.mkdirSync(pathApi.dirname(op.to), { recursive: true });
        fsApi.copyFileSync(op.from, op.to);
      } else if (op.op === 'delete') {
        if (fsApi.existsSync(op.to)) fsApi.rmSync(op.to);
      }
    }
    return { ok: true, snapshotManifest: prepared.manifest, snapshotDir: prepared.snapshotDir };
  } catch (error) {
    const rolledBack = restoreCopy(prepared.manifest, {
      fs: fsApi, path: pathApi, gameDir: plan.gameDir, backupDir: plan.backupDir,
      snapshotDir: prepared.snapshotDir
    });
    return {
      ok: false,
      error: 'copy-failed',
      message: error.message,
      rollbackFailed: !rolledBack.ok,
      rollbackMessage: rolledBack.message,
      snapshotManifest: prepared.manifest,
      snapshotDir: prepared.snapshotDir
    };
  }
}

module.exports = { planCopy, prepareCopy, applyCopy, restoreCopy, cleanupSnapshot };

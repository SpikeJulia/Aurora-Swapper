'use strict';
const fs = require('fs');
const path = require('path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function samePath(left, right, pathApi = path) {
  const a = pathApi.resolve(left);
  const b = pathApi.resolve(right);
  return pathApi.sep === '\\' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isWithin(root, target, pathApi = path) {
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(target));
  return relative !== '' && relative !== '..' &&
    !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative);
}

function rejectSymlinkParents(root, target, fsApi, pathApi) {
  const absoluteRoot = pathApi.resolve(root);
  let current = pathApi.resolve(target);
  if (!isWithin(absoluteRoot, current, pathApi)) throw new Error('unsafe-path');
  while (true) {
    try {
      if (fsApi.lstatSync(current).isSymbolicLink()) throw new Error('unsafe-path');
    } catch (error) {
      if (error.message === 'unsafe-path' || error.code !== 'ENOENT') throw error;
    }
    if (samePath(current, absoluteRoot, pathApi)) break;
    current = pathApi.dirname(current);
  }
}

function resolveRelative(root, rel, { fs: fsApi = fs, path: pathApi = path } = {}) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\') || rel.includes(':')) {
    throw new Error('unsafe-path');
  }
  const parts = rel.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('unsafe-path');
  if (pathApi.sep === '\\' && parts.some(part => /[. ]$/.test(part))) throw new Error('unsafe-path');
  const target = pathApi.resolve(root, ...parts);
  if (!isWithin(root, target, pathApi)) throw new Error('unsafe-path');
  rejectSymlinkParents(root, target, fsApi, pathApi);
  return target;
}

function resolveRecorded(root, candidate, { fs: fsApi = fs, path: pathApi = path } = {}) {
  if (typeof candidate !== 'string' || !candidate || !pathApi.isAbsolute(candidate)) {
    throw new Error('unsafe-path');
  }
  const target = pathApi.resolve(candidate);
  if (!isWithin(root, target, pathApi)) throw new Error('unsafe-path');
  rejectSymlinkParents(root, target, fsApi, pathApi);
  return target;
}

function validateRecord(record, { gameDir, backupDir, fs: fsApi = fs, path: pathApi = path } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      typeof gameDir !== 'string' || !pathApi.isAbsolute(gameDir)) throw new Error('unsafe-record');
  const files = record.files === undefined ? [] : record.files;
  if (!Array.isArray(files)) throw new Error('unsafe-record');
  const seen = new Set();
  for (const file of files) {
    if (!file || typeof file !== 'object' || Array.isArray(file) || !['added', 'replaced'].includes(file.action)) {
      throw new Error('unsafe-record');
    }
    const target = resolveRelative(gameDir, file.rel, { fs: fsApi, path: pathApi });
    const key = pathApi.sep === '\\' ? target.toLowerCase() : target;
    if (seen.has(key)) throw new Error('unsafe-record');
    seen.add(key);
    if (file.action === 'replaced') {
      if (!backupDir) throw new Error('unsafe-record');
      const backup = resolveRecorded(backupDir, file.backup, { fs: fsApi, path: pathApi });
      const expected = resolveRelative(backupDir, file.rel, { fs: fsApi, path: pathApi });
      if (!samePath(backup, expected, pathApi) || !fsApi.lstatSync(backup).isFile()) throw new Error('unsafe-record');
    }
  }
  return files;
}

function validateSnapshotDir(snapshotDir, backupDir, { fs: fsApi = fs, path: pathApi = path } = {}) {
  if (typeof backupDir !== 'string' || !pathApi.isAbsolute(backupDir) ||
      typeof snapshotDir !== 'string' || !pathApi.isAbsolute(snapshotDir)) throw new Error('unsafe-transaction');
  const id = pathApi.basename(snapshotDir);
  if (!UUID.test(id)) throw new Error('unsafe-transaction');
  const transactionsDir = pathApi.join(backupDir, '.transactions');
  const expected = pathApi.join(transactionsDir, id);
  const actual = resolveRecorded(transactionsDir, snapshotDir, { fs: fsApi, path: pathApi });
  if (!samePath(actual, expected, pathApi)) throw new Error('unsafe-transaction');
  resolveRelative(backupDir, `.transactions/${id}`, { fs: fsApi, path: pathApi });
  return { id, path: expected };
}

function validateSnapshotManifest(manifest, { gameDir, backupDir, snapshotDir, fs: fsApi = fs, path: pathApi = path } = {}) {
  if (!Array.isArray(manifest)) throw new Error('unsafe-transaction');
  const snapshotRoot = validateSnapshotDir(snapshotDir, backupDir, { fs: fsApi, path: pathApi });
  const seenTargets = new Set();
  for (let index = 0; index < manifest.length; index++) {
    const item = manifest[index];
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.existed !== 'boolean') {
      throw new Error('unsafe-transaction');
    }
    const target = resolveRelative(gameDir, item.rel, { fs: fsApi, path: pathApi });
    const recordedTarget = resolveRecorded(gameDir, item.to, { fs: fsApi, path: pathApi });
    if (!samePath(target, recordedTarget, pathApi)) throw new Error('unsafe-transaction');
    const key = pathApi.sep === '\\' ? target.toLowerCase() : target;
    if (seenTargets.has(key)) throw new Error('unsafe-transaction');
    seenTargets.add(key);
    const expectedSnapshot = pathApi.join(snapshotRoot.path, `${String(index).padStart(4, '0')}.snapshot`);
    const recordedSnapshot = resolveRecorded(snapshotRoot.path, item.snapshot, { fs: fsApi, path: pathApi });
    if (!samePath(expectedSnapshot, recordedSnapshot, pathApi)) throw new Error('unsafe-transaction');
  }
  return true;
}

function validateTransaction(transaction, { gameDir, backupDir, fs: fsApi = fs, path: pathApi = path } = {}) {
  if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction) ||
      typeof gameDir !== 'string' || !pathApi.isAbsolute(gameDir) || !samePath(transaction.gameDir, gameDir, pathApi)) {
    throw new Error('unsafe-transaction');
  }
  validateSnapshotManifest(transaction.snapshotManifest, {
    gameDir, backupDir, snapshotDir: transaction.snapshotDir, fs: fsApi, path: pathApi
  });
  return true;
}

module.exports = {
  isWithin,
  resolveRelative,
  resolveRecorded,
  samePath,
  validateRecord,
  validateSnapshotDir,
  validateSnapshotManifest,
  validateTransaction
};

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const extractZip = require('extract-zip');
const sevenZip = require('7zip-bin');
const { preferredSource, sourceDefinition, releaseAsset } = require('./shared/aurora-package-source');
const { validatePackage: defaultValidatePackage } = require('./aurora/package');

const execFileAsync = promisify(execFile);

function packageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function ensureNotAborted(signal) {
  if (signal?.aborted) throw packageError('cancelled', 'Aurora package download was cancelled.');
}

async function readRelease(apiUrl, fetchImpl, signal) {
  ensureNotAborted(signal);
  let response;
  try {
    response = await fetchImpl(apiUrl, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'Aurora-Swapper' },
      signal
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw packageError('cancelled', 'Aurora package download was cancelled.');
    throw packageError('network-failed', error.message || 'Could not read the Aurora Release.');
  }
  if (!response || response.ok !== true) {
    throw packageError('network-failed', `Aurora Release request failed (${response?.status || 'unknown'}).`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw packageError('release-invalid', error.message || 'Aurora Release metadata is not valid JSON.');
  }
}

async function downloadFile(url, destination, { fetchImpl, signal, onProgress } = {}) {
  ensureNotAborted(signal);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { 'user-agent': 'Aurora-Swapper' },
      signal,
      redirect: 'follow'
    });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw packageError('cancelled', 'Aurora package download was cancelled.');
    throw packageError('network-failed', error.message || 'Could not download the Aurora package.');
  }
  if (!response || response.ok !== true || !response.body) {
    throw packageError('network-failed', `Aurora package download failed (${response?.status || 'unknown'}).`);
  }
  const total = Number(response.headers?.get?.('content-length') || 0) || null;
  let received = 0;
  let handle;
  try {
    handle = await fs.promises.open(destination, 'wx');
    for await (const chunk of response.body) {
      ensureNotAborted(signal);
      const buffer = Buffer.from(chunk);
      await handle.write(buffer);
      received += buffer.length;
      onProgress?.({ phase: 'downloading', received, total });
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError' || error?.code === 'ABORT_ERR') {
      throw packageError('cancelled', 'Aurora package download was cancelled.');
    }
    throw error;
  } finally {
    try { await handle?.close(); } catch { /* Preserve the original download error. */ }
    if (signal?.aborted) await fs.promises.rm(destination, { force: true }).catch(() => {});
  }
}

async function extractArchive(archive, destination, { signal } = {}) {
  ensureNotAborted(signal);
  if (/\.zip$/i.test(archive)) {
    await extractZip(archive, { dir: destination });
    return;
  }
  if (!/\.7z$/i.test(archive)) throw packageError('archive-unsupported', 'Aurora package must be a .7z or .zip archive.');
  try {
    await execFileAsync(sevenZip.path7za, ['x', archive, `-o${destination}`, '-y'], { windowsHide: true });
  } catch (error) {
    throw packageError('extract-failed', error.message || 'Could not extract the Aurora package.');
  }
}

async function verifyFile(file, expected) {
  const hash = crypto.createHash('sha256');
  try {
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  } catch (error) {
    throw packageError('download-incomplete', error.message || 'The Aurora package could not be read after download.');
  }
  return hash.digest('hex') === String(expected).toLowerCase();
}

async function assertSafeTree(root) {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw packageError('unsafe-archive', 'The Aurora package contains a symbolic link.');
    if (entry.isDirectory()) await assertSafeTree(target);
  }
}

async function findPackageRoot(root, validatePackage) {
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    if (validatePackage(current.dir)?.ok) return current.dir;
    if (current.depth >= 3) continue;
    const entries = await fs.promises.readdir(current.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw packageError('unsafe-archive', 'The Aurora package contains a symbolic link.');
      if (entry.isDirectory()) queue.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }
  throw packageError('package-invalid', 'The downloaded Aurora archive is not a valid release package.');
}

function cacheName(version, digest) {
  const safeVersion = String(version).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  if (!safeVersion) throw packageError('release-version-invalid', 'Aurora Release version is invalid.');
  return `Aurora-${safeVersion}-${String(digest).slice(0, 12)}`;
}

function resultError(error) {
  return {
    ok: false,
    code: error?.code || 'download-failed',
    message: error?.message || String(error)
  };
}

async function downloadAuroraPackage(options = {}) {
  const signal = options.signal;
  try {
    ensureNotAborted(signal);
    const source = sourceDefinition(options.source || preferredSource(options.language));
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw packageError('network-unavailable', 'This app cannot access the network runtime.');
    if (typeof options.cacheRoot !== 'string' || !options.cacheRoot) throw packageError('cache-invalid', 'Aurora package cache path is invalid.');
    const validatePackage = options.validatePackage || defaultValidatePackage;
    const metadata = await readRelease(source.apiUrl, fetchImpl, signal);
    const release = releaseAsset(metadata);
    const destination = path.join(options.cacheRoot, cacheName(release.version, release.digest));
    if (validatePackage(destination)?.ok) {
      options.onProgress?.({ phase: 'ready', received: release.size, total: release.size });
      return { ok: true, packageRoot: destination, version: release.version, tag: release.tag, digest: release.digest, source: source.id, cached: true };
    }

    await fs.promises.mkdir(options.cacheRoot, { recursive: true });
    const staging = await fs.promises.mkdtemp(path.join(options.cacheRoot, '.aurora-download-'));
    try {
      const archive = path.join(staging, release.name);
      const extractRoot = path.join(staging, 'extracted');
      await fs.promises.mkdir(extractRoot, { recursive: true });
      const download = options.downloadFile || downloadFile;
      await download(source.assetUrl(release.url), archive, { fetchImpl, signal, onProgress: options.onProgress });
      ensureNotAborted(signal);
      options.onProgress?.({ phase: 'verifying', received: release.size, total: release.size });
      if (!await verifyFile(archive, release.digest)) throw packageError('checksum-mismatch', 'The Aurora package checksum does not match the official Release.');
      const extract = options.extractArchive || extractArchive;
      await extract(archive, extractRoot, { signal });
      ensureNotAborted(signal);
      await assertSafeTree(extractRoot);
      const packageRoot = await findPackageRoot(extractRoot, validatePackage);
      await fs.promises.rename(packageRoot, destination);
      options.onProgress?.({ phase: 'ready', received: release.size, total: release.size });
      return { ok: true, packageRoot: destination, version: release.version, tag: release.tag, digest: release.digest, source: source.id, cached: false };
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  } catch (error) {
    return resultError(error);
  }
}

module.exports = { downloadAuroraPackage, downloadFile, extractArchive, verifyFile, findPackageRoot, readRelease };

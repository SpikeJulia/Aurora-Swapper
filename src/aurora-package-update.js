'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readRelease } = require('./aurora-package-download');
const { preferredSource, sourceDefinition, releaseAsset } = require('./shared/aurora-package-source');

const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const SOURCES = new Set(['official', 'mirror']);

function releaseSummary(value) {
  if (!value || typeof value.version !== 'string' || !value.version.trim()
    || !/^[a-f0-9]{64}$/i.test(String(value.digest || ''))) return null;
  return { version: value.version.trim(), digest: value.digest.toLowerCase() };
}

function readCache(file) {
  const sources = Object.create(null);
  if (!file) return sources;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.schema !== 1) return sources;
    for (const source of SOURCES) {
      const record = saved.sources?.[source];
      if (!record || !Number.isFinite(record.attemptedAt) || record.attemptedAt < 0) continue;
      const release = releaseSummary(record.release);
      const error = record.error && typeof record.error.code === 'string' && typeof record.error.message === 'string'
        ? { code: record.error.code, message: record.error.message } : null;
      if (!release && !error) continue;
      sources[source] = {
        attemptedAt: record.attemptedAt,
        checkedAt: Number.isFinite(record.checkedAt) ? record.checkedAt : null,
        release, error
      };
    }
  } catch { /* This disposable metadata cache never blocks package use. */ }
  return sources;
}

function numericVersion(tag) {
  const match = /^(?:aurora[-_])?v?(\d+(?:\.\d+){0,3})$/i.exec(String(tag || ''));
  return match ? match[1].split('.').map(Number) : null;
}

function comparison(current, latest) {
  if (current.packageOk !== true) return 'available';
  if (current.packageSource === 'local' || !/^[a-f0-9]{64}$/i.test(String(current.packageDigest || ''))) return 'local-unknown';
  if (current.packageDigest.toLowerCase() === latest.digest) return 'up-to-date';
  if (current.packageVersion === latest.version) return 'update-available';
  const before = numericVersion(current.packageVersion);
  const after = numericVersion(latest.version);
  if (!before || !after) return 'different-release';
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    if ((after[i] || 0) < (before[i] || 0)) return 'current-ahead';
    if ((after[i] || 0) > (before[i] || 0)) return 'update-available';
  }
  return 'update-available';
}

function createAuroraUpdateChecker({ cacheFile, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 10000 } = {}) {
  const sources = readCache(cacheFile);
  const inFlight = new Map();
  const generations = new Map();
  let writeQueue = Promise.resolve();

  function persist() {
    if (!cacheFile) return Promise.resolve(true);
    writeQueue = writeQueue.then(async () => {
      const temp = `${cacheFile}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.promises.mkdir(path.dirname(cacheFile), { recursive: true });
        await fs.promises.writeFile(temp, JSON.stringify({ schema: 1, sources }), { encoding: 'utf8', flag: 'wx' });
        await fs.promises.rename(temp, cacheFile);
        return true;
      } catch {
        return false;
      } finally {
        await fs.promises.rm(temp, { force: true }).catch(() => {});
      }
    });
    return writeQueue;
  }

  async function lookup(source) {
    const controller = new AbortController();
    let timer;
    try {
      const metadata = await Promise.race([
        readRelease(sourceDefinition(source).apiUrl, fetchImpl, controller.signal),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            const error = new Error('Aurora update check timed out.');
            error.code = 'update-timeout';
            reject(error);
            controller.abort();
          }, timeoutMs);
        })
      ]);
      return releaseSummary(releaseAsset(metadata));
    } finally {
      clearTimeout(timer);
    }
  }

  function snapshot(source, force) {
    if (inFlight.has(source)) return inFlight.get(source);
    const saved = sources[source];
    const age = saved ? now() - saved.attemptedAt : -1;
    if (!force && age >= 0 && age < CHECK_INTERVAL) return Promise.resolve({ record: saved, cached: true });

    const generation = (generations.get(source) || 0) + 1;
    generations.set(source, generation);
    const pending = (async () => {
      let record;
      try {
        const release = await lookup(source);
        const checkedAt = now();
        record = { attemptedAt: checkedAt, checkedAt, release, error: null };
      } catch (error) {
        record = {
          attemptedAt: now(), checkedAt: saved?.checkedAt || null, release: saved?.release || null,
          error: { code: error.code || 'update-check-failed', message: error.message || String(error) }
        };
      }
      // A verified download may finish while this older lookup is pending.
      if (generations.get(source) !== generation) return { record: sources[source], cached: true };
      sources[source] = record;
      const persisted = await persist();
      return { record, cached: false, warning: persisted ? null : 'cache-save-failed' };
    })();
    inFlight.set(source, pending);
    pending.finally(() => { if (inFlight.get(source) === pending) inFlight.delete(source); }).catch(() => {});
    return pending;
  }

  async function check(options = {}) {
    const source = SOURCES.has(options.source) ? options.source
      : SOURCES.has(options.packageSource) ? options.packageSource : preferredSource(options.language);
    const { record, cached, warning } = await snapshot(source, options.force === true);
    const common = {
      source, cached, checkedAt: record.checkedAt, attemptedAt: record.attemptedAt,
      currentVersion: options.packageVersion || null,
      ...(warning ? { warning } : {})
    };
    if (record.error) return { ...common, ok: false, status: 'error', ...record.error };
    return {
      ...common, ok: true, status: comparison(options, record.release),
      latestVersion: record.release.version, latestDigest: record.release.digest
    };
  }

  async function rememberRelease(value) {
    const release = releaseSummary(value);
    if (!release || !SOURCES.has(value.source)) return false;
    generations.set(value.source, (generations.get(value.source) || 0) + 1);
    const checkedAt = now();
    sources[value.source] = { attemptedAt: checkedAt, checkedAt, release, error: null };
    return persist();
  }

  return { check, rememberRelease };
}

module.exports = { createAuroraUpdateChecker };

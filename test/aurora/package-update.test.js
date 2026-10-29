'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAuroraUpdateChecker } = require('../../src/aurora-package-update');

const DAY = 24 * 60 * 60 * 1000;
const OLD_DIGEST = 'a'.repeat(64);
const NEW_DIGEST = 'b'.repeat(64);
const active = { packageOk: true, packageSource: 'official', packageVersion: 'aurora-v1.0', packageDigest: OLD_DIGEST };
const payload = (version = 'aurora-v1.1', digest = NEW_DIGEST) => ({
  tag_name: version,
  assets: [{ name: 'Aurora.7z', browser_download_url: 'https://github.com/abc354402600/OptiScaler-Aurora/releases/download/latest/Aurora.7z', digest: `sha256:${digest}`, size: 123 }]
});
const response = body => ({ ok: true, status: 200, json: async () => body });

function cache(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-update-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, cacheFile: path.join(dir, 'check.json') };
}

test('a newer upstream package is reported without changing current package files', async t => {
  const fx = cache(t);
  const dll = path.join(fx.dir, 'OptiScaler.dll');
  fs.writeFileSync(dll, 'current game files');
  const checker = createAuroraUpdateChecker({ cacheFile: fx.cacheFile, fetchImpl: async () => response(payload()) });
  const result = await checker.check({ ...active, packageRoot: fx.dir });
  assert.equal(result.status, 'update-available');
  assert.equal(result.latestVersion, 'aurora-v1.1');
  assert.equal(result.currentVersion, 'aurora-v1.0');
  assert.equal(fs.readFileSync(dll, 'utf8'), 'current game files');
});

test('automatic checks share a persistent 24-hour snapshot and compare the current package afresh', async t => {
  const fx = cache(t);
  let now = 100000;
  let requests = 0;
  const options = { cacheFile: fx.cacheFile, now: () => now, fetchImpl: async () => { requests++; return response(payload()); } };
  await createAuroraUpdateChecker(options).check(active);
  now += DAY - 1;
  const restarted = createAuroraUpdateChecker(options);
  const result = await restarted.check({ ...active, packageVersion: 'aurora-v1.1', packageDigest: NEW_DIGEST });
  assert.equal(result.status, 'up-to-date');
  assert.equal(result.cached, true);
  assert.equal(requests, 1);
  now++;
  await restarted.check(active);
  assert.equal(requests, 2);
});

test('a failed lookup remains failed during the cache window and a manual check retries immediately', async t => {
  const fx = cache(t);
  let online = false;
  let requests = 0;
  const checker = createAuroraUpdateChecker({ cacheFile: fx.cacheFile, fetchImpl: async () => {
    requests++;
    if (!online) throw new Error('offline');
    return response(payload());
  } });
  const failed = await checker.check(active);
  assert.equal(failed.status, 'error');
  assert.equal(failed.ok, false);
  online = true;
  assert.equal((await checker.check(active)).status, 'error');
  assert.equal(requests, 1);
  assert.equal((await checker.check({ ...active, force: true })).status, 'update-available');
  assert.equal(requests, 2);
});

test('concurrent checks share metadata but derive a result for each current package', async () => {
  let finish;
  let requests = 0;
  const checker = createAuroraUpdateChecker({ fetchImpl: () => { requests++; return new Promise(resolve => { finish = resolve; }); } });
  const old = checker.check(active);
  const current = checker.check({ ...active, packageVersion: 'aurora-v1.1', packageDigest: NEW_DIGEST, force: true });
  finish(response(payload()));
  assert.equal((await old).status, 'update-available');
  assert.equal((await current).status, 'up-to-date');
  assert.equal(requests, 1);
});

test('same-tag republishing is detected, older releases are not offered as upgrades, and local versions stay unknown', async () => {
  const cases = [
    [payload('aurora-v1.0'), active, 'update-available'],
    [payload('aurora-v0.9'), active, 'current-ahead'],
    [payload(), { ...active, packageSource: 'local', packageDigest: null }, 'local-unknown'],
    [payload(), { packageOk: false }, 'available'],
    [payload('nightly-2026-10-06'), { ...active, packageVersion: 'custom-tag' }, 'different-release']
  ];
  for (const [release, current, expected] of cases) {
    const checker = createAuroraUpdateChecker({ fetchImpl: async () => response(release) });
    assert.equal((await checker.check(current)).status, expected);
  }
});

test('source selection follows language for local packages and the selected source for online packages', async () => {
  const urls = [];
  const checker = createAuroraUpdateChecker({ fetchImpl: async url => { urls.push(url); return response(payload()); } });
  const zh = await checker.check({ packageOk: false, language: 'zh' });
  const en = await checker.check({ packageOk: false, language: 'en' });
  const selected = await checker.check({ ...active, packageSource: 'mirror', language: 'en' });
  assert.equal(zh.source, 'mirror');
  assert.equal(en.source, 'official');
  assert.equal(selected.source, 'mirror');
  assert.deepEqual(urls, [
    'https://gh-proxy.com/https://api.github.com/repos/abc354402600/OptiScaler-Aurora/releases/latest',
    'https://api.github.com/repos/abc354402600/OptiScaler-Aurora/releases/latest'
  ]);
});

test('missing release digests cannot become an up-to-date result', async () => {
  const release = payload();
  delete release.assets[0].digest;
  const checker = createAuroraUpdateChecker({ fetchImpl: async () => response(release) });
  const result = await checker.check(active);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'release-digest-missing');
});

test('metadata timeouts abort the lookup and allow manual retry', async () => {
  let signal;
  const checker = createAuroraUpdateChecker({ timeoutMs: 20, fetchImpl: (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  const result = await checker.check(active);
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'update-timeout');
  assert.equal(signal.aborted, true);
});

test('corrupt or future-dated cache data never prevents a fresh lookup', async t => {
  const fx = cache(t);
  for (const content of ['broken json', JSON.stringify({ schema: 1, sources: { official: { attemptedAt: 9999999, checkedAt: 9999999, release: { version: 'aurora-v1.0', digest: OLD_DIGEST } } } })]) {
    fs.writeFileSync(fx.cacheFile, content);
    const checker = createAuroraUpdateChecker({ cacheFile: fx.cacheFile, now: () => 100000, fetchImpl: async () => response(payload()) });
    const result = await checker.check(active);
    assert.equal(result.status, 'update-available');
    assert.equal(result.cached, false);
  }
});

test('cache persistence failures do not turn a valid upstream result into an unusable package', async t => {
  const fx = cache(t);
  const blocked = path.join(fx.dir, 'not-a-directory');
  fs.writeFileSync(blocked, 'file');
  const checker = createAuroraUpdateChecker({ cacheFile: path.join(blocked, 'check.json'), fetchImpl: async () => response(payload()) });
  const result = await checker.check(active);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'update-available');
  assert.equal(result.warning, 'cache-save-failed');
});

test('a verified download refreshes metadata and wins over an older lookup still in flight', async () => {
  let finish;
  const checker = createAuroraUpdateChecker({ fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const pending = checker.check(active);
  await checker.rememberRelease({ source: 'official', version: 'aurora-v1.2', digest: NEW_DIGEST });
  finish(response(payload('aurora-v1.1', OLD_DIGEST)));
  assert.equal((await pending).latestVersion, 'aurora-v1.2');
  const result = await checker.check({ ...active, packageVersion: 'aurora-v1.2', packageDigest: NEW_DIGEST });
  assert.equal(result.status, 'up-to-date');
  assert.equal(result.latestVersion, 'aurora-v1.2');
});

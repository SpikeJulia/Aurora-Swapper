'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createAuroraUpdateChecker } = require('../../src/aurora-package-update');

function harness(t, corrupt = false) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-update-ipc-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const packageRoot = path.join(profile, 'package');
  fs.mkdirSync(packageRoot);
  fs.writeFileSync(path.join(packageRoot, 'OptiScaler.dll'), 'current');
  fs.writeFileSync(path.join(packageRoot, 'runtime_sync.ps1'), 'script');
  const storeFile = path.join(profile, 'aurora-store.json');
  fs.writeFileSync(storeFile, corrupt ? '{broken' : JSON.stringify({ packageRoot, packageSource: 'official', packageVersion: 'aurora-v1.0', packageDigest: 'a'.repeat(64), records: {}, gameDirs: {}, transactions: {} }));
  const original = fs.readFileSync(storeFile);
  const mainPath = path.resolve(__dirname, '../../main.js');
  const realRequire = createRequire(mainPath);
  const handlers = new Map();
  let lookups = 0;
  const stubs = {
    electron: { app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => profile },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) } },
    './src/aurora-package-update': { createAuroraUpdateChecker: options => createAuroraUpdateChecker({ ...options,
      fetchImpl: async () => { lookups++; return { ok: true, status: 200, json: async () => ({ tag_name: 'aurora-v1.1', assets: [{ name: 'Aurora.7z', digest: `sha256:${'b'.repeat(64)}`, browser_download_url: 'https://github.com/abc354402600/OptiScaler-Aurora/releases/download/v1.1/Aurora.7z' }] }) }; } }) },
    './src/aurora-package-download': { downloadAuroraPackage: async () => ({ ok: true, packageRoot, version: 'aurora-v1.2', digest: 'c'.repeat(64), source: 'official' }) }
  };
  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), { require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(mainPath), process, Buffer, console, setTimeout, clearTimeout, AbortController });
  return { profile, packageRoot, storeFile, original, get lookups() { return lookups; },
    async call(name, ...args) { assert.equal(typeof handlers.get(name), 'function', `missing IPC ${name}`); return handlers.get(name)({}, ...args); } };
}

test('the update IPC only writes its metadata cache and enforces manual force checks', async t => {
  const app = harness(t);
  const first = await app.call('aurora-check-package-update', false);
  assert.equal(first.status, 'update-available');
  await app.call('aurora-check-package-update', false);
  assert.equal(app.lookups, 1);
  await app.call('aurora-check-package-update', true);
  assert.equal(app.lookups, 2);
  assert.deepEqual(fs.readFileSync(app.storeFile), app.original);
  assert.equal(fs.readFileSync(path.join(app.packageRoot, 'OptiScaler.dll'), 'utf8'), 'current');
  assert.equal(fs.existsSync(path.join(app.profile, 'aurora-update-check.json')), true);
});

test('verified downloads refresh cached upstream status instead of leaving an old update notice', async t => {
  const app = harness(t);
  await app.call('aurora-check-package-update');
  await app.call('aurora-download-package', 'official');
  const current = await app.call('aurora-check-package-update');
  assert.equal(current.status, 'up-to-date');
  assert.equal(current.latestVersion, 'aurora-v1.2');
  assert.equal(app.lookups, 1);
});

test('corrupt Aurora records block update actions without changing the broken file', async t => {
  const app = harness(t, true);
  const result = await app.call('aurora-check-package-update');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.equal(app.lookups, 0);
  assert.deepEqual(fs.readFileSync(app.storeFile), app.original);
});

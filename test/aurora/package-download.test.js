'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { validatePackage } = require('../../src/aurora/package');
const { downloadAuroraPackage } = require('../../src/aurora-package-download');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-package-download-'));
  const cacheRoot = path.join(root, 'cache');
  const activeRoot = path.join(root, 'active');
  fs.mkdirSync(activeRoot, { recursive: true });
  fs.writeFileSync(path.join(activeRoot, 'OptiScaler.dll'), 'active');
  fs.writeFileSync(path.join(activeRoot, 'runtime_sync.ps1'), 'active');
  const archive = Buffer.from('archive-bytes');
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  const payload = {
    tag_name: 'aurora-v1.0',
    assets: [{
      name: 'OptiScaler_Aurora_v1.0.7z',
      browser_download_url: 'https://github.com/abc354402600/OptiScaler-Aurora/releases/download/aurora-v1.0/package.7z',
      size: archive.length,
      digest: `sha256:${digest}`
    }]
  };
  return { root, cacheRoot, activeRoot, archive, payload };
}

function response(payload) {
  return { ok: true, status: 200, url: 'https://api.github.com/repos/abc354402600/OptiScaler-Aurora/releases/latest', json: async () => payload };
}

test('downloads, verifies, extracts a wrapper directory, and promotes the validated package', async () => {
  const fx = fixture();
  const result = await downloadAuroraPackage({
    source: 'official',
    cacheRoot: fx.cacheRoot,
    fetchImpl: async () => response(fx.payload),
    downloadFile: async (_url, destination) => fs.writeFileSync(destination, fx.archive),
    extractArchive: async (_archive, destination) => {
      const wrapped = path.join(destination, 'Aurora-Release');
      fs.mkdirSync(wrapped, { recursive: true });
      fs.writeFileSync(path.join(wrapped, 'OptiScaler.dll'), 'downloaded');
      fs.writeFileSync(path.join(wrapped, 'runtime_sync.ps1'), 'downloaded');
    },
    validatePackage
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'official');
  assert.equal(validatePackage(result.packageRoot).ok, true);
  assert.equal(fs.readFileSync(path.join(result.packageRoot, 'OptiScaler.dll'), 'utf8'), 'downloaded');
  assert.equal(fs.existsSync(fx.activeRoot), true);
});

test('checksum failure returns safely and leaves the active package untouched', async () => {
  const fx = fixture();
  const result = await downloadAuroraPackage({
    source: 'official',
    cacheRoot: fx.cacheRoot,
    fetchImpl: async () => response(fx.payload),
    downloadFile: async (_url, destination) => fs.writeFileSync(destination, 'tampered'),
    extractArchive: async () => { throw new Error('must not extract an unverified archive'); },
    validatePackage
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'checksum-mismatch');
  assert.equal(fs.readFileSync(path.join(fx.activeRoot, 'OptiScaler.dll'), 'utf8'), 'active');
  assert.deepEqual(fs.readdirSync(fx.cacheRoot, { withFileTypes: true }), []);
});

test('an already aborted download does not start network work', async () => {
  const fx = fixture();
  const controller = new AbortController();
  controller.abort();
  let fetched = false;
  const result = await downloadAuroraPackage({
    source: 'official',
    cacheRoot: fx.cacheRoot,
    signal: controller.signal,
    fetchImpl: async () => { fetched = true; return response(fx.payload); },
    validatePackage
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'cancelled');
  assert.equal(fetched, false);
  assert.equal(fs.existsSync(fx.activeRoot), true);
});

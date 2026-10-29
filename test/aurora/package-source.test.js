'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  preferredSource,
  sourceDefinition,
  releaseAsset
} = require('../../src/shared/aurora-package-source');

const digest = 'a'.repeat(64);

test('Chinese language families default to the domestic mirror and other languages use GitHub', () => {
  assert.equal(preferredSource('zh'), 'mirror');
  assert.equal(preferredSource('zh-TW'), 'mirror');
  assert.equal(preferredSource('en'), 'official');
  assert.equal(preferredSource('ja'), 'official');
});

test('source definitions expose fixed HTTPS metadata and asset URLs', () => {
  const official = sourceDefinition('official');
  const mirror = sourceDefinition('mirror');
  const asset = 'https://github.com/abc354402600/OptiScaler-Aurora/releases/download/aurora-v1.0/OptiScaler_Aurora_v1.0.7z';

  assert.equal(official.id, 'official');
  assert.match(official.apiUrl, /^https:\/\/api\.github\.com\/repos\//);
  assert.equal(official.assetUrl(asset), asset);
  assert.match(mirror.apiUrl, /^https:\/\/gh-proxy\.com\/https:\/\/api\.github\.com\/repos\//);
  assert.equal(mirror.assetUrl(asset), `https://gh-proxy.com/${asset}`);
});

test('releaseAsset selects the Aurora binary instead of source archives and returns its digest', () => {
  const payload = {
    tag_name: 'aurora-v1.0',
    name: 'OptiScaler Aurora v1.0',
    assets: [
      { name: 'OptiScaler-Aurora-v1.0-source.zip', browser_download_url: 'https://github.com/source.zip', size: 1, digest: `sha256:${digest}` },
      { name: 'OptiScaler_Aurora_v1.0_20260910.7z', browser_download_url: 'https://github.com/package.7z', size: 234, digest: `sha256:${digest}` }
    ]
  };

  assert.deepEqual(releaseAsset(payload), {
    version: 'aurora-v1.0',
    tag: 'aurora-v1.0',
    name: 'OptiScaler_Aurora_v1.0_20260910.7z',
    url: 'https://github.com/package.7z',
    digest,
    size: 234
  });
});

test('releaseAsset rejects a package with no valid SHA-256 digest', () => {
  assert.throws(() => releaseAsset({
    tag_name: 'aurora-v1.0',
    assets: [{
      name: 'OptiScaler_Aurora_v1.0.7z',
      browser_download_url: 'https://github.com/package.7z',
      size: 234,
      digest: 'md5:bad'
    }]
  }), error => error && error.code === 'release-digest-missing');
});

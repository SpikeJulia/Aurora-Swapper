'use strict';

const AURORA_REPOSITORY = 'abc354402600/OptiScaler-Aurora';
const MIRROR_PREFIX = 'https://gh-proxy.com/';
const RELEASE_API_URL = `https://api.github.com/repos/${AURORA_REPOSITORY}/releases/latest`;

function preferredSource(language) {
  return String(language || '').toLowerCase().startsWith('zh') ? 'mirror' : 'official';
}

function sourceDefinition(source) {
  if (source === 'mirror') {
    return {
      id: 'mirror',
      label: '国内镜像',
      apiUrl: `${MIRROR_PREFIX}${RELEASE_API_URL}`,
      assetUrl: url => `${MIRROR_PREFIX}${url}`
    };
  }
  return {
    id: 'official',
    label: 'GitHub / 官方源',
    apiUrl: RELEASE_API_URL,
    assetUrl: url => url
  };
}

function releaseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function releaseAsset(payload) {
  if (!payload || !Array.isArray(payload.assets)) {
    throw releaseError('release-invalid', 'Aurora Release metadata is invalid.');
  }
  const candidates = payload.assets
    .filter(asset => asset && typeof asset.name === 'string')
    .filter(asset => /\.(?:7z|zip)$/i.test(asset.name))
    .filter(asset => !/(?:source|src|symbols|debug)/i.test(asset.name))
    .sort((a, b) => Number(/\.7z$/i.test(b.name)) - Number(/\.7z$/i.test(a.name)));
  const asset = candidates[0];
  if (!asset) throw releaseError('release-asset-missing', 'Aurora Release has no packaged archive.');
  if (typeof asset.browser_download_url !== 'string' || !/^https:\/\/github\.com\//i.test(asset.browser_download_url)) {
    throw releaseError('release-url-invalid', 'Aurora Release asset URL is not an approved HTTPS GitHub URL.');
  }
  const match = /^sha256:([a-f0-9]{64})$/i.exec(String(asset.digest || ''));
  if (!match) throw releaseError('release-digest-missing', 'Aurora Release asset has no valid SHA-256 digest.');
  const tag = typeof payload.tag_name === 'string' && payload.tag_name.trim()
    ? payload.tag_name.trim()
    : typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : '';
  if (!tag) throw releaseError('release-version-missing', 'Aurora Release has no version tag.');
  return {
    version: tag,
    tag,
    name: asset.name,
    url: asset.browser_download_url,
    digest: match[1].toLowerCase(),
    size: Number.isFinite(Number(asset.size)) ? Number(asset.size) : null
  };
}

const api = { AURORA_REPOSITORY, MIRROR_PREFIX, RELEASE_API_URL, preferredSource, sourceDefinition, releaseAsset };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.auroraPackageSource = api;

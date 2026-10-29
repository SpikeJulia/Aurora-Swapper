'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');

test('preload exposes Aurora package download, cancellation, and progress APIs', () => {
  assert.match(preload, /downloadAuroraPackage:\s*\(source\)\s*=>\s*ipcRenderer\.invoke\('aurora-download-package'/);
  assert.match(preload, /cancelAuroraPackageDownload:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('aurora-cancel-package-download'/);
  assert.match(preload, /onAuroraPackageProgress:\s*\(handler\)\s*=>\s*ipcRenderer\.on\('aurora-package-progress'/);
});

test('main registers the downloader with the userData cache and language default', () => {
  assert.match(main, /require\('\.\/src\/aurora-package-download'\)/);
  assert.match(main, /ipcMain\.handle\('aurora-download-package'/);
  assert.match(main, /language:\s*loadState\(\)\.lang\s*\|\|\s*'zh'/);
  assert.match(main, /cacheRoot:\s*path\.join\(app\.getPath\('userData'\),\s*'aurora-packages'\)/);
  assert.match(main, /ipcMain\.handle\('aurora-cancel-package-download'/);
  assert.match(main, /sender\.send\('aurora-package-progress'/);
});

test('main updates the Aurora package store only after a successful download result', () => {
  const start = main.indexOf("ipcMain.handle('aurora-download-package'");
  const end = main.indexOf("ipcMain.handle('aurora-cancel-package-download'", start);
  assert.ok(start >= 0 && end > start, 'download handler should be a bounded block');
  const handler = main.slice(start, end);
  assert.match(handler, /if \(!result\.ok\) return result/);
  assert.match(handler, /fresh\.packageRoot\s*=\s*result\.packageRoot/);
  assert.match(handler, /fresh\.packageDigest\s*=\s*result\.digest/);
  assert.match(handler, /saveAurora\(fresh\)/);
  assert.ok(handler.indexOf('if (!result.ok) return result') < handler.indexOf('saveAurora(fresh)'), 'failure must return before store write');
});

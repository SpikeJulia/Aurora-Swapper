'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');

function loadI18n() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/renderer/i18n.js'), 'utf8'), { window });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/renderer/i18n-extra.js'), 'utf8'), { window });
  return window.i18n;
}

test('About product identity and developer attribution stay current in every bundled locale', () => {
  const i18n = loadI18n();
  for (const locale of i18n.LANGS) {
    i18n.setLang(locale.code);
    assert.equal(i18n.t('aboutTitle'), 'Aurora Swapper', `${locale.code} product name`);
    assert.match(i18n.t('aboutBody'), /OptiScaler Aurora/, `${locale.code} product description`);
    assert.match(i18n.t('aboutBy'), /spikejulia/, `${locale.code} developer credit`);
  }
});

test('Chinese hide-game labels and confirmation remain Chinese and preserve the game name', () => {
  const i18n = loadI18n();
  i18n.setLang('zh');

  for (const key of ['hideTitle', 'menuHide', 'setHidden', 'setHiddenNone', 'setUnhide']) {
    assert.match(i18n.t(key), /[\u4e00-\u9fff]/, `${key} should be translated`);
    assert.notEqual(i18n.t(key), i18n.S.en[key], `${key} should not fall back to English`);
  }
  const message = i18n.t('hideConfirm', '星露谷物语');
  assert.match(message, /星露谷物语/);
  assert.match(message, /[\u4e00-\u9fff]/);
  assert.doesNotMatch(message, /Nothing on disk changes|Hide .* from the list/);
});

test('Chinese settings labels and help text do not fall back to English', () => {
  const i18n = loadI18n();
  i18n.setLang('zh');
  const cases = [
    ['auroraLocalPackage'], ['auroraDownloadPackage'],
    ['setTray'], ['setTrayHint'], ['trayShow'], ['trayQuit'],
    ['setAutoScan'], ['setAutoScanHint'], ['setRoots'], ['setFolders'],
    ['setAdd'], ['setHidden'], ['setHiddenNone'], ['setUnhide'],
    ['setLibrary'], ['setReset'], ['setPosters'], ['setSaved', 3], ['addonRemove'],
    ['addGameError', 'picker unavailable'], ['addFolderError', 'picker unavailable']
  ];

  for (const [key, ...args] of cases) {
    const translated = i18n.t(key, ...args);
    assert.match(translated, /[\u4e00-\u9fff]/, `${key} should be translated`);
    assert.notEqual(translated, i18n.S.en[key], `${key} should not fall back to English`);
  }
});

test('Chinese collapsible library controls and search labels are localized', () => {
  const i18n = loadI18n();
  i18n.setLang('zh');
  for (const key of ['packageOptions', 'libraryToolsTitle', 'libraryToolsActive', 'searchGames', 'searchGamesHint', 'sortPlayed', 'sortStore', 'sortPlayedHint']) {
    assert.match(i18n.t(key), /[\u4e00-\u9fff]/, `${key} should be translated`);
    assert.notEqual(i18n.t(key), i18n.S.en[key], `${key} should not fall back to English`);
  }
});

test('ask dialog defaults to Aurora Swapper branding', async () => {
  const listeners = new Map();
  const dialog = {
    open: false,
    className: '',
    innerHTML: '',
    setAttribute() {},
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    showModal() { this.open = true; },
    close() { this.open = false; },
    querySelector() { return { focus() {} }; }
  };
  const document = {
    createElement() { return dialog; },
    body: { appendChild() {} }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/renderer/ask.js'), 'utf8'), { document, module });

  const result = module.exports.ask({ title: 'Hide this game?' });
  assert.match(dialog.innerHTML, /Aurora Swapper/);
  assert.doesNotMatch(dialog.innerHTML, /DLSS 5 Swapper/);
  listeners.get('click')({ target: { closest: () => ({ dataset: { ask: 'cancel' } }) } });
  assert.equal(await result, false);
});

test('settings no longer expose community notifications or start the old polling loop', () => {
  const renderer = fs.readFileSync(path.join(root, 'src/renderer/renderer.js'), 'utf8');
  const settings = renderer.slice(renderer.indexOf('async function renderSettings()'), renderer.indexOf('// ---------------- loading ----------------'));
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

  assert.doesNotMatch(settings, /setNotices|communityNoticeSettings/);
  assert.doesNotMatch(main, /\bstartNotices\(\);/);
});

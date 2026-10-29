'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createAuroraUpdateUi } = require('../../src/renderer/aurora-update-ui');

function node() {
  const classes = new Set();
  return { textContent: '', disabled: false, dataset: {}, title: '',
    classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) } };
}

function fixture() {
  const nodes = Object.fromEntries(['auroraUpdateStatus', 'settingsAuroraUpdateStatus', 'auroraUpdateAction', 'libraryCheckAuroraUpdate', 'settingsCheckAuroraUpdate'].map(id => [id, node()]));
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../src/renderer/i18n.js'), 'utf8'), { window });
  window.i18n.setLang('zh');
  return { nodes, i18n: window.i18n };
}

test('automatic lookup shows a translated update action without downloading anything', async () => {
  const fx = fixture();
  const checks = [];
  const downloads = [];
  const ui = createAuroraUpdateUi({ getElement: id => fx.nodes[id], translate: fx.i18n.t, canCheck: () => true,
    checkUpdate: async force => { checks.push(force); return { ok: true, status: 'update-available', latestVersion: 'v1.1', currentVersion: 'v1.0', source: 'mirror' }; },
    onDownload: source => downloads.push(source) });
  await ui.check();
  assert.deepEqual(checks, [false]);
  assert.match(fx.nodes.auroraUpdateStatus.textContent, /发现.*v1\.1/);
  assert.equal(fx.nodes.settingsAuroraUpdateStatus.textContent, fx.nodes.auroraUpdateStatus.textContent);
  assert.equal(fx.nodes.auroraUpdateAction.classList.contains('hidden'), false);
  assert.equal(downloads.length, 0);
  fx.nodes.auroraUpdateAction.onclick();
  assert.deepEqual(downloads, ['mirror']);
  fx.i18n.setLang('en');
  ui.render();
  assert.match(fx.nodes.auroraUpdateStatus.textContent, /available.*v1\.1/i);
});

test('a failed check exposes retry, forces a fresh lookup, and never offers a download', async () => {
  const fx = fixture();
  let calls = 0;
  let forced = false;
  const ui = createAuroraUpdateUi({ getElement: id => fx.nodes[id], translate: fx.i18n.t, canCheck: () => true,
    checkUpdate: async force => { calls++; forced = force; return calls === 1
      ? { ok: false, status: 'error', code: 'network-failed' }
      : { ok: true, status: 'up-to-date', latestVersion: 'v1.0' }; },
    onDownload: () => { throw new Error('a failed check must not offer downloading'); } });
  await ui.check();
  assert.match(fx.nodes.auroraUpdateStatus.textContent, /检查失败/);
  assert.match(fx.nodes.auroraUpdateAction.textContent, /重试|重新检查/);
  await fx.nodes.auroraUpdateAction.onclick();
  assert.equal(forced, true);
  assert.match(fx.nodes.auroraUpdateStatus.textContent, /最新/);
  assert.equal(fx.nodes.auroraUpdateAction.classList.contains('hidden'), true);
});

test('a synchronous bridge failure releases the check lock for manual retry', async () => {
  const fx = fixture();
  let calls = 0;
  const checks = [];
  const ui = createAuroraUpdateUi({ getElement: id => fx.nodes[id], translate: fx.i18n.t, canCheck: () => true,
    checkUpdate: force => {
      checks.push(force);
      if (++calls === 1) throw new Error('bridge unavailable');
      return Promise.resolve({ ok: true, status: 'up-to-date', latestVersion: 'v1.1' });
    }, onDownload() {} });
  await ui.check();
  assert.match(fx.nodes.auroraUpdateStatus.textContent, /检查失败/);
  await fx.nodes.auroraUpdateAction.onclick();
  assert.deepEqual(checks, [false, true]);
  assert.match(fx.nodes.auroraUpdateStatus.textContent, /已是最新/);
});

test('local and missing packages show the available upstream version without a false latest claim', async () => {
  const fx = fixture();
  for (const status of ['local-unknown', 'available', 'different-release', 'current-ahead']) {
    const ui = createAuroraUpdateUi({ getElement: id => fx.nodes[id], translate: fx.i18n.t, canCheck: () => true,
      checkUpdate: async () => ({ ok: true, status, latestVersion: 'v1.1', currentVersion: 'v1.2' }), onDownload() {} });
    await ui.check();
    assert.match(fx.nodes.auroraUpdateStatus.textContent, /v1\.1/);
    assert.doesNotMatch(fx.nodes.auroraUpdateStatus.textContent, /已是最新/);
  }
});

test('a corrupt package store disables checks and update actions', async () => {
  const fx = fixture();
  let checked = false;
  const ui = createAuroraUpdateUi({ getElement: id => fx.nodes[id], translate: fx.i18n.t, canCheck: () => false,
    checkUpdate: async () => { checked = true; }, onDownload() {} });
  await ui.check();
  assert.equal(checked, false);
  assert.equal(fx.nodes.libraryCheckAuroraUpdate.disabled, true);
  assert.equal(fx.nodes.auroraUpdateAction.classList.contains('hidden'), true);
  assert.match(fx.nodes.auroraUpdateStatus.textContent, /记录/);
});

test('package changes trigger fresh comparison after an in-progress lookup settles', async () => {
  const fx = fixture();
  let finish;
  let calls = 0;
  const ui = createAuroraUpdateUi({ getElement: id => fx.nodes[id], translate: fx.i18n.t, canCheck: () => true,
    checkUpdate: () => ++calls === 1 ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ ok: true, status: 'up-to-date', latestVersion: 'v1.1' }), onDownload() {} });
  const first = ui.check();
  assert.equal(fx.nodes.libraryCheckAuroraUpdate.disabled, true);
  const refreshed = ui.refresh();
  finish({ ok: true, status: 'update-available', latestVersion: 'v1.1' });
  await first;
  await refreshed;
  assert.equal(calls, 2);
  assert.match(fx.nodes.auroraUpdateStatus.textContent, /已是最新/);
  assert.equal(fx.nodes.libraryCheckAuroraUpdate.disabled, false);
});

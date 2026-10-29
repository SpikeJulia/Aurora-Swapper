'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/renderer.js'), 'utf8');

function evaluateBetween(start, end, context) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `renderer section ${start} exists`);
  vm.runInNewContext(source.slice(from, to), context);
  return context;
}

test('settings and game sheet surface a corrupt Aurora store and disable actions', async () => {
  const context = {
    window: { lab: {
      auroraState: async () => ({
        packageRoot: null, records: {}, gameDirs: {},
        storeError: { path: 'C:/UserData/aurora-store.json', message: 'invalid JSON' }
      }),
      auroraPreset: async () => null
    } },
    esc: value => String(value).replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])),
    recordAt: () => null,
    rememberedGameDir: () => '',
    auroraGameDirOf: () => '/game',
    pathBase: value => String(value).split(/[\\/]/).pop(),
    document: { createElement: () => ({}) }
  };
  evaluateBetween('// Same seven names as src/aurora/games.js', '// A newer release exists', context);
  const options = await context.installOptions({}, null, '/library/game');

  assert.equal(options.storeOk, false);
  assert.equal(options.packageOk, false);
  assert.match(options.html, /C:\/UserData\/aurora-store\.json/);
  assert.match(options.html, /记录损坏/);
});

test('corrupt-store status prevents Install, Repair, and Restore from being enabled', () => {
  const nodes = {
    auroraStatus: { textContent: '', insertAdjacentElement() {} },
    auroraRepairHint: null,
    doInstall: { disabled: false }, doRepair: { disabled: false }, doRestore: { disabled: false },
    doOpen: { disabled: true }, proxyChoice: { disabled: true }, auroraGameDir: { disabled: true },
    sheetClose: { disabled: true }, exeSelect: { disabled: true }
  };
  const context = {
    $: id => nodes[id] || null,
    document: { createElement: () => ({}) },
    auroraStatusText: status => status === 'incomplete' ? '安装未完成' : '未安装'
  };
  evaluateBetween('function paintAuroraStatus', 'function auroraJobText', context);
  context.paintAuroraStatus({ status: 'incomplete' }, { ok: true }, false);

  assert.equal(nodes.doInstall.disabled, true);
  assert.equal(nodes.doRepair.disabled, true);
  assert.equal(nodes.doRestore.disabled, true);
});

test('unknown Aurora record status keeps all mutations disabled', () => {
  const nodes = {
    auroraStatus: { textContent: '', insertAdjacentElement() {} },
    auroraRepairHint: null,
    doInstall: { disabled: false }, doRepair: { disabled: false }, doRestore: { disabled: false },
    doOpen: { disabled: true }, proxyChoice: { disabled: true }, auroraGameDir: { disabled: true },
    sheetClose: { disabled: true }, exeSelect: { disabled: true }
  };
  const context = {
    $: id => nodes[id] || null,
    document: { createElement: () => ({}) },
    auroraStatusText: () => '状态待确认'
  };
  evaluateBetween('function paintAuroraStatus', 'function auroraJobText', context);
  context.paintAuroraStatus({ status: 'unexpected' }, { ok: true }, true);

  assert.equal(nodes.doInstall.disabled, true);
  assert.equal(nodes.doRepair.disabled, true);
  assert.equal(nodes.doRestore.disabled, true);
});

test('Aurora install targets the folder containing the selected executable, not its library root', () => {
  const context = {};
  evaluateBetween('function pathBase', 'function auroraStatusText', context);

  const gameDir = context.auroraGameDirOf(
    { path: '/steam/steamapps/common/Example/Binaries/Win64/Example.exe' },
    '/steam/steamapps/common'
  );

  assert.equal(gameDir, '/steam/steamapps/common/Example/Binaries/Win64');
});

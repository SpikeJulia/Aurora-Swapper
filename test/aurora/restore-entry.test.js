'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/renderer.js'), 'utf8');
const preloadSource = fs.readFileSync(path.resolve(__dirname, '../../preload.js'), 'utf8');

function evaluateBetween(start, end, context) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `renderer section ${start} exists`);
  vm.runInNewContext(source.slice(from, to), context);
}

test('renderer path matching follows the host case semantics', () => {
  const context = { window: { lab: { auroraPathCaseInsensitive: false } } };
  evaluateBetween('function auroraPathKey', 'function auroraPackageText', context);
  assert.notEqual(context.auroraPathKey('/Games/Foo'), context.auroraPathKey('/games/foo'));
  context.window.lab.auroraPathCaseInsensitive = true;
  assert.equal(context.auroraPathKey('C:\\Games\\Foo\\'), context.auroraPathKey('c:/games/foo'));
});

test('preload tells the renderer whether Aurora paths are case-insensitive', () => {
  let exposed;
  const context = {
    require: name => name === 'electron' ? {
      contextBridge: { exposeInMainWorld: (_key, value) => { exposed = value; } },
      ipcRenderer: { invoke() {}, on() {} },
      webUtils: { getPathForFile() {} }
    } : require(name),
    process: { platform: 'win32' }
  };
  vm.runInNewContext(preloadSource, context);
  assert.equal(exposed.auroraPathCaseInsensitive, true);
});

test('right-click Restore uses the shared operation entry and shows the process warning', async () => {
  const libraryDir = '/library/game';
  const gameDir = '/games/game';
  const nodes = { job: { textContent: '' } };
  const status = { text: '' };
  const calls = [];
  const record = { proxy: 'dxgi.dll', files: [], status: 'installed' };
  const aurora = {
    package: { ok: true },
    records: { [gameDir]: record },
    gameDirs: { [libraryDir]: gameDir }
  };
  const context = {
    window: { lab: {
      auroraState: async () => aurora,
      auroraRestore: async (...args) => {
        calls.push(args);
        return { ok: false, error: 'process-state-unknown', unconfirmedClose: true };
      }
    } },
    document: { getElementById: id => nodes[id] || null },
    $: id => nodes[id] || null,
    setStatus: value => { status.text = value; },
    state: { games: [{ dir: libraryDir, name: 'Example Game' }] },
    sheetGame: null,
    sheetDetails: null,
    jobRunning: false,
    jobLines: [],
    cardActionsBusy: new Set(),
    paintAuroraHome() { throw new Error('failed action must not repaint as success'); },
    paintAuroraStatus() {},
    chosenExe() { return null; },
    rememberAuroraDir: async () => {},
    setTimeout,
    clearTimeout
  };

  evaluateBetween('function auroraPathKey', 'function auroraPackageText', context);
  evaluateBetween('function auroraJobText', 'async function runJob', context);
  evaluateBetween('async function performGameAction(action, dir)', 'async function openGameMenu', context);

  await context.performGameAction('restore', libraryDir);

  assert.deepEqual(calls, [[gameDir, null]]);
  assert.match(status.text, /Example Game/);
  assert.match(status.text, /未能确认游戏已关闭/);
  assert.match(status.text, /未能确认相关进程已退出/);
  assert.equal(context.jobRunning, false);
});

test('a right-click Restore cannot enter while another renderer job is active', async () => {
  const libraryDir = '/library/game';
  let restoreCalled = false;
  const context = {
    window: { lab: { auroraRestore: async () => { restoreCalled = true; } } },
    state: { games: [{ dir: libraryDir }] },
    jobRunning: true,
    cardActionsBusy: new Set(),
    auroraRestoreTarget: async () => '/games/game',
    runAuroraAction: async () => { restoreCalled = true; }
  };
  evaluateBetween('async function performGameAction(action, dir)', 'async function openGameMenu', context);

  await context.performGameAction('restore', libraryDir);

  assert.equal(restoreCalled, false);
});

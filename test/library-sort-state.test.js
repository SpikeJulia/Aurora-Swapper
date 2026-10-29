'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');

// Exercise real IPC handlers and JSON persistence without opening a window or
// scanning a machine. A new context represents a fresh app launch.
const mainPath = path.join(__dirname, '../main.js');
function createMainHarness(profile) {
  const handlers = new Map();
  const children = [];
  const spawn = (...args) => {
    const child = new EventEmitter();
    child.unref = () => {};
    children.push({ child, args });
    return child;
  };

  vm.runInNewContext(fs.readFileSync(mainPath, 'utf8'), {
    __dirname: path.dirname(mainPath),
    process: { ...process },
    require(name) {
      if (name === 'electron') return {
        app: {
          getPath(key) { assert.equal(key, 'userData'); return profile; },
          setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}
        },
        ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }
      };
      if (name === 'child_process') return { spawn, execFile() {} };
      if (name === './package.json') return { version: 'test' };
      if (name === './src/aurora/service') {
        return { createAuroraService: () => ({ run: async () => ({ ok: false }) }), gameKey: value => value };
      }
      if (name.startsWith('./src/')) return {};
      return require(name);
    }
  }, { filename: mainPath });

  return {
    children,
    call(channel, ...args) {
      const handler = handlers.get(channel);
      assert.equal(typeof handler, 'function', `missing IPC handler: ${channel}`);
      return handler(null, ...args);
    }
  };
}

function tempProfile(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-library-sort-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  return profile;
}

test('migrates legacy grouping to the matching sort and removes the duplicate setting', (t) => {
  for (const [groupGamesByStore, expected] of [[true, 'store'], [false, 'name-asc']]) {
    const profile = tempProfile(t);
    const file = path.join(profile, 'library.json');
    const original = {
      folders: ['C:\\Games'], manual: ['C:\\DuckStation'], scans: { example: { ok: true } },
      hidden: [], autoScanDrives: false, lang: 'zh', theme: 'dark', groupGamesByStore
    };
    fs.writeFileSync(file, JSON.stringify(original));
    const main = createMainHarness(profile);

    const boot = main.call('boot');
    assert.equal(boot.librarySort, expected);
    assert.equal(Object.hasOwn(boot, 'groupGamesByStore'), false);
    assert.equal(Object.hasOwn(main.call('settings'), 'groupGamesByStore'), false);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.librarySort, expected);
    assert.equal(Object.hasOwn(saved, 'groupGamesByStore'), false);
    assert.deepEqual(saved.folders, original.folders);
    assert.deepEqual(saved.scans, original.scans);
  }
});

test('persists only supported library sort values across app launches', (t) => {
  const profile = tempProfile(t);
  const first = createMainHarness(profile);
  assert.equal(first.call('set-library-sort', 'played'), 'played');
  assert.equal(first.call('set-library-sort', 'recent'), false);
  assert.equal(first.call('boot').librarySort, 'played');

  const restarted = createMainHarness(profile);
  assert.equal(restarted.call('boot').librarySort, 'played');
  assert.equal(restarted.call('set-library-sort', 'store'), 'store');
  assert.equal(createMainHarness(profile).call('boot').librarySort, 'store');
});

test('records a game launch only after the child process actually spawns', async (t) => {
  const profile = tempProfile(t);
  const gameDir = path.join(profile, 'Game');
  fs.mkdirSync(gameDir);
  fs.writeFileSync(path.join(gameDir, 'game.exe'), 'stub');
  const main = createMainHarness(profile);

  const launching = main.call('launch', gameDir, 'game.exe');
  if (main.children[0]?.child.listenerCount('spawn')) main.children[0].child.emit('spawn');
  assert.equal(await launching, null);
  assert.equal(main.children.length, 1);
  const boot = main.call('boot');
  const key = crypto.createHash('sha1').update(path.resolve(gameDir).toLowerCase()).digest('hex').slice(0, 16);
  assert.equal(typeof boot.lastLaunchedAt[key], 'number');
  assert.ok(boot.lastLaunchedAt[key] > 0);

  const savedTime = boot.lastLaunchedAt[key];
  assert.equal(createMainHarness(profile).call('boot').lastLaunchedAt[key], savedTime);
});

test('does not record missing or failed game launches', async (t) => {
  const profile = tempProfile(t);
  const gameDir = path.join(profile, 'Game');
  fs.mkdirSync(gameDir);
  fs.writeFileSync(path.join(gameDir, 'game.exe'), 'stub');
  const main = createMainHarness(profile);

  assert.equal(await main.call('launch', gameDir, 'missing.exe'), 'missing');
  const launching = main.call('launch', gameDir, 'game.exe');
  if (main.children[0]?.child.listenerCount('error')) {
    main.children[0].child.emit('error', Object.assign(new Error('spawn denied'), { code: 'EACCES' }));
  }
  assert.equal(await launching, 'EACCES');
  assert.equal(Object.keys(main.call('boot').lastLaunchedAt).length, 0);
});

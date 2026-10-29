'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { createRequire } = require('module');
const { gameKey } = require('../../src/aurora/service');

test('corrupt Aurora store is reported with its path and blocks mutations', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-store-safety-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const storePath = path.join(userData, 'aurora-store.json');
  fs.writeFileSync(storePath, '{broken');
  const main = path.resolve(__dirname, '../../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => userData },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showOpenDialog: async () => ({ canceled: true }) },
      clipboard: { writeText() {} }
    }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });

  const state = handlers.get('aurora-state')();
  assert.equal(state.storeError.path, storePath);
  assert.match(state.storeError.message, /JSON|position|unexpected/i);
  const install = await handlers.get('aurora-install')({}, path.join(userData, 'game'), 'dxgi.dll', true, null);
  assert.equal(install.ok, false);
  assert.equal(install.error, 'store-corrupt');
  assert.deepEqual(fs.readFileSync(storePath), Buffer.from('{broken'));
  assert.equal(fs.existsSync(path.join(userData, 'game', 'dxgi.dll')), false);
});

test('install IPC persists transaction checkpoints and commits the resulting record', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-checkpoint-ipc-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const gameDir = path.join(userData, 'game');
  const packageRoot = path.join(userData, 'package');
  fs.mkdirSync(gameDir);
  fs.mkdirSync(packageRoot);
  fs.writeFileSync(path.join(packageRoot, 'OptiScaler.dll'), 'dll');
  fs.writeFileSync(path.join(packageRoot, 'runtime_sync.ps1'), 'fake');
  fs.writeFileSync(path.join(userData, 'aurora-store.json'), JSON.stringify({
    packageRoot, records: {}, gameDirs: {}, transactions: {}
  }));
  const main = path.resolve(__dirname, '../../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  const record = { proxy: 'dxgi.dll', files: [{ rel: 'dxgi.dll', action: 'added' }], status: 'installed' };
  let callbackWasProvided = false;
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => userData },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showOpenDialog: async () => ({ canceled: true }) },
      clipboard: { writeText() {} }
    },
    './src/aurora/install': {
      installGame: async (input, deps) => {
        callbackWasProvided = typeof deps.checkpoint === 'function';
        if (deps.checkpoint) {
          await deps.checkpoint({
            id: 'fixture-run', gameDir: input.gameDir, phase: 'prepared',
            previousRecord: null, nextRecord: record, snapshotDir: path.join(userData, 'snapshots'), snapshotManifest: []
          });
          await deps.checkpoint(null, { gameDir: input.gameDir, record });
        }
        return { ok: true, record, status: 'installed', addonFailure: null };
      },
      checkGame: async () => ({ ok: false }),
      restoreGame: async () => ({ ok: false })
    }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });

  const result = await handlers.get('aurora-install')({}, gameDir, 'dxgi.dll', false, null);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'aurora-store.json'), 'utf8'));

  assert.equal(result.ok, true);
  assert.equal(callbackWasProvided, true);
  assert.deepEqual(saved.records[gameDir], record);
  assert.deepEqual(saved.transactions, {});
});

test('check IPC uses the persisted executable and returns an unconfirmed-close warning', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-check-ipc-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const gameDir = path.join(userData, 'game');
  const packageRoot = path.join(userData, 'package');
  const exePath = path.join(gameDir, 'Game.exe');
  fs.mkdirSync(gameDir);
  fs.mkdirSync(packageRoot);
  fs.writeFileSync(exePath, 'fixture exe');
  fs.writeFileSync(path.join(packageRoot, 'OptiScaler.dll'), 'dll');
  fs.writeFileSync(path.join(packageRoot, 'runtime_sync.ps1'), 'fake');
  const record = { proxy: 'dxgi.dll', files: [], status: 'incomplete', exePath };
  fs.writeFileSync(path.join(userData, 'aurora-store.json'), JSON.stringify({
    packageRoot, records: { [gameDir]: record }, gameDirs: {}, transactions: {}
  }));
  const main = path.resolve(__dirname, '../../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  let checked = null;
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => userData },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showOpenDialog: async () => ({ canceled: true }) },
      clipboard: { writeText() {} }
    },
    './src/aurora/install': {
      installGame: async () => ({ ok: false }),
      checkGame: async input => { checked = input; return { ok: true, status: 'installed' }; },
      restoreGame: async () => ({ ok: false })
    }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process: { ...process, platform: 'darwin' }, Buffer, console, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });

  const result = await handlers.get('aurora-check')({}, gameDir, null);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'aurora-store.json'), 'utf8'));

  assert.equal(result.ok, true);
  assert.equal(result.unconfirmedClose, true);
  assert.equal(checked.exePath, exePath);
  assert.equal(checked.gameRunning, null);
  assert.equal(saved.records[gameDir].status, 'installed');

  const history = fs.readFileSync(path.join(userData, 'history.jsonl'), 'utf8')
    .trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(history.length, 1);
  assert.equal(history[0].dir, gameDir);
  assert.equal(history[0].action, 'repair');
  assert.equal(history[0].route, 'aurora');
});

test('startup converts an interrupted script transaction into an incomplete restore record', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-restart-recovery-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const gameDir = path.join(userData, 'game');
  fs.mkdirSync(gameDir);
  fs.writeFileSync(path.join(gameDir, 'dxgi.dll'), 'Aurora');
  const transaction = {
    id: 'interrupted-run', gameDir, phase: 'script-running', previousRecord: null,
    nextRecord: { proxy: 'dxgi.dll', files: [{ rel: 'dxgi.dll', action: 'added' }] },
    snapshotDir: path.join(userData, 'snapshots'), snapshotManifest: []
  };
  const storePath = path.join(userData, 'aurora-store.json');
  fs.writeFileSync(storePath, JSON.stringify({
    packageRoot: null, records: {}, gameDirs: {}, transactions: { [gameDir]: transaction }
  }));
  const main = path.resolve(__dirname, '../../main.js');
  const realRequire = createRequire(main);
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => userData },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle() {} },
      dialog: { showOpenDialog: async () => ({ canceled: true }) },
      clipboard: { writeText() {} }
    }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process, Buffer, console, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });

  await vm.runInContext('recoverAuroraTransactions()', context);
  const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));

  assert.equal(saved.transactions[gameDir].phase, 'needs-recovery');
  assert.equal(saved.records[gameDir].status, 'incomplete');
  assert.equal(fs.readFileSync(path.join(gameDir, 'dxgi.dll'), 'utf8'), 'Aurora');
});

test('startup does not auto-recover colliding Windows path-alias transactions', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-alias-recovery-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const gameDir = path.join(userData, 'game');
  fs.mkdirSync(gameDir);
  fs.writeFileSync(path.join(gameDir, 'Game.exe'), 'fixture exe');
  const target = path.join(gameDir, 'aurora-file.dll');
  fs.writeFileSync(target, 'preserve until aliases are resolved');
  const backupHash = crypto.createHash('sha256').update(gameKey(gameDir, 'win32')).digest('hex');
  const backupDir = path.join(userData, 'aurora-backups', backupHash);
  const transactionsDir = path.join(backupDir, '.transactions');
  fs.mkdirSync(transactionsDir, { recursive: true });
  const firstKey = gameDir;
  const secondKey = gameDir.toUpperCase();
  const makeTransaction = (key, id) => {
    const snapshotDir = path.join(transactionsDir, id);
    fs.mkdirSync(snapshotDir);
    return {
      id, gameDir: key, exePath: path.join(gameDir, 'Game.exe'), phase: 'copying',
      previousRecord: null,
      nextRecord: { proxy: 'dxgi.dll', files: [{ rel: 'aurora-file.dll', action: 'added' }] },
      snapshotDir,
      snapshotManifest: [{
        rel: 'aurora-file.dll', to: target, existed: false,
        snapshot: path.join(snapshotDir, '0000.snapshot')
      }]
    };
  };
  const storePath = path.join(userData, 'aurora-store.json');
  fs.writeFileSync(storePath, JSON.stringify({
    packageRoot: null, records: {}, gameDirs: {},
    transactions: {
      [firstKey]: makeTransaction(firstKey, '12345678-1234-4234-8234-123456789abc'),
      [secondKey]: makeTransaction(secondKey, 'abcdefab-cdef-4abc-8def-abcdefabcdef')
    }
  }));

  const main = path.resolve(__dirname, '../../main.js');
  const realRequire = createRequire(main);
  const auroraService = realRequire('./src/aurora/service');
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => userData },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle() {} },
      dialog: { showOpenDialog: async () => ({ canceled: true }) },
      clipboard: { writeText() {} }
    },
    'child_process': {
      spawn() {},
      execFile: (_command, _args, _options, callback) => callback(null, 'INFO: No tasks are running which match the specified criteria.')
    },
    './src/aurora/service': {
      ...auroraService,
      gameKey: value => auroraService.gameKey(value, 'win32')
    }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process: { ...process, platform: 'win32' },
    Buffer, console, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });

  await vm.runInContext('recoverAuroraTransactions()', context);

  const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserve until aliases are resolved');
  assert.equal(Object.keys(saved.transactions).length, 2);
});

test('manual restore does not race an interrupted PowerShell script when process state is unknown', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-restore-process-state-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const gameDir = path.join(userData, 'game');
  fs.mkdirSync(gameDir);
  const transaction = {
    id: 'pending-script', gameDir, phase: 'needs-recovery', previousRecord: null,
    nextRecord: { proxy: 'dxgi.dll', files: [{ rel: 'dxgi.dll', action: 'added' }] },
    snapshotDir: path.join(userData, 'snapshots'), snapshotManifest: []
  };
  fs.writeFileSync(path.join(userData, 'aurora-store.json'), JSON.stringify({
    packageRoot: null, records: {}, gameDirs: {}, transactions: { [gameDir]: transaction }
  }));
  const main = path.resolve(__dirname, '../../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  let restoreCalled = false;
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => userData },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showOpenDialog: async () => ({ canceled: true }) },
      clipboard: { writeText() {} }
    },
    './src/aurora/install': {
      installGame: async () => ({ ok: false }),
      checkGame: async () => ({ ok: false }),
      restoreGame: async () => { restoreCalled = true; return { ok: true, record: null }; }
    }
  };
  const testProcess = { ...process, platform: 'win32' };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process: testProcess, Buffer, console, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });

  const result = await handlers.get('aurora-restore')({}, gameDir, null);

  assert.equal(result.ok, false);
  assert.equal(result.error, 'process-state-unknown');
  assert.equal(restoreCalled, false);
});

test('explicit Restore consumes the pending record and clears its transaction only on success', async t => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-explicit-restore-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const gameDir = path.join(userData, 'game');
  fs.mkdirSync(gameDir);
  const expectedRecord = { proxy: 'dxgi.dll', status: 'incomplete', files: [{ rel: 'dxgi.dll', action: 'added' }] };
  const transaction = {
    id: 'needs-restore', gameDir, exePath: path.join(gameDir, 'Game.exe'),
    phase: 'needs-recovery', recoveryKind: 'script-restore', previousRecord: null,
    nextRecord: expectedRecord, snapshotDir: path.join(userData, 'snapshots'), snapshotManifest: []
  };
  fs.writeFileSync(path.join(userData, 'aurora-store.json'), JSON.stringify({
    packageRoot: null, records: {}, gameDirs: {}, transactions: { [gameDir]: transaction }
  }));
  const main = path.resolve(__dirname, '../../main.js');
  const realRequire = createRequire(main);
  const handlers = new Map();
  let receivedRecord = null;
  const stubs = {
    electron: {
      app: { setAppUserModelId() {}, whenReady: () => ({ then() {} }), on() {}, getPath: () => userData },
      BrowserWindow: { fromWebContents: () => null },
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      dialog: { showOpenDialog: async () => ({ canceled: true }) },
      clipboard: { writeText() {} }
    },
    child_process: {
      spawn() { throw new Error('PowerShell must not spawn in this test'); },
      execFile(_file, _args, _options, callback) { setImmediate(() => callback(null, 'INFO: No tasks are running')); }
    },
    './src/aurora/install': {
      installGame: async () => ({ ok: false }),
      checkGame: async () => ({ ok: false }),
      restoreGame: async input => {
        receivedRecord = input.record;
        return input.record ? { ok: true, status: 'not-installed', record: null } : { ok: false };
      }
    }
  };
  const context = vm.createContext({
    require: name => stubs[name] || realRequire(name),
    __dirname: path.dirname(main), process: { ...process, platform: 'win32' }, Buffer, console, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context, { filename: main });

  const result = await handlers.get('aurora-restore')({}, gameDir, null);
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'aurora-store.json'), 'utf8'));

  assert.equal(result.ok, true);
  assert.deepEqual(receivedRecord, expectedRecord);
  assert.equal(saved.transactions[gameDir], undefined);
  assert.equal(saved.records[gameDir], undefined);
});

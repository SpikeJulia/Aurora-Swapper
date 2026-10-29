'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildLibraryModel,
  mergeLibraryGames,
  addedGameFeedback,
  packagePresentation
} = require('../../src/renderer/aurora-library-model');

const game = (name, dir, cached = {}) => ({
  name,
  dir,
  launcher: 'Steam',
  cached: { api: 'DirectX 12', hasDlss: false, addon: false, ...cached }
});

test('counts each game once and gives incomplete records precedence over installed records', () => {
  const games = [
    game('Alpha', 'C:\\Games\\Alpha', { addon: true }),
    game('Alpha 2', 'C:\\Games\\Alpha2', { addon: true })
  ];
  const model = buildLibraryModel({
    games,
    aurora: {
      records: {
        'C:\\Games\\Alpha\\bin': { status: 'installed' },
        'C:\\Games\\Alpha\\bin2': { status: 'incomplete' }
      }
    },
    historyRows: []
  });

  assert.equal(model.items[0].auroraStatus, 'incomplete');
  assert.equal(model.items[1].auroraStatus, 'missing');
  assert.deepEqual(model.counts, { all: 2, installed: 0, missing: 1, incomplete: 1, unknown: 0 });
  assert.equal(model.visible.length, 2);
});

test('matches nested install directories and Windows aliases without matching a similar prefix', () => {
  const model = buildLibraryModel({
    games: [
      game('Foo', 'C:\\Games\\Foo'),
      game('Foo 2', 'C:\\Games\\Foo2')
    ],
    aurora: {
      records: {
        'c:/games/foo/Binaries/Win64': { status: 'installed' }
      }
    },
    historyRows: [],
    caseInsensitive: true
  });

  assert.equal(model.items[0].auroraStatus, 'installed');
  assert.deepEqual(model.items[0].recordDirs, ['c:/games/foo/Binaries/Win64']);
  assert.equal(model.items[1].auroraStatus, 'missing');
});

test('treats corrupt stores and unknown record states as status pending instead of not installed', () => {
  const games = [game('Alpha', 'C:\\Games\\Alpha'), game('Beta', 'C:\\Games\\Beta')];
  const corrupt = buildLibraryModel({
    games,
    aurora: { storeError: { path: 'C:\\Data\\aurora-store.json', message: 'invalid JSON' }, records: {} },
    historyRows: []
  });
  assert.equal(corrupt.storeError.path, 'C:\\Data\\aurora-store.json');
  assert.deepEqual(corrupt.counts, { all: 2, installed: 0, missing: 0, incomplete: 0, unknown: 2 });
  assert.ok(corrupt.items.every(item => item.auroraStatus === 'unknown'));

  const unknown = buildLibraryModel({
    games: [games[0]],
    aurora: { records: { 'C:\\Games\\Alpha': { status: 'recovery-required' } } },
    historyRows: []
  });
  assert.equal(unknown.items[0].auroraStatus, 'unknown');
});

test('marks aliased duplicate records as unknown rather than choosing one silently', () => {
  const model = buildLibraryModel({
    games: [game('Alpha', 'C:\\Games\\Alpha')],
    aurora: {
      records: {
        'C:\\Games\\Alpha': { status: 'installed' },
        'c:/games/alpha/': { status: 'incomplete' }
      }
    },
    historyRows: [],
    caseInsensitive: true
  });
  assert.equal(model.items[0].auroraStatus, 'unknown');
});

test('sorts recent plays by successful launch time and leaves operation history out of play order', () => {
  const games = [game('Older', 'C:\\Games\\Older'), game('Newest', 'C:\\Games\\Newest'), game('No Date', 'C:\\Games\\NoDate')];
  const rows = [
    { dir: 'C:\\Games\\Older\\bin', date: '2026-09-28T10:00:00.000Z', action: 'install' },
    { dir: 'c:/games/newest', date: '2026-09-29T10:00:00.000Z', action: 'repair' },
    { dir: 'C:\\Games\\NoDate', date: 'not-a-date', action: 'restore' },
    { dir: 'C:\\Games\\Older', date: '2026-09-30T10:00:00.000Z', action: 'open' }
  ];
  games[0].key = 'older';
  games[1].key = 'newest';
  games[2].key = 'no-date';
  const model = buildLibraryModel({
    games,
    aurora: { records: {} },
    historyRows: rows,
    lastLaunchedAt: { older: 200, newest: 100 },
    sort: 'played',
    caseInsensitive: true
  });
  assert.deepEqual(model.visible.map(item => item.name), ['Older', 'Newest', 'No Date']);
  assert.equal(model.items.find(item => item.name === 'Older').lastOperationAt, Date.parse('2026-09-28T10:00:00.000Z'));
  assert.equal(model.items.find(item => item.name === 'No Date').lastOperationAt, null);

  const fallback = buildLibraryModel({ games, aurora: { records: {} }, historyRows: null, sort: 'played', lastLaunchedAt: { older: 200, newest: 100 } });
  assert.equal(fallback.historyUnavailable, true);
  assert.deepEqual(fallback.visible.map(item => item.name), ['Older', 'Newest', 'No Date']);
});

test('falls back to name order for unplayed games and keeps equal play timestamps stable', () => {
  const games = [
    { ...game('Zulu', 'C:\\Games\\Zulu'), key: 'zulu' },
    { ...game('Alpha', 'C:\\Games\\Alpha'), key: 'alpha' },
    { ...game('Played B', 'C:\\Games\\PlayedB'), key: 'played-b' },
    { ...game('Played A', 'C:\\Games\\PlayedA'), key: 'played-a' },
    { ...game('Invalid time', 'C:\\Games\\Invalid'), key: 'invalid' }
  ];
  const model = buildLibraryModel({
    games,
    aurora: { records: {} },
    historyRows: [],
    sort: 'played',
    lastLaunchedAt: { 'played-b': 50, 'played-a': 50, zulu: 0, alpha: -1, invalid: '60' }
  });

  assert.deepEqual(model.visible.map(item => item.name), ['Played B', 'Played A', 'Alpha', 'Invalid time', 'Zulu']);
  assert.equal(model.items.find(item => item.name === 'Invalid time').lastPlayedAt, null);
});

test('groups stores in source order and sorts each store alphabetically', () => {
  const games = [
    { ...game('Zed Steam', 'C:\\Games\\ZedSteam'), key: 'steam-z', launcher: 'Steam' },
    { ...game('Beta GOG', 'C:\\Games\\BetaGog'), key: 'gog-b', launcher: 'GOG' },
    { ...game('Alpha Steam', 'C:\\Games\\AlphaSteam'), key: 'steam-a', launcher: 'Steam' },
    { ...game('Zulu Epic', 'C:\\Games\\ZuluEpic'), key: 'epic-z', launcher: 'Epic Games' },
    { ...game('Alpha Epic', 'C:\\Games\\AlphaEpic'), key: 'epic-a', launcher: 'Epic Games' }
  ];
  const model = buildLibraryModel({ games, aurora: { records: {} }, historyRows: [], sort: 'store' });

  assert.deepEqual(model.visible.map(item => item.name), [
    'Alpha Steam', 'Zed Steam', 'Alpha Epic', 'Zulu Epic', 'Beta GOG'
  ]);
});

test('sorts names across the full library regardless of their store', () => {
  const games = [
    { ...game('Zulu', 'C:\\Games\\Zulu'), launcher: 'Steam' },
    { ...game('Alpha', 'C:\\Games\\Alpha'), launcher: 'GOG' },
    { ...game('Mike', 'C:\\Games\\Mike'), launcher: 'Epic Games' }
  ];
  const options = { games, aurora: { records: {} }, historyRows: [] };

  assert.deepEqual(buildLibraryModel({ ...options, sort: 'name-asc' }).visible.map(item => item.name), ['Alpha', 'Mike', 'Zulu']);
  assert.deepEqual(buildLibraryModel({ ...options, sort: 'name-desc' }).visible.map(item => item.name), ['Zulu', 'Mike', 'Alpha']);
});

test('combines search, Aurora state, API, DLSS and add-on filters without mutating inputs', () => {
  const games = [
    game('Alpha', 'C:\\Games\\Alpha', { api: 'DirectX 12', hasDlss: true, addon: true }),
    game('Beta', 'C:\\Games\\Beta', { api: 'Vulkan', hasDlss: true, addon: false }),
    game('Gamma', 'C:\\Games\\Gamma', { api: 'DirectX 12', hasDlss: false, addon: true })
  ];
  const records = { 'C:\\Games\\Alpha': { status: 'installed' }, 'C:\\Games\\Gamma': { status: 'incomplete' } };
  const originalGames = games.slice();
  const originalRecordKeys = Object.keys(records);
  const model = buildLibraryModel({
    games,
    aurora: { records },
    historyRows: [],
    filters: { query: 'a', status: 'installed', api: 'DirectX 12', dlss: 'present', addon: 'present' },
    sort: 'name-desc'
  });

  assert.deepEqual(model.visible.map(item => item.name), ['Alpha']);
  assert.deepEqual(games, originalGames);
  assert.deepEqual(Object.keys(records), originalRecordKeys);
});

test('merges added games by normalized directory without duplicating existing cards', () => {
  const alpha = game('Alpha', 'C:\\Games\\Alpha');
  const beta = game('Beta', 'C:\\Games\\Beta');
  const duplicate = game('Alpha duplicate', 'c:/games/alpha/');
  const existing = [alpha];
  const merged = mergeLibraryGames(existing, [duplicate, beta], true);

  assert.deepEqual(merged, [alpha, beta]);
  assert.equal(merged[0], alpha);
  assert.equal(merged[1], beta);
  assert.deepEqual(existing, [alpha]);
});

test('reports whether a newly added game is visible under the current filters', () => {
  const games = [game('Alpha', 'C:\\Games\\Alpha'), game('Beta', 'C:\\Games\\Beta')];
  const model = buildLibraryModel({
    games,
    aurora: { records: {} },
    historyRows: [],
    filters: { query: 'alpha' }
  });

  assert.deepEqual(addedGameFeedback(model, 'C:\\Games\\Alpha'), { visible: true, action: 'open' });
  assert.deepEqual(addedGameFeedback(model, 'C:\\Games\\Beta'), { visible: false, action: 'view' });
  assert.deepEqual(addedGameFeedback(model, 'C:\\Games\\Missing'), { visible: false, action: 'none' });
});

test('publishes package capabilities without allowing a corrupt store to mutate anything', () => {
  assert.deepEqual(packagePresentation({
    packageRoot: 'C:\\Aurora',
    package: { ok: true },
    storeError: null
  }), {
    state: 'ready', canChoose: true, canInstall: true, canRepair: true, canRestore: true
  });
  assert.deepEqual(packagePresentation({
    packageRoot: null,
    package: { ok: false, reason: 'missing' },
    storeError: null
  }), {
    state: 'missing', canChoose: true, canInstall: false, canRepair: false, canRestore: true
  });
  assert.deepEqual(packagePresentation({
    packageRoot: 'C:\\Aurora',
    package: { ok: true },
    storeError: { path: 'C:\\aurora.json', message: 'invalid JSON' }
  }), {
    state: 'corrupt', canChoose: false, canInstall: false, canRepair: false, canRestore: false
  });
});

test('filters the complete library by Aurora status without confusing missing with unknown', () => {
  const games = [
    game('Installed', 'C:\\Games\\Installed'),
    game('Incomplete', 'C:\\Games\\Incomplete'),
    game('Missing', 'C:\\Games\\Missing')
  ];
  const aurora = {
    records: {
      'C:\\Games\\Installed': { status: 'installed' },
      'C:\\Games\\Incomplete': { status: 'incomplete' }
    }
  };
  const incomplete = buildLibraryModel({ games, aurora, historyRows: [], filters: { status: 'incomplete' } });
  assert.deepEqual(incomplete.visible.map(item => item.name), ['Incomplete']);
  assert.deepEqual(incomplete.counts, { all: 3, installed: 1, missing: 1, incomplete: 1, unknown: 0 });

  const unknown = buildLibraryModel({
    games: [games[0]],
    aurora: { records: { 'C:\\Games\\Installed': { status: 'unexpected' } } },
    historyRows: [],
    filters: { status: 'missing' }
  });
  assert.equal(unknown.items[0].auroraStatus, 'unknown');
  assert.equal(unknown.visible.length, 0);
});

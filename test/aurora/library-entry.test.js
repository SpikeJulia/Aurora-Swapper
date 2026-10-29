'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/index.html'), 'utf8');
const renderer = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/renderer.js'), 'utf8');
const style = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/style.css'), 'utf8');

test('the merged library remains the default entry alongside the offline guide', () => {
  const nav = html.slice(html.indexOf('<nav class="nav"'), html.indexOf('</nav>', html.indexOf('<nav class="nav"')));
  const entries = [...nav.matchAll(/data-view="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(entries, ['games', 'guide', 'addons', 'history', 'settings', 'about']);
  assert.match(nav, /class="nav-item active" data-view="games"/);
  assert.doesNotMatch(html, /id="view-home"/);
  assert.match(html, /id="auroraPackageBar"/);
  assert.match(html, /id="gameQuickFilters"/);
  assert.match(html, /id="addGameMenu"/);
});

test('package summary and search tools use independent accessible collapse controls', () => {
  assert.match(html, /id="auroraPackageToggle"[^>]*type="button"[^>]*aria-expanded="true"[^>]*aria-controls="auroraPackageDetails"/);
  assert.match(html, /class="aurora-package-details"[^>]*id="auroraPackageDetails"/);
  assert.doesNotMatch(openingTagForId(html, 'auroraPackageDetails'), /hidden/);
  assert.match(html, /id="libraryToolsToggle"[^>]*type="button"[^>]*aria-expanded="true"[^>]*aria-controls="libraryToolsBody"/);
  const toolBodyStart = html.indexOf('id="libraryToolsBody"');
  const toolBodyEnd = endOfDivWithId(html, 'libraryToolsBody');
  const toolBody = html.slice(toolBodyStart, toolBodyEnd);
  assert.match(toolBody, /id="gameSearch"/);
  assert.match(toolBody, /id="gameSort"/);
  assert.match(toolBody, /id="gameAdvanced"/);
  assert.doesNotMatch(openingTagForId(html, 'libraryToolsBody'), /hidden/);
  assert.ok(html.indexOf('id="gameQuickFilters"') > toolBodyEnd, 'status filters stay visible when search tools are collapsed');
  assert.match(renderer, /auroraPackageToggle.*setAuroraPackageExpanded/);
  assert.match(renderer, /libraryToolsToggle.*setLibraryToolsExpanded/);
  assert.match(renderer, /updateLibraryToolsPresentation\(\)/);
});

test('sort control has four library-wide modes and store grouping is no longer duplicated in settings', () => {
  const options = [...html.matchAll(/<option value="([^"]+)" data-i18n="([^"]+)"/g)]
    .map(match => [match[1], match[2]]);
  assert.deepEqual(options, [
    ['played', 'sortPlayed'], ['store', 'sortStore'],
    ['name-asc', 'sortNameAsc'], ['name-desc', 'sortNameDesc']
  ]);
  assert.match(html, /id="gameSortHint"[^>]*data-i18n="sortPlayedHint"/);
  assert.doesNotMatch(renderer, /setGroupGamesByStore|set-group-games-by-store|id="setGroupGames"/);
  assert.match(renderer, /window\.lab\.setLibrarySort\(selected\)/);
  assert.match(renderer, /libraryState\.sort === 'store'/);
  assert.match(renderer, /libraryState\.lastLaunchedAt\[playKey\] = Date\.now\(\)/);
});

function endOfDivWithId(markup, id) {
  const attribute = markup.indexOf(`id="${id}"`);
  const openingTag = markup.lastIndexOf('<div', attribute);
  const tags = /<\/?div\b[^>]*>/g;
  tags.lastIndex = openingTag;
  let depth = 0;
  let match;
  while ((match = tags.exec(markup))) {
    depth += match[0][1] === '/' ? -1 : 1;
    if (depth === 0) return tags.lastIndex;
  }
  return -1;
}

function openingTagForId(markup, id) {
  const attribute = markup.indexOf(`id="${id}"`);
  const start = markup.lastIndexOf('<div', attribute);
  return markup.slice(start, markup.indexOf('>', start) + 1);
}

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add(...names) { names.forEach(name => values.add(name)); },
    remove(...names) { names.forEach(name => values.delete(name)); },
    contains(name) { return values.has(name); },
    toggle(name, force) {
      const next = force === undefined ? !values.has(name) : Boolean(force);
      if (next) values.add(name); else values.delete(name);
      return next;
    }
  };
}

function loadPackageFoldActions() {
  const from = renderer.indexOf('let packageFoldStatus = null;');
  const to = renderer.indexOf('\nfunction normaliseAuroraResponse', from);
  assert.ok(from >= 0 && to > from, 'renderer must define package collapse behavior');
  const nodes = {
    auroraPackageBar: { classList: makeClassList(), dataset: {} },
    auroraPackageTitle: { textContent: '' },
    auroraPackageDescription: { textContent: '' },
    libraryChooseAuroraPackage: { disabled: false, textContent: '' },
    auroraPackageDetails: { classList: makeClassList() },
    auroraPackageToggle: { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }
  };
  const context = {
    $: id => nodes[id], nodes,
    libraryModel: { packagePresentation: aurora => ({ state: aurora.state, canChoose: aurora.state !== 'corrupt' }) },
    libraryState: { aurora: null },
    t: key => key
  };
  vm.runInNewContext(`${renderer.slice(from, to)}\nglobalThis.packageFoldApi = { renderAuroraPackage, setAuroraPackageExpanded, get expanded() { return auroraPackageExpanded; } };`, context);
  return context.packageFoldApi;
}

test('Aurora package collapse defaults open except when ready', () => {
  for (const state of ['missing', 'invalid', 'corrupt']) {
    const api = loadPackageFoldActions();
    api.renderAuroraPackage({ state });
    assert.equal(api.expanded, true, `${state} package details should default open`);
  }
  const ready = loadPackageFoldActions();
  ready.renderAuroraPackage({ state: 'ready', packageRoot: '/Aurora' });
  assert.equal(ready.expanded, false, 'ready package details should default closed');
});

test('package manual collapse persists within a status and status changes reapply defaults', () => {
  const api = loadPackageFoldActions();
  api.renderAuroraPackage({ state: 'missing' });
  api.setAuroraPackageExpanded(false);
  api.renderAuroraPackage({ state: 'missing' });
  assert.equal(api.expanded, false, 'same-state refresh preserves the user choice');
  api.renderAuroraPackage({ state: 'ready', packageRoot: '/Aurora' });
  assert.equal(api.expanded, false, 'status transition to ready applies collapsed default');
  api.setAuroraPackageExpanded(true);
  api.renderAuroraPackage({ state: 'ready', packageRoot: '/Aurora' });
  assert.equal(api.expanded, true, 'same-state refresh preserves manual expansion');
  api.renderAuroraPackage({ state: 'invalid' });
  assert.equal(api.expanded, true, 'transition back to invalid applies expanded default');
});

test('search tools independently collapse and disclose active hidden filters', () => {
  const from = renderer.indexOf('let libraryToolsExpanded = true;');
  const to = renderer.indexOf('\nfunction renderGames()', from);
  assert.ok(from >= 0 && to > from, 'renderer must define search collapse behavior');
  const nodes = {
    libraryToolsToggle: { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } },
    libraryToolsBody: { classList: makeClassList() },
    libraryToolsActive: { classList: makeClassList(['hidden']) }
  };
  const context = { nodes, filters: { query: '', api: 'all', dlss: 'all', addon: 'all' } };
  context.$ = id => nodes[id];
  vm.runInNewContext(`${renderer.slice(from, to)}\nglobalThis.toolsFoldApi = { setLibraryToolsExpanded, updateLibraryToolsPresentation, get expanded() { return libraryToolsExpanded; } };`, context);
  const api = context.toolsFoldApi;
  api.updateLibraryToolsPresentation();
  assert.equal(api.expanded, true);
  assert.equal(nodes.libraryToolsToggle.attributes['aria-expanded'], 'true');
  api.setLibraryToolsExpanded(false);
  assert.equal(nodes.libraryToolsBody.classList.contains('hidden'), true);
  assert.equal(nodes.libraryToolsToggle.attributes['aria-expanded'], 'false');
  context.filters.query = 'Aurora';
  api.updateLibraryToolsPresentation();
  assert.equal(nodes.libraryToolsActive.classList.contains('hidden'), false);
  api.setLibraryToolsExpanded(true);
  assert.equal(nodes.libraryToolsActive.classList.contains('hidden'), true, 'do not show the badge while filters are visible');
  api.setLibraryToolsExpanded(false);
  assert.equal(nodes.libraryToolsActive.classList.contains('hidden'), false);
  context.filters.query = '';
  api.updateLibraryToolsPresentation();
  assert.equal(nodes.libraryToolsActive.classList.contains('hidden'), true);
  api.setLibraryToolsExpanded(true);
  assert.equal(nodes.libraryToolsBody.classList.contains('hidden'), false);
});

test('library refresh rejects stale responses and normalizes the three data sources', () => {
  assert.match(renderer, /async function refreshLibrary\(/);
  assert.match(renderer, /const requestId = \+\+libraryRefreshId/);
  assert.match(renderer, /if \(requestId !== libraryRefreshId\) return/);
  assert.match(renderer, /window\.lab\.library\(\)/);
  assert.match(renderer, /window\.lab\.auroraState/);
  assert.match(renderer, /window\.lab\.history/);
});

test('adding and choosing Aurora package use the merged library actions', () => {
  assert.match(renderer, /addedGameFeedback\(/);
  assert.match(renderer, /mergeLibraryGames\(/);
  assert.match(renderer, /libraryChooseAuroraPackage/);
  assert.match(renderer, /chooseAuroraPackage\(/);
  assert.match(renderer, /packagePresentation\(/);
});

test('empty-state single-game button shares the direct picker action with the top menu', () => {
  const from = renderer.indexOf('function renderGames()');
  const to = renderer.indexOf("$('gameSearch').oninput", from);
  const renderGames = renderer.slice(from, to);
  assert.match(renderGames, /id="emptyAddGame">\$\{t\('addGameSingle'\)\}/);
  assert.match(renderGames, /id="emptyAddFolder"/);
  assert.match(renderGames, /\$\('emptyAddGame'\)\?\.addEventListener\('click', addSingleGame\)/);
  assert.match(renderGames, /\$\('emptyAddFolder'\)\?\.addEventListener\('click', addGameFolder\)/);
  assert.match(renderGames, /id="emptyClearFilters"/);
  assert.match(renderGames, /\$\('emptyClearFilters'\)\?\.addEventListener\('click', \(\) => \$\('clearGameFilters'\)\.click\(\)\)/);
  assert.match(renderer, /\$\('addGame'\)\.onclick = addSingleGame/);
  assert.match(renderer, /\$\('addFolder'\)\.onclick = addGameFolder/);
});

function loadAddActions(overrides = {}) {
  const from = renderer.indexOf('function closeAddGameMenu()');
  const to = renderer.indexOf('\nasync function pickGame(', from);
  assert.ok(from >= 0 && to > from, 'renderer must define the shared add actions');
  const context = {
    $: () => ({ classList: { add() {} }, setAttribute() {} }),
    window: { lab: { addGame: async () => null, addFolder: async () => false, ...overrides.lab } },
    libraryState: { actionError: null },
    finishAddedGame: async () => null,
    load: async () => {},
    renderLibraryAttention() {},
    log() {},
    t: (key, ...args) => `${key}: ${args.join(' ')}`
  };
  vm.runInNewContext(`${renderer.slice(from, to)}\nglobalThis.addActions = { addSingleGame, addGameFolder };`, context);
  context.actions = context.addActions;
  return context;
}

test('cancelling the single-game picker does not register a game', async () => {
  let pickerCalls = 0;
  let finishCalls = 0;
  const loaded = loadAddActions({ lab: { addGame: async () => { pickerCalls++; return null; } } });
  loaded.finishAddedGame = async () => { finishCalls++; };

  await loaded.actions.addSingleGame();

  assert.equal(pickerCalls, 1);
  assert.equal(finishCalls, 0);
});

test('selecting one folder refreshes the library exactly once', async () => {
  const chosen = '/Games/Example';
  let pickerCalls = 0;
  const finished = [];
  const loaded = loadAddActions({ lab: { addGame: async () => { pickerCalls++; return chosen; } } });
  loaded.finishAddedGame = async dir => { finished.push(dir); return { dir }; };

  const result = await loaded.actions.addSingleGame();

  assert.equal(pickerCalls, 1);
  assert.deepEqual(finished, [chosen]);
  assert.equal(result.dir, chosen);
});

test('empty-state library-folder action calls the folder picker and refreshes once', async () => {
  let pickerCalls = 0;
  let refreshCalls = 0;
  const loaded = loadAddActions({ lab: { addFolder: async () => { pickerCalls++; return '/Games'; } } });
  loaded.load = async () => { refreshCalls++; };

  const added = await loaded.actions.addGameFolder();

  assert.equal(added, true);
  assert.equal(pickerCalls, 1);
  assert.equal(refreshCalls, 1);
});

test('a picker error is surfaced in the library attention area', async () => {
  const rendered = [];
  const loaded = loadAddActions({ lab: { addGame: async () => { throw new Error('picker unavailable'); } } });
  loaded.renderLibraryAttention = () => { rendered.push(loaded.libraryState.actionError); };

  await loaded.actions.addSingleGame();

  assert.match(loaded.libraryState.actionError, /picker unavailable/);
  assert.match(rendered.at(-1), /picker unavailable/);
});

test('the game grid renders the model rather than legacy Swapper readiness', () => {
  const from = renderer.indexOf('function renderGames()');
  const to = renderer.indexOf("$('gameSearch').oninput", from);
  const renderGames = renderer.slice(from, to);
  assert.match(renderGames, /rebuildLibraryModel\(\)/);
  assert.match(renderer, /auroraStatus/);
  assert.match(renderer, /model\.counts/);
  assert.doesNotMatch(renderGames, /gameFilters\.matches/);
});

test('recent cards and the old home drop zone are removed while session logs live on history', () => {
  assert.doesNotMatch(html, /id="dropZone"/);
  assert.doesNotMatch(html, /id="browseBtn"/);
  assert.doesNotMatch(html, /id="recents"/);
  const historyStart = html.indexOf('id="view-history"');
  const historyEnd = html.indexOf('</section>', historyStart);
  const history = html.slice(historyStart, historyEnd);
  assert.match(history, /id="log"/);
  assert.match(history, /id="copyLog"/);
  assert.match(history, /id="clearLog"/);
});

test('show home remains a compatibility alias for the merged games view', () => {
  const views = ['games', 'addons', 'history', 'settings', 'about'].map(view => ({
    id: `view-${view}`,
    classList: { toggle(_name, active) { this.active = active; } }
  }));
  const nav = ['games', 'addons', 'history', 'settings', 'about'].map(view => ({
    dataset: { view },
    classList: { toggle(_name, active) { this.active = active; } }
  }));
  const context = {
    window: { chatUi: { stopPolling() {} } },
    document: { querySelectorAll(selector) { return selector === '.view' ? views : nav; } },
    paintAuroraHome() {}
  };
  const from = renderer.indexOf('function show(view)');
  const to = renderer.indexOf('for (const link of document.querySelectorAll', from);
  vm.runInNewContext(renderer.slice(from, to), context);

  context.show('home');
  assert.equal(views.find(view => view.id === 'view-games').classList.active, true);
  assert.equal(nav.find(button => button.dataset.view === 'games').classList.active, true);
});

test('merged library defines responsive toolbar and card breakpoints', () => {
  assert.match(style, /\.library-filters \.game-search\s*\{\s*flex-basis: 100%/);
  assert.match(style, /@media \(max-width: 1024px\)/);
  assert.match(style, /@media \(max-width: 900px\)/);
  assert.match(style, /@media \(max-width: 760px\)/);
  assert.match(style, /\.grid\s*\{\s*grid-template-columns: repeat\(auto-fit, minmax\(170px, 1fr\)\)/);
});

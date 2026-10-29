'use strict';

// The renderer uses this file in a browser while the regression tests load it
// through CommonJS. Keep the model free of DOM, Electron, and filesystem
// dependencies so it can be exercised with ordinary data.
(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.auroraLibraryModel = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const AURORA_STATUSES = new Set(['installed', 'incomplete']);
  const HISTORY_ACTIONS = new Set(['install', 'repair', 'restore', 'recovery']);
  const STORE_ORDER = ['Steam', 'Epic Games', 'GOG', 'Xbox', 'Ubisoft', 'Added by hand', 'My folders'];
  const NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function pathKey(value, caseInsensitive) {
    let text = String(value || '').trim().replace(/\\/g, '/');
    while (text.length > 1 && text.endsWith('/')) text = text.slice(0, -1);
    return caseInsensitive ? text.toLocaleLowerCase() : text;
  }

  function queryKey(value) {
    return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
  }

  function covers(gameDir, childDir, caseInsensitive) {
    const root = pathKey(gameDir, caseInsensitive);
    const child = pathKey(childDir, caseInsensitive);
    return Boolean(root && child && (root === child || child.startsWith(root + '/')));
  }

  function unique(values, caseInsensitive) {
    const seen = new Set();
    return values.filter((value) => {
      const key = pathKey(value, caseInsensitive);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function recordEntries(aurora, caseInsensitive) {
    const records = aurora && aurora.records;
    if (!records || typeof records !== 'object' || Array.isArray(records)) {
      return { entries: [], conflictKeys: new Set() };
    }

    const aliases = new Map();
    const entries = Object.entries(records).map(([key, record]) => {
      const dirs = unique([
        key,
        record && typeof record.gameDir === 'string' ? record.gameDir : ''
      ], caseInsensitive);
      const entry = {
        key,
        record,
        dirs,
        status: record && typeof record === 'object' ? record.status : null,
        validStatus: Boolean(record && typeof record === 'object' && AURORA_STATUSES.has(record.status))
      };
      const alias = pathKey(key, caseInsensitive);
      if (alias) {
        if (!aliases.has(alias)) aliases.set(alias, []);
        aliases.get(alias).push(entry);
      }
      return entry;
    });

    const conflictKeys = new Set();
    for (const samePath of aliases.values()) {
      if (samePath.length > 1) samePath.forEach((entry) => conflictKeys.add(entry.key));
    }
    return { entries, conflictKeys };
  }

  function operationTime(row) {
    if (!row || !HISTORY_ACTIONS.has(row.action)) return null;
    const value = row.date instanceof Date ? row.date.getTime() : (
      typeof row.date === 'number' ? row.date : Date.parse(String(row.date || ''))
    );
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function historyForGame(game, historyRows, caseInsensitive) {
    if (!Array.isArray(historyRows)) return [];
    return historyRows
      .map((row) => ({ row, at: operationTime(row) }))
      .filter(({ row, at }) => at !== null && covers(game.dir, row && row.dir, caseInsensitive))
      .sort((a, b) => b.at - a.at);
  }

  function apiOf(game) {
    const scan = game && game.cached;
    return scan && scan.dx12 ? 'DirectX 12' : (scan && (scan.api || scan.reason)) || game && game.api || 'unknown';
  }

  function hasDlss(game) {
    const scan = game && game.cached;
    return Boolean(scan && (scan.hasDlss ?? scan.dlss) || game && game.dlss);
  }

  function hasAddon(game) {
    const scan = game && game.cached;
    return Boolean(scan && (scan.addon ?? scan.addOn) || game && game.addon);
  }

  function matchesFilter(item, filters) {
    const query = queryKey(filters.query);
    if (query) {
      const haystack = queryKey([item.name, item.cn, item.dir].filter(Boolean).join(' '));
      if (!haystack.includes(query)) return false;
    }
    if (filters.status && filters.status !== 'all' && item.auroraStatus !== filters.status) return false;
    if (filters.api && filters.api !== 'all' && apiOf(item.game) !== filters.api) return false;
    if (filters.dlss && !['all', ''].includes(filters.dlss)) {
      if (filters.dlss.startsWith('version:')) {
        const version = String(item.game && item.game.cached && item.game.cached.dlss || item.game && item.game.dlss || '');
        if (version !== filters.dlss.slice(8)) return false;
      } else {
        const wanted = ['present', 'yes', 'true'].includes(filters.dlss);
        if (hasDlss(item.game) !== wanted) return false;
      }
    }
    if (filters.addon && !['all', ''].includes(filters.addon)) {
      const wanted = ['present', 'yes', 'true'].includes(filters.addon);
      if (hasAddon(item.game) !== wanted) return false;
    }
    return true;
  }

  function nameCompare(a, b) {
    return NAME_COLLATOR.compare(String(a.name || ''), String(b.name || ''));
  }

  function sortVisible(items, sort) {
    const visible = items.slice();
    visible.sort((a, b) => {
      if (sort === 'name-asc') return nameCompare(a, b);
      if (sort === 'name-desc') return -nameCompare(a, b);
      if (sort === 'store') {
        const aStore = String(a.game && a.game.launcher || '');
        const bStore = String(b.game && b.game.launcher || '');
        const aRank = STORE_ORDER.indexOf(aStore);
        const bRank = STORE_ORDER.indexOf(bStore);
        const aGroup = aRank === -1 ? STORE_ORDER.length : aRank;
        const bGroup = bRank === -1 ? STORE_ORDER.length : bRank;
        if (aGroup !== bGroup) return aGroup - bGroup;
        if (aGroup === STORE_ORDER.length) {
          const storeOrder = NAME_COLLATOR.compare(aStore, bStore);
          if (storeOrder) return storeOrder;
        }
        return nameCompare(a, b);
      }

      const aTime = a.lastPlayedAt;
      const bTime = b.lastPlayedAt;
      if (aTime === null && bTime !== null) return 1;
      if (aTime !== null && bTime === null) return -1;
      if (aTime === null && bTime === null) return nameCompare(a, b);
      if (aTime !== bTime) return bTime - aTime;
      return 0;
    });
    return visible;
  }

  function buildLibraryModel({
    games = [],
    aurora = null,
    historyRows = [],
    lastLaunchedAt = {},
    filters = {},
    sort = 'played',
    caseInsensitive = false
  } = {}) {
    const { entries, conflictKeys } = recordEntries(aurora, caseInsensitive);
    const storeError = aurora && aurora.storeError ? aurora.storeError : null;
    const historyUnavailable = historyRows === null;
    const items = games.map((game) => {
      const matched = entries.filter((entry) => entry.dirs.some((dir) => covers(game.dir, dir, caseInsensitive)));
      const history = historyForGame(game, historyRows, caseInsensitive);
      const playKey = String(game && game.key || pathKey(game && game.dir, caseInsensitive));
      const playedValue = lastLaunchedAt && typeof lastLaunchedAt === 'object' && !Array.isArray(lastLaunchedAt)
        && Object.hasOwn(lastLaunchedAt, playKey) ? lastLaunchedAt[playKey] : null;
      const lastPlayedAt = typeof playedValue === 'number' && Number.isFinite(playedValue) && playedValue > 0
        ? playedValue : null;
      let auroraStatus = 'missing';
      if (storeError || matched.some((entry) => conflictKeys.has(entry.key) || !entry.validStatus)) {
        auroraStatus = 'unknown';
      } else if (matched.some((entry) => entry.status === 'incomplete')) {
        auroraStatus = 'incomplete';
      } else if (matched.some((entry) => entry.status === 'installed')) {
        auroraStatus = 'installed';
      }
      return {
        ...game,
        game,
        auroraStatus,
        api: apiOf(game),
        dlssPresent: hasDlss(game),
        addonPresent: hasAddon(game),
        recordDirs: unique(matched.flatMap((entry) => entry.dirs), caseInsensitive),
        lastPlayedAt,
        lastOperationAt: history.length ? history[0].at : null,
        lastOperation: history.length ? history[0].row.action : null
      };
    });

    const counts = { all: items.length, installed: 0, missing: 0, incomplete: 0, unknown: 0 };
    for (const item of items) counts[item.auroraStatus] += 1;
    const visible = sortVisible(items.filter((item) => matchesFilter(item, filters)), sort);
    return { items, counts, visible, storeError, historyUnavailable };
  }

  function mergeLibraryGames(existing = [], additions = [], caseInsensitive = false) {
    const result = [];
    const seen = new Set();
    const candidates = [
      ...(Array.isArray(existing) ? existing : []),
      ...(Array.isArray(additions) ? additions : [])
    ];
    for (const game of candidates) {
      if (!game || typeof game !== 'object') continue;
      const key = pathKey(game.dir, caseInsensitive);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      result.push(game);
    }
    return result;
  }

  function addedGameFeedback(model, dir, caseInsensitive = false) {
    const key = pathKey(dir, caseInsensitive);
    if (!key || !model || !Array.isArray(model.items)) return { visible: false, action: 'none' };
    const item = model.items.find((candidate) => pathKey(candidate.dir, caseInsensitive) === key);
    if (!item) return { visible: false, action: 'none' };
    const visible = Array.isArray(model.visible) && model.visible.some(
      (candidate) => pathKey(candidate.dir, caseInsensitive) === key
    );
    return { visible, action: visible ? 'open' : 'view' };
  }

  function packagePresentation(aurora = {}) {
    if (aurora && aurora.storeError) {
      return { state: 'corrupt', canChoose: false, canInstall: false, canRepair: false, canRestore: false };
    }
    if (aurora && aurora.package && aurora.package.ok === true) {
      return { state: 'ready', canChoose: true, canInstall: true, canRepair: true, canRestore: true };
    }
    const packageRoot = aurora && aurora.packageRoot;
    if (packageRoot === null || packageRoot === undefined || String(packageRoot).trim() === '') {
      return { state: 'missing', canChoose: true, canInstall: false, canRepair: false, canRestore: true };
    }
    return { state: 'invalid', canChoose: true, canInstall: false, canRepair: false, canRestore: true };
  }

  return {
    buildLibraryModel,
    mergeLibraryGames,
    addedGameFeedback,
    packagePresentation,
    covers,
    pathKey
  };
});

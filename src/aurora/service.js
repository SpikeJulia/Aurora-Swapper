'use strict';
const path = require('path');
const { recoverTransaction: recoverAuroraTransaction } = require('./transaction');

function pathApiFor(platform) {
  return platform === 'win32' ? path.win32 : path;
}

function gameKey(gameDir, platform = process.platform) {
  if (typeof gameDir !== 'string' || !gameDir.trim()) return '';
  const api = pathApiFor(platform);
  const absolute = api.normalize(api.resolve(gameDir));
  const root = api.parse(absolute).root;
  const trimmed = absolute.length > root.length ? absolute.replace(/[\\/]+$/, '') : absolute;
  return platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

function entriesForPath(table, key, platform) {
  return Object.entries(table || {}).filter(([stored]) => gameKey(stored, platform) === key);
}

function pathEntry(table, key, platform, kind) {
  const entries = entriesForPath(table, key, platform);
  if (entries.length > 1) return { conflict: true, keys: entries.map(([stored]) => stored), kind };
  return entries.length ? { key: entries[0][0], value: entries[0][1] } : { key: null, value: null };
}

function storeFailure(store) {
  if (!store || !store.storeError) return null;
  return {
    ok: false,
    error: 'store-corrupt',
    storePath: store.storeError.path,
    message: store.storeError.message
  };
}

function withWarning(result, gameRunning) {
  return gameRunning === null ? { ...result, unconfirmedClose: true } : result;
}

function createAuroraService(deps = {}) {
  const platform = deps.platform || process.platform;
  const api = pathApiFor(platform);
  const active = new Set();

  function loadFresh() {
    const store = deps.loadStore();
    const error = storeFailure(store);
    if (error) throw Object.assign(new Error(error.message), error);
    return store;
  }

  function uniqueEntry(store, tableName, key) {
    const normalized = gameKey(key, platform);
    const entry = pathEntry(store[tableName], normalized, platform, tableName === 'records' ? 'record-key-conflict' : 'transaction-key-conflict');
    if (entry.conflict) return { error: { ok: false, error: entry.kind, keys: entry.keys } };
    return { entry };
  }

  async function writeCheckpoint(storeKey, exePath, transaction, commit) {
    const latest = loadFresh();
    const recordMatch = uniqueEntry(latest, 'records', storeKey);
    if (recordMatch.error) throw new Error(recordMatch.error.error);
    const transactionMatch = uniqueEntry(latest, 'transactions', storeKey);
    if (transactionMatch.error) throw new Error(transactionMatch.error.error);

    if (transaction) {
      const savedTransaction = {
        ...transaction,
        gameDir: storeKey,
        exePath: exePath || transaction.exePath || null,
        nextRecord: transaction.nextRecord
          ? { ...transaction.nextRecord, ...(exePath ? { exePath } : {}) }
          : transaction.nextRecord
      };
      latest.transactions[transactionMatch.entry.key || storeKey] = savedTransaction;
      if (savedTransaction.phase === 'needs-recovery' && savedTransaction.nextRecord) {
        latest.records[recordMatch.entry.key || storeKey] = {
          ...savedTransaction.nextRecord,
          status: 'incomplete'
        };
      }
    } else {
      if (transactionMatch.entry.key) delete latest.transactions[transactionMatch.entry.key];
    }

    if (commit && Object.prototype.hasOwnProperty.call(commit, 'record')) {
      if (commit.record) {
        latest.records[recordMatch.entry.key || storeKey] = {
          ...commit.record,
          ...(exePath ? { exePath } : {})
        };
      } else if (recordMatch.entry.key) {
        delete latest.records[recordMatch.entry.key];
      }
    }
    deps.saveStore(latest);
  }

  function mutateLatest(storeKey, change) {
    const latest = loadFresh();
    const recordMatch = uniqueEntry(latest, 'records', storeKey);
    if (recordMatch.error) return recordMatch.error;
    const transactionMatch = uniqueEntry(latest, 'transactions', storeKey);
    if (transactionMatch.error) return transactionMatch.error;
    const result = change(latest, recordMatch.entry, transactionMatch.entry);
    if (result && result.ok === false) return result;
    deps.saveStore(latest);
    return result;
  }

  async function run(action, options = {}) {
    if (!['install', 'check', 'restore'].includes(action)) return { ok: false, error: 'bad-action' };
    if (typeof options.gameDir !== 'string' || !options.gameDir.trim()) return { ok: false, error: 'bad-game-directory' };
    const key = gameKey(options.gameDir, platform);
    if (!key) return { ok: false, error: 'bad-game-directory' };
    if (active.has(key)) return { ok: false, error: 'operation-in-progress' };
    active.add(key);

    try {
      const store = loadFresh();
      const records = uniqueEntry(store, 'records', key);
      if (records.error) return records.error;
      const transactions = uniqueEntry(store, 'transactions', key);
      if (transactions.error) return transactions.error;
      const record = records.entry.value || null;
      const transaction = transactions.entry.value || null;
      if (transaction && action !== 'restore') return { ok: false, error: 'recovery-required' };
      const storeKey = records.entry.key || transactions.entry.key || key;
      const gameDir = api.resolve(options.gameDir);
      const exePath = await (deps.resolveExePath
        ? deps.resolveExePath({
          gameDir,
          requestedExePath: options.exePath || null,
          record,
          transaction,
          store
        })
        : Promise.resolve(options.exePath || (record && record.exePath) || (transaction && transaction.exePath) || null));
      let gameRunning = null;
      try {
        const state = await deps.queryGameRunning(exePath || null);
        gameRunning = state === true || state === false ? state : null;
      } catch { gameRunning = null; }
      if (gameRunning === true) return { ok: false, error: 'game-running' };

      if (transaction && action === 'restore') {
        let powershellRunning = null;
        try {
          const state = await deps.queryPowerShellRunning();
          powershellRunning = state === true || state === false ? state : null;
        } catch { powershellRunning = null; }
        if (powershellRunning === true) return withWarning({ ok: false, error: 'powershell-running' }, gameRunning);
        if (powershellRunning !== false) return withWarning({ ok: false, error: 'process-state-unknown' }, gameRunning);
      }

      let restoreRecord = record || (transaction && transaction.nextRecord) || null;
      const baseInput = {
        gameDir,
        backupDir: deps.getBackupDir ? deps.getBackupDir(gameDir) : null,
        storeKey,
        record: record || (transaction && transaction.nextRecord) || null,
        transaction,
        gameRunning,
        exePath
      };
      if (action === 'install') {
        if (typeof deps.validatePackage === 'function') {
          const pkg = deps.validatePackage(store.packageRoot);
          if (!pkg.ok) return withWarning({ ok: false, error: 'package-invalid', reason: pkg.reason }, gameRunning);
        }
        const checkpoint = (tx, commit) => writeCheckpoint(storeKey, exePath, tx, commit);
        const input = {
          ...baseInput,
          packageRoot: store.packageRoot,
          proxy: options.proxy,
          overwriteConfirmed: options.overwriteConfirmed === true,
          addons: deps.getAddons ? deps.getAddons() : [],
          checkpoint
        };
        const result = await deps.runInstall(input, checkpoint);
        if (!result) return withWarning({ ok: false, error: 'install-failed' }, gameRunning);
        const completed = result.record && exePath && !result.record.exePath
          ? { ...result, record: { ...result.record, exePath } }
          : { ...result };
        if (completed.ok && deps.recordHistory) {
          const warning = deps.recordHistory(gameDir, completed.record, 'install', completed.addonFailure);
          if (warning) completed.historyWarning = warning;
        }
        return withWarning(completed, gameRunning);
      }

      if (!record && !(action === 'restore' && transaction && transaction.nextRecord)) {
        return withWarning({ ok: false, error: 'not-installed' }, gameRunning);
      }
      if (action === 'check') {
        if (typeof deps.validatePackage === 'function') {
          const pkg = deps.validatePackage(store.packageRoot);
          if (!pkg.ok) return withWarning({ ok: false, error: 'package-invalid', reason: pkg.reason }, gameRunning);
        }
        const result = await deps.runCheck(baseInput);
        if (!result || !result.ok) return withWarning(result || { ok: false, error: 'check-failed' }, gameRunning);
        const persisted = mutateLatest(storeKey, (latest, current) => {
          if (!current.key) return { ok: false, error: 'record-missing' };
          const updated = {
            ...current.value,
            status: 'installed',
            ...(exePath ? { exePath } : {})
          };
          latest.records[current.key] = updated;
          return { ok: true, record: updated };
        });
        if (persisted && persisted.ok === false) return withWarning(persisted, gameRunning);
        const completed = { ...result, ...(persisted && persisted.record ? { record: persisted.record } : {}) };
        if (deps.recordHistory) {
          const warning = deps.recordHistory(gameDir, completed.record || record, 'repair');
          if (warning) completed.historyWarning = warning;
        }
        return withWarning(completed, gameRunning);
      }

      let activeTransaction = transaction;
      if (transaction && action === 'restore') {
        const phase = transaction.phase;
        const copyRollback = ['prepared', 'copying'].includes(phase) ||
          (phase === 'needs-recovery' && transaction.recoveryKind === 'copy-rollback');
        if (copyRollback) {
          const recovery = (deps.recoverTransaction || recoverAuroraTransaction)(transaction, {
            ...(deps.recoveryOptions || {}),
            gameDir,
            backupDir: baseInput.backupDir,
            gameRunning,
            powershellRunning: false
          });
          if (!recovery.ok) {
            const preserved = recovery.transaction || transaction;
            const saved = mutateLatest(storeKey, (latest, current, currentTransaction) => {
              if (currentTransaction.key) latest.transactions[currentTransaction.key] = preserved;
              if (recovery.record && current.key) latest.records[current.key] = recovery.record;
              return { ok: true };
            });
            if (saved && saved.ok === false) return withWarning(saved, gameRunning);
            return withWarning({ ok: false, error: recovery.error || 'recovery-failed' }, gameRunning);
          }
          const committed = mutateLatest(storeKey, (latest, current, currentTransaction) => {
            if (currentTransaction.key) delete latest.transactions[currentTransaction.key];
            if (recovery.record) latest.records[current.key || storeKey] = recovery.record;
            else if (current.key) delete latest.records[current.key];
            return { ok: true };
          });
          if (!committed || !committed.ok) {
            return withWarning(committed || { ok: false, error: 'recovery-commit-failed' }, gameRunning);
          }
          activeTransaction = null;
          restoreRecord = recovery.record;
          if (deps.cleanupTransaction) {
            try { deps.cleanupTransaction(transaction, gameDir); } catch { /* Store now points at the restored previous record. */ }
          }
          if (!restoreRecord) {
            const complete = { ok: true, status: 'not-installed', record: null };
            if (deps.recordHistory) {
              const warning = deps.recordHistory(gameDir, transaction.nextRecord || { files: [] }, 'restore');
              if (warning) complete.historyWarning = warning;
            }
            return withWarning(complete, gameRunning);
          }
        } else if (['script-running', 'needs-recovery'].includes(phase)) {
          restoreRecord = transaction.nextRecord || restoreRecord;
        } else {
          return withWarning({ ok: false, error: 'bad-transaction-phase' }, gameRunning);
        }
      }

      const result = await deps.runRestore({ ...baseInput, record: restoreRecord, transaction: activeTransaction });
      if (!result || !result.ok) return withWarning(result || { ok: false, error: 'restore-failed' }, gameRunning);
      const persisted = mutateLatest(storeKey, (latest, current, currentTransaction) => {
        if (current.key) delete latest.records[current.key];
        if (currentTransaction.key) delete latest.transactions[currentTransaction.key];
        return { ok: true };
      });
      if (persisted && persisted.ok === false) return withWarning(persisted, gameRunning);
      if (activeTransaction && deps.cleanupTransaction) {
        try { deps.cleanupTransaction(transaction, gameDir); } catch { /* The store no longer points at this snapshot. */ }
      }
      if (deps.recordHistory) {
        const warning = deps.recordHistory(gameDir, restoreRecord || { files: [] }, 'restore');
        if (warning) result.historyWarning = warning;
      }
      return withWarning(result, gameRunning);
    } catch (error) {
      if (error && error.error === 'store-corrupt') return error;
      return { ok: false, error: 'operation-failed', message: error.message || String(error) };
    } finally {
      active.delete(key);
    }
  }

  return { run };
}

module.exports = { gameKey, createAuroraService };

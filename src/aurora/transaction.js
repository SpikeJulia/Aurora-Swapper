'use strict';
const path = require('path');
const fs = require('fs');
const { restoreCopy } = require('./copy');
const { validateTransaction } = require('./paths');

function incompleteRecord(transaction) {
  return transaction.nextRecord
    ? { ...transaction.nextRecord, status: 'incomplete' }
    : null;
}

function recoverTransaction(transaction, deps = {}) {
  const phase = transaction && transaction.phase;
  const retryCopyRollback = phase === 'needs-recovery' && transaction.recoveryKind === 'copy-rollback';
  if (!['prepared', 'copying', 'script-running', 'needs-recovery'].includes(phase)) {
    return { ok: false, error: 'bad-transaction-phase', transaction };
  }
  if (phase === 'script-running' || (phase === 'needs-recovery' && !retryCopyRollback)) {
    return {
      ok: false,
      error: 'manual-restore-required',
      transaction: { ...transaction, phase: 'needs-recovery' },
      record: incompleteRecord(transaction)
    };
  }
  if (deps.gameRunning !== false || deps.powershellRunning !== false) {
    const copyRollback = phase === 'prepared' || phase === 'copying' || retryCopyRollback;
    return {
      ok: false,
      error: 'process-state-unknown',
      transaction: {
        ...transaction,
        phase: 'needs-recovery',
        ...(copyRollback ? { recoveryKind: 'copy-rollback' } : {})
      },
      record: incompleteRecord(transaction)
    };
  }
  try {
    validateTransaction(transaction, {
      gameDir: deps.gameDir,
      backupDir: deps.backupDir,
      fs: deps.fs || fs,
      path: deps.path || path
    });
  } catch (error) {
    return {
      ok: false,
      error: 'unsafe-transaction',
      message: error.message,
      transaction: { ...transaction, phase: 'needs-recovery', recoveryKind: 'copy-rollback' },
      record: incompleteRecord(transaction)
    };
  }
  const result = restoreCopy(transaction.snapshotManifest || [], {
    fs: deps.fs || fs,
    path: deps.path || path,
    gameDir: deps.gameDir,
    backupDir: deps.backupDir,
    snapshotDir: transaction.snapshotDir
  });
  if (!result.ok) {
    return {
      ok: false,
      error: 'recovery-failed',
      message: result.message,
      transaction: { ...transaction, phase: 'needs-recovery', recoveryKind: 'copy-rollback' },
      record: incompleteRecord(transaction)
    };
  }
  return {
    ok: true,
    rolledBack: true,
    transaction: null,
    record: transaction.previousRecord || null,
    snapshotDir: transaction.snapshotDir
  };
}

module.exports = { recoverTransaction };

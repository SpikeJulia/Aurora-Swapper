'use strict';

function createAuroraUpdateUi({ getElement, translate: t, checkUpdate, canCheck, onDownload }) {
  let result = null;
  let busy = false;
  let pending = null;

  function message() {
    if (!canCheck()) return t('auroraUpdateBlocked');
    if (busy) return t('auroraUpdateChecking');
    if (!result) return t('auroraUpdateAutoHint');
    const version = result.latestVersion || '';
    const keys = {
      'up-to-date': 'auroraUpdateCurrent', available: 'auroraUpdateLatest',
      'local-unknown': 'auroraUpdateLocalUnknown', 'current-ahead': 'auroraUpdateAhead',
      'different-release': 'auroraUpdateDifferent', error: 'auroraUpdateFailed'
    };
    if (result.status === 'update-available') {
      return t(result.currentVersion === version ? 'auroraUpdateRepublished' : 'auroraUpdateAvailable', version);
    }
    return t(keys[result.status] || 'auroraUpdateFailed', version);
  }

  function render() {
    const text = message() + (result?.warning === 'cache-save-failed' ? ` ${t('auroraUpdateCacheWarning')}` : '');
    for (const id of ['auroraUpdateStatus', 'settingsAuroraUpdateStatus']) {
      const node = getElement(id);
      if (!node) continue;
      node.textContent = text;
      node.dataset.status = busy ? 'checking' : result?.status || 'idle';
      const checkedAt = result?.checkedAt || result?.attemptedAt;
      node.title = checkedAt ? t('auroraUpdateCheckedAt', new Date(checkedAt).toLocaleString()) : '';
    }
    for (const id of ['libraryCheckAuroraUpdate', 'settingsCheckAuroraUpdate']) {
      const button = getElement(id);
      if (!button) continue;
      button.textContent = t(busy ? 'auroraUpdateChecking' : 'auroraCheckUpdate');
      button.disabled = busy || !canCheck() || typeof checkUpdate !== 'function';
      button.onclick = () => check(true);
    }
    const action = getElement('auroraUpdateAction');
    if (action) {
      const actionable = ['update-available', 'different-release', 'available', 'local-unknown', 'error'].includes(result?.status);
      action.classList.toggle('hidden', !canCheck() || busy || !actionable);
      action.disabled = busy || !canCheck();
      const retry = result?.status === 'error';
      action.textContent = t(retry ? 'auroraUpdateRetry'
        : ['available', 'local-unknown'].includes(result?.status) ? 'auroraDownloadLatest' : 'auroraDownloadUpdate');
      action.onclick = retry ? () => check(true) : () => onDownload(result?.source);
    }
  }

  function check(force = false) {
    if (pending) return pending;
    if (!canCheck() || typeof checkUpdate !== 'function') { render(); return Promise.resolve(null); }
    busy = true;
    render();
    pending = (async () => {
      try {
        const answer = await checkUpdate(force === true);
        result = answer && typeof answer.status === 'string' ? answer : { ok: false, status: 'error' };
      } catch (error) {
        result = { ok: false, status: 'error', message: error.message || String(error) };
      } finally {
        busy = false;
        render();
      }
      return result;
    })().finally(() => { pending = null; });
    return pending;
  }

  function refresh() {
    return (pending || Promise.resolve()).then(() => check(false));
  }

  render();
  return { check, refresh, render };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createAuroraUpdateUi };
if (typeof window !== 'undefined') window.createAuroraUpdateUi = createAuroraUpdateUi;

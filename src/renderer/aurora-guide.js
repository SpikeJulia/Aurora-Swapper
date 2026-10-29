'use strict';

(function () {
  const data = typeof module !== 'undefined' && module.exports
    ? require('./aurora-guide-data') : window.auroraGuideData;
  const languageKey = language => String(language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  const localize = (value, lang) => value && typeof value === 'object' && !Array.isArray(value)
    ? value[lang] ?? value.en : value;

  function searchGuide(query = '', language = 'zh') {
    const lang = languageKey(language);
    const terms = String(query).normalize('NFKC').toLowerCase().trim().split(/\s+/u).filter(Boolean);
    return data.sections.map(section => ({
      id: section.id, title: localize(section.title, lang), description: localize(section.description, lang),
      entries: section.entries.filter(entry => {
        const haystack = JSON.stringify([section.title, entry]).normalize('NFKC').toLowerCase();
        return terms.every(term => haystack.includes(term));
      }).map(entry => Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, localize(value, lang)])))
    })).filter(section => section.entries.length > 0);
  }

  function versionState(packageState) {
    if (packageState?.storeError) return { state: 'unavailable' };
    if (!packageState?.packageRoot) return { state: 'missing' };
    if (packageState.package?.ok !== true) return { state: 'invalid' };
    const version = packageState.packageVersion;
    if (packageState.packageSource === 'local' || typeof version !== 'string' || !version.trim()) return { state: 'unknown' };
    const normalize = value => value.trim().toLowerCase().replace(/^(?:aurora[-_])?v?/, '');
    return { state: normalize(version) === normalize(data.version) ? 'match' : 'mismatch', currentVersion: version };
  }

  const api = { data, searchGuide, languageKey, versionState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.auroraGuide = api;
})();

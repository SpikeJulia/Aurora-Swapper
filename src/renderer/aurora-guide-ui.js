'use strict';

(function () {
  const guide = typeof module !== 'undefined' && module.exports ? require('./aurora-guide') : window.auroraGuide;
  const strings = {
    zh: {
      title: '使用指南', subtitle: '第一次用请先看「这是什么」；然后安装，再进游戏调参。按问题查阅，不必一次改完所有选项。',
      offline: '内置离线指南 · 只读，不修改游戏配置', search: '搜索指南', placeholder: '搜索参数名或问题，例如 FG Input、锐化、闪退…',
      clear: '清空搜索', expand: '展开全部', collapse: '折叠全部', contents: '章节导航',
      count: n => `${n} 条说明`, empty: '没有找到相关说明。试试英文参数名或更短的关键词。',
      purpose: '作用与影响', values: '可选值／起始设置', applies: '适用条件', restart: '生效与重启', recovery: '如何恢复',
      copy: key => `复制参数名 ${key}`, source: '来源与版本', sourceNote: '本指南根据该发布版本的上游文档与 INI 注释整理，安装部分改写为 Aurora Swapper 的操作流程。Aurora／OptiScaler 及社区贡献者拥有原项目署名；上游为 GPL-3.0。高级完整参数请查对应版本 INI。',
      reviewed: date => `内容核对：${date}`, reference: version => `指南依据：${version}`, current: version => `当前发布包：${version}`,
      match: '当前发布包版本与指南一致；游戏中实际加载的运行库仍需自行确认。',
      mismatch: '发布包版本与指南不同。选项、默认值可能变化，请核对当前包的 INI 和面板；本指南不会随下载自动更新。',
      unknown: '本地包版本无法可靠确认。请核对游戏面板版本与 INI，不要假定与本指南完全一致。',
      missing: '尚未配置发布包，可以先阅读指南。', invalid: '当前发布包无效，先更换有效发布目录再安装。',
      unavailable: '发布包记录无法读取，版本暂不可核对；指南仍可离线查看。', linkFailed: '无法打开上游链接，请检查系统浏览器。'
    },
    en: {
      title: 'Usage guide', subtitle: 'Start with “What this is” if you are new, then install and configure in game. Look up a question rather than changing every option at once.',
      offline: 'Built-in offline guide · Read-only, no game configuration changes', search: 'Search the guide', placeholder: 'Search a parameter or issue, e.g. FG Input, sharpening, crash…',
      clear: 'Clear search', expand: 'Expand all', collapse: 'Collapse all', contents: 'Chapters',
      count: n => `${n} entries`, empty: 'No matching entries. Try a parameter name or a shorter search.',
      purpose: 'Purpose and effects', values: 'Values / starting point', applies: 'Requirements', restart: 'Applying and restarting', recovery: 'Recovery',
      copy: key => `Copy parameter name ${key}`, source: 'Sources and version', sourceNote: 'Editorial summaries of release documentation and INI comments; installation steps are adapted to Aurora Swapper. Credit belongs to Aurora/OptiScaler and community contributors; upstream is GPL-3.0. Consult the matching release INI for the full advanced reference.',
      reviewed: date => `Reviewed: ${date}`, reference: version => `Guide reference: ${version}`, current: version => `Current package: ${version}`,
      match: 'The selected package version matches this guide. Verify the runtimes actually loaded in the game separately.',
      mismatch: 'The package version differs from this guide. Controls and defaults may change; check the current INI and overlay. Downloading a package does not update this guide.',
      unknown: 'The local package version cannot be reliably identified. Check the game overlay and INI rather than assuming an exact match.',
      missing: 'No package configured yet; you can still read this guide.', invalid: 'The selected package is invalid. Choose a valid extracted directory before installing.',
      unavailable: 'Package records cannot be read, so the version cannot be checked. The offline guide remains available.', linkFailed: 'Could not open the upstream link. Check your system browser.'
    }
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const copyKey = token => token.replace(/^\[[^\]]+\]\s*/, '');
  const paragraphs = value => {
    const lines = Array.isArray(value) ? value : [value];
    let html = '';
    let items = null;
    const flush = () => { if (items) { html += `<ul class="guide-list">${items.join('')}</ul>`; items = null; } };
    for (const line of lines) {
      const text = String(line ?? '');
      // A leading "- " marks a bullet; consecutive bullets become one list.
      if (/^\s*-\s+/.test(text)) {
        items = items || [];
        items.push(`<li>${esc(text.replace(/^\s*-\s+/, ''))}</li>`);
      } else {
        flush();
        html += `<p>${esc(text)}</p>`;
      }
    }
    flush();
    return html;
  };

  function renderContent({ language = 'zh', query = '', expandedSections = new Set(['intro', 'quick-start']), expandedEntries = new Set(), searchFolds = new Map() } = {}) {
    const lang = guide.languageKey(language);
    const labels = strings[lang];
    const sections = guide.searchGuide(query, lang);
    if (!sections.length) return `<p class="guide-empty">${esc(labels.empty)}</p>`;
    const searching = Boolean(String(query).trim());
    const isOpen = (id, expanded) => searching ? searchFolds.get(id) ?? true : expanded.has(id);
    return sections.map(section => `<details class="guide-section glass" id="guide-section-${esc(section.id)}" data-guide-section="${esc(section.id)}"${isOpen(section.id, expandedSections) ? ' open' : ''}>
      <summary><span><strong>${esc(section.title)}</strong><small>${esc(section.description)}</small></span><span class="guide-section-count">${section.entries.length}</span></summary>
      <div class="guide-section-body">${section.entries.map(entry => {
        const body = `<div class="guide-entry-body">${entry.values ? `<dl>${['purpose', 'values', 'applies', 'restart', 'recovery'].map(field => `<div><dt>${esc(labels[field])}</dt><dd>${paragraphs(field === 'purpose' ? entry.body : entry[field])}</dd></div>`).join('')}</dl>` : paragraphs(entry.body)}</div>`;
        const tokens = entry.values ? `<div class="guide-keys">${entry.tokens.map(token => /^\[[^\]]+\]\s+[A-Za-z][A-Za-z0-9_]*$/.test(token)
          ? `<button class="guide-key" type="button" data-copy-parameter="${esc(copyKey(token))}" title="${esc(labels.copy(copyKey(token)))}" aria-label="${esc(labels.copy(copyKey(token)))}"><code dir="ltr">${esc(token)}</code><span aria-hidden="true">⧉</span></button>`
          : `<span class="guide-key guide-overlay-label"><code dir="ltr">${esc(token)}</code></span>`).join('')}</div>` : '';
        return entry.values ? `<details class="guide-entry" id="guide-entry-${esc(entry.id)}" data-guide-entry="${esc(entry.id)}"${isOpen(entry.id, expandedEntries) ? ' open' : ''}><summary>${esc(entry.title)}</summary>${tokens}${body}</details>`
          : `<article class="guide-entry" id="guide-entry-${esc(entry.id)}"><h4>${esc(entry.title)}</h4>${body}</article>`;
      }).join('')}</div></details>`).join('');
  }

  function createGuideUi({ document, getLanguage, getPackage, copyText, openSource }) {
    let query = '';
    const expandedSections = new Set(['intro', 'quick-start']);
    const expandedEntries = new Set();
    const searchFolds = new Map();
    const $ = id => document.getElementById(id);
    const content = $('guideContent');

    function render() {
      const lang = guide.languageKey(getLanguage());
      const labels = strings[lang];
      for (const [id, key] of Object.entries({ guideTitle: 'title', guideSubtitle: 'subtitle', guideOffline: 'offline', guideSearchLabel: 'search', guideClear: 'clear', guideExpand: 'expand', guideCollapse: 'collapse', guideTocLabel: 'contents', guideSourceTitle: 'source', guideSourceNote: 'sourceNote' })) $(id).textContent = labels[key];
      $('guideSearch').placeholder = labels.placeholder;
      $('guideClear').disabled = !query;
      const version = guide.versionState(getPackage());
      $('guideVersionNotice').textContent = labels[version.state];
      $('guideVersionNotice').dataset.state = version.state;
      $('guideReference').textContent = labels.reference(guide.data.version);
      $('guideReviewed').textContent = labels.reviewed(guide.data.reviewedAt);
      $('guideCurrent').textContent = version.currentVersion ? labels.current(version.currentVersion) : '';
      const result = guide.searchGuide(query, lang);
      $('guideResultCount').textContent = labels.count(result.reduce((sum, section) => sum + section.entries.length, 0));
      $('guideToc').innerHTML = guide.data.sections.map(section => `<button type="button" data-guide-jump="${esc(section.id)}">${esc(section.title[lang])}</button>`).join('');
      content.innerHTML = renderContent({ language: lang, query, expandedSections, expandedEntries, searchFolds });
      $('guideSources').innerHTML = guide.data.sources.map(source => `<button class="ghost sm" type="button" data-guide-source="${esc(source.id)}">${esc(source.title[lang])} ↗</button>`).join('');
      $('guideSourceError').textContent = labels.linkFailed;
    }

    function changeQuery(value) {
      if (value !== query) searchFolds.clear();
      query = value;
    }
    $('guideSearch').addEventListener('input', event => { changeQuery(event.target.value); render(); });
    $('guideClear').addEventListener('click', () => { changeQuery(''); $('guideSearch').value = ''; render(); $('guideSearch').focus(); });
    function expandAll(open) {
      if (!query.trim()) for (const section of guide.data.sections) {
        if (open) expandedSections.add(section.id); else expandedSections.delete(section.id);
        for (const entry of section.entries) if (open) expandedEntries.add(entry.id); else expandedEntries.delete(entry.id);
      }
      for (const detail of content.querySelectorAll('details')) {
        if (query.trim()) searchFolds.set(detail.dataset.guideSection || detail.dataset.guideEntry, open);
        detail.open = open;
      }
    }
    $('guideExpand').addEventListener('click', () => expandAll(true));
    $('guideCollapse').addEventListener('click', () => expandAll(false));
    content.addEventListener('toggle', event => {
      const id = event.target.dataset.guideSection || event.target.dataset.guideEntry;
      if (!id) return;
      // Search-time choices are independent of normal browsing folds.
      if (query.trim()) { searchFolds.set(id, event.target.open); return; }
      const set = event.target.dataset.guideSection ? expandedSections : expandedEntries;
      if (event.target.open) set.add(id); else set.delete(id);
    }, true);
    content.addEventListener('click', event => {
      const button = event.target.closest('[data-copy-parameter]');
      if (button) copyText(button.dataset.copyParameter);
    });
    $('guideToc').addEventListener('click', event => {
      const button = event.target.closest('[data-guide-jump]');
      if (!button) return;
      const id = button.dataset.guideJump;
      changeQuery(''); $('guideSearch').value = '';
      expandedSections.add(id); render();
      const section = $(`guide-section-${id}`);
      section.scrollIntoView({ block: 'start' });
      section.querySelector('summary').focus();
    });
    $('guideSources').addEventListener('click', async event => {
      const button = event.target.closest('[data-guide-source]');
      if (!button) return;
      let ok = false;
      try { ok = Boolean(await openSource(button.dataset.guideSource)); } catch { /* Inline failure, guide remains readable. */ }
      $('guideSourceError').classList.toggle('hidden', ok);
    });
    render();
    return { render };
  }

  const api = { renderContent, createGuideUi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.auroraGuideUi = api;
})();

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
let ui;
try { ui = require('../../src/renderer/aurora-guide-ui'); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('a matching parameter is expanded for reading and exposes the bare INI key for copying', () => {
  assert.ok(ui, 'guide rendering must be available');
  const html = ui.renderContent({ language: 'zh', query: 'FG Input' });
  assert.match(html, /id="guide-entry-fg-input"[^>]*open/);
  assert.match(html, /data-copy-parameter="FGInput"/);
  assert.match(html, /输入/);
  assert.doesNotMatch(html, /id="guide-entry-sharpness"/);
});

test('overlay labels remain searchable but are not presented as copyable INI keys', () => {
  const html = ui.renderContent({ language: 'zh', query: 'Model Resolution' });
  assert.match(html, /Model Resolution/);
  assert.match(html, /data-copy-parameter="WorkingScale"/);
  assert.doesNotMatch(html, /data-copy-parameter="Model Resolution"/);
  const input = ui.renderContent({ language: 'en', query: 'FG Input' });
  assert.doesNotMatch(input, /data-copy-parameter="FG Input"/);
});

test('explicit search-time folds take priority over automatic expansion', () => {
  const html = ui.renderContent({ language: 'en', query: 'WorkingScale', searchFolds: new Map([['parameters', false], ['nr-scale', false]]) });
  assert.match(html, /id="guide-entry-nr-scale"/);
  assert.doesNotMatch(html, /data-guide-(?:section|entry)="[^"]+" open/);
});

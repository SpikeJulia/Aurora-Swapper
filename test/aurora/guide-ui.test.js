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

test('the introduction section is open by default and reads as a list of points', () => {
  assert.ok(ui, 'guide rendering must be available');
  const html = ui.renderContent({ language: 'zh' });
  assert.match(html, /id="guide-section-intro"[^>]*open/, 'the introduction opens first for a newcomer');
  assert.match(html, /这是什么/, 'the Chinese section title is shown');
  assert.match(html, /guide-list/, 'bulleted points render as a list');
  assert.match(html, /<li>/, 'the list holds items');

  const english = ui.renderContent({ language: 'en' });
  assert.match(english, /What this is/, 'the English section title is shown');
  assert.match(english, /id="guide-section-intro"[^>]*open/);
});

test('explicit search-time folds take priority over automatic expansion', () => {
  const html = ui.renderContent({ language: 'en', query: 'WorkingScale', searchFolds: new Map([['parameters', false], ['nr-scale', false]]) });
  assert.match(html, /id="guide-entry-nr-scale"/);
  assert.doesNotMatch(html, /data-guide-(?:section|entry)="[^"]+" open/);
});

test('the hardware section renders with its per-series lists', () => {
  assert.ok(ui, 'guide rendering must be available');
  const html = ui.renderContent({ language: 'zh' });
  assert.match(html, /id="guide-section-hardware"/, 'the hardware section is part of the guide');
  assert.match(html, /显卡与硬件要求/, 'the Chinese section title is shown');
  assert.match(html, /RTX 40/, 'the NVIDIA series list is rendered');
  assert.match(html, /RX 7000/, 'the AMD series list is rendered');
  assert.match(html, /guide-list/, 'the series lists render as lists');

  const english = ui.renderContent({ language: 'en' });
  assert.match(english, /GPU and hardware requirements/, 'the English section title is shown');
  assert.match(english, /RTX 40/, 'the English list names the series too');
});

test('the hardware section opens by default so a newcomer sees card support immediately', () => {
  const html = ui.renderContent({ language: 'zh' });
  assert.match(html, /id="guide-section-hardware"[^>]*open/, 'the hardware section is open on arrival');
  assert.match(html, /id="guide-section-intro"[^>]*open/, 'the introduction stays open');
});

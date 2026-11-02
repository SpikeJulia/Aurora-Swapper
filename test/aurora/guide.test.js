'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
let guide;
try { guide = require('../../src/renderer/aurora-guide'); } catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

test('guide search finds English parameter names while displaying Chinese explanations', () => {
  assert.ok(guide, 'the offline guide must be available');
  const results = guide.searchGuide('  fg INPUT  ', 'zh');
  const entry = results.flatMap(section => section.entries).find(entry => entry.id === 'fg-input');
  assert.ok(entry, 'FG Input must be searchable independent of case');
  assert.match(entry.title, /输入/);
  assert.match(entry.tokens.join(' '), /FGInput/);
  assert.equal(results.some(section => section.entries.some(entry => entry.id === 'sharpness')), false);
});

test('the guide opens with a plain-language introduction for first-time users', () => {
  assert.ok(guide, 'the offline guide must be available');
  const sections = guide.data.sections;
  assert.equal(sections[0].id, 'intro', 'the introduction must come first');

  const intro = sections[0];
  assert.ok(intro.title.zh && intro.title.en, 'the section needs both languages');
  assert.ok(intro.description.zh && intro.description.en, 'the section needs both languages');

  const ids = intro.entries.map(entry => entry.id);
  for (const expected of ['what-is-it', 'three-jobs', 'not-this', 'before-you-start', 'jargon']) {
    assert.ok(ids.includes(expected), `the introduction must explain ${expected}`);
  }

  for (const entry of intro.entries) {
    assert.ok(entry.title.zh && entry.title.en, `${entry.id} needs both languages`);
    assert.ok(Array.isArray(entry.body.zh) && entry.body.zh.length, `${entry.id} needs Chinese text`);
    assert.ok(Array.isArray(entry.body.en) && entry.body.en.length, `${entry.id} needs English text`);
    assert.equal(entry.body.zh.length, entry.body.en.length, `${entry.id} must keep both languages in step`);
    for (const line of entry.body.zh) assert.match(line, /[\u4e00-\u9fff]/, `${entry.id} must not fall back to English`);
  }
});

test('the introduction explains the product in beginner terms and stays searchable', () => {
  const intro = guide.data.sections[0];
  const zh = intro.entries.map(entry => entry.body.zh.join('\n')).join('\n');

  // Plain-language answers a newcomer needs, not parameter names.
  assert.match(zh, /超分/, 'explains upscaling');
  assert.match(zh, /帧生成/, 'explains frame generation');
  assert.match(zh, /安装/, 'explains installing');
  assert.match(zh, /还原/, 'explains restoring');
  assert.match(zh, /不绕过反作弊/, 'states the anti-cheat boundary');
  assert.match(zh, /不是修改器/, 'states that it is not a trainer');

  const results = guide.searchGuide('代理 DLL', 'zh');
  const entry = results.flatMap(section => section.entries).find(item => item.id === 'jargon');
  assert.ok(entry, 'a beginner term must find the glossary');
  assert.match(entry.body.join('\n'), /代理 DLL|Proxy/, 'the glossary explains the proxy DLL');

  const english = guide.searchGuide('upscaling', 'en');
  assert.ok(
    english.flatMap(section => section.entries).some(item => item.id === 'what-is-it'),
    'the introduction must be searchable in English too'
  );
});

test('the introduction keeps the same shape in both languages', () => {
  const intro = guide.data.sections[0];
  for (const entry of intro.entries) {
    const shape = body => body.map(line => (line.startsWith('- ') ? 'bullet' : 'paragraph'));
    assert.deepEqual(
      shape(entry.body.zh), shape(entry.body.en),
      `${entry.id} must list the same points in both languages`
    );
  }
});

test('guide version matching distinguishes valid packages from local unknown and corrupt state', () => {
  assert.equal(typeof guide.versionState, 'function');
  for (const [input, expected] of [
    [{ package: { ok: true }, packageRoot: '/package', packageSource: 'mirror', packageVersion: 'aurora-v1.1.2' }, 'match'],
    [{ package: { ok: true }, packageRoot: '/package', packageSource: 'official', packageVersion: 'v1.1.2' }, 'match'],
    [{ package: { ok: true }, packageRoot: '/package', packageSource: 'mirror', packageVersion: 'aurora-v1.1.3' }, 'mismatch'],
    [{ package: { ok: true }, packageRoot: '/package', packageSource: 'local', packageVersion: 'aurora-v1.1.2' }, 'unknown'],
    [{ package: { ok: true }, packageRoot: '/package' }, 'unknown'],
    [{ package: { ok: false }, packageRoot: '/package', packageVersion: 'aurora-v1.1.2' }, 'invalid'],
    [{ packageRoot: null }, 'missing'],
    [{ storeError: { message: 'corrupt' } }, 'unavailable'],
    [null, 'missing']
  ]) assert.equal(guide.versionState(input).state, expected, JSON.stringify(input));
});

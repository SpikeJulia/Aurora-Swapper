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

test('the guide explains GPU support per series instead of a vague "works on modern cards"', () => {
  assert.ok(guide, 'the offline guide must be available');
  const sections = guide.data.sections;
  assert.equal(sections[1].id, 'hardware', 'the hardware section must follow the introduction');

  const hardware = sections[1];
  const ids = hardware.entries.map(entry => entry.id);
  for (const expected of ['gpu-nvidia', 'gpu-amd', 'gpu-intel', 'gpu-gates']) {
    assert.ok(ids.includes(expected), `the hardware section must explain ${expected}`);
  }

  const zh = hardware.entries.map(entry => entry.body.zh.join('\n')).join('\n');
  assert.match(zh, /RTX 40/, 'names the RTX 40 series');
  assert.match(zh, /RTX 30/, 'names the RTX 30 series');
  assert.match(zh, /RTX 20/, 'names the RTX 20 series');
  assert.match(zh, /RX 7000/, 'names the RX 7000 series');
  assert.match(zh, /RX 6000/, 'names the RX 6000 series');
  assert.match(zh, /Arc/, 'names Intel Arc');
  assert.match(zh, /超分输入/, 'states the game-side requirement');
  assert.match(zh, /DX12/, 'states the API requirement');

  // Where AMD's current table and the pinned upstream docs disagree, both readings are shown.
  assert.match(zh, /FSR4/, 'mentions FSR4 support');
  assert.match(zh, /RDNA3/, 'mentions the pinned upstream RDNA scope');
});

test('the hardware section is searchable by a card model', () => {
  const results = guide.searchGuide('RTX 40', 'zh');
  assert.ok(
    results.flatMap(section => section.entries).some(entry => entry.id === 'gpu-nvidia'),
    'a card model must find the GPU article'
  );
  const amd = guide.searchGuide('RX 7000', 'zh');
  assert.ok(
    amd.flatMap(section => section.entries).some(entry => entry.id === 'gpu-amd'),
    'an AMD model must find the GPU article'
  );
});

test('every section keeps the same shape in both languages', () => {
  for (const section of guide.data.sections) {
    for (const entry of section.entries) {
      const shape = body => body.map(line => (line.startsWith('- ') ? 'bullet' : 'paragraph'));
      assert.deepEqual(
        shape(entry.body.zh), shape(entry.body.en),
        `${section.id}/${entry.id} must list the same points in both languages`
      );
      assert.equal(entry.body.zh.length, entry.body.en.length, `${section.id}/${entry.id} must keep both languages in step`);
    }
  }
});

test('the operating steps name this app buttons and say what success looks like', () => {
  const quick = guide.data.sections.find(section => section.id === 'quick-start');
  const steps = quick.entries.find(entry => entry.id === 'first-install');
  assert.ok(steps, 'the quick start keeps its five steps');
  const zh = steps.body.zh.join('\n');
  assert.match(zh, /设置/, 'the steps point at the settings page');
  assert.match(zh, /添加游戏/, 'the steps point at adding the game');
  assert.match(zh, /历史/, 'the steps point at the history page');
  assert.match(zh, /确认点/, 'the steps say what a successful install looks like');
  assert.match(zh, /不要另外去跑 setup_windows\.bat/, 'the steps tell people not to run the interactive setup script');

  const buttons = quick.entries.find(entry => entry.id === 'app-buttons');
  assert.ok(buttons, 'the guide explains what each button does');
  const buttonText = buttons.body.zh.join('\n');
  assert.match(buttonText, /修复运行库/, 'the repair action is explained');
  assert.match(buttonText, /还原/, 'the restore action is explained');
  assert.match(buttonText, /下载发布包/, 'the package download is explained');
});

test('the guide tells the user how to find the real game folder and how to test one change at a time', () => {
  const basics = guide.data.sections.find(section => section.id === 'basics');
  const folder = basics.entries.find(entry => entry.id === 'game-folder');
  assert.ok(folder, 'the guide explains how to find the game folder');
  assert.match(folder.body.zh.join('\n'), /任务管理器/, 'the folder search uses Task Manager');

  const tuning = guide.data.sections.find(section => section.id === 'tuning');
  const loop = tuning.entries.find(entry => entry.id === 'tuning-loop');
  assert.ok(loop, 'the guide explains a repeatable test loop');
  const loopText = loop.body.zh.join('\n');
  assert.match(loopText, /基线/, 'the loop starts from a baseline');
  assert.match(loopText, /只改一项/, 'the loop changes one setting at a time');
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

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

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { resolveRelative } = require('../../src/aurora/paths');

test('persisted relative paths cannot escape their root', () => {
  assert.throws(() => resolveRelative('/games/example', '../outside.dll'), /unsafe-path/);
  assert.throws(() => resolveRelative('/games/example', 'nested/../../outside.dll'), /unsafe-path/);
});

test('Windows trailing-dot and trailing-space aliases are refused', () => {
  assert.throws(() => resolveRelative('C:\\Games\\Example', '.. /outside.dll', { path: path.win32 }), /unsafe-path/);
  assert.throws(() => resolveRelative('C:\\Games\\Example', 'nested./outside.dll', { path: path.win32 }), /unsafe-path/);
});

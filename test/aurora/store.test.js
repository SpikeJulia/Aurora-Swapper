'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readStore, writeStore } = require('../../src/aurora/store');

test('round-trips the package path and one game record', () => {
  const file = path.join(os.tmpdir(), `aurora-store-${Date.now()}.json`);
  const data = { packageRoot: '/pkg', records: { '/game': { proxy: 'dxgi.dll', files: [], status: 'installed' } } };
  writeStore(file, data);
  assert.deepEqual(readStore(file), data);
  fs.rmSync(file, { force: true });
  assert.deepEqual(readStore(file), { packageRoot: null, records: {} });
});

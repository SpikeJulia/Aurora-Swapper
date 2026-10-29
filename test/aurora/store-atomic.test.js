'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readStore, writeStore } = require('../../src/aurora/store');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-store-atomic-'));
  return { dir, file: path.join(dir, 'aurora-store.json') };
}

test('missing and legacy stores receive an empty transactions table', () => {
  const fx = fixture();
  assert.deepEqual(readStore(fx.file), { packageRoot: null, records: {}, transactions: {} });
  fs.writeFileSync(fx.file, JSON.stringify({ packageRoot: '/pkg', records: { '/game': {} } }));
  assert.deepEqual(readStore(fx.file), {
    packageRoot: '/pkg', records: { '/game': {} }, transactions: {}
  });
});

test('a failed replacement leaves the previous store intact and removes only its temp file', () => {
  const fx = fixture();
  const original = { packageRoot: '/old', records: { '/game': { status: 'installed' } }, transactions: {} };
  const replacement = { ...original, packageRoot: '/new' };
  writeStore(fx.file, original);
  const bytes = fs.readFileSync(fx.file);
  const failingFs = Object.create(fs);
  failingFs.renameSync = () => { throw new Error('rename failed'); };

  assert.throws(() => writeStore(fx.file, replacement, failingFs), /rename failed/);

  assert.deepEqual(fs.readFileSync(fx.file), bytes);
  assert.deepEqual(fs.readdirSync(fx.dir), ['aurora-store.json']);
});

test('corrupt JSON is reported without replacing or deleting the original file', () => {
  const fx = fixture();
  const corrupt = Buffer.from('{"records":');
  fs.writeFileSync(fx.file, corrupt);

  assert.throws(() => readStore(fx.file), SyntaxError);

  assert.deepEqual(fs.readFileSync(fx.file), corrupt);
});

test('a malformed records or transactions field is not normalized into an empty store', () => {
  const fx = fixture();
  const corrupt = Buffer.from(JSON.stringify({ packageRoot: null, records: [], transactions: 'lost' }));
  fs.writeFileSync(fx.file, corrupt);

  assert.throws(() => readStore(fx.file), /invalid-store/);

  assert.deepEqual(fs.readFileSync(fx.file), corrupt);
});

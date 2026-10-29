'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function emptyStore() {
  return { packageRoot: null, records: {}, transactions: {} };
}

function readStore(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid-store');
    for (const key of ['records', 'gameDirs', 'transactions']) {
      if (key in data && (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key]))) {
        throw new Error(`invalid-store: ${key} must be an object`);
      }
    }
    if ('packageRoot' in data && data.packageRoot !== null && typeof data.packageRoot !== 'string') {
      throw new Error('invalid-store: packageRoot must be a string or null');
    }
    if (!('records' in data)) data.records = {};
    if (!data.transactions || typeof data.transactions !== 'object' || Array.isArray(data.transactions)) {
      data.transactions = {};
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

function writeStore(file, data, fsApi = fs) {
  fsApi.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  const contents = JSON.stringify(data, null, 2);
  let fd;
  try {
    fd = fsApi.openSync(temporary, 'wx', 0o600);
    fsApi.writeFileSync(fd, contents, 'utf8');
    fsApi.fsyncSync(fd);
    fsApi.closeSync(fd);
    fd = undefined;
    fsApi.renameSync(temporary, file);
  } catch (error) {
    if (fd !== undefined) {
      try { fsApi.closeSync(fd); } catch { /* Preserve the original write error. */ }
    }
    try { fsApi.rmSync(temporary, { force: true }); } catch { /* The previous store remains untouched. */ }
    throw error;
  }
}

module.exports = { readStore, writeStore };

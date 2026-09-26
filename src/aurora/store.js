'use strict';
const fs = require('fs');
const path = require('path');

function emptyStore() {
  return { packageRoot: null, records: {} };
}

function readStore(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

function writeStore(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

module.exports = { readStore, writeStore };

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const testDir = path.join(repoRoot, 'test', 'aurora');
const testFiles = fs.readdirSync(testDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.test.js'))
  .map(entry => path.join(testDir, entry.name))
  .sort();

if (!testFiles.length) {
  console.error(`No Aurora test files found in ${testDir}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  '--test', '--test-concurrency=1', ...testFiles
], { cwd: repoRoot, stdio: 'inherit' });

if (result.error) {
  console.error(`Could not start Aurora tests: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);

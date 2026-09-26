'use strict';
const fs = require('fs');
const path = require('path');

function validatePackage(root) {
  if (typeof root !== 'string' || root === '') return { ok: false, reason: 'not-directory' };
  if (root.toLowerCase().endsWith('.7z')) return { ok: false, reason: 'archive' };
  let stat;
  try { stat = fs.statSync(root); } catch { return { ok: false, reason: 'not-directory' }; }
  if (!stat.isDirectory()) return { ok: false, reason: 'not-directory' };
  if (fs.existsSync(path.join(root, 'OptiScaler.sln'))) return { ok: false, reason: 'source-tree' };
  if (!fs.existsSync(path.join(root, 'OptiScaler.dll'))) return { ok: false, reason: 'missing-dll' };
  if (!fs.existsSync(path.join(root, 'runtime_sync.ps1'))) return { ok: false, reason: 'missing-script' };
  return { ok: true, root, dllName: 'OptiScaler.dll', scriptName: 'runtime_sync.ps1' };
}

module.exports = { validatePackage };

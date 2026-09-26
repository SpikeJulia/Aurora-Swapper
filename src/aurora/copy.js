'use strict';
const path = require('path');
const { PROXY_FILES } = require('./games');

function relPosix(value) { return value.split(path.sep).join('/'); }

function planCopy({ packageRoot, gameDir, backupDir, files, proxy, record, overwriteConfirmed }) {
  if (!PROXY_FILES.includes(proxy)) return { ok: false, error: 'bad-proxy' };
  const recorded = new Set((record?.files || []).map(file => file.rel.toLowerCase()));
  const targetRel = proxy;
  const targetAbs = path.join(gameDir, proxy);
  const targetIsRecorded = recorded.has(proxy.toLowerCase());
  if (require('fs').existsSync(targetAbs) && !targetIsRecorded && overwriteConfirmed !== true) {
    return { ok: false, error: 'proxy-exists' };
  }
  const operations = [];
  const nextFiles = [];
  for (const file of files) {
    const rel = relPosix(file);
    if (rel.toLowerCase() === 'optiscaler.sln') continue;
    const from = path.join(packageRoot, file);
    const destRel = rel.toLowerCase() === 'optiscaler.dll' ? targetRel : rel;
    const dest = path.join(gameDir, destRel);
    if (require('fs').existsSync(dest)) {
      operations.push({ op: 'backup', rel: destRel, from: dest, to: path.join(backupDir, destRel) });
      nextFiles.push({ rel: destRel, action: 'replaced' });
    } else {
      nextFiles.push({ rel: destRel, action: 'added' });
    }
    operations.push({ op: 'write', rel: destRel, from, to: dest });
  }
  if (record?.proxy && record.proxy.toLowerCase() !== proxy.toLowerCase()) {
    operations.push({ op: 'delete', rel: record.proxy, to: path.join(gameDir, record.proxy) });
  }
  return {
    ok: true,
    operations,
    nextRecord: { proxy, files: nextFiles }
  };
}

function applyCopy(plan, { fs, path: nodePath, failOn = null }) {
  const done = [];
  try {
    for (const op of plan.operations) {
      if (op.op === 'backup') {
        fs.mkdirSync(nodePath.dirname(op.to), { recursive: true });
        fs.copyFileSync(op.from, op.to);
      } else if (op.op === 'write') {
        if (failOn && op.rel === failOn) throw new Error('forced failure');
        fs.mkdirSync(nodePath.dirname(op.to), { recursive: true });
        fs.copyFileSync(op.from, op.to);
      } else if (op.op === 'delete') {
        if (fs.existsSync(op.to)) fs.rmSync(op.to);
      }
      done.push(op);
    }
    return { ok: true };
  } catch (error) {
    for (const op of done.reverse()) {
      if (op.op === 'write') {
        const backup = plan.operations.find(item => item.op === 'backup' && item.rel === op.rel);
        if (backup && fs.existsSync(backup.to)) fs.copyFileSync(backup.to, op.to);
        else fs.rmSync(op.to, { force: true });
      }
    }
    return { ok: false, error: 'copy-failed', message: error.message };
  }
}

module.exports = { planCopy, applyCopy };

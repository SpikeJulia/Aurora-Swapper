'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchKnownGame, PROXY_FILES } = require('../../src/aurora/games');

test('matches the four tested games from either folder or exe name', () => {
  assert.equal(matchKnownGame({ dirName: 'Neverness to Everness', exeName: 'game.exe' }).proxy, 'winmm.dll');
  assert.equal(matchKnownGame({ dirName: 'bin', exeName: '异环.exe' }).id, 'neverness');
  assert.match(matchKnownGame({ dirName: 'The Witcher 3', exeName: 'witcher3.exe' }).note, /OptiFG/);
  assert.equal(matchKnownGame({ dirName: 'Onimusha', exeName: 'a.exe' }).proxy, 'dxgi.dll');
  assert.equal(matchKnownGame({ dirName: 'Blood of Dawnwalker', exeName: 'a.exe' }).id, 'dawnwalker');
  assert.equal(matchKnownGame({ dirName: '黎明行者之血', exeName: 'a.exe' }).id, 'dawnwalker');
});

test('returns null for an unknown game and lists only the seven proxies', () => {
  assert.equal(matchKnownGame({ dirName: 'Hades', exeName: 'Hades.exe' }), null);
  assert.deepEqual(PROXY_FILES, [
    'dxgi.dll', 'winmm.dll', 'version.dll', 'dbghelp.dll', 'd3d12.dll', 'wininet.dll', 'winhttp.dll'
  ]);
});

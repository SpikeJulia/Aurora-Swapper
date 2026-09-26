'use strict';

const PROXY_FILES = [
  'dxgi.dll', 'winmm.dll', 'version.dll', 'dbghelp.dll', 'd3d12.dll', 'wininet.dll', 'winhttp.dll'
];

const KNOWN = [
  {
    id: 'neverness',
    names: ['neverness to everness', '异环'],
    proxy: 'winmm.dll',
    note: 'dxgi.dll 可能被报非法模块。Run inside the upscaler 不建议开。'
  },
  {
    id: 'onimusha',
    names: ['onimusha', '鬼武者'],
    proxy: 'dxgi.dll',
    note: 'Run inside the upscaler 会花屏，保持关。'
  },
  {
    id: 'witcher3',
    names: ['the witcher 3', 'witcher3', '巫师3', '巫师 3'],
    proxy: 'dxgi.dll',
    note: '游戏内超分选 DLSS，关掉原生帧生成。进游戏后按 Insert：FG Input = OptiFG (Upscaler)，FG Output = DLSSG，FG Nvngx Replacement = None (Real DLSSG)。保存后完全退出再开，进场景后再开 DLSSG，选 2X–6X。'
  },
  {
    id: 'dawnwalker',
    names: ['blood of dawnwalker', 'dawnwalker', '黎明行者之血'],
    proxy: 'dxgi.dll',
    note: 'DLSS 5 和 6X 可以同时开。'
  }
];

function matchKnownGame({ dirName = '', exeName = '' } = {}) {
  const hay = `${dirName}\n${exeName}`.toLowerCase();
  const found = KNOWN.find(game => game.names.some(name => hay.includes(name.toLowerCase())));
  if (!found) return null;
  return { id: found.id, proxy: found.proxy, note: found.note };
}

module.exports = { matchKnownGame, PROXY_FILES };

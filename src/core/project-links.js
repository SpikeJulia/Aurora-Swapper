'use strict';

// Only these destinations may be opened by the renderer, never arbitrary URLs.
const links = Object.freeze({
  github: 'https://github.com/spikejulia',
  releases: 'https://github.com/SpikeJulia/Aurora-Swapper/releases/latest',
  'original-swapper': 'https://github.com/rakanki911/DLSS5-Swapper',
  'aurora-source': 'https://github.com/abc354402600/OptiScaler-Aurora',
  'aurora-guide': 'https://github.com/abc354402600/OptiScaler-Aurora/blob/1d22875d05fac2d7ffb86ed912b943ce1a6e915a/docs/GUIDE.zh-CN.md',
  'aurora-guide-en': 'https://github.com/abc354402600/OptiScaler-Aurora/blob/1d22875d05fac2d7ffb86ed912b943ce1a6e915a/docs/GUIDE.en.md',
  'aurora-config': 'https://github.com/abc354402600/OptiScaler-Aurora/blob/1d22875d05fac2d7ffb86ed912b943ce1a6e915a/OptiScaler.ini',
  'aurora-compatibility': 'https://github.com/abc354402600/OptiScaler-Aurora/blob/1d22875d05fac2d7ffb86ed912b943ce1a6e915a/docs/COMPATIBILITY.zh-CN.md',
  'aurora-compatibility-en': 'https://github.com/abc354402600/OptiScaler-Aurora/blob/1d22875d05fac2d7ffb86ed912b943ce1a6e915a/docs/COMPATIBILITY.en.md'
});
function projectUrl(key) {
  return typeof key === 'string' && Object.hasOwn(links, key) ? links[key] : null;
}
module.exports = { links, projectUrl };

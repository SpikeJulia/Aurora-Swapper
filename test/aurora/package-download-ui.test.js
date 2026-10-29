'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/renderer/renderer.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'src/renderer/style.css'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'src/renderer/i18n.js'), 'utf8');

test('library and settings expose separate local and online Aurora package actions', () => {
  assert.match(html, /id="libraryChooseAuroraPackage"/);
  assert.match(html, /id="libraryDownloadAuroraPackage"/);
  assert.match(renderer, /id="chooseAuroraPackage"/);
  assert.match(renderer, /id="downloadAuroraPackage"/);
  assert.match(renderer, /window\.lab\.downloadAuroraPackage/);
});

test('download dialog exposes both sources, cancellation, and progress wiring', () => {
  assert.match(html, /id="auroraPackageDownloadOverlay"/);
  assert.match(html, /id="auroraPackageSourceMirror"/);
  assert.match(html, /id="auroraPackageSourceOfficial"/);
  assert.match(html, /id="auroraPackageDownloadCancel"/);
  assert.match(renderer, /window\.lab\.onAuroraPackageProgress/);
  assert.match(renderer, /window\.lab\.cancelAuroraPackageDownload/);
  assert.match(renderer, /preferredSource/);
});

test('the supplied donation asset appears only in the About support card', () => {
  const aboutStart = html.indexOf('id="view-about"');
  const aboutEnd = html.indexOf('</section>', aboutStart);
  const about = html.slice(aboutStart, aboutEnd);
  assert.match(about, /class="[^"]*aurora-donation[^"]*"/);
  assert.match(about, /assets\/donation\/aurora-donation\.png/);
  assert.equal(html.indexOf('assets/donation/aurora-donation.png'), aboutStart + about.indexOf('assets/donation/aurora-donation.png'));
  assert.match(style, /\.aurora-donation/);
  assert.match(style, /object-fit:\s*contain/);
});

test('the About page keeps the original project links and support layout', () => {
  const aboutStart = html.indexOf('id="view-about"');
  const aboutEnd = html.indexOf('</section>', aboutStart);
  const about = html.slice(aboutStart, aboutEnd);
  assert.match(about, /href="https:\/\/github\.com\/spikejulia" data-project="github"/);
  assert.match(about, /<button[^>]*id="aboutUnreleased"[^>]*disabled/);
  assert.doesNotMatch(about, /data-project="releases"/);
  assert.match(about, /href="https:\/\/github\.com\/rakanki911\/DLSS5-Swapper" data-project="original-swapper"/);
  assert.match(about, /href="https:\/\/github\.com\/abc354402600\/OptiScaler-Aurora" data-project="aurora-source"/);
  assert.match(about, /data-i18n="aboutSourceIntro"/);
  assert.match(about, /data-i18n="aboutSourceEnd"/);
  assert.match(about, /data-i18n="aboutPackageNotice"/);
  assert.match(about, /id="projectLinkError"/);
  assert.match(about, /class="about-rule"/);
  assert.match(about, /class="about-coffee"/);
  assert.doesNotMatch(about, /aria-label="Buy me a coffee"/);
  assert.match(about, /data-i18n="aboutTranslator"/);
  assert.doesNotMatch(about, /data-project="coffee"/);
});

test('the circular donation QR opens an accessible full-size preview and can be dismissed', () => {
  const aboutStart = html.indexOf('id="view-about"');
  const aboutEnd = html.indexOf('</section>', aboutStart);
  const about = html.slice(aboutStart, aboutEnd);
  assert.match(about, /<button[^>]*id="aboutQrOpen"[^>]*aria-haspopup="dialog"/);
  assert.match(about, /<dialog[^>]*id="aboutQrDialog"/);
  assert.match(about, /id="aboutQrClose"/);
  assert.match(about, /class="about-qr-expanded"/);
  assert.match(renderer, /aboutQrDialog[^\n]*showModal\(\)/);
  assert.match(renderer, /aboutQrClose[^\n]*\.close\(\)/);
});

test('About attribution and release-state copy is accurate in English and Chinese', () => {
  const vm = require('node:vm');
  const window = {};
  vm.runInNewContext(i18n, { window });
  for (const lang of ['en', 'zh']) {
    window.i18n.setLang(lang);
    assert.match(window.i18n.t('aboutTitle'), /Aurora Swapper/);
    assert.match(window.i18n.t('aboutBody'), /OptiScaler Aurora/);
    assert.match(window.i18n.t('aboutBy'), /spikejulia/);
    assert.match(window.i18n.t('aboutGithub'), /spikejulia/);
    assert.match(window.i18n.t('aboutUnreleased'), /未发布|not released/i);
    assert.match(window.i18n.t('aboutOriginalSwapper'), /DLSS 5 Swapper.*2\.2\.7.*Rakan Alkhaldi.*MIT/);
    assert.match(window.i18n.t('aboutAuroraSource'), /OptiScaler Aurora.*GPL-3\.0/);
    assert.match(window.i18n.t('aboutPackageNotice'), /不随.*分发|not bundled/i);
    assert.doesNotMatch(window.i18n.t('supportBody'), /DLSS 5 Swapper 免费|DLSS 5 Swapper is free/i);
  }
});

test('new package and support copy has Chinese strings with English fallback keys', () => {
  for (const key of [
    'auroraLocalPackage', 'auroraDownloadPackage', 'auroraDownloadTitle',
    'auroraSourceMirror', 'auroraSourceOfficial', 'auroraDownload',
    'auroraCancelDownload', 'supportTitle', 'supportBody', 'aboutSourceEnd'
  ]) assert.match(i18n, new RegExp(`${key}:`), `${key} should be registered`);
});

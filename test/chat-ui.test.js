test('sidebar keeps the five Aurora pages and does not require chat, community, or overlays', () => {
  const nav = [...html.matchAll(/<button class="nav-item[^"]*" data-view="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(nav, ['games', 'addons', 'history', 'settings', 'about']);
  for (const gone of ['chat', 'community', 'overlays']) {
    assert.equal(html.includes(`data-view="${gone}"`), false);
  }
});

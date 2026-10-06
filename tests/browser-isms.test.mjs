// The page is a game: zoom, find, print and friends, pinch and the white flash between the
// desktop window's splash and the island are switched off (Plans/minder-browser-meer-spel.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const { isBrowserKey, installPageKeys } = await import('../web/js/page-keys.js');

const key = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });

test('the browser\'s own keys are recognised, the game\'s are not', () => {
  for (const k of ['+', '-', '=', '0', 'f', 'p', 's', 'u']) assert.ok(isBrowserKey(key(k, { ctrlKey: true })), k);
  assert.ok(isBrowserKey(key('F3')));
  assert.ok(isBrowserKey(key('Alt')));
  for (const k of ['F5', 'F11', 'F12', 'w', 'Escape']) assert.equal(isBrowserKey(key(k)), false, k);
  assert.equal(isBrowserKey(key('f', { ctrlKey: true, altKey: true })), false, 'AltGr is a letter');
});

test('ctrl+wheel, a drag and a browser key are cancelled; a field keeps its keys', () => {
  const on = {};
  installPageKeys({ addEventListener: (t, f) => { (on[t] ||= []).push(f); } });
  const fire = (t, e) => { let p = false; for (const f of on[t]) f({ ...e, preventDefault: () => { p = true; } }); return p; };
  const body = { tagName: 'DIV' }, field = { tagName: 'INPUT' };
  assert.ok(fire('wheel', { ctrlKey: true, target: body }));
  assert.equal(fire('wheel', { ctrlKey: false, target: body }), false);
  assert.ok(fire('dragstart', { target: body }));
  assert.ok(fire('keydown', { ...key('+', { ctrlKey: true }), target: body }));
  assert.equal(fire('keydown', { ...key('f', { ctrlKey: true }), target: field }), false);
});

test('no pinch zoom, no tap flash, and the window paints night blue between documents', () => {
  const css = readFileSync(new URL('../web/css/ui.css', import.meta.url), 'utf8');
  assert.match(css, /touch-action: pan-x pan-y/);
  assert.match(css, /-webkit-tap-highlight-color: transparent/);
  assert.match(css, /overscroll-behavior: none/);
  assert.match(readFileSync(new URL('../web/index.html', import.meta.url), 'utf8'), /user-scalable=no/);
  assert.match(readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8'), /\.background_color\(/);
});

test('the chart keeps its painted ground when it opens at the same size, and the menu is a pause', () => {
  const map = readFileSync(new URL('../web/js/minimap.js', import.meta.url), 'utf8');
  assert.match(map, /if \(d === dpr && w === W && h === H\) return;/, 'every M repainted ~150 ms of ground');
  const main = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /k !== 'escape' && state\.sysmenu && state\.sysmenu\.isOpen\(\)\) return;/);
  assert.match(main, /getElementById\('nav-chips'\)\?\.addEventListener\('click'/);
});

test('a tooltip draws a trailing key as a key cap, and main.js installs ours', async () => {
  const { splitKey } = await import('../web/js/tooltip.js');
  assert.deepEqual(splitKey('Walk the island on foot (Enter)'), { text: 'Walk the island on foot', key: 'Enter' });
  assert.deepEqual(splitKey('Menu (Esc)'), { text: 'Menu', key: 'Esc' });
  assert.deepEqual(splitKey('Seen it'), { text: 'Seen it', key: null });
  const main = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /\ninstallTooltips\(\);/);
  assert.match(main, /await warmRooms\(/, 'the rooms are built behind the boot screen, not at the door');
  assert.match(readFileSync(new URL('../web/js/models.js', import.meta.url), 'utf8'), /lazy-set-worker\.js/);
});

test('Alt+Enter (and F11 in the window) is the fullscreen key; the window goes borderless through Rust', async () => {
  const { isFullscreenKey } = await import('../web/js/display.js');
  const k = (key, m = {}) => ({ key, altKey: false, ctrlKey: false, metaKey: false, repeat: false, ...m });
  assert.ok(isFullscreenKey(k('Enter', { altKey: true })));
  assert.equal(isFullscreenKey(k('Enter')), false, 'Enter alone is Walk');
  assert.equal(isFullscreenKey(k('Enter', { altKey: true, ctrlKey: true })), false, 'AltGr+Enter');
  assert.equal(isFullscreenKey(k('Enter', { altKey: true, repeat: true })), false);
  assert.equal(isFullscreenKey(k('F11')), false, 'a tab keeps F11 for the browser');
  assert.ok(isFullscreenKey(k('F11'), true));
  const rs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  assert.match(rs, /host_str\(\) == Some\("fullscreen"\)/);
  assert.match(rs, /set_fullscreen\(url\.path\(\) == "\/on"\)/);
});

test('no installable web app: no manifest, no service worker, no install button - and an old worker is taken down', () => {
  assert.equal(existsSync(new URL('../web/manifest.webmanifest', import.meta.url)), false);
  assert.equal(existsSync(new URL('../web/sw.js', import.meta.url)), false);
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /rel="manifest"|install-btn/);
  assert.doesNotMatch(readFileSync(new URL('../web/js/ui.js', import.meta.url), 'utf8'), /beforeinstallprompt/);
  const main = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /serviceWorker\.register/);
  assert.match(main, /getRegistrations\(\)\.then\(\(all\) => all\.forEach\(\(r\) => r\.unregister\(\)\)\)/);
});

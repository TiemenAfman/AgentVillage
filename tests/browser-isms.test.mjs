// The page is a game: zoom, find, print and friends, pinch and the white flash between the
// desktop window's splash and the island are switched off (Plans/minder-browser-meer-spel.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// Ctrl as a key, and the browser shortcuts that come with it (web/js/keybinds.js, walk.js's
// onKeyDown, web/js/page-keys.js). Two promises. Ctrl can be bound like any other key and then
// works on foot together with the walking keys (crouch held while W is pressed - the way to
// swim down, and the reason it was Ctrl to begin with); and whether it is bound or not, none of
// the browser's ctrl+letter shortcuts is left to the page underneath - ctrl+A included, which
// selected the whole island from the sky.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = {
  createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop,
  pointerLockElement: null, exitPointerLock: noop,
};
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
};
const handlers = { keydown: [], keyup: [] };
globalThis.addEventListener = (type, fn) => { if (handlers[type]) handlers[type].push(fn); };
globalThis.removeEventListener = noop;
const { createWalkMode } = await import('../web/js/walk.js');
const { bind, resetKeys, keyOf, canon, keyLabel, ctrlIsKey } = await import('../web/js/keybinds.js');
const { isSelectAll, typingInto, installPageKeys } = await import('../web/js/page-keys.js');

const FRAME = 1 / 60;
const world = { sea: { height: () => 1, bedAt: () => 1, regionAt: () => null, levelKey: () => null }, terrain: { half: 64, size: 128, worldHeight: () => 1 } };
function fresh() {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera, terrain: world.terrain, ground: world.sea,
    material: new THREE.MeshBasicMaterial(), dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
  });
  walk.enter({ at: [0, 0], facing: [0, 10], blockers: [], interactables: [], onExit: noop });
  return walk;
}
// A key as the browser hands it: `mods` are the modifier flags that are down at the time.
function key(k, down, mods = {}, target = {}) {
  let prevented = false;
  const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target, preventDefault: () => { prevented = true; }, ...mods };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
  return prevented;
}
const run = (walk, seconds) => { for (let i = 0; i < Math.round(seconds / FRAME); i++) walk.update(FRAME); };
const reset = () => { resetKeys(); store.clear(); };

// ---- the binding ------------------------------------------------------------------------

test('Ctrl is nobody\'s key until it is bound, and then it is called Ctrl', () => {
  reset();
  assert.equal(ctrlIsKey(), false);
  bind('crouch', 'control');
  assert.equal(ctrlIsKey(), true);
  assert.equal(keyOf('crouch'), 'control');
  assert.equal(keyLabel('control'), 'Ctrl');
  // walk.js keeps speaking the default keys: Ctrl arrives as C, and C itself is nothing now
  assert.equal(canon('control'), 'c');
  assert.equal(canon('c'), null);
  resetKeys();
  assert.equal(ctrlIsKey(), false);
  assert.equal(canon('control'), 'control');
});

test('one key, one action holds for Ctrl too: taking it from crouch hands crouch the key run let go of', () => {
  reset();
  bind('crouch', 'control');
  bind('run', 'control');
  assert.equal(keyOf('run'), 'control');
  assert.equal(keyOf('crouch'), 'shift', 'a swap: crouch gets what run was holding');
  assert.equal(ctrlIsKey(), true);
  resetKeys();
});

// ---- on foot ----------------------------------------------------------------------------

test('unbound, a key with ctrl on it is no game key, and the browser shortcut is cancelled', () => {
  reset();
  const walk = fresh();
  assert.equal(key('Control', true, { ctrlKey: true }), false, 'the bare Control press needs no cancelling');
  assert.equal(walk.state.crouching, false);
  const before = walk.state.pos.z;
  assert.equal(key('w', true, { ctrlKey: true }), true, 'ctrl+W must be cancelled where a page may');
  run(walk, 0.5);
  assert.equal(walk.state.pos.z, before, 'ctrl+W must not also be a step');
  key('w', false, { ctrlKey: true });
});

test('every letter and digit with ctrl is cancelled on foot, not the handful that happened to hurt', () => {
  reset();
  fresh();
  const missed = [];
  for (const k of 'abcdefghijklmnopqrstuvwxyz0123456789') if (!key(k, true, { ctrlKey: true })) missed.push(k);
  assert.deepEqual(missed, [], `ctrl+${missed.join(', ctrl+')} still reach the browser`);
  assert.equal(key('Tab', true, { ctrlKey: true }), true);
  assert.equal(key('a', true, { ctrlKey: true }), true, 'ctrl+A selected the whole page');
});

test('a field on a board keeps its shortcuts: ctrl+A in it selects its text', () => {
  reset();
  fresh();
  assert.equal(key('a', true, { ctrlKey: true }, { tagName: 'TEXTAREA' }), false);
  assert.equal(key('c', true, { ctrlKey: true }, { tagName: 'INPUT' }), false);
});

test('AltGr is not ctrl: it arrives as ctrl+alt and a letter of somebody\'s alphabet is not cancelled', () => {
  reset();
  fresh();
  assert.equal(key('e', true, { ctrlKey: true, altKey: true }), false);
});

test('bound, Ctrl crouches on the press, and lets go on the release', () => {
  reset();
  bind('crouch', 'control');
  const walk = fresh();
  key('Control', true, { ctrlKey: true });
  assert.equal(walk.state.crouching, true, 'the bound Ctrl did nothing');
  key('Control', false);
  assert.equal(walk.state.crouching, false);
  resetKeys();
});

test('bound, the walking keys still walk with Ctrl held - that is what swimming down is', () => {
  reset();
  bind('crouch', 'control');
  const walk = fresh();
  key('Control', true, { ctrlKey: true });
  const before = walk.state.pos.z;
  const cancelled = key('w', true, { ctrlKey: true });
  run(walk, 0.5);
  assert.equal(cancelled, true, 'the browser\'s ctrl+W is still cancelled');
  assert.notEqual(walk.state.pos.z, before, 'W with Ctrl held is a step when Ctrl is a game key');
  key('w', false, { ctrlKey: true });
  key('Control', false);
  resetKeys();
});

test('bound, Alt and Meta are still not game keys', () => {
  reset();
  bind('crouch', 'control');
  const walk = fresh();
  const before = walk.state.pos.z;
  key('w', true, { ctrlKey: true, altKey: true });
  key('w', true, { ctrlKey: true, metaKey: true });
  run(walk, 0.5);
  assert.equal(walk.state.pos.z, before);
  resetKeys();
});

// ---- the source ------------------------------------------------------------------------

test('fullscreen\'s keyboard lock asks for every letter, so ctrl+W is the last shortcut left outside it', () => {
  const src = readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8');
  const m = src.match(/const LOCKED_CODES = \[\.\.\.'([A-Z]+)'\]/);
  assert.ok(m, 'LOCKED_CODES not found');
  assert.equal(m[1], 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  assert.match(src, /'Tab', \.\.\.Array\.from\(\{ length: 9 \}/);
});

// ---- ctrl+A, in every mode -------------------------------------------------------------

test('page-keys: ctrl+A and cmd+A are select all, AltGr+A and a bare A are not', () => {
  assert.equal(isSelectAll({ key: 'a', ctrlKey: true, altKey: false }), true);
  assert.equal(isSelectAll({ key: 'A', ctrlKey: true, altKey: false }), true);
  assert.equal(isSelectAll({ key: 'a', metaKey: true }), true);
  assert.equal(isSelectAll({ key: 'a', ctrlKey: true, altKey: true }), false);
  assert.equal(isSelectAll({ key: 'a' }), false);
  assert.equal(isSelectAll({ key: 'b', ctrlKey: true }), false);
  assert.equal(isSelectAll({ ctrlKey: true }), false, 'a key event with no key at all');
});

test('page-keys: from the sky, with no walk mode at all, ctrl+A is cancelled - except in a field', () => {
  const seen = [];
  installPageKeys({ addEventListener: (t, fn) => seen.push([t, fn]) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], 'keydown');
  const press = (over) => { let p = false; seen[0][1]({ key: 'a', ctrlKey: true, altKey: false, target: {}, preventDefault: () => { p = true; }, ...over }); return p; };
  assert.equal(press({}), true);
  assert.equal(press({ target: { tagName: 'INPUT' } }), false);
  assert.equal(press({ target: { tagName: 'TEXTAREA' } }), false);
  assert.equal(press({ target: { isContentEditable: true, tagName: 'DIV' } }), false);
  assert.equal(press({ key: 's' }), false, 'only select all is a page-wide business; the rest is the walker\'s');
  assert.equal(typingInto(null), false);
});

test('main.js installs it', () => {
  const src = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ installPageKeys \} from '\.\/page-keys\.js';/);
  assert.match(src, /^installPageKeys\(\);$/m);
});

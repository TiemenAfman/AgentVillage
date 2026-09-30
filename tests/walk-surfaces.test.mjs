// A room's storeys (Plans/verdiepingen-binnen.md): a real walk mode on a flat floor with a stair and
// a gallery handed over as `surfaces`. What only the whole thing can answer - that a stair is walked
// up without a jump and followed down, that the floor under a gallery stays the floor, that a body
// falls off a gallery's open edge, and that a blocker with a height stops only the storey it is on.
// The stubs are tests/diving-walk.test.mjs's.
import test from 'node:test';
import assert from 'node:assert/strict';
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
const handlers = { keydown: [], keyup: [] };
globalThis.addEventListener = (type, fn) => { if (handlers[type]) handlers[type].push(fn); };
globalThis.removeEventListener = noop;
const key = (k, down) => {
  const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault: noop };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
};
const { createWalkMode } = await import('../web/js/walk.js');

const FLOOR = 0.06;                  // interior.js: a room's floor
const GALLERY = 0.86;
// A stair up the x axis from x 0 to 2, and a gallery on top of it from x 2 to 4.
const SURFACES = [
  { x0: 0, x1: 2, z0: -0.5, z1: 0.5, y0: FLOOR, y1: GALLERY, axis: 'x' },
  { x0: 2, x1: 4, z0: -1, z1: 1, y: GALLERY },
];
const flat = () => FLOOR;
const FRAME = 1 / 60;
const run = (walk, seconds) => { for (let i = 0; i < Math.round(seconds / FRAME); i++) walk.update(FRAME); };

function make(blockers = []) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera,
    terrain: { half: 16, size: 32, worldHeight: flat },
    ground: { height: flat, bedAt: flat, regionAt: () => null, levelKey: () => null },
    material: new THREE.MeshBasicMaterial(), dom,
  });
  walk.setSurfaces(SURFACES);
  walk.enter({ at: [-1, 0], facing: [10, 0], blockers, interactables: [], onExit: noop });
  // Forward is +z at camYaw 0 (tests/diving-walk.test.mjs); a quarter turn walks up the stair, +x.
  walk.state.camYaw = Math.PI / 2;
  return walk;
}

test('a stair is walked up to the gallery without a jump', () => {
  const walk = make();
  run(walk, 0.2);
  key('w', true);
  let top = 0;
  for (let i = 0; i < 60 * 4 && walk.state.pos.x < 3; i++) { walk.update(FRAME); top = Math.max(top, walk.state.pos.y); }
  key('w', false);
  run(walk, 0.5);
  assert.ok(walk.state.pos.x > 2.2, `did not get up the stair: x = ${walk.state.pos.x}`);
  assert.ok(Math.abs(walk.state.pos.y - GALLERY) < 1e-6, `stands at ${walk.state.pos.y}, not on the gallery`);
  assert.ok(top <= GALLERY + 0.3, `rose to ${top} on the way: that was a jump`);
});

test('under the gallery the floor is still the floor', () => {
  const walk = make();
  walk.state.pos.set(3, FLOOR, -2);
  walk.state.camYaw = 0;             // +z: straight under the gallery from its south side
  run(walk, 0.2);
  key('w', true);
  run(walk, 1.5);
  key('w', false);
  run(walk, 0.3);
  assert.ok(walk.state.pos.z > 0, `never got under: z = ${walk.state.pos.z}`);
  assert.ok(Math.abs(walk.state.pos.y - FLOOR) < 1e-6, `was lifted onto the gallery from below: y = ${walk.state.pos.y}`);
});

test('walking off the open edge of the gallery is a fall to the floor', () => {
  const walk = make();
  walk.state.pos.set(3.4, GALLERY, 0);
  run(walk, 0.2);
  key('w', true);
  run(walk, 1);
  key('w', false);
  run(walk, 1.5);
  assert.ok(walk.state.pos.x > 4.1, `x = ${walk.state.pos.x}`);
  assert.ok(Math.abs(walk.state.pos.y - FLOOR) < 1e-6, `hangs at ${walk.state.pos.y}`);
});

test('a blocker with a height stops only the storey it stands on', () => {
  const crate = { x: 3.3, z: 0, hx: 0.12, hz: 0.6, y0: GALLERY, y1: GALLERY + 0.3 };
  // On the gallery, walking at it: stopped in front of it.
  const up = make([crate]);
  up.state.pos.set(2.4, GALLERY, 0);
  run(up, 0.2);
  key('w', true);
  run(up, 1.5);
  key('w', false);
  assert.ok(up.state.pos.x < 3.3 - 0.12, `walked through the crate on the gallery: x = ${up.state.pos.x}`);
  // Below it, the same line walks straight on under the crate.
  const down = make([crate]);
  down.state.pos.set(2.4, FLOOR, 0.8);
  down.state.pos.z = 0;
  run(down, 0.2);
  key('w', true);
  run(down, 1.5);
  key('w', false);
  assert.ok(down.state.pos.x > 3.6, `the crate upstairs stopped a walker below: x = ${down.state.pos.x}`);
  assert.ok(Math.abs(down.state.pos.y - FLOOR) < 1e-6);
});

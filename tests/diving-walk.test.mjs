// A real walk mode, put in deep water: it dives, hangs, stands on the bed, climbs and floats
// again (web/js/walk.js + web/js/diving.js, Plans/onderwater-zwemmen.md). The pure step is
// tests/diving.test.mjs; this is what only the whole thing can answer - that the flags the sea
// and the camera read (`swimming`, `dive`, `diving`) say the right thing at each height, that a
// diver is never airborne, and that the camera goes under the surface with them and comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
// A 2D context that accepts anything: zzz.js and the avatar paint a canvas at construction.
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = {
  createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop,
  pointerLockElement: null, exitPointerLock: noop,
};
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
const { createWalkMode } = await import('../web/js/walk.js');

const FRAME = 1 / 60;
// A sea 2.5 deep everywhere, apart from a beach along x > 20 that climbs out of the water.
const bed = (x) => (x > 20 ? Math.min(0.6, -2.5 + (x - 20) * 0.5) : -2.5);
const worldOf = (h) => ({
  sea: { height: h, bedAt: h, regionAt: () => null, levelKey: () => null },
  terrain: { half: 64, size: 128, worldHeight: h },
});

function make(h = bed) {
  const { sea, terrain } = worldOf(h);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera, terrain, ground: sea,
    material: new THREE.MeshBasicMaterial(), dom,
  });
  walk.enter({ at: [0, 0], facing: [0, 10], blockers: [], interactables: [], onExit: noop });
  return { walk, camera };
}
const press = (key) => globalThis.dispatchKey(key, true);

// walk.js listens on the global window, so the test drives the keys through the handlers it
// registered rather than through a DOM.
const handlers = { keydown: [], keyup: [] };
globalThis.addEventListener = (type, fn) => { if (handlers[type]) handlers[type].push(fn); };
globalThis.dispatchKey = (key, down) => {
  const e = { key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault: noop };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
};
const run = (walk, seconds) => { for (let i = 0; i < Math.round(seconds / FRAME); i++) walk.update(FRAME); };

// Handlers are registered by createWalkMode, so the global has to be replaced before it.
function fresh(h) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  return make(h);
}

test('a swimmer at the surface is not diving, and floats where it always did', () => {
  const { walk } = fresh();
  run(walk, 0.5);
  const s = walk.state;
  assert.equal(s.swimming, true);
  assert.equal(s.dive, false);
  assert.equal(s.diving, false);
  assert.ok(Math.abs(s.pos.y - -0.07) < 1e-9, `floats at ${s.pos.y}`);
});

test('holding C in deep water takes the body under, and it is still a swimmer, never airborne', () => {
  const { walk } = fresh();
  run(walk, 0.3);
  press('c');
  run(walk, 1.5);
  const s = walk.state;
  assert.equal(s.dive, true, 'C did not start a dive');
  assert.equal(s.diving, true, 'the head is not under');
  assert.ok(s.pos.y < -0.8, `only at ${s.pos.y}`);
  assert.equal(s.swimming, true, 'the sea\'s SWIMMING bit would go false under water');
  assert.equal(s.grounded, true, 'a diver is not AIRBORNE');
  assert.equal(walk.diving(), true);
  assert.equal(walk.inWater(), true);
});

test('it settles on the bed, and Space brings it back to the surface at the swimmer\'s height', () => {
  const { walk } = fresh();
  run(walk, 0.3);
  press('c');
  run(walk, 4);
  const s = walk.state;
  assert.equal(s.onBed, true);
  assert.ok(Math.abs(s.pos.y - (bed(0) + 0.05)) < 1e-6, `rests at ${s.pos.y}`);
  globalThis.dispatchKey('c', false);
  press(' ');
  run(walk, 4);
  assert.equal(s.dive, false, 'still diving after climbing 2.5');
  assert.equal(s.diving, false);
  assert.ok(Math.abs(s.pos.y - -0.07) < 1e-9, `surfaced at ${s.pos.y}`);
  globalThis.dispatchKey(' ', false);
});

test('the camera goes under the surface with a diver and comes back up with them', () => {
  const { walk, camera } = fresh();
  run(walk, 0.5);
  const above = camera.position.y;
  assert.ok(above >= 0.5, `the surface swimmer's camera hangs at ${above}`);
  press('c');
  run(walk, 2.5);
  assert.ok(camera.position.y < 0, `the diver's camera is at ${camera.position.y}, above the water`);
  globalThis.dispatchKey('c', false);
  press(' ');
  run(walk, 4);
  globalThis.dispatchKey(' ', false);
  run(walk, 1);
  assert.ok(camera.position.y >= 0.5 - 1e-9, `the camera stayed under after surfacing: ${camera.position.y}`);
});

test('the camera never jumps: a step of one frame is small while the head goes under', () => {
  const { walk, camera } = fresh();
  run(walk, 0.5);
  press('c');
  let worst = 0, prev = camera.position.y;
  for (let i = 0; i < 180; i++) {
    walk.update(FRAME);
    worst = Math.max(worst, Math.abs(camera.position.y - prev));
    prev = camera.position.y;
  }
  assert.ok(worst < 0.15, `the camera moved ${worst} in one frame`);
});

test('swimming in to the beach with C held wades out, it does not bury the diver', () => {
  const { walk } = fresh();
  walk.state.pos.set(15, -0.07, 0);
  run(walk, 0.3);
  press('c');
  // Forward is +z at camYaw 0; face the beach (+x) by turning the camera.
  walk.state.camYaw = Math.PI / 2;
  globalThis.dispatchKey('w', true);
  run(walk, 8);
  const s = walk.state;
  assert.ok(s.pos.x > 20, `never reached the beach: x = ${s.pos.x}`);
  assert.equal(s.dive, false, 'still in dive mode on a beach');
  // A swimmer floats at -0.07 over a bed that is shallower than that, as they always did.
  assert.ok(s.pos.y > bed(s.pos.x) - 0.1, `the diver is in the sand: y ${s.pos.y}, bed ${bed(s.pos.x)}`);
});

test('leaving walk mode drops a dive', () => {
  const { walk } = fresh();
  run(walk, 0.3);
  press('c');
  run(walk, 1);
  assert.equal(walk.state.dive, true);
  walk.exit();
  assert.equal(walk.state.dive, false);
  assert.equal(walk.state.diving, false);
});

test('a diver at the foot of a shallow shelf keeps a camera under the water, and in sight', () => {
  // Shallow (-0.4) up to x = 10, then a step down to -1.6. The diver is a couple of units past
  // the edge, looking away from the shelf, so the camera trails behind them over the shallows -
  // where a ground floor (bed + a hand and a half) lies over the surface. It used to put the
  // camera up in the air, looking down on an opaque sea with the diver hidden behind it.
  const shelf = (x) => (x < 10 ? -0.4 : -1.6);
  const { walk, camera } = fresh(shelf);
  walk.state.pos.set(11.5, walk.state.pos.y, 0);
  walk.state.camYaw = Math.PI / 2;      // looking along +x, the camera trails at x - 2.7
  run(walk, 0.3);
  press('c');
  run(walk, 2.5);
  globalThis.dispatchKey('c', false);
  run(walk, 1.5);
  const s = walk.state;
  assert.equal(s.diving, true);
  assert.ok(camera.position.x < 10, `the camera should trail over the shelf: x = ${camera.position.x}`);
  assert.ok(camera.position.y < 0, `the camera is over the water, at ${camera.position.y}, and the diver behind the surface`);
  assert.ok(camera.position.y >= shelf(camera.position.x) - 1e-9, 'the camera is in the sand');
});

// ---- steering by the mouse ------------------------------------------------------------------

test('looking down and swimming on takes the body under, with neither C nor Space', () => {
  const { walk } = fresh();
  run(walk, 0.3);
  walk.state.camPitch = 0.9;
  press('w');
  run(walk, 2);
  const s = walk.state;
  assert.equal(s.dive, true, 'the view did not start a dive');
  assert.ok(s.pos.y < -0.8, `only at ${s.pos.y}`);
  assert.equal(s.crouching, false);
  globalThis.dispatchKey('w', false);
});

test('looking up while diving and swimming on climbs back to the surface', () => {
  const { walk } = fresh();
  run(walk, 0.3);
  press('c');
  run(walk, 3);
  globalThis.dispatchKey('c', false);
  const s = walk.state;
  assert.equal(s.onBed, true);
  walk.state.camPitch = -0.2;
  press('w');
  run(walk, 4);
  assert.equal(s.dive, false, 'still diving after looking up for four seconds');
  assert.ok(Math.abs(s.pos.y - -0.07) < 1e-9, `surfaced at ${s.pos.y}`);
  globalThis.dispatchKey('w', false);
});

test('the normal view along the top does not dive, and a body hanging still is not steered', () => {
  const { walk } = fresh();
  run(walk, 0.3);
  press('w');
  run(walk, 2);
  assert.equal(walk.state.dive, false, 'a plain stroke along the surface dived by itself');
  globalThis.dispatchKey('w', false);
  // Looking straight down with no key pressed: nothing to steer with.
  walk.state.camPitch = 0.95;
  run(walk, 2);
  assert.equal(walk.state.dive, false, 'the view alone must not dive a body that is not swimming on');
});

test('a stroke backwards goes the other way, and a stroke sideways goes neither', () => {
  const a = fresh();
  a.walk.state.camPitch = 0.9;
  run(a.walk, 0.3);
  press('c'); run(a.walk, 1); globalThis.dispatchKey('c', false);   // under first
  const y0 = a.walk.state.pos.y;
  press('s'); run(a.walk, 1);
  assert.ok(a.walk.state.pos.y > y0, `backwards while looking down should climb: ${y0} -> ${a.walk.state.pos.y}`);
  globalThis.dispatchKey('s', false);
  const b = fresh();
  b.walk.state.camPitch = 0.9;
  run(b.walk, 0.3);
  press('c'); run(b.walk, 1); globalThis.dispatchKey('c', false);
  b.walk.state.vy = 0;
  const y1 = b.walk.state.pos.y;
  press('d'); run(b.walk, 1);
  assert.ok(Math.abs(b.walk.state.pos.y - y1) < 0.15, `sideways moved the depth: ${y1} -> ${b.walk.state.pos.y}`);
  globalThis.dispatchKey('d', false);
});

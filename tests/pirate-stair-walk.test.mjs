// The Salty Kraken's stair walked by the real walk mode (web/js/walk.js), frame by frame, with
// the building's own floors and solids (web/js/buildings.js pirateSurfaces / pirateSolids): up the
// lower flight, across the landing, up the upper flight to the door - and stopped by the rails,
// never dropped through the stair and never stuck beside it (the keeper, trying the first version:
// "karakter zit vast, loopt door railing heen", "valt naar beneden"). The harness is
// tests/diving-walk.test.mjs's.
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
const { buildBuilding } = await import('../web/js/buildings.js');

const FRAME = 1 / 60;
const built = buildBuilding({ id: 'c:piratetavern', kind: 'civic', civicType: 'piratetavern', style: 'unknown' }, {});
const S = Object.fromEntries(built.surfaces.map((s) => [s.name, s]));
const zmid = (s) => (s.z0 + s.z1) / 2;
const floorY = (name, x) => {
  const s = S[name];
  return s.y != null ? s.y : s.y0 + (s.y1 - s.y0) * (x - s.x0) / (s.x1 - s.x0);
};

// Flat dry ground round the building (a hand over 0, or walk mode reads it as the sea and places
// you on the nearest shore), the building standing where it was built (origin, unturned).
function fresh(at) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const flat = () => 0.1;
  const sea = { height: flat, bedAt: flat, regionAt: () => null, levelKey: () => null };
  const terrain = { half: 64, size: 128, worldHeight: flat };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({ scene: new THREE.Scene(), camera, terrain, ground: sea, material: new THREE.MeshBasicMaterial(), dom });
  walk.enter({ at, facing: [at[0] - 1, at[1]], blockers: built.solids, interactables: [], onExit: noop });
  walk.setSurfaces(built.surfaces);
  return walk;
}

// Walk towards `to` (x, z) until there, or `seconds` pass; the camera turned so forward is that
// way (forward is (sin camYaw, cos camYaw)). Returns the heights it stood at on the way.
function walkTo(walk, to, seconds = 12, until = null) {
  const s = walk.state;
  const heights = [];
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    const dx = to[0] - s.pos.x, dz = to[1] - s.pos.z;
    if (Math.hypot(dx, dz) < 0.08 || (until && until(s))) break;
    s.camYaw = Math.atan2(dx, dz);
    walk.update(FRAME);
    heights.push([s.pos.x, s.pos.z, s.pos.y]);
  }
  key('w', false);
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  return heights;
}

test('up the stair to the door: lower flight, landing, upper flight, stoop', () => {
  const [fx, , fz] = built.anchors.door;
  const walk = fresh([fx, fz]);
  const s = walk.state;
  // the lower flight, west to the landing
  walkTo(walk, [S.land.x0 + 0.3, zmid(S.down)]);
  assert.ok(s.pos.x < S.land.x1, `reached the landing (x ${s.pos.x.toFixed(2)}, landing from ${S.land.x1.toFixed(2)})`);
  assert.ok(Math.abs(s.pos.y - S.land.y) < 0.12, `on the landing's floor: ${s.pos.y.toFixed(2)} for ${S.land.y.toFixed(2)}`);
  // across the landing to the upper flight's side
  walkTo(walk, [S.land.x0 + 0.3, zmid(S.up)]);
  assert.ok(Math.abs(s.pos.z - zmid(S.up)) < 0.12, `crossed the landing (z ${s.pos.z.toFixed(2)})`);
  // up the upper flight to the stoop
  const path = walkTo(walk, [(S.stoop.x0 + S.stoop.x1) / 2, zmid(S.up)]);
  for (const [x, z, y] of path) {
    if (x > S.up.x0 + 0.2 && x < S.up.x1 - 0.2) assert.ok(y > floorY('up', x) - 0.15, `never dropped off the upper flight: ${y.toFixed(2)} at x ${x.toFixed(2)}`);
  }
  assert.ok(s.pos.x > S.stoop.x0, `reached the stoop (x ${s.pos.x.toFixed(2)})`);
  assert.ok(Math.abs(s.pos.y - S.stoop.y) < 0.12, `at the door's height: ${s.pos.y.toFixed(2)} for ${S.stoop.y.toFixed(2)}`);
});

test('the rail stops you on the flight; you do not walk through it or fall off', () => {
  const x = (S.down.x0 + S.down.x1) / 2;
  const walk = fresh([built.anchors.door[0], built.anchors.door[2]]);
  const s = walk.state;
  walkTo(walk, [x, zmid(S.down)]);
  const y = s.pos.y;
  assert.ok(Math.abs(y - floorY('down', s.pos.x)) < 0.12, `on the lower flight: ${y.toFixed(2)}`);
  walkTo(walk, [x, S.down.z1 + 1.5], 3);        // straight at the rail, towards the water
  assert.ok(s.pos.z < S.down.z1 + 0.05, `held by the rail (z ${s.pos.z.toFixed(2)}, edge ${S.down.z1.toFixed(2)})`);
  assert.ok(Math.abs(s.pos.y - floorY('down', s.pos.x)) < 0.15, `still on the flight: ${s.pos.y.toFixed(2)}`);
  // and from the upper flight, towards the lower one below it: held too
  const w2 = fresh([built.anchors.door[0], built.anchors.door[2]]);
  walkTo(w2, [S.land.x0 + 0.3, zmid(S.down)]);
  walkTo(w2, [S.land.x0 + 0.3, zmid(S.up)]);
  const ux = (S.up.x0 + S.up.x1) / 2;
  walkTo(w2, [ux, zmid(S.up)]);
  walkTo(w2, [ux, S.up.z1 + 1.0], 3);
  assert.ok(w2.state.pos.z < S.up.z1 + 0.05, `held by the upper rail (z ${w2.state.pos.z.toFixed(2)})`);
  assert.ok(w2.state.pos.y > floorY('up', w2.state.pos.x) - 0.15, `not fallen: ${w2.state.pos.y.toFixed(2)}`);
});

test('on the beach beside the stair you are never stuck', () => {
  // Just outside the lower flight's rail, at its high end: the place the first version trapped you.
  const x = S.land.x1 + 0.4;
  const walk = fresh([x, S.down.z1 + 0.3]);
  const s = walk.state;
  const start = [s.pos.x, s.pos.z];
  walkTo(walk, [x, S.down.z1 + 1.2], 2);        // away from the stair, towards the water
  assert.ok(s.pos.z > start[1] + 0.3, `walked away (z ${start[1].toFixed(2)} -> ${s.pos.z.toFixed(2)})`);
  walkTo(walk, [x + 1.2, s.pos.z], 2);          // and along it
  assert.ok(s.pos.x > x + 0.3, `walked along (x ${s.pos.x.toFixed(2)})`);
});

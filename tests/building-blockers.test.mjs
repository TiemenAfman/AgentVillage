// A building's solids where it stands, and never stuck in one (Plans/muren-met-hitboxes.md, deel B).
//
// What is held here:
//   turned, not boxed   solids.js solidAt turns a building's own rectangles with it (`yaw`), so a house
//                       on one of the residential plots' free angles is walked up to its porch at the
//                       door - the box round it stood past the step - and its corners are open ground
//   the height          a solid's y0/y1 come along, lifted with the building, so a low one is jumped
//   two that stay boxes a circle, and a ship's side (boat.js hullOver knows only the world's axes)
//   never stuck         a body standing in a solid (a building put up round it) walks out of it, the
//                       shortest way or any other that gets shallower, and is stopped walking in again
// The walk-mode harness is tests/walk-solids.test.mjs's.
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
const { insideSolid, depthInSolid, solidAt, porchFloor } = await import('../web/js/solids.js');
const { buildBuilding, WALK_BODY_R } = await import('../web/js/buildings.js');

const FRAME = 1 / 60;
const GROUND = 0.1;

function fresh(at, blockers, facing = [at[0], at[1] + 1]) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const flat = () => GROUND;
  const sea = { height: flat, bedAt: flat, regionAt: () => null, levelKey: () => null };
  const terrain = { half: 64, size: 128, worldHeight: flat };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({ scene: new THREE.Scene(), camera, terrain, ground: sea, material: new THREE.MeshBasicMaterial(), dom });
  walk.enter({ at, facing, blockers, interactables: [], onExit: noop });
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  return walk;
}

function walkTo(walk, to, seconds = 4) {
  const s = walk.state;
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    const dx = to[0] - s.pos.x, dz = to[1] - s.pos.z;
    if (Math.hypot(dx, dz) < 0.05) break;
    s.camYaw = Math.atan2(dx, dz);
    walk.update(FRAME);
  }
  key('w', false);
  for (let i = 0; i < 30; i++) walk.update(FRAME);
}

const house = buildBuilding({ id: 'house:turned-test', kind: 'house', tier: 'house', style: 'claude', sheds: [] }, {});
// A residential plot's free angle at its widest (house-placement.js: 0.15 to 0.43 off the quarter).
const YAW = Math.PI + 0.4;
const at = { x: 0, z: 0, y: GROUND, yaw: YAW };
const walls = house.solids.map((r) => solidAt(r, at));

test('a turned building is its own rectangles, not the box round them', () => {
  for (const w of walls) {
    assert.equal(w.yaw, YAW, 'a wall lost its turn');
    assert.ok(w.y0 < GROUND - 0.5 && w.y1 > GROUND, `a wall stands ${w.y0.toFixed(2)}..${w.y1.toFixed(2)}`);
  }
  // The corner of the box round the biggest wall, which the old box was solid over: open ground now.
  const big = walls.reduce((a, b) => (a.hx * a.hz > b.hx * b.hz ? a : b));
  const c = Math.abs(Math.cos(YAW)), s = Math.abs(Math.sin(YAW));
  const ex = big.hx * c + big.hz * s, ez = big.hx * s + big.hz * c;
  const corner = [big.x + ex - 0.03, big.z + ez - 0.03];
  assert.ok(!walls.some((w) => insideSolid(w, corner[0], corner[1], 0)), 'the box\'s corner is still a wall');
});

test('the porch at the door of a turned house is reached', () => {
  const [floor, low] = porchFloor(house.porch, at);
  // Out in front of the door (+z in the house's own frame), and back towards it.
  const c = Math.cos(YAW), s = Math.sin(YAW);
  const ahead = (d) => [d * s, d * c];
  const walk = fresh(ahead(2.2), [...walls, floor, low]);
  walkTo(walk, ahead(house.porch.z1 - 0.05), 5);
  assert.ok(Math.abs(walk.state.pos.y - floor.y1) < 1e-6,
    `at the door the feet are at ${walk.state.pos.y.toFixed(3)}, the porch's top at ${floor.y1.toFixed(3)}`);
});

test('a circle and a ship\'s side stay boxes along the world\'s axes', () => {
  const round = solidAt({ x: 1, z: 0, hx: 0.5, hz: 0.5, r: 0.5 }, at);
  assert.equal(round.r, 0.5);
  assert.equal(round.yaw, undefined);
  const side = solidAt({ x: 0, z: 0, hx: 2, hz: 0.5, hull: 0.4 }, { x: 0, z: 0, yaw: 0.6 });
  assert.equal(side.yaw, undefined, 'boat.js hullOver cannot read a turned hull');
  assert.equal(side.hull, 0.4);
  const c = Math.cos(0.6), s = Math.sin(0.6);
  assert.ok(Math.abs(side.hx - (2 * c + 0.5 * s)) < 1e-9 && Math.abs(side.hz - (2 * s + 0.5 * c)) < 1e-9, 'the box round a turned side');
});

test('a body a building was put up round walks out of it, and not back in', () => {
  const box = { x: 0, z: 0, hx: 0.6, hz: 0.3, yaw: 0.3 };
  const walk = fresh([0, 0], []);
  walk.setBlockers([box]);
  const s = walk.state;
  const start = depthInSolid(box, s.pos.x, s.pos.z, WALK_BODY_R);
  assert.ok(start > 0, 'not standing in the box to begin with');
  // Out along the box's short side, which is the way it gets shallower at once.
  const out = [Math.sin(0.3) * 2, Math.cos(0.3) * 2];
  walkTo(walk, out, 4);
  assert.ok(depthInSolid(box, s.pos.x, s.pos.z, WALK_BODY_R) <= 0, `still ${depthInSolid(box, s.pos.x, s.pos.z, WALK_BODY_R).toFixed(3)} inside`);
  assert.ok(Math.hypot(s.pos.x - out[0], s.pos.z - out[1]) < 0.1, 'it did not get out to where it walked');
  // And back: stopped at the box's edge grown by a body, not let in by the way out.
  walkTo(walk, [0, 0], 4);
  assert.ok(depthInSolid(box, s.pos.x, s.pos.z, WALK_BODY_R) <= 1e-6, 'walked back into the box');
});

test('a body in a solid cannot walk deeper into it', () => {
  const box = { x: 0, z: 0, hx: 1, hz: 1 };
  const walk = fresh([0.8, 0], []);
  walk.setBlockers([box]);
  const s = walk.state;
  const start = depthInSolid(box, s.pos.x, s.pos.z, WALK_BODY_R);
  walkTo(walk, [0, 0], 2);
  assert.ok(depthInSolid(box, s.pos.x, s.pos.z, WALK_BODY_R) <= start + 1e-6, 'walked deeper in');
});

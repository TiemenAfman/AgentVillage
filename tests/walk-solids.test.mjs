// The shapes walk mode bumps into and stands on outside (web/js/solids.js, web/js/walk.js,
// Plans/hitboxes-en-looppaden.md): a turned rectangle is its own shape and not the box round it,
// a solid with a `top` is walked onto when it is a step and jumped onto when it is higher, a low
// rail is jumped over and a hedge is not - and the index answers exactly what a plain scan would.
// The walk-mode harness is tests/diving-walk.test.mjs's.
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
const { insideSolid, surfaceHeight, createSolidIndex, porchFloor } = await import('../web/js/solids.js');
const { buildBuilding } = await import('../web/js/buildings.js');

const FRAME = 1 / 60;
const GROUND = 0.1;

// Flat dry ground (a hand over the sea, or walk mode places you on the nearest shore).
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

// Walk towards `to` for up to `seconds`, jumping once as soon as `jumpWhen(state)` says so.
function walkTo(walk, to, seconds = 4, jumpWhen = null) {
  let jumped = false;
  const s = walk.state;
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    const dx = to[0] - s.pos.x, dz = to[1] - s.pos.z;
    if (Math.hypot(dx, dz) < 0.05) break;
    s.camYaw = Math.atan2(dx, dz);
    if (jumpWhen && !jumped && jumpWhen(s)) { jumped = true; key(' ', true); key(' ', false); }
    walk.update(FRAME);
  }
  key('w', false);
  for (let i = 0; i < 60; i++) walk.update(FRAME);
}

test('the index finds exactly what a scan of the list finds', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const shapes = [];
  for (let i = 0; i < 2000; i++) {
    const x = rnd() * 80 - 40, z = rnd() * 80 - 40;
    if (i % 3 === 0) shapes.push({ x, z, r: rnd() * 0.6 + 0.05 });
    else if (i % 3 === 1) shapes.push({ x, z, hx: rnd() * 1.5 + 0.05, hz: rnd() * 0.5 + 0.05 });
    else shapes.push({ x, z, hx: rnd() * 1.5 + 0.05, hz: rnd() * 0.5 + 0.05, yaw: rnd() * 6.3 });
  }
  const index = createSolidIndex(shapes);
  for (let i = 0; i < 4000; i++) {
    const x = rnd() * 84 - 42, z = rnd() * 84 - 42, pad = [0, 0.16, 0.8][i % 3];
    const scan = shapes.filter((b) => insideSolid(b, x, z, pad));
    const found = [];
    index.some(x, z, pad, (b) => { if (insideSolid(b, x, z, pad)) found.push(b); return false; });
    assert.equal(found.length, scan.length, `at ${x.toFixed(2)}, ${z.toFixed(2)} pad ${pad}`);
  }
});

test('a turned rectangle is its own shape, not the box round it', () => {
  const bench = { x: 0, z: 0, hx: 0.65, hz: 0.21, yaw: Math.PI / 4 };
  // Off the bench's back, where the box round it (0.61 each way) still reaches.
  assert.equal(insideSolid(bench, 0.45, 0.45, 0.16), false);
  assert.equal(insideSolid({ x: 0, z: 0, hx: 0.608, hz: 0.608 }, 0.45, 0.45, 0.16), true);
  // Along its length it reaches further than the box's half-diagonal would suggest.
  assert.equal(insideSolid(bench, 0.4, -0.4, 0.16), true);
  // And a surface turned the same way, and a round one.
  assert.equal(surfaceHeight({ ...bench, y: 0.4 }, 0.45, 0.45), null);
  assert.equal(surfaceHeight({ ...bench, y: 0.4 }, 0.3, -0.3), 0.4);
  assert.equal(surfaceHeight({ x: 1, z: 1, r: 0.5, y: 0.3 }, 1.3, 1.3), 0.3);
  assert.equal(surfaceHeight({ x: 1, z: 1, r: 0.5, y: 0.3 }, 1.4, 1.4), null);
});

test('walk mode puts you down beside a turned bench, and stops you at its real edge', () => {
  const bench = { x: 0, z: 0, hx: 0.65, hz: 0.21, yaw: Math.PI / 4 };
  const walk = fresh([0.45, 0.45], [bench]);
  const s = walk.state;
  assert.ok(Math.abs(s.pos.x - 0.45) < 1e-6 && Math.abs(s.pos.z - 0.45) < 1e-6,
    `was moved off a spot the bench does not cover: ${s.pos.x.toFixed(2)}, ${s.pos.z.toFixed(2)}`);
  walkTo(walk, [-1, -1], 2);
  const off = Math.hypot(s.pos.x, s.pos.z);
  assert.ok(off > 0.21 + 0.16 - 0.02 && off < 0.45, `stopped ${off.toFixed(3)} off the bench's middle`);
});

test('a porch is a step: walked onto, and stood on', () => {
  const porch = { x: 0, z: 2, hx: 1, hz: 0.6, y0: GROUND - 0.7, y1: GROUND + 0.18, top: true };
  const walk = fresh([0, 0], [porch]);
  walkTo(walk, [0, 2], 3);
  const s = walk.state;
  assert.ok(Math.abs(s.pos.z - 2) < 0.1, `did not get onto the porch: z ${s.pos.z.toFixed(2)}`);
  assert.ok(Math.abs(s.pos.y - porch.y1) < 1e-6, `stands at ${s.pos.y.toFixed(3)}, the porch is at ${porch.y1}`);
});

test('a crate is jumped onto, not walked onto', () => {
  const crate = { x: 0, z: 1.2, hx: 0.3, hz: 0.3, y0: GROUND - 0.05, y1: GROUND + 0.3, top: true };
  let walk = fresh([0, 0], [crate]);
  walkTo(walk, [0, 1.2], 2);
  assert.ok(walk.state.pos.z < 1.2 - 0.3 - 0.1, `walked into the crate: z ${walk.state.pos.z.toFixed(2)}`);
  assert.ok(Math.abs(walk.state.pos.y - GROUND) < 1e-6);
  walk = fresh([0, 0], [crate]);
  walkTo(walk, [0, 1.2], 2, (s) => s.pos.z > 0.7);
  const s = walk.state;
  assert.ok(Math.abs(s.pos.z - 1.2) < 0.3, `did not land on the crate: z ${s.pos.z.toFixed(2)}`);
  assert.ok(Math.abs(s.pos.y - crate.y1) < 1e-6, `stands at ${s.pos.y.toFixed(3)}, the crate's top is ${crate.y1}`);
  assert.equal(s.grounded, true);
});

test('a low rail is jumped over; a hedge is not', () => {
  const rail = { x: 0, z: 1, hx: 2, hz: 0.05, y0: GROUND, y1: GROUND + 0.32, hop: true };
  let walk = fresh([0, 0], [rail]);
  walkTo(walk, [0, 2], 2);
  assert.ok(walk.state.pos.z < 1, 'walked through a rail');
  walk = fresh([0, 0], [rail]);
  walkTo(walk, [0, 2], 3, (s) => s.pos.z > 0.7);
  assert.ok(walk.state.pos.z > 1.5, `did not clear the rail: z ${walk.state.pos.z.toFixed(2)}`);
  assert.ok(Math.abs(walk.state.pos.y - GROUND) < 1e-6, 'a rail has no top to stand on');

  const hedge = { x: 0, z: 1, hx: 2, hz: 0.17, y0: GROUND, y1: GROUND + 0.5 };
  walk = fresh([0, 0], [hedge]);
  walkTo(walk, [0, 2], 3, (s) => s.pos.z > 0.7);
  assert.ok(walk.state.pos.z < 1, `jumped a hedge: z ${walk.state.pos.z.toFixed(2)}`);
});

test('a body walking a route from above jumps a rail in its way, and is stopped by a hedge', () => {
  const rail = { x: 0, z: 1, hx: 2, hz: 0.05, hop: true };
  let walk = fresh([0, 0], []);
  walk.park({ at: [0, 0], blockers: [rail] });
  walk.goTo([[0, 2]]);
  for (let i = 0; i < 6 * 60; i++) walk.update(FRAME);
  assert.ok(walk.state.pos.z > 1.8, `the parked body did not get over the rail: z ${walk.state.pos.z.toFixed(2)}`);
  walk = fresh([0, 0], []);
  walk.park({ at: [0, 0], blockers: [{ ...rail, hop: false, hz: 0.17 }] });
  walk.goTo([[0, 2]]);
  for (let i = 0; i < 6 * 60; i++) walk.update(FRAME);
  assert.ok(walk.state.pos.z < 1, 'the parked body went through a hedge');
});

test('a house porch is a floor: the feet snap onto it at the door and off it again', () => {
  // Every house is scaled 0.96 to 1.04 of itself; its porch comes back scaled with it.
  const built = buildBuilding({ id: 'house:porch-test', kind: 'house', tier: 'house', style: 'claude' }, {});
  assert.ok(built.porch, 'a house hands back no porch');
  const yaw = 0.4, base = GROUND;
  const [floor, low] = porchFloor(built.porch, { x: 0, z: 0, y: base, yaw });
  assert.equal(floor.floor, true);
  assert.ok(low && Math.abs(low.y1 - base - 0.081) < 0.01, 'no lower course');
  assert.ok(Math.abs(floor.y1 - base - 0.18) < 0.01, `porch top ${floor.y1 - base}`);
  // The walls turned the same way, as their own shape (`yaw`), which is what blockersOf hands walk mode
  // (solids.js solidAt): the box round a turned wall stood further out than the porch on a house at
  // this angle (Plans/muren-met-hitboxes.md, tests/building-blockers.test.mjs).
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const walls = built.solids.map((r) => ({ x: r.x * c + r.z * s, z: -r.x * s + r.z * c, hx: r.hx, hz: r.hz, yaw }));
  // Out in front of the door (+z in the house's frame), walking back towards it.
  const out = [2 * s, 2 * c], step = [((built.porch.z1) - 0.05) * s, ((built.porch.z1) - 0.05) * c];
  const walk = fresh(out, [...walls, floor, low]);
  assert.ok(Math.abs(walk.state.pos.y - base) < 1e-6, 'not on the grass to begin with');
  walkTo(walk, step, 4);
  assert.ok(Math.abs(walk.state.pos.y - floor.y1) < 1e-6, `at the door the feet are at ${walk.state.pos.y.toFixed(3)}, the porch at ${floor.y1.toFixed(3)}`);
  walkTo(walk, out, 6);
  assert.ok(Math.abs(walk.state.pos.y - base) < 1e-6, `back on the grass at ${walk.state.pos.y.toFixed(3)}`);
});

test('roomFor asks the same shapes with a wider radius', () => {
  const walk = fresh([3, 3], [{ x: 0, z: 0, hx: 0.65, hz: 0.21, yaw: Math.PI / 4 }]);
  assert.equal(walk.roomFor(0.9, 0.9, 0.3), true);
  assert.equal(walk.roomFor(0.6, -0.6, 0.3), false);
});

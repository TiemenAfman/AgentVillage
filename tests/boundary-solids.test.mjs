// A hamlet's boundary is solid where it is drawn and open where a road goes through it
// (web/js/hamlets.js buildBorders `out`, Plans/hitboxes-en-looppaden.md): a wall of manors is a wall
// and its gate a gate, a rail round a hamlet of tents is jumped, and the route of a body walking by
// itself is told which cell pairs a wall closes. Walked by the real walk mode, harness of
// tests/diving-walk.test.mjs.
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
const { buildBorders, edgeKey, NONE } = await import('../web/js/hamlets.js');
const { createWalkMode } = await import('../web/js/walk.js');
const { insideSolid } = await import('../web/js/solids.js');

const SIZE = 16, HALF = 8, GROUND = 0.6;
const terrain = {
  size: SIZE, half: HALF,
  isLand: (gx, gz) => gx >= 0 && gz >= 0 && gx < SIZE && gz < SIZE,
  worldHeight: () => GROUND, heightAt: () => GROUND,
  cellWorld: (gx, gz) => [gx - HALF + 0.5, gz - HALF + 0.5],
};
// Hamlet 0 owns cells 4..9 by 4..9; a road runs along row 6 from the west edge into it.
function island(tier) {
  const owner = new Int16Array(SIZE * SIZE).fill(NONE);
  for (let gz = 4; gz <= 9; gz++) for (let gx = 4; gx <= 9; gx++) owner[gx + gz * SIZE] = 0;
  const roads = new Set();
  for (let gx = 0; gx <= 6; gx++) roads.add(gx + 6 * SIZE);
  const village = {
    districts: [{ id: 'd0', hue: 120 }],
    buildings: [{ id: 'h', kind: 'house', tier, plot: { gx: 6, gz: 6, w: 3, d: 3 } }],
  };
  const out = {};
  buildBorders(village, terrain, owner, roads, null, out);
  return out;
}

test('a wall of manors is solid all round, closes its cell pairs, and leaves its gate open', () => {
  const { solids, closed } = island('manor');
  assert.ok(solids.length > 0);
  const runs = solids.filter((b) => !b.r);
  assert.ok(runs.every((b) => !b.hop), 'a wall is not a hop');
  // The west edge of the hamlet is the line x = 4 - HALF; its gate is the road's row, z in [6, 7) - HALF.
  const gateZ = 6.5 - HALF, wallX = 4 - HALF;
  assert.equal(solids.some((b) => insideSolid(b, wallX, gateZ, 0.16)), false, 'the gate is closed');
  assert.equal(solids.some((b) => insideSolid(b, wallX, 4.5 - HALF, 0.16)), true, 'the wall beside it is open');
  assert.ok(!closed.has(edgeKey(3 + 6 * SIZE, 4 + 6 * SIZE)), 'the gate is a closed edge');
  assert.ok(closed.has(edgeKey(3 + 5 * SIZE, 4 + 5 * SIZE)), 'the wall beside the gate is not a closed edge');
  // Every closed pair is two neighbouring cells, one inside and one out.
  for (const k of closed) {
    const a = Math.floor(k / 2 ** 26), b = k % 2 ** 26;
    const d = Math.abs(a - b);
    assert.ok(d === 1 || d === SIZE, `not neighbours: ${a}, ${b}`);
  }
});

test('a rail round a hamlet of tents is a hop and closes nothing', () => {
  const { solids, closed } = island('tent');
  assert.ok(solids.filter((b) => !b.r).every((b) => b.hop));
  assert.equal(closed.size, 0);
});

function walker(solids) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const flat = () => GROUND;
  const sea = { height: flat, bedAt: flat, regionAt: () => null, levelKey: () => null };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({ scene: new THREE.Scene(), camera, terrain: { half: 64, size: 128, worldHeight: flat }, ground: sea, material: new THREE.MeshBasicMaterial(), dom });
  walk.enter({ at: [2 - HALF, 0], facing: [HALF, 0], blockers: solids, interactables: [], onExit: noop });
  return walk;
}
function walkTo(walk, to, seconds) {
  const s = walk.state;
  key('w', true);
  for (let i = 0; i < seconds * 60; i++) {
    const dx = to[0] - s.pos.x, dz = to[1] - s.pos.z;
    if (Math.hypot(dx, dz) < 0.05) break;
    s.camYaw = Math.atan2(dx, dz);
    walk.update(1 / 60);
  }
  key('w', false);
}

test('walked: into the wall is no way in, through the gate is', () => {
  const { solids } = island('manor');
  let walk = walker(solids);
  walk.state.pos.set(2.5 - HALF, GROUND, 4.5 - HALF);
  walkTo(walk, [5.5 - HALF, 4.5 - HALF], 8);
  assert.ok(walk.state.pos.x < 4 - HALF, `walked through the wall to x ${walk.state.pos.x.toFixed(2)}`);
  walk = walker(solids);
  walk.state.pos.set(2.5 - HALF, GROUND, 6.5 - HALF);
  walkTo(walk, [5.5 - HALF, 6.5 - HALF], 8);
  assert.ok(walk.state.pos.x > 5 - HALF, `stuck in the gate at x ${walk.state.pos.x.toFixed(2)}`);
});

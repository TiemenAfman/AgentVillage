// The sail and the flag welded into the galleon's one geometry and moved there (web/js/boat.js
// `shipMotionParts`, `sails`, `bob`; Plans/nieuwe-sloep.md chip 2c), on a bake that has them: the one
// the loader hook tests/support/sloop-parts-loader.mjs gives her, since no committed bake does yet. The
// ship stays one mesh; the sail's and the flag's corners are the last runs and the only ones `bob`
// moves; the sail follows the share of sail it is given, furled against its yard at 0 and in its baked
// place at 1; the flag's luff stays on its staff; laying a gun and moving the cloth leave each other's
// corners alone. Nothing of it reaches the hull's own corners, her ladders or her guns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);
register('./support/sloop-parts-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = { createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop };

const { SAIL, FLAG } = await import('./support/sloop-parts-loader.mjs');
const { createBoat, isShipMoving } = await import('../web/js/boat.js');
const { ROLL_TURNS, SHIP_MOTION } = await import('../web/js/ship-motion.js');
const { CRAFTS, SHIP_DRAUGHT } = await import('../shared/crafts.mjs');
const models = await import('../web/js/models.js');

const moving = models.assetParts('pirateship').filter(isShipMoving);
const countOf = (n) => models.part(n).positions.length / 3;

function build() {
  const scene = new THREE.Scene();
  const boat = createBoat({ scene, material: new THREE.MeshBasicMaterial(), kind: 'ship' });
  const pos = boat.object.geometry.attributes.position;
  const total = pos.count;
  const flagN = countOf('pirateship flag'), sailN = countOf('pirateship sail');
  // Welded in the asset's order, last: the sail's run, then the flag's.
  const runs = { sail: [total - flagN - sailN, total - flagN], flag: [total - flagN, total] };
  return { scene, boat, pos, runs, tail: total - flagN - sailN };
}
const vertex = (arr, v) => [arr[v * 3], arr[v * 3 + 1], arr[v * 3 + 2]];

test('the loader gave her a sail and a flag, and boat.js names both as moving', () => {
  assert.deepEqual(moving.sort(), ['pirateship flag', 'pirateship sail']);
});

test('one mesh; the cloth is the last runs; a share of sail furls and sets it; the hull never moves', () => {
  const { scene, boat, pos, runs, tail } = build();
  assert.equal(scene.children.filter((o) => o.isMesh).length, 1, 'one mesh, one draw call');
  assert.equal(boat.sailParts, 2);
  boat.place(0, 0, 0);
  // Full sail at a clock: the sail's corners within the ripple of where the bake put them (the part's
  // origin plus its corners, less the draught); the yard's own row exactly there.
  boat.sails(1);
  boat.bob(100);
  const full = pos.array.slice();
  const baked = models.part('pirateship sail');
  const K = SHIP_MOTION.sail;
  let onYard = 0;
  for (let v = runs.sail[0], k = 0; v < runs.sail[1]; v++, k += 3) {
    const b = [baked.positions[k] + SAIL.at[0], baked.positions[k + 1] + SAIL.at[1] - SHIP_DRAUGHT, baked.positions[k + 2] + SAIL.at[2]];
    const now = vertex(full, v);
    const d = Math.hypot(now[0] - b[0], now[1] - b[1], now[2] - b[2]);
    assert.ok(d <= SAIL.h * (K.breathe + K.ripple) + 1e-5, `sail corner ${v} is ${d} from its baked place under full sail`);
    if (baked.positions[k + 1] >= -1e-9) { assert.ok(d < 1e-5, 'the yard\'s row moved'); onYard++; }
  }
  assert.ok(onYard > 0);
  // Struck, and ten seconds on, frame by frame (the share eases over two, and a single bob eases at most
  // a second's worth): a bundle under the yard, nothing lower than two rolls' worth below it, and the
  // hull's own corners - and her ladders' and her guns' - the same bytes.
  boat.sails(0);
  for (let t = 100.5; t <= 110; t += 0.5) boat.bob(t);
  const furled = pos.array;
  const yard = SAIL.at[1] - SHIP_DRAUGHT, r = SAIL.h / (2 * Math.PI * ROLL_TURNS);
  for (let v = runs.sail[0]; v < runs.sail[1]; v++) {
    const [, y, z] = vertex(furled, v);
    assert.ok(y <= yard + 1e-5 && y >= yard - 2 * r - 1e-5, `furled corner ${v} hangs at ${y} under a yard at ${yard}`);
    assert.ok(Math.abs(z - SAIL.at[2]) <= r + 1e-5, `furled corner ${v} stands ${z - SAIL.at[2]} off the yard`);
  }
  for (let i = 0; i < tail * 3; i++) assert.equal(furled[i], full[i], `a corner of the hull (${Math.floor(i / 3)}) moved with the sail`);
  assert.equal(boat.sailShare(), 0);
  // The flag flies from its staff: its luff column - the corners at the part's origin - never moves,
  // its fly end does, and at another clock lies elsewhere.
  const flag = models.part('pirateship flag');
  let flew = 0;
  for (let v = runs.flag[0], k = 0; v < runs.flag[1]; v++, k += 3) {
    const atStaff = Math.abs(flag.positions[k + 2]) < 1e-9;
    const a = vertex(full, v), b = vertex(furled, v);
    if (atStaff) {
      assert.deepEqual(a, b, 'the luff moved');
      assert.ok(Math.abs(a[0] - FLAG.at[0]) < 1e-5 && Math.abs(a[2] - FLAG.at[2]) < 1e-5, 'the luff is not at the staff');
    } else if (a[0] !== b[0]) flew++;
  }
  assert.ok(flew > 0, 'the flag hangs dead');
  boat.dispose();
});

test('laying a gun and moving the cloth keep to their own corners, and the same clock twice is once', () => {
  const { boat, pos, runs } = build();
  boat.place(3, 4, 0.2);
  boat.sails(0.5);
  boat.bob(200);
  const gun = CRAFTS.galleon.mounts.findIndex((m) => m.kind === 'cannon');
  const before = pos.array.slice();
  boat.layGun(gun, [0.4, 0.3], 0.05);
  const laid = pos.array.slice();
  // The laying moved corners, none of them the cloth's.
  let moved = 0;
  for (let i = 0; i < laid.length; i++) if (laid[i] !== before[i]) { moved++; assert.ok(i < runs.sail[0] * 3, `laying the gun moved cloth corner ${Math.floor(i / 3)}`); }
  assert.ok(moved > 100, 'the gun was not laid');
  // The cloth moved on: the gun as laid.
  boat.bob(201);
  const after = pos.array.slice();
  for (let i = 0; i < runs.sail[0] * 3; i++) assert.equal(after[i], laid[i], `moving the cloth moved hull corner ${Math.floor(i / 3)}`);
  const version = pos.version;
  boat.bob(201);
  assert.deepEqual(pos.array, after, 'the same clock twice drew the cloth elsewhere');
  assert.equal(pos.version, version, 'and uploads nothing for it');
  assert.ok(version > 0, 'the moved cloth was never marked for upload');
  boat.dispose();
});

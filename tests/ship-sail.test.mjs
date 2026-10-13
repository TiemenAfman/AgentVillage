// The galleon's sail and flag as moving parts of her one geometry (web/js/ship-motion.js, boat.js
// `isShipMoving`/`sails`, Plans/nieuwe-sloep.md chip 2c): the sums are pure and run under Node on a
// synthetic cloth - a sail furls up to its yard and sets again, ripples only when set, and the yard's row
// never leaves the yard; a flag flies from its luff and the luff stays on the staff - and on a bake with
// no such part (the galleon as she is) nothing is welded and nothing moves: the hull's geometry stays
// byte for byte what the hull, her ladders and her guns make. The share of sail drawn eases towards the
// share wanted over about two seconds, and the ripple is the Salty Kraken's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = { createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop };

const M = await import('../web/js/ship-motion.js');
const { MOTION } = await import('../web/js/kraken-motion.js');
const { createBoat, isShipMoving, ladderBoxes } = await import('../web/js/boat.js');
const { carriageGeometry, barrelGeometry, cannonShape } = await import('../web/js/cannon.js');
const { CRAFTS, SHIP_DRAUGHT } = await import('../shared/crafts.mjs');
const { PIRATESHIP } = await import('../web/js/pirateship-mesh.js');
const models = await import('../web/js/models.js');

test('ship-motion.js is pure: no THREE, no DOM, no clock of its own', () => {
  const src = readFileSync(new URL('../web/js/ship-motion.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /from 'three'|document\.|window\.|Date\.now|performance\.now/);
});

test('the sail ripples and the flag flies by the Salty Kraken\'s sums', () => {
  assert.deepEqual(M.SHIP_MOTION.sail, MOTION.sail);
  assert.deepEqual(M.SHIP_MOTION.flag, MOTION.flag);
});

test('what moves on her is her sail and her flag, by name, and nothing of the Kraken\'s', () => {
  for (const n of ['pirateship sail', 'pirateship sail:0', 'pirateship sail boltrope:2', 'pirateship flag', 'pirateship flag:1', 'pirateship flag skull']) {
    assert.ok(isShipMoving(n), `${n} should move`);
  }
  for (const n of ['pirateship hull', 'pirateship hull:0', 'pirateship sailor', 'pirateship flagstaff', 'Salty fore course', 'batavia flag ensign:0']) {
    assert.ok(!isShipMoving(n), `${n} should not move`);
  }
});

// A square sail as the bake is to make it (Plans/nieuwe-sloep.md chip 3): a regular grid hung from its
// yard, here 10 across by 14 down, 3 wide and 2.8 tall, the yard at y 6 along x, bellied a little aft
// (-z) towards the foot so the cloth is not a plane. Positions in the hull's frame, as `measureSail`
// takes them.
function grid({ yard = 6, h = 2.8, w = 3, cols = 10, rows = 14, belly = 0.15, yaw = 0 } = {}) {
  const out = [];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let r = 0; r <= rows; r++) {
    for (let q = 0; q <= cols; q++) {
      const u = -w / 2 + (w * q) / cols, k = r / rows;
      const x = u * c, z = u * s - belly * Math.sin(Math.PI * k);
      out.push(x, yard - h * k, z);
    }
  }
  return Float32Array.from(out);
}
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('a sail is measured off its corners: yard at the top, foot at the bottom, along its yard', () => {
  const p = grid();
  const S = M.measureSail(p);
  // Float32 in, so a hair of give.
  near(S.yard, 6, 1e-6, 'yard');
  near(S.foot, 3.2, 1e-6, 'foot');
  near(S.h, 2.8, 1e-6, 'height');
  near(Math.abs(S.along[0]), 1, 1e-6, 'along x');
  near(Math.abs(S.normal[1]), 1, 1e-6, 'breathes along z');
  near(S.half, 1.5, 1e-6, 'half its width');
  // Braced round by a third of a turn, the measure turns with it.
  const T = M.measureSail(grid({ yaw: 1.0 }));
  near(Math.abs(T.along[0] * Math.cos(1.0) + T.along[1] * Math.sin(1.0)), 1, 1e-6, 'braced round');
  assert.equal(M.measureSail(new Float32Array(0)), null);
});

test('set, the sail hangs where it was baked and ripples; furled, it is a bundle under its yard that does not move', () => {
  const base = grid();
  const S = M.measureSail(base);
  const m = { base, sail: S, seed: 0.7 };
  const out = new Float32Array(base.length);
  // Full sail: every corner within the ripple of its baked place, and the yard's own row does not move.
  M.moveSail(m, 12.3, 1, out);
  const K = M.SHIP_MOTION.sail, most = S.h * (K.breathe + K.ripple) + 1e-5;
  let rippled = 0;
  for (let i = 0; i < base.length; i += 3) {
    const d = Math.hypot(out[i] - base[i], out[i + 1] - base[i + 1], out[i + 2] - base[i + 2]);
    assert.ok(d <= most, `corner ${i / 3} moved ${d} under full sail`);
    assert.equal(out[i + 1], base[i + 1], 'a set sail only moves across, never up or down');
    if (base[i + 1] >= S.yard - 1e-9) assert.equal(d, 0, 'the yard\'s row stays on the yard');
    if (d > 0.005) rippled++;
  }
  assert.ok(rippled > base.length / 9, `only ${rippled} corners ripple`);
  // And it breathes: two sea times put the foot in two places.
  const later = M.moveSail(m, 13.1, 1, new Float32Array(base.length));
  let differs = 0;
  for (let i = 0; i < base.length; i += 3) if (later[i] !== out[i] || later[i + 2] !== out[i + 2]) differs++;
  assert.ok(differs > base.length / 9, 'a set sail stands still in the wind');
  // Furled: everything on a roll under the yard - within the roll's reach of the yard's line - and the
  // same at any time, since a bundle does not ripple.
  const r = S.h / (2 * Math.PI * M.ROLL_TURNS);
  const furled = M.moveSail(m, 12.3, 0, new Float32Array(base.length));
  for (let i = 0; i < base.length; i += 3) {
    assert.ok(furled[i + 1] <= S.yard + 1e-5 && furled[i + 1] >= S.yard - 2 * r - 1e-5, `furled corner ${i / 3} at y ${furled[i + 1]}`);
    assert.ok(Math.abs(furled[i + 2]) <= r + 1e-5, `furled corner ${i / 3} stands ${furled[i + 2]} off the yard`);
    near(furled[i], base[i], 1e-5, 'a corner keeps its place along the yard');
  }
  assert.deepEqual(M.moveSail(m, 99.9, 0, new Float32Array(base.length)), furled);
  // Half set: between the two, foot and all; a backed sail (-1) is as much cloth as a full one.
  const half = M.moveSail(m, 12.3, 0.5, new Float32Array(base.length));
  const foot = (a) => { let lo = Infinity; for (let i = 1; i < a.length; i += 3) lo = Math.min(lo, a[i]); return lo; };
  assert.ok(foot(half) > foot(out) + 0.5 && foot(half) < foot(furled) - 0.5, `half set, the foot is at ${foot(half)}`);
  assert.deepEqual(M.moveSail(m, 12.3, -1, new Float32Array(base.length)), out);
});

// A flag as a strip of cloth, its luff at the staff (the part's `at`), flying along +x (as the Kraken's
// do) or any other way.
function cloth({ at = [0.3, 9, -0.2], len = 1.2, h = 0.5, yaw = 0, cols = 12, rows = 4 } = {}) {
  const out = [];
  for (let r = 0; r <= rows; r++) for (let q = 0; q <= cols; q++) {
    const d = (len * q) / cols;
    out.push(at[0] + d * Math.cos(yaw), at[1] - (h * r) / rows, at[2] + d * Math.sin(yaw));
  }
  return Float32Array.from(out);
}

test('a flag flies from its luff, which stays on the staff, and its fly end swings and droops', () => {
  const at = [0.3, 9, -0.2];
  const base = cloth({ at });
  const F = M.measureFlag(base, at);
  near(F.len, 1.2, 1e-6, 'length');
  near(F.dir[0], 1, 1e-6, 'flies along +x from the staff');
  const m = { base, flag: F, seed: 1.1 };
  const out = M.moveFlag(m, 4.2, new Float32Array(base.length));
  const K = M.SHIP_MOTION.flag;
  let swung = 0;
  for (let i = 0; i < base.length; i += 3) {
    const d = base[i] - at[0];
    if (d < 1e-9) { assert.deepEqual([out[i], out[i + 1], out[i + 2]], [base[i], base[i + 1], base[i + 2]], 'the luff moved'); continue; }
    assert.equal(out[i], base[i], 'a flag swings across, never along');
    assert.ok(Math.abs(out[i + 2] - base[i + 2]) <= K.swing * F.len + 1e-5);
    assert.ok(out[i + 1] <= base[i + 1] + 1e-6 && out[i + 1] >= base[i + 1] - K.droop * F.len - 1e-5, 'droops, never lifts');
    if (Math.abs(out[i + 2] - base[i + 2]) > 0.01) swung++;
  }
  assert.ok(swung > 0, 'nothing flies');
  // Another time, another shape; and a flag baked flying the other way flies from its own staff.
  assert.notDeepEqual(M.moveFlag(m, 5.0, new Float32Array(base.length)), out);
  const back = cloth({ at, yaw: Math.PI });
  const B = M.measureFlag(back, at);
  near(B.dir[0], -1, 1e-6, 'flies along -x');
  near(B.luff[0], at[0], 1e-6, 'its luff is at the staff');
  // The luff is read off the corners, so a staff a hair off the cloth still finds the near end.
  const off = M.measureFlag(base, [at[0] - 0.05, at[1], at[2]]);
  near(off.luff[0], at[0], 1e-6, 'luff');
  near(off.dir[0], 1, 1e-6, 'dir');
});

test('the drawn share eases to the wanted one over about two seconds, and a dt of 0 changes nothing', () => {
  let s = 0;
  s = M.easeShare(s, 1, 1);
  near(s, 0.5, 1e-9, 'halfway after a second');
  s = M.easeShare(s, 1, 1);
  near(s, 1, 1e-9, 'full after two');
  assert.equal(M.easeShare(0.3, 1, 0), 0.3);
  assert.equal(M.easeShare(0.3, 1, -1), 0.3);
  near(M.easeShare(1, 0.25, 10), 0.25, 1e-9, 'never past what is wanted');
  near(M.easeShare(0, -1, 0.5), -0.25, 1e-9, 'astern the same way');
  assert.equal(M.easeShare(0.4, NaN, 1), 0, 'rubbish is no sail');
});

test('on a bake with no moving part nothing is welded and nothing moves; the share still eases on the hull', () => {
  const moving = models.assetParts('pirateship').filter(isShipMoving);
  const scene = new THREE.Scene();
  const boat = createBoat({ scene, material: new THREE.MeshBasicMaterial(), kind: 'ship' });
  assert.ok(boat.walk, 'the pirate ship must be baked for this');
  assert.equal(scene.children.filter((o) => o.isMesh).length, 1, 'one mesh, one draw call');
  assert.equal(boat.sailParts, moving.length);
  // The geometry is the hull, her ladders, her guns and the moving parts, and no more: counted.
  const geometry = boat.object.geometry;
  let expect = PIRATESHIP.parts['pirateship hull'].positions.length / 3;
  for (const b of ladderBoxes(CRAFTS.galleon)) { expect += b.attributes.position.count; b.dispose(); }
  if (cannonShape()) {
    const guns = CRAFTS.galleon.mounts.filter((m) => m.kind === 'cannon').length;
    const c = carriageGeometry(), b = barrelGeometry();
    expect += guns * (c.attributes.position.count + b.attributes.position.count);
    c.dispose(); b.dispose();
  }
  for (const n of moving) expect += models.part(n).positions.length / 3;
  assert.equal(geometry.attributes.position.count, expect, 'something else was welded in');
  if (!moving.length) {
    // Byte for byte still, whatever the sail and the clock say.
    boat.place(4, 5, 0.3);
    boat.sails(1);
    boat.bob(100);
    const before = geometry.attributes.position.array.slice();
    for (const [t, share] of [[100.5, 0.5], [101, 0], [103, 1], [103, 1]]) {
      boat.sails(share);
      boat.bob(t);
    }
    assert.deepEqual(geometry.attributes.position.array, before);
  } else {
    // A bake with the parts: the sail's run moves with the share and the hull's corners never do.
    boat.sails(1); boat.bob(100);
    const full = geometry.attributes.position.array.slice();
    boat.sails(0); boat.bob(110);
    const furled = geometry.attributes.position.array;
    const tail = geometry.attributes.position.count - moving.reduce((n, p) => n + models.part(p).positions.length / 3, 0);
    for (let i = 0; i < tail * 3; i++) assert.equal(furled[i], full[i], `hull corner ${Math.floor(i / 3)} moved with the sail`);
    let moved = 0;
    for (let i = tail * 3; i < full.length; i++) if (furled[i] !== full[i]) moved++;
    assert.ok(moved > 0, 'the sail did not furl');
  }
  // The share follows what is asked at SAIL_EASE a second, from wherever the first word put it.
  const ship = createBoat({ scene, material: new THREE.MeshBasicMaterial(), kind: 'ship' });
  ship.sails(1);
  ship.bob(50);
  assert.equal(ship.sailShare(), 1, 'before the first bob a setting is taken as it stands');
  ship.sails(0);
  ship.bob(50);
  assert.equal(ship.sailShare(), 1, 'the same clock twice is once');
  ship.bob(51);
  near(ship.sailShare(), 0.5, 1e-9, 'half struck after a second');
  ship.bob(53);
  assert.equal(ship.sailShare(), 0, 'struck after two');
  ship.sails(-1);
  ship.bob(60);   // a tab come back: capped at a second of easing, not seven
  near(ship.sailShare(), -0.5, 1e-9, 'a long gap hoists a second\'s worth');
  // A rowing boat has no sail to speak of.
  const row = createBoat({ scene, material: new THREE.MeshBasicMaterial() });
  row.sails(1); row.bob(1); row.bob(2);
  assert.equal(row.sailShare(), 0);
  assert.equal(row.sailParts, 0);
  boat.dispose(); ship.dispose(); row.dispose();
});

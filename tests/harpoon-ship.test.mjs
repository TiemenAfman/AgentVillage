// The galleon's two harpoon guns (Plans/harpoen.md): on her forecastle, one a side, after the cannons in
// her `mounts` so the cannons keep their numbers on the wire, hung on the hull's object so the swell
// carries them, aimed through the same craft handle a cannon is laid through, and a muzzle that is where
// the drawn barrel's mouth is and points where it points.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = { createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop };

const { CRAFTS } = await import('../shared/crafts.mjs');
const { DECK_Y } = await import('../shared/hull.mjs');
const { createBoat } = await import('../web/js/boat.js');

const mounts = CRAFTS.galleon.mounts;
const harpoonIdx = mounts.map((m, i) => (m.kind === 'harpoon' ? i : -1)).filter((i) => i >= 0);

test('two harpoons on the forecastle, one a side, after the cannons', () => {
  assert.deepEqual(mounts.map((m) => m.kind), ['cannon', 'cannon', 'harpoon', 'harpoon']);
  const [a, b] = harpoonIdx.map((i) => mounts[i]);
  assert.equal(a.x, -b.x);
  assert.equal(a.yaw, -b.yaw);
  for (const m of [a, b]) {
    assert.ok(m.z > 2.85 && m.z < 3.4 && m.y === 1.318, 'on the forecastle planking');
    assert.ok(Math.abs(m.x) < 1.2, 'inside her rim');
    // Whoever mans it stands behind it, on the planking too.
    const back = (m.x - m.stand[0]) * Math.sin(m.yaw) + (m.z - m.stand[1]) * Math.cos(m.yaw);
    assert.ok(back > 0.25 && back < 0.6, `stands ${back} behind`);
  }
});

test('the ship carries them on her hull, aims them like her cannons, and knows their mouths', () => {
  const scene = new THREE.Scene();
  const boat = createBoat({ scene, material: new THREE.MeshBasicMaterial(), kind: 'ship' });
  assert.equal(boat.harpoons(), 2);
  const [i] = harpoonIdx, m = mounts[i];
  assert.deepEqual(boat.gunLay(i).lay, [0, 0]);
  let mouth = boat.gunMuzzle(i);
  // At rest it points along the mount's own heading, level, from a chest's height over the deck.
  assert.ok(Math.abs(mouth.dir[0] - Math.sin(m.yaw)) < 1e-6 && Math.abs(mouth.dir[2] - Math.cos(m.yaw)) < 1e-6);
  assert.ok(Math.abs(mouth.dir[1]) < 1e-6);
  assert.ok(mouth.at[1] > DECK_Y + m.y + 0.25 && mouth.at[1] < DECK_Y + m.y + 0.4, `mouth at ${mouth.at[1]}`);
  boat.layGun(i, [0.3, 0.4]);
  assert.deepEqual(boat.gunLay(i).lay, [0.3, 0.4]);
  mouth = boat.gunMuzzle(i);
  assert.ok(Math.abs(mouth.dir[1] - Math.sin(0.4)) < 1e-6, 'lifted');
  assert.ok(Math.abs(Math.atan2(mouth.dir[0], mouth.dir[2]) - (m.yaw + 0.3)) < 1e-6, 'swung');
  // On the hull's object, so a swell that tips her tips them.
  boat.place(10, 20, 0.5);
  boat.bob(3);
  const w = boat.gunMuzzle(i);
  assert.ok(Math.abs(w.dir[1] - Math.sin(0.4)) < 1e-6, 'her own frame, whatever her heading');
  // The cannons answer as they always did.
  assert.ok(boat.gunMuzzle(0) && boat.gunMuzzle(0).at.length === 3);
});

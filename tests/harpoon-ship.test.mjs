// The galleon's harpoon guns (Plans/harpoen.md): after the cannons in her `mounts` so the cannons keep
// their numbers on the wire, each standing on a stretch of her deck and pointing out and forward, hung on
// the hull's object so the swell carries them, aimed through the same craft handle a cannon is laid
// through, and a muzzle that is where the drawn barrel's mouth is and points where it points. Written
// for however many she carries - two on the forecastle today, one on the bow of the sloop to come
// (Plans/DONE/nieuwe-sloep.md) - so a new bake changes no line here.
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
const kinds = mounts.map((m) => m.kind);
const harpoonIdx = kinds.map((k, i) => (k === 'harpoon' ? i : -1)).filter((i) => i >= 0);
// The stretch of deck a point stands on, and the planking's height there.
const deckUnder = (x, z) => CRAFTS.galleon.deck.find((d) => Math.abs(x - d.x) <= d.hx + 0.1 && Math.abs(z - d.z) <= d.hz + 0.05);
const plankingAt = (d, z) => d.y + (d.slope || 0) * (z - d.z);

test('at least one harpoon, every one after the cannons, on a deck, pointing out and forward', () => {
  assert.ok(harpoonIdx.length >= 1, 'no harpoon mounted');
  assert.ok(new Set(kinds).size <= 2 && kinds.every((k) => k === 'cannon' || k === 'harpoon'));
  assert.ok(harpoonIdx[0] > kinds.lastIndexOf('cannon'), 'a harpoon stands before a cannon: the cannons\' numbers on the wire moved');
  for (const i of harpoonIdx) {
    const m = mounts[i];
    const on = deckUnder(m.x, m.z);
    assert.ok(on, `harpoon ${i} at (${m.x}, ${m.z}) is on no deck`);
    assert.ok(Math.abs(m.y - plankingAt(on, m.z)) < 0.05, `harpoon ${i} is not on the planking (${m.y} vs ${plankingAt(on, m.z)})`);
    // Forward, never aft; and out of its own side, or straight ahead from the middle.
    assert.ok(Math.cos(m.yaw) > 0, `harpoon ${i} points aft (yaw ${m.yaw})`);
    if (Math.abs(m.x) > 0.05) assert.ok(Math.sign(Math.sin(m.yaw)) === Math.sign(m.x), `harpoon ${i} points across the deck`);
    else assert.ok(Math.abs(Math.sin(m.yaw)) < 0.05, `a harpoon on the centreline points along it`);
    // Whoever mans it stands behind it, on the planking too.
    const back = (m.x - m.stand[0]) * Math.sin(m.yaw) + (m.z - m.stand[1]) * Math.cos(m.yaw);
    assert.ok(back > 0.25 && back < 0.6, `stands ${back} behind`);
    assert.ok(deckUnder(m.stand[0], m.stand[1]), `the gunner of harpoon ${i} stands on no deck`);
    // Aimed, not laid: it swings wider than a cannon and can point down at the water.
    assert.ok(m.yawLim > 0.61 && m.pitchLim[0] < -0.12);
  }
  // A pair is mirrored.
  if (harpoonIdx.length === 2) {
    const [a, b] = harpoonIdx.map((i) => mounts[i]);
    assert.equal(a.x, -b.x);
    assert.equal(a.yaw, -b.yaw);
  }
});

test('the ship carries them on her hull, aims them like her cannons, and knows their mouths', () => {
  const scene = new THREE.Scene();
  const boat = createBoat({ scene, material: new THREE.MeshBasicMaterial(), kind: 'ship' });
  assert.equal(boat.harpoons(), harpoonIdx.length);
  for (const i of harpoonIdx) {
    const m = mounts[i];
    boat.place(0, 0, 0);
    boat.layGun(i, [0, 0]);
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
  }
  // The cannons answer as they always did.
  const gun = kinds.indexOf('cannon');
  assert.ok(gun >= 0 && boat.gunMuzzle(gun) && boat.gunMuzzle(gun).at.length === 3);
  boat.dispose();
});

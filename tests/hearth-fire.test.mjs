// The Salty Kraken's hearth fire (web/js/hearth-fire.js, kraken-layout.js HEARTH_FIRE): the flame's
// box stands inside the firebox the shell builds and under its arch, the room still has the tavern's
// seven lamps with the hearth's one marked to breathe with the fire, and the module takes nothing
// from chance - every page burns the same fire - nor from the GPL project the keeper found it in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const ctx2d = new Proxy({}, { get: () => () => ({}) });
const stub = () => {
  globalThis.document = {
    createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }),
  };
};
stub();
const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error('no network in a test'));
const realWarn = console.warn;
console.warn = () => {};
const K = await import('../web/js/kraken-layout.js');
const { createHearthFire, fireFlicker } = await import('../web/js/hearth-fire.js');
const { buildPirateTavern } = await import('../web/js/pirate-tavern.js');
const { prepareRoom } = await import('../web/js/interior.js');
await prepareRoom('piratetavern');
delete globalThis.document;
globalThis.fetch = realFetch;
console.warn = realWarn;

const FLOOR = 0.06;
const SRC = new URL('../web/js/hearth-fire.js', import.meta.url);

// shell.py hearth(): the firebox back at HALL.x0 - 0.4, the jambs' face at HEARTH.x + 0.35, the
// opening 0.42 either side of HEARTH.z, its arch's crown at F + 0.87.
const BACK = K.HALL.x0 - 0.4, FRONT = K.HEARTH.x + 0.35, OPEN = 0.42, CROWN = K.F + 0.87;

test('the flame stands in the firebox, under its arch', () => {
  const f = K.HEARTH_FIRE;
  const half = f.w / 2;
  assert.ok(f.x - half > BACK, 'clear of the firebox back');
  assert.ok(f.x + half <= FRONT, 'inside the jambs\' face');
  assert.ok(Math.abs(f.z - K.HEARTH.z) + half < OPEN, 'inside the opening');
  // The shader draws the flame to a point at 0.9 of the box: the tips may go up the chimney behind
  // the hood, but never over the arch, where they would show above the opening.
  assert.ok(f.y + f.h * 0.9 < CROWN, 'its tips under the arch\'s crown');
  for (const [i, b] of f.bed.entries()) assert.ok(b > 0 && b <= (i ? OPEN : f.w), 'a bed of embers inside the opening');
});

test('the room burns it, and keeps the tavern\'s seven lamps', () => {
  stub();
  const def = buildPirateTavern({ FLOOR, rect: (x, z, hx, hz) => ({ x, z, hx, hz }) });
  delete globalThis.document;
  assert.deepEqual(def.flame.at, [K.HEARTH_FIRE.x, K.HEARTH_FIRE.y, K.HEARTH_FIRE.z]);
  assert.equal(def.fireAt, undefined, 'not the tavern\'s cones as well');
  assert.equal(def.lights.length, 7);
  const hearth = def.lights.filter((l) => l.hearth);
  assert.equal(hearth.length, 1, 'one lamp breathes with the fire');
  assert.ok(hearth[0].flicker);
});

test('a fire is its numbers: the same everywhere, and it cleans up after itself', () => {
  const a = createHearthFire({ at: [K.HEARTH_FIRE.x, K.HEARTH_FIRE.y, K.HEARTH_FIRE.z], w: K.HEARTH_FIRE.w, h: K.HEARTH_FIRE.h, bed: K.HEARTH_FIRE.bed });
  const b = createHearthFire({ at: [K.HEARTH_FIRE.x, K.HEARTH_FIRE.y, K.HEARTH_FIRE.z], w: K.HEARTH_FIRE.w, h: K.HEARTH_FIRE.h, bed: K.HEARTH_FIRE.bed });
  const seeds = (f) => {
    let out = null;
    f.object.traverse((o) => { if (o.isPoints && o.geometry.attributes.aSeed) out = Array.from(o.geometry.attributes.aSeed.array); });
    return out;
  };
  assert.deepEqual(seeds(a), seeds(b), 'the sparks are where the fire stands, not where chance put them');
  for (let t = 0; t < 30; t += 0.37) {
    const v = a.flicker(t);
    assert.ok(v >= 0.7 && v <= 1.0, `the lamp stays between 0.7 and 1 of itself (${v} at ${t})`);
    assert.equal(v, b.flicker(t));
  }
  assert.equal(fireFlicker(1.5, 0), fireFlicker(1.5, 0));
  a.update(2.5);
  a.dispose();
  b.dispose();
  const src = fs.readFileSync(SRC, 'utf8');
  assert.doesNotMatch(src, /Math\.random/, 'no chance in it');
  // The flame is a port of mattatz's MIT original; the GPL modification it was found as is not in it.
  assert.match(src, /The MIT License \(MIT\) - Copyright \(c\) 2015 mattatz/);
  assert.doesNotMatch(src, /SPDX-License-Identifier: GPL/);
});

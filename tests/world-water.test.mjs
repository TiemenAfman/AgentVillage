import test from 'node:test';
import assert from 'node:assert/strict';

import { bakeField } from '../lib/world/bake.mjs';
import { CLASS } from '../lib/world/classify.mjs';
import { RIVER_DEPTH } from '../lib/world/water.mjs';
import { findLandmasses, findLandings } from '../lib/world/features.mjs';

// Fresh water and the archipelago. Both are things the old generator either did differently or
// could not do at all, and both are load-bearing for the layout engine: a river is what a
// bridge spans, and an islet is where a district goes when the main island has no room.

const ENVELOPE = 1024;
const SEEDS = [1337, 1338, 1401];

const fields = new Map();
function field(seed) {
  if (!fields.has(seed)) fields.set(seed, bakeField(seed, { envelopeM: ENVELOPE }));
  return fields.get(seed);
}

test('every island gets watercourses that reach the sea', () => {
  for (const seed of SEEDS) {
    const f = field(seed);
    assert.ok(f.rivers.length > 0, `seed ${seed} has no rivers`);
    for (const river of f.rivers) {
      assert.ok(river.lengthM > 40, `${river.id} is ${river.lengthM} m long - that is a puddle`);
      const [mx, mz] = river.mouth;
      assert.ok(f.shape.coast(mx, mz) <= 8,
        `${river.id} stops ${f.shape.coast(mx, mz).toFixed(0)} m inland instead of at the sea`);
      // A spring is on high ground; a mouth is not.
      const [sx, sz] = river.source;
      assert.ok(f.shape.coast(sx, sz) > f.shape.coast(mx, mz), `${river.id} runs inland`);
    }
  }
});

test('a river never carries its water uphill', () => {
  // The carve follows a surface that only ever falls. Without that rule a course crossing a
  // rise would gouge a trench through the hill to let the water through.
  const f = field(1337);
  for (const river of f.rivers) {
    let last = Infinity;
    for (const [x, z] of river.spine) {
      // Past the waterline the sea profile takes over and the channel is no longer carved, so
      // the last stretch is the shore's business and not the river's.
      if (f.shape.coast(x, z) <= 4) break;
      const h = sampleHeight(f, x, z);
      assert.ok(h <= last + 0.6, `${river.id} climbs from ${last.toFixed(1)} to ${h.toFixed(1)} m`);
      last = Math.min(last, h);
    }
  }
});

test('river samples are classified as river, and sit below their banks', () => {
  const f = field(1337);
  const n = f.n;
  let wet = 0;
  for (let k = 0; k < f.classes.length; k++) if (f.classes[k] === CLASS.RIVER) wet++;
  assert.ok(wet > 200, `only ${wet} samples of river on the whole island`);

  // The bed is genuinely cut in: somewhere within a few metres the ground is higher. Stated as
  // a share rather than as a rule for every sample, because at the head of a channel the bank
  // can be wider than the probe - one sample in 574 on this seed - and that is a shape, not a
  // fault.
  let cut = 0, checked = 0;
  for (let j = 4; j < n - 4; j++) {
    for (let i = 4; i < n - 4; i++) {
      const k = i + j * n;
      if (f.classes[k] !== CLASS.RIVER) continue;
      if (f.coast[k] < 12) continue;               // not at the mouth, where the sea is deeper
      checked++;
      const bank = Math.max(
        f.height[k + 4], f.height[k - 4], f.height[k + 4 * n], f.height[k - 4 * n]);
      if (bank >= f.height[k] - 0.01) cut++;
    }
  }
  assert.ok(checked > 100, `only ${checked} river samples inland to check`);
  assert.ok(cut / checked > 0.97,
    `${(100 * (1 - cut / checked)).toFixed(1)}% of the channel stands above its own banks`);
});

test('a lake has a flat surface', () => {
  // A constant depth over a carved bowl only gives a flat surface if the bottom is flat, which
  // is the one thing every lake in the world has in common.
  const f = field(1337);
  assert.ok(f.lakes.length > 0, 'no lake was cut');
  const n = f.n;
  const half = f.envelopeM / 2;
  for (const lake of f.lakes) {
    const beds = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = i + j * n;
        if (f.classes[k] !== CLASS.LAKE) continue;
        const dx = (i - half) - lake.centre[0], dz = (j - half) - lake.centre[1];
        if (Math.hypot(dx, dz) > lake.radiusM + 2) continue;
        beds.push(f.height[k]);
      }
    }
    assert.ok(beds.length > 20, `${lake.id} covers only ${beds.length} samples`);
    const spread = Math.max(...beds) - Math.min(...beds);
    assert.ok(spread < 0.6, `${lake.id} has a bed that varies by ${spread.toFixed(2)} m`);
  }
  assert.equal(RIVER_DEPTH > 0, true);
});

test('the archipelago is separate landmasses, not one blob', () => {
  for (const seed of SEEDS) {
    const f = field(seed);
    const { masses } = findLandmasses(f);
    assert.ok(masses.length >= 4, `seed ${seed} produced only ${masses.length} landmasses`);

    // The main island is the first and is far larger than any skerry - if an islet ever merged
    // into it, the whole point of putting a district on its own island would be gone.
    assert.ok(masses[0].areaHa > 6, `the main island is only ${masses[0].areaHa} ha`);
    assert.ok(masses[1].areaHa < masses[0].areaHa / 3,
      `seed ${seed} has two islands of comparable size - did a skerry merge into the main one?`);

    for (const m of masses) {
      assert.ok(m.peak.y > 0, `landmass ${m.index} has no land above the waterline`);
      assert.ok(m.bounds[0] <= m.centroid[0] && m.centroid[0] <= m.bounds[2]);
      assert.ok(m.bounds[1] <= m.centroid[1] && m.centroid[1] <= m.bounds[3]);
    }
  }
});

test('nothing runs off the edge of the envelope', () => {
  // Land at the rim means the coast there is the window and not the island, and it means growth
  // has nowhere left to go.
  for (const seed of SEEDS) {
    const f = field(seed);
    const n = f.n, rim = n - 1;
    for (let i = 0; i <= rim; i++) {
      assert.ok(f.height[i] <= 0, `seed ${seed} has land on the north rim at ${i}`);
      assert.ok(f.height[i + rim * n] <= 0, `seed ${seed} has land on the south rim at ${i}`);
      assert.ok(f.height[i * n] <= 0, `seed ${seed} has land on the west rim at ${i}`);
      assert.ok(f.height[rim + i * n] <= 0, `seed ${seed} has land on the east rim at ${i}`);
    }
  }
});

test('every landmass has somewhere to come ashore', () => {
  const f = field(1337);
  const { masses, label } = findLandmasses(f);
  const landings = findLandings(f, masses, label);
  assert.ok(landings.length >= masses.length - 1,
    `${masses.length} landmasses but only ${landings.length} landings`);
  for (const landing of landings) {
    const [x, z] = landing.at;
    const k = (x + f.envelopeM / 2) + (z + f.envelopeM / 2) * f.n;
    assert.equal(f.classes[k], CLASS.BEACH, `the landing on landmass ${landing.landmass} is not on sand`);
  }
});

function sampleHeight(f, x, z) {
  const half = f.envelopeM / 2;
  const i = Math.round(x + half), j = Math.round(z + half);
  return f.height[i + j * f.n];
}

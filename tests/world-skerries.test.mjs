import test from 'node:test';
import assert from 'node:assert/strict';

import { bakeField } from '../lib/world/bake.mjs';

// The island has to be the same island whichever window it is baked in.
//
// `islandStats` bakes at 640 m to measure and tune; `publishWorld` bakes at 1024 m to ship.
// Nothing about the main island depends on how much sea is in shot - except that it did. Pass 2
// was shaping every shore off `coast`, the union of the island with the skerries: where an islet
// landed against the island's flank the union read tens of metres inland at a sample a step from
// the main island's own waterline, and that sample baked as massif. Anything that moves the
// islets - and where they sit has depended on the envelope - then moved that band with it, so
// the island that got measured was not the island that got published. Pass 2 now shapes the main
// island off `mainCoast`, which knows nothing of the skerries, and these pin that down.

const TUNING = 640;               // what islandStats measures
const PUBLISH = 1024;             // what publishWorld writes out
// 1401 is one of the seeds `world-generator` already uses, and it lays an islet against the
// island's flank at the tuning envelope - which is the case that brought this to light. If a
// change to the skerry layout moves that islet clear, these still hold; they just guard less,
// so pick a seed that still crowds the shore.
const SEED = 1401;

// Everything the shore profile does inside its own beach: `relief.height` lerps to 1.6 m over
// the beach and the massif has barely started this close in. Whatever else happens to a sample
// afterwards only lowers it - the water carve cuts down and the gradient cap shaves the higher
// of a pair - so this is a ceiling on the finished grid, not just on pass 2.
const SHORE_M = 4;                // metres inland of the main island's own waterline
const BEACH_MAX_Y = 2;            // metres: a beach, not a hillside

const fields = new Map();
test.before(() => {
  for (const envelopeM of [TUNING, PUBLISH]) fields.set(envelopeM, bakeField(SEED, { envelopeM }));
});

/** Walk the samples the main island owns, in world metres, in whichever window. */
function* mainIsland(field) {
  const half = field.envelopeM / 2;
  const reach = Math.min(half, 320);
  for (let z = -reach; z < reach; z++) {
    for (let x = -reach; x < reach; x++) {
      if (field.shape.mainCoast(x, z) <= 0) continue;
      yield [x, z, (x + half) + (z + half) * field.n];
    }
  }
}

test('the shore bakes as a beach, not as the islet lying against it', () => {
  for (const envelopeM of [TUNING, PUBLISH]) {
    const field = fields.get(envelopeM);
    let worst = -Infinity, wx = 0, wz = 0;
    for (const [x, z, k] of mainIsland(field)) {
      const d = field.shape.mainCoast(x, z);
      if (d > SHORE_M) continue;
      if (field.height[k] > worst) { worst = field.height[k]; wx = x; wz = z; }
    }
    assert.ok(worst <= BEACH_MAX_Y,
      `at ${envelopeM} m the ground ${SHORE_M} m inland of the waterline reaches ${worst.toFixed(2)} m `
      + `at ${wx},${wz} - the shore is being shaped by something that is not this island's coast`);
  }
});

test('a real island bakes the same in both windows', () => {
  const a = fields.get(TUNING), b = fields.get(PUBLISH);

  // Nothing is masked but the islets themselves, and even that is belt and braces.
  //
  // This test was written when two things still differed between the windows: an islet stood
  // somewhere else, because the skerry lattice was laid out over the envelope, and fresh water
  // followed, because `carveWater` routes on the grid and an islet against the shore changes
  // what the grid says. The first of those is gone - `shape.mjs` now places an islet off the
  // main island's own coastline (`reachAlong`), which knows nothing of the envelope - and the
  // second went with it. Measured over seeds 1337, 1401 and promptholm: **zero** samples differ
  // between a 640 m bake and a 1024 m one, rivers and lakes included.
  //
  // So the water mask is gone and the margin is one sample rather than twenty. If either has to
  // come back, something has made the world depend on how much sea is in shot again, and that is
  // what this is here to catch.
  const MARGIN = 1;
  const N = 2 * 320 + 1, off = 320;
  const tainted = new Uint8Array(N * N);
  for (const field of [a, b]) {
    const half = field.envelopeM / 2;
    for (let z = -320; z <= 320; z++) {
      for (let x = -320; x <= 320; x++) {
        const k = (x + half) + (z + half) * field.n;
        const wet = false;             // see the note above: water agrees between windows now
        // Ground an islet owns, and not merely ground an islet is near: a sample the main
        // island owns has to match even with an islet lying a few metres off it, which is the
        // whole point. Float32 from the grid against float64 from the shape, so round the one
        // before comparing, or every sample of a 100 m-deep interior reads as a disagreement.
        const islet = field.coast[k] > 0 && Math.fround(field.shape.mainCoast(x, z)) <= 0;
        if (wet || islet) tainted[(x + off) + (z + off) * N] = 1;
      }
    }
  }
  const masked = new Uint8Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      if (!tainted[x + z * N]) continue;
      for (let dz = -MARGIN; dz <= MARGIN; dz++) {
        for (let dx = -MARGIN; dx <= MARGIN; dx++) {
          if (dx * dx + dz * dz > MARGIN * MARGIN) continue;
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
          masked[nx + nz * N] = 1;
        }
      }
    }
  }

  const halfB = b.envelopeM / 2;
  let compared = 0, worst = 0, wx = 0, wz = 0;
  for (const [x, z, ka] of mainIsland(a)) {
    if (masked[(x + off) + (z + off) * N]) continue;
    compared++;
    const drift = Math.abs(a.height[ka] - b.height[(x + halfB) + (z + halfB) * b.n]);
    if (drift > worst) { worst = drift; wx = x; wz = z; }
  }
  assert.ok(compared > 50000, `only ${compared} samples were left to compare - the mask ate the island`);
  assert.equal(worst, 0,
    `the island drifted by ${worst.toFixed(3)} m at ${wx},${wz} between a ${TUNING} m bake and a ${PUBLISH} m one`);
});

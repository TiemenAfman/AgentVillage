import test from 'node:test';
import assert from 'node:assert/strict';

import { bakeField } from '../lib/world/bake.mjs';
import { makeLotField, METRES_PER_LOT, EARTHWORK_MAX } from '../lib/world/lotfield.mjs';
import { findLandmasses } from '../lib/world/features.mjs';
import { MIN_HAMLET } from '../lib/layout.mjs';

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

// What the archipelago has to be, and the seeds it is measured on. Three, because one seed
// proves nothing about a placement rule: the coastline it walks around is a different length
// and a different shape on every one.
const ARCHIPELAGO = [1337, 4242, SEED];
const WANT_ROCKS = 14;            // baked: sixteen. This is the floor the rule promises.
const MIN_CHANNEL_M = 12;         // narrower than this and a crossing reads as a sandbar

const fields = new Map();
const archipelago = new Map();
test.before(() => {
  for (const envelopeM of [TUNING, PUBLISH]) fields.set(envelopeM, bakeField(SEED, { envelopeM }));
  for (const seed of ARCHIPELAGO) {
    archipelago.set(seed, seed === SEED ? fields.get(PUBLISH) : bakeField(seed, { envelopeM: PUBLISH }));
  }
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

// ---- the archipelago itself --------------------------------------------------------
// Six rocks fitted around the island on a golden-angle fan and fourteen did not: a fan spaces
// them in angle while a rock takes up arc, so at fourteen two of them merged into one landmass
// on seed 1337. The walk in `shape.mjs` replaces it, and these are the four promises it makes.
// Measured rather than eyeballed, and on the lot field rather than on the shape, because the
// lot field is what `lib/layout.mjs` is handed and what a district is actually put on.

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Four-connected landmasses of the lot field - the same fill `linkLandmasses` runs. */
function labelLots(lots) {
  const size = lots.size;
  const label = new Int16Array(size * size).fill(-1);
  const area = [];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (!lots.isLand(i, j) || label[i + j * size] >= 0) continue;
      const id = area.length;
      const q = [[i, j]];
      label[i + j * size] = id;
      let n = 0;
      while (q.length) {
        const [a, b] = q.pop();
        n++;
        for (const [dx, dz] of N4) {
          const x = a + dx, z = b + dz;
          if (x < 0 || z < 0 || x >= size || z >= size) continue;
          if (!lots.isLand(x, z) || label[x + z * size] >= 0) continue;
          label[x + z * size] = id;
          q.push([x, z]);
        }
      }
      area.push(n);
    }
  }
  return { label, area };
}

/** Every rock, with the landmass it turned out to be. */
function rocksOf(field) {
  const lots = makeLotField(field);
  const size = lots.size;
  const { label, area } = labelLots(lots);
  const labelAt = (lx, lz) => (lx >= 0 && lz >= 0 && lx < size && lz < size ? label[lx + lz * size] : -1);
  const main = area.indexOf(Math.max(...area));

  const rocks = [];
  const seen = new Map();
  for (const s of field.shape.skerries) {
    const lx = Math.floor(s.x / METRES_PER_LOT + size / 2), lz = Math.floor(s.z / METRES_PER_LOT + size / 2);
    const id = labelAt(lx, lz);
    rocks.push({ index: s.index, id, ha: id < 0 ? 0 : (area[id] * METRES_PER_LOT * METRES_PER_LOT) / 10000 });
    if (id >= 0) seen.set(id, (seen.get(id) || 0) + 1);
  }
  return { lots, label, labelAt, area, main, rocks, seen };
}

/**
 * How many houses a rock holds, on the least kind of the sixteen positions the super-cell
 * lattice can take. The lattice is anchored on the town square, so which one a village gets is
 * an accident of where the town ended up; asking for the worst is what makes the answer a
 * promise rather than a coincidence. Same test as `Super`'s constructor and `isletGround`
 * together: the 3x3 plot of the block is buildable, level enough to terrace, and all of it on
 * this one rock.
 */
function housesOn(view, id) {
  const { lots, labelAt, label } = view;
  const size = lots.size;
  let worst = Infinity;
  const cells = [];
  for (let lz = 0; lz < size; lz++) {
    for (let lx = 0; lx < size; lx++) if (label[lx + lz * size] === id) cells.push([lx, lz]);
  }
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const blocks = new Set();
      let n = 0;
      for (const [lx, lz] of cells) {
        const bx = Math.floor((lx - px) / 4) * 4 + px, bz = Math.floor((lz - py) / 4) * 4 + py;
        const key = `${bx},${bz}`;
        if (blocks.has(key)) continue;
        blocks.add(key);
        let ok = true;
        for (let z = 0; z < 3 && ok; z++) {
          for (let x = 0; x < 3; x++) {
            if (labelAt(bx + x, bz + z) !== id || !lots.isBuildable(bx + x, bz + z)) { ok = false; break; }
          }
        }
        if (ok && lots.earthwork(bx, bz, 3, 3) <= EARTHWORK_MAX) n++;
      }
      if (n < worst) worst = n;
    }
  }
  return worst;
}

test('every rock comes up as a landmass of its own', () => {
  for (const seed of ARCHIPELAGO) {
    const view = rocksOf(archipelago.get(seed));
    const own = view.rocks.filter((r) => r.id >= 0 && r.id !== view.main && view.seen.get(r.id) === 1);
    assert.ok(own.length >= WANT_ROCKS,
      `seed ${seed}: ${own.length} of ${view.rocks.length} rocks are their own landmass`
      + ` - ${view.rocks.filter((r) => r.id === view.main).length} joined the mainland,`
      + ` ${view.rocks.filter((r) => r.id >= 0 && view.seen.get(r.id) > 1).length} merged with each other`);
  }
});

test('the water between two landmasses is a crossing, not a sandbar', () => {
  // Coast to coast in metres, off the sample grid rather than the lot grid: the lot field only
  // calls a lot land when all sixteen of its samples are, so it flatters every channel by up to
  // eight metres and would hide exactly the failure this is looking for. The mainland is in the
  // comparison as well - a rock a metre off a headland is the same failure as two rocks a metre
  // apart, and the lot grid pulled them apart into separate landmasses either way.
  for (const seed of ARCHIPELAGO) {
    const field = archipelago.get(seed);
    const half = field.envelopeM / 2;
    const { masses, label } = findLandmasses(field);
    const named = new Set(masses.map((m) => m.id));

    const rim = new Map();
    for (let j = 1; j < field.n - 1; j++) {
      for (let i = 1; i < field.n - 1; i++) {
        const k = i + j * field.n;
        const id = label[k];
        if (id < 0 || !named.has(id)) continue;
        if (label[k - 1] >= 0 && label[k + 1] >= 0
          && label[k - field.n] >= 0 && label[k + field.n] >= 0) continue;
        if (!rim.has(id)) rim.set(id, []);
        rim.get(id).push([i - half, j - half]);
      }
    }

    const ids = [...rim.keys()];
    let worst = Infinity, who = null;
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        for (const p of rim.get(ids[a])) {
          for (const q of rim.get(ids[b])) {
            const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
            if (d < worst) { worst = d; who = [ids[a], ids[b]]; }
          }
        }
      }
    }
    assert.ok(Math.sqrt(worst) >= MIN_CHANNEL_M,
      `seed ${seed}: landmasses ${who} are ${Math.sqrt(worst).toFixed(1)} m apart`);
  }
});

test('a rock holds a hamlet wherever the lattice falls, and a few hold a village', () => {
  // The rule that decides whether a rock is worth having at all: `lib/layout.mjs` gives a
  // district a rock only if the district *fits* on it, one super-cell per house, so a rock
  // that holds two houses is scenery. Sizes have to spread as well - sixteen rocks of one
  // size is a string of beads, not an archipelago.
  for (const seed of ARCHIPELAGO) {
    const view = rocksOf(archipelago.get(seed));
    const own = view.rocks.filter((r) => r.id >= 0 && r.id !== view.main && view.seen.get(r.id) === 1);
    const houses = own.map((r) => housesOn(view, r.id)).sort((a, b) => a - b);
    const has = own.map((r) => r.ha).sort((a, b) => a - b);

    assert.ok(houses.filter((h) => h >= MIN_HAMLET).length >= WANT_ROCKS,
      `seed ${seed}: only ${houses.filter((h) => h >= MIN_HAMLET).length} rocks hold ${MIN_HAMLET} houses `
      + `(${houses.join(',')})`);
    assert.ok(houses.filter((h) => h >= 8).length >= 3,
      `seed ${seed}: no room for a proper hamlet anywhere - the best rocks hold ${houses.slice(-3)}`);
    assert.ok(has[0] >= 0.40 && has[has.length - 1] >= 0.90,
      `seed ${seed}: rocks run ${has[0].toFixed(2)} to ${has[has.length - 1].toFixed(2)} ha`);
  }
});

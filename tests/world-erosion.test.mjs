import test from 'node:test';
import assert from 'node:assert/strict';

import { bakeField } from '../lib/world/bake.mjs';
import { erodeField, WEATHERING, SHORE_GUARD_M } from '../lib/world/erode.mjs';
import { BENCH, H_MAX } from '../lib/world/relief.mjs';
import { islandStats } from '../lib/world/stats.mjs';

// Hydraulic erosion. The pass is a simulation, so almost nothing about it can be asserted
// exactly - what can be asserted is that it only ever *moves* material, that it moves it in the
// direction gravity would, and that it leaves the three things the rest of the generator has
// already promised alone: the coastline, the summit, and the benches.
//
// The invariants are checked on a synthetic cone rather than on a real island. A cone is small
// enough to bake in milliseconds and, more to the point, an assertion that fails on one says
// which rule was broken instead of saying that seed 1338 changed.

const SEEDS = [1337, 1338, 1401];

const fields = new Map();
function field(seed, erosion = WEATHERING) {
  const key = `${seed}:${erosion}`;
  if (!fields.has(key)) fields.set(key, bakeField(seed, { envelopeM: 640, erosion }));
  return fields.get(key);
}

/** A cone island 40 m across on a 128 m grid, rippled so the droplets have something to follow. */
function cone({ radiusM = 40, envelopeM = 128, peak = 20 } = {}) {
  const n = envelopeM + 1;
  const half = envelopeM / 2;
  const height = new Float32Array(n * n);
  const coast = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i - half, z = j - half;
      const d = Math.hypot(x, z);
      const k = i + j * n;
      coast[k] = radiusM - d;
      height[k] = d < radiusM
        ? (1 - d / radiusM) * peak + 1.5 * Math.sin(x * 0.7) * Math.cos(z * 0.9)
        : -(d - radiusM) * 0.2;
    }
  }
  const shape = { radiusM, mainCoast: (x, z) => radiusM - Math.hypot(x, z) };
  return { grid: { height, coast, n, envelopeM, metresPerSample: 1 }, shape };
}

test('erosion only ever moves material, it never makes any', () => {
  // The whole pass has to be a redistribution. A droplet that could add material would let the
  // island grow, and the island is the one thing in this generator that is not allowed to move
  // once somebody has built on it.
  const { grid, shape } = cone();
  const before = grid.height.slice();
  const stats = erodeField(grid, 1337, { shape, strength: 1 });

  assert.ok(stats.droplets > 100, `only ${stats.droplets} droplets fell on the cone`);
  assert.ok(stats.netM3 <= 0, `the cone gained ${stats.netM3.toFixed(1)} m3 of itself`);
  assert.ok(stats.lostM3 >= 0);

  let volumeBefore = 0, volumeAfter = 0;
  for (let k = 0; k < before.length; k++) {
    volumeBefore += Math.max(0, before[k]);
    volumeAfter += Math.max(0, grid.height[k]);
  }
  assert.ok(volumeAfter <= volumeBefore + 1e-3,
    `the cone grew from ${volumeBefore.toFixed(0)} to ${volumeAfter.toFixed(0)} m3`);
});

test('no sample ends up higher than the island already stood', () => {
  // Sediment has to come to rest somewhere, and a droplet that dropped its load on the summit
  // would raise it. A new peak is material out of nowhere however the books balance.
  const { grid, shape } = cone();
  const ceiling = grid.height.reduce((a, b) => Math.max(a, b), -Infinity);
  erodeField(grid, 1337, { shape, strength: 1 });
  for (let k = 0; k < grid.height.length; k++) {
    assert.ok(grid.height[k] <= ceiling + 1e-4,
      `sample ${k} stands at ${grid.height[k].toFixed(2)} m over a ceiling of ${ceiling.toFixed(2)} m`);
  }
});

test('the sea and the shore band come back untouched', () => {
  // Erosion must not push land out past the coastline, and it must not gouge the beach: the
  // beach profile is built from the swell exposure and it is where everyone comes ashore.
  const { grid, shape } = cone();
  const before = grid.height.slice();
  erodeField(grid, 1337, { shape, strength: 1 });
  for (let k = 0; k < before.length; k++) {
    if (grid.coast[k] > SHORE_GUARD_M) continue;
    assert.equal(grid.height[k], before[k],
      `a sample ${grid.coast[k].toFixed(1)} m from the waterline moved by ${(grid.height[k] - before[k]).toFixed(3)} m`);
  }
});

test('material ends up lower than it started', () => {
  // The direction of the whole pass, and the one thing that separates erosion from a blur: the
  // ground that loses material stands higher than the ground that gains it. Stated as the two
  // averages rather than sample by sample, because a droplet sim is allowed to do anything at
  // all in one place. On a cone in particular the skirt loses too - everything drains straight
  // off the edge and there is no valley for it to fill - so "the top loses, the foot gains" is
  // not the claim; "what is taken lands lower" is.
  const { grid, shape } = cone();
  const before = grid.height.slice();
  erodeField(grid, 1337, { shape, strength: 1 });

  let cutSum = 0, cutAt = 0, fillSum = 0, fillAt = 0;
  for (let k = 0; k < before.length; k++) {
    if (grid.coast[k] <= SHORE_GUARD_M) continue;
    const d = grid.height[k] - before[k];
    if (d < 0) { cutSum -= d; cutAt -= d * before[k]; }
    else if (d > 0) { fillSum += d; fillAt += d * before[k]; }
  }
  assert.ok(cutSum > 0 && fillSum > 0, 'the pass either only cut or only filled');
  const cutHeight = cutAt / cutSum, fillHeight = fillAt / fillSum;
  assert.ok(fillHeight < cutHeight,
    `material came off ground at ${cutHeight.toFixed(1)} m and landed at ${fillHeight.toFixed(1)} m`);
});

test('the same seed weathers the same way, every time', () => {
  // The rule the whole generator rests on. Erosion draws fifty thousand droplet positions from
  // an rng, so it is the pass most able to break it.
  const { grid: a, shape } = cone();
  const { grid: b } = cone();
  erodeField(a, 1337, { shape });
  erodeField(b, 1337, { shape });
  for (let k = 0; k < a.height.length; k++) {
    assert.equal(b.height[k], a.height[k], `sample ${k} differs between two runs of one seed`);
  }
});

test('the window the island is baked in does not change how it weathers', () => {
  // Same island, same droplets, two grid sizes. A pass that read the grid's `coast` would find
  // the skerries, which are placed on a lattice over the *envelope*, so it would weather one
  // island at 640 m and a different one at 1024 m - and `islandStats` bakes at 640 while
  // `publishWorld` bakes at 1024. The mask comes from `mainCoast`, which is a function of the
  // seed and the radius alone, so the two runs have to agree sample for sample.
  const small = cone({ envelopeM: 128 });
  const large = cone({ envelopeM: 192 });
  const a = erodeField(small.grid, 1337, { shape: small.shape });
  const b = erodeField(large.grid, 1337, { shape: large.shape });
  assert.equal(b.spawnSamples, a.spawnSamples);
  assert.equal(b.droplets, a.droplets);
  assert.equal(b.touched, a.touched);
  assert.equal(b.netM3, a.netM3);

  const offset = (192 - 128) / 2;
  for (let j = 0; j < small.grid.n; j++) {
    for (let i = 0; i < small.grid.n; i++) {
      assert.equal(
        large.grid.height[(i + offset) + (j + offset) * large.grid.n],
        small.grid.height[i + j * small.grid.n],
        `the two windows disagree at ${i},${j}`);
    }
  }
});

test('a real island weathers the same in both windows, give or take the skerries', () => {
  // The same claim on a real bake, and it holds structurally: the same ground is found, the same
  // droplets fall on it, the same number of samples move. The volume does not match to the last
  // cubic metre, and the reason is not erosion. Pass 2 feeds `relief.height` the grid's `coast`,
  // which is the union with the skerries - so where a skerry drifts close to the island's flank
  // it makes coastal samples read as tens of metres inland and they are baked as massif instead
  // of as beach. Measured on seed 1337: 880 of 78545 main-island samples, up to 27 m out. The
  // island the stats describe is therefore already not quite the island that gets published, in
  // a band along one flank, and that predates this pass.
  for (const seed of [1337, 1401]) {
    const small = bakeField(seed, { envelopeM: 640 }).erosion;
    const large = bakeField(seed, { envelopeM: 1024 }).erosion;
    // Exact, because these come from the mask and the mask is `mainCoast` alone.
    assert.equal(large.spawnSamples, small.spawnSamples, `seed ${seed} finds different ground to weather`);
    assert.equal(large.droplets, small.droplets);
    // Approximate, because these come from the heightfield the mask was laid over.
    for (const [what, a, b] of [['samples', small.touched, large.touched], ['volume', small.netM3, large.netM3]]) {
      const drift = Math.abs(b - a) / Math.abs(a);
      assert.ok(drift < 0.08, `seed ${seed} weathers ${(100 * drift).toFixed(1)}% more ${what} in one window than the other`);
    }
  }
});

test('turning the weathering off leaves the relief exactly as it was', () => {
  // `erosion: 0` has to be a true bypass and not a very weak pass, or the "before" half of every
  // comparison is itself eroded and the comparison says nothing.
  const { grid, shape } = cone();
  const before = grid.height.slice();
  const stats = erodeField(grid, 1337, { shape, strength: 0 });
  assert.equal(stats.droplets, 0);
  for (let k = 0; k < before.length; k++) assert.equal(grid.height[k], before[k]);
});

test('the weathering dial is linear in the displacement it keeps', () => {
  // `strength` blends the two heightfields rather than scaling the rates inside the simulation.
  // That is the only reason it is predictable: turning the rates down barely moves the result,
  // because the landscape a droplet sim converges on is a property of the sim and not of how
  // hard it is run.
  const full = cone(), part = cone();
  const before = full.grid.height.slice();
  erodeField(full.grid, 1337, { shape: full.shape, strength: 1 });
  erodeField(part.grid, 1337, { shape: part.shape, strength: 0.5 });
  for (let k = 0; k < before.length; k++) {
    const want = before[k] + (full.grid.height[k] - before[k]) * 0.5;
    assert.ok(Math.abs(part.grid.height[k] - want) < 1e-3,
      `half strength gave ${part.grid.height[k].toFixed(3)} where the blend says ${want.toFixed(3)}`);
  }
});

test('the island keeps its benches', () => {
  // The two passes most likely to fight: terracing quantises heights onto 7.5 m steps and
  // erosion is a low-pass filter with a three-metre brush. Measured, they do not - the share of
  // the island sitting on a bench top barely moves, because the droplets round the *edges* of a
  // bench and fill its top rather than cutting through it. If this ever drifts, terracing and
  // erosion have started arguing and one of them has to give.
  for (const seed of SEEDS) {
    const onBench = (f) => {
      let on = 0, land = 0;
      for (let k = 0; k < f.height.length; k++) {
        if (f.coast[k] <= 0 || f.height[k] < BENCH * 0.5) continue;
        land++;
        const q = f.height[k] / BENCH;
        if (Math.abs(q - Math.round(q)) * BENCH < 1.0) on++;
      }
      return 100 * on / land;
    };
    const raw = onBench(field(seed, 0));
    const weathered = onBench(field(seed));
    assert.ok(weathered > raw - 4,
      `seed ${seed}: ${raw.toFixed(1)}% of the island was on a bench and only ${weathered.toFixed(1)}% still is`);
  }
});

test('erosion relieves the gradient cap instead of fighting it', () => {
  // The failure everyone expects from an erosion pass: it steepens everything, the 45-degree cap
  // shaves it all back off, and the bake has done twice the work for nothing. The opposite
  // happens here. Droplets undercut a bench face and pile the spoil at its foot, so the face
  // arrives at the cap already inside the limit and the cap has less than half as much to do.
  for (const seed of SEEDS) {
    const raw = field(seed, 0).cappedSamples;
    const weathered = field(seed).cappedSamples;
    assert.ok(weathered < raw,
      `seed ${seed}: the cap made ${weathered} corrections after erosion against ${raw} before it`);
  }
});

test('a weathered island is still an island', () => {
  // The shares that say the mix has not run away. Erosion genuinely moves them - it trades bare
  // rock for meadow, because a drainage landscape is gentler than fractal noise - so these are
  // looser than the raw generator's own limits, and deliberately not the same numbers.
  for (const seed of SEEDS) {
    const st = islandStats(seed, { envelopeM: 640 });
    const bare = (st.classes.ROCK || 0) + (st.classes.SCREE || 0);
    const green = (st.classes.MEADOW || 0) + (st.classes.WOOD || 0);
    assert.ok(st.maxHeight > 18 && st.maxHeight <= H_MAX,
      `seed ${seed} tops out at ${st.maxHeight.toFixed(1)} m`);
    assert.ok(green < 70, `seed ${seed} is ${green.toFixed(0)}% meadow and wood - erosion has flattened it`);
    assert.ok(bare > 8, `seed ${seed} has only ${bare.toFixed(0)}% bare ground left`);
    assert.ok(st.slope.p50 > 0.15, `seed ${seed} has a slope median of ${st.slope.p50.toFixed(2)} - that is a table`);
    assert.ok(st.rivers > 0 && st.lakes > 0,
      `seed ${seed} lost its fresh water to erosion: ${st.rivers} rivers, ${st.lakes} lakes`);
  }
});

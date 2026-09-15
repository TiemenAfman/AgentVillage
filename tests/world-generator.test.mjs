import test from 'node:test';
import assert from 'node:assert/strict';

import { makeShape } from '../lib/world/shape.mjs';
import { makeRelief, H_MAX } from '../lib/world/relief.mjs';
import { makeClassifier, CLASS } from '../lib/world/classify.mjs';
import { islandStats } from '../lib/world/stats.mjs';
import { smoothMin } from '../lib/world/noise.mjs';

// The generator runs once per island and its output is written to disk, so what has to be
// stable is not the function but the numbers it produced. These tests pin the properties the
// rest of the system leans on: the same seed gives the same island, every seed gives an island
// of the same *size* (the layout engine needs a predictable capacity), and nothing anywhere
// comes back NaN.

const SEEDS = [1337, 1338, 1401, 90210];

test('the same seed gives the same island', () => {
  for (const seed of SEEDS.slice(0, 2)) {
    const a = makeRelief(seed, makeShape(seed));
    const b = makeRelief(seed, makeShape(seed));
    for (let z = -200; z <= 200; z += 37) {
      for (let x = -200; x <= 200; x += 41) {
        assert.equal(b.height(x, z), a.height(x, z), `height differs at ${x},${z}`);
      }
    }
  }
});

test('different seeds give different islands', () => {
  const a = makeRelief(SEEDS[0], makeShape(SEEDS[0]));
  const b = makeRelief(SEEDS[1], makeShape(SEEDS[1]));
  let same = 0, n = 0;
  for (let z = -200; z <= 200; z += 17) {
    for (let x = -200; x <= 200; x += 19) {
      n++;
      if (Math.abs(a.height(x, z) - b.height(x, z)) < 0.01) same++;
    }
  }
  assert.ok(same / n < 0.25, `two seeds agree on ${Math.round((100 * same) / n)}% of samples`);
});

test('every seed produces an island of the same size', () => {
  // The silhouette is free to vary - that is the whole point - but the area is not. A seed
  // that decides how many settlers fit would make the island a lottery.
  const areas = SEEDS.map((s) => islandStats(s, { step: 4 }).landHa);
  const min = Math.min(...areas), max = Math.max(...areas);
  assert.ok(max / min < 1.06, `land area varies ${(max / min).toFixed(2)}x across seeds: ${areas.map((a) => a.toFixed(1))}`);
  assert.ok(min > 6 && max < 12, `expected roughly 8 ha per island, got ${areas.map((a) => a.toFixed(1))}`);
});

test('but not an island of the same shape', () => {
  const shapes = SEEDS.map((s) => islandStats(s, { step: 4 }).extent);
  const ratios = shapes.map(([w, h]) => w / h);
  const spread = Math.max(...ratios) / Math.min(...ratios);
  assert.ok(spread > 1.3, `every island has the same proportions (spread ${spread.toFixed(2)})`);
});

test('nothing comes back NaN, anywhere, including far out to sea', () => {
  const shape = makeShape(1337);
  const relief = makeRelief(1337, shape);
  const classifier = makeClassifier(1337, shape, relief);
  for (let z = -900; z <= 900; z += 73) {
    for (let x = -900; x <= 900; x += 79) {
      const d = shape.coast(x, z);
      const h = relief.height(x, z);
      assert.ok(Number.isFinite(d), `coast is ${d} at ${x},${z}`);
      assert.ok(Number.isFinite(h), `height is ${h} at ${x},${z}`);
      assert.ok(Number.isInteger(classifier.classify(x, z, h, d)), `class is not a byte at ${x},${z}`);
    }
  }
});

test('the island stays under its ceiling and the sea stays under water', () => {
  for (const seed of SEEDS) {
    const stats = islandStats(seed, { step: 4 });
    assert.ok(stats.maxHeight <= H_MAX, `seed ${seed} reaches ${stats.maxHeight.toFixed(1)} m, over the ${H_MAX} m ceiling`);
    assert.ok(stats.maxHeight > 18, `seed ${seed} tops out at ${stats.maxHeight.toFixed(1)} m - that is a pancake`);
  }

  const shape = makeShape(1337);
  const relief = makeRelief(1337, shape);
  for (let z = -600; z <= 600; z += 31) {
    for (let x = -600; x <= 600; x += 37) {
      if (shape.coast(x, z) > 0) continue;
      assert.ok(relief.height(x, z) <= 0.001, `the sea stands at ${relief.height(x, z).toFixed(2)} m at ${x},${z}`);
    }
  }
});

test('the island is made of land, not of rock and beach', () => {
  // The first tuning pass produced an island that was a quarter beach and a third bare rock,
  // and it looked it. These are the shares that say the mix is still an island.
  for (const seed of SEEDS) {
    const { classes } = islandStats(seed, { step: 3 });
    const green = (classes.MEADOW || 0) + (classes.WOOD || 0);
    const bare = (classes.ROCK || 0) + (classes.SCREE || 0);
    assert.ok(green > 35, `seed ${seed} is only ${green.toFixed(0)}% meadow and wood`);
    assert.ok(bare < 32, `seed ${seed} is ${bare.toFixed(0)}% bare rock`);
    assert.ok((classes.BEACH || 0) < 26, `seed ${seed} is ${(classes.BEACH || 0).toFixed(0)}% beach`);
  }
});

test('smooth-min is exactly min once the shapes are apart', () => {
  // The polynomial form was chosen over the exponential one for this: the exponential smin
  // subtracts k*ln(2) even where two lobes are nowhere near each other, which silently
  // inflates every island.
  assert.equal(smoothMin(10, 40, 12), 10);
  assert.equal(smoothMin(-20, 30, 12), -20);
  assert.ok(smoothMin(10, 10, 12) < 10, 'and it does blend where they overlap');
});

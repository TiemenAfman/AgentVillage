// A growth ring must not cut water off from the sea, and the layout's own earthworks leave a
// coast rather than a wall (Plans/quay-en-rivier.md, fase 1 and "Kust netjes dichtmaken").
//
// Measured on the live island (seed 1337, one ring of r 156): seven ponds of 247 cells inside
// the new coast, and the dredged fairway - the river's way out - closed by a two-cell spit. And
// every edge that was dug or filled by a stamp per cell jumped from sea to meadow in one cell.
// What is held here:
//
//   A step drawn with `water: 1` keeps the channel's mouth open and fills the ponds it would
//   shut in - decided when the step is taken (`settle`, written on the step as `lane` and
//   `ponds`) and drawn with the profiles, so a step depends on nothing but itself.
//   An island whose step was drawn before that cannot change - its ground is in its hash - so
//   `repairFairway` and `fillRingPonds` mend it in `layout.works`, with the hash put on record.
//   A step without `water`, and a layout without `works`, draw exactly the ground they always
//   drew, or every grown island's recorded hash would be wrong.
//   Anything this code does not know in a step or in `works` is refused, not drawn as nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeTerrain, gridForCoast, WATER_VERSION, WORKS_VERSION, BEACH_MAX, CHANNEL_H, SEA_LEVEL,
  profileDig, profileKeep, profileFill, workProfile, cornerDistance2,
} from '../shared/terrain.mjs';
import {
  placeAll, emptyLayout, nextCoast, growStep, growCanvas, planFairway, fairwayReaches, repairFairway, fillRingPonds, FAIRWAY_AT,
} from '../lib/layout.mjs';
import { village, clone, stands, movedBetween } from './support/village.mjs';
import { waterBodies, fairwayOpen, pondCount, enclosedCells } from './support/water-bodies.mjs';
import { HOOGEZAND } from './support/hoogezand-ground.mjs';

const SEEDS = [1337, 7, 3, 'harbour', 'Hoogezand', 90210];
const stepOf = (r, grid, { relief = 1, water = 0, hold = [] } = {}) => ({
  r, grid, hold, ...(relief ? { relief } : {}), ...(water ? { water } : {}),
});
// A step of `water: 1` taken the way growStep takes it: its lanes and ponds decided on the ground
// as drawn (`settle`), then written on it.
function take(seed, size, base, steps, step, channel = [], opts = {}) {
  const all = [...steps, step];
  const T = makeTerrain(seed, { size, ...opts, grow: { base, steps: all }, settle: { index: all.length - 1, channel } });
  return { ...step, lane: T.settled.lane, ponds: T.settled.ponds };
}

// ---- the ground that already exists does not change --------------------------------------
// Recorded on the code that drew every grown island there is (HEAD before `water` existed).
// A change here is every one of those islands re-planned from nothing on its next scan.
test('a step without water draws exactly the ground it drew before water existed', () => {
  const HOLD = [[-3, 14], [5, -15]];
  const rings = {
    '32@224': [20, 26, 34, 45, 59, 77, 101],
    '64@256': [60, 79, 103],
    '128@384': [130, 160],
  };
  const recorded = {
    '1337|32@224|0': '7ced67a7', '1337|32@224|1': '5b182b80',
    'Hoogezand|64@256|1': '10e2658e', '7|128@384|1': 'c69f22ba',
    'harbour|32@224|0': '525b54bb',
  };
  for (const [key, hash] of Object.entries(recorded)) {
    const [seed, cfg, relief] = key.split('|');
    const [base, size] = cfg.split('@').map(Number);
    const s = /^\d+$/.test(seed) ? Number(seed) : seed;
    const steps = (water) => rings[cfg].map((r) => stepOf(r, Math.max(64, Math.min(size, gridForCoast(r))), { relief: Number(relief), hold: HOLD, water }));
    assert.equal(makeTerrain(s, { size, grow: { base, steps: steps(0) } }).hash, hash, key);
    // Spelled out as zero it is the same ring, like `relief: 0`.
    assert.equal(makeTerrain(s, { size, grow: { base, steps: steps(0).map((st) => ({ ...st, water: 0 })) } }).hash, hash, `${key}: water 0`);
    // An empty `works` is nothing at all.
    assert.equal(makeTerrain(s, { size, works: { v: WORKS_VERSION }, grow: { base, steps: steps(0) } }).hash, hash, `${key}: empty works`);
  }
});

test("the live island's own step still draws the ground its hash is of", () => {
  const { seed, size, grow, fairway, polders, hash } = HOOGEZAND;
  assert.equal(makeTerrain(seed, { size, polders, fairway, grow }).hash, hash);
  const t = makeTerrain(seed, { size, polders, fairway, grow, works: null });
  assert.equal(t.hash, hash);
  // ...and it is the broken one this file is about.
  assert.equal(fairwayOpen(t, fairway), false, 'the fixture is no longer the closed fairway it was recorded as');
  assert.equal(pondCount(t), 10, 'the fixture is no longer the ten bodies of water it was recorded with');
});

// The new meaning of `water: 1` (30 September 2026: lanes and ponds on the step, drawn with the
// profiles), frozen from here on. No island had a step of the old meaning, so the number stayed.
test('a step of water 1 draws the ground recorded for it', () => {
  const recorded = { 3: '985a3c11', 7: 'ef055ce8', 1337: '845dc69d' };
  const out = {};
  for (const seed of Object.keys(recorded).map(Number)) {
    const size = 192, base = 64;
    const t0 = makeTerrain(seed, { size, grow: { base, steps: [] } });
    const f = planFairway(t0, emptyLayout(seed, size));
    const fairway = f && f.cells.length ? f : null;
    const s1 = take(seed, size, base, [], stepOf(nextCoast({ base, steps: [] }, size), size, { water: WATER_VERSION }), fairway ? fairway.cells : [], { fairway });
    out[seed] = makeTerrain(seed, { size, fairway, grow: { base, steps: [s1] } }).hash;
  }
  assert.deepEqual(out, recorded);
});

test('a step or earthworks this code does not know are refused, not drawn as something else', () => {
  const grow = (s) => ({ base: 64, steps: [{ r: 60, grid: 128, hold: [], ...s }] });
  assert.throws(() => makeTerrain(1337, { size: 128, grow: grow({ water: WATER_VERSION + 1 }) }), /water/);
  assert.throws(() => makeTerrain(1337, { size: 128, grow: grow({ tide: 1 }) }), /field this code does not know: tide/);
  // What the water rule decides rides only on a step drawn with it.
  assert.throws(() => makeTerrain(1337, { size: 128, grow: grow({ lane: [[0, 0]] }) }), /lane/);
  assert.throws(() => makeTerrain(1337, { size: 128, grow: grow({ water: 1, lane: [['a', 0]] }) }), /not a cell/);
  assert.throws(() => makeTerrain(1337, { size: 128, grow: grow({ water: 1, haven: { top: [0, 0], dir: [0, 1], w0: 1, open: 0.3, max: 9 } }) }), /width/);
  assert.throws(() => makeTerrain(1337, { size: 128, works: { v: WORKS_VERSION, pools: [] } }), /field this code does not know: pools/);
  assert.throws(() => makeTerrain(1337, { size: 128, works: { v: WORKS_VERSION + 1 } }), /version/);
  assert.throws(() => makeTerrain(1337, { size: 128, works: { dig: [] } }), /version/);
  assert.throws(() => makeTerrain(1337, { size: 128, works: { v: WORKS_VERSION, dig: [{ cells: [], hold: [], why: 1 }] } }), /why/);
  assert.throws(() => makeTerrain(1337, { size: 128, works: { v: WORKS_VERSION, haven: { top: [9, 9], dir: [0, 64], w0: 1.5, open: 0.25, max: 6 } } }), /step it was planned at/);
});

// ---- the profiles, on ground made for them ------------------------------------------------
// A plain slope from the sea up a hill, so every kind of edge is there.
function slope(size = 48) {
  const N = size + 1, H = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[i + j * N] = Math.round((-1.2 + i * 0.12) * 256) / 256;
  return H;
}
const cellMean = (H, N, x, z) => (H[x + z * N] + H[x + 1 + z * N] + H[x + (z + 1) * N] + H[x + 1 + (z + 1) * N]) / 4;
const cellSlope = (H, N, x, z) => { const c = [H[x + z * N], H[x + 1 + z * N], H[x + (z + 1) * N], H[x + 1 + (z + 1) * N]]; return Math.max(...c) - Math.min(...c); };

test('the profile runs from the bed through a beach to the land, and the distance is exact', () => {
  assert.equal(workProfile(0), CHANNEL_H);
  // Up through the waterline, a beach of three cells to BEACH_MAX, then climbing on.
  let prev = -Infinity, beach = 0;
  for (let d = 0; d <= 20; d += 0.25) {
    const h = workProfile(d);
    assert.ok(h >= prev, `the profile falls at ${d}`);
    if (h >= SEA_LEVEL && h <= BEACH_MAX) beach += 0.25;
    prev = h;
  }
  assert.ok(beach >= 2.75 && beach <= 3.25, `a beach of ${beach} cells`);
  // The distance field against a brute force.
  const size = 24, cells = [[3, 4], [10, 10], [11, 10], [20, 2]];
  const d2 = cornerDistance2(cells, size);
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) {
    let best = Infinity;
    for (const [gx, gz] of cells) { const dx = Math.max(gx - i, 0, i - gx - 1), dz = Math.max(gz - j, 0, j - gz - 1); best = Math.min(best, dx * dx + dz * dz); }
    assert.equal(d2[i + j * (size + 1)], best, `${i},${j}`);
  }
});

test('a dig through a slope leaves a beach and a bank, never a wall, and never lowers what it holds', () => {
  const size = 48, N = size + 1;
  const H = slope(size), before = H.slice();
  // A channel five across, straight up the slope from the sea into the hill.
  const cells = [];
  for (let x = 0; x < 30; x++) for (let z = 22; z <= 26; z++) cells.push([x, z]);
  const fixed = new Uint8Array(N * N);
  fixed[20 + 30 * N] = 1;                          // a house's corner beside it
  profileDig(H, size, cells, fixed);
  for (let k = 0; k < H.length; k++) assert.ok(H[k] <= before[k], 'a dig raised a corner');
  assert.equal(H[20 + 30 * N], before[20 + 30 * N], 'the held corner was lowered');
  for (const [x, z] of cells) assert.ok(cellMean(H, N, x, z) < SEA_LEVEL, `${x},${z} is not water`);
  // The land beside the cut: every cell next to water climbs gently, like a coast.
  const slopes = [];
  for (let z = 1; z < size - 1; z++) for (let x = 1; x < 30; x++) {
    if (cellMean(H, N, x, z) < SEA_LEVEL) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => cellMean(H, N, x + a, z + b) < SEA_LEVEL)) slopes.push(cellSlope(H, N, x, z));
  }
  slopes.sort((a, b) => a - b);
  const p90 = slopes[Math.floor(slopes.length * 0.9)];
  assert.ok(p90 <= 0.3, `the land at the cut's edge has a slope p90 of ${p90}`);
  // And there is a beach along it.
  const beach = [];
  for (let z = 14; z < 22; z++) for (let x = 12; x < 30; x++) { const h = cellMean(H, N, x, z); if (h >= 0 && h < BEACH_MAX) beach.push([x, z]); }
  assert.ok(beach.length > 0, 'no beach beside the cut');
});

test('keeping open never goes below the ground before the step, and leaves the deep sea deep', () => {
  const size = 32, N = size + 1;
  const before = new Float64Array(N * N).fill(-2.5);      // the old canvas's open sea
  const ring = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) ring[i + j * N] = i < 16 ? -0.75 : 0.6;   // the ring's own floor, and land
  const H = ring.slice();
  const cells = [];
  for (let x = 0; x < size; x++) for (let z = 14; z <= 17; z++) cells.push([x, z]);
  profileKeep(H, before, size, cells);
  for (let k = 0; k < H.length; k++) {
    assert.ok(H[k] >= before[k], 'kept below the ground before the step');
    assert.ok(H[k] <= ring[k], 'kept above the ring');
  }
  // Where the ring laid its own floor it stays: no trench back down to -2.5.
  assert.equal(H[5 + 15 * N], -0.75);
  // Where the ring made land in the strip, it is water now, at the bed.
  assert.equal(H[25 + 15 * N], CHANNEL_H);
  for (const [x, z] of cells) assert.ok(cellMean(H, N, x, z) < SEA_LEVEL);
});

test('a filled pond is the ground round it, not a plate: dry, and no higher than its rim', () => {
  const size = 32, N = size + 1;
  const H = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) H[i + j * N] = 0.2 + 0.01 * i;   // sand, rising a little
  const pond = [];
  for (let z = 10; z < 20; z++) for (let x = 8; x < 22; x++) { pond.push([x, z]); }
  for (const [x, z] of pond) for (const k of [x + z * N, x + 1 + z * N, x + (z + 1) * N, x + 1 + (z + 1) * N]) H[k] = -0.4;
  // The rim is sand again: the pond's own outer corners belong to cells outside it.
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const inside = i > 8 && i < 22 && j > 10 && j < 20;
    if (!inside) H[i + j * N] = 0.2 + 0.01 * i;
  }
  profileFill(H, size, pond);
  let higher = 0, rim = 0;
  const inPond = new Set(pond.map(([x, z]) => `${x},${z}`));
  for (const [x, z] of pond) {
    assert.ok(cellMean(H, N, x, z) > SEA_LEVEL, `${x},${z} is still water`);
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (inPond.has(`${x + a},${z + b}`)) continue;
      rim++;
      if (cellMean(H, N, x, z) - cellMean(H, N, x + a, z + b) > 0.02) higher++;
    }
  }
  assert.ok(higher <= rim * 0.05, `${higher} of ${rim} rim edges stand higher than the ground beside them`);
});

// ---- a ring drawn with water shuts nothing in --------------------------------------------
function fairwayOn(seed, size, base, steps) {
  const t = makeTerrain(seed, { size, grow: { base, steps } });
  const f = planFairway(t, emptyLayout(seed, size));
  return f && f.cells.length ? f : null;
}
function closedKeys(t) {
  const out = new Set();
  for (const b of waterBodies(t)) if (!b.open) for (const [gx, gz] of b.cells) out.add(`${gx},${gz}`);
  return out;
}

const CONFIGS = [];
for (const seed of SEEDS) {
  for (const [base, size] of [[64, 192], [96, 256]]) {
    for (const relief of [0, 1]) CONFIGS.push({ seed, base, size, relief });
  }
}

// Ring after ring from the founding island, with the fairway dug before the first ring the
// way a village of 25 digs it on an island that has since grown.
function rings({ seed, base, size, relief }, water, each) {
  const steps = [];
  const fairway = fairwayOn(seed, size, base, []);
  const founding = makeTerrain(seed, { size, fairway, grow: { base, steps: [] } });
  const shutAtFounding = closedKeys(founding);
  for (let k = 0; k < 4; k++) {
    const r = nextCoast({ base, steps }, size);
    if (gridForCoast(r) > size || (steps.length && r <= steps[steps.length - 1].r)) break;
    const before = makeTerrain(seed, { size, fairway, grow: { base, steps: steps.slice() } });
    const raw = stepOf(r, size, { relief, water });
    steps.push(water ? take(seed, size, base, steps, raw, fairway ? fairway.cells : [], { fairway }) : raw);
    const after = makeTerrain(seed, { size, fairway, grow: { base, steps: steps.slice() } });
    each({ before, after, fairway, shutAtFounding, k, steps: steps.slice() });
  }
}

test('a ring with water shuts no pond in and never closes the fairway', () => {
  let rounds = 0;
  for (const cfg of CONFIGS) {
    rings(cfg, WATER_VERSION, ({ after, fairway, shutAtFounding, k }) => {
      const why = `${cfg.seed} ${cfg.base}/${cfg.size} relief ${cfg.relief} ring ${k}`;
      const made = [...closedKeys(after)].filter((c) => !shutAtFounding.has(c));
      assert.equal(made.length, 0, `${why}: ${made.length} cells of water shut in by the ring`);
      if (fairway) assert.ok(fairwayOpen(after, fairway), `${why}: the fairway no longer reaches the sea`);
      rounds++;
    });
  }
  assert.ok(rounds >= 60, `only ${rounds} rings were looked at`);
});

test('the same rings without the rule do break both', () => {
  let ponds = 0, closed = 0;
  for (const cfg of CONFIGS) {
    rings(cfg, 0, ({ after, fairway, shutAtFounding }) => {
      ponds += [...closedKeys(after)].filter((c) => !shutAtFounding.has(c)).length > 0 ? 1 : 0;
      if (fairway && !fairwayOpen(after, fairway)) closed++;
    });
  }
  assert.ok(ponds >= 10, `only ${ponds} rings shut a pond in without the rule`);
  assert.ok(closed >= 10, `only ${closed} rings closed the fairway without the rule`);
});

// Accretion never lowers anything: a corner above the beach or held does not move, and every
// other corner only goes up - the lane is kept at no less than the ground before the step.
test('a ring with water keeps the promises a ring makes', () => {
  for (const cfg of CONFIGS.filter((c) => c.size === 256)) {
    rings(cfg, WATER_VERSION, ({ before, after, k }) => {
      for (let c = 0; c < before.H.length; c++) {
        if (before.H[c] >= BEACH_MAX) assert.equal(after.H[c], before.H[c], `${cfg.seed} ring ${k}: corner ${c} above the beach moved`);
        else assert.ok(after.H[c] >= before.H[c], `${cfg.seed} ring ${k}: corner ${c} was dug`);
      }
    });
  }
});

// Review point 4: a step drawn with water used to work its lane out from whatever fairway it was
// handed, so a channel dug or mended later redrew an old ring - measured, 160 cells far from any
// channel turned between land and water. Now a step carries what it decided and draws the same
// ring whatever channel the layout has today.
test('a ring drawn with water is a function of itself, not of the channel of today', () => {
  let rounds = 0;
  for (const cfg of CONFIGS.filter((c) => c.size === 192)) {
    rings(cfg, WATER_VERSION, ({ steps, fairway, k }) => {
      if (!fairway) return;
      const size = cfg.size, N = size + 1;
      const grow = { base: cfg.base, steps };
      const withIt = makeTerrain(cfg.seed, { size, fairway, grow });
      const without = makeTerrain(cfg.seed, { size, fairway: null, grow });
      // Only the channel's own stamp may differ: its cells' corners.
      const stamp = new Set();
      for (const [x, z] of fairway.cells) for (const q of [x + z * N, x + 1 + z * N, x + (z + 1) * N, x + 1 + (z + 1) * N]) stamp.add(q);
      let differ = 0;
      for (let q = 0; q < withIt.H.length; q++) if (!stamp.has(q) && withIt.H[q] !== without.H[q]) differ++;
      assert.equal(differ, 0, `${cfg.seed} ring ${k}: ${differ} corners away from the channel follow today's channel`);
      rounds++;
    });
  }
  assert.ok(rounds >= 10, `only ${rounds} rings were looked at`);
});

test('what settle decides draws exactly the ground it was judged on', () => {
  for (const cfg of CONFIGS.filter((c) => c.relief === 1).slice(0, 6)) {
    const { seed, base, size } = cfg;
    const fairway = fairwayOn(seed, size, base, []);
    const raw = stepOf(nextCoast({ base, steps: [] }, size), size, { water: WATER_VERSION });
    const judged = makeTerrain(seed, { size, fairway, grow: { base, steps: [raw] }, settle: { index: 0, channel: fairway ? fairway.cells : [] } });
    const drawn = makeTerrain(seed, { size, fairway, grow: { base, steps: [{ ...raw, ...judged.settled }] } });
    assert.equal(drawn.hash, judged.hash, `${seed} ${base}/${size}`);
  }
});

test("the live island's own ring, taken with water, keeps the river open and shuts nothing in", () => {
  const { seed, size, grow, fairway, polders } = HOOGEZAND;
  const s = take(seed, size, grow.base, [], { ...grow.steps[0], water: WATER_VERSION }, fairway.cells, { fairway, polders });
  const t = makeTerrain(seed, { size, polders, fairway, grow: { base: grow.base, steps: [s] } });
  assert.ok(fairwayOpen(t, fairway));
  assert.equal(pondCount(t), 1, 'the founding lake is all that may be left');
});

// ---- an island whose step cannot change is mended in the layout --------------------------
const SIZE = 256, BASE = 96;
const model = village(30, { projects: 10 });
const opts = (seed) => ({ seed, size: SIZE, cap: SIZE });
const groundOf = (seed, l) => makeTerrain(seed, { size: l.size, polders: l.polders, fairway: l.fairway, works: l.works || null, grow: l.grow });

// A village of thirty on a base 96 island, then one more ring drawn the way every step was drawn
// before `water` (relief, no water; held as growStep holds), which on seeds 6 and 7 closes the
// fairway and on 3 shuts ponds in - with sand and shallows only, all a mended channel may cut.
function oldIsland(seed) {
  const layout = emptyLayout(seed, SIZE, { base: BASE, steps: [] });
  placeAll(layout, model, opts(seed));
  placeAll(layout, model, opts(seed));
  const size = layout.size, now = groundOf(seed, layout);
  const hold = new Set();
  const low = (gx, gz) => [now.corner(gx, gz), now.corner(gx + 1, gz), now.corner(gx, gz + 1), now.corner(gx + 1, gz + 1)].some((h) => h < BEACH_MAX);
  for (const p of Object.values(layout.plots)) {
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) if (now.inGrid(p.gx + x, p.gz + z) && low(p.gx + x, p.gz + z)) hold.add(`${p.gx + x - size / 2},${p.gz + z - size / 2}`);
  }
  const r = nextCoast(layout.grow, SIZE);
  layout.grow.steps.push(stepOf(r, size, { hold: [...hold].map((s) => s.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]) }));
  layout.terrainHash = groundOf(seed, layout).hash;
  return layout;
}

test('a fairway an old ring closed is dug through to the sea, and the scan after is a no-op', () => {
  for (const seed of [6, 7]) {
    const layout = oldIsland(seed);
    assert.ok(layout.fairway && layout.fairway.cells.length, `${seed}: the island has no fairway`);
    const shut = groundOf(seed, layout);
    assert.equal(fairwayOpen(shut, layout.fairway), false, `${seed}: the old ring did not close the fairway, so this proves nothing`);
    assert.equal(fairwayReaches(shut, layout.fairway), false);
    const fairwayBefore = JSON.stringify(layout.fairway);
    const houses = stands(layout);

    placeAll(layout, model, opts(seed));
    const T = groundOf(seed, layout);
    assert.ok(fairwayOpen(T, layout.fairway), `${seed}: the fairway still does not reach the sea`);
    assert.ok(fairwayReaches(T, layout.fairway));
    assert.equal(layout.terrainHash, T.hash, `${seed}: the hash on record is not the ground as mended`);
    // The channel as recorded is left alone; the cut is a dig of its own, with its hold.
    assert.equal(JSON.stringify(layout.fairway), fairwayBefore, `${seed}: the fairway record was changed`);
    assert.equal(layout.works.v, WORKS_VERSION);
    assert.ok(layout.works.dig.length >= 1 && layout.works.dig[0].cells.length > 0, `${seed}: no dig was recorded`);
    // Nothing that stands moved, except a civic that stood in the way of the cut.
    const moved = movedBetween(houses, stands(layout));
    assert.ok(moved.every((id) => ['civic:crane', 'civic:lighthouse'].includes(id)), `${seed}: ${moved.join(', ')} moved`);
    // And nothing that stands had a corner lowered: the dig's hold covers everything in reach.
    const N = T.N;
    for (const [id, p] of Object.entries(layout.plots)) {
      if (!houses[id]) continue;
      for (let z = 0; z <= p.d; z++) for (let x = 0; x <= p.w; x++) {
        const q = p.gx + x + (p.gz + z) * N;
        assert.ok(T.H[q] >= shut.H[q], `${seed}: ${id} had a corner dug under it`);
      }
    }
    const again = JSON.stringify(layout);
    placeAll(layout, model, opts(seed));
    assert.equal(JSON.stringify(layout), again, `${seed}: the scan after mending changed the layout`);
  }
});

test('the ponds an old ring shut in are filled once, and nothing that belongs to the water is', () => {
  for (const seed of [3]) {
    const layout = oldIsland(seed);
    const before = groundOf(seed, layout);
    const shutBefore = enclosedCells(before);
    placeAll(layout, model, opts(seed));
    const T = groundOf(seed, layout);
    assert.ok(Array.isArray(layout.works.fill), `${seed}: no fill was recorded`);
    assert.ok(layout.works.fill.length > 0, `${seed}: nothing was filled`);
    assert.ok(enclosedCells(T) < shutBefore, `${seed}: ${enclosedCells(T)} cells still shut in, from ${shutBefore}`);
    for (const [gx, gz] of layout.works.fill) assert.ok(!T.isWater(gx, gz), `${seed}: ${gx},${gz} is still water`);
    const founding = makeTerrain(seed, { size: SIZE, polders: layout.polders, fairway: layout.fairway, grow: { base: BASE, steps: [] } });
    for (const b of waterBodies(founding)) {
      if (b.open) continue;
      const [gx, gz] = b.cells[0];
      assert.ok(T.isWater(gx, gz), `${seed}: a pond the founding island had (${gx},${gz}) was filled`);
    }
    for (const [gx, gz] of layout.fairway.cells) assert.ok(T.isWater(gx, gz), `${seed}: the channel was filled at ${gx},${gz}`);
  }
});

// Review point 7: the fill rode on the fairway and waited for one. An island with no channel
// has its ponds filled all the same.
test('an island with no channel has its ring ponds filled too', () => {
  const seed = 3;
  const layout = oldIsland(seed);
  const T0 = groundOf(seed, layout);
  layout.fairway = null;
  const T1 = makeTerrain(seed, { size: layout.size, polders: layout.polders, fairway: null, grow: layout.grow });
  const filled = fillRingPonds(layout, T1, { seed, size: layout.size });
  assert.ok(T0 && filled, 'nothing was filled without a channel');
  assert.ok(layout.works.fill.length > 0);
  assert.equal(layout.terrainHash, filled.hash);
});

// The live island's numbers, without a scan: its ground, its fairway and no houses at all. The
// mend has to open the mouth and fill exactly the seven ring ponds (247 cells), leave the
// founding lake, and the hash on record has to be the ground as mended.
test("the live island's closed river mouth and seven ponds are mended", () => {
  const { seed, size, grow, fairway, polders } = HOOGEZAND;
  const layout = emptyLayout(seed, size, clone(grow));
  layout.size = size;
  layout.fairway = clone(fairway);
  layout.polders = clone(polders);
  const built = () => makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway, works: layout.works, grow: layout.grow });
  let T = built();
  const shut = enclosedCells(T);
  const opened = repairFairway(layout, T, { seed, size });
  assert.ok(opened, 'the fairway was not dug through to the sea');
  assert.ok(fairwayOpen(opened, layout.fairway));
  assert.deepEqual(layout.fairway, fairway, 'the recorded channel was changed');
  const filled = fillRingPonds(layout, opened, { seed, size });
  assert.ok(filled, 'nothing was filled');
  assert.equal(layout.works.fill.length, 247, 'the seven ring ponds are 247 cells');
  T = built();
  assert.equal(layout.terrainHash, T.hash);
  // The founding lake (14 cells) is all that is left shut in: the dig's banks took the river's
  // two-cell backwater in with the channel.
  assert.ok(pondCount(T) <= 2, `${pondCount(T)} bodies still shut in`);
  assert.ok(enclosedCells(T) <= 16, `${enclosedCells(T)} cells still shut in`);
  assert.ok(shut > 600, `the island was not the ${shut} cells of shut water it was recorded with`);
  const written = JSON.stringify(layout.works);
  assert.equal(repairFairway(layout, T, { seed, size }), null);
  assert.equal(fillRingPonds(layout, T, { seed, size }), null);
  assert.equal(JSON.stringify(layout.works), written);
});

test('an island that grows by itself needs no mending', () => {
  for (const seed of [1, 3, 7]) {
    const layout = emptyLayout(seed, SIZE, { base: BASE, steps: [] });
    const first = village(30, { projects: 10 }), many = village(90, { projects: 12 });
    for (const m of [first, first, many, many]) placeAll(layout, m, opts(seed));
    assert.ok(layout.grow.steps.length >= 1, `${seed}: it never took a ring`);
    assert.ok(layout.grow.steps.every((s) => s.water === WATER_VERSION && Array.isArray(s.lane) && Array.isArray(s.ponds)), `${seed}: growStep wrote a step without its water decisions`);
    const T = groundOf(seed, layout);
    assert.equal(layout.terrainHash, T.hash);
    assert.ok(layout.fairway && layout.fairway.line.length, `${seed}: no fairway to keep open`);
    assert.ok(fairwayOpen(T, layout.fairway), `${seed}: the fairway is shut`);
    assert.deepEqual(layout.works.fill, [], `${seed}: something was filled where nothing was shut in`);
    const founding = makeTerrain(seed, { size: SIZE, polders: layout.polders, fairway: layout.fairway, grow: { base: BASE, steps: [] } });
    assert.ok(enclosedCells(T) <= enclosedCells(founding), `${seed}: the rings shut water in`);
    const same = JSON.stringify(layout);
    placeAll(layout, many, opts(seed));
    assert.equal(JSON.stringify(layout), same, `${seed}: the scan after was not a no-op`);
  }
});

test('a ring taken after mending writes its water decisions on its step and keeps the mouth open', () => {
  const seed = 6;
  const layout = oldIsland(seed);
  placeAll(layout, model, opts(seed));
  const steps = layout.grow.steps.length;
  const ground = growStep(layout, { seed, size: SIZE, cap: SIZE });
  if (!ground) return;                                      // the grid is as far as it may go
  assert.equal(layout.grow.steps.length, steps + 1);
  const s = layout.grow.steps[steps];
  assert.equal(s.water, WATER_VERSION);
  assert.ok(Array.isArray(s.lane) && Array.isArray(s.ponds));
  assert.equal(layout.terrainHash, ground.hash);
  assert.ok(fairwayOpen(groundOf(seed, layout), layout.fairway));
});

// A bigger grid puts the works where they were, like every other list of cells.
test('growing the grid moves the earthworks with the island', () => {
  const seed = 3;
  const layout = oldIsland(seed);
  placeAll(layout, model, opts(seed));
  assert.ok(layout.works.fill.length > 0);
  layout.works.dig = [{ cells: [[100, 100], [101, 100]], hold: [[102, 101]] }];
  layout.works.haven = { top: [120, 200], dir: [0, 64], w0: 1.5, open: 0.25, max: 9, from: 1 };
  const small = groundOf(seed, layout);
  const was = clone(layout.works);
  growCanvas(layout, layout.size + 32);
  const k = 16, sh = (cells) => cells.map(([x, z]) => [x + k, z + k]);
  assert.deepEqual(layout.works.fill, sh(was.fill));
  assert.deepEqual(layout.works.dig, [{ cells: sh(was.dig[0].cells), hold: sh(was.dig[0].hold) }]);
  assert.deepEqual(layout.works.haven, { ...was.haven, top: [136, 216] }, 'the funnel moved its direction, or did not move its head');
  const big = groundOf(seed, layout);
  for (let j = 0; j < small.N; j++) {
    for (let i = 0; i < small.N; i++) assert.equal(big.H[i + k + (j + k) * big.N], small.H[i + j * small.N], `corner ${i},${j}`);
  }
});

test('the fairway a village digs at twenty-five is untouched by any of this', () => {
  const layout = emptyLayout(1337, 128);
  placeAll(layout, village(FAIRWAY_AT), { seed: 1337, size: 128 });
  const T = makeTerrain(1337, { size: 128, polders: layout.polders, fairway: layout.fairway, works: layout.works || null, grow: layout.grow || null });
  assert.equal(layout.terrainHash, T.hash);
  // No ring, so no fill is asked; a channel that reaches the sea is not repaired.
  assert.ok(!layout.works || !(layout.works.dig || []).length);
  assert.ok(!layout.works || layout.works.fill === undefined);
});

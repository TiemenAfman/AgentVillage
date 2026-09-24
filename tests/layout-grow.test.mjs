// An island founded small grows when its village no longer fits (Plans/eiland-laten-groeien.md,
// fase 2). The promises: everybody who fits in the end gets a house, nothing that stood
// moves, the ground under what stood does not shift, the hash on record is the ground as
// grown, and the scan after the growing is byte-identical.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAll, emptyLayout, nextCoast, growStep } from '../lib/layout.mjs';
import { makeTerrain, foundingCoast, gridForCoast } from '../shared/terrain.mjs';
import { buildBundle, parseBundle } from '../lib/islandbundle.mjs';
import { village, clone, stands, movedBetween } from './support/village.mjs';

const SEED = 1337, SIZE = 128, BASE = 32;
const opts = { seed: SEED, size: SIZE };
const groundOf = (l) => makeTerrain(SEED, { size: SIZE, polders: l.polders, fairway: l.fairway, grow: l.grow });
const houses = (l) => Object.keys(l.plots).filter((id) => id.startsWith('house:')).length;
const model = (n) => village(n, { projects: Math.max(1, Math.round(n / 3)) });

// Scanned twice, the way every layout test settles an island: a fresh small island rewrites
// its districts once on the second scan whether or not it grows (measured on a plain 32-grid
// island too), and that is not what these tests are about.
function settled(n, grow = { base: BASE, steps: [] }) {
  const layout = emptyLayout(SEED, SIZE, grow);
  placeAll(layout, model(n), opts);
  placeAll(layout, model(n), opts);
  return layout;
}

test('a small island grows until its village fits, and then stays put', () => {
  // Three settlers take two rings at most: a hamlet of their own rather than the commons,
  // which is what an island that can still grow prefers (see the waiting in placeAll) - and
  // the founding island's first ring is nearly all town core, where no farm may stand.
  const small = settled(3);
  assert.ok(small.grow.steps.length <= 2, `three settlers took ${small.grow.steps.length} rings`);
  assert.equal(houses(small), 3);

  const layout = settled(36);
  assert.equal(houses(layout), 36);
  assert.ok(layout.grow.steps.length >= 2, `it grew ${layout.grow.steps.length} times`);
  let r = foundingCoast(BASE);
  for (const s of layout.grow.steps) { assert.ok(s.r > r && Number.isInteger(s.r)); r = s.r; }
  assert.equal(layout.terrainHash, groundOf(layout).hash, 'the hash on record is not the ground as grown');

  const before = JSON.stringify(layout);
  placeAll(layout, model(36), opts);
  assert.equal(JSON.stringify(layout), before, 'the scan after growing changed the layout');
});

// The harbours go with the coast (Martijn's choice over keeping a channel open): a pier the
// new ground filled is planned again at the shore as it now is, with its slipway and road.
test('the harbours and the landing move out with the coast', () => {
  const small = settled(3);
  const piersBefore = (small.harbours || []).filter(Boolean).map((h) => JSON.stringify(h.pier));
  assert.ok(piersBefore.length, 'the founding island has no harbour to move');

  const layout = settled(36);
  const T = groundOf(layout);
  const open = (gx, gz) => T.isWater(gx, gz);
  const harbours = (layout.harbours || []).filter(Boolean);
  assert.ok(harbours.length, 'the grown island has no harbour at all');
  for (const h of harbours) {
    assert.ok(h.pier.every(([gx, gz]) => open(gx, gz)), `a pier on dry land: ${JSON.stringify(h.pier)}`);
    assert.ok(layout.paths.some((p) => p.id === `road:harbour:${layout.harbours.indexOf(h)}`), 'a harbour without its slipway');
  }
  assert.ok(harbours.some((h) => !piersBefore.includes(JSON.stringify(h.pier))), 'no harbour moved, so this proves nothing');
  const [lx, lz] = layout.landing;
  assert.ok(T.isBeach(lx, lz) || T.coastCells.some(([gx, gz]) => gx === lx && gz === lz), 'the landing is inland');
});

// The quay is the one district whose houses move with the coast: they stand on planks, and
// planks in a meadow are nothing. Everybody else stays exactly where they were.
function withQuay(n, quay = 3) {
  const m = model(n);
  m.districts.push({ id: 'quay', kind: 'quay', name: 'The Quay', firstSeenAt: 999, population: quay });
  for (let k = 0; k < quay; k++) m.buildings.push({ id: `house:quay:${k}`, kind: 'house', district: 'quay', startedAt: 1500 + k });
  m.stats.settlers = n + quay;
  return m;
}

test('the quay founds itself again at the new shore, and nobody else moves', () => {
  const layout = emptyLayout(SEED, SIZE, { base: BASE, steps: [] });
  placeAll(layout, withQuay(6), opts);
  placeAll(layout, withQuay(6), opts);
  const q = layout.districts.quay;
  assert.ok(q && q.pier.length, 'the founding island has no quay');
  const pierBefore = JSON.stringify(q.pier);
  const was = stands(layout);

  placeAll(layout, withQuay(36), opts);
  placeAll(layout, withQuay(36), opts);
  assert.ok(layout.grow.steps.length > 0);
  const T = groundOf(layout);
  const q2 = layout.districts.quay;
  assert.ok(q2.pier.length && q2.pier.every(([gx, gz]) => T.isWater(gx, gz)), 'the quay is not at the water');
  assert.notEqual(JSON.stringify(q2.pier), pierBefore, 'the quay did not move, so this proves nothing');
  for (let k = 0; k < 3; k++) assert.ok(layout.plots[`house:quay:${k}`], `quay house ${k} was not housed again`);
  const moved = movedBetween(was, stands(layout)).filter((id) => id in was && !id.startsWith('house:quay:') && !id.startsWith('shed:quay:')
    && id !== 'civic:lighthouse' && id !== 'civic:crane');
  assert.deepEqual(moved, [], `moved besides the quay: ${moved.join(', ')}`);
});

test('what stood before the island grew stands where it stood, on the same ground', () => {
  const layout = settled(12);
  const was = stands(layout);
  const ground = groundOf(layout);
  const steps = layout.grow.steps.length;

  placeAll(layout, model(36), opts);
  assert.ok(layout.grow.steps.length > steps, 'it did not grow');
  const moved = movedBetween(was, stands(layout)).filter((id) => id in was);
  assert.deepEqual(moved, [], `moved: ${moved.join(', ')}`);

  // And no corner under any of it: a held cell, or above the beach, is never touched.
  const after = groundOf(layout);
  for (const id of Object.keys(was)) {
    const p = layout.plots[id];
    for (let z = 0; z <= p.d; z++) {
      for (let x = 0; x <= p.w; x++) {
        assert.equal(after.corner(p.gx + x, p.gz + z), ground.corner(p.gx + x, p.gz + z), `the ground under ${id} moved`);
      }
    }
  }
});

test('an island stops growing at the edge of its grid, and that is stable too', () => {
  const layout = settled(160);
  const last = layout.grow.steps[layout.grow.steps.length - 1].r;
  assert.ok(gridForCoast(nextCoast(layout.grow, SIZE)) > SIZE, `it stopped at ${last} with room to spare`);
  assert.equal(last, Math.floor(foundingCoast(SIZE)), 'the last ring stops short of the grid');
  assert.ok(houses(layout) < 160, 'the test needs more settlers than the grid holds');
  assert.equal(growStep(clone(layout), opts), null);
  const before = JSON.stringify(layout);
  placeAll(layout, model(160), opts);
  assert.equal(JSON.stringify(layout), before);
});

test('an island founded on its whole grid never grows', () => {
  const layout = emptyLayout(SEED, BASE);
  placeAll(layout, model(36), { seed: SEED, size: BASE });
  assert.equal(layout.grow, null);
  assert.ok(houses(layout) < 36);
});

test('a grown island sails: its bundle carries the growth and hashes the same', () => {
  const layout = settled(36);
  const terrain = groundOf(layout);
  const v = {
    v: 1, generatedAt: '2026-09-24T10:00:00.000Z',
    island: { name: 'Groeiend', seed: SEED, terrainHash: terrain.hash, foundedAt: null, landing: layout.landing, town: null, lattice: null, harbours: [] },
    grid: { size: SIZE },
    districts: [], buildings: [], paths: [], bridges: [], cleared: [], polders: [], fairway: null,
    grow: layout.grow,
  };
  const packed = buildBundle({ config: { seed: SEED, gridSize: 64 }, village: v, keeper: 'Martijn' });
  assert.equal(packed.grid.size, SIZE, 'the bundle took the size from the config, not the village');
  assert.deepEqual(packed.grow, layout.grow);
  const parsed = parseBundle(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(parsed.grow, layout.grow);
  // A radius a hair out is a different island, and the sea says so.
  const lie = JSON.parse(JSON.stringify(packed));
  lie.grow.steps[0].r += 1;
  assert.throws(() => parseBundle(lie), /hashes to/);
});

// The Grow button: the same step a scan takes, only earlier. Through runPlan like every other
// hand on the island, so it is tried on a copy first and the diff names what moved.
test('the keeper can grow the island by hand, and it is the ring a scan would have grown', async () => {
  const { parsePlan, runPlan } = await import('../lib/plan.mjs');
  const layout = emptyLayout(SEED, SIZE, { base: BASE, steps: [] });
  placeAll(layout, withQuay(4), opts);
  placeAll(layout, withQuay(4), opts);
  const had = layout.grow.steps.length;
  const want = nextCoast(layout.grow, SIZE);
  const was = stands(layout);

  const dry = runPlan(layout, withQuay(4), parsePlan({ ops: [{ op: 'grow' }] }), { ...opts, dryRun: true });
  assert.ok(dry.ok, dry.error || JSON.stringify(dry.verdicts));
  assert.equal(layout.grow.steps.length, had, 'a dry run grew the island');

  const r = runPlan(layout, withQuay(4), parsePlan({ ops: [{ op: 'grow' }] }), opts);
  assert.ok(r.ok, r.error || JSON.stringify(r.verdicts));
  assert.equal(layout.grow.steps.length, had + 1);
  assert.equal(layout.grow.steps[had].r, want);
  assert.equal(layout.terrainHash, groundOf(layout).hash);
  const moved = movedBetween(was, stands(layout)).filter((id) => id in was && !id.includes(':quay:') && id !== 'civic:lighthouse' && id !== 'civic:crane');
  assert.deepEqual(moved, []);
  const settledNow = JSON.stringify(layout);
  placeAll(layout, withQuay(4), opts);
  assert.equal(JSON.stringify(layout), settledNow, 'the scan after a hand-grown ring changed the layout');

  const whole = emptyLayout(SEED, BASE);
  placeAll(whole, model(3), { seed: SEED, size: BASE });
  placeAll(whole, model(3), { seed: SEED, size: BASE });
  const no = runPlan(whole, model(3), parsePlan({ ops: [{ op: 'grow' }] }), { seed: SEED, size: BASE, dryRun: true });
  assert.equal(no.ok, false);
  assert.match(no.verdicts[0].reason, /whole grid/);
});

// The very first settler of a fresh install (FOUNDING: 32 on a 64 grid) is a farmstead,
// and the founding island's first ring is nearly all town core, where no farmstead may go.
// A district that stands nowhere keeps waiting for rings, rather than the one ring any
// other house gets, so it founds its own farm instead of lodging on the commons for good.
test("a fresh install's first settler gets a farm of its own, not the commons", () => {
  for (const seed of [1337, 7, 42]) {
    const layout = emptyLayout(seed, 64, { base: 32, steps: [] });
    placeAll(layout, village(1, { projects: 1 }), { seed, size: 64, cap: 384 });
    const p = layout.plots['house:proj:0:0'];
    assert.ok(p && !p.commons, `${seed}: the first settler lodges on the commons`);
    assert.equal(layout.districts['proj:0'].lobes.length, 1, `${seed}: no farm was founded`);
    const once = JSON.stringify(layout);
    placeAll(layout, village(1, { projects: 1 }), { seed, size: layout.size, cap: 384 });
    assert.equal(JSON.stringify(layout), once, `${seed}: the next scan changed the layout`);
  }
});

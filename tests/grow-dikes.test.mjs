// A growth step takes in the sea walls it closes in (`absorbDikes` in lib/layout.mjs): a
// polder dug on the old coast ends up inside the new ring, and its dike - a ridge at DIKE_H
// that nobody may build on or route over - becomes ordinary ground. The promises: the wall
// is gone where nothing stands by it, the poldermill keeps the dike under it, nothing moves,
// the hash on record is the ground as levelled, the scans after it change nothing, and a
// neighbour rebuilding the island from its bundle gets the same ground.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAll, emptyLayout, growStep, heldOf, replayGrid, RESERVED } from '../lib/layout.mjs';
import { makeTerrain, DIKE_H } from '../shared/terrain.mjs';
import { buildBundle, parseBundle } from '../lib/islandbundle.mjs';
import { parsePlan, runPlan } from '../lib/plan.mjs';
import { village, clone, key } from './support/village.mjs';

const SEED = 1337, SIZE = 128, CAP = 192;
const groundOf = (l) => makeTerrain(SEED, { size: l.size, polders: l.polders, fairway: l.fairway, grow: l.grow });
// What moves with the coast on purpose (tests/layout-grow.test.mjs): the quay and what
// belongs to it, the lighthouse, the crane, and the bridge stone laid off the quay.
const MOVERS = (id) => id.includes(':quay:') || ['civic:lighthouse', 'civic:crane', 'civic:bridge'].includes(id);

function withQuay(n, quay = 3) {
  const m = village(n, { projects: Math.max(1, Math.round(n / 4)) });
  m.districts.push({ id: 'quay', kind: 'quay', name: 'The Quay', firstSeenAt: 999, population: quay });
  for (let k = 0; k < quay; k++) m.buildings.push({ id: `house:quay:${k}`, kind: 'house', district: 'quay', startedAt: 1500 + k });
  m.stats.settlers = n + quay;
  m.milestones = [{ civicType: 'poldermill', unlocked: true }];
  return m;
}

// An island founded on its whole grid with the polder ladder past its first rung (it starts
// at POLDER_AT, 150): the live island's situation when the setting first gives it room.
let cached = null;
function settled() {
  if (!cached) {
    const layout = emptyLayout(SEED, SIZE);
    placeAll(layout, withQuay(170), { seed: SEED, size: SIZE });
    placeAll(layout, withQuay(170), { seed: SEED, size: SIZE });
    assert.ok(layout.polders.length, 'the island needs a polder for this test to mean anything');
    assert.ok(layout.plots['civic:poldermill'], 'and its mill');
    cached = layout;
  }
  return clone(cached);
}
// Where a plot stands and which way it looks, in local coordinates - a bigger grid moves
// every index by k and nothing in the world.
const local = (l) => Object.fromEntries(Object.entries(l.plots).map(([id, p]) => [id, `${p.gx - l.size / 2},${p.gz - l.size / 2},${p.rot}`]));
const cornersOf = (T, gx, gz) => [T.corner(gx, gz), T.corner(gx + 1, gz), T.corner(gx, gz + 1), T.corner(gx + 1, gz + 1)];

test('a ring that closes a polder in levels its dike, keeps the mill standing, and moves nothing', () => {
  const layout = settled();
  const before = groundOf(layout);
  const was = local(layout);
  const dike = layout.polders[0].dike.map((c) => [...c]);
  const mill = { ...layout.plots['civic:poldermill'] };
  assert.ok(dike.some(([gx, gz]) => gx === mill.gx && gz === mill.gz), 'the mill does not stand on the dike');

  const T = growStep(layout, { seed: SEED, size: SIZE, cap: CAP });
  assert.ok(T, 'the island did not grow');
  const k = (layout.size - SIZE) / 2;
  assert.ok(k > 0);
  const p = layout.polders[0];
  assert.equal(p.absorbed, 0, 'the first step did not take the dike in');
  assert.ok(p.dike.length < dike.length, 'no dike cell was levelled');
  assert.equal(layout.terrainHash, T.hash);
  assert.equal(layout.terrainHash, groundOf(layout).hash, 'the hash on record is not the ground as levelled');

  // The levelled cells: ground, not wall - not held, not RESERVED, not at DIKE_H.
  const standing = new Set(p.dike.map(key));
  const gone = dike.map(([gx, gz]) => [gx + k, gz + k]).filter((c) => !standing.has(key(c)));
  const held = heldOf(layout);
  const grid = replayGrid(T, layout);
  for (const [gx, gz] of gone) {
    assert.ok(!held.has(key([gx, gz])), `${gx},${gz} is still held`);
    assert.notEqual(grid.get(gx, gz), RESERVED, `${gx},${gz} is still RESERVED`);
    assert.ok(T.isLand(gx, gz), `${gx},${gz} is water now`);
    assert.ok(cornersOf(T, gx, gz).some((h) => h !== DIKE_H), `${gx},${gz} still stands at DIKE_H`);
  }
  assert.ok(gone.some(([gx, gz]) => T.isBuildable(gx, gz)), 'not one levelled cell can be built on');

  // The mill stands where it stood, on the dike it stood on, at the height it had.
  const m = layout.plots['civic:poldermill'];
  assert.deepEqual([m.gx - k, m.gz - k, m.rot], [mill.gx, mill.gz, mill.rot], 'the mill moved');
  assert.ok(standing.has(key([m.gx, m.gz])), 'the dike under the mill was levelled');
  for (let z = 0; z <= m.d; z++) {
    for (let x = 0; x <= m.w; x++) assert.equal(T.corner(m.gx + x, m.gz + z), before.corner(mill.gx + x, mill.gz + z), 'the ground under the mill moved');
  }
  // And nothing else that stays: not its plot, not a corner under it.
  for (const [id, at] of Object.entries(was)) {
    if (MOVERS(id)) continue;
    assert.equal(local(layout)[id], at, `${id} moved`);
    const q = layout.plots[id];
    for (let z = 0; z <= q.d; z++) {
      for (let x = 0; x <= q.w; x++) {
        assert.equal(T.corner(q.gx + x, q.gz + z), before.corner(q.gx + x - k, q.gz + z - k), `the ground under ${id} moved`);
      }
    }
  }

  // The scan after it sets down what the ring moved, and the one after that changes nothing.
  placeAll(layout, withQuay(170), { seed: SEED, size: layout.size, cap: layout.size });
  assert.equal(layout.terrainHash, groundOf(layout).hash);
  for (const [id, at] of Object.entries(was)) if (!MOVERS(id)) assert.equal(local(layout)[id], at, `${id} moved on the next scan`);
  const once = JSON.stringify(layout);
  placeAll(layout, withQuay(170), { seed: SEED, size: layout.size, cap: layout.size });
  assert.equal(JSON.stringify(layout), once, 'the scan after that one changed the layout');

  // A second ring does not take in again what the first one did.
  const kept = JSON.stringify(layout.polders.map((q) => q.dike.map(([gx, gz]) => [gx - layout.size / 2, gz - layout.size / 2])));
  growStep(layout, { seed: SEED, size: layout.size, cap: 256 });
  assert.equal(layout.polders[0].absorbed, 0);
  assert.equal(JSON.stringify(layout.polders.map((q) => q.dike.map(([gx, gz]) => [gx - layout.size / 2, gz - layout.size / 2]))), kept);
  assert.equal(layout.terrainHash, groundOf(layout).hash);
});

test('a levelled island sails: its bundle hashes the same, and carries no provenance', () => {
  const layout = settled();
  growStep(layout, { seed: SEED, size: SIZE, cap: CAP });
  assert.equal(layout.polders[0].absorbed, 0);
  const terrain = groundOf(layout);
  const v = {
    v: 1, generatedAt: '2026-09-24T10:00:00.000Z',
    island: { name: 'Ingepolderd', seed: SEED, terrainHash: terrain.hash, foundedAt: null, landing: layout.landing, town: null, lattice: null, harbours: [] },
    grid: { size: layout.size },
    districts: [], buildings: [], paths: [], bridges: [], cleared: [],
    polders: layout.polders.map((p) => ({ ...p, at: 150, unlockedAt: null })), fairway: layout.fairway,
    grow: layout.grow,
  };
  const packed = buildBundle({ config: { seed: SEED, gridSize: SIZE }, village: v, keeper: 'Martijn' });
  const parsed = parseBundle(JSON.parse(JSON.stringify(packed)));
  assert.equal(parsed.island.terrainHash, terrain.hash);
  assert.deepEqual(parsed.polders[0].dike, layout.polders[0].dike);
  assert.equal(parsed.polders[0].absorbed, undefined, 'provenance went on the sea');
  // The levelled wall is in the ground a neighbour rebuilds: hand it the old dike and the
  // sea says the island does not add up.
  const lie = JSON.parse(JSON.stringify(packed));
  lie.polders[0].dike = cached.polders[0].dike.map(([gx, gz]) => [gx + (layout.size - SIZE) / 2, gz + (layout.size - SIZE) / 2]);
  assert.throws(() => parseBundle(lie), /hashes to/);
});

test('the Grow button levels the wall too, and the sea cannot take such a polder back', () => {
  const layout = settled();
  const m = withQuay(170);
  const r = runPlan(layout, m, parsePlan({ ops: [{ op: 'grow' }] }), { seed: SEED, size: SIZE, cap: CAP });
  assert.ok(r.ok, r.error || JSON.stringify(r.verdicts));
  assert.equal(layout.polders[0].absorbed, 0);
  assert.ok(r.verdicts[0].notes.some((n) => /sea wall/.test(n)), JSON.stringify(r.verdicts[0].notes));
  assert.equal(layout.terrainHash, groundOf(layout).hash);

  const no = runPlan(layout, m, parsePlan({ ops: [{ op: 'unpolder', index: 0 }] }), { seed: SEED, size: layout.size, cap: layout.size, dryRun: true });
  assert.equal(no.ok, false);
  assert.match(no.verdicts[0].reason, /grew round polder 0/);
});

test('a polder the ring leaves at the water keeps its whole wall', () => {
  // The founding island's own polder, before any ring: still a sea wall, so nothing to take.
  const layout = settled();
  const T = groundOf(layout);
  const p = layout.polders[0];
  assert.ok(p.dike.some(([gx, gz]) => T.isWater(gx + 1, gz) || T.isWater(gx - 1, gz) || T.isWater(gx, gz + 1) || T.isWater(gx, gz - 1)));
  assert.equal(p.absorbed, undefined);
  // And an island that has never grown hashes exactly as it did: no field, no levelling.
  assert.equal(layout.grow, null);
  assert.equal(layout.terrainHash, T.hash);
});

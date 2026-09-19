// The island has one quay, and the boat ties up at it.
//
// It had two. shared/quay.mjs picked a site off `island.landing` - which is right for an
// island you only know from a datagram, and was also used for the island you are standing
// on, which has a quay district with planks of its own recorded in data/layout.json. On
// this machine those two came out thirty cells apart: the kade at [74..70,198] with the
// quayside houses along it and the visitors sailing up to it, and a second pier at
// [200..204,156] on the far coast with the deck, the boat and the prompt on it. So the
// kade was scenery you could not walk on and there was no boat at the harbour.
//
// What has to hold now: where a village has planks, they are the quay - the same run of
// cells, the same shore, a berth in water beside the head - and where it has none, or
// where the ones it has no longer stand over water, the old derivation still answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, placeAll } from '../lib/layout.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { quayFor, mooringFor, planksOf } from '../shared/quay.mjs';

const SIZE = 128;
const SEEDS = [1337, 7, 90210];

// The smallest village with a quay in it - tests/quay-district.test.mjs makes the same one,
// for the same reason: a Cowork district is the only thing that earns planks.
function coworkVillage(houses = 7) {
  const startedAt = Date.UTC(2026, 0, 2);
  return {
    districts: [{ id: 'quay', kind: 'quay', name: 'The Quay', population: houses, firstSeenAt: startedAt }],
    buildings: Array.from({ length: houses }, (_, i) => ({
      id: `house:cowork-${i}`, sessionId: `cowork-${i}`, kind: 'house', district: 'quay',
      harbour: true, tier: 'hut', startedAt: startedAt + i * 1000,
    })),
    milestones: [],
    furniture: [],
    stats: { settlers: houses },
  };
}

// What scan.mjs writes into data/village.json out of a planned layout: the district, with
// its planks and the ramp cell behind them.
function shipped(layout) {
  const q = layout.districts.quay;
  return { districts: [{ id: 'quay', kind: 'quay', pier: q.pier, shore: q.shore }] };
}

for (const seed of SEEDS) {
  test(`the quay is the kade the village built (seed ${seed})`, () => {
    const layout = emptyLayout(seed, SIZE);
    const { terrain } = placeAll(layout, coworkVillage(), { seed, size: SIZE });
    const built = layout.districts.quay;
    assert.ok(built.pier.length, 'the village has planks');

    const village = shipped(layout);
    const planks = planksOf(village);
    assert.deepEqual(planks.pier, built.pier, 'planksOf hands back the district own pier');

    const quay = quayFor(terrain, [terrain.half, terrain.half], planks);
    assert.ok(quay, 'the planks make a quay');
    assert.deepEqual(quay.cells, built.pier, 'the quay stands on the planks the village laid');
    assert.deepEqual(quay.shore, built.shore, 'and starts at the ramp cell the layout recorded');

    // The hull lies beside the head, not on it, and in water deep enough to float in.
    const m = mooringFor('home', terrain, [terrain.half, terrain.half], [0, 0], planks);
    assert.equal(m.id, 'boat:home');
    assert.ok(terrain.worldHeight(m.x, m.z) < 0, 'the boat is moored in water');
    const [hx, hz] = quay.head;
    assert.ok(Math.hypot(m.x - hx, m.z - hz) < 2, 'and alongside the end of the planks');
  });

  test(`an island with no districts still gets the derived quay (seed ${seed})`, () => {
    const terrain = makeTerrain(seed, SIZE);
    const landing = terrain.landCells[0];
    const bare = quayFor(terrain, landing);
    assert.deepEqual(quayFor(terrain, landing, planksOf(null)), bare, 'no village, same answer as before');
    assert.deepEqual(quayFor(terrain, landing, planksOf({ districts: [] })), bare, 'no quay district either');
  });
}

test('planks the ground no longer agrees with are refused, not moored over', () => {
  const seed = 1337;
  const layout = emptyLayout(seed, SIZE);
  const { terrain } = placeAll(layout, coworkVillage(), { seed, size: SIZE });
  const good = planksOf(shipped(layout));
  const derived = quayFor(terrain, [terrain.half, terrain.half]);

  // A layout written before a polder was drained: the planks are over a field now. The
  // shore cell of a quay is land by construction, so lying the run back onto it is the
  // shortest way to say "these cells are not water any more".
  const drained = { pier: good.pier.map(() => good.shore), shore: good.shore };
  assert.deepEqual(quayFor(terrain, [terrain.half, terrain.half], drained), derived, 'dry planks fall back');

  // A bundle that arrived from somebody else's socket, with a bend in it. Three cells, not
  // two: two cells are a bearing whichever way they lie, and it takes a third to disagree.
  const bent = { pier: [good.pier[0], good.pier[1], [good.pier[1][0], good.pier[1][1] + 1]], shore: good.shore };
  assert.deepEqual(quayFor(terrain, [terrain.half, terrain.half], bent), derived, 'a bent run falls back');

  // And one whose first plank is not next to any land: planks that start out at sea.
  const adrift = { pier: good.pier.slice(2), shore: null };
  assert.deepEqual(quayFor(terrain, [terrain.half, terrain.half], adrift), derived, 'planks off the shore fall back');

  // The real ones are not refused by any of that.
  assert.deepEqual(quayFor(terrain, [terrain.half, terrain.half], good).cells, good.pier);
});

test('a single plank needs its shore cell, and is trusted once it has one', () => {
  const seed = 1337;
  const layout = emptyLayout(seed, SIZE);
  const { terrain } = placeAll(layout, coworkVillage(), { seed, size: SIZE });
  const good = planksOf(shipped(layout));
  const one = [good.pier[0]];
  const derived = quayFor(terrain, [terrain.half, terrain.half]);

  // Two planks say which way they run; one does not, so without the shore there is no
  // bearing to take and nothing to do but fall back.
  assert.deepEqual(quayFor(terrain, [terrain.half, terrain.half], { pier: one, shore: null }), derived);
  const q = quayFor(terrain, [terrain.half, terrain.half], { pier: one, shore: good.shore });
  assert.deepEqual(q.cells, one, 'with the ramp cell it knows which way the sea is');
  assert.deepEqual(q.shore, good.shore);
});

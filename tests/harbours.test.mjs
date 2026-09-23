// Four harbours instead of one quay, each with a road to the square (Plans/vier-havens.md).
//
// As in quay-district.test.mjs, nothing here asserts a coordinate - every seed puts its
// coast somewhere else. What has to hold: one harbour per side at most, on that side of the
// town and over open sea; the quay the island already shows is one of them rather than a
// fifth beside it; every harbour has a way to the square; and planning them is a thing that
// happens once, so a second scan writes exactly the layout the first one did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, placeAll, sideOf, HARBOUR_SIDES } from '../lib/layout.mjs';

const SIZE = 128;
const SEEDS = [1337, 7, 90210];

// Open sea worked out again here, for quay-district.test.mjs's reason.
function seaCells(terrain) {
  const n = terrain.size;
  const seen = new Set();
  const queue = [];
  const push = (gx, gz) => {
    if (gx < 0 || gz < 0 || gx >= n || gz >= n) return;
    const key = `${gx},${gz}`;
    if (seen.has(key) || !terrain.isWater(gx, gz) || terrain.isRiver(gx, gz)) return;
    seen.add(key);
    queue.push([gx, gz]);
  };
  for (let g = 0; g < n; g++) { push(g, 0); push(g, n - 1); push(0, g); push(n - 1, g); }
  for (let h = 0; h < queue.length; h++) {
    const [gx, gz] = queue[h];
    push(gx + 1, gz); push(gx - 1, gz); push(gx, gz + 1); push(gx, gz - 1);
  }
  return seen;
}

function village({ cowork = 0, settlers = 12 } = {}) {
  const startedAt = Date.UTC(2026, 0, 2);
  const districts = [{ id: 'p:d:\\git\\farm', kind: 'project', name: 'farm', population: settlers, firstSeenAt: startedAt }];
  const buildings = Array.from({ length: settlers }, (_, i) => ({
    id: `house:farm-${i}`, sessionId: `farm-${i}`, kind: 'house', district: districts[0].id,
    tier: 'hut', startedAt: startedAt + i * 1000,
  }));
  if (cowork) {
    districts.push({ id: 'quay', kind: 'quay', name: 'The Quay', population: cowork, firstSeenAt: startedAt });
    for (let i = 0; i < cowork; i++) {
      buildings.push({ id: `house:cowork-${i}`, sessionId: `cowork-${i}`, kind: 'house', district: 'quay', harbour: true, tier: 'hut', startedAt: startedAt + i * 1000 });
    }
  }
  return { districts, buildings, milestones: [], furniture: [], stats: { settlers: settlers + cowork } };
}

const key = (c) => `${c[0]},${c[1]}`;

for (const seed of SEEDS) {
  test(`four harbours, one per side, each over the sea with a road to the square (seed ${seed})`, () => {
    const layout = emptyLayout(seed, SIZE);
    const { terrain } = placeAll(layout, village({ cowork: 5 }), { seed, size: SIZE });
    assert.ok(Array.isArray(layout.harbours), 'the harbours were planned');
    assert.equal(layout.harbours.length, HARBOUR_SIDES.length);
    const built = layout.harbours.filter(Boolean);
    assert.ok(built.length >= 2, `only ${built.length} harbour(s) on seed ${seed}`);

    const sea = seaCells(terrain);
    const centre = layout.town && layout.town.centre;
    layout.harbours.forEach((h, n) => {
      if (!h) return;
      assert.equal(h.side, HARBOUR_SIDES[n], 'each harbour sits in its own slot');
      if (centre) assert.equal(sideOf(h.shore, centre), h.side, `the ${h.side} harbour is on the ${h.side} side`);
      for (const c of h.pier) assert.ok(sea.has(key(c)), `plank ${key(c)} of the ${h.side} harbour is over open sea`);
      assert.ok(h.slip.length >= 1, 'a slipway off the beach');
      const slip = layout.paths.find((p) => p.id === `road:harbour:${n}`);
      assert.ok(slip, `the ${h.side} slipway is a road`);
      const approach = layout.paths.find((p) => p.id === `road:harbour:${n}:approach`);
      assert.ok(approach && approach.cells.length >= 1, `the ${h.side} harbour has a road to the square`);
    });

    // The quay is one of them, not a fifth.
    const quay = layout.districts.quay;
    assert.ok(quay && quay.pier.length, 'the island has a quay');
    assert.ok(built.some((h) => key(h.shore) === key(quay.shore) && JSON.stringify(h.pier) === JSON.stringify(quay.pier)),
      "the quay's planks are one harbour's planks");
  });

  test(`planning the harbours happens once: a second scan changes nothing (seed ${seed})`, () => {
    const layout = emptyLayout(seed, SIZE);
    const model = village({ cowork: 5 });
    placeAll(layout, model, { seed, size: SIZE });
    const first = JSON.stringify(layout);
    placeAll(layout, model, { seed, size: SIZE });
    assert.equal(JSON.stringify(layout), first);
  });
}

test('a quay founded after the harbours takes one of them rather than picking its own', () => {
  const seed = 1337;
  const layout = emptyLayout(seed, SIZE);
  placeAll(layout, village(), { seed, size: SIZE });              // no Cowork task yet
  const harbours = JSON.stringify(layout.harbours);
  placeAll(layout, village({ cowork: 5 }), { seed, size: SIZE });  // and now there is one
  assert.equal(JSON.stringify(layout.harbours), harbours, 'the harbours did not move');
  const quay = layout.districts.quay;
  assert.ok(quay && quay.pier.length);
  assert.ok(layout.harbours.some((h) => h && JSON.stringify(h.pier) === JSON.stringify(quay.pier)));
});

test('sideOf splits the compass by the larger offset, north being -z', () => {
  const c = [10, 10];
  assert.equal(sideOf([10, 2], c), 'n');
  assert.equal(sideOf([10, 18], c), 's');
  assert.equal(sideOf([18, 11], c), 'e');
  assert.equal(sideOf([2, 9], c), 'w');
});

// The page and the sea read the harbours through shared/quay.mjs, and have to get the same
// docks out of the same village that the layout put in. And a village from before there
// were harbours - an older islander, an old bundle - still gets its one quay.
import { quaysOf } from '../shared/quay.mjs';

test('quaysOf hands back one dock per harbour, and the one quay of old without them', () => {
  const seed = 7;
  const layout = emptyLayout(seed, SIZE);
  const { terrain } = placeAll(layout, village({ cowork: 5 }), { seed, size: SIZE });
  const harbours = layout.harbours.filter(Boolean).map((h) => ({ side: h.side, shore: h.shore, pier: h.pier }));
  const withHarbours = { island: { landing: layout.landing, harbours }, districts: [] };
  const docks = quaysOf(terrain, withHarbours, layout.landing);
  assert.equal(docks.length, harbours.length);
  assert.deepEqual(docks.map((d) => d.side), harbours.map((h) => h.side));
  for (const [i, d] of docks.entries()) assert.deepEqual(d.cells, harbours[i].pier, `dock ${d.side} is its harbour's planks`);

  const old = { island: { landing: layout.landing }, districts: [{ id: 'quay', pier: layout.districts.quay.pier, shore: layout.districts.quay.shore }] };
  const one = quaysOf(terrain, old, layout.landing);
  assert.equal(one.length, 1);
  assert.equal(one[0].side, null);
  assert.deepEqual(one[0].cells, layout.districts.quay.pier);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyLayout, placeAll } from '../lib/layout.mjs';
import { makeModel, grow, plotsOf } from './helpers/model.mjs';
import { requireIslandStopped } from './helpers/island-stopped.mjs';

// The promise the whole island rests on: a house never moves. It is stated in README.md and
// in docs/branches.md, and until now it was only ever checked by hand.
//
// These drive placeAll directly - no scan, no transcripts, no clock - so a failure points at
// the placement rules and nothing else.

const SEED = 1337;
const SIZE = 64;
const VILLAGE = [
  { name: 'repo-a', houses: 8, sheds: 1 },
  { name: 'repo-b', houses: 5 },
  { name: 'repo-c', houses: 3 },
];

function place(layout, specs, opts) {
  return placeAll(layout, makeModel(specs, opts), { seed: SEED, size: SIZE });
}

test.before(() => requireIslandStopped());

test('a house never moves when the village grows', () => {
  const layout = emptyLayout(SEED, SIZE);
  const first = place(layout, VILLAGE);
  const before = plotsOf(layout);

  assert.deepEqual(first.unplaced, [], 'everyone should have found a plot');
  assert.ok(Object.keys(before).length >= 16, `expected a populated island, got ${Object.keys(before).length} plots`);

  const second = place(layout, grow(VILLAGE, 4));
  const after = plotsOf(layout);

  assert.deepEqual(second.unplaced, [], 'the newcomers should have found plots too');
  for (const [id, plot] of Object.entries(before)) {
    assert.deepEqual(after[id], plot, `${id} moved`);
  }
  assert.ok(
    Object.keys(after).length > Object.keys(before).length,
    'the twelve new houses should have been added');
});

test('the order the buildings arrive in does not decide where they stand', () => {
  // placeAll sorts internally on startedAt. If a sort key ever goes unstable - a float
  // comparison, a Map iteration order - this is what notices.
  const straight = emptyLayout(SEED, SIZE);
  place(straight, VILLAGE);

  const shuffled = emptyLayout(SEED, SIZE);
  const model = makeModel(VILLAGE);
  model.buildings.reverse();
  model.districts.reverse();
  placeAll(shuffled, model, { seed: SEED, size: SIZE });

  assert.deepEqual(plotsOf(shuffled), plotsOf(straight));
});

test('removing a settler leaves every other plot where it was', () => {
  const layout = emptyLayout(SEED, SIZE);
  place(layout, VILLAGE);
  const before = plotsOf(layout);

  // A session that never wrote a transcript loses its plot (scan.mjs does exactly this).
  // The land goes back to the island; nobody else may shift onto it.
  const victim = 'house:repo-b-002';
  assert.ok(before[victim], 'the fixture should contain the house we are removing');
  delete layout.plots[victim];

  const thinned = VILLAGE.map((s) => (s.name === 'repo-b' ? { ...s, houses: s.houses - 1 } : s));
  place(layout, thinned);
  const after = plotsOf(layout);

  for (const [id, plot] of Object.entries(before)) {
    if (id === victim) continue;
    assert.deepEqual(after[id], plot, `${id} moved after ${victim} was removed`);
  }
});

test('land given back is land the next arrival gets', () => {
  const layout = emptyLayout(SEED, SIZE);
  place(layout, VILLAGE);

  // scan.mjs frees the plot of a session that was banished or never wrote a transcript.
  // Its sheds go with it - a shed sits in a corner cell of its master's own plot (the
  // "shed in the garden" the README promises), so leaving one behind keeps the whole 3x3
  // block occupied and the land could never be handed on.
  const victim = 'house:repo-a-003';
  const freed = { ...layout.plots[victim] };
  assert.ok(freed.cell, 'the fixture house should own a super-cell');
  for (const id of Object.keys(layout.plots)) {
    if (id === victim || id.startsWith('shed:repo-a-003:')) delete layout.plots[id];
  }

  // The same village, minus that settler, plus one who arrives today.
  const model = makeModel(VILLAGE);
  model.buildings = model.buildings.filter((b) => b.id !== victim && b.master !== victim);
  model.buildings.push({
    id: 'house:repo-a-latecomer',
    sessionId: 'latecomer',
    kind: 'house',
    district: model.districts[0].id,
    startedAt: Date.parse('2027-01-01T00:00:00.000Z'),
    tier: 'cottage',
    harbour: false,
  });
  placeAll(layout, model, { seed: SEED, size: SIZE });

  const taken = layout.plots['house:repo-a-latecomer'];
  assert.ok(taken, 'the latecomer should have been placed');
  assert.deepEqual(taken.cell, freed.cell, 'on the freed super-cell');
  assert.equal(taken.gx, freed.gx);
  assert.equal(taken.gz, freed.gz);
});

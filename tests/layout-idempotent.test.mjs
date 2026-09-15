import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyLayout, placeAll } from '../lib/layout.mjs';
import { makeModel } from './helpers/model.mjs';
import { testLots } from './helpers/world.mjs';
import { requireIslandStopped } from './helpers/island-stopped.mjs';

// "Two consecutive scans leave layout.json byte-identical." docs/branches.md states it as the
// thing to check by hand before merging a layout change. It is also the invariant with no
// visible symptom: everything looks right, and weeks later houses shuffle on every scan.
//
// layout.json carries no timestamp, so this really is a byte comparison.

const SEED = 1337;
const { lots, worldRev } = testLots(SEED);
const SIZE = lots.size;
const VILLAGE = [
  { name: 'repo-a', houses: 8, sheds: 2 },
  { name: 'repo-b', houses: 5, sheds: 1 },
  { name: 'repo-c', houses: 3 },
  { name: 'repo-d', houses: 1 },              // a lone farmstead: no hamlet, no road
];
const MILESTONES = ['townhall', 'well', 'market', 'tavern', 'lighthouse', 'windmill'];

// A second village, past the first square threshold and with every civic building the
// milestones can unlock. Both are needed for the case in the last test in this file: the
// square only widens to five cells at thirty settlers, and only then do the one-cell plots
// on it fall inside ground the town paves.
const TOWN = [
  { name: 'repo-a', houses: 9 }, { name: 'repo-b', houses: 7 }, { name: 'repo-c', houses: 5 },
  { name: 'repo-d', houses: 4 }, { name: 'repo-e', houses: 3 }, { name: 'repo-f', houses: 3 },
  { name: 'repo-g', houses: 1 },
];
const CIVIC = ['townhall', 'well', 'market', 'tavern', 'chapel', 'school', 'lighthouse', 'windmill'];

test.before(() => requireIslandStopped());

test('scanning the same village twice changes nothing', () => {
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, makeModel(VILLAGE, { milestones: MILESTONES }), { lots, seed: SEED, worldRev });
  const once = JSON.stringify(layout);

  placeAll(layout, makeModel(VILLAGE, { milestones: MILESTONES }), { lots, seed: SEED, worldRev });
  const twice = JSON.stringify(layout);

  assert.equal(twice, once, 'a second scan of an unchanged village rewrote the layout');
});

test('and a third time, and a fourth', () => {
  // Not padding: a rule that settles after two passes but oscillates on the third would
  // pass the check above and still rewrite layout.json on every scan forever.
  const layout = emptyLayout(SEED, SIZE);
  const snapshots = [];
  for (let i = 0; i < 4; i++) {
    placeAll(layout, makeModel(VILLAGE, { milestones: MILESTONES }), { lots, seed: SEED, worldRev });
    snapshots.push(JSON.stringify(layout));
  }
  assert.equal(snapshots[1], snapshots[0]);
  assert.equal(snapshots[2], snapshots[0]);
  assert.equal(snapshots[3], snapshots[0]);
});

test('planning from scratch twice gives the same island', () => {
  // Determinism across runs, not just across repeats: no Map iteration order, no float
  // comparison, no Date.now() may reach a placement decision.
  const a = emptyLayout(SEED, SIZE);
  placeAll(a, makeModel(VILLAGE, { milestones: MILESTONES }), { lots, seed: SEED, worldRev });
  const b = emptyLayout(SEED, SIZE);
  placeAll(b, makeModel(VILLAGE, { milestones: MILESTONES }), { lots, seed: SEED, worldRev });

  assert.equal(JSON.stringify(b), JSON.stringify(a));
});

test('growing the village and rescanning settles immediately', () => {
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, makeModel(VILLAGE, { milestones: MILESTONES }), { lots, seed: SEED, worldRev });

  const bigger = VILLAGE.map((s) => ({ ...s, houses: s.houses + 3 }));
  placeAll(layout, makeModel(bigger, { milestones: MILESTONES }), { lots, seed: SEED, worldRev });
  const grown = JSON.stringify(layout);

  placeAll(layout, makeModel(bigger, { milestones: MILESTONES }), { lots, seed: SEED, worldRev });
  assert.equal(JSON.stringify(layout), grown, 'the scan after a growth spurt rewrote the layout');
});

test('a town with a civic quarter on its square settles too', () => {
  // The case the village above is too small to reach. `town.paved` used to be gathered by
  // the two blocks that lay the stone, and both run before the civic quarter is complete:
  // the sprint board, the island's board and a well on the square are written into
  // `layout.plots` without ever being stamped on the cell grid. So the scan that founded
  // one paved the cell it stands on, and the next scan found that cell marked PLOT by the
  // replay at the top of placeAll and skipped it - two cells fewer, on a village where
  // nothing had moved. It needs a five-wide square and buildings around it, so it lives in
  // a village of its own rather than in the fixture above.
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, makeModel(TOWN, { milestones: CIVIC }), { lots, seed: SEED, worldRev });
  const once = JSON.stringify(layout);

  placeAll(layout, makeModel(TOWN, { milestones: CIVIC }), { lots, seed: SEED, worldRev });
  assert.equal(JSON.stringify(layout), once, 'the scan after a founding rewrote the layout');

  // And the stone really is under them, or the check above would pass on a town that had
  // simply stopped paving the cells its boards stand on. These are the two that used to be
  // dropped on this village; `civic:issues` is not one of them, because on this seed its
  // fixed corner of the square is water and it was never paved on either scan.
  const paved = new Set(layout.town.paved.map((c) => `${c[0]},${c[1]}`));
  for (const id of ['civic:board', 'civic:well']) {
    const p = layout.plots[id];
    assert.ok(p, `${id} was never placed, so this test proves nothing`);
    assert.ok(paved.has(`${p.gx},${p.gz}`), `${id} stands on a hole in the square`);
  }
});

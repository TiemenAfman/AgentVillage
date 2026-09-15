import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyLayout, placeAll } from '../lib/layout.mjs';
import { makeModel } from './helpers/model.mjs';
import { requireIslandStopped } from './helpers/island-stopped.mjs';

// "Two consecutive scans leave layout.json byte-identical." docs/branches.md states it as the
// thing to check by hand before merging a layout change. It is also the invariant with no
// visible symptom: everything looks right, and weeks later houses shuffle on every scan.
//
// layout.json carries no timestamp, so this really is a byte comparison.

const SEED = 1337;
const SIZE = 64;
const VILLAGE = [
  { name: 'repo-a', houses: 8, sheds: 2 },
  { name: 'repo-b', houses: 5, sheds: 1 },
  { name: 'repo-c', houses: 3 },
  { name: 'repo-d', houses: 1 },              // a lone farmstead: no hamlet, no road
];
const MILESTONES = ['townhall', 'well', 'market', 'tavern', 'lighthouse', 'windmill'];

test.before(() => requireIslandStopped());

test('scanning the same village twice changes nothing', () => {
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, makeModel(VILLAGE, { milestones: MILESTONES }), { seed: SEED, size: SIZE });
  const once = JSON.stringify(layout);

  placeAll(layout, makeModel(VILLAGE, { milestones: MILESTONES }), { seed: SEED, size: SIZE });
  const twice = JSON.stringify(layout);

  assert.equal(twice, once, 'a second scan of an unchanged village rewrote the layout');
});

test('and a third time, and a fourth', () => {
  // Not padding: a rule that settles after two passes but oscillates on the third would
  // pass the check above and still rewrite layout.json on every scan forever.
  const layout = emptyLayout(SEED, SIZE);
  const snapshots = [];
  for (let i = 0; i < 4; i++) {
    placeAll(layout, makeModel(VILLAGE, { milestones: MILESTONES }), { seed: SEED, size: SIZE });
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
  placeAll(a, makeModel(VILLAGE, { milestones: MILESTONES }), { seed: SEED, size: SIZE });
  const b = emptyLayout(SEED, SIZE);
  placeAll(b, makeModel(VILLAGE, { milestones: MILESTONES }), { seed: SEED, size: SIZE });

  assert.equal(JSON.stringify(b), JSON.stringify(a));
});

test('growing the village and rescanning settles immediately', () => {
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, makeModel(VILLAGE, { milestones: MILESTONES }), { seed: SEED, size: SIZE });

  const bigger = VILLAGE.map((s) => ({ ...s, houses: s.houses + 3 }));
  placeAll(layout, makeModel(bigger, { milestones: MILESTONES }), { seed: SEED, size: SIZE });
  const grown = JSON.stringify(layout);

  placeAll(layout, makeModel(bigger, { milestones: MILESTONES }), { seed: SEED, size: SIZE });
  assert.equal(JSON.stringify(layout), grown, 'the scan after a growth spurt rewrote the layout');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyLayout, placeAll, SQUARE_STEPS } from '../lib/layout.mjs';
import { makeModel } from './helpers/model.mjs';
import { requireIslandStopped } from './helpers/island-stopped.mjs';

// The town is the anchor of everything: the super-lattice is placed relative to town.centre
// (latticeOf), so if the centre ever moved, every super-cell index on the island would shift
// and every house with it. It is the single most load-bearing coordinate in the project.

const SEED = 1337;
const SIZE = 64;
const specs = (houses) => [
  { name: 'repo-a', houses: Math.ceil(houses * 0.5) },
  { name: 'repo-b', houses: Math.ceil(houses * 0.3) },
  { name: 'repo-c', houses: Math.max(1, houses - Math.ceil(houses * 0.5) - Math.ceil(houses * 0.3)) },
];

function grow(layout, settlers) {
  return placeAll(layout, makeModel(specs(settlers), { settlers, milestones: ['townhall', 'well'] }),
    { seed: SEED, size: SIZE });
}

test.before(() => requireIslandStopped());

test('the town centre never moves as the village grows', () => {
  // town.centre is the anchor the whole super-lattice hangs off (latticeOf). town.square is
  // the min corner of the paving and therefore *has* to move outward as the square widens -
  // that is geometry, not drift. The centre and the lattice are what must never budge.
  const layout = emptyLayout(SEED, SIZE);
  grow(layout, 5);
  const centre = [...layout.town.centre];
  const anchor = [...layout.lattice.anchor];
  const pitch = layout.lattice.pitch;

  for (const settlers of [12, 30, 45, 90, 120]) {
    grow(layout, settlers);
    assert.deepEqual(layout.town.centre, centre, `the centre moved at ${settlers} settlers`);
    assert.deepEqual(layout.lattice.anchor, anchor, `the lattice anchor moved at ${settlers} settlers`);
    assert.equal(layout.lattice.pitch, pitch);
  }
});

test('the square only ever widens, around the same middle', () => {
  const layout = emptyLayout(SEED, SIZE);
  grow(layout, 5);
  // Below the first threshold the layout stores no size at all; scan.mjs publishes the
  // three-cell default. Anything else here would be asserting a field that is meant to
  // be absent.
  assert.equal(layout.town.size, undefined, 'a young village stores no square size');

  const widthOf = (l) => l.town.size || 3;
  const seen = [];
  let prev = { corner: [...layout.town.square], width: widthOf(layout) };

  for (const settlers of [10, 29, 30, 60, 89, 90, 150]) {
    grow(layout, settlers);
    const corner = layout.town.square;
    const width = widthOf(layout);
    seen.push([settlers, width]);

    assert.ok(width >= prev.width, `the square shrank to ${width} at ${settlers} settlers`);
    // The new square must cover every stone of the old one: paving is never lifted.
    assert.ok(
      corner[0] <= prev.corner[0] && corner[1] <= prev.corner[1]
      && corner[0] + width >= prev.corner[0] + prev.width
      && corner[1] + width >= prev.corner[1] + prev.width,
      `the square at ${settlers} settlers does not contain the one before it`);
    prev = { corner: [...corner], width };
  }

  const at = Object.fromEntries(seen);
  assert.equal(at[29], 3, 'still three cells one settler short of the first step');
  assert.equal(at[30], SQUARE_STEPS[0].size, 'widens exactly at the first threshold');
  assert.equal(at[89], SQUARE_STEPS[0].size);
  assert.equal(at[90], SQUARE_STEPS[1].size, 'widens exactly at the second threshold');
  assert.equal(at[150], SQUARE_STEPS[1].size, 'and stops there');
});

test('paving is only ever added, never taken away', () => {
  // A cell that stopped being paved would be a hole in the middle of the plaza, and
  // `cleared` would still call it bald ground. A length check alone would miss a swap.
  const layout = emptyLayout(SEED, SIZE);
  grow(layout, 10);
  let before = new Set(layout.town.paved.map((c) => `${c[0]},${c[1]}`));

  for (const settlers of [30, 60, 90, 120]) {
    grow(layout, settlers);
    const after = new Set(layout.town.paved.map((c) => `${c[0]},${c[1]}`));
    for (const cell of before) {
      assert.ok(after.has(cell), `paving at ${cell} was lifted at ${settlers} settlers`);
    }
    before = after;
  }
});

test('the commons only ever grows', () => {
  const layout = emptyLayout(SEED, SIZE);
  grow(layout, 10);
  let before = new Set(layout.town.commons.map((c) => `${c[0]},${c[1]}`));

  for (const settlers of [30, 60, 120]) {
    grow(layout, settlers);
    const after = new Set(layout.town.commons.map((c) => `${c[0]},${c[1]}`));
    for (const cell of before) {
      assert.ok(after.has(cell), `the commons lost super-cell ${cell} at ${settlers} settlers`);
    }
    before = after;
  }
});

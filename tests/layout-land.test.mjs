import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyLayout, placeAll } from '../lib/layout.mjs';
import { makeModel } from './helpers/model.mjs';
import { requireIslandStopped } from './helpers/island-stopped.mjs';

// Land is owned, in super-cells, and ownership is as sticky as a plot. A district that lost
// a super-cell would have a house standing on someone else's ground.

const SEED = 1337;
const SIZE = 64;
const VILLAGE = [
  { name: 'repo-a', houses: 8, sheds: 2 },
  { name: 'repo-b', houses: 5, sheds: 1 },
  { name: 'repo-c', houses: 3 },
];

const ownedBy = (layout) => {
  const out = new Map();
  for (const [id, rec] of Object.entries(layout.districts)) {
    const cells = new Set();
    for (const lobe of rec.lobes || []) for (const c of lobe.cells) cells.add(`${c[0]},${c[1]}`);
    out.set(id, cells);
  }
  return out;
};

test.before(() => requireIslandStopped());

test('a district never loses a super-cell', () => {
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, makeModel(VILLAGE), { seed: SEED, size: SIZE });
  const before = ownedBy(layout);

  placeAll(layout, makeModel(VILLAGE.map((s) => ({ ...s, houses: s.houses + 5 }))), { seed: SEED, size: SIZE });
  const after = ownedBy(layout);

  for (const [id, cells] of before) {
    const now = after.get(id);
    assert.ok(now, `district ${id} vanished`);
    for (const cell of cells) assert.ok(now.has(cell), `${id} lost super-cell ${cell}`);
  }
});

test('no super-cell is ever owned by two districts', () => {
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, makeModel(VILLAGE), { seed: SEED, size: SIZE });
  placeAll(layout, makeModel(VILLAGE.map((s) => ({ ...s, houses: s.houses + 5 }))), { seed: SEED, size: SIZE });

  const owner = new Map();
  for (const [id, cells] of ownedBy(layout)) {
    for (const cell of cells) {
      assert.ok(!owner.has(cell), `super-cell ${cell} is owned by both ${owner.get(cell)} and ${id}`);
      owner.set(cell, id);
    }
  }
});

test('two parcels never touch: the green belt holds', () => {
  // BELT = 1 in lib/layout.mjs. The gap between two hamlets is the countryside, and it is
  // what makes a hamlet read as its own place rather than as a suburb of its neighbour.
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, makeModel(VILLAGE), { seed: SEED, size: SIZE });

  const owner = new Map();
  for (const [id, cells] of ownedBy(layout)) for (const cell of cells) owner.set(cell, id);

  for (const [cell, id] of owner) {
    const [i, j] = cell.split(',').map(Number);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const neighbour = owner.get(`${i + di},${j + dj}`);
        assert.ok(
          !neighbour || neighbour === id,
          `${id} at ${cell} is touching ${neighbour} - the green belt is gone`);
      }
    }
  }
});

test('no two houses share ground, and every shed sits in the yard of its master', () => {
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, makeModel(VILLAGE), { seed: SEED, size: SIZE });

  const big = Object.entries(layout.plots).filter(([, p]) => p.w === 3);
  for (let a = 0; a < big.length; a++) {
    for (let b = a + 1; b < big.length; b++) {
      const [ida, pa] = big[a];
      const [idb, pb] = big[b];
      const overlap = pa.gx < pb.gx + pb.w && pa.gx + pa.w > pb.gx
        && pa.gz < pb.gz + pb.d && pa.gz + pa.d > pb.gz;
      assert.ok(!overlap, `${ida} and ${idb} stand on the same ground`);
    }
  }

  // A shed *does* sit inside its master's 3x3 lot - that is the "shed in the garden" the
  // README promises, and it is why a house must never be drawn over its whole plot. Named
  // here so the intent is written down rather than rediscovered as a bug.
  const sheds = Object.entries(layout.plots).filter(([id]) => id.startsWith('shed:'));
  assert.ok(sheds.length > 0, 'the fixture should have placed some sheds');
  for (const [id, s] of sheds) {
    assert.equal(s.w, 1, `${id} should take a single cell`);
    const masterId = id.slice('shed:'.length).replace(/:[^:]*$/, '');
    const master = layout.plots[`house:${masterId}`];
    assert.ok(master, `${id} should have a master with a plot`);
    const chebyshev = Math.max(
      Math.abs(s.gx - master.gx), Math.abs(s.gz - master.gz));
    assert.ok(chebyshev <= 4, `${id} stands ${chebyshev} cells from its master - that is not a yard`);
  }
});

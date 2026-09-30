// The helper the water tests measure with (tests/support/water-bodies.mjs) gets its own
// test first: a measuring stick nobody has checked is worth nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain } from '../shared/terrain.mjs';
import { waterBodies, pondCount, enclosedCells, fairwayOpen } from './support/water-bodies.mjs';

// A terrain drawn in text: '~' is water, anything else land. Only what the helper reads.
function fake(rows) {
  const size = rows.length;
  return { size, isWater: (gx, gz) => gx < 0 || gz < 0 || gx >= size || gz >= size || rows[gz][gx] === '~' };
}

const RING = fake([
  '~~~~~~~~',
  '~......~',
  '~..~~..~',   // a pond of five cells shut in by land...
  '~..~~~.~',
  '~.~....~',   // ...and two single cells that touch each other only diagonally
  '~..~...~',
  '~......~',
  '~~~~~~~~',
]);

test('a body is a 4-connected flood, and open when it reaches the rim of the grid', () => {
  const bodies = waterBodies(RING);
  const open = bodies.filter((b) => b.open), shut = bodies.filter((b) => !b.open);
  assert.equal(open.length, 1, 'the sea round the rim is one body');
  assert.equal(shut.length, 3);
  // (3,2) (4,2) (3,3) (4,3) (5,3) touch along their sides: one body of five cells.
  const lake = shut.find((b) => b.size === 5);
  assert.ok(lake, 'the pond in the middle is one body of five cells');
  assert.deepEqual(lake.bbox, { x0: 3, z0: 2, x1: 5, z1: 3 });
  assert.equal(lake.cells.length, lake.size);
  // (2,4) and (3,5) meet at a corner only: a diagonal is not a channel, so two bodies.
  assert.equal(shut.filter((b) => b.size === 1).length, 2);
  assert.equal(shut.reduce((n, b) => n + b.size, 0), enclosedCells(RING));
  assert.equal(pondCount(RING), 3);
  assert.equal(enclosedCells(RING), 7);
});

test('every water cell is in exactly one body', () => {
  for (const t of [RING, makeTerrain(1337, { size: 64 }), makeTerrain('harbour', { size: 64 })]) {
    let water = 0;
    for (let z = 0; z < t.size; z++) for (let x = 0; x < t.size; x++) if (t.isWater(x, z)) water++;
    const seen = new Set();
    for (const b of waterBodies(t)) for (const [x, z] of b.cells) {
      const k = x + z * t.size;
      assert.ok(!seen.has(k), `cell ${x},${z} in two bodies`);
      seen.add(k);
      assert.ok(t.isWater(x, z));
    }
    assert.equal(seen.size, water);
  }
});

test('the fairway is open when any cell of it lies in water that reaches the sea', () => {
  const t = fake([
    '~~~~~~',
    '~....~',
    '~.~~.~',
    '~....~',
    '~....~',
    '~~~~~~',
  ]);
  assert.equal(pondCount(t), 1);
  assert.equal(fairwayOpen(t, { cells: [[2, 2], [3, 2]] }), false, 'a channel in the pond is landlocked');
  assert.equal(fairwayOpen(t, { cells: [[2, 2], [3, 2], [0, 2]] }), true, 'one cell in the sea is enough');
  assert.equal(fairwayOpen(t, { cells: [[1, 1]] }), false, 'a dry cell is in no body');
  assert.equal(fairwayOpen(t, { cells: [] }), false);
  assert.equal(fairwayOpen(t, null), false);
});

test('on a real terrain: a channel dug to the sea is open, one dug inland is not', () => {
  const t0 = makeTerrain(1337, { size: 64 });
  const sea = waterBodies(t0).find((b) => b.open);
  assert.ok(sea && sea.size > 100, 'the open sea is a body');
  // A cell in the sea is open by the helper's own definition; a fairway made of it says so.
  assert.equal(fairwayOpen(t0, { cells: [sea.cells[0]] }), true);
  // A channel of a single cell in the middle of the island, dug on dry land, is a pond.
  const land = t0.landCells.find(([gx, gz]) => gx > 20 && gx < 44 && gz > 20 && gz < 44 && t0.isBuildable(gx, gz));
  assert.ok(land);
  const dug = makeTerrain(1337, { size: 64, fairway: { cells: [land] } });
  assert.equal(fairwayOpen(dug, { cells: [land] }), false);
  assert.equal(pondCount(dug), pondCount(t0) + 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { placeBuoys } from '../web/js/buoy-placement.js';

const terrain = (line, worldHeight = () => -1) => ({
  fairway: { line }, cellWorld: (x, z) => [x, z], worldHeight,
});

test('straight channel has evenly spaced red port and green starboard marks', () => {
  const marks = placeBuoys(terrain([[0, 0], [0, 14]]));
  assert.equal(marks.length, 10);
  for (const side of [-1, 1]) {
    const row = marks.filter((p) => p.side === side);
    assert.deepEqual(row.map((p) => p.x), Array(5).fill(-2 * side));
    assert.deepEqual(row.map((p) => p.z), [0, 3.5, 7, 10.5, 14]);
  }
});

test('the river-mouth hairpin does not pile its inner marks together', () => {
  // The reported mouth: a diagonal approach meeting a staircase in the river.
  const line = [[100,235],[99,234],[98,233],[97,232],[96,231],[95,230],[94,229],[93,228],[94,228],[94,227],[94,226],[94,225],[95,225],[96,225],[97,225],[97,224],[98,224],[98,223]];
  const marks = placeBuoys(terrain(line));
  assert.ok(marks.filter((p) => p.side === -1).length >= 4);
  assert.ok(marks.filter((p) => p.side === 1).length >= 4);
  for (let i = 0; i < marks.length; i++) {
    for (const b of marks.slice(i + 1)) {
      const a = marks[i];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= (a.side === b.side ? 2.6 : 1.8));
    }
  }
  const shifted = placeBuoys({ ...terrain(line), cellWorld: (x, z) => [x + 100, z - 80] });
  assert.equal(shifted.length, marks.length);
  shifted.forEach((p, i) => {
    assert.ok(Math.abs(p.x - marks[i].x - 100) < 1e-9);
    assert.ok(Math.abs(p.z - marks[i].z + 80) < 1e-9);
  });
});

test('the float clears a shallow bank and missing or repeated route cells are safe', () => {
  const marks = placeBuoys(terrain([[0, 0], [0, 14]], (x) => Math.abs(x) > 2.1 ? 0 : -1));
  assert.equal(marks.length, 10);
  for (const p of marks) assert.ok(Math.abs(p.x) + .3 <= 2.1 + 1e-9);
  assert.deepEqual(placeBuoys(terrain([])), []);
  assert.deepEqual(placeBuoys(terrain([[0, 0], [0, 0]])), []);
  assert.deepEqual(placeBuoys({ cellWorld: () => [0, 0] }), []);
  assert.deepEqual(placeBuoys(terrain([[0, 0], [0, 14]], () => 0)), []);
});

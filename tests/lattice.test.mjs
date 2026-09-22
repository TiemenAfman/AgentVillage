// shared/lattice.mjs: the super-lattice as arithmetic, shared by the scanner, the viewer
// and the planner. Plain integers, so the same answer everywhere - and asserted so, by
// reading the source, the way tests/settler-walk.test.mjs holds shared/ to its rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PITCH, blockOf, centreOfCell, superOf, cellsOfSuper, superComplete, superRadius } from '../shared/lattice.mjs';

const lat = { anchor: [127, 127], pitch: PITCH };    // Promptholm's own

test('blockOf and superOf are inverses on every cell of the island', () => {
  for (let gz = 0; gz < 256; gz += 7) {
    for (let gx = 0; gx < 256; gx += 5) {
      const [i, j] = superOf(lat, gx, gz);
      const [ax, az] = blockOf(lat, i, j);
      assert.ok(gx >= ax && gx < ax + PITCH && gz >= az && gz < az + PITCH, `${gx},${gz} is not inside super ${i},${j}`);
    }
  }
  // West and north of the anchor the indices go negative, and floor is what keeps them
  // right: cell 126 is in super-cell -1, not 0.
  assert.deepEqual(superOf(lat, 126, 126), [-1, -1]);
  assert.deepEqual(superOf(lat, 127, 127), [0, 0]);
  assert.deepEqual(blockOf(lat, -7, 7), [99, 155]);
  assert.deepEqual(centreOfCell(lat, [-7, 7]), [100, 156]);
});

test('a super-cell is sixteen cells, and only a whole one is on the island', () => {
  assert.equal(cellsOfSuper(lat, 3, -2).length, PITCH * PITCH);
  assert.deepEqual(cellsOfSuper(lat, 0, 0)[0], [127, 127]);
  assert.equal(superComplete(lat, 256, -31, 0), true);     // 3..6
  assert.equal(superComplete(lat, 256, -32, 0), false);    // -1..2 - off the west edge
  assert.equal(superComplete(lat, 256, 32, 0), false);     // 255..258 - off the east edge
  assert.equal(superComplete(lat, 256, 31, 31), true);     // 251..254
  assert.equal(superRadius(256), 65);
});

test('shared/lattice.mjs is arithmetic and nothing else', () => {
  const src = fs.readFileSync(new URL('../shared/lattice.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bimport\b/, 'it imports nothing');
  assert.doesNotMatch(src, /Math\.(sin|cos|pow|hypot|atan2|sqrt)\b/, 'a transcendental in shared/');
  assert.doesNotMatch(src, /\b(document|window|location)\b/, 'a browser object in shared/');
});

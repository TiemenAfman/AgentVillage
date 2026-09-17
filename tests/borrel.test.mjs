// How many tables the Friday borrel carries out.
//
// One line of arithmetic, and it is here rather than left to be eyeballed on the square
// because it is the sort of rule that gets asked for in words ("one set per ten") and
// then quietly drifts a set either way the first time somebody touches the rounding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tableSetsFor } from '../web/js/borrel.js';

test('one set of tables per ten islanders, counting the one already standing', () => {
  // The village earns a set of tables of its own and it stands on the square all week.
  // That set is the first ten people's, so what comes out for the borrel is the rest.
  assert.equal(tableSetsFor(55), 4, 'fifty-five sit at five sets, four of them carried out');
  assert.equal(tableSetsFor(100), 9);
  assert.equal(tableSetsFor(20), 1);

  // Below twenty the set on the square is the whole borrel, and nothing is carried out.
  // Nought rather than a negative number, which is what a bare floor() would hand an
  // InstancedMesh and is the one value that would look like a bug on screen.
  for (const small of [0, 1, 9, 10, 19]) {
    assert.equal(tableSetsFor(small), 0, `${small} islanders need nothing carried out`);
  }

  // A village is counted in whole people, and the count arrives off the wire where it
  // may be anything at all.
  for (const nonsense of [null, undefined, NaN, 'lots', -30]) {
    assert.equal(tableSetsFor(nonsense), 0, `"${nonsense}" is not a population`);
  }
});

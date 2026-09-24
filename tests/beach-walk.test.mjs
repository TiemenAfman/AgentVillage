// A polder's causeway that ends boxed in by its own dike and by beach is carried on over the
// beach to ground a road may use (`beachWalk` in lib/layout.mjs), or its approach road can
// never be laid and the stub is orphaned paving - measured on the live island's third polder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { beachWalk, FREE, BLOCKED, RESERVED, PATH } from '../lib/layout.mjs';

// A tiny grid from rows of characters: . free, # beach (blocked land), D dike, ~ water, P path.
function gridOf(rows) {
  const size = rows.length;
  const at = (x, z) => rows[z][x];
  const kind = { '.': FREE, '#': BLOCKED, D: RESERVED, '~': BLOCKED, P: PATH };
  return {
    size,
    in: (x, z) => x >= 0 && z >= 0 && x < size && z < size,
    get: (x, z) => kind[at(x, z)],
    t: { isLand: (x, z) => at(x, z) !== '~' },
  };
}

test('a boxed-in causeway end walks the shortest way over the beach, and only over beach', () => {
  const g = gridOf([
    'DDDDD',
    'D###D',
    'D#s#D',   // s is where the causeway ends (drawn as beach)
    'D##.D',
    'DDDDD',
  ].map((r) => r.replace('s', '#')));
  // Two walks of one cell each reach the free corner; the fixed order (east first) picks one.
  assert.deepEqual(beachWalk(g, [2, 2]), [[3, 2]]);
});

test('water and a dike are never walked, and nothing out of reach is found', () => {
  const walled = gridOf(['DDD', 'D#D', 'DDD']);
  assert.equal(beachWalk(walled, [1, 1]), null);
  const wet = gridOf(['~~~~~', '~#~.~', '~~~~~', '~~~~~', '~~~~~']);
  assert.equal(beachWalk(wet, [1, 1]), null, 'it swam');
  const next = gridOf(['#P#', '###', '###']);
  assert.deepEqual(beachWalk(next, [1, 1]), [], 'ground right beside the end needs no walk');
});

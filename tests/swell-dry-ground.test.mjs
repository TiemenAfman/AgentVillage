// The swell never lifts the water out through dry ground (issue #95).
//
// The water mesh has a vertex per corner, triangulated like the ground, and the swell lifts
// each vertex by up to 0.09. A grown ring can leave a wide plain whose corners sit within that
// of the sea, and every crest then broke through the sand as a dotted row of puddles. The
// vertex shader caps the lift wherever the depth it is handed is ground at or above the sea:
// at sea level, and 0.05 clear of the ground where it is higher - so the still waterline of
// every coast stays where it was. There is no GPU in this suite, so the shape is checked by
// reading the source, and the rule itself by a mirror of the one line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/js/world.js', import.meta.url), 'utf8');

test('the water shader caps the swell over ground above the sea', () => {
  assert.match(src, /float lift = \(0\.05 \* w1 \+ 0\.04 \* w2\) \* aWave;/);
  assert.match(src, /if \(aDepth >= 0\.0\) lift = min\(lift, max\(aDepth - 0\.05, 0\.0\)\);/);
  assert.match(src, /p\.y \+= lift;/);
  assert.doesNotMatch(src, /p\.y \+= \(0\.05 \* w1 \+ 0\.04 \* w2\) \* aWave;/, 'an uncapped swell is back');
});

test('capped, the surface stays under every dry corner and the sea keeps its swell', () => {
  const cap = (lift, depth) => (depth >= 0 ? Math.min(lift, Math.max(depth - 0.05, 0)) : lift);
  for (let d = 0; d <= 0.5; d += 1 / 256) {
    for (const lift of [-0.09, 0, 0.045, 0.09]) {
      const y = cap(lift, d);
      assert.ok(y <= d, `water at ${y} over ground at ${d}`);
      assert.ok(y <= 0 || d - y >= 0.05 - 1e-9, `water within 0.05 of ground at ${d}`);
    }
  }
  // Still water is where it always was, over land and sea alike; the sea still heaves.
  for (const d of [-1, -0.01, 0, 0.02, 0.3]) assert.equal(cap(0, d), 0);
  assert.equal(cap(0.09, -0.05), 0.09);
  assert.equal(cap(-0.09, 0.02), -0.09);
});

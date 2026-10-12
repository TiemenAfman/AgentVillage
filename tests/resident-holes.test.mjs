// The residents are closed (Plans/inwoners-in-avonturierstijl.md, "Gaten"): every outfit the wardrobe can
// put together, in every pose a resident spends the day in, seen from all round, shows next to nothing of
// a garment's inside (a hole: skin cut where no cloth covers it, a seam that parted in the decimation) and
// next to no skin come through cloth (a poke). tests/support/resident-holes.mjs draws them the way the
// island's front-sided crowd material does. Measured on the bake of 12 October 2026: holes 0.4-0.8% of a
// figure, pokes 0.07-0.21%; the bake before it was 1.5-2.3% and 0.26-0.41%. The ceilings below sit a
// little over today's, so a bake that opens a seam again fails here and not in front of the keeper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outfits, outfitName, holesOf, POSES } from './support/resident-holes.mjs';

// Per pose, the mean over every outfit; and no single outfit in any pose past WORST.
const MEAN_HOLES = 0.009, MEAN_POKES = 0.003;
const WORST_HOLES = 0.02, WORST_POKES = 0.01;

test('no resident can be seen into or through, in any outfit or pose', () => {
  const all = outfits();
  const bad = [];
  for (const pose of Object.keys(POSES)) {
    let holes = 0, pokes = 0;
    for (const o of all) {
      const h = holesOf(o, pose);
      holes += h.share; pokes += h.pokeShare;
      if (h.share > WORST_HOLES) bad.push(`${outfitName(o)} ${pose}: ${(h.share * 100).toFixed(2)}% holes ${JSON.stringify(h.by)}`);
      if (h.pokeShare > WORST_POKES) bad.push(`${outfitName(o)} ${pose}: ${(h.pokeShare * 100).toFixed(2)}% skin through cloth`);
    }
    if (holes / all.length > MEAN_HOLES) bad.push(`${pose}: ${(holes / all.length * 100).toFixed(2)}% holes on average`);
    if (pokes / all.length > MEAN_POKES) bad.push(`${pose}: ${(pokes / all.length * 100).toFixed(2)}% skin through cloth on average`);
  }
  assert.deepEqual(bad, []);
});

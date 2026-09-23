// No shore is within SWIM_REACH of the middle of the gap.
//
// This used to be the wall that kept feet on their own island. It is not any more - a
// swimmer may cross the open sea (walk.js, next to SWIM_SPEED), slowly, because a swimmer
// who reached open water any other way was stuck there. What still rests on it is placing
// somebody: stepping ashore and entering walk mode only accept a spot within SWIM_REACH of a
// shore, so "step ashore" is never offered - or honoured - in the middle of a crossing.
//
// Asserted over the middle third of the water, because the outer thirds are the shallows
// either coast is allowed to have.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { makeTerrain } = await import('../shared/terrain.mjs');
const { berthOf, placeIsland, createArchipelago } = await import('../shared/regions.mjs');

// The number walk.js wades with. Written out here rather than imported, the way
// tests/paths.test.mjs keeps its own copy of LANE_DEV: raising it over there should have to
// be a deliberate change here too, because raising it is how you accidentally let somebody
// wade to another island.
const SWIM_REACH = 2.0;

function crossing(ownSize, theirSize, ownSeed, theirSeed) {
  const homeT = makeTerrain(ownSeed, { size: ownSize });
  const guestT = makeTerrain(theirSeed, { size: theirSize });
  const home = placeIsland(homeT, { id: 'home', origin: [0, 0] });
  const guest = placeIsland(guestT, {
    id: 'guest', origin: berthOf(0, homeT.half, guestT.half),
  });
  const sea = createArchipelago();
  sea.add(home);
  sea.add(guest);
  return { home, guest, sea };
}

test('no shore is within wading reach of the middle of the crossing', () => {
  for (const [ownSize, theirSize, ownSeed, theirSeed] of [
    [64, 64, 1337, 4242],
    [64, 128, 1337, 4242],
    [128, 64, 1337, 99],
    [128, 128, 7, 4242],
  ]) {
    const { home, guest, sea } = crossing(ownSize, theirSize, ownSeed, theirSeed);
    const from = home.bounds().maxX;
    const to = guest.bounds().minX;
    const third = (to - from) / 3;
    const lo = from + third, hi = to - third;

    // The whole width of the channel, not just the line through the middle: a bay on one
    // island can reach much further north or south than its widest point does east.
    const zLo = Math.min(home.bounds().minZ, guest.bounds().minZ) - 20;
    const zHi = Math.max(home.bounds().maxZ, guest.bounds().maxZ) + 20;
    for (let x = lo; x <= hi; x += 0.5) {
      for (let z = zLo; z <= zHi; z += 0.5) {
        assert.ok(
          !sea.shoreWithin(x, z, SWIM_REACH),
          `${ownSize}/${theirSize}: you can wade at (${x.toFixed(1)}, ${z.toFixed(1)})`,
        );
      }
    }
  }
});

test('but a beach is still waist-deep, so wading has not been broken', () => {
  // The other half of the same rule. If this fails, the ramp or OPEN_SEA has swallowed the
  // shallows and nobody can paddle off their own beach any more.
  const { home, sea } = crossing(64, 64, 1337, 4242);
  let waded = 0;
  for (const cell of home.beachCells) {
    const p = home.cellWorld(cell[0], cell[1]);
    if (sea.shoreWithin(p[0], p[1], SWIM_REACH)) waded++;
  }
  assert.ok(waded === home.beachCells.length, 'every beach cell is within reach of a shore');
  assert.ok(home.beachCells.length > 0, 'an island with no beach cannot test this');
});

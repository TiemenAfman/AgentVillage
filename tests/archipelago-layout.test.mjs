// Where a second island is allowed to lie.
//
// web/js/horizon.js:13-18 records this bug already having happened once: the neighbour
// distance was a flat 150 to 190, which was fine while every island was sixty-four cells
// across and wrong the moment one was not - a 256-cell neighbour has a radius of 128, so at
// 150 its coast came ashore inside ours and the two islands shared a beach. berthOf does
// the arithmetic from both radii instead, and this is the test that keeps it honest for
// every pair of sizes the beacon will accept (lib/neighbours.mjs:64 clamps to 16..512).
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { makeTerrain } = await import('../shared/terrain.mjs');
const { SEA_GAP, MAX_BERTHS, berthOf, placeIsland, createArchipelago } = await import('../shared/regions.mjs');

// The sizes the beacon lets through. Generating a 512-grid terrain is slow, so the land
// measurements below use the sizes we actually ship and the geometry check uses them all.
const ALL = [16, 64, 128, 256, 512];
const REAL = [64, 128];

test('no pair of grids overlaps, at any berth, at any size', () => {
  for (const own of ALL) {
    for (const theirs of ALL) {
      for (let i = 0; i < MAX_BERTHS; i++) {
        const ownHalf = own / 2, theirHalf = theirs / 2;
        const [ox, oz] = berthOf(i, ownHalf, theirHalf);
        const gapX = Math.abs(ox) - (ownHalf + theirHalf);
        const gapZ = Math.abs(oz) - (ownHalf + theirHalf);
        // Axis-aligned, so exactly one axis carries the whole distance and that one has to
        // clear both radii. Overlap is only overlap when BOTH axes overlap.
        assert.ok(gapX >= 0 || gapZ >= 0, `${own} beside ${theirs} at berth ${i} overlaps`);
        assert.equal(Math.max(gapX, gapZ), SEA_GAP, 'and the clear axis is exactly the gap');
      }
    }
  }
});

test('all four berths can be occupied at once without a clash', () => {
  const homeT = makeTerrain(1337, { size: 64 });
  const sea = createArchipelago();
  sea.add(placeIsland(homeT, { id: 'home', origin: [0, 0] }));
  for (let i = 0; i < MAX_BERTHS; i++) {
    const t = makeTerrain(2000 + i, { size: 64 });
    // add() throws on overlap, so reaching the end is the assertion.
    sea.add(placeIsland(t, { id: `berth${i}`, origin: berthOf(i, homeT.half, t.half) }));
  }
  assert.equal(sea.count(), MAX_BERTHS + 1);
});

test('the water between the two lands is a crossing, not a puddle or an ocean', () => {
  // Measured between the outermost LAND, which is what you actually see and sail. It comes
  // out wider than SEA_GAP because land stops several cells inside its own grid. The band
  // is the thing being asserted: narrow enough to be a boat trip rather than a commute,
  // wide enough that no shore is ever in wading reach from the middle of it.
  for (const own of REAL) {
    for (const theirs of REAL) {
      const homeT = makeTerrain(1337, { size: own });
      const guestT = makeTerrain(4242, { size: theirs });
      const home = placeIsland(homeT, { id: 'home', origin: [0, 0] });
      const guest = placeIsland(guestT, {
        id: 'guest', origin: berthOf(0, homeT.half, guestT.half),
      });
      const water = guest.bounds().minX - home.bounds().maxX;
      assert.ok(water >= SEA_GAP, `${own}/${theirs}: land reaches into the gap (${water})`);
      assert.ok(water <= SEA_GAP + 40, `${own}/${theirs}: the gap is ${water}, too far to row`);
    }
  }
});

test('east is east, and stays east', () => {
  // main.js:1045-1050 turns a neighbour bearing into a word for the toast. Berth 0 has to
  // be +X or the island announces itself in the wrong direction.
  const [x, z] = berthOf(0, 32, 32);
  assert.ok(x > 0 && z === 0);
});

// The region contract, which is the one thing the whole archipelago rests on.
//
// shared/terrain.mjs is island-local and origin-centred, and its worldHeight clamps into
// its own grid (terrain.mjs:271) - so a query a hundred units east of a 64-grid does not
// say "no land here", it says "the coast". Every bug that would put a second island in the
// wrong place, or draw shallow water in the middle of the open sea, or hang a bridge deck
// in mid-air over an island nobody touched, is a violation of one of the properties below.
//
// No document stub and no three.js here: shared/regions.mjs is deliberately pure, so this
// file needs nothing but the import-map loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { makeTerrain } = await import('../shared/terrain.mjs');
const {
  OPEN_SEA, BLEND_CELLS, SEA_GAP, MAX_BERTHS, berthOf, placeIsland, createArchipelago,
} = await import('../shared/regions.mjs');

const SEED = 1337;
const SIZE = 64;

function pair(seed = SEED, size = SIZE) {
  const homeT = makeTerrain(seed, { size });
  const guestT = makeTerrain(seed + 1, { size });
  const home = placeIsland(homeT, { id: 'home', origin: [0, 0] });
  const guest = placeIsland(guestT, {
    id: 'guest', origin: berthOf(0, homeT.half, guestT.half),
  });
  const sea = createArchipelago();
  sea.add(home);
  sea.add(guest);
  return { homeT, guestT, home, guest, sea };
}

test('placing an island does not change the island', () => {
  const t = makeTerrain(SEED, { size: SIZE });
  const before = t.hash;
  const r = placeIsland(t, { id: 'home', origin: [112, 0] });
  assert.equal(r.hash, before, 'the terrain hash is what Node and the browser compare');
  assert.equal(t.hash, before, 'and placing must not have mutated the terrain itself');
  assert.equal(r.size, t.size);
  assert.equal(r.half, t.half);
  assert.equal(r.seed, t.seed);
});

test('the ramp moves no land, on any seed', () => {
  // The blend down to OPEN_SEA exists to hide a depth step out in the water. If it ever
  // reaches a land cell, a house stands at a different height than the layout planned it
  // at, which is the one thing shared/ exists to prevent.
  for (const seed of [1337, 1, 424242]) {
    const t = makeTerrain(seed, { size: SIZE });
    const r = placeIsland(t, { id: 'r', origin: [112, 0] });
    for (const cell of t.landCells) {
      const p = t.cellWorld(cell[0], cell[1]);
      const local = t.worldHeight(p[0], p[1]);
      const world = r.worldHeight(p[0] + 112, p[1]);
      assert.equal(world, local, `seed ${seed}, cell ${cell} moved`);
    }
  }
});

test('cellWorld adds the origin and worldHeight takes it off again', () => {
  const { homeT, guest } = pair();
  const t = makeTerrain(SEED + 1, { size: SIZE });
  const [ox, oz] = berthOf(0, homeT.half, t.half);
  for (const cell of t.landCells) {
    const local = t.cellWorld(cell[0], cell[1]);
    const world = guest.cellWorld(cell[0], cell[1]);
    assert.equal(world[0], local[0] + ox);
    assert.equal(world[1], local[1] + oz);
    // and the round trip: a position built with cellWorld, stood up with worldHeight
    assert.ok(Math.abs(guest.worldHeight(world[0], world[1]) - t.worldHeight(local[0], local[1])) < 1e-9);
  }
});

test('outside every region there is exactly one sea', () => {
  const { sea } = pair();
  // In the gap, past the corners, and a long way out: all the same substance. The far
  // query is the one terrain.mjs would have answered with a coast height.
  for (const [x, z] of [[56, 0], [56, 40], [-200, 0], [400, 400], [0, 300], [56, -60]]) {
    assert.equal(sea.regionAt(x, z), null, `(${x},${z}) should be open sea`);
    assert.equal(sea.height(x, z), OPEN_SEA, `(${x},${z}) is not open sea`);
    assert.ok(sea.isWaterAt(x, z));
  }
});

test('regionAt has one answer, and overlapping is refused', () => {
  const { home, guest, sea } = pair();
  assert.equal(sea.regionAt(0, 0), home);
  assert.equal(sea.regionAt(112, 0), guest);
  assert.equal(sea.count(), 2);

  const clash = placeIsland(makeTerrain(9, { size: SIZE }), { id: 'clash', origin: [10, 10] });
  assert.throws(() => sea.add(clash), /overlaps/);
  const twin = placeIsland(makeTerrain(9, { size: SIZE }), { id: 'home', origin: [0, 300] });
  assert.throws(() => sea.add(twin), /already here/);
  assert.equal(sea.count(), 2, 'a refused region must not have been added');
});

test('two islands of one size never share a level key', () => {
  // walk.js:396, props.js:475 and main.js:1529 all build `gx + gz*size`. Without a stride
  // per region a bridge on one island is a deck in the sky on the other.
  const { home, guest, sea } = pair();
  const seen = new Set();
  for (const r of [home, guest]) {
    for (const cell of r.terrain.landCells) {
      const p = r.cellWorld(cell[0], cell[1]);
      const key = sea.levelKey(p[0], p[1]);
      assert.notEqual(key, null, 'a land cell is never at sea');
      assert.ok(!seen.has(key), `level key ${key} collides across regions`);
      seen.add(key);
    }
  }
  assert.equal(sea.levelKey(56, 0), null, 'there is no level out in the water');
});

test('a removed region hands its stride back', () => {
  const { home, guest, sea } = pair();
  const third = placeIsland(makeTerrain(7, { size: SIZE }), {
    id: 'third', origin: berthOf(1, home.half, 32),
  });
  sea.add(third);
  const homeBase = home.levelBase;
  sea.remove('guest');
  assert.equal(sea.count(), 2);
  assert.equal(home.levelBase, homeBase, 'the first region keeps its stride');
  assert.equal(third.levelBase, home.size * home.size + 1, 'and the rest close the gap');
  assert.equal(sea.remove('nobody'), null);
});

test('replacing an island keeps its place in the queue', () => {
  // A polder is stamped into the heightfield, so a chronicle replay hands the same island a
  // different terrain. Done as a remove and an add it would go to the back of the list and
  // every stride after it would shift - under the feet of somebody standing on a bridge.
  const { home, guest, sea } = pair();
  const homeBase = home.levelBase, guestBase = guest.levelBase;
  const keyBefore = sea.levelKey(guest.origin[0], guest.origin[1]);

  const drained = makeTerrain(SEED, { size: SIZE, polders: [{ cells: [[20, 20], [21, 20]], dike: [[22, 20]] }] });
  const next = sea.replace('home', placeIsland(drained, { id: 'home', origin: [0, 0] }));

  assert.equal(sea.count(), 2);
  assert.equal(next.levelBase, homeBase);
  assert.equal(sea.get('guest').levelBase, guestBase);
  assert.equal(sea.levelKey(guest.origin[0], guest.origin[1]), keyBefore);
  assert.equal(sea.get('home'), next);
  assert.notEqual(next.hash, home.hash, 'the point of the exercise is a different coast');

  // Replacing something that is not here at all is just an add, so a caller need not check.
  const sea2 = createArchipelago();
  assert.equal(sea2.replace('home', home).id, 'home');
  assert.equal(sea2.count(), 1);
});

test('gridBounds covers every heightfield, bounds covers only the land', () => {
  const { home, guest, sea } = pair();
  const g = sea.gridBounds();
  assert.equal(g.minX, -home.half);
  assert.equal(g.maxX, guest.origin[0] + guest.half);
  assert.equal(g.minZ, -home.half);
  assert.equal(g.maxZ, home.half);

  // The water is laid over the grids, so it has to reach further than the land does.
  const b = sea.bounds();
  assert.ok(g.minX <= b.minX && g.maxX >= b.maxX);
  assert.ok(g.minZ <= b.minZ && g.maxZ >= b.maxZ);

  assert.deepEqual(createArchipelago().gridBounds(), { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
});

test('bounds is the land, not the grid', () => {
  const { homeT, home, sea } = pair();
  const b = home.bounds();
  // Land stops several cells inside the grid; a camera leash on the grid would let you
  // drift out over empty water, which is what frameIsland already avoids.
  assert.ok(b.maxX < homeT.half, 'land reaches the grid edge - pick another seed');
  const union = sea.bounds();
  assert.ok(union.maxX > b.maxX, 'the union has to reach past the home island');
  assert.equal(union.minX, b.minX, 'and start where the westmost land does');

  const empty = createArchipelago();
  assert.deepEqual(empty.bounds(), { minX: -60, maxX: 60, minZ: -60, maxZ: 60 });
  assert.equal(empty.radius(), 0);
  assert.equal(empty.height(0, 0), OPEN_SEA);
});

test('radius covers the furthest coast', () => {
  const { home, guest, sea } = pair();
  assert.equal(sea.radius(), guest.origin[0] + guest.half);
  assert.ok(sea.radius() > home.half);
});

test('berths are axis-aligned and keep the gap exact', () => {
  const sizes = [16, 64, 128, 256, 512];
  for (const own of sizes) {
    for (const theirs of sizes) {
      for (let i = 0; i < MAX_BERTHS; i++) {
        const [x, z] = berthOf(i, own / 2, theirs / 2);
        assert.ok(x === 0 || z === 0, `berth ${i} of ${own}/${theirs} is not on an axis`);
        const d = Math.abs(x) + Math.abs(z);
        assert.equal(d, own / 2 + SEA_GAP + theirs / 2, 'the gap between the grids is exact');
      }
    }
  }
  // The index wraps rather than throwing, and wraps the way a modulo should for negatives.
  assert.deepEqual(berthOf(MAX_BERTHS, 32, 32), berthOf(0, 32, 32));
  assert.deepEqual(berthOf(-1, 32, 32), berthOf(MAX_BERTHS - 1, 32, 32));
});

test('the sea between two islands is deeper than the blend', () => {
  // The ramp only ever pulls water down, so nothing in the gap may read as shallow: that
  // is what would draw foam and pale water out in the middle of nowhere.
  const { home, guest, sea } = pair();
  const from = home.bounds().maxX;
  const to = guest.bounds().minX;
  assert.ok(to > from, 'the two islands must not share a beach');
  for (let x = from + BLEND_CELLS; x <= to - BLEND_CELLS; x += 1) {
    assert.ok(sea.height(x, 0) < -0.5, `x=${x} is shallow water in the open sea`);
  }
});

test('shoreWithin sees land across a region boundary', () => {
  const { home, sea } = pair();
  const coast = home.coastCells[0];
  const p = home.cellWorld(coast[0], coast[1]);
  assert.ok(sea.shoreWithin(p[0], p[1], 2.0), 'a coast cell is its own shore');
  assert.ok(!sea.shoreWithin(56, 0, 2.0), 'the middle of the gap has no shore in reach');

  const near = sea.nearestCoast(56, 0);
  assert.notEqual(near, null);
  assert.ok(near.d > 0);
  assert.ok(sea.height(near.x, near.z) >= 0, 'washing ashore must land you on land');
});

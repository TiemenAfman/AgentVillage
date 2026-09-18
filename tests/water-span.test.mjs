// The water patch, which is the heaviest thing on the island and is now sized by something
// that can grow.
//
// On a 64-grid it is 135,200 of the island's ~430,000 triangles - a third of everything
// drawn, for a surface you mostly look through. It used to be a fixed square around the
// origin; it now covers the whole archipelago, because a second island at a berth had its
// water on the open-ocean disc instead: no shallows, no surf, no depth colour, and a hard
// line where its beach met the deep.
//
// Two things are worth a test rather than a look. That an island on its own still gets
// exactly the patch it had, to the vertex - this is the sort of change that quietly costs
// every existing island a frame. And that two islands cost a rectangle rather than a square,
// which is the whole reason the second one is affordable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// world.js reaches buildings.js for the tier table, and buildings.js asks for its texture
// sheets the moment it loads. The same stub the tavern and paths tests use.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { waterPatchSpan } = await import('../web/js/world.js');
delete globalThis.document;

const { makeTerrain } = await import('../shared/terrain.mjs');
const { berthOf, placeIsland, createArchipelago, OPEN_SEA } = await import('../shared/regions.mjs');

// A PlaneGeometry of s segments has s+1 vertices along that side, and two triangles a cell.
const verts = (s) => (s.segX + 1) * (s.segZ + 1);
const tris = (s) => s.segX * s.segZ * 2;

test('an island on its own gets exactly the patch it always had', () => {
  // The old formula: a square of max(260, size + 120) on the origin, a vertex per unit.
  for (const size of [16, 64, 128, 256, 512]) {
    const old = Math.max(260, size + 120);
    const s = waterPatchSpan(size / 2, null, false);
    assert.equal(s.width, old, `size ${size}: width`);
    assert.equal(s.depth, old, `size ${size}: depth`);
    assert.equal(s.cx, 0);
    assert.equal(s.cz, 0);
    assert.equal(verts(s), (old + 1) * (old + 1), `size ${size}: vertex count`);
  }
  // And the 64-grid the island actually runs on, spelled out, because it is the number that
  // would change without anybody noticing.
  const s = waterPatchSpan(32, null, false);
  assert.deepEqual([s.minX, s.maxX, s.minZ, s.maxZ], [-130, 130, -130, 130]);
  assert.equal(verts(s), 68121);
  assert.equal(tris(s), 135200);
});

test('modest machines still get every other vertex', () => {
  const full = waterPatchSpan(32, null, false);
  const lean = waterPatchSpan(32, null, true);
  assert.equal(lean.width, full.width, 'the same water, not less of it');
  assert.equal(lean.segX, Math.round(full.segX / 2));
  assert.ok(tris(lean) < tris(full) / 3.5, 'and a quarter of the triangles, near enough');
});

test('two islands cost a rectangle, not a square', () => {
  const homeT = makeTerrain(1337, { size: 64 });
  const guestT = makeTerrain(4242, { size: 64 });
  const sea = createArchipelago();
  sea.add(placeIsland(homeT, { id: 'home', origin: [0, 0] }));
  sea.add(placeIsland(guestT, { id: 'guest', origin: berthOf(0, homeT.half, guestT.half) }));

  const s = waterPatchSpan(homeT.half, sea.gridBounds(), false);
  assert.deepEqual([s.minX, s.maxX, s.minZ, s.maxZ], [-130, 242, -130, 130]);
  assert.ok(s.width > s.depth, 'the islands lie east and west, so the water should too');

  const square = (s.width + 1) * (s.width + 1);
  assert.ok(verts(s) < square * 0.72, 'a square over the long side would cost a third more');

  // The budget. Two islands are allowed to cost more water than one, but nothing like twice:
  // one surface over both is the whole point.
  const alone = waterPatchSpan(homeT.half, null, false);
  assert.ok(tris(s) / tris(alone) < 1.5, `two islands cost ${(tris(s) / tris(alone)).toFixed(2)}x the water`);
});

test('the patch is given each island own depth, and open sea in between', () => {
  const homeT = makeTerrain(1337, { size: 64 });
  const guestT = makeTerrain(4242, { size: 64 });
  const home = placeIsland(homeT, { id: 'home', origin: [0, 0] });
  const guest = placeIsland(guestT, { id: 'guest', origin: berthOf(0, homeT.half, guestT.half) });
  const sea = createArchipelago();
  sea.add(home);
  sea.add(guest);

  const s = waterPatchSpan(homeT.half, sea.gridBounds(), false);
  // Walk the patch's own vertices the way createWorld does, and check every one of them.
  let overHome = 0, overGuest = 0, outside = 0;
  for (let j = 0; j <= s.segZ; j++) {
    const z = s.minZ + (j / s.segZ) * s.depth;
    for (let i = 0; i <= s.segX; i++) {
      const x = s.minX + (i / s.segX) * s.width;
      const d = sea.height(x, z);
      const r = sea.regionAt(x, z);
      if (!r) { assert.equal(d, OPEN_SEA, `(${x},${z}) is not open sea`); outside++; continue; }
      // Inside a region the depth is that island's own ground, never the flat -2.5 the old
      // patch gave everything past its edge. (Except where the island really is that deep.)
      assert.equal(d, r.worldHeight(x, z));
      if (r === home) overHome++; else overGuest++;
    }
  }
  assert.ok(overHome > 3000 && overGuest > 3000, 'both islands are under the patch');
  assert.ok(outside > overHome + overGuest, 'and most of it is open water, as a sea should be');
});

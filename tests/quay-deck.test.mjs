// The quay is one storey, and this is what says so.
//
// Two faults were found by walking the island rather than by running anything, which is
// why they are written down here as numbers. The lanes over the harbour basin were built
// as ordinary bridges, and an ordinary bridge arches on purpose - the hump is what stops a
// plank between two banks reading as a board lying in a ditch. A quay lane has no far bank;
// it runs from a house to a house. So the hump was a hill in the middle of the quay, and
// where two lanes crossed they did it at different heights and the pair read as planks
// thrown over each other. And the houses were pinned to the waterline instead of to the
// planks, which left every floor 0.13 under the walkway outside its own front door.
//
// Both are the same omission - the quay had no shared height - so both are measured here
// against the one number the island's piers already use, QUAY_DECK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader at import time, so it wants a document. The same stub
// the tavern, paths and water-span tests use.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { bridgeDeckHeights, buildBridgeGeometry, QUAY_DECK, HARBOUR_PIN, HARBOUR_FLOOR } =
  await import('../web/js/buildings.js');
delete globalThis.document;

const { makeTerrain, SEA_LEVEL } = await import('../shared/terrain.mjs');

const SIZE = 64;
const SEED = 1337;

// An island with a rectangle of its ground dredged away, which is what lib/layout.mjs does
// once a quay district has its parcel. The cells are chosen off the terrain itself rather
// than written down: a fixed rectangle would be in the sea on one seed and up a hill on the
// next, and a basin dug in ground that was already water proves nothing.
function islandWithBasin() {
  const bare = makeTerrain(SEED, { size: SIZE });
  let block = null;
  for (let gz = 2; gz < SIZE - 6 && !block; gz++) {
    for (let gx = 2; gx < SIZE - 6; gx++) {
      const cells = [];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) cells.push([gx + i, gz + j]);
      if (cells.every(([x, z]) => bare.isLand(x, z))) { block = cells; break; }
    }
  }
  assert.ok(block, 'seed 1337 at 64 has no dry four-by-three to dredge');
  return { terrain: makeTerrain(SEED, { size: SIZE, basins: [{ id: 'basin:t', cells: block }] }), cells: block };
}

test('a quay lane lies flat, at the height the piers already use', () => {
  const { terrain, cells } = islandWithBasin();
  for (const [gx, gz] of cells) assert.ok(terrain.isWater(gx, gz), `the basin left ${gx},${gz} dry`);

  // One row of the basin, walked along x.
  const run = cells.filter(([, gz]) => gz === cells[0][1]);
  const deck = bridgeDeckHeights(run, terrain, 'x', { quay: true });
  assert.ok(deck.length, 'a quay lane with no deck under it');
  for (const [gx, gz, y] of deck) {
    assert.equal(y, QUAY_DECK, `the lane rides at ${y} over ${gx},${gz} instead of on the quay`);
  }
});

test('and an ordinary crossing still humps', () => {
  const { terrain, cells } = islandWithBasin();
  const run = cells.filter(([, gz]) => gz === cells[0][1]);
  const flat = bridgeDeckHeights(run, terrain, 'x', { quay: true }).map(([, , y]) => y);
  const arched = bridgeDeckHeights(run, terrain, 'x').map(([, , y]) => y);
  // Not a different number here and there: the arch is the whole point of a bridge, and
  // taking it off every crossing on the island to fix the quay would be the other mistake.
  assert.ok(Math.max(...arched) > Math.max(...flat) + 0.1, 'the bridge over a river went flat too');
  assert.equal(Math.min(...flat), Math.max(...flat), 'the quay lane is not level after all');
});

test('the planks and the floor under them are built from the same flag', () => {
  const { terrain, cells } = islandWithBasin();
  const run = cells.filter(([, gz]) => gz === cells[0][1]);
  const at = terrain.cellWorld(run[0][0], run[0][1]);
  const top = (opts) => {
    const g = buildBridgeGeometry(run, terrain, at, 'x', opts);
    assert.ok(g, 'no geometry for a lane over the basin');
    g.computeBoundingBox();
    return g.boundingBox.max.y;
  };
  // What went wrong was passing the flag to one call and not the other: the deck a settler
  // walks on came out flat while the planks it sees kept their hump, so the figures waded
  // through their own quay. The two are only ever right together, so they are measured
  // together - the arched planks have to stand higher than the flat ones by about the arch.
  assert.ok(top({}) > top({ quay: true }) + 0.1, 'the geometry ignored the quay flag');
});

test('a harbour house floor comes out on the planks', () => {
  // main.js pins a house over water to HARBOUR_PIN and stands its settlers HARBOUR_FLOOR
  // above that. If those two stop adding up to QUAY_DECK the quay has a step in it again,
  // and a step is invisible in a screenshot until somebody walks into it.
  assert.equal(HARBOUR_PIN + HARBOUR_FLOOR, QUAY_DECK);
  // And the pin is under water, which is what makes `overWater` in main.js still true of a
  // pinned house: a house on dry land keeps the ground it stands on and is not pinned.
  assert.ok(HARBOUR_PIN < SEA_LEVEL, 'a pinned harbour house is standing on top of the sea');
});

// A visiting island's quay comes out flat too, which is a whitelist question rather than a
// geometry one: see 'a bridge says whether it is a quay lane' in tests/island-bundle.test.mjs.

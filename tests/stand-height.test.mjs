// How high a settler stands, and the seam that got it wrong.
//
// The sea walks the crowd through createWalk, which has always known about the quay's
// boardwalk and its steps, and puts x and z on the wire - no height, on purpose, because
// whoever draws it has the ground already. The page then drew them at plain
// `region.worldHeight`, which is the ground *under* the quay: the sea stood a settler on
// the planks at BASIN_DECK and the page drew them a metre lower, in the water beside their
// own harbour. Both draw sites in web/js/main.js even carried a comment promising planks
// rather than water - they described what was meant, not what happened.
//
// So the two halves now ask one function, and this file holds them to it. No loader is
// registered and no `document` is stubbed on purpose: createStandHeight lives in shared/
// and the sea has to be able to call it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStandHeight, createWalk } from '../shared/settlerwalk.mjs';
import { BASIN_DECK, quayBasin } from '../shared/quay-basin.mjs';

const GROUND = 1.6;
const terrain = { size: 8, half: 4, worldHeight: () => GROUND };
const village = {
  island: { lattice: { anchor: [0, 0], pitch: 1 } },
  districts: [{
    kind: 'quay', deck: [[2, 2], [3, 2], [4, 2]],
    lobes: [{ parcel: { i0: 2, j0: 2, w: 3, h: 3, rows: ['111', '111', '111'] } }],
  }],
};
// The middle of a cell, in the local frame the whole of shared/ speaks.
const at = (gx, gz) => [gx - terrain.half + .5, gz - terrain.half + .5];

test('a settler on the boardwalk stands on it, not in the water under it', () => {
  const stand = createStandHeight(terrain, village);
  for (const cell of village.districts[0].deck) {
    const [x, z] = at(...cell);
    const basin = quayBasin(village, terrain);
    // A staircase is allowed to be higher - it rises out of the deck - but never lower,
    // and never the drowned ground the bug drew.
    const y = stand(x, z);
    assert.ok(y >= BASIN_DECK - 1e-9, `${cell} stands at ${y}, under the planks at ${BASIN_DECK}`);
    if (basin.rampHeight(x, z) == null) assert.equal(y, BASIN_DECK, `${cell} is plain deck`);
  }
});

test('off the quay it is still just the ground', () => {
  // The fix must not lift anybody anywhere else - this is the half that would go unnoticed.
  const stand = createStandHeight(terrain, village);
  for (const cell of [[0, 0], [7, 7], [0, 7], [6, 1]]) {
    assert.equal(stand(...at(...cell)), GROUND, `${cell} is meadow`);
  }
});

test('a village with no quay in it is the terrain exactly', () => {
  const plain = { island: { lattice: { anchor: [0, 0], pitch: 1 } }, districts: [] };
  const stand = createStandHeight(terrain, plain);
  for (let gz = 0; gz < terrain.size; gz++) for (let gx = 0; gx < terrain.size; gx++) {
    assert.equal(stand(...at(gx, gz)), GROUND);
  }
});

test('the quay wins a cell it shares with a bridge', () => {
  // A plank floor laid over a crossing is the surface you walk on. This is the order
  // createWalk's setDecks has always used; it is asserted here because the merge moved.
  const bridge = new Map([[2 + 2 * terrain.size, 9.5], [0 + 0 * terrain.size, 3.25]]);
  const stand = createStandHeight(terrain, village, bridge);
  assert.equal(stand(...at(2, 2)), BASIN_DECK, 'the boardwalk, not the bridge deck under it');
  assert.equal(stand(...at(0, 0)), 3.25, 'and a bridge on its own is still a bridge');
});

test('the walk and the page get the same answer, everywhere', () => {
  // The whole point: createWalk steps them on the sea, createStandHeight draws them on the
  // page. If these two ever disagree the settlers walk at one height and are drawn at
  // another, which is exactly the bug and is invisible to every other test here.
  const walk = createWalk(terrain, village);
  const decks = new Map([[1 + 1 * terrain.size, 2.75]]);
  walk.setDecks(decks);
  const stand = createStandHeight(terrain, village, decks);
  for (let gz = 0; gz < terrain.size; gz++) for (let gx = 0; gx < terrain.size; gx++) {
    const [x, z] = at(gx, gz);
    assert.equal(stand(x, z), walk.groundOrDeck(x, z), `they disagree at ${gx},${gz}`);
  }
});

test('the page hands the crowd a height that knows about decks', () => {
  // A source scan, like tests/api-base.test.mjs does for bare fetches, because the failure
  // is silent: passing region.worldHeight straight in still draws a crowd, just a drowned
  // one, and nothing throws. Both call sites are here - ours and a neighbour's.
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  // Up to `nowMs` rather than to the next comma: the argument is a function and has commas
  // of its own, and cutting at the first one reported `(x` and named nothing useful.
  const draws = [...main.matchAll(/\.draw\(\s*dt\s*,([\s\S]*?),\s*nowMs\s*,/g)].map((m) => m[1].trim());
  // Four: both crowds, and the story animals of both (web/js/animal-view.js) - a hen on the
  // quay's planks is as drowned by the raw ground as a settler is.
  assert.equal(draws.length, 4, `expected both crowd and both herd draw sites, found ${draws.length}`);
  for (const arg of draws) {
    assert.ok(/[sS]tand/.test(arg),
      `a crowd is drawn at \`${arg}\` - that is the raw ground, and the quay is planks over it`);
  }
});

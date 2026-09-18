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
const {
  bridgeDeckHeights, buildBridgeGeometry, buildBuilding, QUAY_DECK, HARBOUR_PIN, HARBOUR_FLOOR,
  HARBOUR_SLAB, PORCH_DIR, PORCH_WIDE, quayPorchCells, quayPorchReach,
} = await import('../web/js/buildings.js');
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

// ---- the landing outside the door ------------------------------------------------
// A quay house is built in the middle cell of a three-by-three plot while the lane runs
// along the outside of it, so for several releases there was 1.06 of open water between a
// front door and the planks it was supposed to open onto: from the air, boxes floating
// beside a jetty that passed them by. The landing covers it, and the two things that can
// go wrong with it are the two measured here - it stops short and leaves water, or it runs
// on over the lane on exactly its plane, which is the one thing the depth buffer cannot be
// asked to decide and shows up as boards that flicker as the camera moves.

// The deck's footprint, cell by cell, the way buildBridgeGeometry lays it: DECK_HALF to
// either side of the run, half a cell along, and the end lip at the two ends. Written out
// here rather than imported so that a change to the real one has to be made twice on
// purpose - this is the measurement the landing is fitted to.
const LIP = 0.6, HALF = 0.44;
function deckRects(b) {
  const out = [];
  for (let i = 0; i < b.cells.length; i++) {
    const prev = b.cells[i - 1] || b.cells[i], next = b.cells[i + 1] || b.cells[i];
    const k = next[0] !== prev[0] ? 0 : next[1] !== prev[1] ? 1 : (b.axis === 'x' ? 0 : 1);
    const end = (i === 0 || i === b.cells.length - 1) ? LIP : 0;
    const [ax, az] = k === 0 ? [0.5 + end, HALF] : [HALF, 0.5 + end];
    out.push({ x0: b.cells[i][0] - ax, x1: b.cells[i][0] + ax, z0: b.cells[i][1] - az, z1: b.cells[i][1] + az });
  }
  return out;
}
const landingRect = (plot, reach, wide) => {
  const [dx, dz] = PORCH_DIR[(plot.rot || 0) % 4];
  const cx = plot.gx + Math.floor((plot.w - 1) / 2), cz = plot.gz + Math.floor((plot.d - 1) / 2);
  const inner = HARBOUR_SLAB / 2, half = wide / 2;
  const lo = Math.min(inner, reach), hi = Math.max(inner, reach);
  return dx
    ? { x0: cx + (dx > 0 ? lo : -hi), x1: cx + (dx > 0 ? hi : -lo), z0: cz - half, z1: cz + half }
    : { x0: cx - half, x1: cx + half, z0: cz + (dz > 0 ? lo : -hi), z1: cz + (dz > 0 ? hi : -lo) };
};
const area = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0))
  * Math.max(0, Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0));

test('a landing stops exactly where the lane it meets begins', () => {
  const plot = { gx: 10, gz: 10, w: 3, d: 3, rot: 3 };     // the door faces -x, so out at [9,11]
  // The lane across the front: its boards stop DECK_HALF from the middle of the door cell.
  const across = { id: 'a', axis: 'z', quay: true, cells: [[9, 10], [9, 11], [9, 12]] };
  assert.equal(quayPorchReach(plot, [across]), 11 - (9 + HALF));
  // And the lane that runs at the door instead: its own end lip already reaches most of the
  // way, so the landing is a third of the length. A landing built for the other case would
  // lie along this one for 0.66 on its own plane.
  const along = { id: 'b', axis: 'x', quay: true, cells: [[9, 11], [8, 11]] };
  assert.equal(quayPorchReach(plot, [along]), 11 - (9 + 0.5 + LIP));
  // Both at once: the nearer wins, because that is the one it would run into.
  assert.equal(quayPorchReach(plot, [across, along]), quayPorchReach(plot, [along]));
  // A lane that misses the width of the landing is a lane somewhere else on the quay.
  const elsewhere = { id: 'c', axis: 'z', quay: true, cells: [[9, 14], [9, 15]] };
  assert.equal(quayPorchReach(plot, [elsewhere]), 1.5);
  // And a river bridge is not a quay lane however close it runs.
  assert.equal(quayPorchReach(plot, [{ ...across, quay: false }]), 1.5);
});

test('a bent lane is measured where its boards actually are', () => {
  // drownRoads splits a path at the cells somebody else's deck already carries, which leaves
  // runs that turn a corner - [[38,12],[38,13],[38,14],[37,14]] is on the island as it
  // stands. Taking the record's `axis` for every cell of that run puts the last one's boards
  // a cell and a half from where they are drawn.
  const plot = { gx: 10, gz: 10, w: 3, d: 3, rot: 3 };
  const bent = { id: 'd', axis: 'z', quay: true, cells: [[9, 13], [9, 12], [9, 11]] };
  const straight = { id: 'e', axis: 'z', quay: true, cells: [[9, 10], [9, 11], [9, 12]] };
  // The bend's end cell sits at the door, and its lip runs along z rather than towards the
  // house, so the landing still reaches the same boards as the straight lane would.
  assert.equal(quayPorchReach(plot, [bent]), quayPorchReach(plot, [straight]));
});

test('a landing meets its lane whichever way the house and the lane are turned', () => {
  // Four rotations by two lane orientations, because that is the whole space the layout can
  // hand over and the two orientations are 0.66 apart. A gap here is a stride over open
  // water to a front door; an overlap is planks laid on planks.
  const rects = [];
  for (let rot = 0; rot < 4; rot++) {
    const plot = { gx: 20, gz: 20, w: 3, d: 3, rot };
    const [dx, dz] = PORCH_DIR[rot];
    const cx = 21, cz = 21;
    const door = [cx + dx * 2, cz + dz * 2];
    // Across the front, and along the approach: the two ways a lane can arrive at a door.
    const across = dx
      ? { id: `x${rot}`, axis: 'z', quay: true, cells: [[door[0], door[1] - 1], door, [door[0], door[1] + 1]] }
      : { id: `x${rot}`, axis: 'x', quay: true, cells: [[door[0] - 1, door[1]], door, [door[0] + 1, door[1]]] };
    const along = dx
      ? { id: `y${rot}`, axis: 'x', quay: true, cells: [door, [door[0] + dx, door[1]]] }
      : { id: `y${rot}`, axis: 'z', quay: true, cells: [door, [door[0], door[1] + dz]] };
    for (const lanes of [[across], [along], [across, along]]) {
      const reach = quayPorchReach(plot, lanes);
      assert.ok(reach > 0, `rot ${rot}: no landing at all`);
      const land = landingRect(plot, reach, PORCH_WIDE);
      rects.length = 0;
      for (const b of lanes) rects.push(...deckRects(b));
      for (const r of rects) {
        assert.equal(area(land, r).toFixed(4), '0.0000', `rot ${rot}: the landing lies over a lane`);
      }
      const tip = [cx + dx * (reach + 0.01), cz + dz * (reach + 0.01)];
      assert.ok(rects.some((r) => tip[0] > r.x0 && tip[0] < r.x1 && tip[1] > r.z0 && tip[1] < r.z1),
        `rot ${rot}: the landing ends in open water`);
    }
  }
});

test('the landing covers the cells between the house and its door', () => {
  // The planks are only half the job: main.js puts these cells in the map the settlers and
  // walk mode read their floor from, and without them the last stride to a front door is
  // over water whatever the boards look like.
  assert.deepEqual(quayPorchCells({ gx: 10, gz: 10, w: 3, d: 3, rot: 3 }), [[11, 11], [10, 11]]);
  assert.deepEqual(quayPorchCells({ gx: 10, gz: 10, w: 3, d: 3, rot: 1 }), [[11, 11], [12, 11]]);
  assert.deepEqual(quayPorchCells({ gx: 10, gz: 10, w: 3, d: 3, rot: 0 }), [[11, 11], [11, 10]]);
  assert.deepEqual(quayPorchCells({ gx: 10, gz: 10, w: 3, d: 3, rot: 2 }), [[11, 11], [11, 12]]);
  // A one-cell lot has no room for one, and asking for it must not invent a cell.
  assert.deepEqual(quayPorchCells({ gx: 5, gz: 5, w: 1, d: 1, rot: 0 }), []);
});

test('nothing hangs under a house on stilts but its piles', () => {
  // A dwelling is modelled with a skirt below its own ground line - the course that stops a
  // gap opening on the downhill side - and on land it is buried. Over water it is not, and
  // 0.30 of masonry hung under every house on the quay: a stone block slung beneath a house
  // that is supposed to be standing on posts. The floor is thickened and widened to bury it
  // the way ground would, so what reaches below the planks should be the floor, the piles,
  // and nothing broader than either.
  //
  // Both tiers, because the number that was wrong the first time was the hut's: a cottage's
  // skirt is 1.12 across and a floor cut to the hut's 1.06 left a finger of it showing all
  // the way round.
  for (const tier of ['hut', 'cottage', 'house', 'manor']) {
    const built = buildBuilding({
      id: `h:${tier}`, kind: 'house', tier, style: 'sonnet', harbour: true, ornaments: [],
      plot: { gx: 0, gz: 0, w: 3, d: 3, rot: 2 },
    }, { keepParts: true });
    const under = [];
    for (const g of built.parts) {
      g.computeBoundingBox();
      const b = g.boundingBox;
      if (b.min.y >= HARBOUR_FLOOR - 0.001) continue;             // none of it is below
      const w = b.max.x - b.min.x, d = b.max.z - b.min.z;
      if (w <= 0.2 && d <= 0.2) continue;                         // a pile, which is the point
      under.push({ w, d, y0: b.min.y, y1: b.max.y });
    }
    assert.ok(under.length, `${tier}: no floor under the house at all`);
    // The floor is the broadest of them, and everything else below the planks has to be
    // inside it: no lower, and no wider.
    const floor = under.reduce((a, b) => (b.w > a.w ? b : a));
    assert.ok(floor.w >= HARBOUR_SLAB - 0.001, `${tier}: the floor came out narrower than the least`);
    for (const u of under) {
      if (u === floor) continue;
      assert.ok(u.y0 >= floor.y0 - 0.001,
        `${tier}: something reaches ${(floor.y0 - u.y0).toFixed(2)} below the floor`);
      assert.ok(u.w <= floor.w + 0.001 && u.d <= floor.d + 0.001,
        `${tier}: something ${u.w.toFixed(2)} across shows past a floor of ${floor.w.toFixed(2)}`);
    }
  }
});

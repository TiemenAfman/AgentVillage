// The quay's docks: the one set on the island whose whole argument is a height.
//
// scripts/model-rules.mjs already knows the five pieces are within budget, stand on the
// ground and name real sheets - that is tests/models.test.mjs. What it cannot know is the
// thing this set was made for: that decking, head, ramp and mooring post are modelled in
// one frame, so that a pier laid out of all four comes out level from the sand to the last
// board and rides clear of the water rather than through it. That is what is checked here,
// and it is checked on the geometry the island actually builds rather than on the .blend,
// because the lift happens in buildPierGeometry and a set modelled perfectly and dropped
// by the wrong amount is a dock with a step in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { SEA_LEVEL } from '../shared/terrain.mjs';
import { DOCKS } from '../web/js/docks-mesh.js';

register('./support/shared-loader.mjs', import.meta.url);
// buildings.js builds a TextureLoader as it loads, and props.js is built on buildings.js.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildPierGeometry, buildDeckGeometry, meshAsset, QUAY_DECK, DECK_MIN } = await import('../web/js/buildings.js');
const { propGeometry, propLift } = await import('../web/js/props.js');
const models = await import('../web/js/models.js');
delete globalThis.document;

// The set's own datum, read off the model rather than written down again here: every piece
// is modelled with its pile feet on zero, so the top of a bay of decking is how high the
// planks ride in the .blend, and QUAY_DECK less that is what the island drops the lot by.
const boxOf = (asset) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const name of models.assetParts(asset)) {
    const p = models.part(name);
    for (let i = 0; i < p.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = p.positions[i + k] + p.at[k];
        lo[k] = Math.min(lo[k], v);
        hi[k] = Math.max(hi[k], v);
      }
    }
  }
  return { lo, hi };
};
const DOCK_DECK = boxOf('prop_dock_deck_a').hi[1];
const LIFT = QUAY_DECK - DOCK_DECK;

// A shore that shelves into open sea: land up to and including `shore`, water past it, and
// `wide` cells of it across the middle so a pier can be given an inlet too narrow for the
// head's wings. The same two questions buildPierGeometry asks of the island's terrain, and
// nothing else - which is the reason it takes one rather than reading the island's.
function coast({ shore = 5, wide = 9, size = 16 } = {}) {
  const mid = Math.floor(size / 2);
  const land = (gx, gz) => gz <= shore || Math.abs(gx - mid) > wide / 2;
  return {
    size,
    cellWorld: (gx, gz) => [gx - mid, gz - shore],      // the first water cell is the origin
    isLand: land,
    isWater: (gx, gz) => !land(gx, gz),
    mid,
    shore,
  };
}

// The run pierCells() would have recorded: `n` cells straight out from the shore.
const runOf = (t, n, step = [0, 1]) => Array.from({ length: n }, (_, i) => [
  t.mid + step[0] * (i + 1), t.shore + step[1] * (i + 1)]);

// The island builds a pier as one merged geometry, so the only way to ask how high the
// planks are over a spot is to ask the planks. These two do that properly rather than by
// looking for a vertex near the point: a board is a box, its corners are at its edges, and
// over the middle of a bay - which is exactly where every question here is asked - there is
// no vertex at all. The first cut of this file measured vertices and found the piles.
const trianglesOf = (geometry) => {
  const a = geometry.attributes.position.array;
  const out = [];
  for (let i = 0; i < a.length; i += 9) {
    out.push([[a[i], a[i + 1], a[i + 2]], [a[i + 3], a[i + 4], a[i + 5]], [a[i + 6], a[i + 7], a[i + 8]]]);
  }
  return out;
};

// How high you would stand if you stood at (x, z): the highest surface over that point, off
// the triangles that actually cover it. Projected flat and read off the barycentric
// coordinates, so a point on a board answers with the board, and a point with no dock over
// it answers with nothing - which is an answer two of the tests below are asking for.
function deckAt(tris, x, z) {
  let y = -Infinity;
  for (const [a, b, c] of tris) {
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-9) continue;                     // edge on: it covers no ground
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
    const w = 1 - u - v;
    if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
    y = Math.max(y, u * a[1] + v * b[1] + w * c[1]);
  }
  return y;
}

// Geometry is Float32, so a deck is level to the millimetre rather than to the bit: the
// arithmetic that puts it there is done in doubles and then rounded once on the way into
// the buffer, and 0.44 comes back as 0.43999999761.
const level = (y, at = QUAY_DECK) => Math.abs(y - at) < 1e-4;

const highest = (geometry) => {
  geometry.computeBoundingBox();
  return geometry.boundingBox.max.y;
};

test('the five pieces are one set of planks at one height', () => {
  // The three level bays are modelled to the same board, and that is what lets the island
  // lay them in any order along a run without measuring any of them.
  for (const asset of ['prop_dock_deck_a', 'prop_dock_deck_b', 'prop_dock_head']) {
    const b = boxOf(asset);
    assert.equal(b.hi[1], DOCK_DECK, `${asset} decks at ${b.hi[1]} rather than ${DOCK_DECK}`);
    assert.ok(Math.abs(b.lo[1]) < 0.002, `${asset} stands ${b.lo[1]} off its own pile feet`);
  }
  // The ramp climbs to the same plank surface - to within the width of half a board, which
  // is where its last board stops and the next bay's first one begins. Any further and
  // there would be a step in the deck where a settler walks off the beach.
  const ramp = boxOf('prop_dock_ramp');
  assert.ok(DOCK_DECK - ramp.hi[1] < 0.01, `the ramp tops out at ${ramp.hi[1]}, ${DOCK_DECK - ramp.hi[1]} under the deck`);
  assert.ok(ramp.lo[1] < 0.002 && ramp.hi[1] > 0.7, 'the ramp climbs from its feet to the deck');
  // And a mooring post is a pile that keeps going: it stands on the same feet and reaches
  // past the planks by enough to belay a rope on.
  const post = boxOf('prop_dock_post');
  assert.ok(post.hi[1] - DOCK_DECK > 0.4, `a post stands only ${post.hi[1] - DOCK_DECK} proud of the deck`);
  assert.ok(post.hi[0] < 0.1 && post.hi[2] < 0.1, 'a post is a post rather than a pier of its own');
  // The wide head is wide, and the walkway is not: the whole reason there are two.
  assert.ok(boxOf('prop_dock_head').hi[0] > boxOf('prop_dock_deck_a').hi[0] * 2, 'the head is no wider than the walkway');
  assert.equal(DOCKS.height, 1.37);
});

test('the deck rides over the water rather than through it', () => {
  // The pier this set replaces floated at 0.16 over a sea whose own shader lifts the
  // surface by up to 0.09, so at any hour the crests washed through the planks. DECK_MIN
  // is the clearance a bridge keeps for exactly that reason, and a pier keeps more.
  assert.ok(QUAY_DECK > DECK_MIN, `the quay decks at ${QUAY_DECK}, under a bridge's ${DECK_MIN}`);
  assert.ok(QUAY_DECK - SEA_LEVEL < 0.6, 'and not so high that it is a viaduct');
  // Every pile ends well under the surface. There is no seabed to stand them on, so what
  // has to be true is only that none of them stops where it could be seen stopping.
  assert.ok(LIFT < SEA_LEVEL - 0.2, `a pile foot sits at ${LIFT}, in plain sight`);
});

test('a pier comes out level from the sand to the last board', () => {
  const t = coast();
  const run = runOf(t, 4);
  const [cx, cz] = t.cellWorld(run[0][0], run[0][1]);
  const pier = buildPierGeometry(run, t, [cx, cz]);
  const tris = trianglesOf(pier);

  // Over the middle of every cell of the run, the planks are at QUAY_DECK exactly. This is
  // the assertion the whole set exists for: four bays, two of them a different model from
  // the other two, and a head on the end, all decking to one height.
  for (const cell of run) {
    const [x, z] = t.cellWorld(cell[0], cell[1]);
    assert.ok(level(deckAt(tris, x - cx, z - cz)),
      `the deck over cell ${cell} is at ${deckAt(tris, x - cx, z - cz)}, not ${QUAY_DECK}`);
  }
  // The shore cell is not in the run - the layout records the water a pier covers - and it
  // is where the ramp goes. Half way along the ramp is half the climb, which is what says
  // it is a ramp and not a bay somebody dropped low.
  const [sx, sz] = t.cellWorld(run[0][0], run[0][1] - 1);
  const half = deckAt(tris, sx - cx, sz - cz);
  assert.ok(half < QUAY_DECK - 0.15 && half > QUAY_DECK - 0.3,
    `the middle of the ramp is at ${half}, which is not half way up to ${QUAY_DECK}`);
  // And its foot comes down on the waterline, for the beach to rise the last hand's
  // breadth to meet: a ramp that stopped in mid-air would pass every assertion above.
  assert.ok(deckAt(tris, sx - cx, sz - cz - 0.45) < SEA_LEVEL + 0.06, 'the ramp does not reach the water');
  // The mooring posts stand over the planks by enough to belay a rope on.
  assert.ok(highest(pier) > QUAY_DECK + 0.4, 'no post stands over the run');
});

test('a pier runs the way the sea is, whichever way that is', () => {
  for (const step of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const t = coast();
    // The coast only shelves one way, so the other three bearings are tested against the
    // run alone: what is being checked is that the geometry follows `step`, which is the
    // one thing a rotation off atan2 can get wrong - and gets wrong quietly, because a
    // pier turned a quarter is still a pier, standing across its own district.
    const run = runOf(t, 4, step);
    const [cx, cz] = t.cellWorld(run[0][0], run[0][1]);
    const tris = trianglesOf(buildPierGeometry(run, t, [cx, cz]));
    const far = t.cellWorld(run[3][0], run[3][1]);
    assert.ok(level(deckAt(tris, far[0] - cx, far[1] - cz)),
      `a pier bearing ${step} has no deck over its own far cell`);
    // ...and nothing at all a cell out to the side of it, which is where a run turned the
    // wrong way round would have laid its planks.
    const aside = [(far[0] - cx) + step[1], (far[1] - cz) - step[0]];
    assert.equal(deckAt(tris, aside[0], aside[1]), -Infinity,
      `a pier bearing ${step} has planks a cell to the side of its far cell`);
  }
  // A pier of one cell has no two cells to take a bearing from, so it takes it from the
  // district it belongs to - which is inland of it, by construction.
  const t = coast();
  const run = runOf(t, 1);
  const [cx, cz] = t.cellWorld(run[0][0], run[0][1]);
  const tris = trianglesOf(buildPierGeometry(run, t, [cx, cz]));
  assert.ok(level(deckAt(tris, 0, 0)), 'a one-cell pier decks its own cell');
  const behind = deckAt(tris, 0, -1);
  assert.ok(behind > -Infinity && behind < QUAY_DECK, 'and ramps down behind it onto the beach');
});

test('the wide head is laid only where there is water to take its wings', () => {
  const wideAt = (t, run) => {
    const [cx, cz] = t.cellWorld(run[0][0], run[0][1]);
    const tris = trianglesOf(buildPierGeometry(run, t, [cx, cz]));
    const end = t.cellWorld(run[run.length - 1][0], run[run.length - 1][1]);
    // Out past the edge of the walkway, beside the last cell: decking there is a wing.
    return level(deckAt(tris, end[0] - cx + 0.6, end[1] - cz));
  };
  assert.ok(wideAt(coast(), runOf(coast(), 4)), 'open water gets no head');
  // An inlet one cell across. The head is 1.6 wide and would be drawn over the land on
  // both sides of it, so the run finishes on an ordinary bay instead.
  const narrow = coast({ wide: 1 });
  assert.ok(!wideAt(narrow, runOf(narrow, 4)), 'a one-cell inlet gets a head anyway');
});

test('a dock put down by hand is the quay\'s own dock, centred on where it was asked for', () => {
  const spec = { kind: 'dock', x: 0, z: 0, length: 4 };
  const g = propGeometry(spec);
  g.computeBoundingBox();
  const b = g.boundingBox;
  // Centred on the point, ramp included: a prop is placed by its middle, and a dock whose
  // ramp hangs off one end would be aimed by its planks and land by its beach.
  // To within the mooring posts, which are driven beside the head rather than under it and
  // so stand a little past the last board. The planks themselves are centred exactly.
  assert.ok(Math.abs(b.min.z + b.max.z) < 0.05, `the dock's middle is ${(b.min.z + b.max.z) / 2} off the spot`);
  assert.ok(Math.abs(b.min.x + b.max.x) < 0.01, 'the dock is off centre across the run');
  // Five cells of it: a ramp and four bays.
  assert.ok(Math.abs((b.max.z - b.min.z) - 5) < 0.1, `it is ${b.max.z - b.min.z} long rather than five cells`);
  // It carries its own height - buildPierGeometry works in world y so the quay's pier comes
  // out level whatever its district's centre sits at - so props.js must not lift it again.
  assert.equal(propLift(spec, { worldHeight: () => 3 }), 0);
  assert.ok(level(b.max.y - LIFT, DOCKS.height), 'a hand-placed dock stands at the same height as the quay');
  g.dispose();
});


test('Blender boardwalk bays join flat through a crossing without duplicated cells', () => {
  const ground = { cellWorld: (x, z) => [x, z] };
  const cells = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const g = buildDeckGeometry(cells, ground, [0, 0]);
  const duplicate = buildDeckGeometry([...cells, [0, 0]], ground, [0, 0]);
  assert.deepEqual(g.attributes.position.array, duplicate.attributes.position.array);
  const tris = trianglesOf(g);
  for (const [x, z] of [...cells, [.5, 0], [-.5, 0], [0, .5], [0, -.5]]) {
    assert.ok(level(deckAt(tris, x, z)), 'every bay and both kinds of join meet the walking height');
  }
  assert.equal(g.groups.length, 0, 'all boards share one draw call');
  assert.equal(buildDeckGeometry([], ground, [0, 0]), null);
});


test('the baked house platform meets the boardwalk without changing its footprint', () => {
  const geometry = meshAsset('civic_quay_platform', 0xffffff, {
    y: QUAY_DECK - models.heightOf('civic_quay_platform'),
  });
  const tris = geometry.flatMap(trianglesOf);
  for (const [x, z] of [[-1, 0], [1, 0], [0, 1.45], [.3, 1.45]]) {
    assert.ok(level(deckAt(tris, x, z)), 'house deck and front tongue are at the common deck height');
  }
  assert.equal(deckAt(tris, 1.2, 0), -Infinity, 'the platform stays inside its old width');
  assert.equal(deckAt(tris, .5, 1.45), -Infinity, 'the tongue stays inside its old width');
});

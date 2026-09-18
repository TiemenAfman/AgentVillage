// A settler's afternoon on the water, and the one thing that can go wrong with it.
//
// The rest of an outing is walking, which settlers.js has done since there were streets,
// and lifting a body from the quay into a hull, which is a lerp between two heights. The
// part with teeth is the route: a boat that is moved along its waypoints rather than
// sailed cannot notice a beach in front of it, so every point on the circle has to be
// open water before the settler ever steps aboard. That is what is checked here, over a
// coast made for the purpose - the same trick tests/docks.test.mjs plays, and for the same
// reason: the question is about the plan, not about any particular island.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeRng } from '../shared/rng.mjs';

// boating.js imports `shared/` the way the browser's import map spells it, so Node needs
// the same loader every other test of a web module uses.
register('./support/shared-loader.mjs', import.meta.url);
const { planVoyage, openWater } = await import('../web/js/boating.js');

// A coast that shelves into open sea. Land to the north of `shore`, water past it, and a
// grid wide enough that a big circle has somewhere to be. `half` is what boating.js turns
// a world point into a cell with, so the fake keeps the island's own convention.
function coast({ size = 96, shore = 30 } = {}) {
  const half = size / 2;
  return {
    size,
    half,
    isWater: (gx, gz) => gz > shore,
    cellWorld: (gx, gz) => [gx - half + 0.5, gz - half + 0.5],
  };
}

// A bay you can sail out of and a creek you cannot: two walls of land a few cells apart,
// running out to sea, with the dock at the head of the channel between them.
function creek({ size = 96, shore = 30, width = 3 } = {}) {
  const half = size / 2;
  const mid = Math.floor(size / 2);
  return {
    size,
    half,
    isWater: (gx, gz) => gz > shore && Math.abs(gx - mid) <= width / 2,
    cellWorld: (gx, gz) => [gx - half + 0.5, gz - half + 0.5],
  };
}

test('openWater wants a cell of margin round the hull', () => {
  const t = coast({ shore: 30 });
  // Two cells out from the beach: the cell is water and so are its neighbours.
  assert.equal(openWater(t, 0, 33 - t.half + 0.5), true);
  // The first water cell: its northern neighbour is the beach, so a hull does not fit.
  assert.equal(openWater(t, 0, 31 - t.half + 0.5), false);
  // And the beach itself is not water at all.
  assert.equal(openWater(t, 0, 29 - t.half + 0.5), false);
});

test('every point of a planned voyage is water a hull fits in', () => {
  const t = coast();
  const start = [0, 34 - t.half + 0.5];      // a berth a few cells off the beach
  let planned = 0;
  for (let seed = 0; seed < 200; seed++) {
    const points = planVoyage(t, start, [0, 1], makeRng(`voyage:${seed}`));
    if (!points) continue;
    planned++;
    for (const [x, z] of points) {
      assert.equal(openWater(t, x, z), true, `seed ${seed}: (${x.toFixed(2)}, ${z.toFixed(2)}) is not open water`);
    }
  }
  // Off an open coast a voyage is always plannable; the count is here so that a planner
  // which quietly started answering null could not pass this test by planning nothing.
  assert.equal(planned, 200);
});

test('a voyage comes back to the berth it left', () => {
  const t = coast();
  const start = [0, 34 - t.half + 0.5];
  for (let seed = 0; seed < 50; seed++) {
    const points = planVoyage(t, start, [0, 1], makeRng(`home:${seed}`));
    assert.ok(points, `seed ${seed} planned nothing off an open coast`);
    const end = points[points.length - 1];
    assert.ok(Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-9,
      `seed ${seed} ended ${Math.hypot(end[0] - start[0], end[1] - start[1]).toFixed(3)} from the berth`);
  }
});

test('a voyage goes somewhere: the circle leaves the berth behind', () => {
  const t = coast();
  const start = [0, 34 - t.half + 0.5];
  const points = planVoyage(t, start, [0, 1], makeRng('far'));
  const far = Math.max(...points.map(([x, z]) => Math.hypot(x - start[0], z - start[1])));
  // Twice the smallest radius the planner will fall back to, which is the least a circle
  // through the berth can carry a boat away from it.
  assert.ok(far > 2 * 5 * (1 - 4 * 0.16), `the furthest point was only ${far.toFixed(1)} from the berth`);
});

test('a dock up a creek plans nothing rather than sailing through the bank', () => {
  const t = creek();
  const start = [0.5, 34 - t.half + 0.5];
  for (let seed = 0; seed < 20; seed++) {
    assert.equal(planVoyage(t, start, [0, 1], makeRng(`creek:${seed}`)), null);
  }
});

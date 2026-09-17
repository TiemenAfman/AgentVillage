// The paving, and the one promise it has to keep.
//
// A settler walks the island from cell middle to cell middle - `settlers.js` plans on a
// four-connected BFS over road cells - and `gateOf` in main.js finds the way into a plot
// by looking a road cell up by its middle. The paving is drawn as a smoothed ribbon now
// rather than as half-cell tiles, and a smoothed ribbon is free to wander away from the
// points it was smoothed from. If it wanders far enough, the whole village walks beside
// its own paths and the only thing that would ever say so is somebody looking.
//
// So: no cell middle is ever further than LANE_DEV from the lane drawn through it, and no
// junction or plaza cell is ever anything but a tile on its own middle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// world.js reaches buildings.js for the tier table, and buildings.js asks for its texture
// sheets the moment it loads. The same stub the tavern test uses, for the same reason.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { roadGraph, smoothLane, offCurve } = await import('../web/js/world.js');
delete globalThis.document;

// The number world.js draws with. Written out here rather than exported, so that raising
// it over there has to be a deliberate change here too.
const LANE_DEV = 0.18;

const SIZE = 64;
const centre = ([gx, gz]) => [gx + 0.5, gz + 0.5];
const mid = (a, b) => [(centre(a)[0] + centre(b)[0]) / 2, (centre(a)[1] + centre(b)[1]) / 2];

// The line world.js hands to smoothLane: the edge of the tile it leaves, every cell
// middle along the way, and the edge of the tile it arrives at.
function laneOf(chain) {
  const out = [mid(chain.from, chain.run[0])];
  for (const c of chain.run) out.push(centre(c));
  if (chain.to) out.push(mid(chain.run[chain.run.length - 1], chain.to));
  return out;
}

function worstDeviation(paths, squares = []) {
  const graph = roadGraph(paths, squares, SIZE);
  let worst = 0;
  for (const chain of graph.chains) {
    const line = laneOf(chain);
    worst = Math.max(worst, offCurve(line, smoothLane(line, LANE_DEV)));
  }
  return { worst, graph };
}

const run = (from, steps) => {
  const cells = [from];
  let [x, z] = from;
  for (const [dx, dz] of steps) { x += dx; z += dz; cells.push([x, z]); }
  return cells;
};
const E = [1, 0], W = [-1, 0], S = [0, 1], N = [0, -1];

test('a straight lane is left alone and a right angle is cut by less than the bound', () => {
  const straight = laneOf({ from: [10, 10], run: [[11, 10], [12, 10], [13, 10]], to: [14, 10] });
  assert.deepEqual(smoothLane(straight, LANE_DEV), straight);

  // One corner, with room on both legs: the deepest cut the fillet is allowed to make.
  const bend = laneOf({ from: [10, 10], run: [[11, 10], [12, 10], [12, 11]], to: [12, 12] });
  const dev = offCurve(bend, smoothLane(bend, LANE_DEV));
  assert.ok(dev <= LANE_DEV + 1e-9, `a bend drifted ${dev.toFixed(4)}`);
  assert.ok(dev > 0.1, `a bend was not actually eased: ${dev.toFixed(4)}`);
});

test('a staircase - what a meandering router makes - stays inside the bound at every step', () => {
  // This is the case a spline cannot promise: eight right angles, one cell apart, where
  // two passes of Chaikin cut through the middles by about a third of a unit.
  const cells = run([8, 8], [E, S, E, S, E, S, E, S, E, S, E, S, E, S, E]);
  const { worst } = worstDeviation([{ id: 'road:stair', cells }]);
  assert.ok(worst <= LANE_DEV + 1e-9, `a staircase drifted ${worst.toFixed(4)}`);
});

test('every lane on a web of roads, footpaths and a plaza stays inside the bound', () => {
  // A plaza with roads out of it, a couple of house stubs, a dead end and a closed loop:
  // the four shapes that decide where a chain begins and ends.
  const plaza = [];
  for (let z = 20; z < 25; z++) for (let x = 20; x < 25; x++) plaza.push([x, z]);
  const paths = [
    { id: 'road:west', cells: run([22, 25], [S, S, W, W, S, S, W, S, S, S]) },
    { id: 'road:east', cells: run([25, 22], [E, E, N, E, E, N, N, E, E]) },
    { id: 'path:house:a', cells: run([19, 27], [W, W, N, W]) },
    { id: 'path:civic:b', cells: run([18, 30], [S, S, E]) },
    { id: 'road:ring', cells: [...run([40, 40], [E, E, S, S, W, W, N]), [40, 40]] },
  ];
  const { worst, graph } = worstDeviation(paths, plaza);
  assert.ok(worst <= LANE_DEV + 1e-9, `a lane drifted ${worst.toFixed(4)}`);
  assert.ok(graph.chains.length >= 5, `only ${graph.chains.length} lanes came out of that web`);

  // Every cell is drawn exactly once: either it is a tile of its own or it is on one lane.
  const tiled = new Set(graph.tiles.map((t) => t.gx + t.gz * SIZE));
  const laned = new Set();
  for (const chain of graph.chains) for (const [gx, gz] of chain.run) {
    const k = gx + gz * SIZE;
    assert.ok(!laned.has(k), `cell ${gx},${gz} is on two lanes`);
    assert.ok(!tiled.has(k), `cell ${gx},${gz} is both a tile and a lane`);
    laned.add(k);
  }
  assert.equal(tiled.size + laned.size, graph.cells.length, 'some cell of paving was never drawn');

  // A plaza is not a path: its corner cells have two neighbours each and would be taken
  // for a stretch of lane, which would bite a notch out of all four corners.
  for (const [gx, gz] of plaza) assert.ok(tiled.has(gx + gz * SIZE), `plaza cell ${gx},${gz} lost its paving`);
  // And a crossing keeps its middle, or `gateOf` and the settlers' BFS aim at grass.
  for (const t of graph.tiles) assert.ok(t.west || t.east || t.north || t.south, 'a tile with no road on it');
});

test('country roads and house paths share sand, with stone reserved for the plaza', () => {
  // Front paths braid into the road they leave. Their shared cells must keep
  // the same sand, while an explicitly paved town square takes precedence.
  const paths = [
    { id: 'road:spine', cells: run([5, 5], [E, E, E, E, E, E, E, E]) },
    { id: 'path:house:one', cells: run([9, 5], [S, S, S]) },
  ];
  const graph = roadGraph(paths, [], SIZE);
  const kinds = graph.chains.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ['sand', 'sand', 'sand']);
  // A junction shares the same sandy surface as both routes.
  const fork = graph.tiles.find((t) => t.gx === 9 && t.gz === 5);
  assert.ok(fork && fork.kind === 'sand' && fork.south && fork.west && fork.east);
  assert.equal(roadGraph(paths, [[9,5]], SIZE).kind.get(9+5*SIZE), 'plaza');
});

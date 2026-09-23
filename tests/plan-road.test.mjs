// A road drawn by hand in the planner, and the bridge it gets over a river. The things
// measured: the deck is exactly as long as the gap between the two banks (a bridge "to
// size"), the road joins the square, nothing that stood moves, the scan after is byte-
// identical, and a re-route that throws every path away paves the keeper's road again -
// nothing routes a road that no door asked for, so that is the whole point of
// `layout.roads`. Then the refusals, in the island's own words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAll, emptyLayout, replayGrid, clearRoads, FREE, PATH, SQUARE } from '../lib/layout.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { parsePlan, runPlan } from '../lib/plan.mjs';
import { reachableFromSquare } from '../shared/roads.mjs';
import { village, clone, stands, movedBetween } from './support/village.mjs';

const SIZE = 128;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const now = 1_800_000_000_000;

function settled(seed, settlers = 36) {
  const opts = { seed, size: SIZE };
  const model = village(settlers);
  const layout = emptyLayout(seed, SIZE);
  placeAll(layout, model, opts);
  placeAll(layout, model, opts);
  return { model, layout, opts };
}

// A road from the network to the far bank of a river: breadth-first over free ground from
// every cell the square can reach, and at each cell a look straight out across the water.
// Returns the road and the deck it should get, or null if this island has nowhere to try.
function crossing(layout, seed) {
  const t = makeTerrain(seed, { size: SIZE, polders: layout.polders, fairway: layout.fairway });
  const grid = replayGrid(t, layout);
  const open = reachableFromSquare({ paths: layout.paths, bridges: layout.bridges, island: { town: layout.town }, districts: [] }, SIZE);
  const ground = (x, z) => t.inGrid(x, z) && t.isLand(x, z) && [FREE, PATH, SQUARE].includes(grid.get(x, z));
  const prev = new Map();
  const queue = [];
  for (const k of open) { const x = k % SIZE, z = (k - x) / SIZE; prev.set(k, -1); queue.push([x, z, 0]); }
  for (let q = 0; q < queue.length; q++) {
    const [x, z, depth] = queue[q];
    for (const [dx, dz] of DIRS) {
      const deck = [];
      let wet = false, n = 1;
      for (; n <= 12; n++) {
        const cx = x + dx * n, cz = z + dz * n;
        if (!t.inGrid(cx, cz)) break;
        if (ground(cx, cz)) break;
        if (t.isRiver(cx, cz)) wet = true;
        deck.push([cx, cz]);
      }
      const far = [x + dx * n, z + dz * n];
      const beyond = [x + dx * (n + 1), z + dz * (n + 1)];
      if (!deck.length || !wet || n > 12 || !ground(...far) || !ground(...beyond) || open.has(far[0] + far[1] * SIZE)) continue;
      if (deck.some(([cx, cz]) => grid.get(cx, cz) !== 3)) continue;   // BLOCKED, nothing built
      const back = [];
      for (let k = x + z * SIZE; k !== -1; k = prev.get(k)) back.push([k % SIZE, (k - (k % SIZE)) / SIZE]);
      return { road: [...back.reverse(), ...deck, far, beyond], deck, t };
    }
    if (depth >= 40) continue;
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz, k = nx + nz * SIZE;
      if (prev.has(k) || !ground(nx, nz)) continue;
      prev.set(k, x + z * SIZE);
      queue.push([nx, nz, depth + 1]);
    }
  }
  return null;
}

function riverIsland() {
  for (const seed of [1337, 7, 42, 99, 2024, 5, 11, 314]) {
    const s = settled(seed);
    const c = crossing(s.layout, seed);
    if (c) return { ...s, ...c, seed };
  }
  return null;
}

test('a road drawn over a river gets a bridge exactly as long as the gap', () => {
  const r = riverIsland();
  assert.ok(r, 'none of the seeds tried has a river to cross within reach of the roads');
  const { model, layout, opts, road, deck } = r;
  const wasStanding = stands(layout);
  const before = clone(layout);

  const plan = parsePlan({ ops: [{ op: 'road', cells: road }] });
  const dry = runPlan(layout, model, plan, { ...opts, dryRun: true, now });
  assert.ok(dry.ok, dry.error || JSON.stringify(dry.verdicts));
  assert.equal(JSON.stringify(layout), JSON.stringify(before), 'a dry run changed the layout');

  const out = runPlan(layout, model, plan, { ...opts, now });
  assert.ok(out.ok, out.error);
  assert.deepEqual(movedBetween(wasStanding, stands(layout)), [], 'a road moved a building');

  const id = 'road:keeper:1';
  assert.equal(layout.roads.length, 1);
  assert.deepEqual(layout.roads[0].cells, road);
  const bridges = layout.bridges.filter((b) => b.id === id);
  assert.equal(bridges.length, 1, 'one crossing, one bridge');
  assert.deepEqual(bridges[0].cells, deck, 'the deck is the gap, no more and no less');
  const mid = road.findIndex((c) => c[0] === deck[0][0] && c[1] === deck[0][1]);
  assert.equal(bridges[0].axis, road[mid][0] !== road[mid - 1][0] ? 'x' : 'z');

  // Every cell of it is walkable from the square.
  const open = reachableFromSquare({ paths: layout.paths, bridges: layout.bridges, island: { town: layout.town }, districts: [] }, SIZE);
  for (const [gx, gz] of road) assert.ok(open.has(gx + gz * SIZE), `${gx},${gz} of the road is cut off`);

  // And the scan after changes nothing.
  const settledCopy = JSON.stringify(layout);
  placeAll(layout, model, opts);
  assert.equal(JSON.stringify(layout), settledCopy, 'the scan after a road was drawn moved something');

  // A re-route throws every path away; the keeper's road comes back, bridge and all.
  clearRoads(layout);
  placeAll(layout, model, opts);
  placeAll(layout, model, opts);
  const paved = new Set([...layout.paths.flatMap((p) => p.cells), ...layout.bridges.flatMap((b) => b.cells)].map(([x, z]) => `${x},${z}`));
  for (const [gx, gz] of road) assert.ok(paved.has(`${gx},${gz}`), `${gx},${gz} was not paved again after a re-route`);
  assert.deepEqual(layout.bridges.filter((b) => b.id === id).map((b) => b.cells), [deck]);
});

test('a road that ends on the deck or leads nowhere is refused', () => {
  const r = riverIsland();
  assert.ok(r);
  const { model, layout, opts, road, deck } = r;
  const refuse = (cells, re) => {
    const out = runPlan(layout, model, parsePlan({ ops: [{ op: 'road', cells }] }), { ...opts, dryRun: true, now });
    assert.equal(out.ok, false, `accepted: ${JSON.stringify(cells)}`);
    assert.match(out.verdicts[0].reason || '', re);
  };
  // Stops on the deck.
  const mid = road.findIndex((c) => c[0] === deck[0][0] && c[1] === deck[0][1]);
  refuse(road.slice(0, mid + 1), /dry ground/);
  // Only the far side: land that does not reach the square.
  refuse(road.slice(-2), /join/);
});

test('the wire takes a road only as a string of neighbouring cells', () => {
  assert.throws(() => parsePlan({ ops: [{ op: 'road', cells: [[1, 1]] }] }), /at least two/);
  assert.throws(() => parsePlan({ ops: [{ op: 'road', cells: [[1, 1], [3, 1]] }] }), /jumps/);
  assert.throws(() => parsePlan({ ops: [{ op: 'road', cells: [[1, 1], [2, 1], [1, 1]] }] }), /crosses itself/);
  assert.throws(() => parsePlan({ ops: [{ op: 'road', cells: [[1, 1], [1.5, 1]] }] }), /whole number/);
  assert.deepEqual(parsePlan({ ops: [{ op: 'road', cells: [[1, 1], [1, 2]] }] }).ops[0], { op: 'road', cells: [[1, 1], [1, 2]] });
});

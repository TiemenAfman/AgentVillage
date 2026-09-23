// The walk, on its own, in Node.
//
// Note what this file does NOT do: no `register('./support/shared-loader.mjs')`, no
// `globalThis.document` stub. It imports shared/settlerwalk.mjs and shared/terrain.mjs
// directly and they load. That is the whole point of the port and is worth stating as a
// property rather than as a convenience - the moment this file needs a stub, something has
// reached back into the browser and the sea can no longer step a crowd.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWalk, findPath, MAX_STROLL, DT } from '../shared/settlerwalk.mjs';
import { roadCells, squareCells } from '../shared/roads.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const SIZE = 64;
const SEED = 1337;

// A lane straight across the middle of the island, and a little square on it. Built out of
// land cells only, so the walk has somewhere real to go.
function streets(terrain) {
  const lane = [];
  const square = [];
  const mid = Math.round(terrain.half);
  for (let gx = 8; gx < SIZE - 8; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  for (let gz = mid - 1; gz <= mid + 1; gz++) {
    for (let gx = mid - 1; gx <= mid + 1; gx++) if (terrain.isLand(gx, gz)) square.push([gx, gz]);
  }
  return { lane, square };
}

// A village of `n` houses, each planted on a land cell beside the lane.
function crowd(terrain, lane, n) {
  const out = [];
  for (let i = 0; i < n && i * 2 < lane.length; i++) {
    const [gx, gz] = lane[i * 2];
    out.push({
      id: `house:${String(i).padStart(4, '0')}`,
      kind: 'house', name: `House ${i}`, style: 'opus',
      plot: { gx, gz: gz + 1, w: 1, d: 1, rot: 0 },
    });
  }
  return out;
}

function village(n = 20) {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const { lane, square } = streets(terrain);
  const specs = crowd(terrain, lane, n);
  const make = () => {
    const walk = createWalk(terrain);
    walk.setRoads([{ id: 'lane', cells: lane }], square);
    for (const spec of specs) {
      const at = terrain.cellWorld(spec.plot.gx, spec.plot.gz);
      walk.spawn(spec.id, spec, [at[0], 0, at[1]], {}, 1);
    }
    return walk;
  };
  return { terrain, lane, square, specs, make };
}

const snapshot = (walk) => [...walk.figures.values()]
  .map((f) => `${f.id}|${f.pos[0]}|${f.pos[1]}|${f.y}|${f.mode}|${f.anim}`);

test('the walk loads in Node with no loader and no document', () => {
  assert.equal(typeof createWalk, 'function');
  assert.equal(typeof globalThis.document, 'undefined', 'nothing here needed a browser');
  assert.equal(DT, 0.05);
});

test('the same ticks give the same world, however they are grouped', () => {
  const v = village(24);
  const a = v.make();
  const b = v.make();
  for (let i = 0; i < 20000; i++) a.advance(1, 0);
  let left = 20000;
  while (left > 0) { const take = Math.min(left, 7); b.advance(take, 0); left -= take; }
  // Bit for bit, not to a tolerance. The point is exactness: two machines stepping the
  // same crowd have to arrive at the same place, and "close enough" drifts.
  assert.deepEqual(snapshot(b), snapshot(a));
});

test('nothing in the walk can differ between two engines', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../shared/settlerwalk.mjs', import.meta.url)), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|random)\s*\(/;
  const m = src.match(banned);
  assert.equal(m, null, `shared/settlerwalk.mjs uses ${m && m[0]} - see the rule at the top of shared/rng.mjs`);
  assert.ok(!/Date\.now|performance\.now/.test(src), 'the walk must not read a clock: it counts ticks');
  assert.ok(!/from '\.\.\/web\//.test(src) && !/three/.test(src), 'and must not reach into the browser');
});

test('settlers walk the roads, and every one of them comes home to the millimetre', () => {
  const v = village(20);
  const walk = v.make();
  const home = new Map([...walk.figures.values()].map((f) => [f.id, [f.home[0], f.home[1]]]));

  let walked = 0;
  const onRoad = new Set(v.lane.map(([gx, gz]) => `${gx},${gz}`));
  for (let i = 0; i < 60000; i++) {
    walk.advance(1, 0);
    if (i % 40) continue;
    for (const f of walk.figures.values()) {
      if (f.mode !== 'walk' || !f.path) continue;
      walked++;
      // Within half a cell of a lane cell: a settler on an errand is on the street, not
      // cutting across the fields.
      const gx = Math.round(f.pos[0] + v.terrain.half - 0.5);
      const gz = Math.round(f.pos[1] + v.terrain.half - 0.5);
      let near = false;
      for (let dz = -1; dz <= 1 && !near; dz++) {
        for (let dx = -1; dx <= 1 && !near; dx++) if (onRoad.has(`${gx + dx},${gz + dz}`)) near = true;
      }
      assert.ok(near, `${f.id} is off the road at ${f.pos}`);
    }
  }
  assert.ok(walked > 50, `only ${walked} samples of anybody walking; the errands never started`);

  // And whoever is back at rest is back at their own doorstep, exactly. keepHome is what
  // makes that true, and it is the subtlest thing in the file: an arrival settles where it
  // lands, an errand does not.
  for (const f of walk.figures.values()) {
    if (f.after || f.then || f.gathering) continue;
    const was = home.get(f.id);
    assert.equal(f.home[0], was[0], `${f.id} moved house`);
    assert.equal(f.home[1], was[1], `${f.id} moved house`);
  }
});

test('never more than MAX_STROLL are out at once', () => {
  const v = village(60);
  const walk = v.make();
  let most = 0;
  for (let i = 0; i < 40000; i++) {
    walk.advance(1, 0);
    if (i % 25) continue;
    let out = 0;
    for (const f of walk.figures.values()) if (f.mode === 'walk') out++;
    if (out > most) most = out;
  }
  assert.ok(most <= MAX_STROLL, `${most} were out at once, and the cap is ${MAX_STROLL}`);
});

test('the borrel fills the square and then empties it again', () => {
  const v = village(24);
  const walk = v.make();
  const home = new Map([...walk.figures.values()].map((f) => [f.id, [f.home[0], f.home[1]]]));

  walk.setGather(true);
  for (let i = 0; i < 24000; i++) walk.advance(1, 0);
  const atParty = [...walk.figures.values()].filter((f) => f.gathering).length;
  assert.ok(atParty > 0, 'nobody came');

  walk.setGather(false);
  for (let i = 0; i < 40000; i++) walk.advance(1, 0);
  assert.equal([...walk.figures.values()].filter((f) => f.gathering).length, 0, 'somebody is still at the bar');
  for (const f of walk.figures.values()) {
    if (f.after || f.then) continue;
    assert.deepEqual([f.home[0], f.home[1]], home.get(f.id), `${f.id} did not get their doorstep back`);
  }
});

test('a borrowed settler is invisible to the errand timer, and given back intact', () => {
  const v = village(12);
  const walk = v.make();
  for (let i = 0; i < 400; i++) walk.advance(1, 0);

  const spare = walk.available(3, null);
  assert.ok(spare.length > 0, 'nobody could be spared');
  const id = spare[0].id;
  assert.equal(walk.charter(id), true);
  const f = walk.figures.get(id);
  const door = [f.home[0], f.home[1]];

  for (let i = 0; i < 20000; i++) walk.advance(1, 0);
  assert.equal(f.chartered, true, 'somebody else planned an errand for them');
  assert.ok(f.mode !== 'walk' || f.path, 'a chartered settler is not sent off on a stroll');
  assert.deepEqual([f.home[0], f.home[1]], door, 'charter pins the door they started at');

  walk.release(id);
  assert.equal(f.chartered, false, 'given back');
  // "The back of the errand queue" is about their own stroll timer, not about being
  // lendable again: nobody comes home from the water and walks straight off into town.
  // They are borrowable the moment they are back, which is right - somebody standing on
  // the quay with nothing to do is exactly who you would ask next.
  assert.ok(f.strollIn >= 40, `their next errand is only ${f.strollIn}s away`);
  assert.ok(f.pause > 0, 'and they stand about for a moment first');
});

test('a door with no street near it never plans an errand and never throws', () => {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const walk = createWalk(terrain);
  walk.setRoads([], []);                       // an island before there were any lanes
  const at = terrain.cellWorld(20, 20);
  walk.spawn('house:lonely', { id: 'house:lonely', kind: 'house', name: 'Lonely', style: 'opus', plot: { gx: 20, gz: 20, w: 1, d: 1, rot: 0 } }, [at[0], 0, at[1]], {}, 1);
  for (let i = 0; i < 20000; i++) walk.advance(1, 0);
  assert.equal(walk.figures.get('house:lonely').mode, 'idle');
});

test('the roads a settler walks come out of the village, not out of the renderer', () => {
  const v = { paths: [{ id: 'a', cells: [[1, 1]] }], bridges: [{ id: 'b', cells: [[2, 2]] }],
    island: { town: { paved: [[5, 5]] } }, districts: [{ paved: [[6, 6]] }] };
  assert.deepEqual(roadCells(v).map((p) => p.id), ['a', 'b'], 'a bridge is a road, or the far bank is unreachable');
  assert.deepEqual(squareCells(v), [[5, 5], [6, 6]]);
  assert.deepEqual(roadCells({}), []);
  assert.deepEqual(squareCells({}), []);
});

test('findPath stays on land and gives a route you can follow', () => {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const land = [];
  for (let gz = 0; gz < SIZE && land.length < 2; gz++) {
    for (let gx = 0; gx < SIZE; gx++) if (terrain.isLand(gx, gz)) { land.push([gx, gz]); break; }
  }
  const from = land[0];
  const to = [Math.round(terrain.half), Math.round(terrain.half)];
  const path = findPath(terrain, from, to, null);
  if (!path) return;                           // no way across is a legitimate answer
  for (const [x, z] of path) {
    const gx = Math.round(x + terrain.half - 0.5), gz = Math.round(z + terrain.half - 0.5);
    assert.ok(terrain.isLand(gx, gz), `the route goes through water at ${gx},${gz}`);
  }
});

test('an errand that arrives says so, and says it once', () => {
  const v = village(8);
  const walk = v.make();
  const who = [...walk.figures.values()][0];
  assert.equal(walk.charter(who.id), true);

  // Two waypoints along the lane, which the settler can certainly reach.
  const mid = Math.round(v.terrain.half);
  const points = [v.lane[3], v.lane[5]].map(([gx]) => v.terrain.cellWorld(gx, mid));

  const said = [];
  assert.equal(walk.sendOut(who.id, points, (arrived) => said.push(arrived)), true);

  // Long enough for the slowest stride to cover a couple of cells, and then some.
  for (let i = 0; i < 4000 && !said.length; i++) walk.advance(1, 0);

  // The bug this is here for: walkRoute grew an `after` parameter ahead of `onDone` when
  // the errand hooks became records, and sendOut kept passing its callback third. It
  // landed in `f.after`, finishPath found no `kind` on a function and dropped it, and
  // every caller of sendOut - which is to say every outing on the water - waited for an
  // arrival that had already happened. Nothing threw and nothing looked broken.
  assert.deepEqual(said, [true], 'sendOut never called back on arrival');
  assert.equal(who.mode, 'idle');

  for (let i = 0; i < 200; i++) walk.advance(1, 0);
  assert.equal(said.length, 1, 'and it must not go on saying so');
});

test('an errand with nowhere to walk fails loudly instead of hanging', () => {
  const walk = village(4).make();
  const who = [...walk.figures.values()][0];
  walk.charter(who.id);
  const said = [];
  assert.equal(walk.sendOut(who.id, [], (arrived) => said.push(arrived)), false);
  assert.deepEqual(said, [false]);
});

test('quay residents use the permanent deck before browser measurements arrive', () => {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const spec = { id: 'house:quay', kind: 'house', harbour: true,
    plot: { gx: 33, gz: 31, w: 3, d: 3, rot: 0, quay: true } };
  const v = { buildings: [spec], districts: [{ kind: 'quay',
    deck: [[30, 30], [31, 30]], pier: [[29, 30]] }] };
  const walk = createWalk(terrain, v);
  const home = [2.5, 0, .5];
  const f = walk.spawn(spec.id, spec, home);
  assert.equal(f.y, .44, 'even the first position starts on the house deck');
  // A stale browser snapshot may still describe the old ground, or no quay at all.
  walk.setDecks(new Map([[30 + 30 * SIZE, 2.8], [20 + 20 * SIZE, 1.2]]));
  for (const cell of [[29, 30], [30, 30], [31, 30], [33, 31], [34, 32]]) {
    f.pos = terrain.cellWorld(...cell);
    f.attend = [...f.pos];
    walk.advance(1, 0);
    assert.equal(f.y, .44, 'pier, boardwalk and house deck all carry the settler');
  }
  assert.equal(walk.groundOrDeck(...terrain.cellWorld(20, 20)), 1.2, 'bridge measurements still apply');
  walk.setDecks(null);
  assert.equal(walk.groundOrDeck(...terrain.cellWorld(30, 30)), .44, 'clearing measurements keeps the permanent quay');
  const land = terrain.cellWorld(10, 10);
  assert.equal(walk.groundOrDeck(...land), terrain.worldHeight(...land), 'ordinary ground keeps its own height');
});

test('builders stand outside their doorstep and face the house at every rotation', () => {
  const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (const kind of ['house', 'shed']) for (let rot = 0; rot < 4; rot++) {
    const walk = createWalk(makeTerrain(SEED, { size: SIZE }));
    const [ox, oz] = directions[rot];
    for (let i = 0; i < 20; i++) {
      walk.spawn(`builder:${i}`, { kind, plot: { rot } }, [0, 0, 0], { mode: 'hammer' });
    }
    walk.advance(100);
    for (const f of walk.figures.values()) {
      assert.equal(f.anim, 'hammer');
      assert.ok(Math.abs(f.pos[0] - ox * (kind === 'shed' ? .66 : 1.20)) < 1e-8);
      assert.ok(Math.abs(f.pos[1] - oz * (kind === 'shed' ? .66 : 1.20)) < 1e-8);
      assert.ok(f.face[0] * -ox + f.face[1] * -oz > 0, 'look towards the house');
    }
  }
});

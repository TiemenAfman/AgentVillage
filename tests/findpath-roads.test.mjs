import test from 'node:test';
import assert from 'node:assert/strict';
import { findPath, ROAD_STEP } from '../shared/settlerwalk.mjs';

// A flat 40 x 40 island and a road along row 7 with a spur down to each end of the route; the
// same island with a river down column 20 for the bridge.
const size = 40;
const terrain = { size, isLand: () => true, slope: () => 0, cellWorld: (x, z) => [x, z] };
const river = { ...terrain, isLand: (x) => x !== 20 };
const key = (x, z) => x + z * size;
const roadCells = [];
for (let x = 0; x <= 30; x++) roadCells.push([x, 7]);
for (let z = 7; z <= 10; z++) roadCells.push([0, z], [30, z]);
const road = new Set(roadCells.map(([x, z]) => key(x, z)));
const deck = new Set([key(20, 7)]);
const onRoad = (path) => path.filter(([x, z]) => road.has(key(x, z))).length / path.length;

test('a route crosses a river over an open cell, and not without one', () => {
  assert.equal(findPath(river, [0, 10], [30, 10], null), null);
  const path = findPath(river, [0, 10], [30, 10], null, { open: deck });
  assert.ok(path);
  assert.ok(path.some(([x]) => x === 20));
});

test('a route follows a road that is longer rather than cutting across the fields', () => {
  const across = findPath(terrain, [0, 10], [30, 10], null);          // no preference: straight where it can
  const along = findPath(terrain, [0, 10], [30, 10], null, { prefer: road });
  assert.ok(along.length > across.length - 1, 'the road is the longer way');
  assert.ok(onRoad(along) > 0.9, `${Math.round(onRoad(along) * 100)}% of it on the road`);
  assert.ok(onRoad(across) < 0.2, 'without preference it does not bother');
  assert.ok(ROAD_STEP > 0 && ROAD_STEP < 1);
});

test('a fence is walked round to its gate rather than through', () => {
  // A fence along row 15 from column 0 to 38, open at column 8 where a road passes.
  const fenceCost = (cost) => (a, b) => {
    const [ax, az] = [a % size, Math.floor(a / size)], [bx, bz] = [b % size, Math.floor(b / size)];
    return (az < 15) !== (bz < 15) && az !== bz && Math.max(ax, bx) <= 38 && ax !== 8 ? cost : 0;
  };
  const direct = findPath(terrain, [5, 10], [5, 20], null);
  const round = findPath(terrain, [5, 10], [5, 20], null, { crossing: fenceCost(12) });
  assert.ok(direct.every(([x]) => x === 5), 'without a fence: straight on');
  assert.ok(round.some(([x, z]) => x === 8 && z >= 14 && z <= 16), 'with one: through the gate at 8');
  // A fence is not a wall: when the gate is further than the fence is worth, walking through is the answer.
  const cheap = findPath(terrain, [5, 10], [5, 20], null, { crossing: fenceCost(4) });
  assert.ok(cheap.every(([x]) => x === 5), 'four steps of fence is cheaper than six of detour');
});

test('a deck is entered at its ends, never from the side halfway across', () => {
  // A river down column 20, crossed by a deck of five cells along row 10 (x 18..22) that rises in steps
  // of 0.4 to a crown of 1.1 over the bank at 0. The banks are land right up to the deck's side.
  const heights = new Map([[18, 0.3], [19, 0.7], [20, 1.1], [21, 0.7], [22, 0.3]]);
  const deck = new Map([...heights].map(([x, y]) => [key(x, 10), y]));
  const surface = (k) => (deck.has(k) ? deck.get(k) : 0);
  const step = (a, b) => (!deck.has(a) && !deck.has(b)) || surface(b) - surface(a) <= 0.44;
  const island = { size, isLand: (x) => x !== 20, slope: () => 0, cellWorld: terrain.cellWorld };
  const firstDeck = (path) => path.find(([x, z]) => deck.has(key(x, z)));
  // From the east bank to the west, opposite the middle of the deck: the shortest way boards it from the side.
  const free = findPath(island, [21, 11], [19, 11], null, { open: deck });
  const held = findPath(island, [21, 11], [19, 11], null, { open: deck, step });
  assert.deepEqual(firstDeck(free), [21, 10], 'without the limit: up on to the deck from the side');
  assert.ok([18, 22].includes(firstDeck(held)[0]), 'with it: on at an end of the deck');
  assert.ok(held.length > free.length, 'the long way round to the end');
});

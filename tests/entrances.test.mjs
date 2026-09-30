// shared/entrances.mjs: the one sum the page and the server both make. The derived entrances are
// measured in tests/hamlet-sign-placement.test.mjs (through the page's wrapper); here, the
// keeper's own gates and the pieces the sum is built from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { landOf, outwardOf, entrancesOf, maxEntrances, SIDES } from '../shared/entrances.mjs';

const lat = { anchor: [0, 0], pitch: 4 };
const supers = [[0, 0], [1, 0], [0, 1], [1, 1]];              // cells 0..7 both ways
const walk = ([x0, z0], [x1, z1]) => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  return Array.from({ length: n + 1 }, (_, k) => [x0 + Math.sign(x1 - x0) * k, z0 + Math.sign(z1 - z0) * k]);
};
const paths = [{ id: 'road:p:h:0', cells: walk([3, 3], [3, 20]) }, { id: 'road:keeper:1', cells: walk([-8, 5], [12, 5]) }];
const of = (population, gates = null, extra = {}) => entrancesOf({ lat, supers, population, id: 'p:h', paths, gates, ...extra });

test('a hamlet\'s land knows which side of its middle a cell is on, and where it leaves the land', () => {
  const land = landOf(lat, supers);
  assert.equal(land.cx, 4);
  assert.equal(land.cz, 4);
  assert.deepEqual(['n', 'e', 's', 'w'].map((s) => land.sideOf(...{ n: [4, 0], e: [7, 4], s: [4, 7], w: [0, 4] }[s])), ['n', 'e', 's', 'w']);
  assert.ok(land.mine(0, 0) && land.mine(7, 7) && !land.mine(8, 0) && !land.mine(-1, 0));
  assert.deepEqual(outwardOf(land, [7, 4], 'e'), [8, 4]);
  assert.deepEqual(outwardOf(land, [7, 7], 'n'), [8, 7], 'a corner leaves by whichever side is off the land');
  assert.equal(outwardOf(land, [4, 4], 'n'), null, 'the middle is not an edge');
  assert.equal(landOf(lat, []), null);
});

test('the keeper\'s gate wins its side over the road that crosses there', () => {
  const derived = of(20).find((e) => e.side === 'w');
  assert.deepEqual(derived.at, [0, 5]);
  const set = of(20, { w: { at: [0, 2] } }).find((e) => e.side === 'w');
  assert.ok(set.fixed);
  assert.deepEqual([set.at, set.next], [[0, 2], [-1, 2]]);
});

test('a shut side has no entrance, whatever road runs there', () => {
  assert.ok(of(20).some((e) => e.side === 'w'));
  assert.ok(!of(20, { w: { closed: true } }).some((e) => e.side === 'w'));
});

test('a gate that is no longer on the land or on its edge is ignored, not obeyed', () => {
  assert.deepEqual(of(20, { w: { at: [30, 30] } }).find((e) => e.side === 'w').at, [0, 5], 'off the land: back to the road');
  assert.deepEqual(of(20, { w: { at: [4, 4] } }).find((e) => e.side === 'w').at, [0, 5], 'in the middle: back to the road');
});

test('a gate on a side with no road at all is an entrance all the same', () => {
  const list = entrancesOf({ lat, supers, population: 6, id: 'p:h', paths: [], gates: { n: { at: [3, 0] } } });
  assert.equal(list.length, 1);
  assert.equal(list[0].side, 'n');
  assert.ok(list[0].fixed);
  assert.deepEqual(list[0].next, [3, -1]);
});

test('the keeper\'s gates come first when there are more sides than the size allows', () => {
  const gates = { e: { at: [7, 6] } };
  const list = of(3, gates);                                   // one entrance only
  assert.equal(list.length, 1);
  assert.equal(list[0].side, 'e');
  assert.ok(list[0].fixed);
  assert.equal(list[0].label, null);
  const two = of(6, gates);                                    // two: the gate and the way to the square
  assert.deepEqual(two.map((e) => e.side), ['e', 's']);
  assert.deepEqual(two.map((e) => e.label), ['East entrance', 'South entrance']);
  assert.deepEqual(two.map((e) => e.back), ['East exit', 'South exit']);
});

test('the size rule, and the sides in order', () => {
  assert.deepEqual([0, 5, 6, 14, 15, 39, 40].map(maxEntrances), [1, 1, 2, 2, 3, 3, 4]);
  assert.deepEqual(SIDES, ['n', 'e', 's', 'w']);
});

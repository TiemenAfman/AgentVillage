import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
const { hamletSignSites, hamletEntrances, maxEntrances } = await import('../web/js/hamlet-sign-placement.js');

const terrain = { size: 40, isLand: () => true, cellWorld: (x, z) => [x, z], worldHeight: () => 1 };

// A straight run of cells from one point to another, along one axis.
const walk = ([x0, z0], [x1, z1]) => {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  return Array.from({ length: n + 1 }, (_, k) => [x0 + Math.sign(x1 - x0) * k, z0 + Math.sign(z1 - z0) * k]);
};
const road = walk([20, 0], [20, 39]);                              // runs south (+z)
// A gate at the road's cell `i` looking along it in direction `dir`.
const gateAt = (cells, i, dir = 1) => ({ at: cells[i], next: cells[i + dir] });

// The three cells of the gateway: the road cell and the one either side of it.
const footprint = (site) => [-1, 0, 1].map((n) => [site.gx + (site.along ? 0 : n), site.gz + (site.along ? n : 0)]);
const onPath = (cells, x, z) => cells.some(([px, pz]) => px === x && pz === z);
// Where the lettered face points: local +Z turned by `turn` about y, as three.js does.
const facing = (turn) => [Math.round(Math.sin(turn)), Math.round(Math.cos(turn))];

test('the gateway stands over the road, posts either side, face to whoever walks in', () => {
  for (const [name, cells, dir, out] of [
    ['south', road, 1, [0, 1]],
    ['north', road, -1, [0, -1]],
    ['east', road.map(([x, z]) => [z, x]), 1, [1, 0]],
    ['west', road.map(([x, z]) => [z, x]), -1, [-1, 0]],
  ]) {
    const site = hamletSignSites({ paths: [{ cells }] }, terrain)(gateAt(cells, 20, dir));
    assert.ok(site.over, name);
    assert.equal(site.along, out[0] !== 0, name);
    assert.ok(onPath(cells, site.gx, site.gz), `${name}: centred on the road`);
    const [left, , right] = footprint(site);
    assert.ok(!onPath(cells, ...left) && !onPath(cells, ...right), `${name}: posts clear of the paving`);
    assert.deepEqual(facing(site.turn), out, `${name}: face points the way out of the hamlet`);
    // At the boundary, not somewhere in the middle of the village.
    assert.ok(Math.abs(site.gx - cells[20][0]) + Math.abs(site.gz - cells[20][1]) <= 1, `${name}: at the entrance`);
  }
});

test('a junction, a bend and occupied plots never catch a post', () => {
  const cross = road.map(([x, z]) => [z, x]);
  const bend = [...walk([20, 0], [20, 20]), ...walk([21, 20], [39, 20])];
  for (const [paths, gate, buildings] of [
    [[{ cells: road }, { cells: cross }], gateAt(road, 20), []],      // a crossing road at the gate itself
    [[{ cells: bend }], gateAt(bend, 19), []],                        // the road turns just past the gate
  ]) {
    const all = paths.flatMap((p) => p.cells);
    const site = hamletSignSites({ paths, buildings }, terrain)(gate);
    assert.ok(site);
    for (const [x, z] of footprint(site).filter((_, n) => n !== 1)) assert.ok(!onPath(all, x, z));
    for (const { plot } of buildings) {
      for (const [x, z] of footprint(site)) assert.ok(!(x >= plot.gx && x < plot.gx + plot.w && z >= plot.gz && z < plot.gz + plot.d));
    }
    if (site.over) {
      // Paving straight on either way along the road: no bend under the beam.
      const [dx, dz] = site.along ? [1, 0] : [0, 1];
      for (const n of [-1, 0, 1]) assert.ok(onPath(all, site.gx + n * dx, site.gz + n * dz));
    }
  }
});

test('paving that is not one path still counts as the road', () => {
  // Two paths that meet: the second records only the cells it paved itself, one street apart.
  const a = walk([20, 0], [20, 19]), b = walk([20, 21], [20, 39]);
  const site = hamletSignSites({ paths: [{ cells: a }, { cells: b }, { cells: [[20, 20]] }] }, terrain)({ at: [20, 20], next: [20, 21] });
  assert.ok(site.over);
  assert.deepEqual([site.gx, site.gz], [20, 20]);
});

test('a road with no clean stretch gets no sign, rather than one beside it or on it', () => {
  const stair = [];
  for (let n = 0; n < 12; n++) stair.push([20 + n, 10 + n], [21 + n, 10 + n]);   // a staircase: never straight
  assert.equal(hamletSignSites({ paths: [{ cells: stair }] }, terrain)({ at: stair[6], next: stair[7] }), null);
  // A road with paving on both sides of it: a post would stand on the road beside.
  const twin = [...walk([19, 0], [19, 39]), ...walk([21, 0], [21, 39])];
  assert.equal(hamletSignSites({ paths: [{ cells: road }, { cells: twin }] }, terrain)(gateAt(road, 20)), null);
});

test('between two lines of houses the gateway squeezes onto the lots, right at the boundary', () => {
  const lots = [{ plot: { gx: 14, gz: 10, w: 6, d: 25 } }, { plot: { gx: 21, gz: 10, w: 6, d: 25 } }];
  const place = hamletSignSites({ paths: [{ cells: road }], buildings: lots }, terrain);
  const site = place(gateAt(road, 20));
  assert.ok(site.over);
  assert.ok(Math.abs(site.gz - 20) <= 1, 'at the boundary, one cell out at most');
  assert.ok(!onPath(road, ...footprint(site)[0]) && !onPath(road, ...footprint(site)[2]));
});

test('water, steep ground and an absent entrance get no sign', () => {
  const gate = gateAt(road, 20);
  assert.equal(hamletSignSites({}, terrain)(null), null);
  assert.equal(hamletSignSites({}, { ...terrain, isLand: () => false })(gate), null);
  assert.equal(hamletSignSites({}, { ...terrain, worldHeight: (x) => x })(gate), null);
});

test('two signs at one gate keep to separate footprints', () => {
  const place = hamletSignSites({ paths: [{ cells: road }] }, terrain);
  const a = place(gateAt(road, 20)), b = place(gateAt(road, 20));
  const cellsA = footprint(a).map(String);
  assert.ok(!footprint(b).some((c) => cellsA.includes(String(c)) && !onPath(road, ...c)));
});

// ---- the entrances of a hamlet ------------------------------------------------
// One hamlet on a 2 x 2 patch of 4-cell super-cells: cells 0..7 in both directions.
const lattice = { anchor: [0, 0], pitch: 4 };
const hamlet = (population) => ({
  id: 'p:h', population,
  lobes: [{ parcel: { i0: 0, j0: 0, w: 2, h: 2, rows: ['11', '11'] } }],
});

test('a small place has the one entrance, and it carries no label', () => {
  const village = { island: { lattice }, paths: [{ id: 'road:p:h:0', cells: walk([3, 3], [3, 20]) }] };
  const list = hamletEntrances(village, hamlet(3));
  assert.equal(list.length, 1);
  assert.equal(list[0].side, 's');
  assert.equal(list[0].label, null);
  assert.equal(list[0].back, null);
  assert.deepEqual(list[0].at, [3, 7]);
  assert.deepEqual(list[0].next, [3, 8]);
});

test('a road looping through opens a second entrance; an inbound one is read outwards', () => {
  const village = {
    island: { lattice },
    paths: [
      { id: 'road:p:h:0', cells: walk([3, 3], [3, 20]) },
      { id: 'road:keeper:9', cells: walk([-8, 5], [12, 5]) },       // comes in from the west, leaves east
    ],
  };
  const list = hamletEntrances(village, hamlet(20));
  assert.deepEqual(list.map((e) => e.side), ['e', 's', 'w']);
  assert.deepEqual(list.map((e) => e.label), ['East entrance', 'South entrance', 'West entrance']);
  assert.deepEqual(list.map((e) => e.back), ['East exit', 'South exit', 'West exit']);
  const west = list.find((e) => e.side === 'w');
  assert.deepEqual(west.at, [0, 5]);
  assert.deepEqual(west.next, [-1, 5]);
});

test('roads that reach the edge over gaps in one path still cross it once', () => {
  // The road out of a hamlet records only what it paved: the cells between are another path's.
  const village = { island: { lattice }, paths: [
    { id: 'road:p:h:0', cells: walk([3, 3], [3, 5]) },
    { id: 'road:other:1', cells: walk([3, 6], [3, 30]) },
  ] };
  const list = hamletEntrances(village, hamlet(3));
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].at, list[0].next], [[3, 7], [3, 8]]);
});

test('never more than four, and no more than the size allows', () => {
  assert.deepEqual([3, 6, 15, 40].map(maxEntrances), [1, 2, 3, 4]);
  const village = {
    island: { lattice },
    paths: [
      { id: 'road:p:h:0', cells: walk([3, 3], [3, 20]) },
      { id: 'road:keeper:1', cells: walk([-8, 5], [12, 5]) },
      { id: 'road:keeper:2', cells: walk([5, -8], [5, 3]) },
    ],
  };
  const sides = (population) => hamletEntrances(village, hamlet(population)).map((e) => e.side);
  assert.deepEqual(sides(3), ['s'], 'the way to the square is the one a small place keeps');
  assert.equal(sides(20).length, 3);
  assert.deepEqual(sides(60), ['n', 'e', 's', 'w']);
  village.paths.push({ id: 'road:keeper:3', cells: walk([12, 2], [-1, 2]) });   // a second road through the same two sides
  assert.equal(sides(60).length, 4);
});

test('a road is a road: polder, harbour, keeper and town roads count, a house front path does not', () => {
  const village = { island: { lattice }, paths: [
    { id: 'road:polder:0', cells: walk([-8, 5], [12, 5]) },
    { id: 'road:harbour:1', cells: walk([5, -8], [5, 12]) },
  ] };
  assert.deepEqual(hamletEntrances(village, hamlet(60)).map((e) => e.side), ['n', 'e', 's', 'w']);
  const civic = { island: { lattice }, paths: [{ id: 'path:civic:shipyard', cells: walk([-8, 5], [12, 5]) }, { id: 'path:house:abc', cells: walk([5, -8], [5, 12]) }] };
  assert.deepEqual(hamletEntrances(civic, hamlet(60)).map((e) => e.side), ['e', 'w']);
});

test('on one side a bridge the keeper built wins over a road that merely crosses nearer the middle', () => {
  const village = { island: { lattice }, paths: [{ id: 'road:keeper:1', cells: walk([-8, 2], [3, 2]) }] };
  const bridge = walk([-6, 6], [3, 6]);                 // lands at the far end of the west edge
  const west = hamletEntrances(village, hamlet(3), bridge);
  assert.equal(west.length, 1);
  assert.deepEqual(west[0].at, [0, 6]);
  const without = hamletEntrances(village, hamlet(3));
  assert.deepEqual(without[0].at, [0, 2]);
});

test('a bridge the keeper built is a way in: it lands on grass and still counts', () => {
  // The bridge runs west from the hamlet's edge (cell 0) over a river; nothing is paved inside.
  const bridge = walk([-6, 5], [3, 5]);          // its axis, banks and all
  const village = { island: { lattice }, paths: [] };
  assert.deepEqual(hamletEntrances(village, hamlet(3)), [], 'without the bridge there is no road at all');
  const list = hamletEntrances(village, hamlet(3), bridge);
  assert.equal(list.length, 1);
  assert.equal(list[0].side, 'w');
  assert.deepEqual([list[0].at, list[0].next], [[0, 5], [-1, 5]]);
  // and the sign stands on the fence line at its foot, not on the bridge's deck cells
  const site = hamletSignSites(village, terrain, bridge)(list[0]);
  assert.ok(site && site.over);
  assert.deepEqual([site.gx, site.gz, site.fx], [0, 5, -0.5]);
  assert.deepEqual(facing(site.turn), [-1, 0]);
});

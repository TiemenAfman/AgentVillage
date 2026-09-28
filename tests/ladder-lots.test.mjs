// The ladder past a hundred (Plans/mijlpalen-tot-tweehonderd.md), as numbers and shapes: the
// eleven rungs, the id each stands as, what is on the yard's slipway at every settler count,
// the first two civic lots that are not square, and the two things about them that have to
// cross the wire - a lot sixteen long, and the slipway's stage.
//
// What is not here is where any of it stands on an island: tests/rede.test.mjs and
// tests/harbour-sites.test.mjs measure that. This is the arithmetic those rely on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MILESTONES, civicIdOf, yardStage } from '../lib/village.mjs';
import { lotOf, stamped, plotDoor, doorCell, outsideDoor, SHIP_LOT, YARD_LOT, YARD_GATE, CASTLE_LOT } from '../lib/layout.mjs';
import { buildBundle, parseBundle } from '../lib/islandbundle.mjs';
import { guestVillage } from '../lib/guestview.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const RUNGS = [
  ['shipyard', 95, 'shipyard', 'civic:shipyard'],
  ['brewery', 106, 'brewery', 'civic:brewery'],
  ['fishery', 113, 'fishery', 'civic:fishery'],
  ['ship', 120, 'ship', 'civic:ship'],
  ['warehouse', 127, 'warehouse', 'civic:warehouse'],
  ['trainingfield', 134, 'trainingfield', 'civic:trainingfield'],
  ['quarry', 142, 'quarry', 'civic:quarry'],
  ['ship2', 158, 'ship', 'civic:ship:2'],
  ['weighhouse', 184, 'weighhouse', 'civic:weighhouse'],
  ['ship3', 192, 'ship', 'civic:ship:3'],
  ['chronicle', 200, 'chronicle', 'civic:chronicle'],
];

test('the eleven rungs from 95 to 200, each standing as a building of its own', () => {
  for (const [id, at, civicType, building] of RUNGS) {
    const m = MILESTONES.find((r) => r.id === id);
    assert.ok(m, `the ladder has ${id}`);
    assert.equal(m.at, at, `${id} is at ${at}`);
    assert.equal(m.civicType, civicType);
    assert.equal(civicIdOf(m), building);
  }
  // Every rung its own building: three share a civicType, and a second copy of `civic:ship`
  // would be the second ship finding the first one's plot and taking it for her own.
  const ids = MILESTONES.map(civicIdOf);
  assert.equal(new Set(ids).size, ids.length, 'two rungs stand as the same building');
  // The ones that were there keep the id they always had.
  for (const m of MILESTONES) if (!m.civicId) assert.equal(civicIdOf(m), `civic:${m.civicType}`);
  // And the ladder still ends where it did below a hundred: nothing that stood moved rung.
  const before = { castle: 100, poldermill: 150, crane: 165, bridge: 90, owlpost: 85 };
  for (const [id, at] of Object.entries(before)) assert.equal(MILESTONES.find((m) => m.id === id).at, at);
});

test('the slipway, at every settler count from nothing to past the top of the ladder', () => {
  // [first settler count, stage] - each launch at 120, 158 and 192, and the keel 25, the frames
  // 18, the hull 11 and the masts 5 settlers before it. Written out as the plan gives them.
  const from = [[0, 0], [95, 1], [102, 2], [109, 3], [115, 4], [120, 0],
    [133, 1], [140, 2], [147, 3], [153, 4], [158, 0],
    [167, 1], [174, 2], [181, 3], [187, 4], [192, 0]];
  for (let n = 0; n <= 260; n++) {
    const want = from.filter(([at]) => at <= n).pop()[1];
    assert.equal(yardStage(n), want, `${n} settlers`);
  }
});

test('a lot is five by sixteen or four by sixteen along its rot, and square otherwise', () => {
  assert.deepEqual(SHIP_LOT, { w: 4, d: 16 });
  assert.deepEqual(YARD_LOT, { w: 5, d: 16 });
  assert.deepEqual(lotOf('ship'), SHIP_LOT);
  assert.deepEqual(lotOf('shipyard'), YARD_LOT);
  assert.deepEqual(lotOf('castle'), { w: CASTLE_LOT, d: CASTLE_LOT });
  assert.deepEqual(lotOf('crane'), { w: 1, d: 1 });
  for (const t of ['tavern', 'brewery', 'fishery', 'warehouse', 'weighhouse', 'quarry', 'trainingfield', 'chronicle']) assert.deepEqual(lotOf(t), { w: 3, d: 3 }, t);
  // The long side runs along z at rot 0 and 2 and along x at 1 and 3; turning a square does nothing.
  for (const rot of [0, 1, 2, 3]) {
    const odd = rot % 2 === 1;
    assert.deepEqual(stamped(SHIP_LOT, rot), odd ? { w: 16, d: 4 } : { w: 4, d: 16 }, `ship at ${rot}`);
    assert.deepEqual(stamped(YARD_LOT, rot), odd ? { w: 16, d: 5 } : { w: 5, d: 16 }, `yard at ${rot}`);
    assert.deepEqual(stamped({ w: 3, d: 3 }, rot), { w: 3, d: 3 });
    // Sixteen is the ceiling parseBundle holds every plot to.
    const s = stamped(YARD_LOT, rot);
    assert.ok(Math.max(s.w, s.d) <= 16);
  }
});

// lib/layout.mjs's doors as they were before a lot could be anything but square.
const oldDoor = (gx, gz, rot, w) => { const m = w >> 1; return rot === 0 ? [gx + m, gz] : rot === 1 ? [gx + w - 1, gz + m] : rot === 2 ? [gx + m, gz + w - 1] : [gx, gz + m]; };
const oldStep = (gx, gz, rot, w) => { const m = w >> 1; return rot === 0 ? [gx + m, gz - 1] : rot === 1 ? [gx + w, gz + m] : rot === 2 ? [gx + m, gz + w] : [gx - 1, gz + m]; };
// The page's quarter turns (web/js/shipyard.js turnLocal, makeRecord's yaw), written out again
// here so the test of where the yard's gate lands does not borrow the answer.
const TURN = [(x, z) => [-x, -z], (x, z) => [z, -x], (x, z) => [x, z], (x, z) => [-z, x]];

test('a door is where it always was on a square lot, nowhere on a ship, and at the model\'s gate on the yard', () => {
  for (const rot of [0, 1, 2, 3]) {
    for (const w of [3, CASTLE_LOT]) {
      assert.deepEqual(doorCell(10, 20, rot, w), oldDoor(10, 20, rot, w));
      assert.deepEqual(outsideDoor(10, 20, rot, w), oldStep(10, 20, rot, w));
      const p = { gx: 10, gz: 20, w, d: w, rot };
      assert.deepEqual(plotDoor('civic:tavern', p), { door: oldDoor(10, 20, rot, w), step: oldStep(10, 20, rot, w) });
      assert.deepEqual(plotDoor('house:x', { ...p, w: 3, d: 3 }).step, oldStep(10, 20, rot, 3));
    }
    for (const id of ['civic:ship', 'civic:ship:2', 'civic:ship:3']) {
      assert.equal(plotDoor(id, { gx: 10, gz: 20, ...stamped(SHIP_LOT, rot), rot }), null, `${id} has no door`);
    }
    assert.equal(plotDoor('civic:well', { gx: 1, gz: 1, w: 1, d: 1, rot }), null);

    // The yard: the gate's point in the model's frame, turned the page's way, lands on the
    // edge between the door and the step; the door is on the lot, in its landward row, and the
    // step is off it on the landward side, where the sea end is not.
    const lot = stamped(YARD_LOT, rot);
    const p = { gx: 10, gz: 20, ...lot, rot };
    const { door, step } = plotDoor('civic:shipyard', p);
    const centre = [p.gx + p.w / 2, p.gz + p.d / 2];
    const world = (x, z) => { const [dx, dz] = TURN[rot](x, z); return [centre[0] + dx, centre[1] + dz]; };
    const cellOf = ([x, z]) => [Math.floor(x), Math.floor(z)];
    assert.deepEqual(door, cellOf(world(YARD_GATE[0], YARD_GATE[1] + 0.25)), `rot ${rot}: the door is inside the gate`);
    assert.deepEqual(step, cellOf(world(YARD_GATE[0], YARD_GATE[1] - 0.25)), `rot ${rot}: the step is outside it`);
    const on = ([x, z]) => x >= p.gx && x < p.gx + p.w && z >= p.gz && z < p.gz + p.d;
    assert.ok(on(door) && !on(step), `rot ${rot}: door on the lot, step off it`);
    const land = world(0, -8), sea = world(0, 8);
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    assert.ok(d2(step, land) < d2(step, sea), `rot ${rot}: the gate is at the landward end`);
    // Not in the middle of that end, where the shed stands.
    assert.notDeepEqual(door, cellOf(world(0, -7.75)), `rot ${rot}: not the middle of the landward end`);
  }
});

// ---- over the wire ---------------------------------------------------------------------
const SIZE = 64, SEED = 1337;
const config = { islandName: 'Promptholm', seed: SEED, port: 4747, gridSize: SIZE, foundedAt: '2026-09-16T10:22:44.431Z' };
const civic = (id, civicType, plot, extra = {}) => ({
  id, kind: 'civic', civicType, district: null, plot, door: null, name: id, label: id,
  startedAt: '2026-09-17T09:00:00.000Z', lastAt: null, style: 'unknown', tier: 'civic', ornaments: [],
  active: false, archived: false, stats: {}, tools: {}, sheds: [], ...extra,
});
function village(buildings) {
  return {
    v: 1, generatedAt: '2026-09-18T10:00:00.000Z',
    island: { name: 'Promptholm', seed: SEED, foundedAt: config.foundedAt, terrainHash: makeTerrain(SEED, { size: SIZE, polders: [] }).hash, landing: [25, 54], town: null, lattice: null },
    grid: { size: SIZE }, districts: [], buildings, paths: [], bridges: [], cleared: [], polders: [], milestones: [], stats: { settlers: 120 },
  };
}
const wire = (buildings) => JSON.parse(JSON.stringify(buildBundle({ config, village: village(buildings) })));

test('a ship four by sixteen and a yard five by sixteen come through parseBundle whole, either way round', () => {
  const buildings = [
    civic('civic:ship', 'ship', { gx: 10, gz: 20, w: 16, d: 4, rot: 1 }),
    civic('civic:ship:2', 'ship', { gx: 30, gz: 2, w: 4, d: 16, rot: 0 }),
    civic('civic:shipyard', 'shipyard', { gx: 40, gz: 30, w: 5, d: 16, rot: 2 }, { stage: 3, door: [44, 30] }),
    civic('civic:ship:3', 'ship', { gx: 5, gz: 5, w: 16, d: 4, rot: 3 }),
  ];
  const sent = wire(buildings);
  const got = parseBundle(JSON.parse(JSON.stringify(sent)));
  assert.deepEqual(got, sent, 'the round trip is exact');
  for (const b of buildings) {
    const came = got.buildings.find((x) => x.id === b.id);
    assert.deepEqual(came.plot, b.plot, `${b.id} keeps its lot`);
  }
  assert.equal(got.buildings.find((x) => x.id === 'civic:shipyard').stage, 3);
});

test('a lot a cell longer than sixteen is refused on the way in, and clamped on the way out', () => {
  const sent = wire([civic('civic:ship', 'ship', { gx: 10, gz: 20, w: 16, d: 4, rot: 1 })]);
  sent.buildings[0].plot.w = 17;
  assert.throws(() => parseBundle(sent), /outside 1\.\.16/);
  const packed = wire([civic('civic:ship', 'ship', { gx: 10, gz: 20, w: 17, d: 4, rot: 1 })]);
  assert.equal(packed.buildings[0].plot.w, 16, 'our own side clamps rather than sending what it will be refused for');
});

test('the yard\'s stage is a whole number 0 to 4 on the way in, forgiven on the way out, and absent elsewhere', () => {
  const yard = (stage) => civic('civic:shipyard', 'shipyard', { gx: 40, gz: 30, w: 5, d: 16, rot: 2 }, stage === undefined ? {} : { stage });
  for (const s of [0, 1, 2, 3, 4]) assert.equal(parseBundle(wire([yard(s)])).buildings[0].stage, s);
  for (const bad of [5, -1, 2.5]) {
    const w = wire([yard(0)]);
    w.buildings[0].stage = bad;
    assert.throws(() => parseBundle(w), undefined, `${bad} is refused`);
  }
  const text = wire([yard(0)]);
  text.buildings[0].stage = '3';
  assert.throws(() => parseBundle(text), /whole number/, 'a number written as text is refused');
  // The sending side clamps, drops what is not a number, and gives nobody else the key.
  assert.equal(wire([yard(7)]).buildings[0].stage, 4);
  assert.equal('stage' in wire([yard('x')]).buildings[0], false);
  assert.equal('stage' in wire([yard(undefined)]).buildings[0], false, 'no stage, no key');
  assert.equal('stage' in wire([civic('civic:tavern', 'tavern', { gx: 1, gz: 1, w: 3, d: 3, rot: 0 })]).buildings[0], false);
  // A sea from before the field reads a bundle that has one: parseBundle builds a new object,
  // so an old one simply never copies it - which is the fall-back to the empty slip.
  // And the redaction keeps it, since it is nothing out of a conversation.
  const shown = guestVillage(village([yard(2)]));
  assert.equal(shown.buildings[0].stage, 2);
});

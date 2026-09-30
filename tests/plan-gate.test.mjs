// The ways into a hamlet, set by the keeper (Plans/DONE/ingangen-verplaatsen.md): the `gate` op writes
// `layout.gates`, `placeAll` lays the road from the gate to the square, a gate that moves or
// shuts takes its road off the list, a hamlet carried away takes its gate along, and the
// server says no in the island's own words to a gate that cannot stand where it was put.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAll, emptyLayout, replayGrid, latticeOf, FREE, PATH } from '../lib/layout.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { landOf, outwardOf, entrancesOf, SIDES } from '../shared/entrances.mjs';
import { reachableFromSquare } from '../shared/roads.mjs';
import { parsePlan, runPlan } from '../lib/plan.mjs';
import { village, clone, stands, movedBetween } from './support/village.mjs';

const SIZE = 128;
const now = 1_800_000_000_000;
const D = 'proj:0';

// Twelve projects of six: two entrances each, by the size rule.
function settled(seed = 1337, settlers = 72) {
  const opts = { seed, size: SIZE };
  const model = village(settlers);
  const layout = emptyLayout(seed, SIZE);
  placeAll(layout, model, opts);
  placeAll(layout, model, opts);
  return { model, layout, opts };
}

// Every cell on the edge of a hamlet's land where a gate could stand, by side.
function candidates(layout, district = D) {
  const t = makeTerrain(1337, { size: SIZE, polders: layout.polders, fairway: layout.fairway });
  const lat = latticeOf(layout);
  const supers = layout.districts[district].lobes.flatMap((l) => l.cells);
  const land = landOf(lat, supers);
  const grid = replayGrid(t, layout);
  const out = { n: [], e: [], s: [], w: [] };
  for (const [i, j] of supers) {
    for (let dz = 0; dz < lat.pitch; dz++) {
      for (let dx = 0; dx < lat.pitch; dx++) {
        const gx = lat.anchor[0] + i * lat.pitch + dx, gz = lat.anchor[1] + j * lat.pitch + dz;
        if (!land.mine(gx, gz) || !t.isLand(gx, gz) || ![FREE, PATH].includes(grid.get(gx, gz))) continue;
        const side = land.sideOf(gx, gz);
        if (outwardOf(land, [gx, gz], side)) out[side].push([gx, gz]);
      }
    }
  }
  return { out, land, lat, t };
}
const gateOp = (side, at, extra = {}) => ({ op: 'gate', district: D, side, ...(at ? { at } : {}), ...extra });
const real = (s, ops) => runPlan(s.layout, s.model, parsePlan({ ops }), { ...s.opts, now });
const dry = (s, ops) => runPlan(s.layout, s.model, parsePlan({ ops }), { ...s.opts, dryRun: true, now });

// The first cell of a side the server accepts, tried on a copy.
function firstAccepted(s, side, skip = () => false) {
  for (const at of candidates(s.layout).out[side]) {
    if (skip(at)) continue;
    if (dry(s, [gateOp(side, at)]).ok) return at;
  }
  return null;
}
const reach = (layout) => reachableFromSquare({ paths: layout.paths, bridges: layout.bridges || [], island: { town: layout.town }, districts: [] }, SIZE);
const entrances = (s, gates) => entrancesOf({
  lat: latticeOf(s.layout), supers: s.layout.districts[D].lobes.flatMap((l) => l.cells), population: 6, id: D,
  paths: s.layout.paths, townPaved: [], gates,
});

test('the wire takes a gate as a side and a cell, shut, or forgotten', () => {
  assert.deepEqual(parsePlan({ ops: [gateOp('n', [10, 12])] }).ops[0], { op: 'gate', district: D, side: 'n', at: [10, 12] });
  assert.deepEqual(parsePlan({ ops: [gateOp('e', null, { closed: true })] }).ops[0], { op: 'gate', district: D, side: 'e', closed: true });
  assert.deepEqual(parsePlan({ ops: [gateOp('s', null, { clear: true })] }).ops[0], { op: 'gate', district: D, side: 's', clear: true });
  assert.throws(() => parsePlan({ ops: [gateOp('x', [1, 1])] }), /side is n, e, s or w/);
  assert.throws(() => parsePlan({ ops: [gateOp('n')] }), /at \[gx, gz\]/);
  assert.throws(() => parsePlan({ ops: [gateOp('n', [1.5, 2])] }), /whole number/);
});

test('a gate is written, its road leaves it for the square, and the scan after changes nothing', () => {
  const s = settled();
  const side = SIDES.find((x) => candidates(s.layout).out[x].length);
  assert.ok(side, 'the first hamlet has no edge to put a gate on');
  const at = firstAccepted(s, side);
  assert.ok(at, `no cell on the ${side} side is accepted`);
  const before = clone(s.layout);
  const wasStanding = stands(s.layout);

  const d = dry(s, [gateOp(side, at)]);
  assert.ok(d.ok, d.error || JSON.stringify(d.verdicts));
  assert.equal(JSON.stringify(s.layout), JSON.stringify(before), 'a dry run changed the layout');

  const out = real(s, [gateOp(side, at)]);
  assert.ok(out.ok, out.error);
  assert.deepEqual(movedBetween(wasStanding, stands(s.layout)), [], 'a gate moved a building');
  assert.deepEqual(s.layout.gates[D][side], { at });
  assert.ok(reach(s.layout).has(at[0] + at[1] * SIZE), 'no road leads from the gate to the square');

  // The scan after is byte-identical again.
  const settledCopy = JSON.stringify(s.layout);
  placeAll(s.layout, s.model, s.opts);
  assert.equal(JSON.stringify(s.layout), settledCopy, 'the scan after a gate moved something');

  // The page and the server read it the same way: the keeper's gate is the entrance on that side.
  const e = entrances(s, s.layout.gates[D]).find((x) => x.side === side);
  assert.ok(e && e.fixed && e.at[0] === at[0] && e.at[1] === at[1]);
});

test('a gate moved or shut takes its road off the list, and giving it back is a plan of its own', () => {
  const s = settled();
  const side = SIDES.find((x) => candidates(s.layout).out[x].length > 3);
  assert.ok(side);
  const a = firstAccepted(s, side);
  assert.ok(real(s, [gateOp(side, a)]).ok);
  const id = `road:gate:${D}:${side}`;
  assert.ok(reach(s.layout).has(a[0] + a[1] * SIZE));

  const b = firstAccepted(s, side, ([x, z]) => Math.abs(x - a[0]) + Math.abs(z - a[1]) < 3);
  if (b) {
    assert.ok(real(s, [gateOp(side, b)]).ok);
    assert.deepEqual(s.layout.gates[D][side], { at: b });
    assert.ok(reach(s.layout).has(b[0] + b[1] * SIZE), 'the road did not follow the gate');
  }

  assert.ok(real(s, [gateOp(side, null, { closed: true })]).ok);
  assert.deepEqual(s.layout.gates[D][side], { closed: true });
  assert.ok(!s.layout.paths.some((p) => p.id === id), 'a shut gate keeps its road on the list');
  assert.ok(!entrances(s, s.layout.gates[D]).some((x) => x.side === side), 'a shut side is an entrance');

  assert.ok(real(s, [gateOp(side, null, { clear: true })]).ok);
  assert.equal(s.layout.gates && s.layout.gates[D], undefined, 'nothing is left once every side is given back');
});

test('a gate that was set goes with its land when the hamlet is carried away', () => {
  // Thirty-six settlers: room on the island for the belt to allow a move at all (tests/plan-move).
  const s = settled(1337, 36);
  const side = SIDES.find((x) => candidates(s.layout).out[x].length);
  const at = firstAccepted(s, side);
  assert.ok(real(s, [gateOp(side, at)]).ok);
  const pitch = latticeOf(s.layout).pitch;
  const lobes = s.layout.districts[D].lobes.map((_, lobe) => ({ district: D, lobe }));
  for (let r = 1; r <= 14; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const move = { op: 'move', lobes, di, dj };
        if (!dry(s, [move]).ok) continue;
        assert.ok(real(s, [move]).ok);
        const moved = s.layout.gates[D][side].at;
        assert.deepEqual(moved, [at[0] + di * pitch, at[1] + dj * pitch]);
        assert.ok(reach(s.layout).has(moved[0] + moved[1] * SIZE), 'the road was not laid again from the new place');
        return;
      }
    }
  }
  assert.fail('no move of the hamlet was accepted, so the gate could not be carried');
});

test("a gate is refused where it cannot stand, in the island's own words", () => {
  const s = settled();
  const { out, land, lat } = candidates(s.layout);
  const side = SIDES.find((x) => out[x].length);
  const refuse = (op, re) => {
    const r = dry(s, [op]);
    assert.equal(r.ok, false, `accepted ${JSON.stringify(op)}`);
    assert.match(r.verdicts[0].reason || '', re);
  };
  // Off the hamlet's land.
  refuse(gateOp(side, [1, 1]), /not on P0's land/);
  // Inside it: the middle of the land is not its edge.
  const supers = s.layout.districts[D].lobes.flatMap((l) => l.cells);
  const inner = [];
  for (const [i, j] of supers) {
    for (let dz = 0; dz < lat.pitch; dz++) {
      for (let dx = 0; dx < lat.pitch; dx++) {
        const c = [lat.anchor[0] + i * lat.pitch + dx, lat.anchor[1] + j * lat.pitch + dz];
        if (land.mine(...c) && !outwardOf(land, c, 'n') === false) continue;
        if (land.mine(...c) && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !land.mine(c[0] + a, c[1] + b))) inner.push(c);
      }
    }
  }
  assert.ok(inner.length);
  refuse(gateOp('n', inner[Math.floor(inner.length / 2)]), /edge/);
  // The wrong side: a cell of the first side named for another.
  const other = SIDES.find((x) => x !== side);
  refuse(gateOp(other, out[side][0]), /side of P0, not the/);
  // A hamlet that is not there.
  refuse({ op: 'gate', district: 'proj:99', side: 'n', at: out[side][0] }, /no hamlet called/);
});

test('only as many gates as the size allows, the keeper\'s first', () => {
  const s = settled();                    // six settlers: two entrances
  const { out } = candidates(s.layout);
  const placed = [];
  for (const side of SIDES) {
    if (placed.length === 2) break;
    if (!out[side].length) continue;
    const at = firstAccepted(s, side);
    if (!at) continue;
    assert.ok(real(s, [gateOp(side, at)]).ok);
    placed.push(side);
  }
  assert.equal(placed.length, 2, 'this island did not have two sides to gate');
  // A third is refused whichever side it is on: the two the keeper set fill the allowance.
  const free = SIDES.find((x) => !placed.includes(x) && out[x].length);
  assert.ok(free, 'no third side to try');
  const r = dry(s, [gateOp(free, out[free][0])]);
  assert.equal(r.ok, false);
  assert.match(r.verdicts[0].reason || '', /may have 2 entrances, and they are all spoken for/);
});

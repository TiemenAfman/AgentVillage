// Moving a hamlet, measured.
//
// The rule the whole layout is built on is that a house never moves, and lib/plan.mjs is
// the one exception to it - so what it does has to be exactly what it says and nothing
// else. A move is a rigid translation of a whole lobe by a super-cell delta: every house
// and every shed of it shifts by that and only that, keeps its facing, keeps its shed in
// its yard; the land shifts with them; the office comes back at the new gate; every door
// still reaches the town square; the trees close over the old ground; nothing the plan
// did not name has moved; and the scan after it changes nothing. A refusal leaves the
// layout deep-equal to what it was.
//
// A synthetic village on a 128 grid rather than the live island, because the live one
// has 22 districts on it and the belt refuses nearly every delta (which is right, and is
// measured for real in tests/plan-scan.test.mjs). The delta is found rather than fixed:
// the first one the dry run accepts, searching outward, so the test measures the move and
// not the generator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAll, emptyLayout, outsideDoor } from '../lib/layout.mjs';
import { centreOfCell } from '../shared/lattice.mjs';
import { parsePlan, runPlan, applyPlan } from '../lib/plan.mjs';
import { village, clone, key, stands, movedBetween, plotCells, cutOff, overlaps } from './support/village.mjs';

const SEED = 1337, SIZE = 128;
const opts = { seed: SEED, size: SIZE };

function settled(settlers = 36) {
  const model = village(settlers);
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, model, opts);
  placeAll(layout, model, opts);        // the wobble a first pass can leave is not what is measured here
  return { model, layout };
}

// Outward in rings, the first delta the dry run accepts for these lobes.
function findMove(layout, model, lobes, maxRing = 14) {
  for (let r = 1; r <= maxRing; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const plan = parsePlan({ ops: [{ op: 'move', lobes, di, dj }] });
        const r0 = runPlan(layout, model, plan, { ...opts, dryRun: true });
        if (r0.ok) return { plan, di, dj, dry: r0 };
      }
    }
  }
  return null;
}

const lobeOf = (layout, district, li = 0) => layout.districts[district].lobes[li];
const householdOf = (layout, district, li = 0) => {
  const houses = Object.entries(layout.plots).filter(([id, p]) => id.startsWith('house:') && p.district === district && p.lobe === li).map(([id]) => id);
  const sheds = Object.entries(layout.shedOf || {}).filter(([, m]) => houses.includes(m)).map(([s]) => s);
  return { houses, sheds };
};

test('a hamlet is set down elsewhere whole, and the island is the same island around it', () => {
  const { model, layout } = settled();
  const district = 'proj:0';
  const lobe0 = clone(lobeOf(layout, district));
  const { houses, sheds } = householdOf(layout, district);
  assert.ok(houses.length >= 2 && sheds.length >= 1, `a hamlet worth moving: ${houses.length} houses, ${sheds.length} sheds`);
  assert.ok(layout.plots[`civic:office:${district}`], 'an office at the gate to carry along');
  const before = clone(layout);
  const wasStanding = stands(layout);

  const found = findMove(layout, model, [{ district, lobe: 0 }]);
  assert.ok(found, 'no delta within fourteen rings was accepted');
  const { plan, di, dj, dry } = found;
  // The dry run touched nothing.
  assert.equal(JSON.stringify(layout), JSON.stringify(before), 'a dry run changed the layout');
  assert.deepEqual(dry.diff.plots.otherMoved, []);

  const r = runPlan(layout, model, plan, opts);
  assert.ok(r.ok, `apply refused: ${r.error}`);
  assert.deepEqual(r.unplaced, [], 'something could not be placed after the move');
  assert.deepEqual(r.diff.plots.otherMoved, [], 'the plan moved something it did not name');

  // Exactly the delta, and only the household.
  const shifted = new Set([...houses, ...sheds]);
  for (const id of shifted) {
    const a = before.plots[id], b = layout.plots[id];
    assert.deepEqual([b.gx - a.gx, b.gz - a.gz, b.rot], [di * 4, dj * 4, a.rot], `${id} did not move rigidly`);
  }
  const others = movedBetween(wasStanding, stands(layout)).filter((id) => !shifted.has(id));
  assert.deepEqual(others, [`civic:office:${district}`], 'only the office may stand somewhere new besides the household');
  assert.deepEqual(layout.shedOf, before.shedOf, 'a shed changed master');
  assert.deepEqual(overlaps(layout), [], 'plots overlap after the move');

  // The land went with them.
  const lobe1 = lobeOf(layout, district);
  assert.deepEqual(lobe1.cells, lobe0.cells.map(([i, j]) => [i + di, j + dj]));
  assert.deepEqual(lobe1.seed, [lobe0.seed[0] + di, lobe0.seed[1] + dj]);
  assert.deepEqual(lobe1.centre, centreOfCell(layout.lattice, lobe1.seed));
  assert.deepEqual(layout.districts[district].centre, lobe1.centre);
  for (const [id, p] of Object.entries(layout.plots)) {
    if (!shifted.has(id) || !id.startsWith('house:')) continue;
    assert.deepEqual(p.cell, [before.plots[id].cell[0] + di, before.plots[id].cell[1] + dj], `${id} kept its old super-cell index`);
  }

  // Roaded again: the lobe has a road, the office stands beside its head, every door
  // reaches the square, and no other district lost its way to town.
  assert.ok(lobe1.road, 'the moved hamlet has no road');
  const road = layout.paths.find((p) => p.id === lobe1.road);
  assert.ok(road && road.cells.length, 'the road on record is not in paths');
  const office = layout.plots[`civic:office:${district}`];
  assert.ok(office, 'the office did not come back');
  const [hx, hz] = road.cells[0];
  assert.equal(Math.abs(office.gx - hx) + Math.abs(office.gz - hz), 1, 'the office does not stand at the head of the new road');
  assert.deepEqual(cutOff(layout, SIZE), [], 'houses that cannot walk to the town square');

  // The forest takes the old ground back: no cleared cell where nothing stands or is paved.
  const standing = plotCells(layout);
  for (const p of layout.paths) for (const c of p.cells) standing.add(key(c));
  for (const b of layout.bridges || []) for (const c of b.cells) standing.add(key(c));
  const bald = layout.cleared.map(key).filter((k) => !standing.has(k));
  assert.deepEqual(bald, [], 'cleared ground with nothing on it');
  const oldCells = plotCells(before, (id) => shifted.has(id));
  for (const k of oldCells) assert.ok(standing.has(k) || !layout.cleared.some((c) => key(c) === k), `${k} stays bald`);

  // And a scan of the island as it now stands changes nothing.
  const written = JSON.stringify(layout);
  placeAll(layout, model, opts);
  assert.equal(JSON.stringify(layout), written, 'the scan after the move rewrote the layout');
});

test('two hamlets go together, by one delta', () => {
  const { model, layout } = settled();
  const lobes = [{ district: 'proj:1', lobe: 0 }, { district: 'proj:3', lobe: 0 }];
  const before = clone(layout);
  const found = findMove(layout, model, lobes);
  assert.ok(found, 'no delta moved both hamlets');
  const r = runPlan(layout, model, found.plan, opts);
  assert.ok(r.ok, r.error);
  for (const { district } of lobes) {
    const { houses, sheds } = householdOf(before, district);
    for (const id of [...houses, ...sheds]) {
      const a = before.plots[id], b = layout.plots[id];
      assert.deepEqual([b.gx - a.gx, b.gz - a.gz], [found.di * 4, found.dj * 4], `${id} did not move with its hamlet`);
    }
  }
  assert.deepEqual(r.diff.plots.otherMoved, []);
  assert.deepEqual(cutOff(layout, SIZE), []);
  const written = JSON.stringify(layout);
  placeAll(layout, model, opts);
  assert.equal(JSON.stringify(layout), written);
});

test('a refusal leaves the layout exactly as it was, and says why in the island\'s terms', () => {
  const { model, layout } = settled();
  const before = JSON.stringify(layout);
  const reasons = new Map();
  const tryOne = (op) => {
    const plan = parsePlan({ ops: [op] });
    const r = runPlan(layout, model, plan, { ...opts, dryRun: true });
    assert.equal(JSON.stringify(layout), before, 'a refused dry run changed the layout');
    return r;
  };
  // Off the island, a hamlet nobody has, a lobe it has not got.
  assert.match(tryOne({ op: 'move', lobes: [{ district: 'proj:0' }], di: 60, dj: 0 }).verdicts[0].reason, /off the island/);
  assert.match(tryOne({ op: 'move', lobes: [{ district: 'proj:99' }], di: 1, dj: 0 }).verdicts[0].reason, /no hamlet called/);
  assert.match(tryOne({ op: 'move', lobes: [{ district: 'proj:0', lobe: 5 }], di: 1, dj: 0 }).verdicts[0].reason, /has no lobe 5/);
  // Onto a neighbour: the delta that puts our seed on theirs.
  const a = layout.districts['proj:0'].lobes[0].seed, b = layout.districts['proj:1'].lobes[0].seed;
  assert.match(tryOne({ op: 'move', lobes: [{ district: 'proj:0' }], di: b[0] - a[0], dj: b[1] - a[1] }).verdicts[0].reason, /is P1's land|belt of P1|is the town's land|belt of the town/);
  // And around the ring, every refusal is one of the sentences the planner shows, and the
  // three that matter most - water, somebody's land, the belt - all occur on this island.
  for (let r = 1; r <= 6; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const v = tryOne({ op: 'move', lobes: [{ district: 'proj:0' }], di, dj });
        if (v.ok) continue;
        const why = v.verdicts[0].reason;
        assert.match(why, /water|steep|held|'s land|belt of|off the island|already stands|onto the water/, `an unexplained refusal: ${why}`);
        reasons.set(why.replace(/\[.*?\]/g, '[]').replace(/P\d+|the town/g, '<who>'), (reasons.get(why) || 0) + 1);
      }
    }
  }
  const kinds = [...reasons.keys()].join(' | ');
  assert.match(kinds, /water/, `nothing was refused for water: ${kinds}`);
  assert.match(kinds, /'s land/, `nothing was refused for being somebody's: ${kinds}`);
  assert.match(kinds, /belt of/, `nothing was refused for the belt: ${kinds}`);
});

test('a hamlet is given land and has some taken away, and the scan after keeps it that way', () => {
  const { model, layout } = settled();
  const district = 'proj:4';
  const lobe = layout.districts[district].lobes[0];
  const before = clone(layout);
  const wasStanding = stands(layout);
  // Something to add: the first edge neighbour the dry run accepts.
  const own = new Set(lobe.cells.map(key));
  let add = null;
  for (const [i, j] of lobe.cells) {
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = [i + a, j + b];
      if (own.has(key(c)) || add) continue;
      const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'parcel', district, add: [c] }] }), { ...opts, dryRun: true });
      if (r.ok) add = c;
    }
  }
  assert.ok(add, 'no neighbouring super-cell could be given to the hamlet');
  assert.equal(JSON.stringify(layout), JSON.stringify(before), 'a dry run changed the layout');
  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'parcel', district, add: [add] }] }), opts);
  assert.ok(r.ok, r.error);
  assert.ok(layout.districts[district].lobes[0].cells.some((c) => key(c) === key(add)), 'the land was not given');
  assert.deepEqual(movedBetween(wasStanding, stands(layout)), [], 'giving land moved something');
  const written = JSON.stringify(layout);
  placeAll(layout, model, opts);
  assert.equal(JSON.stringify(layout), written, 'the scan after the parcel rewrote the layout');
  // And taken back again.
  const back = runPlan(layout, model, parsePlan({ ops: [{ op: 'parcel', district, remove: [add] }] }), opts);
  assert.ok(back.ok, back.error);
  assert.ok(!layout.districts[district].lobes[0].cells.some((c) => key(c) === key(add)));
  // Refusals, in the island's words.
  const no = (op, re) => {
    const x = runPlan(layout, model, parsePlan({ ops: [op] }), { ...opts, dryRun: true });
    assert.equal(x.ok, false);
    assert.match(x.verdicts[0].reason, re);
  };
  no({ op: 'parcel', district, remove: [lobe.seed] }, /where P4 was founded/);
  const built = layout.districts[district].lobes[0].cells.find(([i, j]) => Object.values(layout.plots).some((p) => p.cell && p.cell[0] === i && p.cell[1] === j) && (i !== lobe.seed[0] || j !== lobe.seed[1]));
  if (built) no({ op: 'parcel', district, remove: [built] }, /stands on/);
  const other = layout.districts['proj:5'].lobes[0].seed;
  no({ op: 'parcel', district, add: [other] }, /P5's land|not wholly/);
  assert.throws(() => parsePlan({ ops: [{ op: 'parcel', district }] }), /changes nothing/);
});

test('a plan with a refused step still judges the steps after it, against the island the good ones made', () => {
  const { model, layout } = settled();
  const found = findMove(layout, model, [{ district: 'proj:0', lobe: 0 }]);
  assert.ok(found);
  const trial = clone(layout);
  const r = applyPlan(trial, model, parsePlan({ ops: [
    found.plan.ops[0],
    { op: 'move', lobes: [{ district: 'proj:99' }], di: 1, dj: 0 },
    { op: 'zone', add: [[8, 8]] },
  ] }), opts);
  assert.equal(r.ok, false);
  assert.deepEqual(r.verdicts.map((v) => v.ok), [true, false, true]);
  assert.match(r.verdicts[1].reason, /no hamlet called/);
});

// The castle on two super-cells square (Plans/groot-kasteel.md).
//
// What is held here:
//   the doors     a lot's door is in the middle of its front, and a three by three's is
//                 exactly where it always was - every house on the island leans on that.
//   a new castle  seven by seven, on the lattice, facing the town, on the town's own land,
//                 flat, with a road to its gate, and never moved by the scans after it.
//   an old one    a three by three castle grows where it stands and keeps its front, keeps
//                 its old road and gets a stretch from the new gate onto it, moves nothing
//                 else, and a second scan changes nothing. One with no room stays as it was.
//   the model     the great castle on a seven by seven, built at that size, with a gate the
//                 size of the town hall's door; the old bake on a three by three; the
//                 porch's step the same height under both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { emptyLayout, placeAll, outsideDoor, doorCell, latticeOf, CASTLE_ID, CASTLE_LOT, NONE } from '../lib/layout.mjs';
import { superOf } from '../shared/lattice.mjs';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding } = await import('../web/js/buildings.js');
const models = await import('../web/js/models.js');

function village(settlers, { castle = true } = {}) {
  const startedAt = Date.UTC(2026, 0, 2);
  const districts = [{ id: 'p:d:\\git\\farm', kind: 'project', name: 'farm', population: settlers, firstSeenAt: startedAt }];
  const buildings = Array.from({ length: settlers }, (_, i) => ({
    id: `house:farm-${i}`, sessionId: `farm-${i}`, kind: 'house', district: districts[0].id, tier: 'hut', startedAt: startedAt + i * 1000,
  }));
  const milestones = castle ? [{ id: 'castle', at: 100, civicType: 'castle', label: 'The castle', unlocked: true, unlockedAt: startedAt }] : [];
  return { districts, buildings, milestones, furniture: [], stats: { settlers } };
}

const cellsOf = (p) => {
  const out = [];
  for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) out.push([p.gx + x, p.gz + z]);
  return out;
};
const inside = (p, [gx, gz]) => gx >= p.gx && gx < p.gx + p.w && gz >= p.gz && gz < p.gz + p.d;
// Whose land a super-cell is in the layout as written: a district's lobe, the commons, or nobody's.
function ownerOf(layout, i, j) {
  for (const [id, d] of Object.entries(layout.districts)) {
    for (const lobe of d.lobes || []) if (lobe.cells.some((c) => c[0] === i && c[1] === j)) return id;
  }
  return layout.town.commons.some((c) => c[0] === i && c[1] === j) ? 'town' : NONE;
}
// The gate has a road, and the road gets to the square. Not "every step of the record is one
// cell": `markPath` leaves out whatever another road already paved, so a record has a gap
// wherever it runs along somebody else's - measured, along the gold pit's.
function assertRoad(layout, lot) {
  const road = layout.paths.find((q) => q.id === `path:${CASTLE_ID}`);
  assert.ok(road && road.cells.length, 'a road to the gate');
  for (const c of road.cells) assert.ok(!inside(lot, c), `the road runs through the castle at ${c}`);
  const gate = outsideDoor(lot.gx, lot.gz, lot.rot, lot.w);
  const s = road.cells.find((c) => Math.max(Math.abs(c[0] - gate[0]), Math.abs(c[1] - gate[1])) <= 1);
  assert.ok(s, `no stretch of the castle road comes to the gate at ${gate}`);
  const k = ([gx, gz]) => `${gx},${gz}`;
  const ground = new Set([...layout.paths.flatMap((q) => q.cells), ...(layout.town.paved || [])].map(k));
  const seen = new Set([k(s)]), q = [s];
  for (let h = 0; h < q.length; h++) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = [q[h][0] + dx, q[h][1] + dz];
      if (ground.has(k(c)) && !seen.has(k(c))) { seen.add(k(c)); q.push(c); }
    }
  }
  for (const c of road.cells) assert.ok(seen.has(k(c)), `${c} of the castle road is cut off from its gate`);
  const [cx, cz] = layout.town.centre;
  assert.ok([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => seen.has(k([cx + dx, cz + dz]))), 'the castle road never reaches the square');
}

test('a door is in the middle of the front, and a three by three\'s is where it always was', () => {
  const old = {
    0: [[1, 0], [1, -1]], 1: [[2, 1], [3, 1]], 2: [[1, 2], [1, 3]], 3: [[0, 1], [-1, 1]],
  };
  for (let rot = 0; rot < 4; rot++) {
    assert.deepEqual(doorCell(10, 20, rot), [10 + old[rot][0][0], 20 + old[rot][0][1]], `doorCell rot ${rot}`);
    assert.deepEqual(outsideDoor(10, 20, rot), [10 + old[rot][1][0], 20 + old[rot][1][1]], `outsideDoor rot ${rot}`);
  }
  assert.deepEqual(doorCell(0, 0, 2, CASTLE_LOT), [3, 6]);
  assert.deepEqual(outsideDoor(0, 0, 2, CASTLE_LOT), [3, 7]);
  assert.deepEqual(outsideDoor(0, 0, 0, CASTLE_LOT), [3, -1]);
  assert.deepEqual(outsideDoor(0, 0, 1, CASTLE_LOT), [7, 3]);
  assert.deepEqual(outsideDoor(0, 0, 3, CASTLE_LOT), [-1, 3]);
});

for (const [seed, size, n] of [[1337, 128, 30], [7, 128, 40], [90210, 128, 20]]) {
  test(`a new castle takes two super-cells square near the square, and stays put (seed ${seed})`, () => {
    const layout = emptyLayout(seed, size);
    const { unplaced, terrain } = placeAll(layout, village(n), { seed, size });
    assert.ok(!unplaced.includes(CASTLE_ID), 'there was room for the castle');
    const p = layout.plots[CASTLE_ID];
    assert.equal(p.w, CASTLE_LOT);
    assert.equal(p.d, CASTLE_LOT);
    const lat = latticeOf(layout);
    assert.deepEqual(superOf(lat, p.gx, p.gz).map((v, k) => lat.anchor[k] + v * lat.pitch), [p.gx, p.gz], 'on the lattice');
    const c = layout.town.centre;
    const mid = [p.gx + 3.5, p.gz + 3.5];
    assert.ok(Math.hypot(mid[0] - c[0], mid[1] - c[1]) <= 24, `the castle is ${Math.hypot(mid[0] - c[0], mid[1] - c[1]).toFixed(1)} cells from the square`);
    const gate = outsideDoor(p.gx, p.gz, p.rot, p.w);
    assert.ok(Math.hypot(gate[0] - c[0], gate[1] - c[1]) < Math.hypot(mid[0] - c[0], mid[1] - c[1]), 'the castle turns its back on the town');
    // The town's land, and flat enough for the porch to hide the slope.
    let lo = Infinity, hi = -Infinity;
    for (const [gx, gz] of cellsOf(p)) {
      const [i, j] = superOf(lat, gx, gz);
      assert.equal(ownerOf(layout, i, j), 'town', `super-cell ${i},${j} under the castle is not the town's`);
      const h = terrain.heightAt(gx, gz);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    assert.ok(hi - lo <= 0.6 + 1e-9, `the ground under the castle rises ${(hi - lo).toFixed(2)}`);
    // Nothing else stands on it.
    for (const [id, q] of Object.entries(layout.plots)) {
      if (id === CASTLE_ID) continue;
      assert.ok(!cellsOf(q).some((cell) => inside(p, cell)), `${id} stands in the castle`);
    }
    assertRoad(layout, p);

    placeAll(layout, village(n + 3), { seed, size });
    assert.deepEqual(layout.plots[CASTLE_ID], p, 'the castle never moves by itself');
    const again = JSON.stringify(layout);
    placeAll(layout, village(n + 3), { seed, size });
    assert.equal(JSON.stringify(layout), again, 'a second scan changes nothing');
  });
}

// A castle as the code before this placed it: a three by three. Set down in the lower-right
// corner of the block a new castle would have taken on the same island, so there is known to
// be room to grow - into that block or into one the rules like better - and facing +x, out
// of the block: on seed 1337 the cell below that corner is a plot, and a gate there is
// nudged round to the west and its road laid straight through the ground the castle wants,
// which `castleSite` rightly refuses (a road of its own may be somebody else's too). Held to
// its three by three for one scan by a shed on either side - every seven by seven that holds
// it takes one of the two - so it has the road the relay lays an old castle; `pinned: false`
// then takes the sheds away again.
function oldCastle(seed, size, n, { pinned = false } = {}) {
  const probe = emptyLayout(seed, size);
  placeAll(probe, village(n), { seed, size });
  const site = probe.plots[CASTLE_ID];
  const layout = emptyLayout(seed, size);
  placeAll(layout, village(n, { castle: false }), { seed, size });
  const lot = { gx: site.gx + 4, gz: site.gz + 4, w: 3, d: 3, rot: 1 };
  layout.plots[CASTLE_ID] = lot;
  const pins = { 'shed:test:west': [lot.gx - 1, lot.gz + 2], 'shed:test:east': [lot.gx + 3, lot.gz] };
  for (const [id, [gx, gz]] of Object.entries(pins)) layout.plots[id] = { gx, gz, w: 1, d: 1, rot: 0 };
  placeAll(layout, village(n), { seed, size });
  assert.deepEqual(layout.plots[CASTLE_ID], lot, 'held to its three by three');
  assert.ok(layout.paths.some((q) => q.id === `path:${CASTLE_ID}`), 'with a road of its own');
  if (!pinned) for (const id of Object.keys(pins)) delete layout.plots[id];
  return { layout, lot };
}

// Seed 90210, not 1337: on 1337 the fourth harbour's approach road (`road:harbour:3:approach`,
// Plans/vier-havens.md) runs through every seven by seven that holds the old lot, and
// `castleSite` rightly refuses a road cell - so there it is the next test's case, a castle with
// no room, whether or not the sheds pin it.
test('an old castle grows where it stands, keeps its front and its turn, and moves nothing else', () => {
  const seed = 90210, size = 128, n = 30;
  const { layout, lot } = oldCastle(seed, size, n);
  const before = JSON.parse(JSON.stringify(layout.plots));
  const oldRoad = layout.paths.find((q) => q.id === `path:${CASTLE_ID}`).cells.map(String);
  placeAll(layout, village(n), { seed, size });
  const p = layout.plots[CASTLE_ID];
  assert.equal(p.w, CASTLE_LOT, 'it grew');
  assert.equal(p.d, CASTLE_LOT);
  for (const cell of cellsOf(lot)) assert.ok(inside(p, cell), 'the new lot holds the old one');
  assert.equal(p.gx + p.w, lot.gx + lot.w, 'the front (+x, the gate side) is where it was');
  assert.equal(p.rot, lot.rot, 'and it looks the same way');
  const where = (q) => q && [q.gx, q.gz, q.w, q.d, q.rot];
  for (const [id, q] of Object.entries(before)) {
    if (id === CASTLE_ID) continue;
    assert.deepEqual(where(layout.plots[id]), where(q), `${id} moved`);
  }
  assertRoad(layout, p);
  const road = layout.paths.find((q) => q.id === `path:${CASTLE_ID}`).cells.map(String);
  assert.deepEqual(road.slice(0, oldRoad.length), oldRoad, 'the old road is still there, as it was');
  assert.equal(new Set(road).size, road.length, 'a cell of the road is written down twice');
  const again = JSON.stringify(layout);
  placeAll(layout, village(n), { seed, size });
  assert.equal(JSON.stringify(layout), again, 'a second scan changes nothing');
});

test('an old castle with no room stays the castle it was', () => {
  const seed = 1337, size = 128, n = 30;
  const { layout, lot } = oldCastle(seed, size, n, { pinned: true });
  placeAll(layout, village(n), { seed, size });
  assert.deepEqual(layout.plots[CASTLE_ID], lot, 'it neither grew nor moved');
  const again = JSON.stringify(layout);
  placeAll(layout, village(n), { seed, size });
  assert.equal(JSON.stringify(layout), again, 'and asking again every scan changes nothing');
});

// The size of one baked part, across and up.
function sizeOf(name) {
  const p = models.part(name);
  assert.ok(p, `no baked part called "${name}"`);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < p.positions.length; i += 3) {
    x0 = Math.min(x0, p.positions[i]); x1 = Math.max(x1, p.positions[i]);
    y0 = Math.min(y0, p.positions[i + 1]); y1 = Math.max(y1, p.positions[i + 1]);
  }
  return { w: x1 - x0, h: y1 - y0 };
}

test('the castle on its seven by seven is built at that size, with a gate a settler walks through', () => {
  const spec = (w) => ({ id: CASTLE_ID, kind: 'civic', civicType: 'castle', style: 'unknown', tier: 'civic', plot: { gx: 0, gz: 0, w, d: w, rot: 2 } });
  const small = buildBuilding(spec(3)), big = buildBuilding(spec(CASTLE_LOT));
  const hall = buildBuilding({ id: 'civic:townhall', kind: 'civic', civicType: 'townhall', style: 'unknown', tier: 'civic' });
  // It was the three by three's bake at 7/3, gate and all: 1.00 across and 1.50 tall against
  // the town hall's 0.48 by 0.72. The gate is a castle's, so a little grander than the hall's
  // door - and a hand's width grander, not a storey.
  const gate = sizeOf('Great castle arched oak gate'), door = sizeOf('Townhall door recess');
  for (const k of ['w', 'h']) {
    const r = gate[k] / door[k];
    assert.ok(r >= 1 && r <= 1.35, `the gate is ${r.toFixed(2)}x the town hall's door ${k === 'w' ? 'across' : 'tall'}`);
  }
  // And its windows are the town hall's, not the gate's size.
  assert.ok(sizeOf('Great castle hall window pane').h <= sizeOf('Townhall window pane').h, 'the castle has bigger windows than the town hall');
  // The walls - the footprint measured before the porch - are the seven by seven's, and the
  // step round them shows the same fixed amount past them as under the small one.
  const reach = (rects) => Math.max(...rects.map((r) => Math.max(Math.abs(r.x) + r.hx, Math.abs(r.z) + r.hz)));
  assert.ok(reach(big.walls) > reach(small.walls) * 2, `the walls reach ${reach(big.walls).toFixed(2)} against ${reach(small.walls).toFixed(2)}`);
  const over = (b) => Math.max(-b.bbox.min.x, b.bbox.max.x, -b.bbox.min.z, b.bbox.max.z);
  assert.ok(Math.abs((over(big) - reach(big.walls)) - (over(small) - reach(small.walls))) < 0.02, 'the porch grew with the castle');
  assert.ok(over(big) < CASTLE_LOT / 2, `the castle reaches ${over(big).toFixed(2)} past the middle of a lot ${CASTLE_LOT / 2} deep`);
  assert.ok(over(small) < 1.5, 'the old castle still fits its three by three');
  // The gate stands on the step, which is the same height under both, at the front.
  assert.ok(Math.abs(big.anchors.door[1] - small.anchors.door[1]) < 1e-6, 'the step under the gate is taller');
  assert.ok(big.anchors.door[2] > reach(big.walls) * 0.75, `the gate is ${big.anchors.door[2].toFixed(2)} out, inside a castle ${reach(big.walls).toFixed(2)} deep`);
  assert.ok(big.height > hall.height * 1.5, `it stands ${big.height.toFixed(2)} high, over a town hall of ${hall.height.toFixed(2)}`);
  // And it is solid all the way out, not a small hitbox inside a big castle.
  assert.ok(reach(big.solids) > reach(small.solids) * 2, `the castle's walls stop at ${reach(big.solids).toFixed(2)}`);
  // A plot that is not the castle's own is the small castle, which is the guardhouse too.
  assert.equal(over(buildBuilding({ ...spec(3), plot: null })), over(small));
});

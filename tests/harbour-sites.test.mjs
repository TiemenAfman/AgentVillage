// Where the ladder past a hundred stands on land (Plans/DONE/mijlpalen-tot-tweehonderd.md): the
// kadehaven the harbour buildings gather at, the shipyard square to its coast, the warehouse
// and the weigh house on its quay, the fisherman's hut at another harbour, the quarry on the
// highest rough ground, and the workshops out with the trades - none of them half on a lot of
// the town's plan. tests/rede.test.mjs has the ships.
//
// As everywhere in these tests, no coordinate is written down; what is asserted is each
// building's relation to the water, the harbours and the town it was placed against.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLayout, placeAll, kadehaven, plotDoor, yardRows, replayGrid, Super, heldOf, registerLand, districtOrder, sideOf,
  YARD_ID, YARD_LOT, YARD_DRY, YARD_WET, YARD_LAND_MAX, TOWN_PLAN, FREE, PATH, NONE, TOWN,
} from '../lib/layout.mjs';
import { MILESTONES, civicIdOf } from '../lib/village.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { quayFor } from '../shared/quay.mjs';
import { superOf } from '../shared/lattice.mjs';
import { houseGate } from '../shared/roads.mjs';
import { village, clone, key } from './support/village.mjs';

const SIZE = 128;
const SEEDS = [5, 2024, 1337];
const STEPS = [40, 90, 95, 106, 113, 120, 127, 134, 142, 150, 158, 165, 175, 184, 192, 200];
const COAST_REACH = 16;
const TOWN_REACH = TOWN_PLAN.TOWN_REACH;

function ladder(settlers) {
  const v = village(settlers);
  const apprentices = v.buildings.filter((b) => b.kind === 'shed').length;
  v.stats.apprentices = apprentices;
  v.milestones = MILESTONES.map((m) => {
    const on = m.on === 'apprentices' ? 'apprentices' : 'settlers';
    const unlocked = (on === 'apprentices' ? apprentices : settlers) >= m.at;
    return { ...m, on, civicId: civicIdOf(m), unlocked, unlockedAt: unlocked ? 0 : null, building: unlocked ? civicIdOf(m) : null };
  });
  return v;
}
const groundOf = (seed, l) => makeTerrain(seed, { size: l.size, polders: l.polders, fairway: l.fairway, works: l.works || null, grow: l.grow || null });
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const cellsOf = (p) => { const out = []; for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) out.push([p.gx + x, p.gz + z]); return out; };
const LOOK = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// The open sea, flooded in from the edge over water that is not river.
function seaOf(terrain) {
  const n = terrain.size, seen = new Set(), q = [];
  const push = (gx, gz) => {
    if (gx < 0 || gz < 0 || gx >= n || gz >= n) return;
    const k = key([gx, gz]);
    if (seen.has(k) || !terrain.isWater(gx, gz) || terrain.isRiver(gx, gz)) return;
    seen.add(k); q.push([gx, gz]);
  };
  for (let g = 0; g < n; g++) { push(g, 0); push(g, n - 1); push(0, g); push(n - 1, g); }
  for (let h = 0; h < q.length; h++) { const [gx, gz] = q[h]; push(gx + 1, gz); push(gx - 1, gz); push(gx, gz + 1); push(gx, gz - 1); }
  return seen;
}
// Every cell of every lot of the town's plan, taken or not.
function planCells(layout) {
  const c = layout.town.centre, out = new Set();
  for (const lot of [...Object.values(TOWN_PLAN.RING), ...TOWN_PLAN.STREET_LOTS, TOWN_PLAN.GOLDPIT_LOT]) {
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) out.add(key([c[0] + lot.at[0] + x, c[1] + lot.at[1] + z]));
  }
  return out;
}

// Each island grown a rung at a time, and each new building measured on the scan that set it
// down - against the island as it stood then - by `check`.
const islands = new Map();
// The seeds whose warehouse and weigh house both stand on the kadehaven's own quay.
const onTheKade = [];
// Every strandpad on those islands (Plans/DONE/strandpaden.md), as seed:path.
const strands = [];
function grow(seed) {
  if (islands.has(seed)) return islands.get(seed);
  const layout = emptyLayout(seed, SIZE);
  const seen = {};
  for (const n of STEPS) {
    placeAll(layout, ladder(n), { seed, size: SIZE });
    for (const [id, p] of Object.entries(layout.plots)) {
      if (!id.startsWith('civic:') || seen[id]) continue;
      seen[id] = { n, layout: clone(layout), terrain: groundOf(seed, layout), p };
    }
  }
  const out = { layout, seen, terrain: groundOf(seed, layout) };
  islands.set(seed, out);
  return out;
}

for (const seed of SEEDS) {
  test(`seed ${seed}: the yard runs from dry ground square down into the open sea, entered at its gate`, () => {
    const { seen } = grow(seed);
    const at = seen[YARD_ID];
    assert.ok(at, 'the yard was given ground');
    assert.equal(at.n, 95);
    const { p, terrain, layout } = at;
    assert.deepEqual([Math.min(p.w, p.d), Math.max(p.w, p.d)], [5, 16]);
    assert.equal(p.d === 16, p.rot % 2 === 0, 'its long side runs the way its rot says');
    const sea = seaOf(terrain);
    // Dry, low ground at the landward end; open sea at the other; and the front - which way
    // the rot faces - is the sea end.
    for (const [gx, gz] of yardRows(p, 0, YARD_DRY)) {
      assert.ok(terrain.isLand(gx, gz), `the dry rows are on land at ${gx},${gz}`);
      const corners = [terrain.corner(gx, gz), terrain.corner(gx + 1, gz), terrain.corner(gx, gz + 1), terrain.corner(gx + 1, gz + 1)];
      assert.ok(Math.max(...corners) <= YARD_LAND_MAX, `low enough for the slipway's toe at ${gx},${gz}`);
    }
    const wet = yardRows(p, YARD_LOT.d - YARD_WET, YARD_LOT.d);
    for (const c of wet) assert.ok(sea.has(key(c)), `the slipway's toe is in the open sea at ${c}`);
    const mid = (cells) => cells.reduce((a, c) => [a[0] + c[0] / cells.length, a[1] + c[1] / cells.length], [0, 0]);
    const land = mid(yardRows(p, 0, YARD_DRY)), toe = mid(wet);
    const [fx, fz] = LOOK[p.rot];
    assert.ok((toe[0] - land[0]) * fx + (toe[1] - land[1]) * fz > 0, 'its front faces the sea');
    // Off the planks, the ramps and the slipways of every harbour, and off every road.
    const taken = new Set();
    for (const h of (layout.harbours || []).filter(Boolean)) for (const c of [...h.pier, ...(h.slip || [])]) taken.add(key(c));
    for (const q of layout.paths) for (const c of q.cells) taken.add(key(c));
    for (const c of cellsOf(p)) assert.ok(!taken.has(key(c)), `the yard stands on a plank or a road at ${c}`);
    // Entered at the landward end, and roaded from there.
    const { door, step } = plotDoor(YARD_ID, p);
    assert.ok(yardRows(p, 0, 1).some((c) => c[0] === door[0] && c[1] === door[1]), 'the door is in the landward row');
    assert.ok(!cellsOf(p).some((c) => c[0] === step[0] && c[1] === step[1]), 'the step is off the lot');
    const road = layout.paths.find((q) => q.id === `path:${YARD_ID}`);
    assert.ok(road && road.cells.length && cheb(road.cells[0], step) <= 4, 'its road starts at its gate');
    // Its dry end is the town's ground now, so no hamlet reads it as land to claim.
    const town = new Set((layout.town.commons || []).map(key));
    for (const [gx, gz] of yardRows(p, 0, YARD_DRY)) {
      const [i, j] = superOf(layout.lattice, gx, gz);
      assert.ok(town.has(key([i, j])) || (Math.abs(i) <= 2 && Math.abs(j) <= 2), `the yard's ground is the town's at ${gx},${gz}`);
    }
  });

  test(`seed ${seed}: the harbour buildings face the water at a harbour, the fishery at another`, () => {
    const { seen } = grow(seed);
    for (const id of ['civic:warehouse', 'civic:weighhouse', 'civic:fishery']) {
      const at = seen[id];
      assert.ok(at, `${id} was given ground`);
      const { p, terrain, layout } = at;
      assert.deepEqual([p.w, p.d], [3, 3]);
      const sea = seaOf(terrain);
      for (const c of cellsOf(p)) assert.ok(terrain.isLand(c[0], c[1]), `${id} stands on land at ${c}`);
      const [fx, fz] = LOOK[p.rot];
      const front = [p.gx + 1 + 2 * fx, p.gz + 1 + 2 * fz];
      // On the open sea, or - where no harbour had such a lot with a road to it (seed 2024's
      // weigh house) - on one cell of beach with the open sea straight past it.
      const past = [front[0] + fx, front[1] + fz];
      assert.ok(sea.has(key(front)) || (terrain.isBeach(front[0], front[1]) && sea.has(key(past))), `${id}'s front opens on the open sea`);
      const kade = kadehaven(layout, terrain);
      const harbours = (layout.harbours || []).filter(Boolean);
      const middle = [p.gx + 1, p.gz + 1];
      const near = harbours.filter((h) => cheb(middle, h.shore) <= COAST_REACH);
      if (id === 'civic:fishery') {
        // Another harbour than the kadehaven, or - with no other that has room - any coast.
        const others = near.filter((h) => !(h.shore[0] === kade.shore[0] && h.shore[1] === kade.shore[1]));
        assert.ok(others.length || !near.length, 'the fisherman\'s hut is not at the kadehaven');
      } else {
        assert.ok(near.length, `${id} stands at a harbour`);
      }
    }
    // Counted across the seeds below rather than asserted of each: on seed 2024 every block of
    // the kadehaven's quay is somebody's hamlet by 127, so both go on to the next harbour -
    // which is the rule, and whether a particular coast has room is the terrain's business.
    const { layout, terrain } = grow(seed);
    const kade = kadehaven(layout, terrain);
    const quayside = ['civic:warehouse', 'civic:weighhouse'].map((id) => layout.plots[id]).filter((p) => cheb([p.gx + 1, p.gz + 1], kade.shore) <= COAST_REACH);
    if (quayside.length === 2) onTheKade.push(seed);
  });

  test(`seed ${seed}: the quarry is the highest roughest lot there was, out beyond the town`, () => {
    const { seen } = grow(seed);
    const at = seen['civic:quarry'];
    assert.ok(at, 'the quarry was given ground');
    const { p, terrain, layout } = at;
    const c = layout.town.centre;
    const inTown = (gx, gz) => gx <= c[0] + TOWN_REACH && gx + 2 >= c[0] - TOWN_REACH && gz <= c[1] + TOWN_REACH && gz + 2 >= c[1] - TOWN_REACH;
    assert.ok(!inTown(p.gx, p.gz), 'out beyond the town\'s plan');
    const scoreOf = (gx, gz) => {
      let lo = Infinity, hi = -Infinity, s = 0;
      for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
        const h = terrain.heightAt(gx + x, gz + z);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
        s += h + terrain.slope(gx + x, gz + z);
      }
      return { s, relief: hi - lo };
    };
    const mine = scoreOf(p.gx, p.gz);
    assert.ok(mine.relief <= 0.7, 'flat enough for its skirt to hide');
    // Every lot still free once the scan that placed it was done was free when it was placed,
    // on ground no hamlet had then either - land only ever grows - so none of them may beat it.
    const grid = replayGrid(terrain, layout);
    const lat = layout.lattice;
    const sup = new Super(terrain, lat, heldOf(layout));
    const model = ladder(at.n);
    registerLand(sup, layout, districtOrder(model).ordOf, null);
    let beaten = null;
    for (const [gx, gz] of terrain.landCells) {
      if (inTown(gx, gz) || !grid.freeBlock(gx, gz, 3, 3, false)) continue;
      let ours = true;
      for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
        const [i, j] = superOf(lat, gx + x, gz + z);
        const who = sup.at(i, j);
        if (who !== NONE && who !== TOWN) ours = false;
      }
      if (!ours) continue;
      const other = scoreOf(gx, gz);
      if (other.relief <= 0.7 && other.s > mine.s + 1e-9) { beaten = [gx, gz]; break; }
    }
    assert.equal(beaten, null, `a higher, rougher lot was left at ${beaten}`);
  });

  test(`seed ${seed}: nothing past a hundred comes down on a lot of the town's plan`, () => {
    const { layout } = grow(seed);
    const plan = planCells(layout);
    const ids = MILESTONES.filter((m) => m.at > 90).map(civicIdOf).filter((id) => id !== 'civic:castle' && id !== 'civic:poldermill');
    for (const id of ids) {
      const p = layout.plots[id];
      if (!p) continue;
      for (const c of cellsOf(p)) assert.ok(!plan.has(key(c)), `${id} stands on the town's plan at ${c}`);
    }
    // The three new workshops out with the trades: past the last street lot.
    for (const id of ['civic:brewery', 'civic:trainingfield', 'civic:chronicle']) {
      const p = layout.plots[id];
      assert.ok(p, `${id} was given ground`);
      assert.deepEqual([p.w, p.d], [3, 3]);
      assert.ok(plotDoor(id, p), `${id} has a door`);
    }
  });

  // A door with no road is for good, since the lot never moves: `coastSite` takes only a lot a
  // road reaches (seed 2024's weigh house stood on a spit of beach whose one way ashore ran
  // through the warehouse's lot). And a road is one only where a settler standing at the door
  // finds it - `houseGate`, the walk's own question - which the road on paper to seed 10's and
  // seed 11's weigh houses was not.
  test(`seed ${seed}: every civic door has a road of its own, and a settler at the door finds it`, () => {
    const { layout } = grow(seed);
    const walks = {
      paths: layout.paths, bridges: layout.bridges || [], island: { town: layout.town },
      districts: Object.entries(layout.districts).map(([id, d]) => ({ id, ...d })),
    };
    let doors = 0;
    for (const [id, p] of Object.entries(layout.plots)) {
      if (!id.startsWith('civic:')) continue;
      const door = plotDoor(id, p);
      if (!door) continue;
      doors++;
      assert.ok(layout.paths.some((q) => q.id === `path:${id}`), `${id} has no road`);
      assert.notEqual(houseGate(walks, layout.size, door.door), null, `no road within reach of ${id}'s door`);
    }
    assert.ok(doors > 20, 'the ladder was climbed to its top');
  });

  // The sand a civic road crosses is paved, and kept paved: it is in the road's cells, so every
  // reader has it, and in `strand`, which the replay forces back because beach is BLOCKED.
  test(`seed ${seed}: a strandpad is road on the sand, and stays road`, () => {
    const { layout, terrain } = grow(seed);
    const grid = replayGrid(terrain, layout);
    for (const q of layout.paths) {
      if (!q.strand) continue;
      assert.ok(String(q.id).startsWith('path:civic:'), `${q.id} carries a strandpad`);
      const own = new Set(q.cells.map(key));
      for (const c of q.strand) {
        assert.ok(own.has(key(c)), `${q.id}'s strandpad is among its cells at ${c}`);
        assert.ok(terrain.isLand(c[0], c[1]) && !terrain.isBuildable(c[0], c[1]), `${q.id}'s strandpad is on ground no road could use at ${c}`);
        assert.equal(grid.get(c[0], c[1]), PATH, `${q.id}'s strandpad replays as road at ${c}`);
      }
      strands.push(`${seed}:${q.id}`);
    }
    // And the scan after it changes nothing, as layout.json has it: in JSON, where a field left
    // undefined is no field at all.
    const again = clone(layout);
    placeAll(again, ladder(STEPS[STEPS.length - 1]), { seed, size: SIZE });
    assert.equal(JSON.stringify(again), JSON.stringify(layout));
  });
}

test('and on at least one island a civic road walks up the sand to its door', () => {
  assert.ok(strands.length, 'no island has a strandpad to test');
});

test('and on at least one island both stand on the kadehaven\'s own quay', () => {
  assert.ok(onTheKade.length, 'no seed put its warehouse and weigh house at the kadehaven');
});

test('the kadehaven: the quay district\'s harbour, else where the first boat lies, else the nearest', () => {
  const seed = 1337;
  const layout = emptyLayout(seed, SIZE);
  placeAll(layout, village(40), { seed, size: SIZE });
  const terrain = groundOf(seed, layout);
  const hs = layout.harbours;
  const real = hs.map((h, n) => (h ? n : -1)).filter((n) => n >= 0);
  assert.ok(real.length >= 2, 'the island has harbours to choose between');

  // No quay district: the harbour at the quay every page derives from the landing.
  const first = quayFor(terrain, layout.landing);
  const own = hs.findIndex((h) => h && h.shore[0] === first.shore[0] && h.shore[1] === first.shore[1]);
  const side = sideOf(first.shore, layout.town.centre);
  assert.equal(kadehaven(layout, terrain).n, own >= 0 ? own : hs.findIndex((h) => h && h.side === side));

  // Its planks not among the harbours any more: the harbour on its side of the town.
  if (own >= 0) {
    const moved = clone(layout);
    moved.harbours[own].shore = [moved.harbours[own].shore[0] + 1, moved.harbours[own].shore[1]];
    assert.equal(kadehaven(moved, terrain).n, own, 'the harbour on the first boat\'s side');
  }

  // A quay district whose planks are one of the harbours: that one, whatever else.
  const other = real.find((n) => n !== own);
  const quay = clone(layout);
  quay.districts.quay = { pier: hs[other].pier, shore: hs[other].shore, lobes: [] };
  assert.equal(kadehaven(quay, terrain).n, other);
  // And one whose planks are not: the quay's own planks.
  quay.districts.quay = { pier: [[1, 1], [2, 1]], shore: [0, 1], lobes: [] };
  assert.deepEqual(kadehaven(quay, terrain), { n: -1, side: kadehaven(quay, terrain).side, shore: [0, 1], pier: [[1, 1], [2, 1]], slip: [] });

  // No landing to derive a quay from: the harbour nearest the town.
  const bare = clone(layout);
  bare.landing = null;
  const c = layout.town.centre;
  const d2 = (s) => (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2;
  const nearest = real.reduce((a, b) => (d2(hs[b].shore) < d2(hs[a].shore) ? b : a));
  assert.equal(kadehaven(bare, terrain).n, nearest);

  // No harbour at all: none.
  const none = clone(layout);
  none.harbours = [null, null, null, null];
  assert.equal(kadehaven(none, terrain), null);
});

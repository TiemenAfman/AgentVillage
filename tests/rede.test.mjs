// The rede: where the ships the village earns lie at anchor (Plans/mijlpalen-tot-tweehonderd.md).
//
// A ship is a plot four by sixteen on the water off the kadehaven, and what is asserted is the
// plan's six rules for every cell of it, worked out again here from the ground and the harbours
// rather than asked of lib/layout.mjs: deep water (below REDE_DEPTH) that the open sea reaches,
// not the fairway, not within two cells of any plank, slipway or berth, not in the lane out
// from any pier head, not where the galleon turns, not a polder. Then the rest of the rule: the
// Batavia's nearest cell eight to twenty from a pier head and her long side along the coast;
// the second and third beside her, five apart and turned the same way, where there is room;
// every ship a cell of water clear of every other and of the yard; nothing that stood moving
// as the village grows to two hundred, and a second scan changing nothing. And the two things
// that must leave a ship alone: the ladder's polders and the fairway - and the keeper's polder,
// which is refused. Last, a growing island, where a ring that fills a ship's water moves her on
// purpose, like the lighthouse.
//
// No coordinate is written down: every seed has its harbours somewhere else.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLayout, placeAll, kadehaven, keptWater, afloatDrowned, planFairway, polderCandidate,
  REDE_DEPTH, REDE_NEAR, REDE_FAR, GALLEON_ROOM, FLEET_PITCH, YARD_ID, yardRows, YARD_LOT, YARD_WET,
} from '../lib/layout.mjs';
import { MILESTONES, civicIdOf } from '../lib/village.mjs';
import { parsePlan, runPlan } from '../lib/plan.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { placeIsland } from '../shared/regions.mjs';
import { mooringsFor, shipBerth } from '../shared/quay.mjs';
import { blockOf, superOf } from '../shared/lattice.mjs';
import { village, clone, key, stands, movedBetween } from './support/village.mjs';

const SIZE = 128;
const SEEDS = [5, 2024, 1337];
const SHIPS = ['civic:ship', 'civic:ship:2', 'civic:ship:3'];
// The rungs, and the scans in between, of a village that grows to the top of the ladder.
const STEPS = [40, 90, 95, 106, 113, 120, 127, 134, 142, 150, 158, 165, 175, 184, 192, 200];

// support/village.mjs's twelve projects, with the ladder unlocked as far as they have earned it.
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
const groundOf = (seed, l) => makeTerrain(seed, { size: l.size, polders: l.polders, fairway: l.fairway, grow: l.grow || null });
const cellsOf = (p) => { const out = []; for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) out.push([p.gx + x, p.gz + z]); return out; };
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
const gapTo = (p, [hx, hz]) => Math.max(p.gx - hx, 0, hx - (p.gx + p.w - 1), p.gz - hz, hz - (p.gz + p.d - 1));

// The open sea, flooded in from the edge of the grid over water that is not river - the same
// water a hull could arrive over, worked out again here.
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

// Everything on the island's water a ship is kept clear of, from the harbours and the ground.
function harbourWater(layout, terrain) {
  const harbours = (layout.harbours || []).filter(Boolean);
  const planks = [];
  for (const h of harbours) planks.push(...h.pier, ...(h.slip || []));
  const view = { island: { landing: layout.landing, harbours: harbours.map((h) => ({ side: h.side, shore: h.shore, pier: h.pier, boats: 3 })) }, districts: [] };
  const moorings = mooringsFor('x', terrain, view);
  const berths = moorings.map((m) => [Math.floor(m.x + terrain.half), Math.floor(m.z + terrain.half)]);
  const first = moorings.find((m) => m.id === 'boat:x');
  const galleon = first ? shipBerth(first, placeIsland(terrain).worldHeight) : null;
  const heads = harbours.map((h) => {
    const head = h.pier[h.pier.length - 1];
    const run = [Math.sign(h.pier[0][0] - h.shore[0]), Math.sign(h.pier[0][1] - h.shore[1])];
    return { head, run, across: [run[1], -run[0]] };
  });
  return { planks, berths, galleon, heads };
}

// The six rules, a cell at a time.
function assertOnTheRede(id, p, layout, terrain) {
  const sea = seaOf(terrain);
  const fairway = new Set(((layout.fairway || {}).cells || []).map(key));
  const works = new Set();
  for (const q of layout.polders || []) for (const c of [...q.cells, ...q.dike, ...(q.pools || [])]) works.add(key(c));
  const { planks, berths, galleon, heads } = harbourWater(layout, terrain);
  for (const c of cellsOf(p)) {
    const at = `${id} at ${c}`;
    assert.ok(terrain.isWater(c[0], c[1]) && terrain.heightAt(c[0], c[1]) < REDE_DEPTH, `${at}: deeper than ${REDE_DEPTH}`);
    assert.ok(sea.has(key(c)), `${at}: the open sea reaches it`);
    assert.ok(!fairway.has(key(c)), `${at}: not the fairway`);
    for (const o of [...planks, ...berths]) assert.ok(cheb(c, o) > 2, `${at}: within two of a plank, slipway or berth at ${o}`);
    for (const { head, run, across } of heads) {
      const dx = c[0] - head[0], dz = c[1] - head[1];
      assert.ok(!(dx * run[0] + dz * run[1] >= 1 && Math.abs(dx * across[0] + dz * across[1]) <= 2), `${at}: in the lane out from the head at ${head}`);
    }
    if (galleon) {
      const [x, z] = terrain.cellWorld(c[0], c[1]);
      assert.ok((x - galleon.x) ** 2 + (z - galleon.z) ** 2 > GALLEON_ROOM ** 2, `${at}: where the galleon turns`);
    }
    assert.ok(!works.has(key(c)), `${at}: not a polder`);
  }
}

// Every other ship and the yard, a cell of water away.
function assertClearOfEachOther(layout) {
  const lots = [...SHIPS, YARD_ID].filter((id) => layout.plots[id]);
  for (const a of lots) {
    for (const b of lots) {
      if (a >= b) continue;
      for (const c of cellsOf(layout.plots[a])) for (const o of cellsOf(layout.plots[b])) assert.ok(cheb(c, o) > 1, `${a} and ${b} touch at ${c} / ${o}`);
    }
  }
}

const grown = new Map();
function grow(seed) {
  if (grown.has(seed)) return grown.get(seed);
  const layout = emptyLayout(seed, SIZE);
  const placedAt = {};
  for (const n of STEPS) {
    const before = stands(layout);
    placeAll(layout, ladder(n), { seed, size: SIZE });
    const moved = movedBetween(before, stands(layout)).filter((id) => before[id]);
    assert.deepEqual(moved, [], `seed ${seed}: something moved at ${n} settlers`);
    // A ship is measured on the scan that set her down, against the island as it was then.
    for (const id of SHIPS) {
      if (layout.plots[id] && !placedAt[id]) {
        placedAt[id] = n;
        assertOnTheRede(id, layout.plots[id], layout, groundOf(seed, layout));
      }
    }
  }
  // The plots, not the whole file: on this crowded village of 128 cells seed 5's second scan
  // rewrites a district's record (the land-register toggle when houses are left over), and so
  // it did before the ladder went past a hundred - measured on the code before it, the same
  // scans differ in the same field. The live island's copy, grown to 200, is byte-identical.
  const once = JSON.stringify(layout.plots);
  placeAll(layout, ladder(200), { seed, size: SIZE });
  const out = { layout, placedAt, again: JSON.stringify(layout.plots) === once };
  grown.set(seed, out);
  return out;
}

let besideBoth = 0;
for (const seed of SEEDS) {
  test(`seed ${seed}: three ships at anchor off the kadehaven, on the rede's six rules, sticky`, () => {
    const { layout, placedAt, again } = grow(seed);
    assert.ok(again, 'a second scan of the same village moves and adds nothing');
    for (const id of SHIPS) assert.ok(layout.plots[id], `${id} was given water`);
    assert.equal(placedAt['civic:ship'], 120);
    assert.equal(placedAt['civic:ship:2'], 158);
    assert.equal(placedAt['civic:ship:3'], 192);
    assertClearOfEachOther(layout);

    // The Batavia: eight to twenty from a pier head - the kadehaven's, unless it had no water
    // for her - with her long side along that harbour's coast.
    const terrain = groundOf(seed, layout);
    const first = layout.plots['civic:ship'];
    const kade = kadehaven(layout, terrain);
    assert.ok(kade, 'the island has a kadehaven');
    const { heads } = harbourWater(layout, terrain);
    const off = heads.find(({ head }) => gapTo(first, head) >= REDE_NEAR && gapTo(first, head) <= REDE_FAR);
    assert.ok(off, 'she lies eight to twenty from a pier head');
    assert.equal(Math.max(first.w, first.d), 16);
    assert.equal(first.w === 16, off.run[0] === 0, 'broadside to the quay: her length runs along the coast');

    // The second and the third beside her where there is room: five apart across her beam, a
    // little along her length at most, and turned the same way.
    const beam = first.w > first.d ? 1 : 0;
    let beside = 0;
    for (const id of ['civic:ship:2', 'civic:ship:3']) {
      const p = layout.plots[id];
      const across = [p.gx - first.gx, p.gz - first.gz][beam], along = [p.gx - first.gx, p.gz - first.gz][1 - beam];
      if ([FLEET_PITCH, 2 * FLEET_PITCH].includes(Math.abs(across)) && Math.abs(along) <= 4) {
        assert.equal(p.rot, first.rot, `${id} lies beside her turned her way`);
        assert.deepEqual([p.w, p.d], [first.w, first.d]);
        beside++;
      }
    }
    if (beside === 2) besideBoth++;
  });
}

test('and on at least one island the fleet lies side by side', () => {
  assert.ok(besideBoth > 0, 'no seed laid all three ships beside each other');
});

test('the ladder\'s polders leave a ship and the ring of water round her alone', () => {
  // The first polder seed 1337 digs at 150 with no ship on the island, and a ship laid right
  // in it beforehand: the polder has to go elsewhere, and she has to stay open sea.
  const seed = 1337;
  const plain = village(149), more = village(150);
  const a = emptyLayout(seed, SIZE);
  placeAll(a, plain, { seed, size: SIZE });
  placeAll(a, more, { seed, size: SIZE });
  assert.ok(a.polders.length, 'seed 1337 reclaims a polder at 150');
  const inPolder = new Set(a.polders[0].cells.map(key));
  // A strip of the polder's own water for her, four across and as long as it has.
  let ship = null;
  for (const [gx, gz] of a.polders[0].cells) {
    for (const [w, d] of [[16, 4], [4, 16], [8, 4], [4, 8]]) {
      const p = { gx, gz, w, d, rot: w > d ? 1 : 0 };
      if (cellsOf(p).every((c) => inPolder.has(key(c)))) { ship = p; break; }
    }
    if (ship) break;
  }
  assert.ok(ship, 'the polder has water enough for a ship');

  const b = emptyLayout(seed, SIZE);
  placeAll(b, plain, { seed, size: SIZE });
  b.plots['civic:ship'] = ship;
  const kept = keptWater(b);
  for (let z = -1; z <= ship.d; z++) for (let x = -1; x <= ship.w; x++) assert.ok(kept.has(key([ship.gx + x, ship.gz + z])), 'the ship and the ring round her are kept water');
  const t0 = groundOf(seed, b);
  const [i, j] = superOf(b.lattice, ship.gx, ship.gz);
  assert.equal(polderCandidate(t0, b.lattice, i, j, kept), false, 'the super-cell under her is no polder candidate');

  placeAll(b, more, { seed, size: SIZE });
  const t1 = groundOf(seed, b);
  const near = new Set();
  for (let z = -1; z <= ship.d; z++) for (let x = -1; x <= ship.w; x++) near.add(key([ship.gx + x, ship.gz + z]));
  for (const q of b.polders) {
    for (const c of [...q.cells, ...q.dike, ...(q.pools || [])]) assert.ok(!near.has(key(c)), `the polder reaches her at ${c}`);
  }
  assert.equal(afloatDrowned(b, t1), null, 'and she is still on the open sea');
  assert.deepEqual(b.plots['civic:ship'], ship, 'and where she was');
});

test('a ship on ground the sea does not reach is drowned, one on the open sea is not', () => {
  const { layout } = grow(5);
  const terrain = groundOf(5, layout);
  assert.equal(afloatDrowned(layout, terrain), null);
  const land = terrain.landCells[Math.floor(terrain.landCells.length / 2)];
  const moved = clone(layout);
  moved.plots['civic:ship:2'] = { gx: land[0], gz: land[1], w: 4, d: 16, rot: 0 };
  assert.equal(afloatDrowned(moved, terrain), 'civic:ship:2');
});

test('the fairway is never dredged through a ship', () => {
  // Seed 5 dredges its river mouth at 25 settlers. Lay a ship across that channel before it is
  // dug and dig again: the cut has to go round her.
  const seed = 5;
  const layout = emptyLayout(seed, SIZE);
  placeAll(layout, village(30), { seed, size: SIZE });
  assert.ok(layout.fairway && layout.fairway.cells.length, 'seed 5 has a fairway');
  const channel = layout.fairway.cells;
  const bare = clone(layout);
  bare.fairway = null;
  const mid = channel[Math.floor(channel.length / 2)];
  bare.plots['civic:ship'] = { gx: mid[0] - 2, gz: mid[1] - 2, w: 4, d: 4, rot: 0 };
  const under = new Set(cellsOf(bare.plots['civic:ship']).map(key));
  const dug = planFairway(makeTerrain(seed, { size: SIZE, polders: bare.polders, fairway: null }), bare);
  assert.ok(dug, 'there is still a channel to dig');
  for (const c of dug.cells) assert.ok(!under.has(key(c)), `the fairway runs through her at ${c}`);
});

test('a keeper\'s polder over a ship is refused, and changes nothing', () => {
  const seed = 1337;
  const model = village(40);
  const layout = emptyLayout(seed, SIZE);
  placeAll(layout, model, { seed, size: SIZE });
  placeAll(layout, model, { seed, size: SIZE });
  const t = groundOf(seed, layout);
  const kept = new Set(((layout.fairway || {}).cells || []).map(key));
  // The first shore super-cell a hand could reclaim, and a ship laid on its water.
  let supers = null;
  for (let r = 1; r < 16 && !supers; r++) {
    for (let dj = -r; dj <= r && !supers; dj++) for (let di = -r; di <= r && !supers; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) === r && polderCandidate(t, layout.lattice, di, dj, kept, { shore: true })) supers = [[di, dj]];
    }
  }
  assert.ok(supers, 'this coast has water a hand could reclaim');
  const [gx, gz] = blockOf(layout.lattice, supers[0][0], supers[0][1]);
  const water = [];
  for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) if (t.isWater(gx + x, gz + z)) water.push([gx + x, gz + z]);
  layout.plots['civic:ship'] = { gx: water[0][0], gz: water[0][1], w: 1, d: 1, rot: 0 };
  const before = JSON.stringify(layout);
  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'polder', supers }] }), { seed, size: SIZE, now: 1_800_000_000_000 });
  assert.equal(r.ok, false, 'the polder is refused');
  assert.equal(JSON.stringify(layout), before, 'and nothing was written');
});

test('on an island that grows, a ring that fills a ship\'s water moves her on purpose', () => {
  // Founded the way a new install is (a 32 island on a 64 grid, room to 384), and grown five
  // settlers a scan: after every scan every ship still lies on water deep enough and open, and
  // the yard's slipway still runs into the sea - which on the scans where a ring came through
  // means they were placed again, and nothing else that stood was.
  const seed = 5;
  const layout = emptyLayout(seed, 64, { base: 32, steps: [] });
  const lots = [...SHIPS, YARD_ID];
  const at = {};
  let movedOnPurpose = 0;
  for (let n = 5; n <= 200; n += 5) {
    const before = stands(layout);
    const size0 = layout.size;
    placeAll(layout, ladder(n), { seed, size: layout.size, cap: 384 });
    const local = (id) => { const p = layout.plots[id]; return p ? `${p.gx - layout.size / 2},${p.gz - layout.size / 2},${p.rot}` : null; };
    const localBefore = (id) => { const [gx, gz, rot] = before[id].split(',').map(Number); return `${gx - size0 / 2},${gz - size0 / 2},${rot}`; };
    for (const id of Object.keys(before)) {
      if (!layout.plots[id] || local(id) === localBefore(id)) continue;
      assert.ok(id.startsWith('civic:'), `${id} moved at ${n}`);
      if (lots.includes(id)) movedOnPurpose++;
    }
    const terrain = groundOf(seed, layout);
    const sea = seaOf(terrain);
    for (const id of SHIPS) {
      const p = layout.plots[id];
      if (!p) continue;
      for (const c of cellsOf(p)) assert.ok(terrain.heightAt(c[0], c[1]) < REDE_DEPTH && sea.has(key(c)), `${id} is left on ${c} at ${n}`);
    }
    const yard = layout.plots[YARD_ID];
    if (yard) for (const c of yardRows(yard, YARD_LOT.d - YARD_WET, YARD_LOT.d)) assert.ok(sea.has(key(c)), `the slipway runs into ground at ${c} at ${n}`);
    for (const id of lots) if (layout.plots[id]) at[id] = local(id);
  }
  for (const id of lots) assert.ok(at[id], `${id} stands at 200`);
  assert.ok(movedOnPurpose > 0, 'no ring ever reached the rede, so this measured nothing');
});

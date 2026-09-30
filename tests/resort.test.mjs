// The quay's resort on the sea (Plans/quay-op-zee.md, variant A as the keeper chose it on
// 30 September 2026): the quay district's houses leave the harbour for a comb of boardwalks off
// the coast, and the harbour - its planks, the moorings, the first boat, the galleon - stays where
// it is (option A: `districts.quay.pier`/`shore` are the quay's harbour, never moved).
//
// What is held here:
//   - `resortSite` derives Hoogezand's resort, the one the keeper approved, from the ground and
//     the layout alone (tests/support/hoogezand-resort.mjs, fase 3 built), and on other islands
//     gives a site that keeps every rule, or null with a reason;
//   - the one move: every house of the district on a lot, nothing else moved, the harbour and
//     everything that reads it unchanged, asked once;
//   - a growth ring after it: no house of the resort moves, its water stays open to the sea, no
//     pond, and the resort rides on the step as ordinary lane;
//   - a new island founds its quay and then its resort, the houses move once and a second scan
//     is a no-op; a new Cowork house goes to the next lot, and past the last lot to the commons;
//   - the layout before the move is kept (`backUpBeforeResort`).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeTerrain, openWaterOf, funnelHas } from '../shared/terrain.mjs';
import {
  emptyLayout, resortSite, planResort, resortCells, resortWater, growStep, growCanvas, kadehaven, waterfront, kadeCraneCell,
  placeAll, foundingGrowth, keptWater, fairwayHeld, outsideDoor, doorCell, replayGrid, PATH, RESERVED, PLOT, RESORT_ROAD,
  QUAY_VERSION, havenKeys,
} from '../lib/layout.mjs';
import { mooringsFor } from '../shared/quay.mjs';
import { MILESTONES } from '../lib/village.mjs';
import { backUpBeforeResort } from '../scan.mjs';
import { clone } from './support/village.mjs';
import { HOOGEZAND_RESORT as F } from './support/hoogezand-resort.mjs';

const key = (c) => `${c[0]},${c[1]}`;
const MODEL = { districts: [{ id: 'quay', kind: 'quay' }] };
const groundOf = (l) => makeTerrain(l.seed, { size: l.size, polders: l.polders, fairway: l.fairway, works: l.works || null, grow: l.grow || null });
const lotCells = (l) => { const out = []; for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) out.push([l.gx + x, l.gz + z]); return out; };

function hoogezand() {
  const l = emptyLayout(F.seed, F.size, clone(F.grow));
  Object.assign(l, clone({
    polders: F.polders, fairway: F.fairway, works: F.works, harbours: F.harbours, landing: F.landing, town: F.town, lattice: F.lattice,
    zones: F.zones, bridges: F.bridges, districts: F.districts, plots: F.plots, paths: F.paths, terrainHash: F.hash,
  }));
  l.quayV = 2;
  return l;
}

// What a page, the sea and the placing read of the harbour: the kadehaven, the moorings (boat 0
// and every berth), the galleon, the crane's cell, the quay's planks.
function harbourView(l, T) {
  const view = { island: { landing: l.landing, harbours: l.harbours.filter(Boolean).map((h) => ({ side: h.side, shore: h.shore, pier: h.pier, boats: 3 })) }, districts: [{ pier: l.districts.quay.pier, shore: l.districts.quay.shore }] };
  const wf = waterfront(l, T, MODEL);
  return {
    kadehaven: kadehaven(l, T),
    moorings: mooringsFor('x', T, view).map((m) => `${m.id}@${m.x.toFixed(3)},${m.z.toFixed(3)}`),
    galleon: wf.galleon && [wf.galleon.x, wf.galleon.z],
    crane: kadeCraneCell(l), pier: l.districts.quay.pier, shore: l.districts.quay.shore, harbours: l.harbours,
  };
}

test('on Hoogezand the resort is the one the keeper chose: in the bay east of the quay\'s end', () => {
  const l = hoogezand();
  const T = groundOf(l);
  assert.equal(T.hash, '9d792cbd');
  const { site, reason } = resortSite(l, T, MODEL);
  assert.equal(reason, null);
  assert.deepEqual(site.foot, [191, 311], 'the jetty leaves the beach at (191,311)');
  assert.deepEqual(site.out, [1, 0], 'and runs east');
  assert.equal(site.shape, 'T');
  assert.deepEqual(site.jetty, [[192, 311], [193, 311], [194, 311], [195, 311], [196, 311]], 'five cells out to the boardwalk on x = 196');
  assert.deepEqual(site.lots.slice(0, 9), [
    { gx: 197, gz: 310, rot: 3 }, { gx: 193, gz: 313, rot: 1 }, { gx: 197, gz: 314, rot: 3 }, { gx: 193, gz: 317, rot: 1 },
    { gx: 197, gz: 318, rot: 3 }, { gx: 193, gz: 321, rot: 1 }, { gx: 197, gz: 322, rot: 3 }, { gx: 193, gz: 325, rot: 1 },
    { gx: 197, gz: 326, rot: 3 },
  ], 'nine lots: the sea side facing west, the land side facing east');
  assert.equal(site.lots.length, 20, 'and room to grow to twenty');
  assert.ok(site.lots.slice(9).some((lot) => lot.gx === 201), 'past the first boardwalk\'s arms, a second one (x = 204) behind a plank');
  assert.ok(site.deck.some(([x]) => x === 204), 'the second boardwalk is part of the deck it grows into');
  assert.deepEqual(site.raft, [196, 338], 'the bathing raft beyond the end');
  assert.deepEqual(site.strand, [[191, 311], [190, 311], [189, 311]], 'the way in crosses three cells of sand');
});

// Every rule of the site, asked again of the result: on the water in the band the piles reach,
// doors on the deck, on the quay's bank, off the funnel, the lanes and the ships' water.
function assertSiteKeepsTheRules(l, T, site) {
  const wf = waterfront(l, T, MODEL);
  const funnel = havenKeys(l, 0);
  const k = l.works.kade;
  const side = (gx, gz) => Math.sign((gx - l.works.haven.top[0]) * l.works.haven.dir[1] - (gz - l.works.haven.top[1]) * l.works.haven.dir[0]);
  const quay = side(k.cells[0][0], k.cells[0][1]);
  const deck = new Set([...site.jetty, ...site.deck].map(key));
  assert.ok(T.isLand(...site.foot) && T.isBeach(...site.foot), 'the foot is beach');
  for (const c of [...site.jetty, ...site.deck]) {
    assert.ok(T.isWater(c[0], c[1]), `the deck at ${c} is over water`);
    assert.ok(!funnel.has(key(c)) && !wf.corridor(c[0], c[1]) && !wf.swings(c[0], c[1]), `the deck at ${c} keeps out of the harbour`);
  }
  for (const lot of site.lots) {
    for (const [x, z] of lotCells(lot)) {
      const corners = [T.corner(x, z), T.corner(x + 1, z), T.corner(x, z + 1), T.corner(x + 1, z + 1)];
      assert.ok(corners.every((h) => h < 0 && h >= -1), `lot ${lot.gx},${lot.gz}: every corner under water and within the piles' reach`);
      assert.equal(side(x, z), quay, 'on the quay\'s bank of the funnel');
      assert.ok(!funnel.has(key([x, z])) && !(wf.ships && wf.ships(x, z)), 'off the funnel and the big ships\' water');
    }
    assert.ok(deck.has(key(outsideDoor(lot.gx, lot.gz, lot.rot))), `lot ${lot.gx},${lot.gz} opens onto the deck`);
  }
}

test('Hoogezand\'s resort keeps every rule it was chosen by', () => {
  const l = hoogezand();
  const T = groundOf(l);
  assertSiteKeepsTheRules(l, T, resortSite(l, T, MODEL).site);
});

test('the move: every house of the quay on a lot, nothing else moved, the harbour as it was', () => {
  const l = hoogezand();
  const T = groundOf(l);
  const before = clone(l);
  const view = harbourView(l, T);
  const moved = planResort(l, T, MODEL);
  assert.equal(moved.length, 9, 'the nine houses of the quay moved');
  const houses = Object.entries(l.plots).filter(([, p]) => p.district === 'quay');
  assert.equal(houses.length, 9);
  assert.deepEqual(houses.map(([, p]) => p.lot).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8], 'on the first nine lots');
  for (const [id, p] of houses) {
    const lot = l.resort.lots[p.lot];
    assert.deepEqual([p.gx, p.gz, p.rot, p.quay], [lot.gx, lot.gz, lot.rot, true], `${id} stands on its lot, on piles`);
  }
  const otherMoved = Object.keys(before.plots).filter((id) => before.plots[id].district !== 'quay' && JSON.stringify(before.plots[id]) !== JSON.stringify(l.plots[id]));
  assert.deepEqual(otherMoved, [], 'no other plot moved');
  assert.deepEqual(harbourView(l, T), view, 'the kadehaven, every mooring, the galleon, the crane\'s cell and the planks are where they were');
  assert.deepEqual(l.works, before.works, 'no ground changed');
  assert.deepEqual(l.districts.quay.lobes, [], 'the district\'s land on the shore went back to the countryside');
  assert.ok(!l.paths.some((p) => /^road:quay:\d+$/.test(p.id)), 'and its lane with it');
  for (const [id] of houses) assert.ok(!l.paths.some((p) => p.id === `path:${id}`), `${id}'s old front path went`);
  // Asked once.
  const once = JSON.stringify(l);
  assert.equal(planResort(l, T, MODEL), null);
  assert.equal(JSON.stringify(l), once, 'a second time nothing is asked or written');
});

test('the resort holds its water: the deck is road where the houses need it, the rest kept', () => {
  const l = hoogezand();
  const T = groundOf(l);
  planResort(l, T, MODEL);
  const rc = resortCells(l);
  const grid = replayGrid(T, l);
  const drawn = new Set(rc.drawn.map(key));
  assert.ok(drawn.has(key(l.resort.jetty[0])), 'the jetty is drawn from its first plank');
  for (const n of rc.occupied) assert.ok(drawn.has(key(outsideDoor(l.resort.lots[n].gx, l.resort.lots[n].gz, l.resort.lots[n].rot))), `lot ${n}'s doorstep is on the drawn deck`);
  for (const c of rc.deck) assert.equal(grid.get(c[0], c[1]), drawn.has(key(c)) ? PATH : RESERVED, `deck ${c}`);
  rc.lots.forEach((cells, n) => { for (const c of cells) assert.equal(grid.get(c[0], c[1]), rc.occupied.has(n) ? PLOT : RESERVED, `lot ${n} at ${c}`); });
  // Nothing else may take it: no polder, no dredger.
  const kept = keptWater(l), held = fairwayHeld(l);
  for (const c of [...rc.lots.flat(), ...rc.deck]) assert.ok(kept.has(key(c)) && held.has(key(c)), `${c} is kept from polders and dredgers`);
});

test('a ring later no house of the resort moves, and its water is a lagoon open to the sea', () => {
  const l = hoogezand();
  let T = groundOf(l);
  planResort(l, T, MODEL);
  const was = clone(l.plots);
  const pondsBefore = (() => { const o = openWaterOf(T); let n = 0; for (let z = 0; z < T.size; z++) for (let x = 0; x < T.size; x++) if (T.isWater(x, z) && !o[x + z * T.size]) n++; return n; })();
  const mask = resortWater(l, T);
  T = growStep(l, { seed: l.seed, size: l.size, cap: 384 });
  assert.ok(T, 'the ring was taken');
  assert.equal(l.size, 384);
  const k = 16;
  const step = l.grow.steps[l.grow.steps.length - 1];
  assert.equal(step.r, 180);
  assert.deepEqual(Object.keys(step).sort(), ['grid', 'haven', 'hold', 'lane', 'ponds', 'r', 'relief', 'water'], 'nothing new on the step');
  const lane = new Set(step.lane.map(key));
  const half = l.size / 2;
  for (const [x, z] of mask) assert.ok(lane.has(key([x + k - half, z + k - half])), `the resort's water at ${x},${z} rides on the step as lane`);
  for (const [id, p] of Object.entries(l.plots).filter(([, q]) => q.district === 'quay')) {
    assert.deepEqual([p.gx, p.gz], [was[id].gx + k, was[id].gz + k], `${id} stayed where it stood`);
  }
  const open = openWaterOf(T);
  const rc = resortCells(l);
  for (const c of [...rc.lots.flat(), ...rc.deck]) assert.ok(open[c[0] + c[1] * T.size] === 1, `${c} is open water after the ring`);
  assert.ok(T.isBeach(...l.resort.foot), 'the jetty still leaves from the beach');
  let pondsAfter = 0;
  for (let z = 0; z < T.size; z++) for (let x = 0; x < T.size; x++) if (T.isWater(x, z) && !open[x + z * T.size]) pondsAfter++;
  assert.equal(pondsAfter, pondsBefore, 'the ring shut no water in');
  assert.equal(l.terrainHash, groundOf(l).hash, 'the recorded hash is the ground the layout draws');
});

test('the grid growing moves the resort with everything else', () => {
  const l = hoogezand();
  planResort(l, groundOf(l), MODEL);
  const r = clone(l.resort);
  growCanvas(l, l.size + 64);
  const at = (c) => [c[0] + 32, c[1] + 32];
  assert.deepEqual(l.resort.foot, at(r.foot));
  assert.deepEqual(l.resort.jetty, r.jetty.map(at));
  assert.deepEqual(l.resort.deck, r.deck.map(at));
  assert.deepEqual(l.resort.strand, r.strand.map(at));
  assert.deepEqual(l.resort.raft, at(r.raft));
  assert.deepEqual(l.resort.lots, r.lots.map((lot) => ({ ...lot, gx: lot.gx + 32, gz: lot.gz + 32 })));
  assert.deepEqual(l.resort.out, r.out, 'a direction does not move');
});

// ---- new islands ----------------------------------------------------------------------------
// A village with a Cowork district of seven houses among six projects, every milestone its
// settlers have earned unlocked.
function village(settlers, cowork = 7) {
  const t0 = Date.UTC(2026, 0, 1), buildings = [];
  for (let i = 0; i < cowork; i++) buildings.push({ id: `house:cowork-${i}`, sessionId: `c${i}`, kind: 'house', district: 'quay', harbour: true, tier: 'hut', startedAt: t0 + i * 1000 });
  const P = 6, rest = settlers - cowork;
  const districts = [{ id: 'quay', kind: 'quay', name: 'The Quay', population: cowork, firstSeenAt: t0 }];
  for (let d = 0; d < P; d++) {
    const pop = Math.floor(rest / P) + (d < rest % P ? 1 : 0);
    districts.push({ id: `p:${d}`, kind: 'project', name: `P${d}`, population: pop, firstSeenAt: t0 + d });
    for (let n = 0; n < pop; n++) buildings.push({ id: `house:p${d}-${n}`, sessionId: `p${d}${n}`, kind: 'house', district: `p:${d}`, harbour: false, tier: 'hut', startedAt: t0 + 100000 + d * 1000 + n });
  }
  const milestones = MILESTONES.filter((m) => (m.on || 'settlers') === 'settlers' && m.at <= settlers)
    .map((m) => ({ ...m, unlocked: true, unlockedAt: t0, building: `civic:${m.civicType}` }));
  return { districts, buildings, milestones, furniture: [], stats: { settlers, reached: { settlers } }, ladder: { settlers } };
}
// Seeds whose quay and resort were measured: one founded on its whole grid, and two founded
// small that grow (one ring on 128, two rings out to 192). On most seeds founded small the
// funnel does not run near a grid axis or the town stands where the quay would, so no quay is
// built and the district keeps its parcel - the resort waits for a quay (`planResort`).
const NEW = [
  { seed: 90210, size: 128, min: null, cap: 128, settlers: 60 },
  { seed: 8, size: 128, min: 96, cap: 256, settlers: 200 },
  { seed: 51, size: 128, min: 96, cap: 256, settlers: 300 },
];
for (const c of NEW) {
  test(`a new island gets its quay, then its resort, and a second scan changes nothing (seed ${c.seed}${c.min ? `, founded on ${c.min}` : ''})`, () => {
    const l = emptyLayout(c.seed, c.size, c.min ? foundingGrowth(c.size, c.min) : null);
    const v = village(c.settlers);
    const { terrain: T } = placeAll(l, v, { seed: c.seed, size: c.size, cap: c.cap });
    if (c.min) assert.ok(l.grow.steps.length >= 1, 'the island grew');
    assert.ok(l.works && l.works.kade, 'a stone quay');
    assert.ok(l.resort, 'and a resort');
    assert.equal(l.quayV, QUAY_VERSION);
    const houses = Object.entries(l.plots).filter(([, p]) => p.district === 'quay');
    assert.equal(houses.length, 7);
    for (const [id, p] of houses) {
      assert.ok(Number.isInteger(p.lot), `${id} stands on a lot of the resort`);
      assert.equal(p.quay, true);
    }
    assert.deepEqual(l.districts.quay.lobes, [], 'with no land of its own');
    assert.ok(l.paths.some((p) => p.id === RESORT_ROAD), 'and a road to it');
    assertSiteKeepsTheRules(l, T, l.resort);
    const deck = new Set(l.districts.quay.deck.map(key));
    for (const [id, p] of houses) assert.ok(deck.has(key(outsideDoor(p.gx, p.gz, p.rot))) && deck.has(key(doorCell(p.gx, p.gz, p.rot))), `${id}'s door is on the deck`);
    const once = JSON.stringify(l);
    placeAll(l, v, { seed: c.seed, size: l.size, cap: c.cap });
    assert.equal(JSON.stringify(l), once, 'the scan after it is a no-op');
  });
}

test('a new Cowork house goes to the next lot at the boardwalk, and past the last lot to the commons', () => {
  const { seed, size, cap, settlers } = NEW[0];
  const l = emptyLayout(seed, size);
  let v = village(settlers);
  placeAll(l, v, { seed, size, cap });
  const lots = l.resort.lots.length;
  const add = (n) => {
    const t0 = Date.UTC(2026, 0, 2);
    for (let i = 0; i < n; i++) {
      const q = v.districts.find((d) => d.id === 'quay');
      v.buildings.push({ id: `house:late-${q.population}`, sessionId: `l${q.population}`, kind: 'house', district: 'quay', harbour: true, tier: 'hut', startedAt: t0 + q.population });
      q.population++;
    }
    v = { ...v, stats: { ...v.stats, settlers: v.stats.settlers + n } };
  };
  add(1);
  placeAll(l, v, { seed, size, cap });
  const next = l.plots['house:late-7'];
  assert.equal(next.lot, 7, 'the eighth house on the eighth lot');
  assert.ok(new Set(l.districts.quay.deck.map(key)).has(key(outsideDoor(next.gx, next.gz, next.rot))), 'with the boardwalk run out to its door');
  add(lots - 8 + 1);
  placeAll(l, v, { seed, size, cap });
  const all = Object.entries(l.plots).filter(([, p]) => p.district === 'quay');
  assert.equal(all.filter(([, p]) => Number.isInteger(p.lot)).length, lots, 'every lot taken');
  const lodging = all.filter(([, p]) => p.commons);
  assert.equal(lodging.length, 1, 'and the one more lodges on the commons');
  assert.ok(!lodging[0][1].quay, 'on land, not on piles');
  assert.equal(l.districts.quay.guest, true, 'the district says it does not fit');
});

test('the page finds the resort\'s beach and water for its raft and parasols from the deck alone', async () => {
  const { resortDressing } = await import('../web/js/resort-dressing.js');
  const { seed, size, cap, settlers } = NEW[0];
  const l = emptyLayout(seed, size);
  const { terrain: T } = placeAll(l, village(settlers), { seed, size, cap });
  const buildings = Object.entries(l.plots).map(([id, p]) => ({ id, district: p.district || null, plot: { ...p }, door: p.w === 3 ? doorCell(p.gx, p.gz, p.rot) : null }));
  const d = { id: 'quay', kind: 'quay', deck: l.districts.quay.deck };
  const dress = resortDressing(d, buildings, T, l.paths);
  assert.ok(dress, 'the resort is found');
  assert.deepEqual(dress.foot, l.resort.foot, 'its foot is the jetty\'s');
  assert.ok(dress.raft && T.isWater(...dress.raft), 'the raft floats');
  const standing = new Set(Object.values(l.plots).flatMap(lotCells).map(key));
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) assert.ok(!standing.has(key([dress.raft[0] + dx, dress.raft[1] + dz])), 'with water round it');
  const road = new Set(l.paths.flatMap((p) => p.cells).map(key));
  assert.ok(dress.parasols.length >= 1, 'and a parasol on the beach');
  for (const c of dress.parasols) assert.ok(T.isBeach(...c) && !road.has(key(c)), `the parasol at ${c} stands on the sand, off the road`);
});

test('a house on the resort sails to other pages on its piles: the guest view keeps `quay`', async () => {
  const { guestVillage } = await import('../lib/guestview.mjs');
  const v = {
    districts: [{ id: 'p:d:\\git\\somebody\\project', kind: 'project' }, { id: 'quay', kind: 'quay', deck: [[1, 1]] }],
    buildings: [{ id: 'house:abc', sessionId: 'abc', district: 'quay', harbour: true, plot: { gx: 1, gz: 2, w: 3, d: 3, rot: 1, quay: true } }],
  };
  const g = guestVillage(v);
  assert.deepEqual(g.buildings[0].plot, { gx: 1, gz: 2, w: 3, d: 3, rot: 1, quay: true }, 'the key is not renamed');
  assert.equal(g.districts[1].kind, 'quay');
  assert.equal(g.buildings[0].district, 'quay');
  assert.ok(!JSON.stringify(g).includes('somebody'), 'a project\'s folder is still renamed');
});

test('with no stone quay there is no resort, and the reason says so', () => {
  const l = emptyLayout(7, 128);
  const v = village(60);
  const { terrain: T } = placeAll(l, v, { seed: 7, size: 128, cap: 128 });
  assert.equal(l.works.kade, null, 'seed 7 has no quay: its funnel\'s harbour has no dry strip for one');
  assert.equal(l.resort, null, 'so no resort, decided in the same scan');
  assert.equal(resortSite(l, T, v).reason, 'no stone quay');
  assert.ok(Object.values(l.plots).filter((p) => p.district === 'quay').every((p) => !Number.isInteger(p.lot)), 'the district keeps its parcel');
});

test('the layout before the quay moved to its resort is kept, and only on that scan', () => {
  const at = new Date(2026, 8, 30, 16, 12, 21);
  const place = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-resort-'));
    const file = path.join(dir, 'layout.json');
    fs.writeFileSync(file, JSON.stringify({ quayV: 2 }));
    return { dir, file };
  };
  const backups = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('layout.before-resort-'));
  let { dir, file } = place();
  backUpBeforeResort(file, false, { resort: { foot: [1, 1] } }, at);
  assert.deepEqual(backups(dir), ['layout.before-resort-20260930-161221.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, backups(dir)[0]), 'utf8')), { quayV: 2 });
  ({ dir, file } = place());
  backUpBeforeResort(file, true, { resort: { foot: [1, 1] } }, at);
  assert.deepEqual(backups(dir), [], 'a resort already on record');
  ({ dir, file } = place());
  backUpBeforeResort(file, false, { resort: null }, at);
  assert.deepEqual(backups(dir), [], 'no site found: nothing moved');
});

test('the planner does not move the quay once it lives on its resort, nor give it land', async () => {
  const { runPlan, parsePlan } = await import('../lib/plan.mjs');
  const { seed, size, cap, settlers } = NEW[0];
  const l = emptyLayout(seed, size);
  const v = village(settlers);
  placeAll(l, v, { seed, size, cap });
  const was = JSON.stringify(l);
  for (const op of [{ op: 'move', lobes: [{ district: 'quay', lobe: 0 }], di: 1, dj: 0 }, { op: 'parcel', district: 'quay', lobe: 0, add: [[0, 0]], remove: [] }]) {
    const r = runPlan(l, v, parsePlan({ ops: [op] }), { seed, size: l.size, cap, dryRun: true });
    assert.equal(r.ok, false, `${op.op} is refused`);
    assert.match(r.verdicts[0].reason, /lives on the water at its resort/);
  }
  assert.equal(JSON.stringify(l), was, 'and nothing was written');
});

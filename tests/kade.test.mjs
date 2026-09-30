// The harbour as one piece of water with a stone quay (Plans/quay-en-rivier.md, fase 3, as the
// keeper approved it over the preview of 30 September 2026): lib/layout.mjs `planKade` digs one
// more `works.dig` - the old basin overlay, the rim between channel and basin, the funnel west of
// the channel over the old yard's rows, and east and south of the basin - and lays `works.kade`,
// a stone quay three wide on the harbour's east side at the planks' height, its water side a wall.
//
// What is held here, on the live island's quay end (tests/support/hoogezand-quay.mjs):
//   - water all along the wall, the quay at its level, the planks still on the open sea;
//   - the quay's houses stand in the water now, and nothing else that stands moved a corner;
//   - the yard went to the pirates' bank with a dock of its own; the crane, the warehouse and the
//     ships were lifted for the loops to place again; the sand at the inlet's head is left, so the
//     bridge's place is still there;
//   - asked once;
//   - the galleon lies in the big ships' water on the pirates' side and floats;
//   - a ring later the harbour and the quay are whole, and the warehouse behind the quay and the
//     crane on its end stay where they are;
//   - the pirates' bank keeps a lot for the pirate tavern: facing the harbour, free, and a road
//     can reach the square from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, funnelHas, openWaterOf } from '../shared/terrain.mjs';
import {
  emptyLayout, planKade, planHaven, repairFairway, fillRingPonds, growStep, waterfront, kadeCraneCell,
  kadeRoadCells, trialRoad, replayGrid, havenKeys, havenBridgeSite, keptWater, yardRows, YARD_ID, YARD_WET, outsideDoor,
  releaseHarbourCommons, dugKeys,
} from '../lib/layout.mjs';
import { shipWaterOf, SHIP_WATER } from '../shared/quay.mjs';
import { CRAFTS } from '../shared/crafts.mjs';
import { clone } from './support/village.mjs';
import { HOOGEZAND } from './support/hoogezand-ground.mjs';
import { HOOGEZAND_QUAY, HOOGEZAND_QUAY_LOBE } from './support/hoogezand-quay.mjs';
import { HOOGEZAND_RESORT } from './support/hoogezand-resort.mjs';
import { cellsOfSuper } from '../shared/lattice.mjs';

const SEED = HOOGEZAND.seed;
const MODEL = { districts: [{ id: 'quay' }] };
const groundOf = (l) => makeTerrain(SEED, { size: l.size, polders: l.polders, fairway: l.fairway, works: l.works || null, grow: l.grow });
const key = (x, z) => `${x},${z}`;

// The live island's quay end with its quay district's land and houses, mended the way placeAll
// mends it before it places anything: the mouth, the ponds, the funnel.
function liveLayout() {
  const { size, grow, polders } = HOOGEZAND;
  const layout = emptyLayout(SEED, size, clone(grow));
  layout.size = size;
  layout.polders = clone(polders);
  layout.fairway = clone(HOOGEZAND_QUAY.fairway);
  layout.harbours = clone(HOOGEZAND_QUAY.harbours);
  layout.districts = { quay: { ...clone(HOOGEZAND_QUAY.quay), deck: [], paved: [], lobes: [clone(HOOGEZAND_QUAY_LOBE)] } };
  layout.plots = clone(HOOGEZAND_QUAY.plots);
  HOOGEZAND_QUAY.quayHouses.forEach((p, n) => { layout.plots[`house:quay-${n}`] = { ...clone(p), quay: true }; });
  layout.landing = clone(HOOGEZAND_QUAY.landing);
  const c = HOOGEZAND_QUAY.town.centre;
  const paved = [];
  for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) paved.push([c[0] + x, c[1] + z]);
  layout.town = { ...clone(HOOGEZAND_QUAY.town), lots: [], paved, commons: [] };
  layout.lattice = clone(HOOGEZAND_QUAY.lattice);
  layout.paths = []; layout.bridges = []; layout.roads = [];
  layout.terrainHash = HOOGEZAND_QUAY.hash;
  const o = { seed: SEED, size };
  let T = groundOf(layout);
  T = repairFairway(layout, T, o) || T;
  T = fillRingPonds(layout, T, o) || T;
  T = planHaven(layout, T, null, o) || T;
  return { layout, T };
}
function kaded() {
  const { layout, T: before } = liveLayout();
  const was = clone(layout);
  const T = planKade(layout, before, MODEL, { seed: SEED, size: layout.size });
  return { layout, was, before, T };
}
const cellsOf = (p) => { const out = []; for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) out.push([p.gx + x, p.gz + z]); return out; };

test('on the live island the harbour is dug and the stone quay laid, water all along its wall', () => {
  const { layout, T } = kaded();
  assert.ok(T, 'planKade did nothing');
  const k = layout.works.kade;
  assert.deepEqual(Object.keys(k).sort(), ['back', 'cells', 'hold', 'level']);
  assert.equal(k.level, 113);
  assert.deepEqual(k.back, [1, 0], 'the land is east of the quay');
  const xs = k.cells.map((c) => c[0]), zs = k.cells.map((c) => c[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [168, 170], 'three wide, the wall on the corner line x = 168');
  // From the quay's first row to the last row where all three of its cells are dry: at 314 the
  // sea is at its back, at 316 at its wall.
  assert.deepEqual([Math.min(...zs), Math.max(...zs)], [267, 313]);
  assert.equal(k.cells.length, 3 * 47);
  assert.equal(layout.terrainHash, T.hash);
  assert.equal(groundOf(layout).hash, T.hash);
  const open = openWaterOf(T);
  for (let z = 267; z <= 313; z++) {
    assert.ok(T.isWater(167, z) && open[167 + z * T.size], `no open water at the wall's foot 167,${z}`);
    for (let x = 168; x <= 170; x++) assert.equal(T.heightAt(x, z), 113 / 256, `the quay is not at its level at ${x},${z}`);
  }
  for (const [x, z] of layout.districts.quay.pier) assert.ok(open[x + z * T.size], `the plank ${x},${z} is off the open sea`);
  assert.deepEqual(kadeCraneCell(layout), [168, 313], 'the crane\'s place is the quay\'s seaward end, on the wall');
  assert.equal(kadeRoadCells(layout).length, k.cells.length - 1, 'the quay\'s road is all of it but the crane\'s cell');
});

test('the quay\'s houses stand in the water, and nothing else that stands moved a corner', () => {
  const { layout, was, before, T } = kaded();
  const N = T.N;
  for (const [id, p] of Object.entries(layout.plots)) {
    if (p.quay) {
      for (const [x, z] of cellsOf(p)) assert.ok(T.isWater(x, z), `${id} has land under ${x},${z}`);
      continue;
    }
    if (id === YARD_ID) continue;            // moved: its new ground is checked below
    for (let z = 0; z <= p.d; z++) for (let x = 0; x <= p.w; x++) {
      const q = p.gx + x + (p.gz + z) * N;
      assert.equal(T.H[q], before.H[q], `${id} had a corner moved`);
    }
  }
  // The yard's dry rows on its new site are the ground they were.
  for (const [x, z] of yardRows(layout.plots[YARD_ID], 0, 6)) {
    for (const q of [x + z * N, x + 1 + z * N, x + (z + 1) * N, x + 1 + (z + 1) * N]) assert.equal(T.H[q], before.H[q], `the yard's dry row at ${x},${z} moved`);
  }
  // What was lifted: the crane, the warehouse (it stood in the basin); the ships are not in the
  // fixture. Nothing else is gone.
  const gone = Object.keys(was.plots).filter((id) => !layout.plots[id]).sort();
  assert.deepEqual(gone, ['civic:crane', 'civic:warehouse'].filter((id) => was.plots[id]).sort());
  // The sand at the head of the inlet is left: the bridge's place is where it was.
  assert.deepEqual(havenBridgeSite(T, layout.fairway), havenBridgeSite(before, was.fairway));
  assert.ok(havenBridgeSite(T, layout.fairway), 'no place for the bridge');
});

test('the yard goes to the pirates\' bank with a dock of its own', () => {
  const { layout, was, T } = kaded();
  const yard = layout.plots[YARD_ID];
  assert.notDeepEqual([yard.gx, yard.gz], [was.plots[YARD_ID].gx, was.plots[YARD_ID].gz], 'the yard did not move');
  assert.deepEqual(yard, { gx: 129, gz: 291, w: 5, d: 16, rot: 2 }, 'where the preview the keeper approved put it');
  const h = layout.works.haven, ring = havenKeys(layout, 1);
  const quaySide = Math.sign((layout.works.kade.cells[0][0] - h.top[0]) * h.dir[1] - (layout.works.kade.cells[0][1] - h.top[1]) * h.dir[0]);
  for (const [x, z] of cellsOf(yard)) {
    assert.equal(Math.sign((x - h.top[0]) * h.dir[1] - (z - h.top[1]) * h.dir[0]), -quaySide, `${x},${z} of the yard is not on the pirates' bank`);
    assert.ok(!ring.has(key(x, z)), `${x},${z} of the yard is in the harbour's water`);
  }
  const open = openWaterOf(T);
  for (const [x, z] of yardRows(yard, 16 - YARD_WET, 16)) assert.ok(open[x + z * T.size], `the slipway's toe at ${x},${z} is not open sea`);
  // The dug harbour is kept water: no polder over it.
  const kept = keptWater(layout);
  for (const [x, z] of layout.works.dig.at(-1).cells) assert.ok(kept.has(key(x, z)));
});

test('asked once: a second time nothing is dug or written', () => {
  const { layout, T } = kaded();
  const written = JSON.stringify(layout);
  assert.equal(planKade(layout, T, MODEL, { seed: SEED, size: layout.size }), null);
  assert.equal(JSON.stringify(layout), written);
});

test('the galleon lies in the big ships\' water on the pirates\' side, and floats', () => {
  const { layout, T } = kaded();
  const wf = waterfront(layout, T, MODEL);
  assert.ok(wf.galleon && wf.ships);
  const allow = shipWaterOf(layout.works);
  const probes = CRAFTS.galleon.sail.probes, pts = [[0, 0], ...probes, ...probes.map(([x, z]) => [x, -z])];
  for (const [px, pz] of pts) {
    // Her first mooring faces +z (yaw 0), so a probe's x is across her and z along her.
    const x = wf.galleon.x + px, z = wf.galleon.z + pz;
    const gx = Math.floor(x + T.half), gz = Math.floor(z + T.half);
    assert.ok(T.worldHeight(x, z) < SHIP_WATER, `her hull point ${px},${pz} is aground`);
    assert.ok(allow(gx, gz), `her hull point ${px},${pz} is not in the ships' water`);
  }
});

test('a ring later: the harbour and the quay are whole, and what stands behind and on it stays', () => {
  const { layout } = kaded();
  // Only the south harbour: the other three lie on coasts the ring drowns whatever the quay does.
  layout.harbours = layout.harbours.map((h) => (h && h.side === 's' ? h : null));
  // Set down where placeAll sets them (lib/layout.mjs kadeSite and the crane's branch).
  const crane = kadeCraneCell(layout);
  layout.plots['civic:crane'] = { gx: crane[0], gz: crane[1], w: 1, d: 1, rot: 3 };
  layout.plots['civic:warehouse'] = { gx: 171, gz: 309, w: 3, d: 3, rot: 3 };
  assert.deepEqual(outsideDoor(171, 309, 3), [170, 310], 'the warehouse\'s step is on the quay');
  const before = clone(layout);
  const T = growStep(layout, { seed: SEED, size: layout.size, cap: 384 });
  assert.ok(T, 'the island could not grow');
  const k = (layout.size - before.size) / 2;
  assert.equal(layout.size, 384);
  for (const id of ['civic:warehouse', 'civic:crane', YARD_ID, ...Object.keys(before.plots).filter((i) => i.startsWith('house:'))]) {
    assert.ok(layout.plots[id], `${id} was taken off the map by the ring`);
    assert.equal(layout.plots[id].gx, before.plots[id].gx + k, id);
    assert.equal(layout.plots[id].gz, before.plots[id].gz + k, id);
  }
  const open = openWaterOf(T);
  for (const [x, z] of layout.works.kade.cells) assert.equal(T.heightAt(x, z), 113 / 256, `the quay sank at ${x},${z}`);
  for (let z = 267 + k; z <= 313 + k; z++) assert.ok(open[167 + k + z * T.size], `the wall's foot at ${167 + k},${z} is no longer open water`);
  let shut = 0;
  for (const [x, z] of layout.works.dig.at(-1).cells) if (!T.isWater(x, z) || !open[x + z * T.size]) shut++;
  assert.equal(shut, 0, `${shut} cells of the harbour are no longer open water`);
  const yard = layout.plots[YARD_ID];
  for (const [x, z] of yardRows(yard, 16 - YARD_WET, 16)) assert.ok(open[x + z * T.size], `the slipway's toe at ${x},${z} was shut in`);
});

test('the pirates\' bank keeps a lot for the pirate tavern, facing the harbour, with a way to the square', () => {
  const { layout, T } = kaded();
  const h = layout.works.haven, q = layout.districts.quay;
  const yard = new Set(cellsOf(layout.plots[YARD_ID]).map(([x, z]) => key(x, z)));
  const dug = new Set(layout.works.dig.at(-1).cells.map(([x, z]) => key(x, z)));
  const quaySide = Math.sign((q.shore[0] - h.top[0]) * h.dir[1] - (q.shore[1] - h.top[1]) * h.dir[0]);
  const pirate = (x, z) => Math.sign((x - h.top[0]) * h.dir[1] - (z - h.top[1]) * h.dir[0]) === -quaySide;
  const taken = new Set();
  for (const p of Object.values(layout.plots)) for (const [x, z] of cellsOf(p)) taken.add(key(x, z));
  const open = openWaterOf(T);
  const G = replayGrid(T, layout);
  // The harbour: the funnel and the dug harbour, and three cells round them.
  const harbour = new Set();
  for (const [x, z] of [...layout.works.dig.at(-1).cells, ...[...havenKeys(layout, 0)].map((c) => c.split(',').map(Number))]) {
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) harbour.add(key(x + dx, z + dz));
  }
  const found = [];
  for (let gz = 255; gz <= 310 && found.length < 3; gz++) {
    for (let gx = 118; gx <= 150 && found.length < 3; gx++) {
      let ok = true;
      for (const [x, z] of cellsOf({ gx, gz, w: 3, d: 3 })) {
        if (!G.freeCell(x, z, true) || taken.has(key(x, z)) || yard.has(key(x, z)) || dug.has(key(x, z)) || !pirate(x, z)) { ok = false; break; }
      }
      if (!ok) continue;
      for (const rot of [1, 2, 0, 3]) {
        const [ox, oz] = outsideDoor(gx, gz, rot);
        if (!T.isWater(ox, oz) || !open[ox + oz * T.size] || !harbour.has(key(ox, oz))) continue;
        // A road from beside the lot to the square, bridging the river where it has to.
        const sides = [[gx + 1, gz - 1], [gx + 1, gz + 3], [gx - 1, gz + 1], [gx + 3, gz + 1]].filter(([x, z]) => G.freeCell(x, z, true));
        if (sides.some((c) => { const r = trialRoad(layout, { seed: SEED, size: layout.size }, c, { bridge: true }); return r && r.length; })) {
          found.push({ at: [gx, gz], rot });
          break;
        }
      }
    }
  }
  assert.ok(found.length >= 1, 'no free lot facing the harbour is left on the pirates\' bank');
  console.log(`# free tavern lots on the pirates' bank: ${JSON.stringify(found)}`);
});

test('no quay without a quay district with land, nor beside a funnel that does not run near an axis', () => {
  const { layout, T } = liveLayout();
  const noQuay = clone(layout);
  delete noQuay.districts.quay;
  assert.equal(planKade(noQuay, T, MODEL, { seed: SEED, size: noQuay.size }), null);
  assert.equal(noQuay.works.kade, undefined, 'not asked: a quay district may come');
  const slant = clone(layout);
  slant.works.haven = { ...slant.works.haven, dir: [45, 45] };
  assert.equal(planKade(slant, T, MODEL, { seed: SEED, size: slant.size }), null);
  assert.equal(slant.works.kade, null, 'asked, and no quay fits');
});

test('a quay record this code cannot draw is refused', () => {
  const cells = [[10, 10], [11, 10], [12, 10]];
  const draw = (kade) => makeTerrain(7, { size: 64, works: { v: 1, kade } });
  assert.ok(draw({ cells, level: 113, back: [1, 0], hold: [] }).hash);
  assert.equal(draw(null).hash, makeTerrain(7, { size: 64 }).hash, 'a null quay is none');
  for (const bad of [{ cells, level: 113, back: [1, 0], hold: [], wall: 1 }, { cells, level: 0.44, back: [1, 0], hold: [] }, { cells, level: 113, back: [2, 0], hold: [] }, { cells: [], level: 113, back: [1, 0], hold: [] }]) {
    assert.throws(() => draw(bad), Error);
  }
});

// The commons had claimed super-cells on the old shore for the crane, the warehouse and the yard,
// and the harbour drowned them: on Hoogezand ten super-cells of "the town" in the water, lighter
// squares in the planner. Given back once they are water touching the harbour with nothing on
// them; land, the town's core and water away from the harbour stay the town's.
test('town ground the harbour drowned goes back to nobody, and nothing else does', () => {
  const F = HOOGEZAND_RESORT;
  const l = emptyLayout(F.seed, F.size, clone(F.grow));
  Object.assign(l, clone({ polders: F.polders, fairway: F.fairway, works: F.works, town: F.town, lattice: F.lattice, districts: F.districts, plots: F.plots, paths: F.paths }));
  const T = groundOf(l);
  const harbour = new Set([...havenKeys(l), ...dugKeys(l)]);
  const taken = new Set();
  for (const p of Object.values(l.plots)) for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) taken.add(key(p.gx + x, p.gz + z));
  for (const p of l.paths) for (const c of p.cells || []) taken.add(key(c[0], c[1]));
  const kinds = { drowned: [], land: [], sea: [] };
  for (let j = -44; j <= 44; j++) for (let i = -44; i <= 44; i++) {
    const cells = cellsOfSuper(l.lattice, i, j);
    if (!cells.every(([x, z]) => T.inGrid(x, z))) continue;
    const wet = cells.every(([x, z]) => T.isWater(x, z) && !taken.has(key(x, z)));
    const near = cells.some(([x, z]) => harbour.has(key(x, z)));
    if (wet && near) kinds.drowned.push([i, j]);
    else if (wet) kinds.sea.push([i, j]);
    else if (cells.every(([x, z]) => !T.isWater(x, z))) kinds.land.push([i, j]);
  }
  assert.ok(kinds.drowned.length >= 5 && kinds.land.length && kinds.sea.length, JSON.stringify(Object.values(kinds).map((k) => k.length)));
  const core = [[0, 0], [1, -1]];
  const keep = [...core, ...kinds.land.slice(0, 5), ...kinds.sea.slice(0, 5)];
  l.town.commons = [...keep.slice(0, 4), ...kinds.drowned, ...keep.slice(4)];
  releaseHarbourCommons(l, T);
  assert.deepEqual(l.town.commons, keep, 'only the drowned harbour super-cells go, and the rest keep their order');
  const again = l.town.commons;
  releaseHarbourCommons(l, T);
  assert.equal(l.town.commons, again, 'a second pass changes nothing');
});

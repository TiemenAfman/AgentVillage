// Where everything stands. Two rules govern this file:
//   1. Deterministic  - the same village always produces the same town.
//   2. Sticky         - a building that already has a plot is never moved again,
//                       even if the algorithm below changes later.
// data/layout.json is therefore the source of truth; we only ever add to it.
import { makeTerrain, BEACH_MAX, CHANNEL_H } from '../shared/terrain.mjs';
import { makeRng, makeSimplex2D, fbm2, hash32 } from '../shared/rng.mjs';
import { QUAY_REACH, quayFor } from '../shared/quay.mjs';
import { PITCH, blockOf, centreOfCell, superOf } from '../shared/lattice.mjs';
import { readJson, writeJsonAtomic } from './paths.mjs';

export const LAYOUT_VERSION = 1;
// Houses, sheds, parcels and paths are re-planned when this changes; the terrain, the
// town square and everything civic are not. Bumping LAYOUT_VERSION instead would throw
// away the town, which is tied to the terrain and must never move.
export const PARCEL_VERSION = 2;
// Hamlet roads are re-routed when this changes, and nothing else is. They are the one
// piece of the layout that can be thrown away cheaply: pure derived geometry that no
// building stands on, which is why re-routing them needs a number of its own rather than
// a PARCEL_VERSION bump that would move every house to fix a road.
export const ROAD_VERSION = 3;
// One plot on the town square is placed again when this changes, and only if it is
// standing inside another one. Nothing else in the layout is affected: see
// `migrateSquare`, which is where the reason lives.
export const SQUARE_VERSION = 1;
// The quay is planned again when this changes, and no other district is touched. It needs
// a number of its own because the quay is the one place whose ground is not a preference -
// see `migrateQuay` and QUAY_LEASH - and because a PARCEL_VERSION bump to move seven
// harbour houses would move every house on the island with them.
//
// Version 1 was the move off the lake, and took the planks and the parcel with it.
// Version 2 moves the planks alone, off the bank and into the middle of their own water:
// see PIER_MIDDLE. The houses do not feel it, which is the whole reason the two steps are
// one number apart rather than one step.
export const QUAY_VERSION = 2;

// How far the quay's seed may sit from its own shore, in super-cells. `pickSeed` scores
// room at 100 a cell against 90 a ring, so an anchor on its own always loses to the open
// ground inland: a coastal super-cell is half water and has nothing like the room. On
// this island that put the quay eight super-cells - thirty-two cells - straight inland of
// the pier it belongs to, with the planks alone at the water. Two is the parcel's own
// radius at the size a quay reaches, so the seed may shift along the coast to find land
// but can never leave it.
const QUAY_LEASH = 2;

// Exported for lib/plan.mjs, which reads a replayed grid to judge where a hamlet may be
// set down - the one reader outside this file that has to speak the grid's own states.
export const FREE = 0, PLOT = 1, PATH = 2, BLOCKED = 3, SQUARE = 4, PIER = 5, RESERVED = 6, BRIDGE = 7;
// PITCH, blockOf, centreOfCell and superOf live in shared/lattice.mjs now: the browser's
// planner turns a dragged distance into a super-cell delta with the same arithmetic.
const MAX_RING = 9;

// ---- hamlets ----------------------------------------------------------------
// Land is owned. Every project that has grown past a couple of sessions holds a parcel
// of super-cells (see `latticeOf`), and no parcel may touch another - the gap between
// them is the countryside, which is where the fields and the orchards go.
export const NONE = -1, TOWN = -2;      // owner sentinels; a district uses its per-scan ordinal
export const BELT = 1;                  // no super-cell may be 8-adjacent to anyone else's
export const MIN_HAMLET = 3;     // sessions before a project earns a green and a sign
const RCAP = 5;                  // hard lobe radius: worst case house-to-green is 5*4+2
const MAX_LOBES = 3;             // a boxed-in hamlet founds an annex rather than sprawl
const ANNEX_REACH = 8;           // and that annex stays within sight of the parcel it left
const SOFT = 1500;               // growth penalty for creeping up on a neighbour
// Super-cells held by the town: plaza, civic lots, frontage. Exported because the viewer
// has to draw the same core the placement reserved, and it used to carry its own copy of
// the number in scan.mjs - two truths about one piece of ground.
export const TOWN_CORE_R = 2;
const COMMONS_HEADROOM = 8;      // spare cells so the commons is never grown into a corner
// How much of a hamlet is houses rather than garden. A young hamlet keeps a third of
// itself as kitchen gardens and orchards; a proper village densifies.
const FILL = (n) => (n < 10 ? 0.70 : n < 25 ? 0.80 : 0.90);
// The green counts as one cell, hence the +1. Never smaller than a nine-plot hamlet.
const parcelTarget = (n) => Math.max(4, 1 + Math.ceil(n / FILL(n)));
const tierOf = (n) => (n >= 12 ? 'village' : n >= MIN_HAMLET ? 'hamlet' : 'farmstead');
// How wide the town square is, by the number of settlers who have lived here. It stops
// at five: the civic lots begin three cells out, so anything wider starts biting chunks
// out of its own edges and the square stops reading as a rectangle. Past that the
// centre grows outward instead, by paving the frontage in front of each building.
export const SQUARE_STEPS = [{ at: 30, size: 5 }, { at: 90, size: 7 }];

// A brand-new island carries every version number it was planned under, the roads
// included. Leaving `roadV` off looks harmless - there are no roads to re-route - but
// `migrateRoads` then fires on the *second* scan of a freshly founded island and throws
// away `cleared`, so the layout of an island nobody touched is rewritten once for no
// reason. A scan of the same island must never change layout.json.
export function emptyLayout(seed, size) {
  return {
    v: LAYOUT_VERSION, parcelV: PARCEL_VERSION, squareV: SQUARE_VERSION, roadV: ROAD_VERSION,
    quayV: QUAY_VERSION,
    seed, size, terrainHash: null,
    lattice: null, districts: {}, plots: {}, paths: [], bridges: [], cleared: [], polders: [],
    fairway: null,
    // The island's harbours, one per side of the coast - see planHarbours. null, like the
    // fairway, means nobody has asked yet; a side with no harbour is a null in the list.
    harbours: null,
    landing: null, town: null,
    // Ground the keeper has said no to. See `zoneCells` and lib/plan.mjs.
    zones: [],
    // Roads the keeper drew by hand. See `replayKeeperRoads` and lib/plan.mjs.
    roads: [],
  };
}

// A one-time re-parcelling. Houses and sheds go back to being land and are laid out again
// on the new lattice; the town keeps every stone. Two of the five steps are worth a word:
//
//   `paths: []`   - markPath only records freshly paved cells, so a civic path can be a
//                   stub leaning on a trunk that a house path paved. Delete the house
//                   path on its own and the civic road breaks in the middle. A path is
//                   pure derived geometry that nothing stands on, so re-route them all.
//   `cleared: []` - otherwise ~1500 bald patches stay where the old lattice used to be:
//                   scars with nothing on them. This is a deliberate, one-time exception
//                   to "the forest never grows back" further down this file.
function migrateParcels(l) {
  if (l.parcelV === PARCEL_VERSION) return l;
  for (const id of Object.keys(l.plots)) {
    if (id.startsWith('house:') || id.startsWith('shed:')) delete l.plots[id];
  }
  l.shedOf = {};
  const keep = {};
  for (const [id, d] of Object.entries(l.districts)) {
    if (d.pier && d.pier.length) keep[id] = { pier: d.pier, shore: d.shore || null };   // real planks
  }
  l.districts = keep;
  l.paths = [];
  // The bridges stay. A path is geometry and is re-routed from nothing; a bridge is
  // built, so it is as sticky as a house - and because `routePath` enters one for almost
  // free, the roads laid on the new lattice will nearly always cross where they crossed
  // before. One left with no road on it is a bridge in the countryside, not a bug.
  l.cleared = [];
  if (l.town) { delete l.town.commons; delete l.town.paved; }
  l.lattice = null;
  l.parcelV = PARCEL_VERSION;
  return l;
}

export function loadLayout(file, seed, size) {
  const l = readJson(file, null);
  if (!l || l.v !== LAYOUT_VERSION || l.seed !== seed || l.size !== size) return emptyLayout(seed, size);
  l.districts = l.districts || {};
  l.plots = l.plots || {};
  l.paths = l.paths || [];
  l.bridges = l.bridges || [];
  l.cleared = l.cleared || [];
  l.polders = l.polders || [];
  l.roads = l.roads || [];
  // Deliberately `|| null` and not `|| { cells: [] }`: null is "nobody has ever asked",
  // which is what lets `placeAll` dredge an island that predates the dredger, while an
  // empty channel is "asked, and there was nothing to dig" and must never be asked again.
  l.fairway = l.fairway || null;
  // The same distinction for the harbours: null is "never planned", a list is "planned",
  // and a side that had no coast worth a pier is a null inside it.
  l.harbours = l.harbours || null;
  // An island planned before there were zones has none, and saying so once here is what
  // keeps the next scan from writing a layout.json that differs only by this key again.
  l.zones = l.zones || [];
  return migrateSquare(migrateRoads(migrateParcels(l)));
}

// A one-time re-routing of the hamlet roads. They used to leave from the edge of a green
// and stop at any square that was not their own, which meant a road could end at a
// neighbour's green and never reach the town at all - on this island twelve of
// twenty-three did. With the greens retired they leave from the lane and the only squares
// left are the town's own, so re-routing sends every one of them to the centre and puts
// each hamlet's gate on its own boundary where the sign can stand over it.
//
// `cleared` goes with them. It is the record of ground the forest never takes back, and
// it is rebuilt every scan from the plots and paths that exist - so dropping it lets the
// trees close over the old routes instead of leaving a bald line where each one ran.
// Nothing else is touched: not a plot, not a parcel, not the town.
//
// Version 3 is for the polders. A road was allowed to run along a sea wall and the stretch
// it ran was never recorded, so an island that already has a polder is carrying a road
// with a hole in it.
//
// It also takes the front paths with it, which version 2 did not, and that is the whole
// difference between a re-route that works and one that quietly cuts houses off. A front
// path is a stub that stops at the first stone it meets - usually the trunk road through
// the hamlet - and `markPath` records only the cells the stub itself paved. Throw the
// trunk away and re-route it somewhere else, and the stub is left ending in the grass,
// still on record and still passing every check that asks whether a house has a path.
// Measured on this island: eight of sixty-one houses could no longer walk to the square.
// So every path goes, the same way `migrateParcels` throws them all away and for the same
// reason - derived geometry that nothing stands on. The civic roads are relaid in
// `placeAll`, and so is any front path whose house has none.
function migrateRoads(l) {
  if (l.roadV === ROAD_VERSION) return l;
  clearRoads(l);
  l.roadV = ROAD_VERSION;
  return l;
}

// The same reset, callable on demand instead of gated behind a ROAD_VERSION bump - for
// `/roads delete`, which asks for exactly this: throw every road and path away and let the
// next `placeAll` lay them fresh from nothing, the way it already does for any lobe or
// house that has none. Safe to call whenever, in the sense a ROAD_VERSION bump already is:
// a road is "pure derived geometry that no building stands on" and nothing about the town
// depends on where one runs. Not a no-op, though, and not a route back to what was there -
// REUSE means a path routed after this reuses only what this pass has laid so far, and a
// clean grid reuses differently than one where most trunks already existed. Measured on a
// real island: 112 paths in, 105 out, several ids not the same ones - fewer, longer shared
// stretches rather than missing houses (`unplaced` stayed at 0 in that run). Leaves `roadV`
// alone: there is no version to migrate away from, only a reset to run.
export function clearRoads(l) {
  for (const d of Object.values(l.districts)) {
    for (const lobe of d.lobes || []) lobe.road = null;
  }
  l.paths = [];
  l.cleared = [];
  return l;
}

// A one-time re-planning of the quay, and of nothing else on the island.
//
// Two things were wrong with it, and they compounded. `terrain.coastCells` is every land
// cell with water beside it, and a river is water - so the river through the middle of
// town is "coast", and the picker's own `- dist(townCentre)` term made that bank the best
// shore on the island by a mile. Then the parcel: the seed was handed the shore as `near`,
// which `pickSeed` weighs against room, and room wins on any coast because half of a
// coastal super-cell is water. Measured here: planks at [117..121,124] on the riverbank
// six cells from the town square, and the harbour houses thirty-two cells inland of even
// those. A quay with no sea in sight, which is the one thing a quay may not be.
//
// `openWater` is the first fix and QUAY_LEASH the second; this is the island already
// carrying the old answer. The planks go with the parcel here, which the usual rule about
// built things would forbid - a pier up a river is not a pier that happens to be badly
// placed, it is a footbridge, and the boat that is supposed to lie alongside it arrives
// from the sea. Harbour houses are Cowork tasks, the shortest-lived settlers the island
// has, so what moves with it is the least sticky thing on the island.
//
// `cleared` gives the old ground back to the forest, the way `migrateRoads` does for a
// road it throws away, or the parcel would stay behind as a bald patch with nothing on it.
//
// It runs from `placeAll` rather than `loadLayout`, where the other migrations live,
// because it is the only one that has to ask the ground a question: whether those planks
// stand over the sea or over a river.
function migrateQuay(l, terrain, townCentre) {
  if (l.quayV === QUAY_VERSION) return l;
  const wasOnWater = (l.quayV || 0) >= 1;
  l.quayV = QUAY_VERSION;
  const q = l.districts && l.districts.quay;
  if (!q || !l.lattice) return l;

  // Version 2 only moves the planks. `pickPier` weighs how much water the head has either
  // side of it now, and this island's quay was picked before it did: the planks lay along
  // the east bank of their own bay with one cell of water on that side and six on the
  // other. Re-picking here rather than clearing the record and leaving the district loop
  // to do it, because that loop only runs for a district the village still has - scan the
  // island on a day with no Cowork task open and a quay with no planks is a quay that gets
  // swept away entirely.
  if (wasOnWater) {
    const found = pickPier(terrain, townCentre);
    if (found) { q.shore = found.shore; q.pier = found.pier; }
    return l;
  }

  // A pier that still reaches open water is a good pier and stays, houses and all.
  if ((q.pier || []).length && q.pier.every(([gx, gz]) => openWater(terrain, gx, gz))) return l;
  q.shore = null;
  q.pier = [];
  if (!(q.lobes || []).length) return l;

  const lat = l.lattice;
  const owned = new Set();
  for (const lobe of q.lobes) {
    for (const [i, j] of lobe.cells) {
      const [ax, az] = blockOf(lat, i, j);
      for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) owned.add(`${ax + x},${az + z}`);
    }
  }

  const dropped = new Set();
  for (const [id, p] of Object.entries(l.plots)) {
    if (!owned.has(`${p.gx},${p.gz}`)) continue;
    delete l.plots[id];
    dropped.add(id);
  }
  for (const [house, shed] of Object.entries(l.shedOf || {})) {
    if (dropped.has(house) || dropped.has(shed)) { delete l.shedOf[house]; }
  }
  l.paths = l.paths.filter((p) => !dropped.has(String(p.id).replace(/^path:/, '')));
  l.paths = l.paths.filter((p) => !String(p.id).startsWith('road:quay:'));
  l.cleared = l.cleared.filter(([gx, gz]) => !owned.has(`${gx},${gz}`));

  q.lobes = [];
  q.centre = null;
  q.square = null;
  q.paved = [];
  return l;
}

export function saveLayout(file, layout) { writeJsonAtomic(file, layout); }

function ringOffsets(r) {
  if (r === 0) return [[0, 0]];
  const out = [];
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) === r) out.push([dx, dz]);
    }
  }
  out.sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  return out;
}
const RINGS = Array.from({ length: MAX_RING + 1 }, (_, r) => ringOffsets(r));

// The eight cells of a yard, the four corners first. A shed takes the first one it can
// have, and where it lands decides how big the house beside it may be drawn: a house is
// drawn out to about one and a fifth cells from the middle of its plot, which reaches
// into the four side cells but not into the corners. Corners first therefore means a
// shed placed today does not have to be moved when the house is drawn bigger tomorrow -
// and a shed is a plot, so moving one is exactly what this file may never do. The order
// within each group is the ring's own, so the choice stays deterministic.
const YARD_RING = [...RINGS[1]].sort((a, b) => (a[0] && a[1] ? 0 : 1) - (b[0] && b[1] ? 0 : 1));

export class Grid {
  constructor(terrain) {
    this.t = terrain;
    this.size = terrain.size;
    this.cells = new Uint8Array(this.size * this.size);
    for (let gz = 0; gz < this.size; gz++) {
      for (let gx = 0; gx < this.size; gx++) {
        if (!terrain.isBuildable(gx, gz)) this.cells[gx + gz * this.size] = BLOCKED;
      }
    }
  }
  in(gx, gz) { return gx >= 0 && gz >= 0 && gx < this.size && gz < this.size; }
  get(gx, gz) { return this.in(gx, gz) ? this.cells[gx + gz * this.size] : BLOCKED; }
  set(gx, gz, v) { if (this.in(gx, gz)) this.cells[gx + gz * this.size] = v; }
  // The quay may build on the sandy shore, everyone else may not.
  freeCell(gx, gz, allowBeach) {
    if (!this.in(gx, gz)) return false;
    const v = this.cells[gx + gz * this.size];
    if (v === FREE) return true;
    if (v === BLOCKED && allowBeach && this.t.isLand(gx, gz) && this.t.slope(gx, gz) < 0.8) return true;
    return false;
  }
  freeBlock(gx, gz, w, d, allowBeach) {
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (!this.freeCell(gx + x, gz + z, allowBeach)) return false;
    return true;
  }
  fillBlock(gx, gz, w, d, v) {
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) this.set(gx + x, gz + z, v);
  }
}

function blockAt(centre, dx, dz) {
  // min corner of the 3x3 block at ring offset (dx,dz) around a district centre cell
  return [centre[0] - 1 + dx * PITCH, centre[1] - 1 + dz * PITCH];
}

// ---- the super-lattice ------------------------------------------------------
// One lattice for the whole island, anchored on the town centre, instead of a separate
// phase per district. That single change is what makes a parcel expressible as a region:
// super-cell (i,j) owns the sixteen cells [ax+4i .. +3] x [az+4j .. +3], with the 3x3
// plot at the min corner and the far row and column as its lane. Two things follow.
// Lane cells sit at x = ax+3 (mod 4) island-wide, so the lanes of neighbouring
// super-cells join into one grid graph and a parcel is always walkable. And a five-wide
// green centred on a super-cell spans ax+4i-1 .. +3, which is the plot plus one lane on
// each side - so it can never eat a neighbour's plot.
export function latticeOf(layout) {
  if (!layout.lattice) {
    layout.lattice = { anchor: [layout.town.centre[0] - 1, layout.town.centre[1] - 1], pitch: PITCH };
  }
  return layout.lattice;
}
// blockOf / centreOfCell / superOf: see shared/lattice.mjs.

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const sd2 = (a, b) => { const i = a[0] - b[0], j = a[1] - b[1]; return i * i + j * j; };
const scheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
// Every comparison in this file is an integer tuple. Floats would make the layout depend
// on rounding, and Math.hypot is allowed to be approximated - neither may decide a plot.
function lessTuple(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
  return false;
}

// ---- polders ----------------------------------------------------------------
// The island's escape valve. `gridSize` cannot grow - it is the terrain's own argument,
// so raising it moves the coast, fails the `size` check in loadLayout and resets the
// town square - and by around three hundred houses the buildable blocks are gone and new
// projects stop getting a hamlet at all. So the village takes land off the water instead.
//
// When: purely by settler count. The demand-driven variant is tempting, because
// `ensureParcel` already sets `rec.guest` for exactly "no room for this district" - but
// that answer only exists *after* the placement, while the terrain has to be built
// before it. Feeding it back would mean either reclaiming on the next scan - and then a
// second scan of the same island changes layout.json, which is the one thing that must
// never happen - or re-running the whole placement inside one scan. A settler count is a
// pure function of the model, so a rescan reclaims exactly the same land, and the ladder
// stays ahead of the shortage rather than chasing it.
export const POLDER_AT = 150;       // the first polder: the mill, and the land it drains
export const POLDER_EVERY = 25;     // one more for every this many settlers after that
const POLDER_SUPERS = 12;    // super-cells each: about eleven plots and a green
const POLDER_DEPTH = -1.2;   // no cell deeper than this is worth a dike
// Eight integer bearings. Which one a polder faces is the only thing the seed decides,
// and it is what keeps two islands from reclaiming the same corner of their water.
const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

export const poldersWanted = (settlers) =>
  (settlers < POLDER_AT ? 0 : 1 + Math.floor((settlers - POLDER_AT) / POLDER_EVERY));

const ckey = (c) => `${c[0]},${c[1]}`;
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Land the sea may keep: a super-cell entirely under shallow *water*. Whole super-cells,
// because a parcel is measured in them - reclaiming half of one gives the hamlets nothing
// they can use. Nothing that is already land is ever a candidate, which is what keeps
// reclamation off the island proper: an earlier polder and its dike are land by the time
// the next one is planned, so they exclude themselves.
//
// `dredged` is the one piece of water that is not the sea's to give back: the fairway is
// shallow by design, so a super-cell full of it reads as perfect polder ground, and the
// first polder after the dredging would quietly wall in the channel the village had just
// dug. The terrain alone cannot tell the two apart - both are water a metre deep - so the
// set is passed in from the layout, which knows which of it was a decision.
export function polderCandidate(terrain, lat, i, j, dredged) {
  const [gx, gz] = blockOf(lat, i, j);
  for (let z = 0; z < lat.pitch; z++) {
    for (let x = 0; x < lat.pitch; x++) {
      const cx = gx + x, cz = gz + z;
      if (!terrain.inGrid(cx, cz)) return false;
      if (!terrain.isWater(cx, cz)) return false;
      if (dredged.has(ckey([cx, cz]))) return false;
      if (terrain.heightAt(cx, cz) < POLDER_DEPTH) return false;
    }
  }
  return true;
}

// A polder has to join the island, or the houses on it get no road. The first one wades
// out from the shore; every one after that may also lean on a polder already standing,
// which by then is simply more shore.
export function touchesShore(terrain, lat, i, j) {
  const [gx, gz] = blockOf(lat, i, j);
  for (let z = -1; z <= lat.pitch; z++) {
    for (let x = -1; x <= lat.pitch; x++) {
      if (x >= 0 && x < lat.pitch && z >= 0 && z < lat.pitch) continue;
      if (terrain.isLand(gx + x, gz + z)) return true;
    }
  }
  return false;
}

// One polder: a blob of super-cells grown out from the shore, and the dike that holds
// the water off it. The causeway is added afterwards, once the dike is standing.
function planPolder(terrain, lat, layout) {
  const R = Math.ceil(terrain.size / lat.pitch) + 1;
  const town = superOf(lat, layout.town.centre[0], layout.town.centre[1]);
  const dir = DIRS8[makeRng(layout.seed).fork('polder').fork(String(layout.polders.length)).int(8)];

  // The seed cell: out along this polder's bearing, and as far along it as the shore
  // reaches. Every comparison is an integer tuple, so no rounding decides where land
  // appears.
  // Zoned water counts as dredged here: a no-build zone drawn over the shallows is the
  // keeper saying this stays sea, and the ladder must not wall it in on the next rung.
  const dredged = new Set([...((layout.fairway && layout.fairway.cells) || []), ...zoneCells(layout)].map(ckey));
  let seed = null, bk = null;
  for (let j = -R; j <= R; j++) {
    for (let i = -R; i <= R; i++) {
      if (!polderCandidate(terrain, lat, i, j, dredged)) continue;
      if (!touchesShore(terrain, lat, i, j)) continue;
      const key = [-((i - town[0]) * dir[0] + (j - town[1]) * dir[1]), sd2([i, j], town), j, i];
      if (bk === null || lessTuple(key, bk)) { bk = key; seed = [i, j]; }
    }
  }
  if (!seed) return null;

  // Grow four-connected, nearest the seed first, so the polder comes out a blob with one
  // dike around it rather than a finger of sea wall.
  const supers = [seed];
  const own = new Set([ckey(seed)]);
  while (supers.length < POLDER_SUPERS) {
    let best = null, bestKey = null;
    for (const [ci, cj] of supers) {
      for (const [di, dj] of N4) {
        const c = [ci + di, cj + dj];
        if (own.has(ckey(c))) continue;
        if (!polderCandidate(terrain, lat, c[0], c[1], dredged)) continue;
        const key = [sd2(c, seed), c[1], c[0]];
        if (bestKey === null || lessTuple(key, bestKey)) { bestKey = key; best = c; }
      }
    }
    if (!best) break;                    // the shallows run out; a smaller polder will do
    supers.push(best); own.add(ckey(best));
  }
  return polderFromSupers(terrain, lat, supers, seed);
}

// One polder from a given set of super-cells: its cells, and the dike that holds the water
// off them. `planPolder` grows the set; lib/plan.mjs is handed one by the keeper. Both end
// here, so a hand-drawn polder is walled exactly the way a planned one is.
export function polderFromSupers(terrain, lat, supers, seed = supers[0]) {
  const cells = [];
  const inPolder = new Set();
  for (const [i, j] of supers) {
    const [gx, gz] = blockOf(lat, i, j);
    for (let z = 0; z < lat.pitch; z++) {
      for (let x = 0; x < lat.pitch; x++) {
        cells.push([gx + x, gz + z]);
        inPolder.add(ckey([gx + x, gz + z]));
      }
    }
  }

  // The dike goes where there is water to keep out, and nowhere else: on the landward
  // side the island is already the dike. Eight-connected, so the sea cannot come in at a
  // corner. The test is `isLand` rather than `isWater` because the waterline is neither -
  // a cell whose mean is above sea level but which has one corner below it is exactly
  // where the sea gets in, so anything short of solid land gets a wall.
  const dike = [], onDike = new Set();
  for (const c of cells) {
    for (const [dx, dz] of N8) {
      const n = [c[0] + dx, c[1] + dz];
      const k = ckey(n);
      if (inPolder.has(k) || onDike.has(k)) continue;
      if (!terrain.inGrid(n[0], n[1]) || terrain.isLand(n[0], n[1])) continue;
      onDike.add(k); dike.push(n);
    }
  }

  return { supers, cells, dike, road: [], seed };
}

// Drain one polder into the layout: push it, fill the pools its wall cut off, rebuild the
// ground, and lay the causeway on the coast that results. Hands back the new terrain. The
// caller records the hash - `placeAll` does so after every polder of a scan, lib/plan.mjs
// straight after this - and that is the one thing about a polder that may not be forgotten.
export function digPolder(seed, size, layout, p) {
  const ground = () => makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway });
  let terrain = ground();
  // What the tide could already not reach before this wall went up - the lake, and any
  // pocket an earlier polder closed. Taken now, while the old coast still stands, so
  // that the difference below is the work of *this* polder and nothing else. Drain the
  // lake and the island loses the one piece of water it was born with.
  const alreadyStill = enclosedWater(terrain);
  layout.polders.push(p);
  terrain = ground();
  p.pools = [...enclosedWater(terrain)]
    .filter((k) => !alreadyStill.has(k))
    .map((k) => k.split(',').map(Number))
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);   // order decides nothing, but it is written to disk
  if (p.pools.length) terrain = ground();
  // After the pools, not before: filling them moves the shoreline the causeway has to
  // land on, and the whole point of routing it last is that it sees the coast that will
  // actually be there.
  p.road = causeway(terrain, p, layout.town.centre);
  return terrain;
}

// The ground a road can already reach: buildable cells four-connected to the town
// square. A causeway has to land on *this*, not merely on something buildable - the
// waterline throws off single buildable cells that are dead ends hemmed in by beach,
// and a polder wired to one of those is an island with a jetty to nowhere.
function mainland(terrain, from) {
  const seen = new Set([ckey(from)]);
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const [gx, gz] = q[h];
    for (const [dx, dz] of N4) {
      const n = [gx + dx, gz + dz];
      const k = ckey(n);
      if (seen.has(k) || !terrain.isBuildable(n[0], n[1])) continue;
      seen.add(k); q.push(n);
    }
  }
  return seen;
}

// The causeway. A polder meets the island at the waterline, and the waterline is beach:
// unbuildable, so BLOCKED, so `routePath` will not walk it and the new land would have
// no way into town. These are the cells between the works and the mainland - shortest
// walk over land, four-connected and breadth-first, so it comes out as short and as
// straight as the beach allows. placeAll lays them as path.
//
// This runs on the terrain *after* the dike is raised, not before: raising a wall moves
// the corners it shares with the shoreline beside it, and a cell that was buildable on
// the old coast can be over the slope limit on the new one. Judging the far end of the
// road against the coast that will actually be there is the whole point.
function causeway(terrain, polder, town) {
  const main = mainland(terrain, town);
  const skip = new Set([...polder.cells, ...polder.dike].map(ckey));
  const prev = new Map();
  const q = [];
  for (const c of [...polder.cells, ...polder.dike]) {
    for (const [dx, dz] of N4) {
      const n = [c[0] + dx, c[1] + dz];
      const k = ckey(n);
      if (skip.has(k) || prev.has(k)) continue;
      if (!terrain.isLand(n[0], n[1])) continue;
      prev.set(k, null); q.push(n);
    }
  }
  for (let head = 0; head < q.length; head++) {
    const cur = q[head];
    if (main.has(ckey(cur))) {
      const out = [];
      for (let c = cur; c; c = prev.get(ckey(c))) out.push(c);
      return out.reverse();
    }
    for (const [dx, dz] of N4) {
      const n = [cur[0] + dx, cur[1] + dz];
      const k = ckey(n);
      if (prev.has(k) || skip.has(k)) continue;
      if (!terrain.isLand(n[0], n[1])) continue;
      prev.set(k, cur); q.push(n);
    }
  }
  return q.slice(0, 1);      // no dry road out: pave the waterline and let the routing try
}

// Take as much land as this many settlers have earned, and hand back the coast that
// results - or null if nothing was reclaimed and the caller's terrain still stands. The
// terrain is rebuilt once per polder, because each one has to be planned against the
// island the one before it made: that is what lets a later polder lean on an earlier one
// as shore, and what lets a causeway see the dike it has to climb over.
function reclaim(seed, size, lat, layout, settlers) {
  const want = poldersWanted(settlers);
  // Land the keeper gave back to the sea (lib/plan.mjs `unpolder`) still counts as a rung
  // taken, or the scan after an un-poldering would dig the same coast up again.
  const rungs = () => layout.polders.length + (layout.poldersReturned || 0);
  if (rungs() >= want) return null;
  const ground = () => makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway });
  let terrain = ground();
  let changed = false;
  // A polder the keeper drained by hand counts as a rung: the ladder exists for capacity,
  // and land is land whoever took it. So an island with a manual polder waits one rung
  // longer for its first planned one.
  while (rungs() < want) {
    const p = planPolder(terrain, lat, layout);
    if (!p) break;                                   // the shallows are all reclaimed
    terrain = digPolder(seed, size, layout, p);
    changed = true;
  }
  return changed ? terrain : null;
}

// ---- zones -------------------------------------------------------------------
// Ground the keeper has said no to, in whole super-cells, kept in `layout.zones` as
// `[{ kind: 'no-build', supers: [[i, j], ...] }]`. The only kind so far is no-build, and it
// is enforced exactly the way a polder's dike is - held, so no parcel may contain the
// super-cell, and RESERVED on the cell grid, so no shed, civic, road or causeway lands on
// it - because the dike already proved that pair keeps every placer and the router off a
// piece of ground without a single new grid state. A zone changes no height and so has no
// hash; it is handed to nothing that builds ground. Nothing here ever plans one: the
// zones are written by lib/plan.mjs at the keeper's hand, and a scan only obeys them.
//
// Zones are for the countryside: lib/plan.mjs refuses one over owned or built ground,
// because RESERVED cells cut a hamlet's lanes and front paths (measured: three houses left
// with no way to town). Should one ever get in, plots are still stamped after the zones
// and win - the one thing a scan may never do is move a house.
export function zoneSupers(layout) {
  const out = [];
  for (const z of layout.zones || []) for (const c of z.supers || []) out.push(c);
  return out;
}
export function zoneCells(layout) {
  const lat = layout.lattice;
  if (!lat) return [];
  const out = [];
  for (const [i, j] of zoneSupers(layout)) {
    const [gx, gz] = blockOf(lat, i, j);
    for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) out.push([gx + x, gz + z]);
  }
  return out;
}
// Ground that exists but is not for sale, as `Super` wants it: the dike and the causeway
// of every polder, and every zoned cell. One function rather than the loop `placeAll` used
// to carry inline, because lib/plan.mjs builds a `Super` of its own to judge a move and
// has to hold back exactly what the scan will hold back, or the two disagree about a
// super-cell and a drop the planner allowed is one the next scan quietly builds around.
export function heldOf(layout) {
  const held = new Set();
  for (const p of layout.polders || []) {
    for (const c of [...(p.dike || []), ...(p.road || [])]) held.add(`${c[0]},${c[1]}`);
  }
  for (const c of zoneCells(layout)) held.add(`${c[0]},${c[1]}`);
  for (const h of layout.harbours || []) {
    if (!h) continue;
    for (const c of [...(h.pier || []), ...(h.slip || [])]) held.add(`${c[0]},${c[1]}`);
  }
  return held;
}

// ---- the fairway --------------------------------------------------------------
// The other half of the polders, and the reason this section sits next to them: a polder
// takes water off the island, a fairway takes ground off the sea, and both are a list of
// cells in the layout that `makeTerrain` reads. Sticky in exactly the same way - dug once,
// written down, never planned again - because a channel that moved when the generator was
// tuned would take the beacons standing in it with it.
//
// What it is for: a river reaches the sea over a bar. `riverCourse` stops where the beach
// begins and lets the sea do the rest, which keeps an estuary from eating the coastal flat
// - a good trade for the land and a bad one for a hull. On Promptholm what it leaves is a
// sill at z=102 whose ground sits between 0.00 and 0.06, floatable on paper and a sandbank
// in practice: measured from every bearing the open sea offers, a boat gets two cells up
// its own river and stops. The dredger takes that sill away and nothing else.
export const FAIRWAY_AT = 25;      // settlers before there are hands enough to dig it
const FAIRWAY_HALF = 2;            // half-width in cells: a channel five cells wide
const FAIRWAY_UP = 10;             // and how far up its own river the dredger works
const FAIRWAY_MAX = 60;            // centreline cells seaward; longer than this is a canal

// Sixteen bearings at 22.5 degrees, the same wheel the hill and the river mouths are
// placed on. A dredged approach is straight - it is a cut, not a course - so the whole
// search is "which way out costs the least spoil", and sixteen answers is plenty for a
// channel five cells wide.
const DIRS16 = [
  [1, 0], [0.9238795325112867, 0.3826834323650898], [0.7071067811865476, 0.7071067811865476], [0.3826834323650898, 0.9238795325112867],
  [0, 1], [-0.3826834323650898, 0.9238795325112867], [-0.7071067811865476, 0.7071067811865476], [-0.9238795325112867, 0.3826834323650898],
  [-1, 0], [-0.9238795325112867, -0.3826834323650898], [-0.7071067811865476, -0.7071067811865476], [-0.3826834323650898, -0.9238795325112867],
  [0, -1], [0.3826834323650898, -0.9238795325112867], [0.7071067811865476, -0.7071067811865476], [0.9238795325112867, -0.3826834323650898],
];

// Ground the dredger may not touch. Everything anybody built, and the town's own paving:
// a channel is planned on an island that already has houses on it, and the one outcome
// worth ruling out absolutely is a scan that drops somebody's front garden into the sea.
// Cheap to over-reserve here - the mouth of a river is the far end of the island from all
// of this on nearly every seed - and a fairway that comes out a cell narrower because a
// causeway was in the way is a fairway with a causeway beside it.
export function fairwayHeld(layout) {
  const held = new Set();
  const add = (gx, gz) => held.add(`${gx},${gz}`);
  for (const p of Object.values(layout.plots || {})) {
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) add(p.gx + x, p.gz + z);
  }
  for (const p of layout.paths || []) for (const c of p.cells) add(c[0], c[1]);
  for (const b of layout.bridges || []) for (const c of b.cells) add(c[0], c[1]);
  for (const p of layout.polders || []) {
    for (const c of [...(p.cells || []), ...(p.dike || []), ...(p.pools || []), ...(p.road || [])]) add(c[0], c[1]);
  }
  for (const d of Object.values(layout.districts || {})) for (const c of d.pier || []) add(c[0], c[1]);
  for (const c of (layout.town && layout.town.paved) || []) add(c[0], c[1]);
  if (layout.landing) add(layout.landing[0], layout.landing[1]);
  // And the keeper's zones: ground nothing may be built on is not ground to dredge either.
  for (const c of zoneCells(layout)) add(c[0], c[1]);
  return held;
}

// Where the dredger works, or null if this island has no river to open up. The answer is
// two straight-ish pieces: a cut from the mouth out to water that is already deep enough
// to need no digging, and the first stretch of the river itself, so the entrance is a
// funnel rather than a step. Both are widened to FAIRWAY_HALF, and every cell of the
// widening is checked on its own - the middle of the channel is guaranteed, the sides are
// whatever the coast allows, and a headland simply makes it narrower there.
export function planFairway(terrain, layout) {
  if (!terrain.rivers.length) return null;
  // The island's river, when it has two: the longer one. Both reach the sea, but the long
  // one is the one that comes from the hill and passes the town, and dredging the creek in
  // the corner would be a channel to nowhere.
  const course = terrain.rivers.reduce((a, b) => (b.length > a.length ? b : a));
  const size = terrain.size;
  const held = fairwayHeld(layout);
  const still = enclosedWater(terrain);
  // A cell the dredger may lift: inside the grid, nobody's, and not real ground. BEACH_MAX
  // is the ceiling because that is where the island stops calling something sand - a cut
  // through anything higher is a canal through a hillside, which is a different and much
  // larger idea than opening a river mouth.
  const free = (gx, gz) =>
    gx >= 0 && gz >= 0 && gx < size && gz < size
    && !held.has(ckey([gx, gz])) && terrain.heightAt(gx, gz) < BEACH_MAX;
  // Where a cut may stop: open sea, already deeper than the channel is dug to. `still`
  // rules out the lake and anything a dike has shut in, so a fairway can never end in a
  // pond on the wrong side of the island.
  const done = (gx, gz) =>
    terrain.isWater(gx, gz) && !still.has(ckey([gx, gz])) && terrain.heightAt(gx, gz) <= CHANNEL_H;

  const mouth = course[course.length - 1];
  let best = null;
  for (const [dx, dz] of DIRS16) {
    const line = [];
    let spoil = 0, reached = false;
    // Half a cell at a time, so a diagonal ray lands on the cells it actually crosses
    // rather than stepping over the corner between two of them - which is exactly where a
    // one-cell bar would survive the dredging and put the sandbank back.
    for (let s = 0.5; s <= FAIRWAY_MAX; s += 0.5) {
      const gx = Math.round(mouth[0] + dx * s), gz = Math.round(mouth[1] + dz * s);
      const k = ckey([gx, gz]);
      if (line.length && ckey(line[line.length - 1]) === k) continue;
      if (!free(gx, gz)) break;
      line.push([gx, gz]);
      spoil += Math.max(0, terrain.heightAt(gx, gz) - CHANNEL_H);
      if (done(gx, gz)) { reached = true; break; }
    }
    if (!reached) continue;
    // Spoil first, length second. A cut that lifts less sand is the one a village with
    // shovels would make, and where two bearings dig the same amount the shorter one wins
    // - which on an open coast is the one square out to sea.
    const score = spoil * 10 + line.length;
    if (!best || score < best.score) best = { score, line };
  }
  if (!best) return null;

  // Up the river from the mouth, so the dredged water meets the river's own without a
  // step. `course` runs source-first, so this is its tail read backwards.
  const inland = course.slice(Math.max(0, course.length - 1 - FAIRWAY_UP), course.length - 1).reverse();
  // Ordered from seaward in, which is the order a channel is buoyed in and therefore the
  // only order in which "port hand" means anything. The cut was surveyed outwards from the
  // mouth, so it is laid down backwards here and the mouth joins the two halves.
  const line = [...best.line].reverse();
  line.push(mouth);
  for (const c of inland) {
    if (!free(c[0], c[1])) break;    // a bridge, a quay, a house on the bank: stop there
    line.push(c);
  }
  // The ray may have rounded onto the mouth itself on its first half-step, and a beacon
  // pair standing twice in one place is two draw calls and a visible double stake.
  const seenLine = new Set();
  const centre = line.filter((c) => { const k = ckey(c); if (seenLine.has(k)) return false; seenLine.add(k); return true; });

  const cells = new Set();
  for (const [gx, gz] of centre) {
    for (let dz = -FAIRWAY_HALF; dz <= FAIRWAY_HALF; dz++) {
      for (let dx = -FAIRWAY_HALF; dx <= FAIRWAY_HALF; dx++) {
        if (dx * dx + dz * dz > FAIRWAY_HALF * FAIRWAY_HALF + 1) continue;   // round, not square
        if (free(gx + dx, gz + dz)) cells.add(ckey([gx + dx, gz + dz]));
      }
    }
  }
  const asCells = [...cells].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  // `line` is the centreline and decides nothing about the ground - it is there so the
  // beacons can be stood along the channel rather than worked out again from its cells,
  // which would put them in the middle of a pool where the cut meets the river.
  return { line: centre, cells: asCells };
}

// The water that cannot walk to the edge of the map. On a bare island that is the lake
// and nothing else; once a dike is up it is also whatever the wall shut off from the sea.
// Four-connected, like everything else that decides where land is, and a flood fill from
// the border rather than a search per pocket: one pass over the grid either way, and the
// border is the only place we know for certain is open sea.
function enclosedWater(terrain) {
  const size = terrain.size;
  const open = new Set();
  const q = [];
  const push = (x, z) => {
    if (x < 0 || z < 0 || x >= size || z >= size) return;
    const k = ckey([x, z]);
    if (open.has(k) || !terrain.isWater(x, z)) return;
    open.add(k); q.push([x, z]);
  };
  for (let i = 0; i < size; i++) { push(i, 0); push(i, size - 1); push(0, i); push(size - 1, i); }
  for (let h = 0; h < q.length; h++) {
    for (const [dx, dz] of N4) push(q[h][0] + dx, q[h][1] + dz);
  }
  const still = new Set();
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const k = ckey([x, z]);
      if (terrain.isWater(x, z) && !open.has(k)) still.add(k);
    }
  }
  return still;
}

export class Super {
  // `held` is ground that exists but is not for sale: the dike and the causeway of a
  // polder. Raised flat land is buildable as far as the terrain is concerned, so without
  // this a hamlet would happily put a house on top of its own sea wall.
  constructor(terrain, lat, held) {
    this.lat = lat;
    this.R = Math.ceil(terrain.size / lat.pitch) + 1;
    this.n = 2 * this.R + 1;
    const n2 = this.n * this.n;
    this.build = new Uint8Array(n2);      // all sixteen cells buildable
    this.beach = new Uint8Array(n2);      // all sixteen on land and gentle - the quay only
    this.slope = new Uint16Array(n2);     // mean slope x 1000, so it stays an integer
    this.held = held || null;
    this.owner = new Int16Array(n2).fill(NONE);
    for (let j = -this.R; j <= this.R; j++) {
      for (let i = -this.R; i <= this.R; i++) {
        const [gx, gz] = blockOf(lat, i, j);
        let build = 1, beach = 1, sum = 0;
        for (let z = 0; z < lat.pitch; z++) {
          for (let x = 0; x < lat.pitch; x++) {
            const cx = gx + x, cz = gz + z;
            const kept = held && held.has(`${cx},${cz}`);
            if (kept || !terrain.isBuildable(cx, cz)) build = 0;
            if (kept || !terrain.isLand(cx, cz) || terrain.slope(cx, cz) >= 0.8) beach = 0;
            sum += terrain.slope(cx, cz);
          }
        }
        const o = this.di(i, j);
        this.build[o] = build;
        this.beach[o] = beach;
        this.slope[o] = Math.min(65535, Math.round((sum / (lat.pitch * lat.pitch)) * 1000));
      }
    }
  }
  di(i, j) { return (i + this.R) + (j + this.R) * this.n; }
  heldBlock(i, j) {
    const [gx, gz] = blockOf(this.lat, i, j);
    for (let z = 0; z < this.lat.pitch; z++) {
      for (let x = 0; x < this.lat.pitch; x++) if (this.held.has(`${gx + x},${gz + z}`)) return true;
    }
    return false;
  }
  in(i, j) { return i >= -this.R && j >= -this.R && i <= this.R && j <= this.R; }
  at(i, j) { return this.in(i, j) ? this.owner[this.di(i, j)] : TOWN; }
  usable(i, j, allowBeach) {
    if (!this.in(i, j)) return false;
    const o = this.di(i, j);
    return !!(this.build[o] || (allowBeach && this.beach[o]));
  }
  // Anybody else's land within `r`. This one predicate is the entire green belt.
  foreignWithin(i, j, r, k) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const w = this.at(i + di, j + dj);
        if (w !== NONE && w !== k) return true;
      }
    }
    return false;
  }
  eligible(i, j, k, allowBeach) {
    if (!this.usable(i, j, allowBeach)) return false;
    if (this.owner[this.di(i, j)] !== NONE) return false;
    return !this.foreignWithin(i, j, BELT, k);
  }
  clearOf(i, j, r) { return !this.foreignWithin(i, j, r, NONE - 1000); }   // nobody at all nearby
  // The inverse of `claim`, for lib/plan.mjs alone: a hamlet that is about to be set down
  // somewhere else has to stop being in its own way first, or every destination that
  // overlaps where it stands today reads as somebody else's land. Nothing in a scan ever
  // gives land back - the register replays what is owned and only grows.
  release(i, j) { if (this.in(i, j)) this.owner[this.di(i, j)] = NONE; }
  // How much room a seed really has: a flood fill of eligible cells within the radius,
  // stopped as soon as it has seen enough. A square window would happily hand a big
  // hamlet a three-cell ledge on the coast.
  capacity(i, j, r, cap, k, allowBeach) {
    if (!this.eligible(i, j, k, allowBeach)) return 0;
    const seen = new Set([`${i},${j}`]);
    const q = [[i, j]];
    let n = 0;
    while (q.length && n < cap) {
      const [a, b] = q.pop();
      n++;
      for (const [di, dj] of N4) {
        const c = [a + di, b + dj];
        const key = `${c[0]},${c[1]}`;
        if (seen.has(key) || scheb(c, [i, j]) > r) continue;
        if (!this.eligible(c[0], c[1], k, allowBeach)) continue;
        seen.add(key); q.push(c);
      }
    }
    return n;
  }
  claim(i, j, k, grid) {
    this.owner[this.di(i, j)] = k;
    if (this.held && this.heldBlock(i, j)) return;   // never hand a dike back as ground
    // A beach block the quay took is blocked ground as far as the cell grid knows, and a
    // door on it would be unroutable. Hand those cells back as buildable.
    if (grid && !this.build[this.di(i, j)]) {
      const [gx, gz] = blockOf(this.lat, i, j);
      for (let z = 0; z < this.lat.pitch; z++) {
        for (let x = 0; x < this.lat.pitch; x++) {
          if (grid.get(gx + x, gz + z) === BLOCKED) grid.set(gx + x, gz + z, FREE);
        }
      }
    }
  }
}

const radiusOf = (tg) => Math.min(RCAP, Math.ceil((Math.sqrt(tg) - 1) / 2) + 2);

// Grow one lobe outward until it has `tg` cells or runs out of room. Four-connected, so a
// parcel never pinches to a diagonal, and capped at `radiusOf` so it stays a blob: without
// that cap the biggest district crept into an L and the furthest house ended up as far
// from its green as it is today.
function growParcel(sup, lobe, k, tg, allowBeach, grid) {
  const rr = radiusOf(tg);
  while (lobe.cells.length < tg) {
    const cand = new Map();
    for (const [ci, cj] of lobe.cells) {
      for (const [di, dj] of N4) {
        const a = ci + di, b = cj + dj;
        if (scheb([a, b], lobe.seed) > rr) continue;
        if (!sup.eligible(a, b, k, allowBeach)) continue;
        cand.set(`${a},${b}`, [a, b]);
      }
    }
    if (!cand.size) return false;                     // boxed in; the caller annexes
    let best = null, bk = null;
    for (const c of cand.values()) {
      const key = [
        sd2(c, lobe.seed) * 4096
        + sup.slope[sup.di(c[0], c[1])]
        + (sup.foreignWithin(c[0], c[1], BELT + 1, k) ? SOFT : 0),
        c[1], c[0],
      ];
      if (bk === null || lessTuple(key, bk)) { bk = key; best = c; }
    }
    lobe.cells.push(best);
    sup.claim(best[0], best[1], k, grid);
  }
  return true;
}

// Where a new hamlet settles. The rungs run from "room to grow with four rings of
// countryside around it" down to "anywhere legal", and the top of the ladder is what
// spreads the village over the island: the key below always takes the nearest legal
// cell, so as long as clearance is cheap every hamlet crowds the same ring around the
// town. Asking for four rings first pushes them apart until the island runs out, and
// the lower rungs are the fallback that still finds a berth for the thirtieth project.
// The last rung puts late arrivals on the far coast, which is where the free basins are,
// so a satellite hamlet needs no special case.
const SEED_LADDER = [[4, 1.25], [4, 1.0], [3, 1.0], [2, 1.0], [1, 1.0], [1, 0.35], [0, 0.0]];
// A lone farm is one house in the countryside, and it is seeded last - so it is the one
// thing that can afford to be fussy about where it lands: by then the hamlets have their
// parcels and what is left is the gaps between them, which is exactly where a farm
// belongs. Two rings, then one, then anywhere; asking for more than two carved 400 cells
// of island out for a single session and after nineteen of those the real hamlets had
// nowhere left to settle - measured.
const FARM_LADDER = [[2, 1.0], [1, 1.0], [0, 0.0]];

// Which of eight forty-five degree sectors a super-cell lies in, counted round from due
// east. Integer comparisons only, like everything else that decides a plot: an atan2
// would let a rounding move a hamlet.
function octant(i, j) {
  const ax = Math.abs(i), az = Math.abs(j);
  const diag = az > ax ? 1 : 0;                        // nearer the diagonal than the axis
  if (i > 0 && j >= 0) return 0 + diag;                // east, south-east
  if (i <= 0 && j > 0) return 2 + (ax > az ? 1 : 0);   // south, south-west
  if (i < 0 && j <= 0) return 4 + diag;                // west, north-west
  return 6 + (ax > az ? 1 : 0);                        // north, north-east
}
// How far apart two sectors are going round the compass, so sector 7 and sector 0 are
// neighbours rather than the width of the island apart.
function octDist(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 8 - d);
}
// The sector a district prefers, from its own name, so that two hamlets founded in the
// same scan do not both take the first free cell on the same side of town. Nought to four
// sectors away at 60 apiece, against 90 for a ring: a district gets the side of the
// island its name asks for whenever that costs it no distance from the centre, and gives
// it up rather than walk a ring further out. Without this the ladder above spreads the
// hamlets but the key still sorts by `j` then `i`, so they come out in a line.
const SECTOR = 60;

function pickSeed(sup, tg, { allowBeach = false, near = null, k = -99, maxFrom = 0, ladder = SEED_LADDER, id = null } = {}) {
  const rr = radiusOf(tg);
  const anchor = near || [0, 0];
  const want = id === null ? -1 : hash32(id) % 8;
  for (const [clear, slack] of ladder) {
    let best = null, bk = null;
    for (let j = -sup.R; j <= sup.R; j++) {
      for (let i = -sup.R; i <= sup.R; i++) {
        if (maxFrom && scheb([i, j], anchor) > maxFrom) continue;
        if (!sup.eligible(i, j, k, allowBeach)) continue;
        if (clear && !sup.clearOf(i, j, clear)) continue;
        const need = Math.max(1, Math.ceil(tg * slack));
        const room = sup.capacity(i, j, rr, need, k, allowBeach);
        if (room < need) continue;
        const sector = want < 0 ? 0 : SECTOR * octDist(octant(i, j), want);
        const key = [-(room * 100) + 90 * scheb([i, j], anchor) + sector + sup.slope[sup.di(i, j)], j, i];
        if (bk === null || lessTuple(key, bk)) { bk = key; best = [i, j]; }
      }
    }
    if (best) return best;
  }
  return null;
}

// The owned four-neighbour nearer the green. A door faces this, so it always opens onto a
// lane inside its own parcel - and for the eight cells ringing the green the parent *is*
// the green, so those houses front directly onto it and the streets radiate outward.
function parentOf(lobe, cell) {
  const own = new Set(lobe.cells.map((c) => `${c[0]},${c[1]}`));
  let best = null, bk = null;
  for (const [di, dj] of N4) {
    const c = [cell[0] + di, cell[1] + dj];
    if (!own.has(`${c[0]},${c[1]}`)) continue;
    const key = [sd2(c, lobe.seed), c[1], c[0]];
    if (bk === null || lessTuple(key, bk)) { bk = key; best = c; }
  }
  return best || lobe.seed;
}

const newLobe = (lat, seed) => ({
  seed, cells: [seed], green: 3, square: null, centre: centreOfCell(lat, seed), paved: [], road: null,
});

// Enough land for everyone who lives here, growing what the district already owns before
// claiming anything new. A lobe that is boxed in and still short does not sprawl: the
// district founds an annex with its own green and its own road, which is what a real
// settlement does and what keeps the radius cap meaningful.
function ensureParcel(sup, rec, pop, { k, allowBeach, near, grid, lat, id = null, leash = 0 }) {
  const capacity = () => rec.lobes.reduce((a, l) => a + l.cells.length - (l.green ? 1 : 0), 0);
  const tg = parcelTarget(pop);

  // A leash makes the anchor a requirement instead of a preference, and widens twice
  // before giving up: a coast with no room within two super-cells is still a coast, and a
  // quay that finds nowhere at all lodges its houses on the commons - which is further
  // from the water than any parcel it could have taken. The district's own sector goes
  // with the leash: it exists to keep two hamlets founded in the same scan off each
  // other's side of the island, and here it would only pull against the shore.
  const leashed = (want) => {
    for (const reach of [leash, leash * 2, 0]) {
      const seed = pickSeed(sup, want, { allowBeach, near, k, id: null, maxFrom: reach });
      if (seed) return seed;
    }
    return null;
  };

  if (!rec.lobes.length) {
    const seed = leash ? leashed(tg) : pickSeed(sup, tg, { allowBeach, near, k, id });
    if (!seed) { rec.guest = true; return; }
    sup.claim(seed[0], seed[1], k, grid);
    rec.lobes.push(newLobe(lat, seed));
  }

  let guard = 0;
  while (capacity() < pop && guard++ < 16) {
    const last = rec.lobes[rec.lobes.length - 1];
    const spentByOthers = capacity() - (last.cells.length - (last.green ? 1 : 0));
    const want = Math.max(tg - spentByOthers, last.cells.length + (pop - capacity()));
    if (growParcel(sup, last, k, want, allowBeach, grid)) continue;
    if (capacity() >= pop) break;
    if (rec.lobes.length >= MAX_LOBES) break;
    // An annex is the next hamlet along the same lane, so it is leashed to the parcel it
    // grew out of. Without the leash a boxed-in project scattered single cells across the
    // island - three "hamlets" of one house each, one of them on the opposite coast.
    // A leashed district annexes against its own anchor rather than against the lobe it
    // grew out of: the next stretch of quayside is still quayside, and leashing it to the
    // last lobe instead would let the quay walk inland one annex at a time. Measured
    // before this: first lobe on the beach with room for one house, the other six in an
    // annex thirty-three cells up the hill.
    const seed = leash
      ? leashed(parcelTarget(pop - capacity()))
      : pickSeed(sup, parcelTarget(pop - capacity()), { allowBeach, near: last.seed, k, maxFrom: ANNEX_REACH, id });
    if (!seed) break;
    sup.claim(seed[0], seed[1], k, grid);
    rec.lobes.push(newLobe(lat, seed));
  }
  rec.guest = capacity() < pop;      // the rest of this district lodges on the commons
}

// Which cell the next house takes: infill before the edge, then centre outward. Sorting
// interior cells first is what keeps a ring of gardens around any hamlet that is not
// full, and as the parcel grows yesterday's garden ring becomes today's infill with a
// new ring outside it. Nothing has to be reserved.
function parcelOrder(lobe) {
  const own = new Set(lobe.cells.map((c) => `${c[0]},${c[1]}`));
  const interior = (c) => (N4.every(([di, dj]) => own.has(`${c[0] + di},${c[1] + dj}`)) ? 0 : 1);
  return lobe.cells
    .filter((c) => lobe.green === 0 || c[0] !== lobe.seed[0] || c[1] !== lobe.seed[1])
    .sort((a, b) => interior(a) - interior(b) || sd2(a, lobe.seed) - sd2(b, lobe.seed) || a[1] - b[1] || a[0] - b[0]);
}

// Which side of the plot faces the district square: 0 = -z (north), 1 = +x, 2 = +z, 3 = -x.
export function facing(plotCentre, target) {
  const dx = target[0] - plotCentre[0], dz = target[1] - plotCentre[1];
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 1 : 3;
  return dz >= 0 ? 2 : 0;
}
export function doorCell(gx, gz, rot) {
  if (rot === 0) return [gx + 1, gz];
  if (rot === 1) return [gx + 2, gz + 1];
  if (rot === 2) return [gx + 1, gz + 2];
  return [gx, gz + 1];
}
// The cell a door opens onto, which is the one cell of a plot's surroundings that has to
// stay walkable: a front path starts here, and a shed standing on it walls the house in.
// Exported because tests/layout-measure.test.mjs asks whether every house can be reached,
// and a second copy of this convention would answer for the wrong doors as soon as one of
// them changed.
export function outsideDoor(gx, gz, rot) {
  if (rot === 0) return [gx + 1, gz - 1];
  if (rot === 1) return [gx + 3, gz + 1];
  if (rot === 2) return [gx + 1, gz + 3];
  return [gx - 1, gz + 1];
}

// A house has elbow room around its own door; a civic lot placed edge-to-edge against a
// neighbour does not, and `outsideDoor` only ever names the one cell it would use if the
// ground were empty. When a later building takes that cell (measured: `civic:townhall`
// boxing in `civic:castle`'s door on three sides, leaving zero walkable neighbours for
// `routePath` to expand into), nudge outward ring by ring until a walkable cell turns up,
// rather than leaving the lot with no road forever. Ungated: the ring the fix needed on the
// live island is 2, so the search stays cheap even where it never has to look.
function nearestWalkable(grid, [gx, gz], maxRing = 4) {
  const walkable = (v) => v === FREE || v === PATH || v === SQUARE;
  if (walkable(grid.get(gx, gz))) return [gx, gz];
  for (let r = 1; r <= maxRing; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (walkable(grid.get(gx + dx, gz + dz))) return [gx + dx, gz + dz];
      }
    }
  }
  return [gx, gz];
}

function flattestBlock(grid, cx, cz, { w = 3, d = 3, maxRing = 30, allowBeach = false } = {}) {
  let best = null, bestScore = Infinity;
  for (let r = 0; r <= maxRing; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const gx = cx + dx, gz = cz + dz;
        if (!grid.freeBlock(gx, gz, w, d, allowBeach)) continue;
        let s = 0;
        for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) s += grid.t.slope(gx + x, gz + z);
        if (s < bestScore) { bestScore = s; best = [gx, gz]; }
      }
    }
    if (best) return best;   // nearest ring wins, flattest within it
  }
  return null;
}

// Walk from a door all the way to a square. This is a weighted search rather than a
// flood fill, and the weights are what make the result look like a town: a cell that
// is already road costs almost nothing, so a new house would rather walk a long way
// round on an existing road than lay ten fresh cells of its own. Front paths therefore
// braid together into a handful of shared streets, one cell wide, instead of each
// house cutting its own line across the grass. Turning and climbing cost real
// distance, so a road goes round a slope rather than staircasing up it.
//
// Two of the weights are there to keep the result from looking like graph paper. A turn
// used to cost most of a cell, which meant that between two points on a grid the straight
// line always won and every road on the island ran due north or due east. That much was
// obvious; what took measuring is that making turns cheap on its own changes almost
// nothing. All the equally short routes between two points cost the same to the cell, so
// with nothing to choose between them the search still takes the one with fewest turns,
// and out comes the same L.
//
// What bends a road is the ground being worth more in one place than another, so the
// price of a *fresh* cell varies across the island: `WANDER` is a smooth noise field and
// a road follows the cheap ground through it. The two weights are read together - a turn
// has to be cheaper than the detour it buys - and it is the field's contrast, not the
// price of the turn, that decides how much a road wanders.
//
// Measured over eighteen islands, as the share of the turning a road had room for that it
// actually took: 0.06 at the old weights, 0.28 at these. Turns per cell of road is the
// tempting way to read this and it is nearly useless, because a road with a long leg and
// a short one cannot bend however it is weighted - see tests/layout-measure.test.mjs,
// which has the spread of both and is the thing to re-run after touching any of these
// four numbers. The mean slope a road puts up with is unchanged, so the detours go round
// rises as well as through cheap ground. Per-cell hashed noise was tried first and gives
// staircases rather than bends: the field has to be smooth, and its wavelength is what
// sets the size of a curve.
const REUSE = 0.04;       // a cell that is already road, or an existing bridge
const TURN = 0.2;         // changing direction
const SLOPE = 3;          // per unit of slope
const WANDER = 4.5;       // the dearest fresh cell costs this much more than the cheapest
const WANDER_SCALE = 0.11;   // and it turns over about every nine cells, which is a curve
// A fresh cell of deck. A river never quite severs the island - you can always walk
// around its head - so this is not a wall but a price: a three cell crossing is worth
// building once the way round is more than about twenty cells of road, and never for the
// sake of a shortcut. An existing crossing costs REUSE instead, so it is always the
// cheaper answer, which is what makes hamlet after hamlet come over the same bridge.
//
// Priced in cells of ordinary road rather than written down flat, because fresh ground is
// no longer worth one apiece: with WANDER in the price a cell costs 1 to 1 + WANDER, so
// `1 + WANDER / 2` is what the average cell of new road comes to. Left at a flat eight a
// road would sooner build a deck than walk round the head of a stream it had walked round
// for twenty releases - and the same number would mean something different again the next
// time somebody tunes the field. Eight cells of walking per cell of deck is the rule; the
// arithmetic keeps it true.
// Written as a product rather than as one number because both halves are used: the eight
// is "cells of walking per cell of deck", which is the rule, and `planBridge` measures a
// candidate crossing against that same eight in plain cells. Two copies of the rule is
// how a tuning of one of them quietly stops agreeing with the other.
const SPAN_WORTH = 8;
const SPAN = SPAN_WORTH * (1 + WANDER / 2);
const MAX_SPAN = 5;       // longer than this is a causeway, not a bridge
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NODIR = 4;          // the state we start in, before the first step

// How many cells a straight run from (gx,gz) in direction `d` has to carry before it is
// back on ground a road can use; 0 if it never gets there, or if there is no river under
// it. What a bridge spans is everything that is not land, which is wider than the water:
// a cell four-adjacent to a flooded one shares two of its corners, so the lip of the
// valley is never land either and a deck that stopped at the water's edge would end in
// mid-air. Hence also MAX_SPAN: the narrow reaches cross in three cells, and the estuary
// does not cross at all.
function crossingSpan(grid, gx, gz, d) {
  let wet = false;
  for (let n = 0; n < MAX_SPAN; n++) {
    const x = gx + DIRS[d][0] * n, z = gz + DIRS[d][1] * n;
    if (!grid.in(x, z)) return 0;
    if (grid.t.isRiver(x, z)) wet = true;
    const ax = gx + DIRS[d][0] * (n + 1), az = gz + DIRS[d][1] * (n + 1);
    if (!grid.in(ax, az)) return 0;
    if (!grid.t.isLand(ax, az)) continue;
    const v = grid.get(ax, az);
    const landing = v === FREE || v === PATH || v === SQUARE || v === BRIDGE;
    return wet && landing ? n + 1 : 0;
  }
  return 0;
}

class Heap {
  constructor() { this.c = []; this.v = []; }
  get size() { return this.v.length; }
  push(cost, val) {
    const c = this.c, v = this.v;
    let i = c.length;
    c.push(cost); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (c[p] <= c[i]) break;
      [c[p], c[i]] = [c[i], c[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p;
    }
  }
  pop() {
    const c = this.c, v = this.v;
    const top = v[0], tc = c[0];
    const lc = c.pop(), lv = v.pop();
    if (c.length) {
      c[0] = lc; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < c.length && c[l] < c[s]) s = l;
        if (r < c.length && c[r] < c[s]) s = r;
        if (s === i) break;
        [c[s], c[i]] = [c[i], c[s]]; [v[s], v[i]] = [v[i], v[s]]; i = s;
      }
    }
    return [tc, top];
  }
}

// What a fresh cell of road costs here, over and above the one cell it is. A smooth noise
// field, so neighbouring cells cost almost the same and a road that leaves the straight
// line keeps going that way for a while instead of stepping back - a bend rather than a
// staircase. The wavelength is about nine cells, which is the size of the curves you see.
//
// Cached per cell on the grid beside the search scratch, and for the same reason: the
// field is a pure function of the cell and a scan runs hundreds of searches over it.
function wanderCost(grid, gx, gz) {
  let f = grid.wander;
  if (!f) {
    const noise = makeSimplex2D(hash32(`${grid.t.seed}:wander`));
    f = grid.wander = { noise, cost: new Float32Array(grid.size * grid.size).fill(-1) };
  }
  const i = gx + gz * grid.size;
  let v = f.cost[i];
  if (v < 0) {
    // Never below nought, so that -1 can mean "not worked out yet" and so that no step
    // of the search is ever free - a road is always cheaper for having one cell less.
    const n = fbm2(f.noise, gx * WANDER_SCALE, gz * WANDER_SCALE, { octaves: 2 });
    v = Math.max(0, WANDER * (0.5 + 0.5 * n));
    f.cost[i] = v;
  }
  return v;
}

// One search costs a few hundred kilobytes of scratch; a full scan runs hundreds of
// them, so the buffers live on the grid and a generation counter stands in for wiping.
function scratch(grid) {
  const n = grid.size * grid.size * 5;
  if (!grid.route || grid.route.cost.length !== n) {
    grid.route = { cost: new Float32Array(n), prev: new Int32Array(n), gen: new Int32Array(n), now: 0 };
  }
  grid.route.now++;
  return grid.route;
}

// `isGoal` says what the walk is looking for: any paved cell for a front path, the town's
// own square for a hamlet road - which is what makes the road leave rather than stop at
// the first stone it meets. `budget` is a cap on the search, not on the road: a front
// path of a dozen cells and a country road across the island are the same code.
function routePath(grid, from, { isGoal = null, budget = 40000, bridge = false } = {}) {
  if (!grid.in(from[0], from[1])) return null;
  const size = grid.size;
  const start = from[0] + from[1] * size;
  const { cost, prev, gen, now } = scratch(grid);
  const heap = new Heap();
  const s0 = start * 5 + NODIR;
  cost[s0] = 0; prev[s0] = -1; gen[s0] = now;
  heap.push(0, s0);
  const goal = isGoal || ((cell, v) => v === SQUARE);

  let pops = 0;
  while (heap.size && pops++ < budget) {
    const [c, state] = heap.pop();
    if (c > cost[state]) continue;
    const cell = (state / 5) | 0, dir = state % 5;
    const cx = cell % size, cz = (cell - cx) / size;
    const here = grid.cells[cell];
    // On a deck there is nowhere to turn, so a bridge comes out straight and at right
    // angles to the water instead of wandering off down the middle of the river.
    const onDeck = here === BRIDGE || (bridge && !grid.t.isLand(cx, cz));
    if (goal(cell, here) && cell !== start) {
      const cells = [];
      for (let s = state; s !== -1; s = prev[s]) {
        const k = (s / 5) | 0, kx = k % size;
        cells.push([kx, (k - kx) / size]);
      }
      cells.reverse();
      return cells;
    }
    for (let d = 0; d < 4; d++) {
      if (onDeck && dir !== NODIR && d !== dir) continue;
      const nx = cx + DIRS[d][0], nz = cz + DIRS[d][1];
      if (!grid.in(nx, nz)) continue;
      const ncell = nx + nz * size;
      const nv = grid.cells[ncell];
      // A crossing that has to be built: only over a river, only in a straight line, and
      // only where the far bank is close enough and free. The price is what makes a road
      // walk a long way round rather than build, and what makes the next road walk the
      // long way round to a bridge that is already there - the same rule as REUSE.
      let fresh = false;
      if (nv !== FREE && nv !== PATH && nv !== SQUARE && nv !== BRIDGE) {
        if (!bridge || dir === NODIR) continue;
        if (nv !== BLOCKED || grid.t.isLand(nx, nz)) continue;
        if (!crossingSpan(grid, nx, nz, d)) continue;
        fresh = true;
      }
      // The wander field is only on the price of *fresh* ground. A cell that is already
      // road costs REUSE whatever the noise says - that is what braids the front paths
      // into a handful of lanes - and a deck is priced by the span it has to carry.
      const nc = c
        + (fresh ? SPAN : nv === PATH || nv === SQUARE || nv === BRIDGE ? REUSE : 1 + wanderCost(grid, nx, nz))
        + (fresh || nv === BRIDGE ? 0 : SLOPE * grid.t.slope(nx, nz))
        + (dir !== NODIR && dir !== d ? TURN : 0);
      const ns = ncell * 5 + d;
      if (gen[ns] === now && nc >= cost[ns]) continue;
      gen[ns] = now; cost[ns] = nc; prev[ns] = state;
      // Push what the array actually stored, not `nc`. `cost` is a Float32Array, so it
      // rounds; the heap holds float64. Pushing the unrounded value makes the staleness
      // test above (`c > cost[state]`) fire on the rounding difference and throw away a
      // perfectly good step, which silently truncates the search - a hamlet road died
      // after two cells with a heap that had simply been emptied of valid states.
      heap.push(cost[ns], ns);
    }
  }
  return null;
}

// Only the cells this route actually paves are recorded. The stretch it shares with
// roads that already existed is theirs to draw, so nothing is stored, or drawn, twice.
// The square it ends on is the exception: that cell is drawn as a doorstep, so the road
// visibly arrives somewhere instead of stopping a cell short of it.
export function markPath(grid, layout, id, cells) {
  if (!cells || cells.length === 0) return;
  const fresh = [];
  for (const [gx, gz] of cells) {
    const v = grid.get(gx, gz);
    if (v === SQUARE) { fresh.push([gx, gz]); continue; }
    // A deck draws itself and is walked from `bridges`, so it is not road surface. Left
    // in, every crossing would get a stone track laid over the open water as well.
    if (v === BRIDGE) continue;
    if (v !== FREE) continue;
    grid.set(gx, gz, PATH);
    fresh.push([gx, gz]);
  }
  if (!fresh.length) return;
  // One id, one stretch of road. A second entry under a name that is already in the list
  // reads as two roads to everything downstream, and a deck that silted up and became road
  // would arrive under the name of the road it belongs to.
  const had = layout.paths.find((p) => p.id === id);
  if (had) had.cells.push(...fresh);
  else layout.paths.push({ id, cells: fresh });
}

// The same, for a route that was allowed to cross water. Everything the route carried
// over the gorge becomes a bridge and is written into the layout, so it is there on the
// next scan whoever laid it; the rest is road as usual. A run the route only walked over
// - somebody else's bridge - is left alone, exactly as a shared stretch of road is.
export function markRoad(grid, layout, id, cells) {
  if (!cells || cells.length === 0) return;
  let span = null;
  const flush = () => {
    if (!span) return;
    const a = span[0], b = span[span.length - 1];
    layout.bridges.push({ id, axis: a[1] === b[1] ? 'x' : 'z', cells: span });
    for (const [gx, gz] of span) grid.set(gx, gz, BRIDGE);
    span = null;
  };
  for (const [gx, gz] of cells) {
    if (grid.get(gx, gz) === BLOCKED && !grid.t.isLand(gx, gz)) {
      span = span || [];
      span.push([gx, gz]);
      continue;
    }
    flush();
  }
  flush();
  markPath(grid, layout, id, cells);
}

// ---- the roads the keeper drew --------------------------------------------------------
// A road drawn in the planner (the `road` op in lib/plan.mjs) is recorded twice: once as
// what it paved, in `layout.paths` and `layout.bridges` like any road `markRoad` lays, and
// once whole, in `layout.roads`, because `clearRoads` and a ROAD_VERSION bump throw every
// path away and re-route them from the doors - and nothing routes a road nobody's door
// asked for. So on every scan: a keeper road still on record in `layout.paths` is left to
// the ordinary replay above, and one that is not is paved again from its own cells. Its
// decks never went anywhere - `clearRoads` keeps the bridges - so only the land is laid.
// Called after the plots and the bridges are on the grid and before any road is routed,
// so the hamlet roads braid onto it the way they braid onto each other.
function replayKeeperRoads(grid, layout) {
  for (const r of layout.roads || []) {
    if (layout.paths.some((p) => p.id === r.id)) continue;
    markPath(grid, layout, r.id, r.cells);
  }
}

// ---- the crossing the village builds on purpose -------------------------------------
// How many settlers before the village throws a bridge over the river. The same number as
// the `bridge` rung in lib/village.mjs, and the town square's own: SQUARE_STEPS stops
// widening the plaza at ninety, so that is the scan on which the centre stops growing
// outward and the village starts reaching across the water instead.
export const BRIDGE_AT = 90;
// One crossing, under the name of the rung that earned it. `markRoad` writes it into
// `layout.bridges` under this id, scan.mjs dates it by this id, and the stone at its head
// is the plot of the same name.
const BRIDGE_ID = 'civic:bridge';

// Every reach the island could carry a deck over, as the cell grid sees it.
//
// A reach is a straight run of water with at least one river cell in it, no longer than
// MAX_SPAN, with ground a road may use at both ends - which is `crossingSpan`'s own
// question, asked here from the water rather than from a route that happened to arrive at
// it. Walking the river cells rather than the whole island is what keeps it cheap: three
// hundred cells and four directions against thirty thousand, and it is asked once in the
// life of an island.
//
// Two refusals on top of `crossingSpan`'s. Every cell of the deck has to be untouched
// water, because `markRoad` only turns a cell into a bridge where it finds BLOCKED and
// wet - a span with a causeway or a pier partway across it would come out as a crossing
// with a hole in the middle. And no cell of it may lie in the dredged fairway: that
// channel was cut so a boat can come up to the town, and a deck over it is a bridge that
// closes the river it crosses. Shallow water reads to this search exactly like a narrow
// reach, which is the same trap `polderCandidate` has to sidestep from the other side.
function bridgeReaches(grid, layout, quay = new Set()) {
  const channel = new Set(((layout.fairway && layout.fairway.cells) || []).map((c) => `${c[0]},${c[1]}`));
  const usable = (gx, gz) => {
    const v = grid.get(gx, gz);
    return v === FREE || v === PATH || v === SQUARE;
  };
  const seen = new Set();
  const out = [];
  for (const [rx, rz] of grid.t.riverCells) {
    for (let d = 0; d < 4; d++) {
      const [dx, dz] = DIRS[d];
      const back = [rx - dx, rz - dz];
      if (!grid.t.isLand(back[0], back[1]) || !usable(back[0], back[1])) continue;
      const n = crossingSpan(grid, rx, rz, d);
      if (!n) continue;
      const cells = [];
      let clear = true;
      for (let i = 0; i < n; i++) {
        const c = [rx + dx * i, rz + dz * i];
        if (grid.get(c[0], c[1]) !== BLOCKED || grid.t.isLand(c[0], c[1])) clear = false;
        if (channel.has(`${c[0]},${c[1]}`)) clear = false;
        cells.push(c);
      }
      if (!clear) continue;
      // Nor anywhere at the quay - see `quayGround`.
      const ends = [back, [rx + dx * n, rz + dz * n]];
      if (nearQuay([...cells, ...ends], quay)) continue;
      // The same run found again from its far bank is the same bridge, not a second one.
      const key = cells.map((c) => `${c[0]},${c[1]}`).sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ cells, axis: dx ? 'x' : 'z', ends });
    }
  }
  return out;
}

// How far every cell is from the town square over ground a road may use, in cells, and -1
// where no road could ever get there. One flood fill answers for every reach at once, and
// it is the question that decides which crossing is worth building: every road on this
// island runs to the square, so what a bridge is worth is what it takes off that walk for
// whoever ends up on the far bank.
//
// Cells rather than `routePath` cost, deliberately. The price of a cell of road carries
// the wander field and the slope, which are what bend a road and have nothing to say
// about whether a crossing is worth building at all; and one Dijkstra per candidate over
// the whole island would cost more than the rest of the scan put together.
function roadReach(grid, layout) {
  const size = grid.size;
  const out = new Int32Array(size * size).fill(-1);
  const q = [];
  for (const [gx, gz] of layout.town.paved || []) {
    if (!grid.in(gx, gz) || out[gx + gz * size] >= 0) continue;
    out[gx + gz * size] = 0;
    q.push([gx, gz]);
  }
  for (let h = 0; h < q.length; h++) {
    const [x, z] = q[h];
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (!grid.in(nx, nz) || out[nx + nz * size] >= 0) continue;
      const v = grid.get(nx, nz);
      // A deck is road. Leaving BRIDGE out of this was the first version and it put the
      // village's crossing one cell from a crossing a hamlet road had already built:
      // treated as impassable, the far bank of the reach beside it came back unreachable,
      // which scores as the best a crossing can possibly do. Measured on seed 7 at size
      // 128 - two bridges over the same river, side by side.
      if (v !== FREE && v !== PATH && v !== SQUARE && v !== BRIDGE) continue;
      out[nx + nz * size] = out[x + z * size] + 1;
      q.push([nx, nz]);
    }
  }
  return out;
}

// The two cells a deck lands on, one step past each end of the run it recorded.
function deckEnds(b) {
  const k = b.axis === 'x' ? 0 : 1;
  const a = b.cells[0], z = b.cells[b.cells.length - 1];
  const step = Math.sign(z[k] - a[k]) || 1;          // a one-cell deck has no direction of its own
  const lo = [...a], hi = [...z];
  lo[k] -= step; hi[k] += step;
  return [lo, hi];
}

// Every cell the quay stands on: the blocks of its parcel, its planks, its pier, the road
// it has into town and the plot of every house on it (a quay that found no shore lodges
// them on the commons, which is outside the parcel). The crossing keeps off all of it, and
// off every cell beside it.
//
// The village's bridge is the town reaching across the river, and the quay is where a
// boat comes in - two different ways onto the island, and the one must not be built as an
// approach to the other. That is what the first version did on Promptholm on the scan it
// reached ninety: the deck itself stood well upriver, but the road it laid on the town
// side went to "the first paving it meets", which was the quay's own street, and ran
// forty-odd cells along the waterfront to meet it. `rec.deck` is the previous scan's
// (it is derived after this runs) and is read here as it stands, because a plank laid
// last scan is still a plank.
function quayGround(layout, lat) {
  const out = new Set();
  const add = (c) => { if (c) out.add(`${c[0]},${c[1]}`); };
  // By id and by pier: the model calls it `quay`, and a district with planks of its own
  // is a quay whatever it is called (scan.mjs keeps exactly those when their last session
  // has gone).
  for (const [id, rec] of Object.entries(layout.districts || {})) {
    if (!rec || (id !== 'quay' && !(rec.pier || []).length)) continue;
    for (const lobe of rec.lobes || []) {
      for (const [i, j] of lobe.cells || []) {
        const [gx, gz] = blockOf(lat, i, j);
        for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) add([gx + x, gz + z]);
      }
    }
    for (const c of rec.pier || []) add(c);
    for (const c of rec.deck || []) add(c);
    // And the quay's own road into town. Without it the second try went round the planks
    // and met that road instead, two cells short of them - the same approach to the quay,
    // arriving by its front gate rather than over its waterfront.
    for (const p of layout.paths) {
      if (String(p.id).startsWith(`road:${id}:`)) for (const c of p.cells) add(c);
    }
  }
  for (const p of Object.values(layout.plots)) {
    if (!p.quay) continue;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) add([p.gx + x, p.gz + z]);
  }
  return out;
}

// On the quay or beside it. Beside counts, because a road on the next cell over is a road
// a settler steps off onto the planks from.
function nearQuay(cells, quay) {
  if (!quay.size) return false;
  for (const [gx, gz] of cells) {
    if (quay.has(`${gx},${gz}`)) return true;
    for (const [dx, dz] of DIRS) if (quay.has(`${gx + dx},${gz + dz}`)) return true;
  }
  return false;
}

// Takes the village's crossing up again so the next lines can lay it somewhere else: its
// stone, its own road and - if the village built it rather than adopting one - its deck.
// The only thing on the island that is ever taken up, and only for the one reason
// `planBridge` gives. Nothing else leans on it: a later road that came over the deck
// braided onto cells `markPath` did not record for it, which stay road here because they
// are somebody else's. What is left is cleared ground, and the forest never grows back.
function unlayBridge(grid, layout) {
  const stone = layout.plots[BRIDGE_ID];
  if (stone && grid.get(stone.gx, stone.gz) === PLOT) grid.set(stone.gx, stone.gz, FREE);
  delete layout.plots[BRIDGE_ID];
  const road = layout.paths.find((p) => p.id === `path:${BRIDGE_ID}`);
  layout.paths = layout.paths.filter((p) => p.id !== `path:${BRIDGE_ID}`);
  // A cell another record also holds stays road: it is that road's as much as this one's.
  const kept = new Set(layout.paths.flatMap((p) => p.cells.map((c) => `${c[0]},${c[1]}`)));
  for (const [gx, gz] of (road && road.cells) || []) {
    if (grid.get(gx, gz) === PATH && !kept.has(`${gx},${gz}`)) grid.set(gx, gz, FREE);
  }
  for (const b of layout.bridges) {
    if (b.id !== BRIDGE_ID) continue;
    for (const [gx, gz] of b.cells) if (grid.get(gx, gz) === BRIDGE) grid.set(gx, gz, BLOCKED);
  }
  layout.bridges = layout.bridges.filter((b) => b.id !== BRIDGE_ID);
}

// The bridge the village builds when it has earned one - the only piece of road on this
// island that is decided rather than priced.
//
// Every other crossing is a by-product: `routePath` may cross water for SPAN a cell and a
// hamlet road takes that bargain when the way round is longer. On plenty of islands it
// does. Measured on Promptholm it never has and never will, because every project on it
// lives on the town's own bank - so there is no route that wants the far side and nothing
// to bend, and making a deck cheaper changes nothing at all. (Cutting SPAN from
// twenty-six to a half still built nought bridges.) A rung that waited for one would tick
// and leave the river exactly as it found it.
//
// Laid after the hamlet roads and never with the other milestones, because a bridge is a
// road. Run from the milestone loop it would go up before there was a lane on the island
// to join, and come out as a deck in the countryside with nothing leading to it.
//
// Three things in order: pick the reach, lay the deck, lay a road onto it from each bank.
// From then on those cells are BRIDGE, which `routePath` walks for REUSE - so the next
// road that wants the far bank comes over this one instead of buying its own.
//
// And one thing it will not do, which is build where the island is already crossed: see
// the `else` below. Measured over thirty islands (ten seeds at three sizes) - ten build a
// crossing of their own, eleven adopt one their roads had already thrown up, and nine have
// no reach a deck can carry and go without, the way the polder mill goes without shallows.
function planBridge(grid, layout, townCentre, unplaced, lat) {
  const quay = quayGround(layout, lat);
  // A crossing laid before the quay was off limits is taken up and laid again. Checked on
  // every scan rather than behind a version number, because the question is one lookup
  // and the answer is "no" on every island that was never wrong - and an island that is
  // wrong, whoever's, mends itself on its next scan instead of waiting for a bump.
  if (layout.plots[BRIDGE_ID]) {
    const stone = layout.plots[BRIDGE_ID];
    const own = layout.bridges.find((b) => b.id === BRIDGE_ID);
    const road = layout.paths.find((p) => p.id === `path:${BRIDGE_ID}`);
    const cells = [[stone.gx, stone.gz], ...((own && own.cells) || []), ...((road && road.cells) || [])];
    if (!nearQuay(cells, quay)) return;                // the rung already has its stone
    unlayBridge(grid, layout);
  }

  // What a crossing is worth is measured on the island as it is, quay and all, and before
  // the mask below goes on. Measured with the quay masked, a far bank the quay's road
  // already reaches came back unreachable - the best score there is - and seed 42 at 128,
  // whose one crossing is the one on the quay's road, put a second deck up two cells
  // beside it: the very thing the adopting `else` in `layBridge` exists to stop.
  const reach = roadReach(grid, layout);

  // The quay is ground the crossing may not use, for the length of this function: a road
  // searched for from the town bank would otherwise stop on the quay's street.
  // Put back on the way out, whichever way that is.
  //
  // With the same one-cell margin `nearQuay` counts, and that is load-bearing: a road
  // laid to a cell beside the quay would be taken up again by the check above on the
  // next scan, laid again, and the crossing would be re-planned on every scan for ever.
  const masked = [];
  const seen = new Set();
  for (const k of quay) {
    const [qx, qz] = k.split(',').map(Number);
    for (const [dx, dz] of [[0, 0], ...DIRS]) {
      const gx = qx + dx, gz = qz + dz;
      if (!grid.in(gx, gz) || seen.has(`${gx},${gz}`)) continue;
      seen.add(`${gx},${gz}`);
      masked.push([gx, gz, grid.get(gx, gz)]);
      grid.set(gx, gz, BLOCKED);
    }
  }
  try {
    layBridge(grid, layout, townCentre, unplaced, quay, reach);
  } finally {
    for (const [gx, gz, v] of masked) grid.set(gx, gz, v);
  }
}

function layBridge(grid, layout, townCentre, unplaced, quay, reach) {
  const size = grid.size;
  const walk = (c) => { const d = grid.in(c[0], c[1]) ? reach[c[0] + c[1] * size] : -1; return d < 0 ? Infinity : d; };

  let deck = layout.bridges.find((b) => b.id === BRIDGE_ID);
  if (!deck) {
    let best = null;
    for (const r of bridgeReaches(grid, layout, quay)) {
      const [a, b] = r.ends;
      const da = walk(a), db = walk(b);
      // Both banks out of the square's reach is a bridge between two places no road can
      // get to, which is a bridge nobody will ever stand on.
      if (da === Infinity && db === Infinity) continue;
      // What the crossing saves: the walk the far bank costs today, less the walk it
      // would cost over the deck. Infinite where the far bank has no road to it at all,
      // which is the best a crossing can do - it is not a short cut then, it is the only
      // way there.
      const gain = Math.max(da, db) - Math.min(da, db) - (r.cells.length + 1);
      // SPAN_WORTH cells of walking per cell of deck is the rule `routePath` is priced
      // by, so a crossing that does not clear it is one the router itself would refuse,
      // and a monument the village walks round is worse than no monument at all. Nothing
      // clearing it means the rung waits - the way the polder mill waits for shallows and
      // the crane waits for a quay.
      if (gain < SPAN_WORTH * r.cells.length) continue;
      const home = da <= db ? a : b;
      const cand = { ...r, home, away: da <= db ? b : a, gain, near: dist2(home, townCentre) };
      // Most saved, then nearest the town, then the lower cell - the last only so that two
      // reaches that are worth exactly the same do not swap places between two scans of
      // the same island.
      const better = !best || cand.gain > best.gain
        || (cand.gain === best.gain && (cand.near < best.near
          || (cand.near === best.near && (cand.home[1] < best.home[1]
            || (cand.home[1] === best.home[1] && cand.home[0] < best.home[0])))));
      if (better) best = cand;
    }
    // The town-side road is searched for first, because with the quay masked there may be
    // none: a bank whose only way into town is over the quay's ground is a crossing that
    // would join the quay or join nothing, and the rung goes without rather than lay a deck
    // with bare ground at one end. The search does not touch the deck's cells, which are
    // water and not yet laid, so asking it first changes no answer it gives.
    const join = best && routePath(grid, best.home, {
      isGoal: (cell, v) => v === PATH || v === SQUARE,
      budget: 250000,
    });
    if (best && !join) { unplaced.push(BRIDGE_ID); return; }
    if (best) {
      // The deck. `markRoad` turns the wet part of what it is handed into a bridge and
      // sets those cells BRIDGE; the run is all water by construction, so it records no
      // road surface and `layout.paths` gets nothing under this name.
      markRoad(grid, layout, BRIDGE_ID, best.cells);

      // And the road onto it from each bank - two stretches under one name with a gap
      // between them where the deck is, because `markPath` deliberately records no cell of
      // a bridge (a deck draws itself; recorded as road it would also get a stone track
      // laid over the open water).
      //
      //   the town side  a route to the first paving it meets. Not to the square: a bridge
      //                  joins the network, it does not need a trunk road of its own, and
      //                  REUSE braids it into whatever lane is nearest exactly as a front
      //                  path is braided.
      //   the far side   the landing cell, and nothing more. There is nothing over there
      //                  to run to yet. What matters is that the cell at the foot of the
      //                  planks is road, because a settler's road network is `paths` plus
      //                  `bridges` (see shared/roads.mjs) and a deck whose landing is bare
      //                  ground is a crossing that connects to nothing at that end.
      //
      // One route from the far bank was the first try and it is wrong wherever a lane
      // already runs near that bank: `routePath` stops at the first paving it reaches,
      // which is then on the far side, so the search ends before the water and the deck
      // gets no road over it at all. Measured on seed 7 at size 128 - a one-cell road and
      // an untouched crossing.
      markPath(grid, layout, `path:${BRIDGE_ID}`, [best.away, ...join]);
      deck = layout.bridges.find((b) => b.id === BRIDGE_ID);
    } else {
      // Nothing worth building - and if the roads have already crossed, the rung is
      // theirs. A bridge is built once and every later road comes over it rather than
      // build a second; that is the rule `crossingSpan` and REUSE exist to keep, so a
      // village whose hamlet roads have already thrown a deck over the river has built the
      // very thing this rung is for, and the stone goes up at the head of that one.
      //
      // Building anyway is what the first version did and it is plainly wrong: with a
      // crossing already standing, the reach beside it has a far bank no *other* road can
      // reach, which scores as the best a crossing can possibly do. Measured on seed 7 at
      // size 128 - two decks over the same river, one cell apart.
      //
      // The one nearest the town, because that is the crossing a village calls its own,
      // and measured from whichever of its two heads is nearer. Order is the layout's own
      // append order, so two crossings equally far off do not swap between scans.
      // A crossing at the quay is not adopted either, for the same reason one is not built.
      for (const b of layout.bridges) {
        if (nearQuay([...b.cells, ...deckEnds(b)], quay)) continue;
        const d = Math.min(...deckEnds(b).map((c) => dist2(c, townCentre)));
        if (!deck || d < Math.min(...deckEnds(deck).map((c) => dist2(c, townCentre)))) deck = b;
      }
    }
  }
  if (!deck) { unplaced.push(BRIDGE_ID); return; }

  // The stone at the bridge head.
  //
  // A milestone is a plot. That is what gives a rung a dossier to open, a date standing on
  // the island and somewhere for the legend to send the camera - the milestone loop in
  // scan.mjs drops any rung with no `layout.plots` entry on the floor, and a legend that
  // ticks a line with nothing behind it is worse than one rung short. A deck has no plot
  // to give: it stands over water, it has no footprint, no door and no yard. So this is
  // the one rung whose monument and whose record are two different things - the crossing
  // is what was built, and the stone beside its head is what says so, the way a polder is
  // the work and the mill on its dike is the rung.
  //
  // Beside the head and never on it, for the same reason the office stands beside the
  // mouth of its hamlet's road rather than in it: that cell is the road onto the planks,
  // and anything standing there walls the bridge off from the island it was built to join.
  //
  // Which head is the town's: `reach` was flooded before any of this ran, so it still
  // answers for the island without the crossing - which is the only moment the two banks
  // can be told apart. Ask it again now and the road just laid over the deck has made
  // them near neighbours.
  const ends = deckEnds(deck);
  const head = walk(ends[0]) <= walk(ends[1]) ? ends[0] : ends[1];
  const at = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]]
    .map(([dx, dz]) => [head[0] + dx, head[1] + dz])
    .find((c) => grid.freeCell(c[0], c[1], false));
  if (!at) { unplaced.push(BRIDGE_ID); return; }
  grid.set(at[0], at[1], PLOT);
  // Facing the head rather than the town, which is what every other civic faces. A stone
  // at a bridge is read by whoever is about to cross, and they are on the road.
  layout.plots[BRIDGE_ID] = { gx: at[0], gz: at[1], w: 1, d: 1, rot: facing(at, head) };
}

// A road from `from` to the town square, laid on the island as `layout` leaves it, and
// handed back as its cells.
//
// No scan calls this. It exists so that tests/bridge.test.mjs can ask the one question a
// milestone crossing has to answer - does a road laid after it come over the deck, or
// still walk round the head of the river? That is a question about `routePath` running on
// a *finished* cell grid, and the grid is scratch that lives and dies inside `placeAll`,
// so there is nowhere else on the island to ask it from. `bridges` is which crossings to
// replay and defaults to all of them; handing it the list with one left out is this
// island the moment before that crossing went up, and is the only honest control to
// measure a crossing against.
export function trialRoad(layout, { seed, size }, from, { bridges = layout.bridges || [], bridge = false } = {}) {
  const terrain = makeTerrain(seed, { size, polders: layout.polders || [], fairway: layout.fairway || null });
  const grid = replayGrid(terrain, layout, { bridges });
  return routePath(grid, from, { isGoal: (cell, v) => v === SQUARE, budget: 400000, bridge });
}

// Where each kind of furniture stands, as offsets from the town centre, in the order it
// is put out. Lamps take the corners, flower beds the stretches between them, terraces
// the outer corners near the frontage. Scattering them by whatever cell happened to be
// free is what made the square look littered.
//
// Benches take the fountain's own corners first, alongside the tables, and only then the
// rim. A bench is not scenery to frame the edge of a plaza with: it is somewhere to sit,
// and it reads as one only if it has something to sit in front of. The first one used to
// go to [-3, -1], alone on the west rim of a square it could see right across - and that
// cell is only inside the plaza once the square is seven wide, so below ninety settlers
// it fell back to whichever piece of frontage happened to lie furthest from the centre.
// The inner corners are paved from the three-wide green onwards, no road ends on any of
// them, and they leave the cross through the middle of the square clear to walk.
const FURNITURE_SPOTS = {
  planter: [[-1, -2], [1, 2], [2, -1], [-2, 1], [-1, 3], [1, -3], [3, 2], [-3, -2]],
  lamp: [[-3, -3], [3, -3], [-3, 3], [3, 3], [-3, 2], [3, -2]],
  bench: [[-1, 1], [1, -1], [-1, -1], [-3, 1], [3, -1]],
  terrace: [[2, -3], [-2, 3], [1, 3]],
};

// The eight lots the civic buildings stand on, as the min corner of each three by
// three relative to the town centre. They are deliberately off the house lattice and
// shoulder to shoulder around a seven wide square, so their frontage is the edge of
// the plaza and the middle of it stays one open space you can walk across.
const CIVIC_LOTS = [
  [-1, -6], [4, -6], [4, -1], [4, 4], [-1, 4], [-6, 4], [-6, -1], [-6, -6],
];

// Civic types that stand on the town square rather than on a lot of their own, as
// offsets from the town centre so they keep their place when the square grows. Each one
// is a list of candidates, best first, and that is not decoration: what stands on the
// square is deliberately never stamped on the cell grid - see the milestone loop, which
// skips the `grid.set` for exactly these - so the grid answers "free" for every cell the
// well, the boards and the fountain are standing on. For one release nothing else asked
// either, and `tables` was the single offset [-2, 2], which is the cell the island's own
// notice board is nailed to: the trestles were built straight through the board.
//
// The tables now take the inner corner beside the fountain. Two reasons, and neither is
// that the cell happened to be free. A road stops at the first paved cell it reaches, so
// the middle of each side of the square is a doorstep with a lane behind it - the mouth
// the town hall, the school and the tavern arrive through - and the four cells diagonally
// off the centre are the only ones near the middle that no road ends on. They are also
// inside the plaza from the three-wide green onwards, where the outer corners the well
// and the statue hold only come inside it at thirty settlers.
//
// Being the fountain's neighbour is the point rather than a side effect: the tables are
// the one thing on this square you are meant to sit down at, and they read as somewhere
// to sit only if they are next to something worth sitting in front of.
const ON_SQUARE = {
  fountain: [[0, 0]],
  well: [[-2, -2], [-1, -1], [-1, 1]],
  statue: [[2, -2], [1, -1], [-1, -1]],
  tables: [[1, 1], [-1, 1], [-1, -1], [1, -1]],
};
// The two notice boards. They are not milestones - they stand from the first scan - but
// they take a cell of the square like everything above and are held to the same rule.
const SQUARE_BOARDS = { board: [[2, 2], [1, 1], [1, -1]], issues: [[-2, 2], [-1, 1], [-1, -1]] };
// Civic types that take a single cell instead of a full three by three lot.
const SMALL = new Set(['well', 'tables', 'fountain', 'statue', 'lighthouse', 'windmill', 'poldermill', 'crane',
  // The bridge's own stone. One cell, and it never comes through the milestone loop at
  // all - `planBridge` places it once there are roads to join - but SMALL is also what
  // says a civic is drawn on a single cell rather than a three by three lot, and that is
  // read wherever a plot is read.
  'bridge']);

// Which cells the plots already written into the layout stand on. Everything that goes on
// the square reads its occupancy from here rather than from the cell grid, for the reason
// in `ON_SQUARE`: the grid cannot see a one-cell plot. This is the only definition of
// "something already stands here" that the square has, and every block that puts
// something on it - the two boards, the on-square civics, the furniture - asks it.
function occupiedCells(layout) {
  const out = new Set();
  for (const p of Object.values(layout.plots)) {
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) out.add(`${p.gx + x},${p.gz + z}`);
  }
  return out;
}

// The cells where something stands on a single cell of its own: a well, a notice board,
// the tables, a lamp, a bench. The town lays its stone under these and not under a
// building - a three by three lot, a shed in somebody's yard, a pier, water. A well is
// something on a plaza; a manor is a hole in one.
//
// It has to be read off the plots, because the cell grid cannot tell the two apart. Every
// plot is replayed onto the grid as PLOT at the top of `placeAll`, so from the grid's
// point of view a bench and a manor are the same news, and both blocks below that lay
// stone skipped the cell. The effect is one scan late and therefore easy to miss: on the
// scan that founds a bench the cell is still free and gets paved, and on the next it is
// PLOT and does not. Measured on a settled village of 144: ten cells of bare grass inside
// the plaza, one under every single thing standing on it, the fountain included.
//
// The plots that matter change between the two blocks that ask, so this is a function of
// the layout as it stands and not a set gathered once.
function footingCells(layout) {
  const footings = new Set(), built = new Set();
  for (const [id, p] of Object.entries(layout.plots)) {
    if (p.w === 1 && p.d === 1 && !id.startsWith('shed:')) footings.add(`${p.gx},${p.gz}`);
    else for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) built.add(`${p.gx + x},${p.gz + z}`);
  }
  for (const k of built) footings.delete(k);
  return footings;
}

// The first of `offsets` from the town centre that nothing stands on, claimed in `taken`
// so the next caller in the same pass cannot have it either.
function squareSpot(centre, taken, offsets) {
  for (const [ox, oz] of offsets) {
    const at = [centre[0] + ox, centre[1] + oz];
    const k = `${at[0]},${at[1]}`;
    if (taken.has(k)) continue;
    taken.add(k);
    return at;
  }
  return null;
}

// The ring of cells one deep around a three by three lot: the pavement the frontage block
// lays, in a fixed order so that whatever stands on it stands in the same place on every
// island with the same seed.
function frontageOf(p) {
  const out = [];
  for (let gz = p.gz - 1; gz <= p.gz + p.d; gz++) {
    for (let gx = p.gx - 1; gx <= p.gx + p.w; gx++) {
      if (gx === p.gx - 1 || gx === p.gx + p.w || gz === p.gz - 1 || gz === p.gz + p.d) out.push([gx, gz]);
    }
  }
  return out;
}

// How strong a plot's claim on a cell is, lowest first, and it is the order `placeAll`
// puts things out in rather than a judgement of its own: whatever cannot be placed again
// at all (a house, a shed, a civic lot, either notice board) comes first, then the
// milestones that stand on the square, then the furniture. Only a claim that loses gives
// way, and only because it carries a list of other cells it would be happy on.
function squareClaimRank(id) {
  const parts = String(id).split(':');
  if (parts[0] !== 'civic') return 0;
  if (parts.length === 2 && ON_SQUARE[parts[1]]) return 1;
  if (parts.length === 3 && FURNITURE_SPOTS[parts[1]]) return 2;
  return 0;
}

// A one-time re-placement of whatever ended up standing inside something else on the
// square. The offsets above and `squareSpot` stop it happening again, but they cannot
// undo it: a plot here is sticky on purpose and the milestone loop skips an id it already
// has, so the tables written into the island's notice board would stand there forever.
//
// Nothing off the square is lifted, and a house sharing cells with the shed in its own
// garden is this layout working as intended rather than a collision - both are rank
// nought, so neither is asked to move.
function migrateSquare(l) {
  if (l.squareV === SQUARE_VERSION) return l;
  l.squareV = SQUARE_VERSION;
  const claims = new Map();
  for (const [id, p] of Object.entries(l.plots)) {
    for (let z = 0; z < p.d; z++) {
      for (let x = 0; x < p.w; x++) {
        const k = `${p.gx + x},${p.gz + z}`;
        if (!claims.has(k)) claims.set(k, []);
        claims.get(k).push(id);
      }
    }
  }
  for (const ids of claims.values()) {
    if (ids.length < 2) continue;
    // Sorted by id after the rank so a repair does not depend on the order the keys
    // happened to be written to the file in.
    const beaten = [...ids]
      .sort((a, b) => squareClaimRank(a) - squareClaimRank(b) || a.localeCompare(b))
      .slice(1);
    for (const id of beaten) if (squareClaimRank(id) > 0) delete l.plots[id];
  }
  return l;
}

// The next lot on the square that no civic building has claimed yet.
function takeCivicLot(grid, layout) {
  const used = new Set(Object.values(layout.plots).map((p) => `${p.gx},${p.gz}`));
  for (const [gx, gz] of layout.town.lots || []) {
    if (used.has(`${gx},${gz}`)) continue;
    grid.fillBlock(gx, gz, 3, 3, PLOT);
    return [gx, gz];
  }
  return null;
}

// The districts in the order every ordinal in the layout is counted in: arrival, then
// name. A district's ordinal is who it is on the land register and which colour it paints
// by, so anything that builds a `Super` to ask about a super-cell has to count the same
// way `placeAll` does - which is why this is a function rather than a line in it.
export function districtOrder(model) {
  const districts = [...(model.districts || [])].sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.id.localeCompare(b.id));
  return { districts, ordOf: new Map(districts.map((d, k) => [d.id, k])) };
}

// Everything a district already owns, replayed onto the super-grid, so land is as sticky
// as the buildings standing on it: the town's core and its commons first, then every
// lobe of every district under its ordinal. A district the model no longer has keeps its
// land under TOWN, which is 'somebody's, not yours' to every other district. `grid` may be
// null when the caller only wants the register and not the cells a claim hands back.
export function registerLand(sup, layout, ordOf, grid) {
  for (let j = -TOWN_CORE_R; j <= TOWN_CORE_R; j++) {
    for (let i = -TOWN_CORE_R; i <= TOWN_CORE_R; i++) if (sup.in(i, j)) sup.claim(i, j, TOWN, null);
  }
  layout.town.commons = layout.town.commons || [];
  for (const [i, j] of layout.town.commons) if (sup.in(i, j)) sup.claim(i, j, TOWN, null);
  for (const [id, rec] of Object.entries(layout.districts)) {
    const k = ordOf.has(id) ? ordOf.get(id) : TOWN;
    for (const lobe of rec.lobes || []) for (const [i, j] of lobe.cells) sup.claim(i, j, k, grid);
  }
}

// The cell grid as the island stands, read-only: the same replay `placeAll` does before
// it places anything, in the same order, because what is standing decides what the
// router may walk on and a different order gives a different island. `placeAll` keeps its
// own copy of these lines because its replay has side effects this one may not have - it
// records a silted-up deck as road and lays the causeway into `layout.paths` - so this is
// the question and that is the act. Two readers ask it: `trialRoad`, for the tests, and
// lib/plan.mjs, which hands `skip` the plots it is about to lift so the ground under them
// reads as free for wherever they are going.
export function replayGrid(terrain, layout, { bridges = layout.bridges || [], skip = null } = {}) {
  const grid = new Grid(terrain);
  for (const p of layout.polders || []) {
    for (const c of p.dike || []) grid.set(c[0], c[1], RESERVED);
    for (const c of p.road || []) grid.set(c[0], c[1], PATH);
  }
  for (const c of zoneCells(layout)) grid.set(c[0], c[1], RESERVED);
  for (const d of Object.values(layout.districts || {})) {
    for (const [gx, gz] of d.pier || []) grid.set(gx, gz, PIER);
  }
  for (const h of layout.harbours || []) {
    if (!h) continue;
    for (const [gx, gz] of h.pier || []) grid.set(gx, gz, PIER);
    for (const [gx, gz] of h.slip || []) grid.set(gx, gz, PATH);
  }
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (skip && skip.has(id)) continue;
    grid.fillBlock(p.gx, p.gz, p.w, p.d, PLOT);
  }
  for (const p of layout.paths || []) {
    for (const [gx, gz] of p.cells) if (grid.get(gx, gz) === FREE) grid.set(gx, gz, PATH);
  }
  // Only over ground the plaza actually took. `town.paved` records the footing cells the
  // well and the notice boards stand on as well, and those stay PLOT - see the square
  // block in `placeAll`, which leaves them exactly as it found them.
  for (const [gx, gz] of (layout.town && layout.town.paved) || []) {
    const v = grid.get(gx, gz);
    if (v === FREE || v === PATH) grid.set(gx, gz, SQUARE);
  }
  for (const b of bridges) for (const [gx, gz] of b.cells) grid.set(gx, gz, BRIDGE);
  return grid;
}

// The ground itself changed under a layout that was planned on the old one - a river was
// cut, the heightfield was tuned. `loadLayout` cannot see this: it compares `v`, `seed`
// and `size`, and all three are still what they were. Left alone every house would keep
// the plot it was given on the old terrain and some of them would be standing in the
// water, so a changed hash is treated exactly as a changed seed: the island is planned
// again from nothing, the town square included. The caller holds this object, so it is
// emptied in place rather than replaced.
function resetForNewTerrain(layout, seed, size) {
  const fresh = emptyLayout(seed, size);
  for (const k of Object.keys(layout)) delete layout[k];
  Object.assign(layout, fresh);
}

export function placeAll(layout, model, { seed, size = 64 } = {}) {
  // The fairway travels with the polders everywhere below, for the same reason: it is
  // ground the layout decided about, so a terrain built without it is a different island.
  // On a layout that has never been dredged it is null and `makeTerrain` does nothing with
  // it, which is what lets the hash check on the next line still recognise an island
  // planned before any of this existed.
  let terrain = makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway });
  // A layout with no hash on it was planned before this check existed, which means it was
  // planned on ground that has since had rivers cut through it - so a missing hash is a
  // mismatch, not a free pass. Without this, an island carried over from before the
  // rivers kept every plot while the water arrived underneath: measured, fourteen houses
  // ended up standing in a river and not one bridge was built. A fresh layout is empty,
  // so resetting it costs nothing.
  if (layout.terrainHash !== terrain.hash) {
    resetForNewTerrain(layout, seed, size);
    terrain = makeTerrain(seed, { size, polders: layout.polders });   // and no polders, no channel
  }
  layout.bridges = layout.bridges || [];
  let grid = new Grid(terrain);
  const centre = [size / 2, size / 2];
  const unplaced = [];

  // ---- where the town is ---------------------------------------------------------
  // First of all, and on its own, because the super-lattice is anchored on the town
  // centre and the polders below are measured in super-cells. On a village that already
  // has a town this is a no-op; on a brand-new one there is nothing else on the island
  // yet for it to disturb. The paving is left to the square-growth block further down,
  // which lays these same cells and records them.
  if (!layout.town) {
    const sq = flattestBlock(grid, centre[0] - 1, centre[1] - 1, { w: 3, d: 3 });
    if (!sq) throw new Error('no flat ground for the town square');
    layout.town = { square: sq, centre: [sq[0] + 1, sq[1] + 1] };
  }

  // ---- the river mouth ------------------------------------------------------------
  // Dug before the polders and before anything is placed, for the same reason they are:
  // the heightfield has to be final before one cell is judged buildable. Once, ever - the
  // stored channel is the truth from then on, so tuning anything in `planFairway` later
  // changes what the *next* island digs and never what this one already has.
  //
  // The settler gate is the polders' idea rather than a milestone of its own: a scan must
  // be a pure function of the model or a rescan would dredge a different channel, and a
  // count of the people who have lived here is the one thing in reach that is.
  if (!layout.fairway && model.stats.settlers >= FAIRWAY_AT) {
    const dug = planFairway(terrain, layout);
    if (dug && dug.cells.length) {
      layout.fairway = dug;
      terrain = makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway });
      grid = new Grid(terrain);
    } else {
      // No river, or no way out to deep water that does not go through the island. Written
      // down all the same, so the search is not run again on every scan for ever.
      layout.fairway = { line: [], cells: [] };
    }
  }

  // ---- land off the water --------------------------------------------------------
  // Before anything is placed, because the heightfield has to be final before a single
  // cell is judged buildable - so the terrain and the cell grid are both built again if
  // the coast moved. Reclaiming appends to `layout.polders`, which is as sticky as
  // everything else in this file: land, once taken, is never given back.
  const reclaimed = reclaim(seed, size, latticeOf(layout), layout, model.stats.settlers);
  if (reclaimed) { terrain = reclaimed; grid = new Grid(terrain); }

  // The hash goes on record *after* reclaiming, and that ordering is load-bearing. The
  // guard above treats a changed heightfield as a changed seed and plans the island again
  // from nothing - right when the generator was tuned or a river was cut, and ruinous
  // here, because draining a polder changes the heightfield on purpose. Recorded before
  // reclaiming, the stored hash is the coast *without* the new polder, so the next scan
  // finds a mismatch it caused itself and wipes the town; it then reclaims, mismatches
  // again, and every house moves on every scan.
  layout.terrainHash = terrain.hash;

  // The quay, if it was planned before a quay had to stand at the sea. Here rather than in
  // `loadLayout`, where the other migrations live, because it needs the finished ground -
  // and before the land register below replays what each district owns, because a parcel
  // this hands back must not be replayed as land the quay still holds.
  migrateQuay(layout, terrain, layout.town.centre);

  // The dike and the causeway: raised ground you may walk but not settle. Forced rather
  // than filled, because a beach cell the causeway crosses is BLOCKED as far as the cell
  // grid knows, and a road has to be able to cross it to reach the new land at all.
  //
  // The two are not marked alike, and that difference is the only reason the houses on a
  // polder can be reached. Both used to be PATH, which reads to `routePath` as road that
  // is already there and therefore almost free to walk - so the hamlet road came off the
  // new land, ran the length of the sea wall and stepped ashore at the far end. Then
  // `markPath` recorded none of that stretch, because it only records cells it paved
  // itself and these were PATH before it arrived. The road existed in the cell grid and
  // nowhere else: `roadGraph` in the viewer never heard of it, and `settlers.js` cannot
  // walk what is not in `layout.paths`. Measured on the island with every session on it -
  // a fifteen-cell hole in the one road onto the polder, and three houses with no way home.
  //
  //   the dike      RESERVED. Nothing builds on it and no road crosses it. A sea wall is
  //                 not a street, and leaving it cheap is what tempted the router up onto
  //                 it in the first place.
  //   the causeway  PATH, and written into `layout.paths` like any other stretch of road,
  //                 because that is exactly what it is: the one way onto the new land.
  const held = heldOf(layout);
  for (const p of layout.polders) for (const c of p.dike || []) grid.set(c[0], c[1], RESERVED);
  // A zone is a dike without the water: same mark, same reason, see `zoneCells`. Stamped
  // before the plots and the paths are replayed, so what already stands in one keeps its
  // cells - and a path that crosses one is lib/plan.mjs's to remove, not this loop's to keep.
  for (const c of zoneCells(layout)) grid.set(c[0], c[1], RESERVED);
  for (const [n, p] of layout.polders.entries()) {
    if (!(p.road || []).length) continue;
    const id = `road:polder:${n}`;
    // The causeway is laid from bare ground on every scan, and `markPath` appends to a
    // road whose name it has seen before - so without this the causeway would grow a
    // second copy of itself in layout.paths every minute, and "a second scan changes
    // nothing" would be false. Recorded once; after that the cells are only forced back.
    if (layout.paths.some((q) => q.id === id)) {
      for (const c of p.road) grid.set(c[0], c[1], PATH);
      continue;
    }
    for (const c of p.road) grid.set(c[0], c[1], FREE);   // beach, so BLOCKED until told otherwise
    markPath(grid, layout, id, p.road);
  }
  // The harbours' planks and slipways, for the causeway's reason: the slip crosses beach,
  // which is BLOCKED, and the replay below only paves cells that are FREE.
  for (const [n, h] of (layout.harbours || []).entries()) {
    if (!h) continue;
    for (const [gx, gz] of h.pier || []) grid.set(gx, gz, PIER);
    const id = `road:harbour:${n}`;
    if (layout.paths.some((q) => q.id === id)) {
      for (const c of h.slip || []) grid.set(c[0], c[1], PATH);
      continue;
    }
    for (const c of h.slip || []) grid.set(c[0], c[1], FREE);
    markPath(grid, layout, id, h.slip || []);
  }

  // Re-apply what was decided in earlier runs, so nothing ever moves. Greens are not
  // among it any more: laying one back down would make an island that already has them
  // carry them for a whole scan, and a new road looking for "any square" would set off
  // for a neighbour's old green instead of the town.
  for (const d of Object.values(layout.districts)) {
    for (const [gx, gz] of d.pier || []) grid.set(gx, gz, PIER);
    // Retire the greens of an island that still has them on record. Every district the
    // model knows about is cleared again further down, but `outlands` is not one of them -
    // it is assembled from the sessions whose folder is nobody's project - so without this
    // it would keep a green nothing ever lays or reads.
    for (const lobe of d.lobes || []) { lobe.green = 0; lobe.square = null; lobe.paved = []; }
    d.square = null;
    d.paved = [];
  }
  for (const p of Object.values(layout.plots)) {
    grid.fillBlock(p.gx, p.gz, p.w, p.d, PLOT);
  }
  for (const p of layout.paths) for (const [gx, gz] of p.cells) if (grid.get(gx, gz) === FREE) grid.set(gx, gz, PATH);
  // A deck is as sticky as a house and has to be: a road that crosses where the last road
  // crossed is what keeps the island down to a handful of crossings. The water under it is
  // not sticky at all - the generator gets tuned, a river is re-cut, a polder is drained -
  // and a plank bridge with railings standing in a meadow is what that leaves behind. So
  // every deck is measured against the water that is there now rather than the water that
  // was there when it was built. One with dry ground under all of it was a crossing of
  // something that has gone, and it becomes what it would have been without the water:
  // ordinary road, so the route over it stays whole instead of ending in a gap.
  layout.bridges = layout.bridges.filter((b) => {
    if (b.cells.some(([gx, gz]) => !terrain.isLand(gx, gz))) return true;
    markPath(grid, layout, b.id, b.cells);
    return false;
  });
  // A bridge stands over water, which the grid calls BLOCKED, so it is put back before
  // anything is routed. From here on it is a cell a road may walk over for almost
  // nothing, which is what makes the next hamlet cross where the last one did.
  for (const b of layout.bridges) for (const [gx, gz] of b.cells) grid.set(gx, gz, BRIDGE);

  replayKeeperRoads(grid, layout);

  // ---- the town square and the town hall ------------------------------------
  const townCentre = layout.town.centre;

  // ---- the civic quarter -------------------------------------------------------
  // The lots around the town square are held back from the first scan onwards, so a
  // milestone has somewhere to land when it unlocks years of sessions later. Without
  // them the centre fills with houses and the school ends up half a mile out of town.
  if (!layout.town.lots) {
    const lots = [];
    for (const [dx, dz] of CIVIC_LOTS) {
      const gx = townCentre[0] + dx, gz = townCentre[1] + dz;
      if (grid.freeBlock(gx, gz, 3, 3, false)) lots.push([gx, gz]);
    }
    layout.town.lots = lots;
  }
  for (const [gx, gz] of layout.town.lots) {
    if (grid.freeBlock(gx, gz, 3, 3, false)) grid.fillBlock(gx, gz, 3, 3, RESERVED);
  }

  // The one square in the village grows with it: a green three across while this is a
  // hamlet, a proper market square by the time there is a crowd to hold. It takes only
  // ground nobody is using and grows around its own centre, so it widens around the
  // buildings already standing on it rather than pushing them aside. The result is an
  // irregular plaza hugging its own frontage, which is what real ones look like.
  for (const step of SQUARE_STEPS) {
    if (model.stats.settlers >= step.at) layout.town.size = Math.max(layout.town.size || 3, step.size);
  }
  {
    const half = ((layout.town.size || 3) - 1) / 2;
    const footings = footingCells(layout);
    const paved = [];
    for (let gz = townCentre[1] - half; gz <= townCentre[1] + half; gz++) {
      for (let gx = townCentre[0] - half; gx <= townCentre[0] + half; gx++) {
        const v = grid.get(gx, gz);
        // The stone goes down under the well and the notice boards, and the cell is left
        // spoken for rather than re-marked as plaza - what stands on it is still standing,
        // so the grid comes out of this block exactly as it went in.
        if (v === PLOT && footings.has(`${gx},${gz}`)) { paved.push([gx, gz]); continue; }
        if (v === PLOT || v === BLOCKED || v === PIER || v === RESERVED) continue;
        grid.set(gx, gz, SQUARE);
        paved.push([gx, gz]);
      }
    }
    layout.town.square = [townCentre[0] - half, townCentre[1] - half];
    layout.town.paved = paved;
  }

  if (!layout.plots['civic:townhall']) {
    const hall = takeCivicLot(grid, layout) || findBlockAround(grid, townCentre, { skipRing0: true });
    if (hall) {
      const rot = facing([hall[0] + 1, hall[1] + 1], townCentre);
      grid.fillBlock(hall[0], hall[1], 3, 3, PLOT);
      layout.plots['civic:townhall'] = { gx: hall[0], gz: hall[1], w: 3, d: 3, rot };
      markPath(grid, layout, 'path:civic:townhall', routePath(grid, outsideDoor(hall[0], hall[1], rot)));
    }
  }

  // The two notice boards stand on the town square, where everyone passes: the sprint
  // board on one corner and the island's own board facing it from the opposite one - the
  // work of the village on one side, the work on the village itself on the other. On a
  // corner rather than in the middle, because dead centre is where the fountain goes and
  // a board standing there is something you have to walk around all day.
  {
    const c = layout.town.centre;
    const taken = occupiedCells(layout);
    for (const [kind, spots] of Object.entries(SQUARE_BOARDS)) {
      const id = `civic:${kind}`;
      if (layout.plots[id]) continue;
      const at = squareSpot(c, taken, spots);
      if (!at) { unplaced.push(id); continue; }
      layout.plots[id] = { gx: at[0], gz: at[1], w: 1, d: 1, rot: facing(at, c) };
    }
  }

  if (!layout.landing) {
    const beach = nearestCell(terrain.beachCells.length ? terrain.beachCells : terrain.coastCells, townCentre);
    layout.landing = beach || null;
  }

  // ---- the land register -----------------------------------------------------
  // Everything a district already owns is replayed onto the super-grid first, so land is
  // as sticky as the buildings standing on it: a parcel only ever grows.
  const lat = latticeOf(layout);
  const sup = new Super(terrain, lat, held);
  const { districts, ordOf } = districtOrder(model);
  const popOf = new Map(districts.map((d) => [d.id, d.population]));
  registerLand(sup, layout, ordOf, grid);

  // ---- the town commons ------------------------------------------------------
  // Houses of projects too small for a hamlet of their own, plus anyone the island had no
  // room left for. It has to grow before any hamlet is seeded: the other way round it
  // gets hemmed in against a demand it cannot meet.
  {
    const guests = model.buildings.filter((b) => b.kind !== 'shed' && tierOf(popOf.get(b.district) || 1) === 'farmstead').length;
    const core = (2 * TOWN_CORE_R + 1) * (2 * TOWN_CORE_R + 1);
    const commons = { seed: [0, 0], cells: [...layout.town.commons], green: 0 };
    if (!commons.cells.length) {
      for (let j = -TOWN_CORE_R; j <= TOWN_CORE_R; j++) {
        for (let i = -TOWN_CORE_R; i <= TOWN_CORE_R; i++) commons.cells.push([i, j]);
      }
    }
    growParcel(sup, commons, TOWN, core + guests + COMMONS_HEADROOM, false, grid);
    layout.town.commons = commons.cells;
  }

  // ---- hamlets ---------------------------------------------------------------
  // Seeding order is by size, biggest first, and every lone farm waits until last. It
  // used to be arrival order, which let nineteen one-session projects each reserve their
  // berth before the big hamlets were placed at all: measured, that left the island
  // carved into fringes and projects with eight sessions ended up with four cells.
  // Only *new* seeds are affected - land already owned is replayed above and never moves
  // - and the ordinal each district routes and paints by stays arrival order.
  const seedOrder = [...districts].sort((a, b) => {
    const fa = tierOf(a.population) === 'farmstead' ? 1 : 0;
    const fb = tierOf(b.population) === 'farmstead' ? 1 : 0;
    return fa - fb || b.population - a.population || a.firstSeenAt - b.firstSeenAt || a.id.localeCompare(b.id);
  });
  for (const d of seedOrder) {
    const k = ordOf.get(d.id);
    const rec = layout.districts[d.id] || {};
    const allowBeach = d.kind === 'quay';
    rec.lobes = rec.lobes || [];
    rec.pier = rec.pier || [];
    rec.shore = rec.shore || null;

    const tier = tierOf(d.population);
    rec.tier = tier;
    if (tier === 'farmstead' && !rec.lobes.length) {
      // One super-cell in the countryside: a farmhouse, a barn and a field. No green and
      // no sign; if the project reaches its third session it founds a proper hamlet and
      // the houses already standing here stay where they are.
      const seed = pickSeed(sup, Math.max(1, d.population), { allowBeach, k, ladder: FARM_LADDER, id: d.id });
      if (seed) {
        sup.claim(seed[0], seed[1], k, grid);
        const lobe = { seed, cells: [seed], green: 0, square: null, centre: centreOfCell(lat, seed), paved: [], road: null };
        growParcel(sup, lobe, k, Math.max(1, d.population), allowBeach, grid);
        rec.lobes.push(lobe);
      }
      rec.guest = !rec.lobes.length;
    }
    if (tier === 'farmstead') {
      if (rec.lobes.length) {
        rec.centre = rec.lobes[0].centre;      // no green and no sign, but it is still a place
        rec.square = null;
        rec.paved = [];
      }
      layout.districts[d.id] = rec;
      continue;
    }

    // The quay picks its shore and its planks first; its parcel then has to reach them.
    let near = null;
    if (d.kind === 'quay' && !rec.pier.length) {
      // An island that already has its harbours hands the quay the one nearest the town
      // rather than letting it pick a fifth: the quay's planks are a harbour's planks.
      const found = nearestHarbour(layout, townCentre) || pickPier(terrain, townCentre);
      if (found) {
        rec.shore = found.shore; rec.pier = found.pier;
        for (const [gx, gz] of found.pier) grid.set(gx, gz, PIER);
      }
    }
    if (rec.shore) near = superOf(lat, rec.shore[0], rec.shore[1]);

    ensureParcel(sup, rec, d.population, {
      k, allowBeach, near, grid, lat, id: d.id,
      leash: near ? QUAY_LEASH : 0,          // the quay, and only the quay, has a shore
    });

    // No green. A hamlet used to hold a square of its own in the middle - grass while it
    // was small, paved once it was a village - with the name sign standing on its edge.
    // It read as a plaza that nothing faced and nobody crossed: the houses front onto
    // their own lanes, so the middle was a paved gap with a sign in it. What a hamlet
    // wants instead is a way in, which is what the road already is; the sign belongs over
    // that road at the parcel's edge, welcoming you through. See `gateOf` in
    // web/js/main.js, which finds the spot from the road and the land it leaves.
    //
    // These three are derived rather than sticky, so clearing them retires the greens on
    // an island that already has them: the stone stops being laid, the cell stops being
    // reserved, and `parcelOrder` hands it to the next house that needs a plot. Nothing
    // standing moves - a plot already given is never taken back.
    for (const lobe of rec.lobes) {
      lobe.green = 0;
      lobe.square = null;
      lobe.paved = [];
      lobe.centre = centreOfCell(lat, lobe.seed);
    }
    if (rec.lobes.length) {
      rec.square = null;
      rec.centre = rec.lobes[0].centre;
      rec.paved = [];
    }
    layout.districts[d.id] = rec;
  }

  // ---- civic milestones ------------------------------------------------------
  // One reading of what already stands where, carried through the loop so that two
  // milestones unlocking on the same scan see each other, and so that nothing on the
  // square lands on the notice boards that were placed above.
  const squareTaken = occupiedCells(layout);
  for (const m of model.milestones) {
    if (!m.unlocked) continue;
    const id = `civic:${m.civicType}`;
    if (layout.plots[id]) continue;
    // The bridge is not placed here, and it is the only rung that is not. It is a road,
    // and the roads are not routed until further down this function - so it is laid there,
    // by `planBridge`, which gives it the plot this loop would otherwise have to invent a
    // site for. See BRIDGE_AT.
    if (m.civicType === 'bridge') continue;
    let block = null;
    // Which way the building looks. Everything civic faces the town, which is what the
    // fall-through below says; the crane is the one thing on the island that has to look
    // the other way, so it sets this and nothing else does.
    let look = null;
    if (ON_SQUARE[m.civicType]) {
      block = squareSpot(townCentre, squareTaken, ON_SQUARE[m.civicType]);                // on the square itself
    } else if (m.civicType === 'lighthouse') {
      const c = nearestCell(terrain.coastCells.filter(([gx, gz]) => grid.freeBlock(gx, gz, 1, 1, true)), farthestFrom(terrain.coastCells, townCentre) || townCentre);
      block = c ? [c[0], c[1]] : null;
    } else if (m.civicType === 'poldermill') {
      // On the dike of the first polder, facing the water it drains. The cell nearest
      // town, so the mill reads as belonging to the village rather than to the sea, and
      // if the island had no shallows to reclaim the mill simply waits.
      //
      // RESERVED is how the sea wall is marked where the polders are laid in, and the
      // mill is the one thing on the island allowed to stand on it - so this reads that
      // mark directly instead of asking `freeBlock`, which refuses a dike on purpose.
      // It used to read PATH, which is what the wall was marked with before a road was
      // caught treating it as a street; a mark is not a permission, and this is the one
      // place that difference has to be spelled out.
      const p = layout.polders[0];
      block = p ? nearestCell(p.dike.filter(([gx, gz]) => grid.get(gx, gz) === RESERVED), townCentre) : null;
    } else if (m.civicType === 'crane') {
      // On the quay's own waterfront, with its jib out over the water nearest the berth.
      // There is no lot for this and there should not be: the quay is the one district
      // whose ground is not a preference (see `migrateQuay`), and a crane that stood
      // anywhere else on the island would be a gantry in a field.
      //
      // Two cells are refused whatever else happens. `pier` is the planks, which carry a
      // deck and not a foundation - a building set down there is drawn at ground height
      // and would stand in the water beside its own crate. And the shore cell is the
      // ramp: the single step between the road and the planks, and the only way onto
      // them, so a crane there would wall the quay off from the island.
      //
      // Then two preferences, in this order, because a quay at 165 settlers is not the
      // quay the first Cowork task found:
      //
      //   beside the ramp   the two cells flanking it and the two behind those. This is
      //                     where a crane belongs and where a young quay still has room.
      //   along the shore   measured on this island, by the time the crane is earned the
      //                     waterfront is harbour houses shoulder to shoulder and all
      //                     four of those cells are somebody's plot. So it walks down the
      //                     water's edge instead of inland: the free coast cell nearest
      //                     the head of the planks, and no further from it than the
      //                     planks are long, so the crane is never out of reach of the
      //                     hull it exists to unload. QUAY_REACH is that length, and it
      //                     is shared/quay.mjs's copy of `pierCells`'s own 5.
      //
      // `allowBeach` throughout because a quayside is sand: the same permission every
      // harbour house is given, and the reason `freeCell` takes the flag at all.
      //
      // No quay district means no planks, and the crane waits the way the polder mill
      // waits for shallows. An island that has never run a Cowork task has nothing for a
      // crane to stand at the head of.
      const q = layout.districts.quay;
      const pier = (q && q.pier) || [];
      if (q && q.shore && pier.length) {
        const [sx, sz] = q.shore;
        const head = pier[pier.length - 1];
        const run = [pier[0][0] - sx, pier[0][1] - sz];          // the way the planks go out
        const across = [run[1], -run[0]];
        const at = (back, side) => [sx - run[0] * back + across[0] * side, sz - run[1] * back + across[1] * side];
        // Which water this cell reaches over: the one square of it alongside that is
        // nearest the berth. A crane carries its load out in front of itself, so a cell
        // with no water beside it is not a site however close to the planks it is - and
        // pointing the crane at the far end of the planks instead is not the same answer.
        // Measured on seed 1337: the cell flanking the ramp faced the berth correctly and
        // still hung its crate over the bank, because a shoreline bends and a rotation is
        // one of four. So the aim is a neighbour rather than a landmark, and the crate is
        // over water by construction.
        const reach = (c) => nearestCell(N4.map(([dx, dz]) => [c[0] + dx, c[1] + dz]).filter(([gx, gz]) => terrain.isWater(gx, gz)), head);
        const open = (c) => grid.freeCell(c[0], c[1], true) && !(c[0] === sx && c[1] === sz) && !!reach(c);
        block = [at(0, 1), at(0, -1), at(1, 1), at(1, -1)].find(open)
          || nearestCell(terrain.coastCells.filter((c) => open(c) && scheb(c, head) <= QUAY_REACH), head)
          || null;
        if (block) look = reach(block);
      }
    } else if (m.civicType === 'windmill') {
      let best = null, bh = -9;
      for (const [gx, gz] of terrain.landCells) {
        if (!grid.freeBlock(gx, gz, 1, 1, false)) continue;
        const h = terrain.heightAt(gx, gz);
        if (h > bh && h < 5.0) { bh = h; best = [gx, gz]; }
      }
      block = best;
    } else block = takeCivicLot(grid, layout) || findBlockAround(grid, townCentre, { skipRing0: true });
    if (!block) { unplaced.push(id); continue; }
    const w = SMALL.has(m.civicType) ? 1 : 3;
    const rot = facing([block[0] + (w >> 1), block[1] + (w >> 1)], look || townCentre);
    if (w === 3) grid.fillBlock(block[0], block[1], 3, 3, PLOT);
    else if (!ON_SQUARE[m.civicType]) grid.set(block[0], block[1], PLOT);
    layout.plots[id] = { gx: block[0], gz: block[1], w, d: w, rot };
    for (let z = 0; z < w; z++) for (let x = 0; x < w; x++) squareTaken.add(`${block[0] + x},${block[1] + z}`);
    if (w === 3) markPath(grid, layout, `path:${id}`, routePath(grid, nearestWalkable(grid, outsideDoor(block[0], block[1], rot))));
  }

  // ---- the civic roads, relaid --------------------------------------------------
  // The path to a civic building is laid once, on the scan that places it, in the loop
  // above. That is enough right up until `paths` is emptied - which is exactly what a
  // PARCEL_VERSION bump does, because a path is derived geometry that has to be re-routed
  // onto the new lattice. Every plot on the island is then placed again and gets its road
  // back; a civic building is not, because it is already standing and the loop above
  // skips an id it has. Measured on a re-parcelling of this island: every civic road on
  // it went to nought and stayed there.
  //
  // So they are relaid here, from nothing, for any civic lot that has no road on record.
  // Idempotent by that same test, and sorted by id so that two roads laid in the same
  // pass braid in the same order however the keys happen to sit in the file.
  //
  // Before the frontage below rather than after, and that matters: frontage turns the
  // cells around a civic lot into plaza, so a road laid afterwards would start on stone,
  // reach stone in one step, and record two cells of pavement as if they were a road.
  // Laid here it comes out as the road the placing loop would have laid.
  for (const [id, p] of Object.entries(layout.plots).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!id.startsWith('civic:') || p.w !== 3) continue;
    if (layout.paths.some((q) => q.id === `path:${id}`)) continue;
    markPath(grid, layout, `path:${id}`, routePath(grid, nearestWalkable(grid, outsideDoor(p.gx, p.gz, p.rot))));
  }

  // ---- frontage ----------------------------------------------------------------
  // A pavement one cell deep in front of every civic building, so the square reaches
  // the doorsteps instead of leaving a strip of grass between the stone and the walls.
  // This is what stops the centre reading as buildings scattered near a patio, and it
  // is how the centre keeps growing once the square itself has stopped.
  {
    const centre = layout.town.centre;
    const reach = 6;
    const footings = footingCells(layout);
    // What the plaza already covers. The square above no longer marks a footing cell as
    // SQUARE, so without this a lamp on the plaza's own rim would be recorded twice.
    const laid = new Set((layout.town.paved || []).map((c) => `${c[0]},${c[1]}`));
    const frontage = [];
    for (const [id, p] of Object.entries(layout.plots)) {
      if (!id.startsWith('civic:') || p.w !== 3) continue;
      if (Math.abs(p.gx + 1 - centre[0]) > reach || Math.abs(p.gz + 1 - centre[1]) > reach) continue;
      for (let gz = p.gz - 1; gz <= p.gz + 3; gz++) {
        for (let gx = p.gx - 1; gx <= p.gx + 3; gx++) {
          const edge = gx === p.gx - 1 || gx === p.gx + 3 || gz === p.gz - 1 || gz === p.gz + 3;
          if (!edge) continue;
          const k = `${gx},${gz}`;
          if (laid.has(k)) continue;
          const v = grid.get(gx, gz);
          // A lamp that ended up on the frontage keeps its stone for the same reason the
          // well does on the plaza: one cell, and what stands on it is not a building.
          if (v === PLOT && footings.has(k)) { laid.add(k); frontage.push([gx, gz]); continue; }
          if (v !== FREE && v !== PATH) continue;
          grid.set(gx, gz, SQUARE);
          laid.add(k);
          frontage.push([gx, gz]);
        }
      }
    }
    layout.town.paved = [...(layout.town.paved || []), ...frontage];
  }

  // ---- the postbox -------------------------------------------------------------
  // On the town hall's pavement, beside the doorstep and never on it: that cell is where
  // the front path starts, and a box planted there would wall the hall in the way a shed
  // walls a house in. The cell to one side of it, then the other, then any paving along
  // the hall's own frontage - which is why this stands after the block above rather than
  // with the rest of the furniture: it is the frontage that lays that stone.
  //
  // It is not a milestone and is not earned. The village grows its well and its chapel
  // out of the work done on the island; what is in this box was never the island's to
  // give, so the box has been there since the hall was built.
  {
    const hall = layout.plots['civic:townhall'];
    if (hall && !layout.plots['civic:mailbox']) {
      const step = outsideDoor(hall.gx, hall.gz, hall.rot);
      // Which way is "beside": across the way the hall faces, so the two cells flank the
      // doorstep along the front of the building instead of running away from it.
      const across = (hall.rot === 1 || hall.rot === 3) ? [0, 1] : [1, 0];
      const taken = occupiedCells(layout);
      const free = ([gx, gz]) => grid.get(gx, gz) === SQUARE && !taken.has(`${gx},${gz}`);
      const beside = [
        [step[0] - across[0], step[1] - across[1]],
        [step[0] + across[0], step[1] + across[1]],
      ].find(free) || frontageOf(hall).find(free) || null;
      // Facing the way the hall faces, so the slot is towards whoever is walking up to it.
      if (beside) layout.plots['civic:mailbox'] = { gx: beside[0], gz: beside[1], w: 1, d: 1, rot: hall.rot };
      else unplaced.push('civic:mailbox');
    }
  }

  // ---- what stands on the square ---------------------------------------------
  // Lamps and flower beds want the edge, where they frame the space; benches and
  // terraces want the middle, where people actually sit. Both take their cells in a
  // fixed order, so the square fills up the same way every time and nothing that is
  // already standing is ever asked to move.
  {
    const centre = layout.town.centre;
    const paved = new Set((layout.town.paved || []).map((c) => `${c[0]},${c[1]}`));
    // The same reading of the square the two blocks above used, so a bench cannot be put
    // out on the cell the tables or a notice board are standing on.
    const busy = occupiedCells(layout);
    // Anything that cannot have its proper spot falls back to the outermost paving,
    // which keeps the middle of the square clear to walk across.
    const spare = (layout.town.paved || [])
      .filter((c) => !busy.has(`${c[0]},${c[1]}`))
      .sort((a, b) => dist2(a, centre) - dist2(b, centre));
    const taken = new Map();
    for (const f of model.furniture || []) {
      if (layout.plots[f.id]) continue;
      const spots = FURNITURE_SPOTS[f.kind] || [];
      let cell = null;
      for (let i = taken.get(f.kind) || 0; i < spots.length && !cell; i++) {
        taken.set(f.kind, i + 1);
        const c = [centre[0] + spots[i][0], centre[1] + spots[i][1]];
        const k = `${c[0]},${c[1]}`;
        if (paved.has(k) && !busy.has(k)) cell = c;
      }
      while (!cell && spare.length) {
        const c = spare.pop();
        if (!busy.has(`${c[0]},${c[1]}`)) cell = c;
      }
      if (!cell) { unplaced.push(f.id); continue; }
      busy.add(`${cell[0]},${cell[1]}`);
      layout.plots[f.id] = { gx: cell[0], gz: cell[1], w: 1, d: 1, rot: facing(cell, centre) };
    }
  }

  // ---- houses ----------------------------------------------------------------
  const houses = model.buildings
    .filter((b) => b.kind !== 'shed')
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const moved = [];
  // Which super-cells are spoken for. Derived from the plots themselves rather than from
  // a counter, so a house that was banished hands its cell back to the next arrival.
  const cellTaken = new Set();
  for (const [id, p] of Object.entries(layout.plots)) {
    if (id.startsWith('house:') && p.cell) {
      cellTaken.add(`${p.commons ? 'town' : p.district}|${p.cell[0]},${p.cell[1]}`);
    }
  }
  const commonsLobe = { seed: [0, 0], cells: layout.town.commons, green: 0 };

  function freeCellIn(rec, owner) {
    for (const [li, lobe] of (rec.lobes || []).entries()) {
      for (const c of parcelOrder(lobe)) {
        if (cellTaken.has(`${owner}|${c[0]},${c[1]}`)) continue;
        const [gx, gz] = blockOf(lat, c[0], c[1]);
        if (!grid.freeBlock(gx, gz, 3, 3, false)) continue;
        return { lobe, li, cell: c };
      }
    }
    return null;
  }

  for (const h of houses) {
    if (layout.plots[h.id]) continue;
    const rec = layout.districts[h.district];
    const allowBeach = h.harbour === true;
    let slot = rec ? freeCellIn(rec, h.district) : null;
    let owner = h.district, lobeIdx = slot ? slot.li : -1;

    // No room on our own land: grow it, and only then fall back to the commons. The
    // commons is a real place - a market town with houses around the square - not a bin.
    if (!slot && rec) {
      ensureParcel(sup, rec, (popOf.get(h.district) || 1) + 1, {
        k: ordOf.get(h.district), allowBeach, near: null, grid, lat, id: h.district,
      });
      slot = freeCellIn(rec, h.district);
      lobeIdx = slot ? slot.li : -1;
    }
    if (!slot) {
      growParcel(sup, commonsLobe, TOWN, commonsLobe.cells.length + 4, false, grid);
      layout.town.commons = commonsLobe.cells;
      slot = freeCellIn({ lobes: [commonsLobe] }, 'town');
      owner = 'town'; lobeIdx = -1;
    }
    if (!slot) { unplaced.push(h.id); continue; }

    const [gx, gz] = blockOf(lat, slot.cell[0], slot.cell[1]);
    const target = owner === 'town'
      ? townCentre
      : centreOfCell(lat, parentOf(slot.lobe, slot.cell));
    const rot = facing([gx + 1, gz + 1], target);
    grid.fillBlock(gx, gz, 3, 3, PLOT);
    layout.plots[h.id] = {
      gx, gz, w: 3, d: 3, rot,
      cell: slot.cell, district: h.district, lobe: lobeIdx,
      commons: owner === 'town' ? true : undefined,
    };
    cellTaken.add(`${owner}|${slot.cell[0]},${slot.cell[1]}`);
    moved.push(h.id);
  }

  // Paving waits until the sheds have claimed their yards further down, so a street
  // never costs the village a building.

  // ---- sheds: in the master's own yard ---------------------------------------
  const sheds = model.buildings
    .filter((b) => b.kind === 'shed')
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  // Which single cells are already a shed or a piece of furniture. This used to be a
  // scan of every plot per candidate cell, which on the re-parcelling scan - where every
  // shed is placed at once - came to nearly three million record comparisons.
  const smallTaken = new Set();
  for (const p of Object.values(layout.plots)) {
    if (p.w === 1) smallTaken.add(`${p.gx},${p.gz}`);
  }
  layout.shedOf = layout.shedOf || {};
  for (const s of sheds) {
    if (s.roomed) continue;                 // lodged in the master's tower, not in the yard
    if (layout.plots[s.id]) continue;
    const mp = layout.plots[s.master];
    if (!mp) { unplaced.push(s.id); continue; }
    const door = doorCell(mp.gx, mp.gz, mp.rot);
    const step = outsideDoor(mp.gx, mp.gz, mp.rot);
    // the eight yard cells of the master's plot, corners first, never the doorstep
    const yard = [];
    for (const [dx, dz] of YARD_RING) {
      const c = [mp.gx + 1 + dx, mp.gz + 1 + dz];
      if (c[0] === door[0] && c[1] === door[1]) continue;
      yard.push(c);
    }
    let cell = yard.find(([gx, gz]) => grid.get(gx, gz) === PLOT && !smallTaken.has(`${gx},${gz}`));
    if (!cell) {
      // No room in the yard, so the shed goes out into the lane - anywhere but the cell
      // the master's door opens onto. That cell is where the front path starts, so a shed
      // standing on it walls the house in: the path is still laid, from behind the shed,
      // and the door it was laid for cannot be reached. (Paving itself is refused by
      // `freeCell` already; this is the one cell that is still bare ground and must stay
      // that way.)
      for (let r = 2; r <= 4 && !cell; r++) {
        for (const [dx, dz] of RINGS[r]) {
          const c = [mp.gx + 1 + dx, mp.gz + 1 + dz];
          if (c[0] === step[0] && c[1] === step[1]) continue;
          if (grid.freeCell(c[0], c[1], false)) { cell = c; grid.set(c[0], c[1], PLOT); break; }
        }
      }
    }
    if (!cell) { unplaced.push(s.id); continue; }
    layout.plots[s.id] = { gx: cell[0], gz: cell[1], w: 1, d: 1, rot: (mp.rot + 2) % 4 };
    smallTaken.add(`${cell[0]},${cell[1]}`);
    layout.shedOf[s.id] = s.master;
  }

  // ---- one road per hamlet -----------------------------------------------------
  // Unmasked, and refusing the green it starts beside, so it has to leave and find the
  // town or a nearer neighbour. Laid in arrival order, so later hamlets braid onto the
  // lanes that already exist and the island grows a tree of country roads rather than
  // thirty parallel tracks. A road is laid once and is then as sticky as a building.
  //
  // (Until now these roads did not exist at all: the old code started one cell from the
  // square it had just filled, and routePath returns on the first square it reaches.)
  for (const d of districts) {
    const rec = layout.districts[d.id];
    if (!rec || !rec.lobes) continue;
    for (const [li, lobe] of rec.lobes.entries()) {
      if (lobe.road) continue;
      // Leave on the town-facing side, from the lane rather than the middle. A super-cell
      // is a three by three plot with its far row and column as lane, and `lobe.centre` is
      // the middle of that plot - so two cells out is always lane, in any direction, and
      // never the plot itself. It used to leave from outside the green; there is no green
      // to leave from now, and starting on a plot would give the road nowhere to begin.
      //
      // The goal is any square, and with the greens retired the only squares left on the
      // island are the town's own paving - so every hamlet road now runs to the centre
      // instead of stopping at whichever neighbour's green it met first.
      const rot = facing(lobe.centre, townCentre);
      const c = lobe.centre, out = 2;
      const from = rot === 0 ? [c[0], c[1] - out]
        : rot === 1 ? [c[0] + out, c[1]]
          : rot === 2 ? [c[0], c[1] + out]
            : [c[0] - out, c[1]];
      // A country road crosses the island, and the default search budget - sized for a
      // front path of a dozen cells - ran out halfway. There are only a couple of dozen
      // of these searches per island and each is made once, so let it look properly.
      const cells = routePath(grid, from, {
        isGoal: (cell, v) => v === SQUARE,
        budget: 250000,
        bridge: true,
      });
      if (!cells || cells.length <= 1) continue;
      const id = `road:${d.id}:${li}`;
      markRoad(grid, layout, id, cells);
      lobe.road = id;
    }
  }

  // ---- the way onto each polder --------------------------------------------------
  // A causeway ends on the mainland's buildable ground and nowhere in particular: until a
  // hamlet on the new land sends its own road to town it is paving that joins nothing,
  // which is the orphaned stretch tests/layout-measure.test.mjs exists to catch, and what
  // a settler walking onto a freshly drained polder would find. So every polder gets one
  // approach road, from the landward end of its causeway to the square, laid once and as
  // sticky as a hamlet road under a name of its own. Routed after the hamlet roads so it
  // braids onto them where it can; `markPath` records only what it paves itself, so an
  // approach that meets an existing lane at once costs the island a single square cell.
  for (const [n, p] of layout.polders.entries()) {
    const id = `road:polder:${n}:approach`;
    if (!(p.road || []).length || layout.paths.some((q) => q.id === id)) continue;
    const end = p.road[p.road.length - 1];
    const cells = routePath(grid, end, { isGoal: (cell, v) => v === SQUARE, budget: 250000, bridge: true });
    if (cells && cells.length > 1) markRoad(grid, layout, id, cells);
  }

  // ---- the crossing --------------------------------------------------------------
  // Here and not in the milestone loop: a bridge is a road, and until the line above has
  // run there is no road on the island for one to join. The trigger is the settler count
  // and nothing else, for the polders' own reason - a scan has to be a pure function of
  // the model, or a rescan of an unchanged island would build somewhere else and rewrite
  // layout.json, which is the one thing that must never happen.
  if (model.stats.settlers >= BRIDGE_AT) planBridge(grid, layout, townCentre, unplaced, lat);

  // ---- the harbours ----------------------------------------------------------------
  // Four ways off the island instead of one, each with its own road to the square - see
  // planHarbours and Plans/vier-havens.md. Planned once, like the fairway, and after the
  // hamlet roads so an approach braids onto the lanes that are already there - and after the
  // crossing, or an approach that meets the river bridges it first and the island's own
  // bridge, seeing the reach already crossed, is never built (tests/bridge.test.mjs).
  if (layout.harbours == null) layout.harbours = planHarbours(grid, terrain, layout, townCentre);
  for (const [n, h] of layout.harbours.entries()) {
    if (!h || !(h.slip || []).length) continue;
    const slipId = `road:harbour:${n}`;
    if (!layout.paths.some((q) => q.id === slipId)) markPath(grid, layout, slipId, h.slip);
    const id = `road:harbour:${n}:approach`;
    if (layout.paths.some((q) => q.id === id)) continue;
    const end = h.slip[h.slip.length - 1];
    const cells = routePath(grid, end, { isGoal: (cell, v) => v === SQUARE, budget: 250000, bridge: true });
    if (cells && cells.length > 1) markRoad(grid, layout, id, cells);
  }

  // ---- the office at the gate --------------------------------------------------
  // Every district that is a git repository gets an office. It used to stand on the
  // green, and there is no green now - so it takes a free cell beside the one its road
  // leaves by, which is the entrance and where somebody arriving would look for it. It
  // has to come after the roads for the same reason it once had to come after the
  // greens: the thing it stands next to has to exist first.
  for (const d of model.districts) {
    if (!d.gitRepo) continue;
    const id = `civic:office:${d.id}`;
    if (layout.plots[id]) continue;
    const rec = layout.districts[d.id];
    const lobe = rec && rec.lobes && rec.lobes[0];
    if (!lobe || !lobe.road) continue;                  // a lone farmstead has no road
    const road = layout.paths.find((r) => r.id === lobe.road);
    if (!road || !road.cells.length) continue;
    const [hx, hz] = road.cells[0];
    let at = null;
    for (const [dx, dz] of N4) {
      const c = [hx + dx, hz + dz];
      if (grid.freeCell(c[0], c[1], false)) { at = c; break; }
    }
    if (!at) continue;
    grid.set(at[0], at[1], PLOT);
    layout.plots[id] = { gx: at[0], gz: at[1], w: 1, d: 1, rot: facing(at, [hx, hz]) };
  }

  // ---- front paths -------------------------------------------------------------
  // Left until the sheds have claimed their yards, so a road never costs a building.
  //
  // A front path walks from the doorstep to the nearest paving of any kind, and that is
  // the whole rule. It used to look for a *square*, masked to the house's own parcel -
  // written when every hamlet had a green in the middle of it to walk to. The greens were
  // retired and nobody noticed that the mask then contained no square at all: the search
  // found nothing, `markPath` was handed null, and for several releases this island had
  // exactly nought front paths. Measured on the village as it stands: seven houses of
  // forty-six had a door that happened to open onto paving, and thirty-nine did not.
  //
  // Any paving instead of a square is also the better rule now that there is no green.
  // What a door wants is the lane, and the lane is whatever the neighbours have already
  // paved; REUSE makes joining an existing one nearly free, so the stubs braid together
  // into a handful of streets through the hamlet rather than each cutting its own line.
  // The budget is raised because the search is no longer boxed into one parcel - a house
  // on the edge of a young hamlet may have to walk a fair way to meet the first stone.
  for (const id of moved) {
    const p = layout.plots[id];
    markPath(grid, layout, `path:${id}`, routePath(grid, outsideDoor(p.gx, p.gz, p.rot), {
      isGoal: (cell, v) => v === PATH || v === SQUARE || v === BRIDGE,
      budget: 60000,
    }));
  }

  // ---- front paths, relaid ------------------------------------------------------
  // A house is pathed on the scan that places it and never again, which is enough right
  // up until the road it leaned on moves. A door that opened straight onto a trunk road
  // recorded no path of its own - `markPath` keeps only the cells it paved itself - so
  // there is nothing on record to re-route and nothing to say the house ever had a way
  // out. Re-route that trunk, which is exactly what a ROAD_VERSION bump does, and the
  // door is left in the grass. Measured on this island the first time the polder roads
  // were relaid: one house of sixty-one, and the only thing that would ever have said so
  // is somebody walking up to it.
  //
  // So a house with neither paving at its door nor a path of its own is given one here.
  // Only those: a path that still reaches the lane is somebody's street by now, and
  // re-routing the ones that are fine would move streets for no reason. Sorted, because
  // the order two of these are laid in decides which of them pays for the shared stretch
  // and a scan must come out the same every time.
  for (const [id, p] of Object.entries(layout.plots).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!id.startsWith('house:')) continue;
    if (layout.paths.some((q) => q.id === `path:${id}`)) continue;
    const door = outsideDoor(p.gx, p.gz, p.rot);
    const at = grid.get(door[0], door[1]);
    if (at === PATH || at === SQUARE || at === BRIDGE) continue;       // already on the lane
    markPath(grid, layout, `path:${id}`, routePath(grid, door, {
      isGoal: (cell, v) => v === PATH || v === SQUARE || v === BRIDGE,
      budget: 60000,
    }));
  }

  // ---- the quay deck ---------------------------------------------------------
  // The quay owns water rather than ground. Its ordinary path records still matter -
  // they are the stable street plan and the graph the settlers follow - but inside this
  // one district those cells are rendered as planks. The extra cells below join that
  // street plan to every front deck and to the old pier, so the quay is one continuous
  // piece of construction rather than a pier, some paths and a row of isolated houses.
  //
  // Derived on every scan: unlike a house or a pier, a run of boards is not land in the
  // register and may grow when the parcel or its paths grow. Keeping it on the district
  // nevertheless means the browser, the walking graph and the drawing all consume the
  // exact same cells.
  for (const d of districts) {
    if (d.kind !== 'quay') continue;
    const rec = layout.districts[d.id];
    if (!rec || !rec.lobes?.length) continue;
    const basin = new Set();
    for (const lobe of rec.lobes) {
      for (const [i, j] of lobe.cells || []) {
        const [gx, gz] = blockOf(lat, i, j);
        for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) {
          basin.add(`${gx + x},${gz + z}`);
        }
      }
    }
    const deck = new Map();
    const put = (c) => { if (c && grid.in(c[0], c[1])) deck.set(`${c[0]},${c[1]}`, c); };
    for (const p of layout.paths) {
      for (const c of p.cells || []) if (basin.has(`${c[0]},${c[1]}`)) put(c);
    }

    // A three-cell plot puts its house in the middle and its outside doorstep two cells
    // away. The broad deck belongs to the building model; these two boards bridge the
    // remaining half-cell and meet the street at the recorded outside doorstep.
    for (const h of houses) {
      if (!h.harbour || h.district !== d.id) continue;
      const p = layout.plots[h.id];
      if (!p) continue;
      p.quay = true;
      put(doorCell(p.gx, p.gz, p.rot));
      put(outsideDoor(p.gx, p.gz, p.rot));
    }

    // Join the landward end of the pier to the nearest street and walk around every
    // building plot. Usually that is only the quay's boundary cell. Older layouts kept
    // their real pier through a re-parcelling, though, and can have water and houses a
    // fair distance apart; allowing the boardwalk across that gap repairs those islands
    // without moving either a house or construction that was already recorded. A
    // breadth-first walk makes the shortest orthogonal connection and, because N4 is
    // fixed, makes the same choice on every scan.
    if (rec.shore && deck.size) {
      const start = rec.shore;
      const goals = new Set(deck.keys());
      const blocked = new Set();
      for (const p of Object.values(layout.plots)) {
        for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) blocked.add(`${p.gx + x},${p.gz + z}`);
      }
      const sk = `${start[0]},${start[1]}`;
      const q = [start], prev = new Map([[sk, null]]);
      let end = goals.has(sk) ? start : null;
      for (let at = 0; at < q.length && !end; at++) {
        const cur = q[at];
        for (const [dx, dz] of N4) {
          const n = [cur[0] + dx, cur[1] + dz], k = `${n[0]},${n[1]}`;
          if (prev.has(k) || !grid.in(n[0], n[1]) || (blocked.has(k) && !goals.has(k))) continue;
          prev.set(k, cur); q.push(n);
          if (goals.has(k)) { end = n; break; }
        }
      }
      if (end) {
        for (let c = end; c; c = prev.get(`${c[0]},${c[1]}`)) put(c);
        put(start);
      }
    }
    rec.deck = [...deck.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  // ---- cleared ground (the forest never grows back) ---------------------------
  const cleared = new Set(layout.cleared.map(([gx, gz]) => `${gx},${gz}`));
  const add = (gx, gz) => cleared.add(`${gx},${gz}`);
  for (const p of Object.values(layout.plots)) {
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) add(p.gx + x, p.gz + z);
  }
  for (const p of layout.paths) for (const [gx, gz] of p.cells) add(gx, gz);
  // A deck is a road with water under it, so the trees keep off it for the same reason
  // they keep off a road. Without this the forest closed over every crossing on the island.
  for (const b of layout.bridges) for (const [gx, gz] of b.cells) add(gx, gz);
  layout.cleared = [...cleared].map((s) => s.split(',').map(Number)).filter(([gx, gz]) => grid.in(gx, gz));

  return { layout, terrain, unplaced };
}

// The last resort for a civic building whose reserved lot is gone: the nearest free
// block on the town's own lattice. Houses no longer come through here - they take a
// super-cell of their district's parcel, or a place on the commons.
function findBlockAround(grid, centre, { skipRing0 = false, allowBeach = false } = {}) {
  for (let r = skipRing0 ? 1 : 0; r <= MAX_RING; r++) {
    for (const [dx, dz] of RINGS[r]) {
      const [gx, gz] = blockAt(centre, dx, dz);
      if (grid.freeBlock(gx, gz, 3, 3, allowBeach)) return [gx, gz];
    }
  }
  return null;
}

function dist2(a, b) { const dx = a[0] - b[0], dz = a[1] - b[1]; return dx * dx + dz * dz; }
function nearestCell(cells, to) {
  let best = null, bd = Infinity;
  for (const c of cells) { const d = dist2(c, to); if (d < bd) { bd = d; best = c; } }
  return best;
}
function farthestFrom(cells, from) {
  let best = null, bd = -1;
  for (const c of cells) { const d = dist2(c, from); if (d > bd) { bd = d; best = c; } }
  return best;
}

// Which way is the open sea from a shore cell, and how much of it there is.
// ---- open water -------------------------------------------------------------
// Water a boat could arrive over, which is the only water a quay cares about.
//
// `terrain.coastCells` is every land cell with water beside it, and the island has three
// kinds: the sea, the lake up by the hill, and the rivers running down to the coast. All
// three are water, so all three are "coast" - and the shore picker rewards a shore near
// the town, which on this island made the lake six cells from the square the finest
// harbour in the archipelago. A pier there is a jetty on a pond: the boat the quay exists
// for comes in off the sea, and nothing that floats can reach the middle of the island.
//
// So: flood from the edge of the grid inward over water, and what the flood reaches is
// sea. The lake is never reached because it has no way out. A river would be - it meets
// the sea at its mouth - so river cells stop the flood, which also keeps the sea from
// creeping a few cells up the mouth and offering the quay a berth in the delta. Both
// exclusions are the same rule stated twice: you may moor where a hull could lie, not
// where a stream happens to be below sea level.
//
// One pass over the grid, memoised per terrain object - `placeAll` builds a new one every
// time the coast moves, so the mask can never outlive the ground it describes.
const seaMasks = new WeakMap();
function seaMask(terrain) {
  const known = seaMasks.get(terrain);
  if (known) return known;
  const n = terrain.size;
  const mask = new Uint8Array(n * n);
  const queue = [];
  const push = (gx, gz) => {
    if (gx < 0 || gz < 0 || gx >= n || gz >= n) return;
    const i = gx + gz * n;
    if (mask[i] || !terrain.isWater(gx, gz) || terrain.isRiver(gx, gz)) return;
    mask[i] = 1;
    queue.push(gx, gz);
  };
  for (let g = 0; g < n; g++) { push(g, 0); push(g, n - 1); push(0, g); push(n - 1, g); }
  // A flat queue read by index, not a shift(): the sea of a 256-grid is some forty
  // thousand cells and shifting each one off the front is quadratic.
  for (let h = 0; h < queue.length; h += 2) {
    const gx = queue[h], gz = queue[h + 1];
    push(gx + 1, gz); push(gx - 1, gz); push(gx, gz + 1); push(gx, gz - 1);
  }
  seaMasks.set(terrain, mask);
  return mask;
}
const openWater = (terrain, gx, gz) =>
  terrain.inGrid(gx, gz) && seaMask(terrain)[gx + gz * terrain.size] === 1;

// Where the quay's planks go: a coast cell, the way out to sea off it, and the run of
// water the planks cover. Three things are weighed, and the third is the one that took a
// while to notice.
//
// A long run out (`dir.n`) is what makes a pier a pier, and nearness to the town is what
// keeps the quay a part of the village rather than a jetty round the headland. Those two
// alone put this island's quay hard against the east bank of its bay: six cells of water
// on one side of the head and one on the other, which from above reads as a plank laid
// along a shore rather than a pier standing in water. So the third term is how far the
// water reaches either side of the head, counted as the *smaller* of the two - a pier
// against a bank scores one whatever the far side is doing, and only a pier with room on
// both sides scores well.
//
// The weight is what keeps this a nudge. Three cells along this coast buys three points of
// middle against one and a half of distance, so the quay steps off the bank; a berth six
// cells wider on the far side of the island is twenty cells away and never wins.
const PIER_MIDDLE = 0.6;
const PIER_FLANK = 6;          // how far either side is worth looking, in cells

function pickPier(terrain, townCentre, accept = null) {
  // Sea coast only, and filtered before the slice rather than after: the two hundred cells
  // nearest the town are otherwise all riverbank, every one of them refused by
  // `seawardDirection`, and the quay ends up with no planks at all. `accept` narrows it
  // further the same way, before the slice - see planHarbours.
  const coast = terrain.coastCells
    .filter((c) => N4.some(([dx, dz]) => openWater(terrain, c[0] + dx, c[1] + dz)) && (!accept || accept(c)))
    .sort((a, b) => dist2(a, townCentre) - dist2(b, townCentre));
  let bestScore = -Infinity, best = null;
  for (const c of coast.slice(0, 200)) {
    const dir = seawardDirection(terrain, c);
    if (!dir) continue;
    const pier = pierCells(terrain, c, dir.d);
    if (!pier.length) continue;
    const score = dir.n * 1.6 - Math.sqrt(dist2(c, townCentre)) * 0.5
      + middleOf(terrain, pier[pier.length - 1], dir.d) * PIER_MIDDLE;
    if (score > bestScore) { bestScore = score; best = { shore: c, pier }; }
  }
  return best;
}

// ---- the harbours ----------------------------------------------------------------
// One harbour per side of the island - north, east, south and west of the town centre -
// each picked by `pickPier` with its coast narrowed to that side, so they score exactly
// the way the quay always has. The quay, if the island has one, *is* the harbour of its
// own side: its planks are copied in, never re-picked, because they are sticky and a
// house stands behind them.
//
// Each harbour also gets a slipway: from its shore cell straight inland, over the beach,
// to the first cell a road may be laid on. Beach is BLOCKED in the grid, so an approach
// road routed from the shore itself would find no way off it; the slip is paved like a
// polder's causeway and forced back on every scan. A side whose best pier cannot reach
// such a cell within SLIP_MAX gets no harbour (a null in the list, which is still "asked").
export const HARBOUR_SIDES = ['n', 'e', 's', 'w'];
const SLIP_MAX = 8;

// Which side of the town a cell lies on. -z is north. A plain comparison, no atan2.
export function sideOf(c, centre) {
  const dx = c[0] - centre[0], dz = c[1] - centre[1];
  if (Math.abs(dz) >= Math.abs(dx)) return dz < 0 ? 'n' : 's';
  return dx > 0 ? 'e' : 'w';
}

// From the shore straight away from the planks until a road can start. The cells walked
// over are the slip; it ends *on* the first FREE cell (so the road has somewhere to leave
// from) or just short of an existing PATH or SQUARE (which already is the road).
function slipFrom(grid, terrain, shore, pier) {
  const head = pier[0];
  const step = [shore[0] - head[0], shore[1] - head[1]];
  const slip = [shore];
  let c = shore;
  for (let i = 0; i < SLIP_MAX; i++) {
    const next = [c[0] + step[0], c[1] + step[1]];
    if (!grid.in(next[0], next[1]) || !terrain.isLand(next[0], next[1])) return null;
    const v = grid.get(next[0], next[1]);
    if (v === FREE) return [...slip, next];
    if (v === PATH || v === SQUARE) return slip;
    if (v !== BLOCKED) return null;       // a plot, a pier or a dike is in the way
    slip.push(next);
    c = next;
  }
  return null;
}

// The quay the island already shows, so it can be the harbour of its own side rather than
// have a new one picked beside it: the quay district's planks where there are some, and
// otherwise the quay every viewer derives from the landing (shared/quay.mjs's quayFor with
// no planks - the same sum the page and the sea do), if that one stands in the open sea.
// An island with no Cowork task has never had a quay district, and its dock and its boat
// are that derived one: picking the east harbour afresh moved them both along the coast.
function standingQuay(terrain, layout) {
  const q = layout.districts && layout.districts.quay;
  if (q && (q.pier || []).length && q.shore) return { shore: q.shore, pier: q.pier };
  const derived = layout.landing ? quayFor(terrain, layout.landing) : null;
  if (derived && derived.cells.length && derived.cells.every(([gx, gz]) => openWater(terrain, gx, gz))) {
    return { shore: derived.shore, pier: derived.cells };
  }
  return null;
}

function planHarbours(grid, terrain, layout, townCentre) {
  const standing = standingQuay(terrain, layout);
  const standingSide = standing ? sideOf(standing.shore, townCentre) : null;
  return HARBOUR_SIDES.map((side) => {
    const found = side === standingSide
      ? standing
      : pickPier(terrain, townCentre, (c) => sideOf(c, townCentre) === side);
    if (!found) return null;
    const slip = slipFrom(grid, terrain, found.shore, found.pier);
    if (!slip) return null;
    for (const [gx, gz] of found.pier) grid.set(gx, gz, PIER);
    for (const [gx, gz] of slip) grid.set(gx, gz, FREE);
    return { side, shore: found.shore, pier: found.pier, slip };
  });
}

// The harbour a quay founded after the harbours should take: the one nearest the town.
function nearestHarbour(layout, townCentre) {
  let best = null;
  for (const h of layout.harbours || []) {
    if (h && (!best || dist2(h.shore, townCentre) < dist2(best.shore, townCentre))) best = h;
  }
  return best ? { shore: best.shore, pier: best.pier } : null;
}

// How much water the head has to the narrower of its two sides, up to PIER_FLANK.
function middleOf(terrain, head, dir) {
  const across = [dir[1], -dir[0]];
  let least = PIER_FLANK;
  for (const side of [1, -1]) {
    let k = 0;
    while (k < PIER_FLANK && openWater(terrain, head[0] + across[0] * side * (k + 1), head[1] + across[1] * side * (k + 1))) k++;
    least = Math.min(least, k);
  }
  return least;
}

function seawardDirection(terrain, cell) {
  let best = null, bestN = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let n = 0;
    for (let i = 1; i <= 6; i++) { if (!openWater(terrain, cell[0] + dx * i, cell[1] + dz * i)) break; n++; }
    if (n > bestN) { bestN = n; best = [dx, dz]; }
  }
  return best ? { d: best, n: bestN } : null;
}

// Planks from the shore cell out over the water, stopping at the far side of an inlet.
function pierCells(terrain, shore, dir) {
  const cells = [];
  for (let i = 1; i <= 5; i++) {
    const c = [shore[0] + dir[0] * i, shore[1] + dir[1] * i];
    if (!openWater(terrain, c[0], c[1])) break;
    cells.push(c);
  }
  return cells;
}

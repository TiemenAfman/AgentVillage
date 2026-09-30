// Where everything stands. Two rules govern this file:
//   1. Deterministic  - the same village always produces the same town.
//   2. Sticky         - a building that already has a plot is never moved again,
//                       even if the algorithm below changes later.
// data/layout.json is therefore the source of truth; we only ever add to it.
import {
  makeTerrain, openWaterOf, BEACH_MAX, CHANNEL_H, foundingCoast, gridForCoast, RELIEF_VERSION, WATER_VERSION,
  WORKS_VERSION, FUNNEL_MAX, funnelCells, funnelHas, cornerDistance2, workProfile, KADE_REACH, levelKade,
} from '../shared/terrain.mjs';
import { makeRng, makeSimplex2D, fbm2, hash32 } from '../shared/rng.mjs';
import { QUAY_REACH, quayFor, mooringsFor, shipBerth, shipWater, shipWaterOf, SHIP_LANE, BOATS_PER_HARBOUR } from '../shared/quay.mjs';
import { PITCH, blockOf, cellsOfSuper, centreOfCell, superOf } from '../shared/lattice.mjs';
import { placeIsland } from '../shared/regions.mjs';
import { readJson, writeJsonAtomic } from './paths.mjs';
import { reachableFromSquare, GATE_REACH } from '../shared/roads.mjs';
import { GOLDPIT_ID, GOLDMINE_ID, GOLDSMITH_ID } from '../shared/gold.mjs';
import { civicIdOf, reachedOf } from './village.mjs';
import { chestSpots } from '../shared/treasure.mjs';

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
// Version 3 moves the houses to the resort on the sea and leaves the planks: see `migrateQuay`.
export const QUAY_VERSION = 3;
// The town's own buildings are laid out again when this changes, and no house or shed is:
// see `migrateTown` and Plans/DONE/knus-dorpscentrum.md. The square and its middle stay where they
// are - the lattice is anchored on that middle, so moving it would move every hamlet - and so
// does everything on the square, the castle and every building outside the centre. It sits
// between SQUARE_VERSION and PARCEL_VERSION in violence: every civic lot of the centre is
// placed again, and every road and path is routed again around the new streets.
export const TOWN_VERSION = 1;

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
const MAX_LOBES = 3;             // the quay's stretches of shore; a project keeps to one (growLobe)
const ANNEX_REACH = 8;           // and that annex stays within sight of the parcel it left
const OFFICE_REACH = 4;          // road cells from the gate a hamlet's office may stand beside
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
// Exported for lib/plan.mjs's `merge`, which gives a hamlet the gardens a scan would.
export const parcelTarget = (n) => Math.max(4, 1 + Math.ceil(n / FILL(n)));
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
// `grow` is how the island has grown (makeTerrain's option, Plans/DONE/eiland-laten-groeien.md):
// null for an island founded on the whole grid, which is every island before growing.
export function emptyLayout(seed, size, grow = null) {
  return {
    v: LAYOUT_VERSION, parcelV: PARCEL_VERSION, squareV: SQUARE_VERSION, roadV: ROAD_VERSION,
    quayV: QUAY_VERSION, townV: TOWN_VERSION,
    seed, size, grow, terrainHash: null,
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
    // The most settlers the village has ever had at once, which its milestones are counted
    // in (lib/village.mjs, Plans/DONE/tenten-vertrekken.md); scan.mjs fills the counts in. `since`
    // is when tents began to leave, and a new island - or a town thrown away and planned
    // again - has no past from before that to keep, so it is 0: the rule has always held.
    // A layout from before the rule has no `ladder` at all, and its first scan starts one
    // at that moment instead, so that nothing it already had moves.
    ladder: { since: 0 },
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

// `minSize` is where a new island starts (config.minGridSize, Plans/DONE/eiland-laten-groeien.md):
// an island founded on less than its whole grid, which grows out to `size` as its village
// asks for room. It only ever decides a *new* layout - one that already stands keeps the
// `grow` it was founded with, and one founded on its whole grid never grows.
export function foundingGrowth(size, minSize) {
  const m = Number(minSize);
  if (!Number.isInteger(m) || m < 16 || m >= size || (size - m) % 2) return null;
  return { base: m, steps: [] };
}

// `size` is the grid a new island is founded on (config.gridSize). The grid an island stands on is its own `l.size`, which a growth step can enlarge
// (`growCanvas`) and nothing ever shrinks - so a layout on a different grid from the setting
// is kept, not thrown away. It used to be thrown away, which is what made `gridSize` a
// number that could never change once a town stood on it; raising it now only gives the
// island room to grow into. A different seed or LAYOUT_VERSION is still a new island.
export function loadLayout(file, seed, size, { minSize = null } = {}) {
  const l = readJson(file, null);
  if (!l || l.v !== LAYOUT_VERSION || l.seed !== seed || !Number.isInteger(l.size)) return emptyLayout(seed, size, foundingGrowth(size, minSize));
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
  // The island's shape, as grown. Null on every island that was founded on the whole grid.
  l.grow = l.grow || null;
  return migrateTown(migrateSquare(migrateRoads(migrateParcels(l))));
}

// A one-time re-planning of the town centre (Plans/DONE/knus-dorpscentrum.md): a ring of civic
// buildings round the square and four shopping streets leaving it, with the workshops out
// beyond them. The old centre was the eight lots round the square and then whatever was
// nearest - the sawmill and the smithy pressed against the ring, the market, the chapel and
// the school beside their lots - and there is no way to tidy that up one building at a time.
//
// What goes is every three by three civic lot the centre lays out itself (TOWN_LAID), the
// postbox that stands on the hall's pavement, the reserved lots and the paving. Every road and
// path goes too, as in `migrateRoads`: a hamlet road or a front path may run straight across
// a future shop, and a path is derived geometry that nothing stands on, so it is routed again
// around the new streets in the same scan rather than left to block one of them for good.
// The castle stays - it is seven wide and never moves by itself - and so does everything on
// the square, every house and shed, the bridges and the keeper's own roads (`layout.roads`,
// replayed by `replayKeeperRoads`). A plot the keeper once dragged goes back to the plan
// once; from then on the keeper may move it again.
function migrateTown(l) {
  if (l.townV === TOWN_VERSION) return l;
  l.townV = TOWN_VERSION;
  if (!l.town) return l;
  for (const [id, p] of Object.entries(l.plots)) {
    const type = id.startsWith('civic:') ? id.slice('civic:'.length) : null;
    // The pirate's chest stands beside the tavern's door like the postbox beside the hall's, so it
    // is lifted with the tavern and set down beside the new door - unless the Salty Kraken stands,
    // which the chest is behind and which this does not move.
    const pubHosts = type === 'pirate' && Object.hasOwn(l.plots, PUB_ID);
    if (type && ((p.w === 3 && TOWN_LAID.has(type)) || type === 'mailbox' || (type === 'pirate' && !pubHosts))) delete l.plots[id];
  }
  delete l.town.lots;
  delete l.town.paved;
  delete l.town.streets;
  clearRoads(l);
  return l;
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
//
// Version 3 moves the houses and nothing else: off the harbour and onto the resort on the sea
// (`moveToResort`, Plans/quay-op-zee.md). The planks stay where version 2 put them - they are the
// quay's harbour now - which is why the branch below is `=== 1` and not `>= 1`: a layout at 2
// taken through it would have its planks picked again, and on Hoogezand `pickPier` answers
// (163,264) today where they stand at (154,284). The move itself is the resort's own, made when
// the resort is founded (`planResort`, earlier in `placeAll`), so an island founded after this and
// one carried over from before it take the same road; this only asks it again for any house it
// left behind, which on an island without a resort is none.
function migrateQuay(l, terrain, townCentre, model = null) {
  if (l.quayV === QUAY_VERSION) return l;
  const from = l.quayV || 0;
  l.quayV = QUAY_VERSION;
  const q = l.districts && l.districts.quay;
  if (!q || !l.lattice) return l;
  if (from === 2) {
    if (moveToResort(l, model).length) pruneUnreachable(l, terrain.size);
    return l;
  }
  const wasOnWater = from === 1;

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
  return unsettleQuay(l);
}

// The quay district taken off its planks: pier, houses, sheds, paths and the land register,
// so the district loop founds it again at a pier that reaches the water. `migrateQuay` does
// this for a quay planned before it had to stand at the sea; a growth step does it when the
// ground it lays fills the quay's water (`growStep`). Its houses move - the one place on the
// island a house does, and on purpose: a quay in a meadow protects nobody.
function unsettleQuay(l) {
  const q = l.districts && l.districts.quay;
  if (!q || !l.lattice) return l;
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
  // The resort's road stays with the resort, which a ring does not move (`resortWater`).
  l.paths = l.paths.filter((p) => !String(p.id).startsWith('road:quay:') || p.id === RESORT_ROAD);
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
// The island's escape valve. `gridSize` could not grow when this was written - it was the
// terrain's own argument, so raising it moved the coast and reset the town square - and by
// around three hundred houses the buildable blocks are gone and new projects stop getting a
// hamlet at all. So the village takes land off the water instead. An island may grow now
// (growStep, growCanvas below), and while it can the ladder waits: see `reclaim`.
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
//
// `{ shore: true }` is the keeper's version and lets a super-cell the coastline runs
// through count too: its land stays as it is (`polderFromSupers` leaves it out) and only
// the wet part is drained. Without it a hand could only reclaim where the shore happens to
// fall on a super-cell edge - the all-water cell next to the beach touches the shore only
// if the ring of cells round it is solid land, and on a coast with a strip of shallows
// before the sand that ring is water, while the cell with the sand in it is "already
// land". The ladder keeps the strict rule: a change there would dig different polders on
// islands that already have theirs.
export function polderCandidate(terrain, lat, i, j, dredged, { shore = false } = {}) {
  const [gx, gz] = blockOf(lat, i, j);
  let wet = 0;
  for (let z = 0; z < lat.pitch; z++) {
    for (let x = 0; x < lat.pitch; x++) {
      const cx = gx + x, cz = gz + z;
      if (!terrain.inGrid(cx, cz)) return false;
      if (shore && terrain.isLand(cx, cz)) continue;
      if (!shore && !terrain.isWater(cx, cz)) return false;
      if (dredged.has(ckey([cx, cz]))) return false;
      if (terrain.heightAt(cx, cz) < POLDER_DEPTH) return false;
      wet++;
    }
  }
  return wet > 0;
}

// Whether any of a super-cell is land already: for a keeper's polder, that is its shore.
export function holdsLand(terrain, lat, i, j) {
  const [gx, gz] = blockOf(lat, i, j);
  for (let z = 0; z < lat.pitch; z++) {
    for (let x = 0; x < lat.pitch; x++) if (terrain.isLand(gx + x, gz + z)) return true;
  }
  return false;
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
// `refused` is the cells of polders `reclaim` has already dug and filled in again this scan,
// because their wall shut a ship off from the sea - kept water, like the fairway.
function planPolder(terrain, lat, layout, refused = null) {
  const R = Math.ceil(terrain.size / lat.pitch) + 1;
  const town = superOf(lat, layout.town.centre[0], layout.town.centre[1]);
  const dir = DIRS8[makeRng(layout.seed).fork('polder').fork(String(layout.polders.length)).int(8)];

  // The seed cell: out along this polder's bearing, and as far along it as the shore
  // reaches. Every comparison is an integer tuple, so no rounding decides where land
  // appears.
  // Zoned water counts as dredged here: a no-build zone drawn over the shallows is the
  // keeper saying this stays sea, and the ladder must not wall it in on the next rung. So do
  // the water a ship lies on and the yard's slipway, and the ring round both (`keptWater`).
  const dredged = keptWater(layout);
  if (refused) for (const k of refused) dredged.add(k);
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
        // Land inside a super-cell stays land. Only a keeper's polder along a coast has any
        // (see polderCandidate); for the ladder's this never skips a cell.
        if (terrain.isLand(gx + x, gz + z)) continue;
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
  const ground = () => makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway, works: layout.works || null, grow: layout.grow || null });
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
function reclaim(seed, size, lat, layout, settlers, cap = size) {
  // An island that can still grow gets its room from growing, not from the ladder. The
  // ladder counts settlers, so on an island founded small with a village already waiting it
  // asked for eight polders round a coast of fifteen; the growth then laid its rings over
  // them and left eight dikes standing in the meadow - ground nobody may build on, in the
  // middle of the town. Once the island has reached its grid the ladder takes over, from
  // the coast the island ended with.
  if (canGrowFurther(layout, cap)) return null;
  const want = poldersWanted(settlers);
  // Land the keeper gave back to the sea (lib/plan.mjs `unpolder`) still counts as a rung
  // taken, or the scan after an un-poldering would dig the same coast up again.
  const rungs = () => layout.polders.length + (layout.poldersReturned || 0);
  if (rungs() >= want) return null;
  const ground = () => makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway, works: layout.works || null, grow: layout.grow || null });
  let terrain = ground();
  let changed = false;
  // A polder the keeper drained by hand counts as a rung: the ladder exists for capacity,
  // and land is land whoever took it. So an island with a manual polder waits one rung
  // longer for its first planned one.
  //
  // A polder that would shut a ship or the yard off from the sea is filled in again before
  // anything reads it - its wall closed the mouth of the bay she lies in, which no rule about
  // cells sees coming (`afloatDrowned`) - and its water is kept for this scan, so the next
  // candidate along the bearing is tried instead. Nothing of it is written down: the scan
  // after this one plans the same rung against the same ground and refuses it the same way.
  const refused = new Set();
  while (rungs() < want) {
    const p = planPolder(terrain, lat, layout, refused);
    if (!p) break;                                   // the shallows are all reclaimed
    const before = terrain;
    terrain = digPolder(seed, size, layout, p);
    if (afloatDrowned(layout, terrain)) {
      layout.polders.pop();
      terrain = before;
      for (const c of p.cells) refused.add(ckey(c));
      continue;
    }
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
  // And the resort on the sea as it will grow, with the ring round it (`resortKeep`).
  for (const k of resortKeep(layout)) held.add(k);
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

// ---- keeping the river's mouth open, and the ponds a ring shut in ----------------------
// A growth ring is drawn without knowing what water hangs on the ground it covers, and the
// two things it can break are the same kind of thing: water that no longer reaches the sea.
// Steps drawn from now on prevent it themselves (`water: 1`: `settleRing` in
// shared/terrain.mjs decides lanes and ponds, `growStep` writes them on the step). A step
// already taken can never be drawn differently - its ground is in the island's hash - so an
// island that has one is mended here, at the layout's level, in `layout.works` (checkWorks in
// shared/terrain.mjs): earthworks with a profile, with the hash put on record again straight
// after the ground changed (the same ordering as a polder's pools, `digPolder`).
//
//   repairFairway   the channel's seaward end is no longer joined to open water (a ring
//                   raised a spit across it): dig a way to the sea through ground nobody
//                   stands on (`works.dig`);
//   fillRingPonds   water a ring shut in, that nothing belongs to: fill it (`works.fill`);
//   planHaven       the harbour funnel, once the harbours are planned (`works.haven`, and a
//                   dig to open its head).
//
// All three run in `placeAll` before anything is placed, and all three are a no-op on the
// scan after.

// Whether the channel's seaward end - `line[0]`, the centreline runs from the sea inward - is
// water the tide reaches. A channel with no line (no river, or nothing to dig) has no mouth
// to keep open.
export function fairwayReaches(terrain, fairway) {
  const end = fairway && fairway.line && fairway.line[0];
  if (!end || !terrain.inGrid(end[0], end[1])) return true;
  return openWaterOf(terrain)[end[0] + end[1] * terrain.size] === 1;
}

// The layout's earthworks with a change, as a new record (the old one is never edited in place:
// a caller may still hold it). `v` goes on every record written, so a record is never mistaken
// for one of an older or newer rule.
function worksWith(layout, patch) {
  return { ...(layout.works || {}), v: WORKS_VERSION, ...patch };
}
// Every cell the layout calls channel: the fairway's own and every dig's. What a new ring's
// lanes run to (`growStep`) and what a pond may not be filled against (`fillRingPonds`).
function channelCells(layout) {
  const out = [...((layout.fairway && layout.fairway.cells) || [])];
  for (const d of (layout.works && layout.works.dig) || []) out.push(...d.cells);
  return out;
}

// Civics a mended channel may take out of its way. They are the ones a growth ring already
// moves when it drowns their water (`doomedBy`), so a scan that places them again is the
// established way for them to move; nothing else that stands is ever dug under.
const DREDGE_LIFTS = ['civic:crane', 'civic:lighthouse'];
const DREDGE_MAX = 90;             // cells of new channel: past this it is a canal, not a mouth
let dredgeWarned = false;

// The cells a channel must stay clear of: everything fairwayHeld holds, a harbour's planks and
// slipway, and the water a ship or the yard lies in with the ring round it - less the
// civics in `lifts`, which are `soft` instead (dug through only when nothing cheaper does).
function dredgeHeld(layout, lifts) {
  const liftPaths = new Set(lifts.map((id) => `path:${id}`));
  const held = fairwayHeld({
    ...layout,
    plots: Object.fromEntries(Object.entries(layout.plots || {}).filter(([id]) => !lifts.includes(id))),
    paths: (layout.paths || []).filter((p) => !liftPaths.has(p.id)),
  });
  for (const h of layout.harbours || []) {
    if (!h) continue;
    for (const c of [...(h.pier || []), ...(h.slip || [])]) held.add(ckey(c));
  }
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (!afloat(id)) continue;
    for (let z = -1; z <= p.d; z++) for (let x = -1; x <= p.w; x++) held.add(`${p.gx + x},${p.gz + z}`);
  }
  // A dug cell shares its corners with its eight neighbours, so ground beside a house is
  // lowered under it; keep a cell off everything that stands.
  const standing = new Set();
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (lifts.includes(id)) continue;
    for (let z = -1; z <= p.d; z++) for (let x = -1; x <= p.w; x++) standing.add(`${p.gx + x},${p.gz + z}`);
  }
  return { held, standing };
}

// What a dig of `cells` on `terrain` must leave where it is: every cell something stands on -
// a plot, a road, a bridge, planks - with a corner the profile would lower. The profile's land
// bank reaches well past the mask on a hill, and "a house never moves" holds for its height
// too. Written into the dig (`works.dig[].hold`), so a house built later on ground this dig
// already lowered is never lifted back by it.
function digHold(layout, terrain, cells) {
  const size = terrain.size, N = size + 1;
  const d2 = cornerDistance2(cells, size);
  const lowers = (k) => d2[k] !== Infinity && Math.round(workProfile(Math.sqrt(d2[k])) * 256) / 256 < terrain.H[k];
  const standing = new Set();
  for (const p of Object.values(layout.plots || {})) {
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) standing.add(`${p.gx + x},${p.gz + z}`);
  }
  for (const p of layout.paths || []) for (const c of p.cells || []) standing.add(ckey(c));
  for (const b of layout.bridges || []) for (const c of b.cells || []) standing.add(ckey(c));
  for (const d of Object.values(layout.districts || {})) for (const c of d.pier || []) standing.add(ckey(c));
  for (const h of layout.harbours || []) if (h) for (const c of [...(h.pier || []), ...(h.slip || [])]) standing.add(ckey(c));
  const hold = [];
  for (const k of standing) {
    const [gx, gz] = k.split(',').map(Number);
    if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
    const a = gx + gz * N;
    if (lowers(a) || lowers(a + 1) || lowers(a + N) || lowers(a + N + 1)) hold.push([gx, gz]);
  }
  return sortedCells(hold);
}

// A small binary heap of [cost, cell] for the search below.
function heapPush(h, item) {
  h.push(item);
  for (let i = h.length - 1; i > 0;) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]]; i = p;
  }
}
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) {
    h[0] = last;
    for (let i = 0; ;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]]; i = m;
    }
  }
  return top;
}

// Dig a way from the channel's seaward end to open water, or return null when it already gets
// there, when it cannot (a house, a road or a harbour is in every way through) or when the way
// out is longer than DREDGE_MAX. On success the layout's works carry one more dig (the cut, and
// what stands within its profile's reach), any crane or lighthouse the cut goes through is taken
// off the map for the loops that place them to place again, `layout.terrainHash` is on record
// for the new ground, and that ground is returned. Nothing is written unless the terrain it
// makes really is joined to the sea. The fairway itself is left as it is - `line` and `cells`
// are Hoogezand's recorded channel, stamped as they always were.
//
// The way out is a cheapest-path search, not a bearing like `planFairway`'s: the mouth is
// already dug and it is the ring beyond it that is in the way, so the answer is "the least
// ground to lift between here and the sea", whatever bearing that turns out to be. A cell
// costs more the higher it lies (the spoil), a civic that may be lifted costs a great deal
// (used only when the alternative is worse), and the same cells are refused as for a fresh
// channel (`free` in planFairway: not held, not above the beach).
export function repairFairway(layout, terrain, { seed, size }) {
  const fw = layout.fairway;
  if (!fw || !(fw.line || []).length || fairwayReaches(terrain, fw)) return null;
  size = terrain.size;
  const lifts = DREDGE_LIFTS.filter((id) => layout.plots && layout.plots[id]);
  const soft = new Set();
  for (const id of lifts) {
    const p = layout.plots[id];
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) soft.add(`${p.gx + x},${p.gz + z}`);
  }
  const { held, standing } = dredgeHeld(layout, lifts);
  const open = openWaterOf(terrain);
  const passable = (gx, gz) => terrain.inGrid(gx, gz) && !held.has(`${gx},${gz}`) && !standing.has(`${gx},${gz}`)
    && terrain.heightAt(gx, gz) < BEACH_MAX;
  const price = (gx, gz) => 10 + Math.round(30 * Math.max(0, terrain.heightAt(gx, gz) - CHANNEL_H)) + (soft.has(`${gx},${gz}`) ? 400 : 0);

  const end = fw.line[0];
  // To the nearest open water, however shallow: a hull floats over anything below
  // BOAT_FLOAT, so the sea only has to be sea. (`planFairway` asks for water deeper than the
  // channel because it digs through a bar that is not water yet; here the lane ends where the
  // tide already is, and a longer cut to deeper water would dig a canal through the ring for
  // no boat's sake.)
  const best = new Map([[ckey(end), 0]]);
  const came = new Map();
  const heap = [];
  heapPush(heap, [0, end[0], end[1]]);
  let goal = null;
  while (heap.length) {
    const [cost, gx, gz] = heapPop(heap);
    if (cost > (best.get(`${gx},${gz}`) ?? Infinity)) continue;
    if (open[gx + gz * size] === 1) { goal = [gx, gz]; break; }
    for (const [dx, dz] of N8) {
      const nx = gx + dx, nz = gz + dz;
      if (!passable(nx, nz)) continue;
      let via = null, extra = 0;
      if (dx && dz) {
        // A diagonal step needs one of the two cells it cuts across, and takes it into the
        // channel: two cells touching at a corner are not one water body.
        const a = [gx + dx, gz], b = [gx, gz + dz];
        const pa = passable(a[0], a[1]), pb = passable(b[0], b[1]);
        if (!pa && !pb) continue;
        via = pa && (!pb || price(a[0], a[1]) <= price(b[0], b[1])) ? a : b;
        extra = price(via[0], via[1]);
      }
      const c = cost + (dx && dz ? 14 : 10) * price(nx, nz) / 10 + extra;
      const k = `${nx},${nz}`;
      if (c >= (best.get(k) ?? Infinity)) continue;
      best.set(k, c); came.set(k, { from: [gx, gz], via });
      heapPush(heap, [c, nx, nz]);
    }
  }
  let route = null;
  if (goal) {
    route = [];                              // goal first, the old end last
    for (let c = goal; c;) {
      route.push(c);
      const step = came.get(`${c[0]},${c[1]}`);
      if (step && step.via) route.push(step.via);
      c = step ? step.from : null;
    }
  }
  if (!route || route.length - 1 > DREDGE_MAX) {
    if (!dredgeWarned) { dredgeWarned = true; console.warn('[layout] the fairway no longer reaches the sea and there is no way out that touches nothing that stands'); }
    return null;
  }

  // The cut: the route and the channel's own width round it, every cell of the widening checked
  // on its own, as `planFairway` does. With the profile the banks come by themselves.
  const have = new Set(channelCells(layout).map(ckey));
  const fresh = new Set();
  for (const [gx, gz] of route) {
    for (let dz = -FAIRWAY_HALF; dz <= FAIRWAY_HALF; dz++) {
      for (let dx = -FAIRWAY_HALF; dx <= FAIRWAY_HALF; dx++) {
        if (dx * dx + dz * dz > FAIRWAY_HALF * FAIRWAY_HALF + 1) continue;    // round, not square
        const k = ckey([gx + dx, gz + dz]);
        if (!have.has(k) && passable(gx + dx, gz + dz)) fresh.add(k);
      }
    }
  }
  const added = sortedCells([...fresh].map((k) => k.split(',').map(Number)));
  // Whatever the cut goes through or lies against is lifted: it is placed again by the loop
  // that placed it, on the ground that is there now.
  const dug = new Set(added.map(ckey));
  const lifted = lifts.filter((id) => {
    const p = layout.plots[id];
    for (let z = -1; z <= p.d; z++) for (let x = -1; x <= p.w; x++) if (dug.has(`${p.gx + x},${p.gz + z}`)) return true;
    return false;
  });
  const standingAfter = { ...layout, plots: Object.fromEntries(Object.entries(layout.plots || {}).filter(([id]) => !lifted.includes(id))) };
  const works = worksWith(layout, { dig: [...((layout.works && layout.works.dig) || []), { cells: added, hold: digHold(standingAfter, terrain, added) }] });
  const ground = makeTerrain(seed, { size, polders: layout.polders, fairway: fw, works, grow: layout.grow || null });
  if (!fairwayReaches(ground, fw)) return null;
  layout.works = works;
  if (lifted.length) liftCivics(layout, lifted, size);
  layout.terrainHash = ground.hash;
  return ground;
}

// Take civics off the map so the loops that place them do it again: the plot, the road that
// led to it, and whatever road that leaves cut off from the square. What `growStep` does for
// the buildings a ring drowns.
function liftCivics(layout, ids, size) {
  for (const id of ids) delete layout.plots[id];
  const gone = new Set(ids.map((id) => `path:${id}`));
  const before = (layout.paths || []).length;
  layout.paths = (layout.paths || []).filter((p) => !gone.has(p.id));
  if (layout.paths.length !== before) pruneUnreachable(layout, size);
}

// Fill the water a growth ring shut in, once, on an island whose steps cannot be redrawn.
// The ponds are the enclosed water that the ground of the founding grid alone does not have
// (so the founding lake, and any pond older than growing, stay), less every body that
// contains the river, a channel (the fairway, a dig, the harbour funnel) or lies within a cell
// of anything that stands, a harbour's planks or a ship's water. What is left goes into
// `works.fill`, which `makeTerrain` fills with the profile. Filling can cut a neck of water off
// from the sea, so it goes round again until nothing new is shut in.
//
// On an island that has taken a ring the list is written once, empty when there was nothing
// to fill: `undefined` is "not asked yet" and an empty list is "asked, nothing to do" - the
// fairway's own difference between null and `{ cells: [] }`, which is what stops the search
// running on every scan for ever. It no longer waits for a channel (it rode on the fairway
// object at first, and an island with no fairway kept its ponds).
export function fillRingPonds(layout, terrain, { seed, size }) {
  const grow = layout.grow;
  if (layout.works && layout.works.fill !== undefined) return null;
  size = terrain.size;
  if (!grow || !(grow.steps || []).length) return null;      // no ring, no ring pond: nothing is written
  const fw = layout.fairway || null;
  const base = makeTerrain(seed, { size, polders: layout.polders, fairway: fw, works: layout.works || null, grow: { base: grow.base, steps: [] } });
  const shut0 = new Set();
  const open0 = openWaterOf(base);
  for (let gz = 0; gz < size; gz++) for (let gx = 0; gx < size; gx++) if (base.isWater(gx, gz) && !open0[gx + gz * size]) shut0.add(gx + gz * size);
  const { held, standing } = dredgeHeld(layout, []);
  const channel = new Set(channelCells(layout).map(ckey));

  // The ponds of a terrain: four-connected bodies of water the tide does not reach, that were
  // not shut in on the founding ground, as lists of cells.
  const pondsOf = (T) => {
    const open = openWaterOf(T);
    const seen = new Uint8Array(size * size);
    const out = [];
    for (let gz = 0; gz < size; gz++) {
      for (let gx = 0; gx < size; gx++) {
        const c = gx + gz * size;
        if (seen[c] || open[c] || shut0.has(c) || !T.isWater(gx, gz)) continue;
        const cells = [[gx, gz]];
        seen[c] = 1;
        for (let h = 0; h < cells.length; h++) {
          for (const [dx, dz] of N4) {
            const nx = cells[h][0] + dx, nz = cells[h][1] + dz;
            if (!T.inGrid(nx, nz) || seen[nx + nz * size] || open[nx + nz * size] || shut0.has(nx + nz * size) || !T.isWater(nx, nz)) continue;
            seen[nx + nz * size] = 1; cells.push([nx, nz]);
          }
        }
        out.push(cells);
      }
    }
    return out;
  };
  // Water something belongs to: the river or a channel runs through it, or it lies within a
  // cell of a house, a road, a bridge, planks or a ship.
  const funnel = havenKeys(layout, 0);
  const belongs = (cells) => cells.some(([gx, gz]) => {
    if (terrain.isRiver(gx, gz) || channel.has(ckey([gx, gz])) || funnel.has(ckey([gx, gz]))) return true;
    for (const [dx, dz] of [[0, 0], ...N8]) {
      const k = `${gx + dx},${gz + dz}`;
      if (held.has(k) || standing.has(k)) return true;
    }
    return false;
  });
  const fill = [];
  let T = terrain;
  for (let round = 0; round < 8; round++) {
    const ponds = pondsOf(T).filter((cells) => !belongs(cells));
    if (!ponds.length) break;
    for (const cells of ponds) fill.push(...cells);
    T = makeTerrain(seed, { size, polders: layout.polders, fairway: fw, works: worksWith(layout, { fill: sortedCells(fill) }), grow });
  }
  layout.works = worksWith(layout, { fill: sortedCells(fill) });
  if (!fill.length) return null;
  layout.terrainHash = T.hash;
  return T;
}
const sortedCells = (cells) => [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

// ---- the harbour funnel ----------------------------------------------------------------
// The quay is the one thing a growth ring keeps finding in its way: a pier, a crane, a berth
// and a galleon's room at the edge of the sea, and every ring that turns that sea to meadow
// moves them (`doomedBy`) or cuts the water they lie in off from the tide. So the water of the
// harbour is planned ONCE, as a funnel (`funnelHas` in shared/terrain.mjs says what one is and
// why it is a ray): its head where the river comes into the bay, at the bridge's place
// (`havenBridgeSite`), narrow there and wider towards the sea, up to HAVEN_WIDEN times the bay
// that is there and then straight on. It is `layout.works.haven = { top, dir, w0, open, max,
// from }` - `undefined` until somebody has asked and `null` when asked and there was nothing to
// plan (no channel to start from), the fairway's own difference.
//
// Planning it does two things and only two. It digs the head of the inlet open once, with the
// profile (`works.dig`): the sand in the funnel lower than BEACH_MAX that nothing stands on - on
// Hoogezand the spit across the bay's mouth, and a crane in the way is lifted and placed again,
// as for the repair. And it writes the funnel down; every growth step taken afterwards carries a
// copy (`growStep`) and keeps it open with `profileKeep`, so the ring builds nothing in it and
// meets it with a beach either side. What already stands is never dug away.
//
// It waits for the harbours (Plans/quay-en-rivier.md, review point 8): on a new island the
// channel is dug at 25 settlers and the harbours come later, and a funnel planned blind would
// choose its way for ever before the quay had a say. So it is planned at the start of a pass
// that finds the harbours on record, never halfway through the pass that plans them (that would
// mean digging under roads it has just laid): a pass that planned them places the island once
// more, in the same scan (the end of `placeAll`), so the scan after it is still a no-op.
//
// Which way it opens comes from the ground, never from a compass point: the channel's own
// seaward bearing (the head to the channel's seaward end) is where the search starts, every
// bearing within HAVEN_ARC of it is tried, and the one that holds what the quay needs (planks,
// shore, berths, crane, the galleon's berth near the head - `havenWanted`) across the fewest
// cells of land wins, with a small price on turning away from the channel.
//
// The two banks: the QUAY's bank is the one the quay district stands on, the OTHER is the
// pirates' (`havenBank`). Nothing is built or reserved on either by this code.
const HAVEN_REACH = 26;            // cells from the head that a harbour still belongs to it
const HAVEN_SHIPS = 40;            // and the galleon's berth and the lots at sea
const HAVEN_STEPS = 64;            // bearings tried round the circle
const HAVEN_ARC = 60;              // degrees either side of the channel's own bearing
const HAVEN_TURN = 0.25;           // what a degree of turning away from the channel costs, in cells of land
const HAVEN_BAY_SPAN = 30;         // how far along the axis the bay is measured, in cells
const HAVEN_OUT = 1000;            // what a wanted cell left out of the funnel costs, in cells of land
// Widening per cell, per side: between a narrow cut (1/8, about 7 degrees) and a wide mouth
// (1/2, about 27 degrees). In 64ths, like checkFunnel wants.
const HAVEN_OPEN_MIN = 8 / 64;
const HAVEN_OPEN_MAX = 32 / 64;
// The half-width at the seaward end of the channel, at least: the fairway's own five across and
// a cell of room each side - a funnel narrower than its channel would be no harbour.
const HAVEN_HALF_MIN = 3.5;
// How much wider than the bay that is there the funnel grows before it goes straight on: three
// times, the keeper's number (30 September 2026) - wide enough for the big ships to turn in, and
// capped so the rings either side of it still have coast to grow on. Past FUNNEL_MAX (shared)
// never.
const HAVEN_WIDEN = 3;

// The cells the funnel holds, as `ckey`s, and `ring` cells round them (a polder's wall is the
// ring of cells round its own, and would lift the funnel's edge). Empty when the layout has no
// funnel.
const havenKeysCache = new Map();
export function havenKeys(layout, ring = 0) {
  const haven = layout && layout.works && layout.works.haven;
  const out = new Set();
  if (!haven) return out;
  const size = layout.size;
  const id = `${size}:${JSON.stringify(haven)}:${ring}`;
  const hit = havenKeysCache.get(id);
  if (hit) return hit;
  const mask = new Uint8Array(size * size);
  for (const [gx, gz] of funnelCells(haven, size)) mask[gx + gz * size] = 1;
  const at = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size && mask[gx + gz * size] === 1;
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      let hot = false;
      for (let dz = -ring; dz <= ring && !hot; dz++) for (let dx = -ring; dx <= ring; dx++) if (at(gx + dx, gz + dz)) { hot = true; break; }
      if (hot) out.add(`${gx},${gz}`);
    }
  }
  if (havenKeysCache.size > 4) havenKeysCache.clear();
  havenKeysCache.set(id, out);
  return out;
}

// The cells that have to lie in the funnel, from what stands now. `hard` decides its direction;
// `soft` (the lots at sea) is reported but decides nothing.
function havenWanted(layout, terrain, start, model) {
  const near = (c, reach) => (c[0] - start[0]) * (c[0] - start[0]) + (c[1] - start[1]) * (c[1] - start[1]) <= reach * reach;
  const hard = [], soft = [];
  const add = (list, c) => { if (c && terrain.inGrid(c[0], c[1])) list.push([c[0], c[1]]); };
  const q = layout.districts && layout.districts.quay;
  const mine = [];
  for (const h of layout.harbours || []) {
    if (h && h.shore && (h.pier || []).length && (h.pier.some((c) => near(c, HAVEN_REACH)) || near(h.shore, HAVEN_REACH))) mine.push({ shore: h.shore, pier: h.pier, slip: h.slip || [] });
  }
  if (q && q.shore && (q.pier || []).length && (q.pier.some((c) => near(c, HAVEN_REACH)) || near(q.shore, HAVEN_REACH))) {
    mine.push({ shore: q.shore, pier: q.pier, slip: [] });
  }
  for (const h of mine) {
    add(hard, h.shore);
    for (const c of [...h.pier, ...h.slip]) add(hard, c);
  }
  const crane = layout.plots && layout.plots['civic:crane'];
  if (crane && near([crane.gx, crane.gz], HAVEN_REACH)) add(hard, [crane.gx, crane.gz]);

  // Berths, and where the galleon lies: read the way `waterfront` reads them - the harbours in
  // full, the quay's planks, `mooringsFor`, `shipBerth` on the island at the origin.
  const quayLive = !!(q && (q.pier || []).length && (!model || ((model.districts) || []).some((d) => d.id === 'quay')));
  const view = {
    island: {
      landing: layout.landing,
      harbours: (layout.harbours || []).filter(Boolean).map((h) => ({ side: h.side, shore: h.shore, pier: h.pier, boats: BOATS_PER_HARBOUR })),
    },
    districts: quayLive ? [{ pier: q.pier, shore: q.shore || null }] : [],
  };
  const moorings = layout.landing ? mooringsFor('x', terrain, view) : [];
  for (const m of moorings) {
    const c = [Math.floor(m.x + terrain.half), Math.floor(m.z + terrain.half)];
    if (near(c, HAVEN_REACH)) add(hard, c);
  }
  const first = moorings.find((m) => m.id === 'boat:x');
  if (first) {
    const gal = shipBerth(first, placeIsland(terrain).worldHeight);
    const c = [Math.floor(gal.x + terrain.half), Math.floor(gal.z + terrain.half)];
    if (near(c, HAVEN_SHIPS)) add(hard, c);
  }
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (!afloat(id)) continue;
    const cells = waterOf(id, p);
    if (cells && cells.some((c) => near(c, HAVEN_SHIPS))) for (const c of cells) add(soft, c);
  }
  return { hard, soft };
}

// How wide the bay is at the channel's seaward end, in cells: the median width of the run of
// water across the axis at each station of the first HAVEN_BAY_SPAN cells, leaving out stations
// on land and stations where the water is wider than `cap` (open sea is not a bay). Null when no
// station qualifies.
function bayWidth(terrain, a, u, cap) {
  const n = [-u[1], u[0]];
  const widths = [];
  for (let s = 0; s <= HAVEN_BAY_SPAN; s++) {
    const cx = Math.round(a[0] + u[0] * s), cz = Math.round(a[1] + u[1] * s);
    if (!terrain.inGrid(cx, cz) || !terrain.isWater(cx, cz)) continue;
    let w = 1;
    for (const sign of [1, -1]) {
      for (let k = 1; k <= cap; k++) {
        const x = Math.round(cx + n[0] * k * sign), z = Math.round(cz + n[1] * k * sign);
        if (!terrain.inGrid(x, z) || !terrain.isWater(x, z)) break;
        w++;
      }
    }
    if (w < cap) widths.push(w);
  }
  if (!widths.length) return null;
  widths.sort((x, y) => x - y);
  return widths[widths.length >> 1];
}

// The funnel for this terrain, with how it was chosen, or null. Writes nothing.
//   head   `havenBridgeSite`: the first crossing up the river from the channel no wider than
//          three cells - w0 is half that width; without one, the channel's landward end and
//          the channel's own half-width;
//   open   so that the funnel is as wide as the bay (or HAVEN_HALF_MIN) where the channel meets
//          it - the seaward end of the channel, where the quay stands;
//   max    HAVEN_WIDEN times that half-width;
//   dir    the bearing search above.
export function chooseHaven(layout, terrain, model = null) {
  const fw = layout.fairway, size = terrain.size;
  if (!fw || !(fw.line || []).length) return null;
  const mouth = fw.line[0];
  if (!terrain.inGrid(mouth[0], mouth[1])) return null;
  const site = havenBridgeSite(terrain, fw);
  const top = site ? site.cell : fw.line[fw.line.length - 1];
  const w0 = site ? site.width / 2 : FAIRWAY_HALF + 0.5;
  const ox = mouth[0] - top[0], oz = mouth[1] - top[1];
  const sc = Math.sqrt(ox * ox + oz * oz);
  if (sc < 1) return null;
  const own = Math.atan2(oz, ox);
  const bay = bayWidth(terrain, mouth, [ox / sc, oz / sc], 2 * HAVEN_HALF_MIN * HAVEN_WIDEN + 1);
  const bayHalf = Math.max(HAVEN_HALF_MIN, bay === null ? 0 : bay / 2);
  const open = Math.round(Math.min(HAVEN_OPEN_MAX, Math.max(HAVEN_OPEN_MIN, (bayHalf - w0) / sc)) * 64) / 64;
  const max = Math.min(FUNNEL_MAX, Math.round(HAVEN_WIDEN * bayHalf * 2) / 2);
  // The stretch that is judged: from the head to where the funnel has reached its full width,
  // and a little past. Beyond it every bearing costs the same kind of open sea.
  const reach = sc + (max - w0) / open + 16;
  const { hard, soft } = havenWanted(layout, terrain, mouth, model);
  let best = null;
  for (let k = 0; k < HAVEN_STEPS; k++) {
    const a = (k / HAVEN_STEPS) * 2 * Math.PI;
    let turn = Math.abs(a - own) % (2 * Math.PI);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    turn = (turn * 180) / Math.PI;
    if (turn > HAVEN_ARC) continue;
    // A whole-number direction, 64 long: the stored funnel never carries a bearing.
    const dir = [Math.round(64 * Math.cos(a)), Math.round(64 * Math.sin(a))];
    const haven = { top: [top[0], top[1]], dir, w0, open, max };
    const L = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
    let land = 0, cells = 0;
    for (let gz = 0; gz < size; gz++) {
      for (let gx = 0; gx < size; gx++) {
        if (!funnelHas(haven, gx, gz)) continue;
        if (((gx - top[0]) * dir[0] + (gz - top[1]) * dir[1]) / L > reach) continue;
        cells++;
        if (!terrain.isWater(gx, gz)) land++;
      }
    }
    // A wanted cell counts as held when it is in the funnel or beside it: the profile keeps
    // the first cell outside the funnel water too.
    const held = (c) => [[0, 0], ...N8].some(([dx, dz]) => funnelHas(haven, c[0] + dx, c[1] + dz));
    const out = hard.filter((c) => !held(c)).length;
    const cost = out * HAVEN_OUT + land + turn * HAVEN_TURN;
    if (!best || cost < best.cost) best = { cost, haven, land, cells, out, turn };
  }
  if (!best) return null;
  return { ...best, site, sc, bay, wanted: { hard: hard.length, soft: soft.length } };
}

// Plan the funnel once, and open its head: see the section's comment. Returns the new terrain
// when the ground changed (the hash is then on record for it), else null. Asked again on a later
// scan while the channel does not reach the sea or the harbours are not planned yet.
export function planHaven(layout, terrain, model = null, { seed, size } = {}) {
  const fw = layout.fairway;
  if (!fw || (layout.works && layout.works.haven !== undefined)) return null;
  if (!(fw.line || []).length) { layout.works = worksWith(layout, { haven: null }); return null; }
  if (layout.harbours == null || !fairwayReaches(terrain, fw)) return null;
  size = terrain.size;
  const chosen = chooseHaven(layout, terrain, model);
  const from = layout.grow ? layout.grow.steps.length : 0;
  if (!chosen) { layout.works = worksWith(layout, { haven: null }); return null; }
  const haven = { ...chosen.haven, from };

  // The head: funnel cells that are sand (every corner under BEACH_MAX), reached from the head
  // through the funnel's water and its sand, and nothing standing on them or beside them - a
  // crane or a lighthouse excepted, which is lifted and placed again like the repair lifts it.
  const lifts = DREDGE_LIFTS.filter((id) => layout.plots && layout.plots[id]);
  const { held, standing } = dredgeHeld(layout, lifts);
  const inFunnel = havenKeysOf(haven, size);
  const sand = (gx, gz) => [terrain.corner(gx, gz), terrain.corner(gx + 1, gz), terrain.corner(gx, gz + 1), terrain.corner(gx + 1, gz + 1)].every((h) => h < BEACH_MAX);
  const diggable = (gx, gz) => !held.has(`${gx},${gz}`) && !standing.has(`${gx},${gz}`) && sand(gx, gz);
  const seen = new Set([ckey(haven.top)]), queue = [haven.top], cells = [];
  for (let h = 0; h < queue.length; h++) {
    const [gx, gz] = queue[h];
    for (const [dx, dz] of N4) {
      const nx = gx + dx, nz = gz + dz, k = `${nx},${nz}`;
      if (seen.has(k) || !inFunnel.has(k) || !terrain.inGrid(nx, nz)) continue;
      seen.add(k);
      if (terrain.isWater(nx, nz)) { queue.push([nx, nz]); continue; }
      if (diggable(nx, nz)) { cells.push([nx, nz]); queue.push([nx, nz]); }
    }
  }
  const dug = new Set(cells.map(ckey));
  const lifted = lifts.filter((id) => {
    const p = layout.plots[id];
    for (let z = -1; z <= p.d; z++) for (let x = -1; x <= p.w; x++) if (dug.has(`${p.gx + x},${p.gz + z}`)) return true;
    return false;
  });
  const dig = [...((layout.works && layout.works.dig) || [])];
  if (cells.length) {
    const standingAfter = { ...layout, plots: Object.fromEntries(Object.entries(layout.plots || {}).filter(([id]) => !lifted.includes(id))) };
    dig.push({ cells: sortedCells(cells), hold: digHold(standingAfter, terrain, cells) });
  }
  layout.works = worksWith(layout, { dig, haven });
  if (!cells.length) return null;
  if (lifted.length) liftCivics(layout, lifted, size);
  const ground = makeTerrain(seed, { size, polders: layout.polders, fairway: fw, works: layout.works, grow: layout.grow || null });
  layout.terrainHash = ground.hash;
  return ground;
}
const havenKeysOf = (haven, size) => new Set(funnelCells(haven, size).map(ckey));

// The place for a bridge over the river directly upstream of the bay: walking up the longest
// river from where the channel stops going up it, the first crossing that is no wider than
// BRIDGE_SPAN_MAX cells of water with land on both sides - nearest the bay wins. `{ cell,
// axis, width }`, `axis` being the deck's (`layout.bridges`: 'x' when the deck runs along x,
// i.e. the river runs along z) - or null when there is none. Read-only; fase 3 builds on it.
// It is also the funnel's head (chooseHaven).
const BRIDGE_SPAN_MAX = 3;
const BRIDGE_SEARCH = 14;
export function havenBridgeSite(terrain, fairway) {
  if (!fairway || !(fairway.line || []).length || !(terrain.rivers || []).length) return null;
  const course = terrain.rivers.reduce((a, b) => (b.length > a.length ? b : a));
  const tip = fairway.line[fairway.line.length - 1];
  const j = course.findIndex((c) => c[0] === tip[0] && c[1] === tip[1]);
  if (j < 0) return null;
  for (let i = j - 1; i >= Math.max(1, j - BRIDGE_SEARCH); i--) {
    const [gx, gz] = course[i];
    const p = course[i - 1], n = course[Math.min(course.length - 1, i + 1)];
    // Across the flow: along x when the river runs mostly along z.
    const across = Math.abs(n[1] - p[1]) >= Math.abs(n[0] - p[0]) ? [1, 0] : [0, 1];
    if (!terrain.isWater(gx, gz)) continue;
    let width = 1, banks = 0;
    for (const sign of [1, -1]) {
      let k = 1;
      const at = (m) => [gx + across[0] * m * sign, gz + across[1] * m * sign];
      while (k <= BRIDGE_SPAN_MAX + 1 && terrain.inGrid(...at(k)) && terrain.isWater(...at(k))) { width++; k++; }
      // A bank is any dry cell, sand included: the river's banks are low.
      if (k <= BRIDGE_SPAN_MAX + 1 && terrain.inGrid(...at(k)) && !terrain.isWater(...at(k))) banks++;
    }
    if (width <= BRIDGE_SPAN_MAX && banks === 2) return { cell: [gx, gz], axis: across[0] ? 'x' : 'z', width };
  }
  return null;
}

// ---- the harbour as one piece of water, with a stone quay ---------------------------------
// Fase 3 of Plans/quay-en-rivier.md, as the keeper approved it over the preview of 30 September
// 2026. The quay used to be a basin drawn over the saved ground (shared/quay-basin.mjs, an
// overlay the hash never saw): the page drew water where the layout, the sea and the boats saw a
// hill. Now the harbour is real water - ONE more `works.dig` - and along its landward side runs a
// stone quay (`works.kade`, shared/terrain.mjs `levelKade`): a strip three cells wide at the
// planks' height, its water side a wall.
//
// All of it is worked out in the funnel's own frame (`kadeFrame`): `s` along its axis from the
// head, `o` across it towards the quay's bank. On Hoogezand the axis runs due south from the head
// at [147,267] and the quay's bank is east.
//
//   the wall    one cell past the quay district's parcel and its ring (the old overlay's edge):
//               the quay's first column. The quay runs from the parcel's first row along the
//               axis, past its last, for as long as all three of its cells are dry ground - to
//               where the sea itself reaches the quay's line, so the quay never takes a cell of
//               sea (Hoogezand: rows 267-313, 47 of them; at 314 the sea is at its back column,
//               at 316 at its wall);
//   the basin   from one cell past the funnel's axis on the pirates' side to the wall, from the
//               quay's first row to its last - less the first KADE_HEAD_ROWS rows west of the
//               parcel, which are the sand at the head of the inlet: `havenBridgeSite` needs the
//               river three wide there, with dry ground either side, for the bridge;
//   the west    the funnel's cells on the pirates' side over the rows the old yard stood on
//               (KADE_WEST_FROM to KADE_WEST_TO rows from the head), so the mouth opens along the
//               funnel the keeper approved rather than along a line of its own;
//   the dock    the yard's slipway toe and a cell round it, joined to the funnel's water - a later
//               ring keeps the funnel open, not the shallows beside it, and measured without the
//               dock the next ring turned the moved yard's toe to meadow and moved it again;
//   the anchorage  the big ships' water (shared/quay.mjs `shipWaterOf`) for KADE_ANCHORAGE rows
//               past the quay's end, dug to the channel's floor: the mouth's west half is a bar
//               (-0.1 to -0.3) where the galleon (every hull point under SHIP_WATER, -0.3) finds
//               no water in reach.
//
// What stands in the basin stays where it is and as high as it was - the dig's `hold`, digHold's
// rule - with three exceptions, all on purpose: the quay's houses (they stand on piles in the
// water now: `p.quay`, drawn at BASIN_DECK), their decks and front paths and the quay's approach
// (boardwalk: the replay keeps them PATH and the quay's deck takes them in), and the civics that
// move with the harbour: the yard to the pirates' bank (`yardSite`, moved here directly so the
// dock is dug where it stands), the crane to the quay's seaward end, the warehouse and weigh house
// behind the quay, the ships to the rede on the pirates' side. The quay's ramp - its shore cell
// and slipway, where the road meets the planks - stays land, since the moorings read the planks
// from it. Every cell alongside the quay on its landward side is held too, so the dig's profile
// stops at the wall and the quay decides the ground there.
//
// Once, like the funnel: `works.kade` is `undefined` until the island has a funnel and a quay
// district with planks, `null` when that was asked and no quay fits (a funnel that does not run
// near an axis, a house where the quay would go), and the record from then on.
const KADE_WIDTH = 3;
export const KADE_ROAD = 'road:kade';
const KADE_LEVEL = 113;            // BASIN_DECK (0.44) on the 1/256 grid: 0.44140625
const KADE_HEAD_ROWS = 4;
const KADE_OVER = 1;               // how far the basin reaches past the funnel's axis
const KADE_WEST_FROM = 14;
const KADE_WEST_TO = 34;
const KADE_SEA_MAX = 40;           // how far past the parcel the quay may run along the beach
const KADE_TAIL = 3;               // rows of sand past the quay's end the basin takes
const KADE_ANCHORAGE = 16;
const KADE_DOCK_REACH = 12;
const KADE_NEAR = 6;               // a quayside building this close to the harbour moves with it

// The funnel's frame, or null when its axis is not within about 27 degrees of one of the grid's
// (a quay wall stands on the grid's lines). `ref` is a cell on the quay's bank.
function kadeFrame(haven, ref) {
  const [dx, dz] = haven.dir;
  let u = null;
  if (Math.abs(dx) >= 2 * Math.abs(dz)) u = [Math.sign(dx), 0];
  else if (Math.abs(dz) >= 2 * Math.abs(dx)) u = [0, Math.sign(dz)];
  if (!u) return null;
  const t = haven.top, perp = [-u[1], u[0]];
  const side = (ref[0] - t[0]) * perp[0] + (ref[1] - t[1]) * perp[1];
  if (!side) return null;
  const n = side > 0 ? perp : [-perp[0], -perp[1]];
  return {
    u, n,
    s: (c) => (c[0] - t[0]) * u[0] + (c[1] - t[1]) * u[1],
    o: (c) => (c[0] - t[0]) * n[0] + (c[1] - t[1]) * n[1],
    at: (s, o) => [t[0] + u[0] * s + n[0] * o, t[1] + u[1] * s + n[1] * o],
  };
}

// The quay district's parcel as cells: every cell of every super-cell of its lobes.
function quayParcel(layout) {
  const q = layout.districts && layout.districts.quay, lat = layout.lattice;
  const out = [];
  for (const lobe of (q && q.lobes) || []) {
    for (const [i, j] of lobe.cells) {
      const [gx, gz] = blockOf(lat, i, j);
      for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) out.push([gx + x, gz + z]);
    }
  }
  return out;
}

// The civics the harbour moves (see above): the crane always, a warehouse or weigh house standing
// within KADE_NEAR of the basin or the quay, every ship. The yard is not in it: it is moved.
function kadeLifts(layout, near) {
  const out = [];
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (id === 'civic:crane' || isShipId(id)) { out.push(id); continue; }
    if (id !== 'civic:warehouse' && id !== 'civic:weighhouse') continue;
    let hit = false;
    for (let z = 0; z < p.d && !hit; z++) for (let x = 0; x < p.w; x++) if (near.has(`${p.gx + x},${p.gz + z}`)) { hit = true; break; }
    if (hit) out.push(id);
  }
  return out.sort();
}

// The geometry, from the layout and the ground alone: `undefined` while there is nothing to ask
// (no funnel, or no quay district with planks and land), null when no quay fits, else the cells.
//
// The quay stands at the harbour in the funnel (`kadeHarbour`). Where that is the quay district's
// own - Hoogezand, where the district's planks were picked at the river mouth long before there
// was a funnel - the quay runs one cell past the district's parcel, as fase 3 laid it. Anywhere
// else the district's parcel is somewhere along another coast (a quay district is founded at the
// harbour nearest the town, with its first Cowork task, long before the funnel), and the quay is
// laid past the ground such a parcel covers beside the harbour in the funnel instead: KADE_PARCEL,
// Hoogezand's own, measured from the harbour's ramp. Without that a new island never had a quay -
// the parcel it waited for was never at the funnel (Plans/quay-op-zee.md).
export function kadeGeometry(layout, terrain) {
  const h = layout.works && layout.works.haven;
  const q = layout.districts && layout.districts.quay;
  if (!h || !q || !q.shore || !(q.pier || []).length || !layout.lattice || !layout.harbours) return undefined;
  const kh = kadeHarbour(layout);
  if (!kh) return null;
  const f = kadeFrame(h, kh.shore);
  if (!f) return null;
  const box = (cells) => {
    let sMin = Infinity, sMax = -Infinity, oMin = Infinity, oMax = -Infinity;
    for (const c of cells) {
      const s = f.s(c), o = f.o(c);
      if (s < sMin) sMin = s; if (s > sMax) sMax = s;
      if (o < oMin) oMin = o; if (o > oMax) oMax = o;
    }
    return { sMin, sMax, oMin, oMax };
  };
  // The district's own parcel only while it lies beside its harbour the way Hoogezand's does - no
  // further out from the ramp than KADE_PARCEL; a parcel that grew up the hill says nothing about
  // where a quay wall goes.
  let b = kh.own && (q.lobes || []).length ? box(quayParcel(layout)) : null;
  const virtual = !b || b.oMax > f.o(kh.shore) + KADE_PARCEL.across;
  if (virtual) b = box(kadeParcel(f, kh.shore));
  let { sMin, sMax } = b;
  const { oMin, oMax } = b;
  const wall = oMax + 2;
  const dry = (s, o) => { const [gx, gz] = f.at(s, o); return terrain.inGrid(gx, gz) && !terrain.isWater(gx, gz); };
  const across = (s) => [0, 1, 2].every((k) => dry(s, wall + k));
  // Alongside the parcel the quay has to stand on ground; past it, it follows the beach while
  // the beach is there. Beside a parcel it only stands in for (`kadeParcel`) the coast need not run
  // straight for all of it: the quay is the run of dry rows through the ramp's own row, no shorter
  // than KADE_RUN_MIN.
  if (virtual) {
    const s0 = Math.min(sMax, Math.max(sMin, f.s(kh.shore)));
    if (!across(s0)) return null;
    let lo = s0, hi = s0;
    while (lo > sMin && across(lo - 1)) lo--;
    while (hi < sMax && across(hi + 1)) hi++;
    if (hi - lo + 1 < KADE_RUN_MIN) return null;
    sMin = lo; sMax = hi;
  }
  for (let s = sMin; s <= sMax; s++) if (!across(s)) return null;
  let sEnd = sMax;
  while (sEnd - sMax < KADE_SEA_MAX && across(sEnd + 1)) sEnd++;

  const kade = [], basin = [], west = [];
  for (let s = sMin; s <= sEnd; s++) {
    for (let k = 0; k < KADE_WIDTH; k++) kade.push(f.at(s, wall + k));
    const oLo = s < sMin + KADE_HEAD_ROWS ? oMin - 1 : -KADE_OVER;
    for (let o = oLo; o < wall; o++) basin.push(f.at(s, o));
  }
  // Past the quay's end the sand the basin cut off: a few rows of it, and only sand. On
  // Hoogezand the beach south of the quay ran out into a bar three cells long (x 165-167, z 316)
  // that the basin left standing on its own in the water.
  for (let s = sEnd + 1; s <= sEnd + KADE_TAIL; s++) {
    for (let o = -KADE_OVER; o < wall; o++) {
      const [gx, gz] = f.at(s, o);
      if (!terrain.inGrid(gx, gz) || terrain.isWater(gx, gz)) continue;
      const sand = [terrain.corner(gx, gz), terrain.corner(gx + 1, gz), terrain.corner(gx, gz + 1), terrain.corner(gx + 1, gz + 1)].every((v) => v < BEACH_MAX);
      if (sand) basin.push([gx, gz]);
    }
  }
  for (let s = sMin + KADE_WEST_FROM; s <= sMin + KADE_WEST_TO; s++) {
    for (let o = -KADE_OVER - 1; o >= -FUNNEL_MAX - 1; o--) {
      const c = f.at(s, o);
      if (funnelHas(h, c[0], c[1])) west.push(c);
    }
  }
  const all = [...kade, ...basin, ...west];
  if (all.some(([gx, gz]) => !terrain.inGrid(gx, gz))) return null;
  return { f, wall, sMin, sEnd, kade, basin, west, crane: f.at(sEnd, wall), harbour: kh };
}

// The harbour the stone quay is built at: the one whose planks lie in the funnel (or its ring).
// The quay district's own first, when they do - so an island whose district was founded there
// keeps the quay fase 3 laid - else the harbour in the funnel nearest its top. `own` says which.
export function kadeHarbour(layout) {
  const h = layout.works && layout.works.haven;
  if (!h) return null;
  const near = havenKeys(layout, 1);
  const at = (x) => !!x && x.shore && (x.pier || []).length && [x.shore, ...x.pier].some((c) => near.has(ckey(c)));
  const q = layout.districts && layout.districts.quay;
  if (at(q)) {
    const n = (layout.harbours || []).findIndex((x) => x && x.shore && x.shore[0] === q.shore[0] && x.shore[1] === q.shore[1]);
    return { n, shore: q.shore, pier: q.pier, slip: n >= 0 ? layout.harbours[n].slip || [] : [], own: true };
  }
  let best = null;
  (layout.harbours || []).forEach((x, n) => {
    if (!at(x)) return;
    const d = dist2(x.shore, h.top);
    if (!best || d < best.d) best = { d, n, shore: x.shore, pier: x.pier, slip: x.slip || [], own: false };
  });
  return best && { n: best.n, shore: best.shore, pier: best.pier, slip: best.slip, own: false };
}
// The ground a quay district's parcel covers beside its harbour, for a quay laid at a harbour the
// district does not stand at: Hoogezand's, in the funnel's frame, from the ramp - twelve cells out
// from the ramp towards the land and twenty-four along the harbour, seventeen of them before the
// ramp (towards the funnel's top, never past it) and six after.
const KADE_PARCEL = { across: 12, before: 17, after: 6 };
// The shortest quay worth a wall: two lots of a harbour building and the crane's cell beyond.
const KADE_RUN_MIN = 8;
function kadeParcel(f, shore) {
  const s0 = f.s(shore), o0 = f.o(shore), out = [];
  for (let s = Math.max(0, s0 - KADE_PARCEL.before); s <= s0 + KADE_PARCEL.after; s++) {
    for (let o = o0 + 1; o <= o0 + KADE_PARCEL.across; o++) out.push(f.at(s, o));
  }
  return out;
}

// The quay's crane cell: its wall column at the seaward end - the one kade cell `road:kade`
// leaves free, so the crane has somewhere to stand with its jib over the harbour.
export function kadeCraneCell(layout) {
  const w = layout.works, k = w && w.kade, h = w && w.haven;
  if (!k || !h) return null;
  const own = new Set(k.cells.map(ckey));
  let best = null, bs = -Infinity;
  for (const c of k.cells) {
    if (own.has(`${c[0] - k.back[0]},${c[1] - k.back[1]}`)) continue;       // not on the wall
    const s = (c[0] - h.top[0]) * h.dir[0] + (c[1] - h.top[1]) * h.dir[1];
    if (s > bs) { bs = s; best = c; }
  }
  return best;
}
// The quay's road: every cell of the quay but the crane's, in row order.
export function kadeRoadCells(layout) {
  const k = layout.works && layout.works.kade;
  if (!k) return [];
  const crane = kadeCraneCell(layout);
  return sortedCells(k.cells.filter((c) => !crane || c[0] !== crane[0] || c[1] !== crane[1]));
}
// Every cell any dig took: a recorded road across one that is water now is a boardwalk.
const dugCache = new WeakMap();
export function dugKeys(layout) {
  const w = layout.works;
  if (!w || !(w.dig || []).length) return new Set();
  let hit = dugCache.get(w);
  if (!hit) { hit = new Set(w.dig.flatMap((d) => d.cells.map(ckey))); dugCache.set(w, hit); }
  return hit;
}
// Which bank of the funnel a cell is on, relative to the quay: 'quay', 'pirate' or null on the
// axis. `havenBank`'s side test, without its reach: the yard and the ships may lie further out.
function kadeBankOf(layout) {
  const w = layout.works, k = w && w.kade, h = w && w.haven;
  if (!k || !h) return null;
  const side = (gx, gz) => Math.sign((gx - h.top[0]) * h.dir[1] - (gz - h.top[1]) * h.dir[0]);
  const quay = side(k.cells[0][0], k.cells[0][1]);
  return (gx, gz) => { const s = side(gx, gz); return !s ? null : s === quay ? 'quay' : 'pirate'; };
}

// What a dig of `mask` on `terrain` must leave where it is, or a quay laid as `kade` must: every
// cell in `standing` with a corner the work would move - digHold's rule, with the work's own sum.
function standingHold(terrain, standing, moves) {
  const size = terrain.size, N = size + 1, hold = [];
  for (const k of standing) {
    const [gx, gz] = k.split(',').map(Number);
    if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
    const a = gx + gz * N;
    if (moves(a) || moves(a + 1) || moves(a + N) || moves(a + N + 1)) hold.push([gx, gz]);
  }
  return hold;
}
function kadeMoves(terrain, kade) {
  const probe = new Float64Array(terrain.H);
  // levelKade on a copy: a corner it changes is one it moves. Exact by construction - the same
  // function the ground is drawn with.
  levelKade(probe, terrain.size, { ...kade, hold: [] });
  return (k) => probe[k] !== terrain.H[k];
}

// `canGrow`: whether the island can still take a growth step. A quay with no room for it on an
// island that can still grow waits (nothing is recorded) instead of being refused for good: an
// island founded small asks the moment it has a funnel, on a coast of a few dozen cells, and the
// answer "no room" was final - measured on five seeds founded on 40, not one ever had a quay. The
// same for a house or a harbour building in the way: a ring may give the harbour another coast.
export function planKade(layout, terrain, model, { seed, size, canGrow = false } = {}) {
  const w = layout.works;
  if (!w || w.kade !== undefined || w.haven === undefined) return null;
  if (w.haven === null) { layout.works = worksWith(layout, { kade: null }); return null; }
  const geo = kadeGeometry(layout, terrain);
  if (geo === undefined) return null;
  const refuse = () => {
    if (canGrow) { kadeWaiting.set(layout, { size: layout.size, harbours: layout.harbours }); return null; }
    layout.works = worksWith(layout, { kade: null });
    return null;
  };
  if (!geo) return refuse();
  size = terrain.size;
  const { f, wall, sMin, sEnd } = geo;
  const q = layout.districts.quay;
  const kadeSet = new Set(geo.kade.map(ckey));

  // What the harbour moves, and what may not stand beside the quay.
  const near = new Set();
  for (const [gx, gz] of [...geo.kade, ...geo.basin]) {
    for (let dz = -KADE_NEAR; dz <= KADE_NEAR; dz++) for (let dx = -KADE_NEAR; dx <= KADE_NEAR; dx++) near.add(`${gx + dx},${gz + dz}`);
  }
  const lifts = kadeLifts(layout, near);
  const moving = new Set([...lifts, YARD_ID]);
  // A house of the quay district in the quay's way is let through only if the resort on the sea it
  // is about to move to (`planResort`, straight after this in the same pass) has room: asked below,
  // once the quay is worked out. Any other house in the way refuses the quay, as it always did.
  const leaving = new Set();
  const quayHome = new Set(quayHouseIds(layout).filter((id) => !Number.isInteger(layout.plots[id].lot)));
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (moving.has(id)) continue;
    let hit = false;
    for (let z = -1; z <= p.d && !hit; z++) for (let x = -1; x <= p.w; x++) if (kadeSet.has(`${p.gx + x},${p.gz + z}`)) { hit = true; break; }
    if (!hit) continue;
    if (!quayHome.has(id)) return refuse();
    leaving.add(id);
  }
  for (const b of layout.bridges || []) if (b.cells.some((c) => kadeSet.has(ckey(c)))) return refuse();

  // The quay's own - what goes on piles and boardwalk instead of being held. The quay district's
  // houses and deck only where the quay is laid at the district's own harbour (`kadeHarbour`):
  // at any other harbour they stand on another coast and are held like any other house.
  const kh = geo.harbour;
  const shoreKey = ckey(kh.shore);
  const ramp = new Set([shoreKey]);
  for (const h of layout.harbours || []) if (h && h.shore && ckey(h.shore) === shoreKey) for (const c of h.slip || []) ramp.add(ckey(c));
  const quayHouses = new Set(kh.own ? Object.entries(layout.plots).filter(([, p]) => p.quay).map(([id]) => id) : []);
  // The houses leaving for the resort go on piles too, as far as the digs are concerned: after
  // this pass nothing of theirs stands where the quay is.
  if (leaving.size) for (const id of quayHome) quayHouses.add(id);
  const own = new Set();
  for (const id of quayHouses) { const p = layout.plots[id]; for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) own.add(`${p.gx + x},${p.gz + z}`); }
  for (const c of [...(kh.own ? q.deck || [] : []), ...kh.pier]) own.add(ckey(c));
  const approach = (layout.harbours || []).map((h, n) => (h && h.shore && ckey(h.shore) === shoreKey ? `road:harbour:${n}:approach` : null)).filter(Boolean);
  const quayPaths = new Set([...[...quayHouses].map((id) => `path:${id}`), ...approach]);
  for (const k of ramp) own.delete(k);
  const liftPaths = new Set([...moving].map((id) => `path:${id}`));

  // Everything that stands and stays, for a mask: plots (not the quay's houses, not what moves),
  // roads (not what moves; the quay's own only outside the mask), bridges, planks, the ramp.
  const standingFor = (maskSet, extra = []) => {
    const out = new Set(extra);
    for (const [id, p] of Object.entries(layout.plots || {})) {
      if (moving.has(id) || quayHouses.has(id)) continue;
      for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) out.add(`${p.gx + x},${p.gz + z}`);
    }
    for (const p of layout.paths || []) {
      if (liftPaths.has(p.id)) continue;
      for (const c of p.cells || []) {
        const k = ckey(c);
        if ((quayPaths.has(p.id) || own.has(k)) && maskSet.has(k) && !ramp.has(k)) continue;
        out.add(k);
      }
    }
    for (const b of layout.bridges || []) for (const c of b.cells || []) out.add(ckey(c));
    for (const h of layout.harbours || []) if (h) for (const c of h.pier || []) out.add(ckey(c));
    for (const k of ramp) out.add(k);
    return out;
  };
  // The strip beside the quay on its landward side, the quay's rows: the dig's profile stops at
  // the wall and the quay decides that ground.
  const band = [];
  for (let s = sMin; s <= sEnd; s++) for (let o = wall; o < wall + KADE_REACH; o++) band.push(ckey(f.at(s, o)));

  const kadeRec = (hold) => ({ cells: sortedCells(geo.kade), level: KADE_LEVEL, back: [f.n[0] + 0, f.n[1] + 0], hold: sortedCells(hold) });   // + 0: never a -0
  const worksOf = (mask, digHoldCells, kadeHoldCells) => worksWith(layout, {
    dig: [...(w.dig || []), { cells: sortedCells(mask.filter((c) => !digHoldCells.has(ckey(c)))), hold: sortedCells([...digHoldCells].map((k) => k.split(',').map(Number))) }],
    kade: kadeRec(kadeHoldCells),
  });
  // A dig of `mask` held off `standing`, and the quay laid after it with its own hold, on the
  // ground as it stands now.
  const ground = (mask, standingExtra = []) => {
    const maskSet = new Set(mask.map(ckey));
    const d2 = cornerDistance2(mask, size);
    const lowers = (k) => d2[k] !== Infinity && Math.round(workProfile(Math.sqrt(d2[k])) * 256) / 256 < terrain.H[k];
    const digHoldCells = new Set([...band, ...standingHold(terrain, standingFor(maskSet, standingExtra), lowers).map(ckey)]);
    const dugOnly = makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway, works: worksWith(layout, { dig: [...(w.dig || []), { cells: sortedCells(mask.filter((c) => !digHoldCells.has(ckey(c)))), hold: sortedCells([...digHoldCells].map((k) => k.split(',').map(Number))) }] }), grow: layout.grow || null });
    const onKade = (k) => kadeSet.has(k);
    const kadeStanding = new Set([...standingFor(maskSet, standingExtra)].filter((k) => !onKade(k)));
    const kadeHold = standingHold(dugOnly, kadeStanding, kadeMoves(dugOnly, kadeRec([])));
    const works = worksOf(mask, digHoldCells, kadeHold);
    return { works, T: makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway, works, grow: layout.grow || null }) };
  };

  // ---- pass 1: basin and west, to find the yard's place on the pirates' bank ----
  const oldYard = layout.plots[YARD_ID] || null;
  const oldYardCells = [];
  if (oldYard) for (let z = 0; z < oldYard.d; z++) for (let x = 0; x < oldYard.w; x++) oldYardCells.push([oldYard.gx + x, oldYard.gz + z]);
  const yardInFunnel = oldYardCells.some(([gx, gz]) => funnelHas(w.haven, gx, gz));
  const mask1 = uniqueCells([...geo.basin, ...geo.west, ...(yardInFunnel ? oldYardCells : [])]);
  const g1 = ground(mask1);
  const trial = {
    ...layout,
    plots: Object.fromEntries(Object.entries(layout.plots).filter(([id]) => !moving.has(id))),
    paths: (layout.paths || []).filter((p) => !liftPaths.has(p.id)),
    works: g1.works,
  };
  let yard = null, sup = null;
  if (oldYard) {
    const grid = replayGrid(g1.T, trial);
    for (const c of geo.kade) grid.set(c[0], c[1], RESERVED);
    sup = new Super(g1.T, layout.lattice, heldOf(trial));
    registerLand(sup, trial, new Map(Object.keys(trial.districts || {}).map((id, i) => [id, i])), null);
    const site = yardSite(grid, g1.T, sup, layout.lattice, trial, waterfront(trial, g1.T, model));
    if (site) {
      const { w: yw, d: yd } = stamped(YARD_LOT, site.rot);
      yard = { gx: site.at[0], gz: site.at[1], w: yw, d: yd, rot: site.rot };
    }
  }
  // Without a place on the pirates' bank the yard stays where it is, and its ground with it.
  const yardStays = oldYard && !yard;

  // ---- the dock and the anchorage ----
  const dock = [];
  if (yard) {
    const wet = yardRows(yard, YARD_LOT.d - YARD_WET, YARD_LOT.d);
    const dryAndBetween = new Set(yardRows(yard, 0, YARD_LOT.d - YARD_WET).map(ckey));
    const ss = wet.map((c) => f.s(c)), os = wet.map((c) => f.o(c));
    const s0 = Math.min(...ss) - 1, s1 = Math.max(...ss) + 1, o0 = Math.min(...os) - 1;
    let o1 = Math.max(...os) + 1;
    const sWet = Math.min(...ss);
    const step = o1 < 0 ? 1 : -1;              // towards the axis
    let reach = o1;
    for (let t = 0; t < KADE_DOCK_REACH; t++) { const c = f.at(sWet, reach); if (funnelHas(w.haven, c[0], c[1])) break; reach += step; }
    const oa = Math.min(o0, reach), ob = Math.max(o1, reach);
    for (let s = s0; s <= s1; s++) for (let o = oa; o <= ob; o++) { const c = f.at(s, o); if (!dryAndBetween.has(ckey(c))) dock.push(c); }
  }
  const allow = shipWaterOf(g1.works);
  const anchorage = [];
  if (allow) {
    let end = -Infinity;
    for (const c of geo.kade) end = Math.max(end, f.s(c));
    for (const [gx, gz] of funnelCells(w.haven, size)) {
      const s = f.s([gx, gz]);
      if (s > end && s <= end + KADE_ANCHORAGE && allow(gx, gz)) anchorage.push([gx, gz]);
    }
  }

  // ---- pass 2: all of it, the moved yard standing ----
  const yardDry = yard ? yardRows(yard, 0, YARD_DRY).map(ckey) : [];
  const keepYard = yardStays ? oldYardCells.map(ckey) : [];
  const mask = uniqueCells([...geo.basin, ...geo.west, ...(yard && yardInFunnel ? oldYardCells : []), ...dock, ...anchorage])
    .filter(([gx, gz]) => terrain.inGrid(gx, gz));
  const g2 = ground(mask, [...yardDry, ...keepYard]);

  // The planks have to stay on open water, or the moorings (and every boat) would move.
  if (!kh.pier.every(([gx, gz]) => openWater(g2.T, gx, gz)) || !q.pier.every(([gx, gz]) => openWater(g2.T, gx, gz))) return refuse();
  // The quay's houses in its way have to have somewhere to go: the resort, asked of the layout as
  // it will stand, with a lot for every one of them.
  if (leaving.size) {
    const plots = Object.fromEntries(Object.entries(layout.plots).filter(([id]) => !lifts.includes(id)));
    if (yard) plots[YARD_ID] = yard;
    const { site } = resortSite({ ...layout, plots, works: g2.works }, g2.T, model);
    if (!site || site.lots.length < quayHome.size) return refuse();
  }

  layout.works = g2.works;
  if (yard) {
    layout.plots[YARD_ID] = yard;
    layout.paths = (layout.paths || []).filter((p) => p.id !== `path:${YARD_ID}`);
    claimCellsForTown(sup, layout.lattice, layout, yardRows(yard, 0, YARD_DRY));
  }
  liftCivics(layout, lifts, size);
  if (yard) pruneUnreachable(layout, size);
  layout.terrainHash = g2.T.hash;
  return g2.T;
}
// The town's ground that the harbour has drowned goes back to nobody. The commons only ever grew,
// and on the old shore it had taken super-cells for the crane, the warehouse and the yard
// (`claimCellsForTown`); the funnel and the quay's dig made them water, and the claim stayed -
// on Hoogezand seven super-cells in the middle of the harbour, drawn by the planner as the
// town's (the lighter squares in plan mode) and counted towards the commons' size, so the town
// had that much less real ground to grow into. A super-cell goes only when every one of its
// cells is water, nothing stands on it or crosses it, and it touches the harbour (a cell of the
// funnel or of a dig) - not all of it: the dig's underwater bank is water nobody dug, and on
// Hoogezand two drowned super-cells lay half on it. Never the town's core, which `registerLand`
// claims whatever the list says, and never town ground out at sea away from the harbour. Every pass,
// because an island whose quay was dug before this has no other moment to catch it; a no-op
// once done, since `growParcel` never grows onto water.
export function releaseHarbourCommons(layout, terrain) {
  const w = layout.works;
  if (!w || !w.haven || !layout.lattice || !(layout.town.commons || []).length) return;
  const harbour = new Set([...havenKeys(layout), ...dugKeys(layout)]);
  const taken = occupiedCells(layout);
  for (const p of layout.paths || []) for (const c of p.cells || []) taken.add(ckey(c));
  const drowned = ([i, j]) => {
    if (Math.abs(i) <= TOWN_CORE_R && Math.abs(j) <= TOWN_CORE_R) return false;
    const cells = cellsOfSuper(layout.lattice, i, j);
    return cells.some(([gx, gz]) => harbour.has(`${gx},${gz}`))
      && cells.every(([gx, gz]) => terrain.inGrid(gx, gz) && !taken.has(`${gx},${gz}`) && terrain.isWater(gx, gz));
  };
  const kept = layout.town.commons.filter((c) => !drowned(c));
  if (kept.length !== layout.town.commons.length) layout.town.commons = kept;
}
const uniqueCells = (cells) => { const seen = new Set(); return cells.filter((c) => { const k = ckey(c); if (seen.has(k)) return false; seen.add(k); return true; }); };
// Whether `planKade` would act on this layout now: the funnel is planned, the quay not yet asked,
// and there is a quay district with planks and harbours for it to be laid at (`kadeGeometry`).
// Not while the quay waits for the island to grow (`planKade`'s `canGrow`) on the grid and the harbours it
// waited on: another pass would only ask again and wait again. A ring that grew the grid, or planned
// the harbours again, is worth one more pass.
const kadeWaiting = new WeakMap();
const waitsStill = (layout) => { const w = kadeWaiting.get(layout); return !!w && w.size === layout.size && w.harbours === layout.harbours; };
function kadeDue(layout) {
  const w = layout.works, q = layout.districts && layout.districts.quay;
  return !waitsStill(layout) && !!(w && w.haven && w.kade === undefined && q && q.shore && (q.pier || []).length && layout.harbours && layout.lattice);
}

// ---- the resort on the sea -------------------------------------------------------------
// The quay district's houses do not stand in the harbour any more (Plans/quay-op-zee.md). They
// stood on piles in the middle of the water the boats need, and on the live island the stone
// quay had just been built for those boats; so the district - the Cowork tasks - moves out
// of the harbour to a recreation resort off the coast, and the harbour is the quay's. What
// moves is the houses. The district's planks (`districts.quay.pier`/`shore`) stay with the
// quay: they are the planks of the harbour on that side, and `standingQuay`, `kadehaven`,
// `waterfront`, the moorings, the first boat and the galleon all read them. Moving them too
// took the south harbour, boat 0 and the galleon out to sea with the houses (measured in the
// preview: the galleon left the big ships' water for the resort's own lane).
//
// The resort is `layout.resort`, a record of its own on the layout, not a field of the
// district and not a kind of `works`:
//   - not in `works`, because `checkWorks` and `parseBundle` refuse a field they do not know,
//     and an older sea would then refuse the whole island - for a record that moves no ground;
//   - not on `districts.quay`, because a PARCEL_VERSION bump keeps a district only as its
//     planks (`migrateParcels`) and would throw the resort away with the parcels, and because
//     lib/plan.mjs moves and merges district records by super-cell and has no business with
//     cells on the sea.
// It reaches every page and the sea only as what stands on it: the houses (plots with
// `quay`, drawn on piles) and the district's deck, which grows with the houses.
//
// Once, like the funnel: `undefined` until there is a stone quay and a quay district to ask
// for, `null` when that was asked and no site fits, the record from then on.
//
// The site is derived, never a cell: a beach foot on the quay's bank, a jetty out from it to
// a boardwalk spine, 3x3 lots on the water either side of the spine (doors on it), a second
// spine joined by a plank through a gap when the first one's arms are full - a comb, not a
// longer string - and a bathing raft beyond the end. The rules below are the preview's
// (scratchpad `oord/preview.mjs`), which the keeper approved on Hoogezand as variant A.
export const RESORT_ROAD = 'road:quay:resort';
// The piles reach this far down (scripts/build-boardwalk.py: 1.44 of pile under the deck that
// rides at QUAY_DECK, 0.44 - 1.44 = -1.00). Measured on Hoogezand: with every lot corner at
// -0.80 or shallower - the piles as they were - ten lots fit anywhere near the harbour; at
// -1.00, twenty. So the band ends here, and the piles were lengthened to it.
const RESORT_PILE_FOOT = -1.0;
// The shallow end: a lot's cell mean at most this, so it reads as water from above (the
// shader's surf band ends round -0.14) and no corner of it is sand.
const RESORT_WET = -0.15;
const RESORT_IDEAL = -0.45;        // the middle of the band, what the depth score measures from
// Open water between the resort and the harbour mouth: this many cells off the funnel's edge,
// and as many off the quay and its crane. The fairway is five across and a boat leaving turns
// in about that; at 3 and 1 the resort came down on the mouth's own shoulder.
const RESORT_FUNNEL_CLEAR = 6;
const RESORT_KADE_CLEAR = 6;
const RESORT_LOT_CLEAR = 1;        // a cell of open water round every lot, off anything standing
const RESORT_JETTY_MIN = 5;        // the landward lots need a cell of water between beach and house
const RESORT_JETTY_MAX = 14;
const RESORT_ROAD_MAX = 60;        // the most new road the resort may cost to reach the network
const RESORT_SEARCH = 70;          // beach feet within this of the quay's seaward end are tried
const RESORT_WANT = 9;             // lots the first spine must hold: the district on Hoogezand
const RESORT_GROW_TO = 20;         // room it should have to grow into
const RESORT_STRAND = 8;           // how far inland over the sand the jetty's foot may walk to a road
const RESORT_SPINE2 = 8;           // rows between the first spine and the second

const RESORT_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];

// Where the resort goes, from the layout and the ground alone: `{ site }` with the record
// `layout.resort` would hold, or `{ site: null, reason }`. Pure; `planResort` writes it.
export function resortSite(layout, terrain, model = null) {
  const w = layout.works, haven = w && w.haven, kade = w && w.kade;
  if (!haven || !kade) return { site: null, reason: 'no stone quay' };
  if (!layout.harbours) return { site: null, reason: 'no harbours yet' };
  const size = terrain.size;
  const moving = quayHouseIds(layout);
  const grid = replayGrid(terrain, layout, { skip: new Set(moving) });
  const wf = waterfront(layout, terrain, model || { districts: [{ id: 'quay' }] });
  const kadeEnd = kadeCraneCell(layout);
  const funnelClear = havenKeys(layout, RESORT_FUNNEL_CLEAR);
  const dug = dugKeys(layout);
  const fairway = new Set(((layout.fairway && layout.fairway.cells) || []).map(ckey));
  const kadeSet = new Set(kade.cells.map(ckey));
  const kadeClear = new Set();
  for (const [x, z] of [...kade.cells, kadeEnd]) {
    for (let dz = -RESORT_KADE_CLEAR; dz <= RESORT_KADE_CLEAR; dz++) for (let dx = -RESORT_KADE_CLEAR; dx <= RESORT_KADE_CLEAR; dx++) kadeClear.add(`${x + dx},${z + dz}`);
  }
  const ships = shipWaterOf(w);
  // Everything standing that is not the quay district's own (which is what moves).
  const own = new Set([...moving.map((id) => `path:${id}`)]);
  const standing = new Set();
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (moving.includes(id)) continue;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) standing.add(`${p.gx + x},${p.gz + z}`);
  }
  for (const p of layout.paths || []) {
    if (own.has(p.id) || String(p.id).startsWith('road:quay:')) continue;
    for (const c of p.cells) standing.add(ckey(c));
  }
  for (const b of layout.bridges || []) for (const c of b.cells) standing.add(ckey(c));
  for (const h of layout.harbours || []) if (h) for (const c of [...(h.pier || []), ...(h.slip || [])]) standing.add(ckey(c));
  const polderCells = new Set();
  for (const p of layout.polders || []) for (const c of [...(p.cells || []), ...(p.dike || []), ...(p.road || []), ...(p.pools || [])]) polderCells.add(ckey(c));
  // Which bank: the funnel's axis, the quay's side of it. Along: from the funnel's top out.
  const side = (gx, gz) => Math.sign((gx - haven.top[0]) * haven.dir[1] - (gz - haven.top[1]) * haven.dir[0]);
  const quaySide = side(kade.cells[0][0], kade.cells[0][1]);
  const along = (gx, gz) => (gx - haven.top[0]) * haven.dir[0] + (gz - haven.top[1]) * haven.dir[1];

  const refused = (gx, gz) => {
    const k = `${gx},${gz}`;
    return !terrain.inGrid(gx, gz) || funnelClear.has(k) || fairway.has(k) || dug.has(k) || kadeClear.has(k)
      || wf.near.has(k) || wf.corridor(gx, gz) || wf.swings(gx, gz) || !!(ships && ships(gx, gz))
      || wf.works.has(k) || polderCells.has(k) || standing.has(k);
  };
  const nearStanding = (gx, gz, r) => {
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (standing.has(`${gx + dx},${gz + dz}`)) return true;
    return false;
  };
  const lotCellOk = (gx, gz) => {
    if (refused(gx, gz) || nearStanding(gx, gz, RESORT_LOT_CLEAR)) return false;
    if (side(gx, gz) !== quaySide || along(gx, gz) <= 0) return false;
    const c = [terrain.corner(gx, gz), terrain.corner(gx + 1, gz), terrain.corner(gx, gz + 1), terrain.corner(gx + 1, gz + 1)];
    return c.every((h) => h < 0 && h >= RESORT_PILE_FOOT) && terrain.heightAt(gx, gz) <= RESORT_WET;
  };
  const deckCellOk = (gx, gz) => !refused(gx, gz) && side(gx, gz) === quaySide && terrain.isWater(gx, gz);

  // Nobody else's land under the foot: any district but the quay (whose houses move).
  const lat = layout.lattice;
  const owned = new Set();
  if (lat) {
    for (const [id, d] of Object.entries(layout.districts || {})) {
      if (id === 'quay') continue;
      for (const lobe of d.lobes || []) for (const [i, j] of lobe.cells) {
        const [ax, az] = blockOf(lat, i, j);
        for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) owned.add(`${ax + x},${az + z}`);
      }
    }
  }
  const footOk = (gx, gz) => {
    const k = `${gx},${gz}`;
    if (!terrain.inGrid(gx, gz) || !terrain.isLand(gx, gz) || !terrain.isBeach(gx, gz)) return false;
    if (funnelClear.has(k) || kadeSet.has(k) || standing.has(k) || owned.has(k) || dug.has(k)) return false;
    const v = grid.get(gx, gz);
    return (v === FREE || v === BLOCKED) && side(gx, gz) === quaySide;
  };
  // The way in: from the foot straight inland over the sand (a strandpad, like a harbour's slip)
  // to the first free cell, and on from there with the island's own router to the square. What
  // it costs is what it would newly pave.
  const roads = new Map();
  const roadFrom = (s, u) => {
    const k0 = `${s}:${u}`;
    if (roads.has(k0)) return roads.get(k0);
    let res = null;
    const strand = [s];
    let c = s;
    for (let i = 0; i < RESORT_STRAND; i++) {
      const n = [c[0] - u[0], c[1] - u[1]];
      if (!grid.in(n[0], n[1]) || !terrain.isLand(n[0], n[1])) break;
      const v = grid.get(n[0], n[1]);
      if (v === PATH || v === SQUARE) { res = { strand, fresh: strand.length }; break; }
      if (v === FREE) {
        const route = routePath(grid, n, { isGoal: (cell, x) => x === SQUARE, budget: 400000 });
        if (route) res = { strand, fresh: route.filter(([x, z]) => grid.get(x, z) === FREE).length + strand.length };
        break;
      }
      if (v !== BLOCKED || !terrain.isBeach(n[0], n[1])) break;
      strand.push(n); c = n;
    }
    if (res && res.fresh > RESORT_ROAD_MAX) res = null;
    roads.set(k0, res);
    return res;
  };

  const frame = (s, u) => {
    const v = [-u[1], u[0]];
    return { s, u, v, at: (k, t) => [s[0] + u[0] * k + v[0] * t, s[1] + u[1] * k + v[1] * t] };
  };
  // A lot's cells, its rot (door towards the spine) and its door step, for spine row J.
  const lotOf = (F, J, lot) => {
    const ks = lot.bank === 'land' ? [J - 3, J - 2, J - 1] : [J + 1, J + 2, J + 3];
    const cells = [];
    for (const k of ks) for (let t = lot.t0; t < lot.t0 + 3; t++) cells.push(F.at(k, t));
    const gx = Math.min(...cells.map((c) => c[0])), gz = Math.min(...cells.map((c) => c[1]));
    const face = lot.bank === 'land' ? F.u : [-F.u[0], -F.u[1]];
    return { ...lot, gx, gz, rot: rotOf(face), cells, tDoor: lot.t0 + 1 };
  };
  // The first spine's four arms - the seaward bank east and west of the jetty, the landward
  // bank east and west - handed out round the arms, so the district grows both ways from the
  // jetty. The seaward bank's first lot sits square across the spine from the jetty; the
  // landward bank leaves the jetty a cell of water either side.
  const ARMS = { 'sea+': (n) => -1 + 4 * n, 'land+': (n) => 2 + 4 * n, 'sea-': (n) => -5 - 4 * n, 'land-': (n) => -4 - 4 * n };
  const LOTS = [];
  for (let n = 0; n < 12; n++) for (const arm of ['sea+', 'land+', 'sea-', 'land-']) LOTS.push({ arm, bank: arm.slice(0, -1), t0: ARMS[arm](n) });

  // A comb: shore cell s, seaward u, spine at row J. Lots in LOTS order while they fit (an arm
  // whose next lot fails is closed); the spine runs to every door without a gap.
  const tryComb = (s, u, J) => {
    const F = frame(s, u);
    const jetty = [];
    for (let k = 1; k <= J; k++) { const c = F.at(k, 0); if (!deckCellOk(c[0], c[1])) return null; jetty.push(c); }
    const lots = [];
    let tMin = 0, tMax = 0;
    const taken = new Set(jetty.map(ckey));
    const lotCells = new Set();
    const dead = new Set();
    for (const lot of LOTS) {
      if (dead.has(lot.arm)) continue;
      const l = lotOf(F, J, lot);
      if (l.cells.some((c) => taken.has(ckey(c)) || !lotCellOk(c[0], c[1]))) { dead.add(lot.arm); continue; }
      const lo = Math.min(tMin, l.tDoor), hi = Math.max(tMax, l.tDoor);
      let ok = true;
      for (let t = lo; t <= hi; t++) { const c = F.at(J, t); if (!deckCellOk(c[0], c[1]) || lotCells.has(ckey(c))) { ok = false; break; } }
      if (!ok) { dead.add(lot.arm); continue; }
      tMin = lo; tMax = hi;
      for (const c of l.cells) { taken.add(ckey(c)); lotCells.add(ckey(c)); }
      lots.push(l);
      if (lots.length >= RESORT_GROW_TO) break;
    }
    if (lots.length < RESORT_WANT) return null;
    const first = lots.slice(0, RESORT_WANT);
    const spine = []; for (let t = tMin; t <= tMax; t++) spine.push(F.at(J, t));
    // Past the first spine's arms: a second spine RESORT_SPINE2 rows further out, joined to the
    // first by a plank through the gap between its middle seaward lots (t = 2).
    const J2 = J + RESORT_SPINE2, connector = [], spine2 = [];
    if (lots.length < RESORT_GROW_TO) {
      let ok = true;
      const plank = [];
      for (let k = J + 1; k < J2 && ok; k++) { const c = F.at(k, 2); if (!deckCellOk(c[0], c[1]) || taken.has(ckey(c))) ok = false; else plank.push(c); }
      if (ok) {
        const dead2 = new Set();
        let lo2 = 2, hi2 = 2, any = false;
        const order = [];
        for (let n = 0; n < 12; n++) for (const arm of ['land2+', 'sea2+', 'land2-', 'sea2-']) order.push({ arm, bank: arm.startsWith('land') ? 'land' : 'sea', t0: arm.endsWith('+') ? 3 + 4 * n : -1 - 4 * n });
        for (const lot of order) {
          if (dead2.has(lot.arm) || lots.length >= RESORT_GROW_TO) continue;
          const l = lotOf(F, J2, lot);
          if (l.cells.some((c) => taken.has(ckey(c)) || plank.some((d) => d[0] === c[0] && d[1] === c[1]) || !lotCellOk(c[0], c[1]))) { dead2.add(lot.arm); continue; }
          const lo = Math.min(lo2, l.tDoor), hi = Math.max(hi2, l.tDoor);
          let good = true;
          for (let t = lo; t <= hi; t++) { const c = F.at(J2, t); if (!deckCellOk(c[0], c[1]) || taken.has(ckey(c))) { good = false; break; } }
          if (!good) { dead2.add(lot.arm); continue; }
          lo2 = lo; hi2 = hi;
          for (const c of l.cells) taken.add(ckey(c));
          lots.push({ ...l, spine: 2 });
          any = true;
        }
        if (any) { connector.push(...plank); for (let t = lo2; t <= hi2; t++) spine2.push(F.at(J2, t)); }
      }
    }
    const len1 = Math.max(0, ...first.map((l) => l.tDoor)) - Math.min(0, ...first.map((l) => l.tDoor)) + 1;
    const tFar = Math.max(...spine.map((c) => (c[0] - F.at(J, 0)[0]) * F.v[0] + (c[1] - F.at(J, 0)[1]) * F.v[1]));
    return { shape: 'T', F, s, u, J, jetty, deck: [...spine, ...connector, ...spine2], lots, first, len1, mid: F.at(J, 0), tFar };
  };
  // The other shape: a pier straight out from the beach with the houses along both its sides,
  // doors on the pier. The first lots start K0 cells out, pitch 4 along it.
  const tryPier = (s, u, K0) => {
    const F = frame(s, u);
    const lots = [], taken = new Set(), dead = new Set();
    let kEnd = 0;
    const order = [];
    for (let n = 0; n < 12; n++) for (const arm of ['A', 'B']) order.push({ arm, k0: K0 + 4 * n });
    for (const o of order) {
      if (dead.has(o.arm)) continue;
      const ts = o.arm === 'A' ? [1, 2, 3] : [-3, -2, -1];
      const cells = [];
      for (let k = o.k0; k < o.k0 + 3; k++) for (const t of ts) cells.push(F.at(k, t));
      if (cells.some((c) => taken.has(ckey(c)) || !lotCellOk(c[0], c[1]))) { dead.add(o.arm); continue; }
      let ok = true;
      for (let k = 1; k <= o.k0 + 2 && ok; k++) { const c = F.at(k, 0); if (!deckCellOk(c[0], c[1])) ok = false; }
      if (!ok) { dead.add(o.arm); continue; }
      for (const c of cells) taken.add(ckey(c));
      const face = o.arm === 'A' ? [-F.v[0], -F.v[1]] : F.v;
      lots.push({ gx: Math.min(...cells.map((c) => c[0])), gz: Math.min(...cells.map((c) => c[1])), rot: rotOf(face), cells, kDoor: o.k0 + 1 });
      kEnd = Math.max(kEnd, o.k0 + 2);
      if (lots.length >= RESORT_GROW_TO) break;
    }
    if (lots.length < RESORT_WANT) return null;
    const first = lots.slice(0, RESORT_WANT);
    const end1 = Math.max(...first.map((l) => l.kDoor)) + 1;
    const jetty = []; for (let k = 1; k <= end1; k++) jetty.push(F.at(k, 0));
    const rest = []; for (let k = end1 + 1; k <= kEnd; k++) rest.push(F.at(k, 0));
    return { shape: 'I', F, s, u, J: K0, jetty, deck: rest, lots, first, len1: end1 - K0, mid: F.at(Math.round(end1 / 2), 0), tFar: 0 };
  };
  // Lower wins: near the harbour (the spine's middle to the quay's seaward end), a short jetty,
  // lots near the middle of the depth band, little new road, and room to grow.
  const score = (r, fresh) => {
    const dKade = Math.hypot(r.mid[0] - kadeEnd[0], r.mid[1] - kadeEnd[1]);
    let dev = 0, n = 0;
    for (const l of r.first) for (const c of l.cells) { dev += Math.abs(terrain.heightAt(c[0], c[1]) - RESORT_IDEAL); n++; }
    const grow = Math.min(RESORT_GROW_TO, r.lots.length) - RESORT_WANT;
    const cost = dKade + 0.5 * r.J + 0.3 * r.len1 + 0.5 * fresh + 20 * (dev / n) + 2 * (RESORT_GROW_TO - RESORT_WANT - grow);
    return { cost: +cost.toFixed(3), tie: hash32(`${layout.seed}:resort:${r.shape}:${r.s[0]},${r.s[1]}:${rotOf(r.u)}:${r.J}`) };
  };

  let best = null, feet = 0, withRoad = 0;
  const consider = (r, route) => {
    const sc = score(r, route.fresh);
    if (!best || sc.cost < best.sc.cost || (sc.cost === best.sc.cost && sc.tie < best.sc.tie)) best = { r, route, sc };
  };
  for (let gz = kadeEnd[1] - RESORT_SEARCH; gz <= kadeEnd[1] + RESORT_SEARCH; gz++) {
    for (let gx = kadeEnd[0] - RESORT_SEARCH; gx <= kadeEnd[0] + RESORT_SEARCH; gx++) {
      if (!footOk(gx, gz)) continue;
      feet++;
      for (const u of RESORT_DIRS) {
        const first = [gx + u[0], gz + u[1]];
        if (!terrain.inGrid(first[0], first[1]) || !terrain.isWater(first[0], first[1])) continue;
        let route = null, asked = false;
        for (let J = RESORT_JETTY_MIN; J <= RESORT_JETTY_MAX; J++) {
          const r = tryComb([gx, gz], u, J);
          if (!r) continue;
          if (!asked) { route = roadFrom([gx, gz], u); asked = true; if (route) withRoad++; }
          if (!route) break;
          consider(r, route);
        }
        for (let K0 = 2; K0 <= 8; K0++) {
          const r = tryPier([gx, gz], u, K0);
          if (!r) continue;
          if (!asked) { route = roadFrom([gx, gz], u); asked = true; if (route) withRoad++; }
          if (!route) break;
          consider(r, route);
        }
      }
    }
  }
  if (!best) return { site: null, reason: !feet ? 'no free beach on the quay\'s bank' : !withRoad ? 'no road reaches a beach with room off it' : 'no water with room for the district' };
  const { r, route } = best;
  // The bathing raft: past the far end of the spine, a few cells beyond the last lots.
  const all = new Set([...r.jetty, ...r.deck, ...r.lots.flatMap((l) => l.cells)].map(ckey));
  const clearOfAll = ([x, z]) => { for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (all.has(`${x + dx},${z + dz}`)) return false; return true; };
  const raft = [[0, 3], [0, 4], [-2, 3], [2, 3]].map(([dk, dt]) => r.F.at(r.J + dk, r.tFar + dt)).find((c) => deckCellOk(c[0], c[1]) && clearOfAll(c)) || null;
  const site = {
    foot: r.s, out: [r.u[0], r.u[1]], shape: r.shape,
    jetty: r.jetty.map((c) => [c[0], c[1]]),
    deck: sortedCells(uniqueCells(r.deck)),
    lots: r.lots.map((l) => ({ gx: l.gx, gz: l.gz, rot: l.rot })),
    raft,
    strand: route.strand.map((c) => [c[0], c[1]]),
  };
  return { site, reason: null };
}

// The quay district's houses: every house the district owns, wherever it stands.
function quayHouseIds(layout) {
  return Object.keys(layout.plots || {}).filter((id) => id.startsWith('house:') && layout.plots[id].district === 'quay').sort();
}

// The resort's cells: `lots` (every lot's nine, by index), `deck` (every plank it will ever
// have: the jetty, the spines and the plank between them) and `drawn` - the planks the houses
// standing now need, the shortest walk inside the deck from the jetty's first plank to each
// occupied lot's doorstep. The deck grows with the district; what is not drawn yet is kept
// free (RESERVED) all the same, so nothing else takes the water it will grow into.
export function resortCells(layout) {
  const r = layout.resort;
  if (!r) return null;
  const lots = r.lots.map((l) => { const out = []; for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) out.push([l.gx + x, l.gz + z]); return out; });
  const deck = [...r.jetty, ...r.deck];
  const inDeck = new Map(deck.map((c) => [ckey(c), c]));
  const occupied = new Set();
  for (const p of Object.values(layout.plots || {})) if (p.district === 'quay' && Number.isInteger(p.lot)) occupied.add(p.lot);
  const drawn = new Map();
  const start = r.jetty[0];
  if (start && occupied.size) {
    const prev = new Map([[ckey(start), null]]);
    const q = [start];
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      for (const [dx, dz] of N4) {
        const k = `${c[0] + dx},${c[1] + dz}`;
        if (prev.has(k) || !inDeck.has(k)) continue;
        prev.set(k, c); q.push(inDeck.get(k));
      }
    }
    for (const n of [...occupied].sort((a, b) => a - b)) {
      const l = r.lots[n];
      if (!l) continue;
      const step = outsideDoor(l.gx, l.gz, l.rot);
      if (!prev.has(ckey(step))) continue;
      for (let c = step; c; c = prev.get(ckey(c))) drawn.set(ckey(c), c);
    }
  }
  return { lots, deck, drawn: sortedCells([...drawn.values()]), occupied };
}

// The water a growth ring must leave the resort: everything the grown resort covers - lots,
// deck, raft - with a cell round it, as far as it is water on the ground now (the jetty's foot
// stays beach). `growStep` hands it to the ring as lane decided in advance (settleRing's
// `seed`) and as channel, so a ring keeps it open and gives it a way to the sea if it shuts it
// in - a lagoon with its mouth, never a pond - and it is written on the step as ordinary
// `lane`. Grid indices.
export function resortWater(layout, terrain) {
  const rc = resortCells(layout);
  if (!rc) return [];
  const foot = new Set([...rc.lots.flat(), ...rc.deck, ...(layout.resort.raft ? [layout.resort.raft] : [])].map(ckey));
  const out = new Map();
  for (const k of foot) {
    const [x, z] = k.split(',').map(Number);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const gx = x + dx, gz = z + dz;
      if (terrain.inGrid(gx, gz) && terrain.isWater(gx, gz)) out.set(`${gx},${gz}`, [gx, gz]);
    }
  }
  return sortedCells([...out.values()]);
}
// The resort as ground nothing else may take - a polder, a dredger, a ship - with the ring round
// it: `resortWater`'s cells without asking the ground, for the readers that have none to hand.
function resortKeep(layout) {
  const rc = resortCells(layout);
  if (!rc) return [];
  const out = new Set();
  for (const [x, z] of [...rc.lots.flat(), ...rc.deck, ...(layout.resort.raft ? [layout.resort.raft] : [])]) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.add(`${x + dx},${z + dz}`);
  }
  return [...out];
}

// Stamps the resort into a replayed grid: the planks the houses need as road (a boardwalk, like
// a dug path over water), and the rest of the deck and every free lot as RESERVED, so the water
// it grows into stays its own. Only over water: the foot is the road's, a plot stays a plot.
function markResort(grid, layout) {
  const rc = resortCells(layout);
  if (!rc) return;
  const drawn = new Set(rc.drawn.map(ckey));
  const water = (gx, gz) => grid.get(gx, gz) === BLOCKED && !grid.t.isLand(gx, gz);
  for (const c of rc.deck) if (water(c[0], c[1])) grid.set(c[0], c[1], drawn.has(ckey(c)) ? PATH : RESERVED);
  rc.lots.forEach((cells, n) => {
    if (rc.occupied.has(n)) return;
    for (const c of cells) if (water(c[0], c[1])) grid.set(c[0], c[1], RESERVED);
  });
  if (layout.resort.raft && water(...layout.resort.raft)) grid.set(layout.resort.raft[0], layout.resort.raft[1], RESERVED);
}

// The first free lot of the resort, in the order they are handed out, or -1.
function freeResortLot(layout) {
  const r = layout.resort;
  if (!r) return -1;
  const taken = new Set();
  for (const p of Object.values(layout.plots || {})) if (p.district === 'quay' && Number.isInteger(p.lot)) taken.add(p.lot);
  for (let n = 0; n < r.lots.length; n++) if (!taken.has(n)) return n;
  return -1;
}
function resortPlot(layout, n) {
  const l = layout.resort.lots[n];
  return { gx: l.gx, gz: l.gz, w: 3, d: 3, rot: l.rot, district: 'quay', lobe: -1, lot: n, quay: true };
}

// The one move of the quay's houses (Plans/quay-op-zee.md): every house of the quay district not
// yet on a lot of the resort is set down on the next free one, in the order they arrived. "A
// house never moves by itself" is broken here once, on purpose, the way `unsettleQuay` breaks it:
// harbour houses are Cowork tasks, the shortest-lived settlers the island has, and the harbour
// they stood in is the boats'. Their front paths go (the deck is their street now), their sheds
// go back to the shed loop, and the district's land on the shore goes back to the countryside
// once nothing of it is left standing. A house the resort has no lot for stays where it is.
// Returns the ids moved.
function moveToResort(layout, model = null) {
  if (!layout.resort) return [];
  const order = new Map(((model && model.buildings) || []).filter((b) => b.kind !== 'shed')
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)).map((b, i) => [b.id, i]));
  const ids = quayHouseIds(layout).filter((id) => !Number.isInteger(layout.plots[id].lot))
    .sort((a, b) => (order.has(a) ? order.get(a) : Infinity) - (order.has(b) ? order.get(b) : Infinity) || a.localeCompare(b));
  const moved = [];
  for (const id of ids) {
    const n = freeResortLot(layout);
    if (n < 0) break;
    layout.plots[id] = resortPlot(layout, n);
    moved.push(id);
  }
  if (!moved.length) return moved;
  const gone = new Set(moved);
  for (const [shed, master] of Object.entries(layout.shedOf || {})) {
    if (gone.has(master)) { delete layout.plots[shed]; delete layout.shedOf[shed]; }
  }
  layout.paths = (layout.paths || []).filter((p) => !gone.has(String(p.id).replace(/^path:/, '')));
  const q = layout.districts && layout.districts.quay;
  const lat = layout.lattice;
  if (q && lat && (q.lobes || []).length && !quayHouseIds(layout).some((id) => !Number.isInteger(layout.plots[id].lot))) {
    const land = new Set();
    for (const lobe of q.lobes) for (const [i, j] of lobe.cells) {
      const [ax, az] = blockOf(lat, i, j);
      for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) land.add(`${ax + x},${az + z}`);
    }
    // Its lanes (`road:quay:<lobe>`), whether or not a lobe still names its own.
    const roads = new Set(q.lobes.map((l) => l.road).filter(Boolean));
    layout.paths = layout.paths.filter((p) => !roads.has(p.id) && !/^road:quay:\d+$/.test(String(p.id)));
    layout.cleared = (layout.cleared || []).filter((c) => !land.has(ckey(c)));
    q.lobes = [];
    q.centre = null;
    q.square = null;
    q.paved = [];
  }
  return moved;
}

// Plans the resort once, when there is a stone quay and a quay district for it, and moves the
// district's houses onto it. Changes no ground: the resort's water is only held open by the
// growth rings after it (`resortWater`). With no site for it on an island that can still grow it
// waits, as the quay does (`planKade`), rather than being refused for good.
export function planResort(layout, terrain, model, { canGrow = false } = {}) {
  if (layout.resort !== undefined) return null;
  const w = layout.works;
  // Decided in the pass that decides the quay, whatever else is still missing: a scan that asked
  // on the next pass or the next scan instead would not be a no-op.
  if (!w || w.kade === undefined) return null;
  if (w.kade === null) { layout.resort = null; return null; }
  if (!layout.harbours || !((model && model.districts) || []).some((d) => d.kind === 'quay' || d.id === 'quay')) return null;
  const { site } = resortSite(layout, terrain, model);
  if (!site && canGrow) return null;
  layout.resort = site;
  if (!site) return null;
  const moved = moveToResort(layout, model);
  if (moved.length) pruneUnreachable(layout, terrain.size);
  return moved;
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
  // `belt` is BELT everywhere but `growLobe`'s last resort, which lets a hamlet that is boxed
  // in grow up against its neighbours rather than fall apart into two pieces.
  eligible(i, j, k, allowBeach, belt = BELT) {
    if (!this.usable(i, j, allowBeach)) return false;
    if (this.owner[this.di(i, j)] !== NONE) return false;
    return !this.foreignWithin(i, j, belt, k);
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
// from its green as it is today. `rr` and `belt` are for `growLobe`'s wider rungs only.
//
// `roomy` is for land a house asked for: only a cell whose 3x3 block is free in the grid is a
// candidate (with the rung's own `allowBeach`, which accepts exactly the sand `claim` frees).
// See the house loop in `placeAll` for why it has to be a filter and not a preference.
function growParcel(sup, lobe, k, tg, allowBeach, grid, { rr = radiusOf(tg), belt = BELT, roomy = false } = {}) {
  while (lobe.cells.length < tg) {
    const cand = new Map();
    for (const [ci, cj] of lobe.cells) {
      for (const [di, dj] of N4) {
        const a = ci + di, b = cj + dj;
        if (scheb([a, b], lobe.seed) > rr) continue;
        if (!sup.eligible(a, b, k, allowBeach, belt)) continue;
        if (roomy && !grid.freeBlock(...blockOf(sup.lat, a, b), 3, 3, allowBeach)) continue;
        cand.set(`${a},${b}`, [a, b]);
      }
    }
    if (!cand.size) return false;                     // boxed in; see growLobe
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

// A lobe grown to `tg` cells the ordinary way, and when that runs out of room short of
// `need`, wider: first past the radius cap, then up against the neighbours (a belt of none -
// never onto their land). Only as far as `need`, the houses that have to stand here; the
// gardens a hamlet is given on top of that (`parcelTarget`) are only ever grown the ordinary
// way. Exported for lib/plan.mjs's `merge`, which has to grow a hamlet by exactly the rule a
// scan grows it by.
//
// The wider rungs are what took the place of the annex (Plans/DONE/wijkjes-samenvoegen.md). A
// boxed-in hamlet used to found a second lobe up to ANNEX_REACH away, and after that only
// the newest lobe ever grew, so a project ended up in two or three pieces with most of its
// houses in whichever came last: measured on the live island, Settlers' first lobe stayed
// two cells while its annex grew to forty-six. A hamlet that crept into an L, or that stands
// against its neighbour's hedge, still reads as one place; one in three pieces does not.
//
// The last rung takes beach as well: a super-cell of sand and grass that is not all buildable,
// which is often all a hamlet by a lake or the shore has left beside it. The house still needs
// its 3x3 on buildable ground (`freeBlock(…, false)` in `freeCellIn`), and `claim` hands the
// sand's cells to the grid as FREE exactly as it does for the quay. Measured, seed 7 founded
// small and grown to 240 settlers: 13 houses of its first project on the commons without this
// rung, none with it.
export function growLobe(sup, lobe, k, tg, need, allowBeach, grid, { roomy = false } = {}) {
  growParcel(sup, lobe, k, tg, allowBeach, grid, { roomy });
  if (lobe.cells.length < need) growParcel(sup, lobe, k, need, allowBeach, grid, { rr: Infinity, roomy });
  if (lobe.cells.length < need) growParcel(sup, lobe, k, need, allowBeach, grid, { rr: Infinity, belt: 0, roomy });
  if (lobe.cells.length < need && !allowBeach) growParcel(sup, lobe, k, need, true, grid, { rr: Infinity, belt: 0, roomy });
  return lobe.cells.length >= need;
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
// claiming anything new. A project keeps to one piece of land: a lobe that is boxed in grows
// wider (`growLobe`) and every older lobe of a project from before this is tried as well,
// the newest first, because only the newest used to grow. Only the quay still founds an
// annex, the next stretch of quayside along the same shore (`annexes`); a project in two or
// three pieces is what Plans/DONE/wijkjes-samenvoegen.md was written to undo.
export const annexes = (rec) => (rec.pier || []).length > 0;
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
    if (!annexes(rec)) {
      const pieces = [last, ...rec.lobes.slice(0, -1)];
      for (const lobe of pieces) {
        const short = pop - capacity();
        if (short <= 0) break;
        growLobe(sup, lobe, k, lobe.cells.length + short, lobe.cells.length + short, allowBeach, grid);
      }
      break;
    }
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
// `w` is the lot's width, three for everything but the castle (CASTLE_LOT): the door is in
// the middle of the front, which on a three by three is one cell in from the corner and on
// the castle's seven is three. `d` is its depth along z, the same as `w` on every square lot
// and different only on the shipyard's five by sixteen (`lotOf`): both are the plot's own
// `w` and `d` as stamped, x and z, whichever way the lot is turned.
export function doorCell(gx, gz, rot, w = 3, d = w) {
  if (rot === 0) return [gx + (w >> 1), gz];
  if (rot === 1) return [gx + w - 1, gz + (d >> 1)];
  if (rot === 2) return [gx + (w >> 1), gz + d - 1];
  return [gx, gz + (d >> 1)];
}
// The cell a door opens onto, which is the one cell of a plot's surroundings that has to
// stay walkable: a front path starts here, and a shed standing on it walls the house in.
// Exported because tests/layout-measure.test.mjs asks whether every house can be reached,
// and a second copy of this convention would answer for the wrong doors as soon as one of
// them changed.
export function outsideDoor(gx, gz, rot, w = 3, d = w) {
  if (rot === 0) return [gx + (w >> 1), gz - 1];
  if (rot === 1) return [gx + w, gz + (d >> 1)];
  if (rot === 2) return [gx + (w >> 1), gz + d];
  return [gx - 1, gz + (d >> 1)];
}

// A plot's door and the cell it opens onto, `{ door, step }`, or null for a plot that has
// none: anything on a single cell (a shed, a well, a lamp), and a ship, which lies at anchor
// with no way ashore at all. The shipyard is the one building whose door is not in the middle
// of its front: its front is the slipway's end in the sea (Plans/DONE/mijlpalen-tot-tweehonderd.md),
// and its gate is where the model has it (`yardGate`), at the landward end.
//
// The one reading of where a building is entered, for everything that asks - scan.mjs's
// `door` on each record, the civic roads below, the planner's doorsteps and its stranding
// check - because each of them used to work it out from `p.w` alone, which a lot sixteen long
// and five wide answers wrongly, and a ship not at all.
export function plotDoor(id, p) {
  if (!p || (p.w < 3 && p.d < 3) || isShipId(id)) return null;
  if (id === YARD_ID) return yardGate(p);
  return { door: doorCell(p.gx, p.gz, p.rot, p.w, p.d), step: outsideDoor(p.gx, p.gz, p.rot, p.w, p.d) };
}

// The yard's gate, in the model's own frame - x across, z along, the sea at +z, the origin the
// middle of the lot: the baked `anchor.door` of assets/shipyard (scripts/build-shipyard.py),
// on the landward edge and in the strip down one side that the model keeps clear from the gate
// to the water. Not the middle of the landward end: the shed stands there. The cell inside that
// edge is the door and the one outside it the step, each turned onto the grid by the quarter
// turn the page gives the lot (web/js/shipyard.js `turnLocal`, makeRecord's yaw), so the road
// comes in where the model's gate is drawn.
export const YARD_GATE = [2.2, -8];
const QUARTERS = [(x, z) => [-x, -z], (x, z) => [z, -x], (x, z) => [x, z], (x, z) => [-z, x]];
function yardGate(p) {
  const at = (x, z) => {
    const [dx, dz] = QUARTERS[((p.rot % 4) + 4) % 4](x, z);
    return [Math.floor(p.gx + p.w / 2 + dx), Math.floor(p.gz + p.d / 2 + dz)];
  };
  return { door: at(YARD_GATE[0], YARD_GATE[1] + 0.5), step: at(YARD_GATE[0], YARD_GATE[1] - 0.5) };
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

// The road to a civic lot's door, for the two places that lay one - the milestone loop and
// the relay after it. First exactly as it always was, from the walkable cell nearest the step,
// and only when no road leaves from there does it look any further. That is mostly the harbour
// buildings' case rather than a neighbour's: the warehouse, the weigh house and the fisherman's
// hut open on open water by rule (`coastSite`), so their step is sea, and on a wide beach the
// four rings round it hold sand and at best a pocket of meadow walled in by it, which
// `nearestWalkable` takes and `routePath` cannot leave. Measured on the live island on 29
// September 2026: the warehouse and the weigh house placed the day before and never roaded,
// while the hut on the same coast was, because its rings happened to reach the meadow; and on
// the ladder to 200 at size 128, seed 11's weigh house and seed 7's chronicle house the same.
//
// So the fallback walks out from the lot itself over the land a road may not use (beach, as
// `beachWalk` does, and any meadow on the way) to the nearest cell a road may start on, and
// takes it only if it is joined to the square - a pocket is exactly what failed. No further
// than BEACH_WALK_MOST, the ceiling on a walk over the beach everywhere else.
//
// And the sand it walks is paved - the strandpad (Plans/DONE/strandpaden.md). Left bare, the road
// began wherever the meadow did, and a settler walks to a door only from a road cell within
// GATE_REACH of it (`houseGate` in shared/roads.mjs): seed 11's weigh house had its road nine
// cells off, over seven of beach, and nobody could reach it. A door that opens on the sand
// (`coastSite`'s second round) walks from its own step first, so the road starts at the door.
// A door on the sea (the strict round) walks from the lot before `nearestWalkable` is asked:
// four rings round a step in the water reach across it, and on seed 10 the weigh house's road
// began on a lane five cells from its door, which is a road on paper and none to walk. The walk
// starts beside the lot, so it is always within GATE_REACH of the door.
// The sand goes into the road's `cells` like any paving, so every reader has it for free, and
// into `strand` as well, which is what the replay forces back to PATH every scan (a slipway's
// `slip` is the same thing): the replay paves only FREE cells, and beach is BLOCKED, so without
// it a road on the sand would read as free ground to the next lot that may stand on the beach.
//
// `{ cells, strand }` in the order a settler walks them from the door, or null if there is
// still none - and that is a site the placing should not take (`coastSite` asks this of every
// lot before it takes one): seed 2024's weigh house stood on a spit of beach whose only way
// ashore was through the warehouse's lot, with its door on the sea.
function civicRoad(grid, layout, p, door) {
  // Sand, not any BLOCKED land: a civic inland whose step is merely steep keeps the road it
  // always got.
  const [sx, sz] = door.step;
  if (grid.get(sx, sz) === BLOCKED && grid.t.isLand(sx, sz) && grid.t.isBeach(sx, sz)) {
    const walked = strandWalk(grid, layout, [[sx, sz]], true);
    if (walked) return walked;
  }
  const lot = [];
  for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) if (grid.in(p.gx + x, p.gz + z)) lot.push([p.gx + x, p.gz + z]);
  const sea = grid.t.isWater(sx, sz);
  if (sea) {
    const walked = strandWalk(grid, layout, lot, false);
    if (walked) return walked;
  }
  const direct = routePath(grid, nearestWalkable(grid, door.step));
  if (direct) return { cells: direct, strand: [] };
  return sea ? null : strandWalk(grid, layout, lot, false);
}

// Whether a road from `civicRoad` begins where a settler at the door would find it
// (`houseGate`'s box in shared/roads.mjs).
const atDoor = (road, door) => !!road && !!road.cells.length
  && Math.max(Math.abs(road.cells[0][0] - door[0]), Math.abs(road.cells[0][1] - door[1])) <= GATE_REACH;

// The walk `civicRoad` falls back on: breadth first from `from` - the lot, or the step of a
// door on the sand, which is then the first cell of the walk (`own`) - four-connected in N4's
// order, over BLOCKED land and ground a road may start on, to the nearest cell of that ground
// joined to the square, and the road on from there.
function strandWalk(grid, layout, from, own) {
  const size = grid.size;
  const joined = floodFrom(grid, layout.town.centre).seen;
  const start = (v) => v === FREE || v === PATH || v === SQUARE;
  const prev = new Int32Array(size * size).fill(-2);
  let frontier = [];
  for (const [x, z] of from) { prev[x + z * size] = -1; frontier.push([x, z]); }
  for (let step = 0; step < BEACH_WALK_MOST && frontier.length; step++) {
    const next = [];
    for (const [x, z] of frontier) {
      for (const [dx, dz] of N4) {
        const nx = x + dx, nz = z + dz;
        if (!grid.in(nx, nz)) continue;
        const n = nx + nz * size;
        if (prev[n] !== -2) continue;
        prev[n] = x + z * size;
        const v = grid.cells[n];
        if (start(v) && joined[n]) {
          const road = routePath(grid, [nx, nz]);
          if (!road) return null;
          const walk = [];
          for (let k = prev[n]; k >= 0; k = prev[k]) {
            if (prev[k] === -1 && !own) break;
            walk.push([k % size, (k - (k % size)) / size]);
          }
          walk.reverse();
          const strand = walk.filter(([gx, gz]) => grid.get(gx, gz) === BLOCKED);
          return { cells: [...walk, ...road], strand };
        }
        if (start(v) || (v === BLOCKED && grid.t.isLand(nx, nz))) next.push([nx, nz]);
      }
    }
    frontier = next;
  }
  return null;
}

// Lays what `civicRoad` found under `path:<id>`: the sand made FREE first so `markPath` paves
// it and writes it down, and `strand` kept on the record for the replay.
function layCivicRoad(grid, layout, id, road) {
  if (!road) return;
  for (const [gx, gz] of road.strand) grid.set(gx, gz, FREE);
  markPath(grid, layout, id, road.cells);
  if (!road.strand.length) return;
  const rec = layout.paths.find((q) => q.id === id);
  if (rec) rec.strand = [...(rec.strand || []), ...road.strand.map(([gx, gz]) => [gx, gz])];
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
export function routePath(grid, from, { isGoal = null, budget = 40000, bridge = false } = {}) {
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
// The shortest walk from `from` over land the router may not use (BLOCKED: beach, mostly) to
// a cell next to ground it may - FREE, PATH or the square - four-connected and in a fixed
// order, so the same island always gets the same cells. Never over water, a dike, a zone
// or anything built. Null if there is none within BEACH_WALK_MOST cells.
const BEACH_WALK_MOST = 16;
export function beachWalk(grid, from) {
  const size = grid.size;
  const k = (x, z) => x + z * size;
  const prev = new Map([[k(from[0], from[1]), null]]);
  let frontier = [from];
  for (let step = 0; step < BEACH_WALK_MOST && frontier.length; step++) {
    const next = [];
    for (const [x, z] of frontier) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!grid.in(nx, nz) || prev.has(k(nx, nz))) continue;
        const v = grid.get(nx, nz);
        if (v === FREE || v === PATH || v === SQUARE) {
          // Arrived: the walk is every beach cell from the one after `from` to here.
          const out = [];
          for (let c = [x, z]; c && !(c[0] === from[0] && c[1] === from[1]); c = prev.get(k(c[0], c[1]))) out.push(c);
          return out.reverse();
        }
        if (v !== BLOCKED || !grid.t.isLand(nx, nz)) continue;
        prev.set(k(nx, nz), [x, z]);
        next.push([nx, nz]);
      }
    }
    frontier = next;
  }
  return null;
}

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
  const terrain = makeTerrain(seed, { size, polders: layout.polders || [], fairway: layout.fairway || null, works: layout.works || null, grow: layout.grow || null });
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
  // The last two are only ever reached when one of the five before them is taken: [3, -1] is where
  // the pirate's chest goes (beside the tavern's door on the east lot), and a fifth bench with no
  // cell of its own was sent to the outermost paving of the whole town - measured, [-12, -3].
  bench: [[-1, 1], [1, -1], [-1, -1], [-3, 1], [3, -1], [3, 1], [-3, -1]],
  terrace: [[2, -3], [-2, 3], [1, 3]],
};

// The town's own plan (Plans/DONE/knus-dorpscentrum.md): a ring of eight lots round the square
// and four shopping streets leaving it, laid out like this, relative to the town centre:
//
//      ..............iii==mmm.........      #  the square, seven wide at its widest
//      .........GGG..aaa==eee.........      =  a street, two cells wide
//      ...ppphhhLLL..HHH==MMM.........      H V P K  hall, tavern, chapel, clock tower:
//      ...=========#######............               the middle of each side, facing in
//      ...llldddKKK#######VVVbbbjjj...      M B E L  market, bakery, tea room, library:
//      ............#######=========...               the corners, each facing the street
//      .........EEE==PPP..BBBfffnnn...               that starts beside it
//      .........ggg==ccc..............      a..p     the street lots, filled in that order
//      .........ooo==kkk..............      G        the gold pit, behind the library
//
// Every lot is three by three, the size the planner already moves and turns, and they stand
// shoulder to shoulder: the lots touch, and each shop stands at the front of its own, towards
// the street, at the size of the tavern - a street of them reads as a village street, with an
// alley between each pair of houses as on the rest of the island. The other gap on each side
// of the square stays an alley, which is where the hamlets' roads can come in without a street.
//
// `at` is a lot's min corner and `look` the cell its front faces, both from the centre.
const RING = {
  N: { at: [-1, -6], look: [0, 0] },
  NE: { at: [4, -6], look: [2, -5] },
  E: { at: [4, -1], look: [0, 0] },
  SE: { at: [4, 4], look: [5, 2] },
  S: { at: [-1, 4], look: [0, 0] },
  SW: { at: [-6, 4], look: [-2, 5] },
  W: { at: [-6, -1], look: [0, 0] },
  NW: { at: [-6, -6], look: [-5, -2] },
};
// The eight lots the civic buildings stand on, as the min corner of each three by
// three relative to the town centre. They are deliberately off the house lattice and
// shoulder to shoulder around a seven wide square, so their frontage is the edge of
// the plaza and the middle of it stays one open space you can walk across. The same eight
// as they always were, in the same order, so `town.lots` on an island reads as it did.
const CIVIC_LOTS = Object.values(RING).map((s) => s.at);
// Which lot of the ring each building of the square takes. Everything else of three by three
// that is not a workshop goes on a street.
const RING_OF = {
  townhall: 'N', tavern: 'E', chapel: 'S', clocktower: 'W',
  market: 'NE', bakery: 'SE', tearoom: 'SW', library: 'NW',
};
// The four streets: out through one of the two gaps on each side, turning with the clock,
// in the two `lanes` either side of the line the gap is on. A street is laid from the square
// out to the far edge of the last building standing on it, so it grows with its shops.
const STREETS = [
  { lanes: [2, 3], dir: [0, -1] },     // north
  { lanes: [2, 3], dir: [1, 0] },      // east
  { lanes: [-3, -2], dir: [0, 1] },    // south
  { lanes: [-3, -2], dir: [-1, 0] },   // west
];
// The corner of the ring that stands on each street, and how far out it reaches along it.
const RING_STREET = { NE: 0, SE: 1, SW: 2, NW: 3 };
const RING_FAR = 6;
// The street lots in the order they fill: the pair nearest the square on every street before
// the next pair on any of them, so the four streets grow together rather than one running out
// into the country while the others stand empty. `far` is where the lot's back edge lies
// along its street.
const STREET_LOTS = [
  { at: [-1, -9], look: [2, -8], street: 0, far: 9 },
  { at: [7, -1], look: [8, 2], street: 1, far: 9 },
  { at: [-1, 7], look: [-2, 8], street: 2, far: 9 },
  { at: [-9, -1], look: [-8, -2], street: 3, far: 9 },
  { at: [4, -9], look: [3, -8], street: 0, far: 9 },
  { at: [7, 4], look: [8, 3], street: 1, far: 9 },
  { at: [-6, 7], look: [-3, 8], street: 2, far: 9 },
  { at: [-9, -6], look: [-8, -3], street: 3, far: 9 },
  { at: [-1, -12], look: [2, -11], street: 0, far: 12 },
  { at: [10, -1], look: [11, 2], street: 1, far: 12 },
  { at: [-1, 10], look: [-2, 11], street: 2, far: 12 },
  { at: [-12, -1], look: [-11, -2], street: 3, far: 12 },
  { at: [4, -12], look: [3, -11], street: 0, far: 12 },
  { at: [10, 4], look: [11, 3], street: 1, far: 12 },
  { at: [-6, 10], look: [-3, 11], street: 2, far: 12 },
  { at: [-12, -6], look: [-11, -3], street: 3, far: 12 },
];
// The two buildings of a street that are not shops take its far end instead of its first
// free lot: a water tower in the middle of a row of shopfronts is not a street anybody would
// build, and the school wants its own corner of town rather than a shop window.
const OUTSKIRTS = new Set(['school', 'watertower']);
// The gold pit's lot, behind the library, with its mouth on the alley beside it: next to the
// square as Plans/DONE/goudkuil.md wants, and off every street, where it would take a shop's lot.
const GOLDPIT_LOT = { at: [-6, -9], look: [-3, -8] };
// What `migrateTown` lifts: every civic three by three that the centre lays out itself. Not
// the castle, which is seven and never moves by itself, and nothing on the square.
// The bakery and the stable are on it because an island already has them: they were rungs
// placed by `TRADES` on the animals' branch (codex/dierenverhalen, Plans/DONE/stal-en-veld.md)
// before this plan, and the bakery now belongs on a corner of the square. The shops follow for
// the same reason should any branch have placed one first.
const TOWN_LAID = new Set(['townhall', 'market', 'tavern', 'clocktower', 'school', 'watertower', 'chapel',
  'sawmill', 'smithy', 'goldpit', 'bakery', 'stable', 'butcher',
  'grocer', 'apothecary', 'tailor', 'library', 'tearoom', 'wandmaker', 'sweetshop', 'owlpost', 'cauldron']);
// How far out the workshops stand, in super-cells: past the last street lot (twelve cells out,
// so the third ring of the lattice still touches them) and into the countryside.
const TRADE_RING = 4;
// How far the town's plan reaches from the centre either way: the last street lot's far edge
// (twelve) and the cell beyond it. A new castle stands outside it.
const TOWN_REACH = 13;
// The plan as one object, for the tests that hold a town to it (tests/town-plan.test.mjs).
export const TOWN_PLAN = { RING, RING_OF, STREETS, STREET_LOTS, OUTSKIRTS, GOLDPIT_LOT, TOWN_LAID, TRADE_RING, TOWN_REACH };

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

// The pirate's sea chest (Plans/schatkaarten.md) and the treasure statue: one cell each, and both
// sticky like every civic plot - written once, never moved by a scan.
export const PIRATE_ID = 'civic:pirate';
export const TREASURE_ID = 'civic:treasure';
// The Salty Kraken (Plans/piratenkroeg.md): the pirates' pub at the water, and from the day it
// stands the one the chest stands behind - see "the pirate's sea chest" in `placeAll`.
export const PUB_ID = 'civic:piratetavern';
// Which way is "along the front" of a building at each `rot`: DOOR_DIR turned a quarter, the
// same (-oz, ox) shared/settlerwalk.mjs `spawn` uses for a keeper's `aside`. Kept here as data
// because this file does not import the walk; tests/pirate.test.mjs holds the two together.
const ALONG_FRONT = [[1, 0], [0, 1], [-1, 0], [0, -1]];
// Where the treasure statue may stand on the square, best first, as offsets from the town centre.
// No road ends on any of them, and none is a preferred cell of anything on the square (ON_SQUARE,
// SQUARE_BOARDS - the inner corners are only their fallbacks). The three inner corners come first
// because they are paved from the three-wide green onwards, so the statue never depends on how far
// the square has grown; the benches want the same corners (FURNITURE_SPOTS) and simply take the
// rim when the statue has them. The four knight-move cells are named by no list above at all; they
// are inside the plaza only from five wide, and the caller checks that against the paving rather
// than assuming it. The caller also refuses whatever is occupied by then, so a bench that got
// there first sends the statue on to the next.
const TREASURE_SPOTS = [[-1, -1], [1, -1], [-1, 1], [1, -2], [-2, -1], [2, 1], [-1, 2]];
// Civic types that take a single cell instead of a full three by three lot.
const SMALL = new Set(['well', 'tables', 'fountain', 'statue', 'lighthouse', 'windmill', 'poldermill', 'crane',
  // The bridge's own stone. One cell, and it never comes through the milestone loop at
  // all - `planBridge` places it once there are roads to join - but SMALL is also what
  // says a civic is drawn on a single cell rather than a three by three lot, and that is
  // read wherever a plot is read.
  'bridge',
  // The pirate's sea chest beside the tavern door and the treasure statue on the square
  // (Plans/schatkaarten.md). Neither comes through the milestone loop - the chest waits for
  // the tavern, the statue for the keeper to set it down - but both are one cell.
  'pirate', 'treasure']);

// The castle stands on two super-cells square rather than one (Plans/DONE/groot-kasteel.md): two
// three by three plots and the lane between them, both ways, with the outer lane left a
// lane - eating that too would be eating the neighbours' road. web/js/buildings.js draws the
// model at `w / 3` of its baked size, so a castle that could not grow stays the old one.
export const CASTLE_ID = 'civic:castle';
export const CASTLE_LOT = 2 * PITCH - 1;
// The most the ground may rise across the castle's lot. A 3x3 is flat enough whenever each
// cell is buildable; seven of them in a row on a slope every cell passes can still leave a
// corner in the air, and the porch's skirt reaches PORCH_SKIRT (0.7) down and no further.
const CASTLE_RELIEF = 0.6;
// The workshops. Three by three like any civic with a door, but never on one of the lots
// of the town's plan: a sawmill is not a shop, and on the old centre the sawmill and the
// smithy stood pressed against the ring round the square, because the nearest free block
// was the rule. `tradeSite` puts them out beyond the streets instead (TRADE_RING), where the
// town meets the countryside, on ground that is the town's or nobody's.
//
// The stable is one too (Plans/DONE/stal-en-veld.md): a paddock and a horse are the edge of town,
// not the high street. It was measured against its bake before it was put here, because a trade
// is handed a three by three: the paddock was modelled to fill its lot - its outer rail's posts
// stand on the lot line itself, 1.5 out, so it pokes half a post (0.018) past it and no further -
// and tests/trades.test.mjs holds every trade's bake to the `w` its plot was given. The bakery,
// a trade here for a morning on the animals' branch, is a shop of the square in the town's plan.
//
// The brewery, the training field and the chronicle house are the ladder past a hundred
// (Plans/DONE/mijlpalen-tot-tweehonderd.md), and the reason is the same one: by then the lots of
// the plan are the castle's and the shops', and a building that is not a shop belongs where
// the town meets the country.
const TRADES = new Set(['sawmill', 'smithy', 'stable', 'brewery', 'trainingfield', 'chronicle']);
// How far from the town centre a civic building's middle may stand and still be given a
// pavement round it by the frontage block in `placeAll`. Exported so that lib/plan.mjs asks
// the same question when it works out which paving belongs to whom.
export const FRONTAGE_REACH = 6;
// The two lots that are not square (Plans/DONE/mijlpalen-tot-tweehonderd.md), as they stand turned
// the model's way - `w` across, `d` from stern to bow, from the landward end to the sea. A
// ship is a hull twelve long at anchor and her lot the water she lies on; the yard is the
// slipway she is built on, square to the coast. Sixteen is not a round number but the ceiling:
// parseBundle (lib/islandbundle.mjs `plot`) accepts a `w` and a `d` of 1 to 16, and a longer
// one makes every sea from before this refuse the whole island.
export const SHIP_LOT = { w: 4, d: 16 };
export const YARD_LOT = { w: 5, d: 16 };
// How big a civic type's lot is, as `{ w, d }` at rot 0 and 2 - the long side runs along z -
// before `stamped` turns it: SMALL is one cell, the castle its own seven, a ship and the yard
// the two above, and everything else three.
export const lotOf = (civicType) => (SMALL.has(civicType) ? { w: 1, d: 1 }
  : civicType === 'castle' ? { w: CASTLE_LOT, d: CASTLE_LOT }
    : civicType === 'ship' ? SHIP_LOT
      : civicType === 'shipyard' ? YARD_LOT
        : { w: 3, d: 3 });
// A lot as it lies on the grid at `rot`: a quarter turn swaps its two sides, which is all a
// turn does to a lot that is not square and nothing at all to one that is. `w` is then along
// x and `d` along z, which is what every reader of a plot takes them to be.
export const stamped = (lot, rot) => (rot % 2 ? { w: lot.d, d: lot.w } : { w: lot.w, d: lot.d });

// Which cells the plots already written into the layout stand on. Everything that goes on
// the square reads its occupancy from here rather than from the cell grid, for the reason
// in `ON_SQUARE`: the grid cannot see a one-cell plot. This is the only definition of
// "something already stands here" that the square has, and every block that puts
// something on it - the two boards, the on-square civics, the furniture - asks it.
// Put `id` back into `plots` at position `index` of its keys, without replacing the object: the
// order of `layout.plots` is the order of layout.json, and a key that came back at the end would
// change the bytes of everything after it.
function putBackAt(plots, id, value, index) {
  const keys = Object.keys(plots);
  const tail = (index >= 0 ? keys.slice(index) : []).map((k) => [k, plots[k]]);
  for (const [k] of tail) delete plots[k];
  plots[id] = value;
  for (const [k, v] of tail) plots[k] = v;
}

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
// island with the same seed. Exported for lib/plan.mjs, which has to tell a building's own
// pavement from its neighbours' when the keeper moves it (`civicSite`).
export function frontageOf(p) {
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

// Whether a lot of the town's plan can be built on now: every cell free, or held for the town
// this scan (`held`, the RESERVED marks the ring and the street lots were given) - never a
// keeper's no-build zone or a polder's dike, which are RESERVED too and are not the town's
// to take. With a land register, every cell also has to be on the town's ground or nobody's:
// a street lot the commons has not reached yet may be built on, one a hamlet holds may not.
function townLotOpen(grid, held, gx, gz, land = null) {
  for (let z = 0; z < 3; z++) {
    for (let x = 0; x < 3; x++) {
      const cx = gx + x, cz = gz + z;
      if (grid.get(cx, cz) === RESERVED ? !held.has(`${cx},${cz}`) : !grid.freeCell(cx, cz, false)) return false;
      if (land) {
        const [i, j] = superOf(land.lat, cx, cz);
        const who = land.sup.at(i, j);
        if (who !== NONE && who !== TOWN) return false;
      }
    }
  }
  return true;
}

// Where a civic type stands in the town's plan, as `{ at, look }` in island cells, or null
// when every place of its kind is taken - the caller then falls back to the nearest free
// block, which is all there was before the plan. A building of the square takes its own lot
// of the ring and otherwise the first street lot there is; everything else takes a street
// lot, from the square outwards, or from the far end for OUTSKIRTS.
function townSite(grid, layout, held, civicType, land = null) {
  const c = layout.town.centre;
  const place = (s) => ({ at: [c[0] + s.at[0], c[1] + s.at[1]], look: [c[0] + s.look[0], c[1] + s.look[1]] });
  const ring = RING[RING_OF[civicType]];
  if (ring) {
    const s = place(ring);
    if (townLotOpen(grid, held, s.at[0], s.at[1], land)) return s;
  }
  for (const lot of OUTSKIRTS.has(civicType) ? [...STREET_LOTS].reverse() : STREET_LOTS) {
    const s = place(lot);
    if (townLotOpen(grid, held, s.at[0], s.at[1], land)) return s;
  }
  return null;
}

// A workshop's lot (TRADES): the nearest free block of the town's lattice at least
// TRADE_RING super-cells out, on ground that is the town's or nobody's. Null when the island
// has no such ground - then the caller falls back to the nearest free block, as it used to.
function tradeSite(grid, sup, lat, centre) {
  for (let r = TRADE_RING; r <= MAX_RING; r++) {
    for (const [dx, dz] of RINGS[r]) {
      const [gx, gz] = blockAt(centre, dx, dz);
      if (!grid.freeBlock(gx, gz, 3, 3, false)) continue;
      const [i, j] = superOf(lat, gx, gz);
      const who = sup.at(i, j);
      if (who === NONE || who === TOWN) return [gx, gz];
    }
  }
  return null;
}

// Which way a lot off the town's plan faces: towards `look` if its door opens onto ground
// someone can stand on, and otherwise the next side that does. The fallbacks (the nearest free
// block, a workshop's lot) used to face the town whatever stood there, and in a town of lots
// shoulder to shoulder the side towards the square is as likely as not another building's
// wall - measured on seed 2024, the gold pit's mouth opened into the wand maker's back room.
function openRot(grid, block, w, look) {
  const first = facing([block[0] + (w >> 1), block[1] + (w >> 1)], look);
  for (const turn of [0, 1, 3, 2]) {
    const rot = (first + turn) % 4;
    const [dx, dz] = outsideDoor(block[0], block[1], rot, w);
    const v = grid.get(dx, dz);
    if (v === FREE || v === PATH || v === SQUARE) return rot;
  }
  return first;
}

// The cells of one of the four STREETS, from the town centre's own row or column out to
// `far`, both lanes, in a fixed order so the paving comes out the same on every scan.
function streetCells(centre, street, far) {
  const out = [];
  for (let t = 0; t <= far; t++) {
    for (const lane of street.lanes) {
      out.push([
        centre[0] + (street.dir[0] ? street.dir[0] * t : lane),
        centre[1] + (street.dir[1] ? street.dir[1] * t : lane),
      ]);
    }
  }
  return out;
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
  markResort(grid, layout);
  // The quay's stone road and its boardwalks, as placeAll replays them.
  for (const c of kadeRoadCells(layout)) grid.set(c[0], c[1], PATH);
  const dug = dugKeys(layout);
  for (const p of layout.paths || []) {
    for (const [gx, gz] of p.cells) {
      const v = grid.get(gx, gz);
      if (v === FREE || (v === BLOCKED && dug.has(`${gx},${gz}`) && !terrain.isLand(gx, gz))) grid.set(gx, gz, PATH);
    }
    for (const [gx, gz] of p.strand || []) if (grid.get(gx, gz) === BLOCKED && terrain.isLand(gx, gz)) grid.set(gx, gz, PATH);
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
//
// The one thing it keeps is `grow`: that is the island's shape, not a plan laid on it, and
// the ground it is being planned again on is the ground `grow` makes.
function resetForNewTerrain(layout, seed, size) {
  const fresh = emptyLayout(seed, size, layout.grow || null);
  // The ground is planned again; the village is still the one that earned what it earned.
  const ladder = layout.ladder;
  for (const k of Object.keys(layout)) delete layout[k];
  Object.assign(layout, fresh);
  if (ladder) layout.ladder = ladder;
}

// ---- growing -------------------------------------------------------------------------
// An island founded small (`layout.grow`, Plans/DONE/eiland-laten-groeien.md) grows when the
// village no longer fits: `placeAll` ends with houses it found no room for, takes one step
// here, and places again - in the same scan, so the scan after it finds everybody housed
// and changes nothing. Asked of the placement rather than of a settler count, which is the
// one thing the polder ladder may not do; it can here because the step and the placing it
// was for happen in one call, and the hash is recorded before the second pass reads it.
//
// How far one step reaches: a third again, and never less than four cells, so a 32-grid
// island (coast 15) goes 20, 26, 34, 45, 59, 77, 101 - about doubling its land each time -
// and the last step is cut to the grid's own coast (120 on 256, what an island founded on
// the whole grid has), so an island that grows is never smaller than one that did not.
// Twelve steps in one scan is more than 32 to 512 takes, so a village that arrives all at
// once - a keeper inviting the whole register - is housed by the scan it arrived in.
const GROW_MOST = 12;
// Whether a ring of new ground could give a house with no room in its own hamlet a plot.
// Only if `ensureParcel` came up short of land (`guest`): a new hamlet that found no seed,
// the quay with an annex still to found, or a project whose one piece of land lies by the
// sea, since a project founds no annex and the new coast has to be ground it can grow onto
// (`bySea`). Not for a hamlet boxed in inland, which no ring reaches, and not for one short
// of a free block rather than of land (`guest` false), which new coast does nothing for.
const landWouldHelp = (rec, terrain, lat) => !!rec.guest && (
  !(rec.lobes || []).length
  || (annexes(rec) ? rec.lobes.length < MAX_LOBES : rec.lobes.some((l) => bySea(terrain, lat, l))));
// A super-cell beside the lobe with sea or beach in it, or off the grid - where a growth
// step raises ground (it only ever raises sea and beach joined to open water). A river is
// water no ring raises; a lake is let through, which costs at most the one ring a house
// waits, the price every single-lobe hamlet paid before this.
function bySea(terrain, lat, lobe) {
  const own = new Set(lobe.cells.map((c) => `${c[0]},${c[1]}`));
  for (const [ci, cj] of lobe.cells) {
    for (const [di, dj] of N4) {
      const i = ci + di, j = cj + dj;
      if (own.has(`${i},${j}`)) continue;
      const [gx, gz] = blockOf(lat, i, j);
      for (let z = 0; z < lat.pitch; z++) {
        for (let x = 0; x < lat.pitch; x++) {
          const cx = gx + x, cz = gz + z;
          if (!terrain.inGrid(cx, cz) || terrain.isBeach(cx, cz)) return true;
          if (!terrain.isLand(cx, cz) && !terrain.isRiver(cx, cz)) return true;
        }
      }
    }
  }
  return false;
}
export function nextCoast(grow, size = Infinity) {
  const last = grow.steps.length ? grow.steps[grow.steps.length - 1].r : foundingCoast(grow.base);
  const next = Math.floor(last) + Math.max(4, Math.ceil(last * 0.3));
  const most = Math.floor(foundingCoast(size));
  return next > most && most > last ? most : next;
}

// What the new ground would drown, asked of the ground as it would be: the quay's planks,
// a harbour's, the landing, and the civics that only make sense on the coast - the lighthouse,
// a crane whose jib would hang over grass, and everything at sea or facing it
// (`strandedAtSea`: the ships, the yard, the harbour buildings).
function doomedBy(layout, T) {
  const q = layout.districts && layout.districts.quay;
  const quay = !!(q && (q.pier || []).length && !q.pier.every(([gx, gz]) => openWater(T, gx, gz)));
  const harbours = (layout.harbours || []).some((h) => h && !(h.pier || []).every(([gx, gz]) => openWater(T, gx, gz)));
  const coast = new Set(T.coastCells.map(([gx, gz]) => `${gx},${gz}`));
  const civics = [];
  for (const id of ['civic:lighthouse']) {
    const p = layout.plots[id];
    if (p && !coast.has(`${p.gx},${p.gz}`)) civics.push(id);
  }
  // The crane moves with its quay, and - since a crane may stand at the kadehaven's slipway
  // on an island with no quay (Plans/DONE/mijlpalen-tot-tweehonderd.md) - when the water it swings
  // out over is gone, on the lighthouse's own test.
  const crane = layout.plots['civic:crane'];
  if (crane && (quay || !coast.has(`${crane.gx},${crane.gz}`))) civics.push('civic:crane');
  civics.push(...strandedAtSea(layout, T));
  const landing = !!(layout.landing && !T.isBeach(layout.landing[0], layout.landing[1]) && !coast.has(`${layout.landing[0]},${layout.landing[1]}`));
  return { quay, harbours, civics, landing };
}

// Every path with a cell that cannot be walked to from the town square is dropped, and a
// hamlet road that goes this way hands its lobe back to `placeAll` to road again. The
// flood is `reachableFromSquare` out of shared/roads.mjs - the same one the debug overlay
// and the tests use - over paths and bridges, from the town's paving, four-connected.
export function pruneUnreachable(layout, size) {
  const village = { paths: layout.paths || [], bridges: layout.bridges || [], island: { town: layout.town }, districts: [] };
  const open = reachableFromSquare(village, size);
  const keep = [], dropped = [];
  for (const p of layout.paths || []) {
    const joined = (p.cells || []).every(([gx, gz]) => open.has(gx + gz * size));
    if (joined) keep.push(p); else dropped.push(p.id);
  }
  layout.paths = keep;
  for (const id of dropped) {
    const m = /^road:(.+):(\d+)$/.exec(String(id));
    if (!m) continue;
    const rec = Object.prototype.hasOwnProperty.call(layout.districts, m[1]) ? layout.districts[m[1]] : null;
    const lobe = rec && rec.lobes && rec.lobes[Number(m[2])];
    if (lobe && lobe.road === id) lobe.road = null;
  }
  return dropped;
}

// ---- a bigger grid -----------------------------------------------------------------------
// The grid itself grows, centred, when the island's next ring no longer fits on it
// (Plans/DONE/eiland-laten-groeien.md, fase 4). Nothing moves in the world: a cell's position is
// `gx - half + 0.5`, so every grid index stored in the layout goes up by `k` exactly as
// `half` does. What is stored in super-cells - lobes, parcels, the commons, zones, a
// polder's `supers` and `seed` - is measured from `lattice.anchor`, which moves with
// everything else, and so is left as it is. An island founded on its whole grid becomes
// one founded on that grid (`grow.base`) the first time, and its ground is then built
// there and set down in the middle, bit for bit what it was (`embed` in shared/terrain.mjs).
//
// Every field is named here, because the failure is silent: a list of cells left behind is
// a road, a dike or a pier drawn `k` cells off, with no error anywhere. tests/canvas-
// grow.test.mjs walks the whole layout and fails on any pair of numbers it finds that
// neither moved nor is a known super-cell field.
export function growCanvas(layout, newSize) {
  const k = (newSize - layout.size) / 2;
  if (!Number.isInteger(k) || k < 1) throw new Error(`a grid of ${layout.size} cannot grow to ${newSize}`);
  const cell = (c) => (Array.isArray(c) && c.length === 2 ? [c[0] + k, c[1] + k] : c);
  const cells = (list) => (Array.isArray(list) ? list.map(cell) : list);
  if (!layout.grow) layout.grow = { base: layout.size, steps: [] };
  for (const p of Object.values(layout.plots || {})) { p.gx += k; p.gz += k; }
  for (const p of layout.paths || []) { p.cells = cells(p.cells); if (p.strand) p.strand = cells(p.strand); }
  for (const b of layout.bridges || []) b.cells = cells(b.cells);
  for (const r of layout.roads || []) r.cells = cells(r.cells);
  layout.cleared = cells(layout.cleared || []);
  for (const p of layout.polders || []) {
    p.cells = cells(p.cells); p.dike = cells(p.dike); p.road = cells(p.road); p.pools = cells(p.pools);
  }
  if (layout.fairway) {
    layout.fairway.line = cells(layout.fairway.line); layout.fairway.cells = cells(layout.fairway.cells);
  }
  if (layout.works) {
    const w = layout.works;
    layout.works = { ...w };
    if (w.dig) layout.works.dig = w.dig.map((d) => ({ cells: cells(d.cells), hold: cells(d.hold) }));
    if (w.fill) layout.works.fill = cells(w.fill);
    // The funnel is a ray, so only its head moves (`dir` is a direction, not a cell): the ray
    // goes on through the new sea beyond the old edge by itself.
    if (w.haven) layout.works.haven = { ...w.haven, top: cell(w.haven.top) };
    // The quay's cells and what it held; `back` is a direction and `level` a height.
    if (w.kade) layout.works.kade = { ...w.kade, cells: cells(w.kade.cells), hold: cells(w.kade.hold) };
  }
  // The resort on the sea: its cells move, `out` is a direction.
  if (layout.resort) {
    const r = layout.resort;
    r.foot = cell(r.foot); r.jetty = cells(r.jetty); r.deck = cells(r.deck); r.strand = cells(r.strand); r.raft = cell(r.raft);
    for (const l of r.lots) { l.gx += k; l.gz += k; }
  }
  layout.landing = cell(layout.landing);
  if (layout.town) {
    const t = layout.town;
    t.square = cell(t.square); t.centre = cell(t.centre); t.lots = cells(t.lots); t.paved = cells(t.paved);
  }
  if (layout.lattice) layout.lattice.anchor = cell(layout.lattice.anchor);
  for (const h of layout.harbours || []) {
    if (!h) continue;
    h.shore = cell(h.shore); h.pier = cells(h.pier); h.slip = cells(h.slip);
  }
  for (const d of Object.values(layout.districts || {})) {
    d.pier = cells(d.pier); d.shore = cell(d.shore); d.centre = cell(d.centre); d.square = cell(d.square);
    d.paved = cells(d.paved); d.deck = cells(d.deck);
    for (const lobe of d.lobes || []) { lobe.centre = cell(lobe.centre); lobe.square = cell(lobe.square); lobe.paved = cells(lobe.paved); }
  }
  layout.size = newSize;
  return layout;
}

// Whether the island can take another step: a ring that fits on the grid it has, or on the
// bigger grid `cap` (config.maxGridSize, through islandCap) still allows. An island founded on its whole grid can
// grow as soon as the setting leaves it room to.
export function canGrowFurther(layout, cap = layout.size) {
  const room = roomOf(layout.size, cap);
  const grow = layout.grow || (room > layout.size ? { base: layout.size, steps: [] } : null);
  return !!grow && gridForCoast(nextCoast(grow, room)) <= room;
}
// The biggest grid an island may reach, centred: `cap` itself, or one short of it, since a
// grid grows by the same number of cells on either side.
const roomOf = (size, cap) => Math.max(size, cap - ((cap - size) % 2));
// A bigger grid is taken 32 cells at a time rather than one ring's worth, so the grid does
// not move under the island - and every index in the layout with it - on every step.
const GRID_STEP = 32;

// A ring of new ground laid round a polder leaves its sea wall standing in the meadow: a
// ridge at DIKE_H that `heldOf` and the RESERVED mark keep everybody off, so a strip of the
// best flat land on the island belongs to nobody for ever. A growth step therefore takes in
// every dike that no longer keeps any water out - not one cell of it next to water, sea or
// otherwise, which is stricter than "open sea" on purpose: a pond the ring cut off still
// wants its wall, and "no water at all" needs no flood from the edge to decide.
//
// Taking a dike in is taking its cells out of `p.dike`. That list is what makeTerrain stamps
// and what every reader - heldOf, replayGrid, placeAll, world.js, the planner - calls the
// wall, so all of them see the shorter wall with no new field to learn, and the ground the
// cells go back to is whatever lies under them: the ring's own meadow outside, the polder's
// floor where they share a corner with it. It was weighed against recording the absorption
// on the growth step (`step.absorb = [polder indices]`) and letting makeTerrain skip those
// dikes, and lost on two counts: polders are indexed and `unpolder` splices the list, so
// an index recorded on a step can come to point at a different polder; and a new field in
// `grow` is one a sea or a page from before this ignores - `parseBundle` there would hash
// the dike back in and refuse the island - where a shorter `dike` is something every
// version already reads the same way.
//
// Three things are left standing, all of them because a house never moves:
//   - every dike cell within one of something standing - a plot (the poldermill stands on
//     the first polder's dike, and a polder house at the foot of the wall shares its
//     corners), or a bridge. A cell's corners are shared with its eight neighbours and
//     nothing further, so this is exactly the set whose ground would shift under somebody;
//   - a polder whose levelling would turn any cell round it from land to water - the ring
//     leaves river banks as they were (GROW_RIVER_KEEP), and a dike stood there over sea;
//   - a polder already taken in, which keeps what it kept.
// `p.absorbed` is provenance - the index of the step that took it in - and refuses the
// polder to `unpolder` (lib/plan.mjs): there is no sea left to give it back to. It is kept
// off the bundle like `manual` and `at`, since it moves no height.
function absorbDikes(layout, T, leaving, stepIndex, build) {
  const standing = new Set();
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (leaving.has(id)) continue;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) standing.add(`${p.gx + x},${p.gz + z}`);
  }
  for (const b of layout.bridges || []) for (const [gx, gz] of b.cells) standing.add(`${gx},${gz}`);
  const around = (c, test) => {
    for (const [dx, dz] of [[0, 0], ...N8]) if (test(c[0] + dx, c[1] + dz)) return true;
    return false;
  };

  const trial = [];
  for (const p of layout.polders || []) {
    if (p.absorbed !== undefined || !(p.dike || []).length) continue;
    if (p.dike.some((c) => around(c, (gx, gz) => T.isWater(gx, gz)))) continue;     // still a sea wall
    const kept = p.dike.filter((c) => around(c, (gx, gz) => standing.has(`${gx},${gz}`)));
    if (kept.length === p.dike.length) continue;
    trial.push({ p, dike: p.dike, kept, gone: p.dike.filter((c) => !kept.includes(c)) });
    p.dike = kept;
  }
  if (!trial.length) return null;

  // Try them all at once and give back the dikes whose ground would let water in. Giving a
  // dike back only raises corners, so a polder that passed stays passed; each round drops
  // at least one polder, so this ends.
  for (;;) {
    const G = build();
    const bad = trial.filter((t) => t.gone.some((c) => around(c, (gx, gz) => T.isLand(gx, gz) && !G.isLand(gx, gz))));
    if (!bad.length) {
      for (const t of trial) t.p.absorbed = stepIndex;
      return G;
    }
    for (const t of bad) { t.p.dike = t.dike; trial.splice(trial.indexOf(t), 1); }
    if (!trial.length) return null;          // every dike back as it was: the caller's T stands
  }
}

export function growStep(layout, { seed, size, cap = size }) {
  size = layout.size || size;
  const room = roomOf(size, cap);
  if (!canGrowFurther(layout, cap)) return null;          // the grid is as far as it may go
  const r = nextCoast(layout.grow || { base: size, steps: [] }, room);
  if (gridForCoast(r) > size) {
    growCanvas(layout, Math.min(room, Math.ceil(gridForCoast(r) / GRID_STEP) * GRID_STEP));
    size = layout.size;
  }
  const grow = layout.grow;
  const opts = (steps) => ({ size, polders: layout.polders, fairway: layout.fairway, works: layout.works || null, grow: { base: grow.base, steps } });
  const now = makeTerrain(seed, opts(grow.steps));
  // Every step from now on is drawn with relief - hills of its own and rivers carried on to
  // the new coast (growRelief in shared/terrain.mjs) - and with `water`: it keeps the harbour
  // funnel open, gives the channel's water a lane to the sea and fills the ponds it would shut
  // in (settleRing). The funnel is copied onto the step as it stands now, in local coordinates
  // like `hold`, and the lanes and ponds are decided here (`settle`) and written on the step: a
  // step depends on nothing but itself, so a channel dug later never redraws it. The steps
  // already taken keep drawing as they were drawn, or every grown island's terrainHash would
  // be wrong.
  const w = layout.works;
  const haven = w && w.haven ? { top: [w.haven.top[0] - size / 2, w.haven.top[1] - size / 2], dir: w.haven.dir, w0: w.haven.w0, open: w.haven.open, max: w.haven.max } : null;
  const fresh = (hold) => ({ r, grid: size, hold, relief: RELIEF_VERSION, water: WATER_VERSION, ...(haven ? { haven } : {}) });
  // The resort's water is lane decided before the ring is judged, and channel too: the ring keeps
  // it open, and a ring that shuts it in gives it its way to the sea, so the resort becomes a
  // lagoon with a mouth and never a pond (`resortWater`). It is written on the step as ordinary
  // lane - bit for bit the ground a field of its own would draw (Plans/quay-op-zee.md), with
  // nothing new on the step for an older sea or page to refuse.
  const resortLane = resortWater(layout, now);
  const settled = (steps) => makeTerrain(seed, { ...opts(steps), settle: { index: steps.length - 1, channel: [...channelCells(layout), ...resortLane], lane: resortLane } });
  // Once without holding anything, to see what the ground drowns: what is going to move is
  // not held, or its pond would be kept round an empty lot.
  const doomed = doomedBy(layout, settled([...grow.steps, fresh([])]));

  const q = layout.districts && layout.districts.quay;
  const leaving = new Set(doomed.civics);
  if (doomed.quay && q && layout.lattice) {
    const lat = layout.lattice;
    const owned = new Set();
    for (const lobe of q.lobes || []) {
      for (const [i, j] of lobe.cells) {
        const [ax, az] = blockOf(lat, i, j);
        for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) owned.add(`${ax + x},${az + z}`);
      }
    }
    for (const [id, p] of Object.entries(layout.plots)) if (owned.has(`${p.gx},${p.gz}`)) leaving.add(id);
  }
  // Held: every cell something stays standing on and that has a corner low enough to move.
  // Only those - the rest is above the beach, which a step never touches - so the list is
  // the coast's houses, not the island's.
  const hold = new Set();
  const low = (gx, gz) => [now.corner(gx, gz), now.corner(gx + 1, gz), now.corner(gx, gz + 1), now.corner(gx + 1, gz + 1)].some((h) => h < BEACH_MAX);
  const keep = (gx, gz) => { if (now.inGrid(gx, gz) && low(gx, gz)) hold.add(`${gx - size / 2},${gz - size / 2}`); };
  for (const [id, p] of Object.entries(layout.plots)) {
    if (leaving.has(id)) continue;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) keep(p.gx + x, p.gz + z);
  }
  for (const b of layout.bridges || []) for (const [gx, gz] of b.cells) keep(gx, gz);
  const step = fresh([...hold].map((s) => s.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]));
  const decided = settled([...grow.steps, step]).settled;
  step.lane = decided.lane;
  step.ponds = decided.ponds;
  grow.steps.push(step);
  let T = makeTerrain(seed, opts(grow.steps));
  // A sea wall the new ground closed in is meadow from now on - see `absorbDikes`. After
  // the ring and before the hash, because levelling changes the ground the hash is of.
  const levelled = absorbDikes(layout, T, leaving, grow.steps.length - 1, () => makeTerrain(seed, opts(grow.steps)));
  if (levelled) T = levelled;

  // What drowned moves: the quay founds itself again at a pier that reaches the water, the
  // harbours are planned again (a standing quay keeps its side), the landing and the coast
  // civics are placed again by the loops that placed them the first time.
  if (doomed.quay) unsettleQuay(layout);
  for (const id of leaving) if (id.startsWith('civic:')) delete layout.plots[id];
  // A building that moves takes its road with it: the loop that places it again lays a new one
  // from its new door, and only if none is on record under its name - the yard's and the
  // harbour buildings' would otherwise lead to where they used to stand.
  const lifted = new Set([...leaving].filter((id) => id.startsWith('civic:')).map((id) => `path:${id}`));
  const roadsBefore = layout.paths.length;
  layout.paths = layout.paths.filter((p) => !lifted.has(p.id));
  const liftedRoads = layout.paths.length !== roadsBefore;
  if (doomed.harbours) {
    // Beside a stone quay the quay's own harbour keeps its roads: its planks lie in the dug
    // harbour, so it is planned again where it stood (`standingQuay`), and its approach is a
    // boardwalk over that harbour (planKade) - a road laid again from the slipway would find
    // water on every side of the ramp and no way to the square at all. Measured on Hoogezand's
    // copy: the approach was lost and the quay's deck went from 58 cells to 25.
    const keep = new Set();
    const q = layout.districts && layout.districts.quay;
    if (layout.works && layout.works.kade && q && q.shore) {
      (layout.harbours || []).forEach((h, n) => {
        if (h && h.shore && h.shore[0] === q.shore[0] && h.shore[1] === q.shore[1]) { keep.add(`road:harbour:${n}`); keep.add(`road:harbour:${n}:approach`); }
      });
    }
    layout.harbours = null;
    layout.paths = layout.paths.filter((p) => !String(p.id).startsWith('road:harbour:') || keep.has(p.id));
  }
  // A house path, a hamlet road, a quay lane may have braided onto a road that just went -
  // an old harbour's approach most of all. Whatever no longer joins the square goes too, and
  // `placeAll` lays it again from the door that needs it, the way a plan's re-route does.
  if (doomed.harbours || doomed.quay || liftedRoads) pruneUnreachable(layout, size);
  if (doomed.landing) layout.landing = null;
  // The ring is drawn with `water` (it keeps the channel's mouth open itself), so this only
  // ever finds work when the channel was already cut off before the step - or when a house
  // held in the ring's way (`hold`) left the lane no way through.
  const opened = repairFairway(layout, T, { seed, size });
  if (opened) T = opened;
  layout.terrainHash = T.hash;
  return T;
}

export function placeAll(layout, model, { seed, size = 64, cap = null, grown = 0, waited = new Set(), havenPass = 0 } = {}) {
  // The grid is the layout's own: a growth step may have enlarged it (growCanvas), and a
  // caller holding the number it started with would build the old grid's ground.
  size = layout.size || size;
  if (cap === null) cap = size;
  const waiting = [];
  // The fairway travels with the polders everywhere below, for the same reason: it is
  // ground the layout decided about, so a terrain built without it is a different island.
  // On a layout that has never been dredged it is null and `makeTerrain` does nothing with
  // it, which is what lets the hash check on the next line still recognise an island
  // planned before any of this existed.
  let terrain = makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway, works: layout.works || null, grow: layout.grow || null });
  // A layout with no hash on it was planned before this check existed, which means it was
  // planned on ground that has since had rivers cut through it - so a missing hash is a
  // mismatch, not a free pass. Without this, an island carried over from before the
  // rivers kept every plot while the water arrived underneath: measured, fourteen houses
  // ended up standing in a river and not one bridge was built. A fresh layout is empty,
  // so resetting it costs nothing.
  if (layout.terrainHash !== terrain.hash) {
    resetForNewTerrain(layout, seed, size);
    terrain = makeTerrain(seed, { size, polders: layout.polders, works: null, grow: layout.grow || null });   // and no polders, no channel, no works
  }
  layout.bridges = layout.bridges || [];
  // Whether this pass can still take a growth step if it runs out of room - see growStep.
  const canGrow = grown < GROW_MOST && canGrowFurther(layout, cap);
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
  // count of the people who have lived here is the one thing in reach that is. Every gate
  // below counts the ladder (`reachedOf`: the most settlers the village has ever had at
  // once), not who lives here now, so a tent packing up takes nothing already earned away.
  const mostEver = reachedOf(model);
  if (!layout.fairway && mostEver >= FAIRWAY_AT) {
    const dug = planFairway(terrain, layout);
    if (dug && dug.cells.length) {
      layout.fairway = dug;
      terrain = makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway, works: layout.works || null, grow: layout.grow || null });
      grid = new Grid(terrain);
    } else {
      // No river, or no way out to deep water that does not go through the island. Written
      // down all the same, so the search is not run again on every scan for ever.
      layout.fairway = { line: [], cells: [] };
    }
  }

  // ---- the river's mouth, and the ponds a ring shut in ----------------------------------
  // An island whose growth was drawn before rings kept water open (`water` on a step) may
  // have a channel that no longer reaches the sea and ponds inside its coast. Mended here,
  // before anything is judged buildable and before the hash goes on record below; all three
  // are a no-op once done. See `repairFairway`, `fillRingPonds` and `planHaven` (which waits
  // for a scan that finds the harbours on record).
  const opened = repairFairway(layout, terrain, { seed, size });
  if (opened) { terrain = opened; grid = new Grid(terrain); }
  const filled = fillRingPonds(layout, terrain, { seed, size });
  if (filled) { terrain = filled; grid = new Grid(terrain); }
  const haven = planHaven(layout, terrain, model, { seed, size });
  if (haven) { terrain = haven; grid = new Grid(terrain); }
  // The harbour as one piece of water with a stone quay (`planKade`): once there is a funnel and
  // a quay district with planks to lay it beside. Moves the yard to the pirates' bank and lifts
  // the crane, the harbour buildings and the ships for the loops below to place again.
  const kaded = planKade(layout, terrain, model, { seed, size, canGrow });
  if (kaded) { terrain = kaded; grid = new Grid(terrain); }
  // The quay district's resort on the sea, once there is a stone quay for it to keep out of the
  // way of (`planResort`, Plans/quay-op-zee.md). In the same pass as the quay, so a new island's
  // scan after it is still a no-op; it moves the district's houses onto the resort's lots and
  // changes no ground.
  planResort(layout, terrain, model, { canGrow });
  releaseHarbourCommons(layout, terrain);

  // ---- land off the water --------------------------------------------------------
  // Before anything is placed, because the heightfield has to be final before a single
  // cell is judged buildable - so the terrain and the cell grid are both built again if
  // the coast moved. Reclaiming appends to `layout.polders`, which is as sticky as
  // everything else in this file: land, once taken, is never given back.
  const reclaimed = reclaim(seed, size, latticeOf(layout), layout, mostEver, cap);
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
  migrateQuay(layout, terrain, layout.town.centre, model);

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
  // The stone quay is a street (`road:kade`): nothing builds on it and everybody walks it. Laid
  // once and forced back on every scan after, for the causeway's reason - `markPath` records only
  // what it paves itself, and appends to a name it has seen. All of the quay but the crane's cell.
  {
    const cells = kadeRoadCells(layout);
    if (cells.length) {
      if (layout.paths.some((q) => q.id === KADE_ROAD)) {
        for (const c of cells) grid.set(c[0], c[1], PATH);
      } else {
        for (const c of cells) if (grid.get(c[0], c[1]) === BLOCKED) grid.set(c[0], c[1], FREE);
        markPath(grid, layout, KADE_ROAD, cells);
      }
    }
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
  // The pirate's chest moves to the Salty Kraken once there is one ("the pirate's sea chest",
  // below). Lifted here, before anything is laid back on the grid, whenever it is about to move:
  // the pub is earned and not yet standing (it may be placed this very scan), or it stands and
  // the chest is not behind it. Lifted this early so the cell it leaves is bare for the whole of
  // this scan - moved later, the cell got its paving a scan after, and the scan after a move was
  // not byte-identical. Put back exactly where it was, in its place in `layout.plots`, when it
  // cannot go (`placeChest`), so a pub with no ground behind it costs nothing.
  const pubRung = model.milestones.some((m) => m.unlocked && m.civicType === 'piratetavern');
  let liftedChest = null;
  {
    const chest = layout.plots[PIRATE_ID], pub = layout.plots[PUB_ID];
    const coming = pubRung && !pub;
    const astray = !!pub && !!chest && !chestSpots(pub).some((s) => s.cell[0] === chest.gx && s.cell[1] === chest.gz && s.rot === chest.rot);
    if (chest && (coming || astray)) {
      liftedChest = { plot: chest, index: Object.keys(layout.plots).indexOf(PIRATE_ID) };
      delete layout.plots[PIRATE_ID];
    }
  }
  for (const p of Object.values(layout.plots)) {
    grid.fillBlock(p.gx, p.gz, p.w, p.d, PLOT);
  }
  // The resort's planks and the water it grows into (`markResort`).
  markResort(grid, layout);
  // A road recorded across ground a dig has since made water - the quay's front paths and its
  // approach, which the harbour's dig took on purpose (planKade) - is a boardwalk: it stays road,
  // and the quay's deck below takes it in. BLOCKED, so the first line would not pave it.
  const dug = dugKeys(layout);
  for (const p of layout.paths) {
    for (const [gx, gz] of p.cells) {
      const v = grid.get(gx, gz);
      if (v === FREE || (v === BLOCKED && dug.has(`${gx},${gz}`) && !grid.t.isLand(gx, gz))) grid.set(gx, gz, PATH);
    }
    // A strandpad's sand (`civicRoad`), which is BLOCKED and so not paved by the line above.
    for (const [gx, gz] of p.strand || []) if (grid.get(gx, gz) === BLOCKED && grid.t.isLand(gx, gz)) grid.set(gx, gz, PATH);
  }
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
  // Which RESERVED cells are the town's own, held for its plan (`townHeld`) - `townLotOpen`
  // may build on these and on no other RESERVED cell. The street lots join it below, once the land
  // register can say which of them lie on the town's ground.
  const townHeld = new Set();
  for (const [gx, gz] of layout.town.lots) {
    if (!grid.freeBlock(gx, gz, 3, 3, false)) continue;
    grid.fillBlock(gx, gz, 3, 3, RESERVED);
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) townHeld.add(`${gx + x},${gz + z}`);
  }

  // The one square in the village grows with it: a green three across while this is a
  // hamlet, a proper market square by the time there is a crowd to hold. It takes only
  // ground nobody is using and grows around its own centre, so it widens around the
  // buildings already standing on it rather than pushing them aside. The result is an
  // irregular plaza hugging its own frontage, which is what real ones look like.
  for (const step of SQUARE_STEPS) {
    if (mostEver >= step.at) layout.town.size = Math.max(layout.town.size || 3, step.size);
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
    // Its own lot of the ring first (the middle of the north side, facing the square), then
    // any lot of the ring, then a street: the hall is the one building the square is not a
    // square without. No land register yet - the ring is the core, which is the town's.
    const own = townSite(grid, layout, townHeld, 'townhall');
    const onRing = own && CIVIC_LOTS.some(([dx, dz]) => own.at[0] === townCentre[0] + dx && own.at[1] === townCentre[1] + dz);
    let hall = onRing ? own.at : takeCivicLot(grid, layout);
    let look = townCentre;
    if (!hall && own) { hall = own.at; look = own.look; }
    if (!hall) hall = findBlockAround(grid, townCentre, { skipRing0: true });
    if (hall) {
      const rot = facing([hall[0] + 1, hall[1] + 1], look);
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

  // ---- the street lots, held -----------------------------------------------------
  // What the town's plan still has to build is kept free the way the lots round the square
  // always were, from the first scan of a new island: every street lot whose ground is the
  // town's (the core, and the commons as it grows) and on which nothing stands yet. Without
  // it a house its own hamlet has no room for falls back onto the commons, lands on a future
  // shop, and a house never moves again. A lot on nobody's ground is not held - holding it
  // would be claiming land the town has not grown into - and is taken when a shop needs it.
  //
  // The streets themselves are not held. A RESERVED cell is a wall to the router, and four
  // walls leaving the square would cut the hamlets off from it until the first shop opened;
  // left free, a road may run where the street will be, and the street is paved over it.
  //
  // The gold pit's lot too, while it has no pit: the pit is placed after every milestone, and a
  // shop that found no street lot and fell back to the nearest free block took it first on the
  // live island, which sent the pit out of town as well.
  {
    const c = layout.town.centre;
    const lots = layout.plots[GOLDPIT_ID] ? STREET_LOTS : [...STREET_LOTS, GOLDPIT_LOT];
    for (const lot of lots) {
      const gx = c[0] + lot.at[0], gz = c[1] + lot.at[1];
      if (!grid.freeBlock(gx, gz, 3, 3, false)) continue;
      let ours = true;
      for (let z = 0; z < 3 && ours; z++) {
        for (let x = 0; x < 3 && ours; x++) {
          const [i, j] = superOf(lat, gx + x, gz + z);
          ours = sup.at(i, j) === TOWN;
        }
      }
      if (!ours) continue;
      grid.fillBlock(gx, gz, 3, 3, RESERVED);
      for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) townHeld.add(`${gx + x},${gz + z}`);
    }
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
    // A quay with a resort owns water, not land: its houses stand on the resort's lots, which
    // were laid out once with the resort, so no parcel is founded or grown for it - no seed, no
    // annex, no leash. Its planks stay what they are, the quay's harbour.
    if (d.kind === 'quay' && layout.resort) {
      if (!rec.pier.length) {
        const found = nearestHarbour(layout, townCentre);
        if (found) { rec.shore = found.shore; rec.pier = found.pier; for (const [gx, gz] of found.pier) grid.set(gx, gz, PIER); }
      }
      // Its middle is where the jetty meets the boardwalk: where its name hangs from the air, and
      // what the page measures its deck from.
      const r = layout.resort;
      rec.centre = [...r.jetty[r.jetty.length - 1]];
      rec.square = null;
      rec.paved = [];
      layout.districts[d.id] = rec;
      continue;
    }
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
    // wants instead is a way in, which is what the road already is; the sign belongs beside
    // that road at the parcel's edge. See `gateOf` in web/js/main.js for the entrance,
    // and hamlet-sign-placement.js for free ground clear of its paving and plots.
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
  // A castle from before CASTLE_LOT first, so it has the ground it grows into before any
  // milestone below can be handed it.
  growCastle(grid, sup, terrain, lat, layout);
  // What the rungs at the water ask of the island - its harbours, their berths, the galleon -
  // worked out once, the first time one of them is placed on this pass, and again only if the
  // harbours it was worked out from are planned in the meantime (see `waterfront`).
  let shore = null;
  const coastline = () => {
    if (!shore || shore.harbours !== layout.harbours) shore = waterfront(layout, terrain, model);
    return shore;
  };
  // The rungs that stand at a harbour wait for the harbours on the one scan that has none
  // yet - an island's first, when it is founded with a village already on it - because the
  // harbours are planned further down, after the hamlet roads, and not a line earlier (see
  // there). They are placed straight after, on the same pass, which is what keeps the scan
  // after it a no-op.
  const deferred = [];
  const placeMilestone = (m) => {
    const id = civicIdOf(m);
    if (layout.plots[id]) return;
    // The bridge is not placed here, and it is the only rung that is not. It is a road,
    // and the roads are not routed until further down this function - so it is laid there,
    // by `planBridge`, which gives it the plot this loop would otherwise have to invent a
    // site for. See BRIDGE_AT.
    if (m.civicType === 'bridge') return;
    const quay = layout.districts.quay;
    const quayPlanks = !!(quay && quay.shore && (quay.pier || []).length);
    if (layout.harbours == null && (AT_THE_WATER.has(m.civicType) || (m.civicType === 'crane' && !quayPlanks))) {
      deferred.push(m);
      return;
    }
    let block = null;
    // Which way the building looks. Everything civic faces the town, which is what the
    // fall-through below says; the crane has to look the other way, and a lot of the town's
    // plan faces the street or the square it was laid out on.
    let look = null;
    let planned = false;
    // The rot a site worked out for itself, for the lots that face the water rather than a
    // cell: a ship lies along the coast, the yard runs down into the sea, a warehouse turns
    // its front to the quay.
    let turned = null;
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
      // An island with no quay district - no Cowork task ever ran on it, which is most of
      // them, the live island included - stands its crane at the kadehaven instead, beside
      // that harbour's slipway (`road:harbour:<n>`) on exactly the same terms: the ramp is
      // the harbour's shore cell and the slip is road, so neither is free, and the planks are
      // PIER. It used to wait for a quay that never came (Plans/DONE/mijlpalen-tot-tweehonderd.md,
      // measured on the live island). An island with neither waits, as it always did.
      // With a stone quay (planKade) the crane stands on the quay's seaward end, on the wall,
      // its jib out over the harbour: the one cell of the quay `road:kade` leaves it.
      const kadeCell = kadeCraneCell(layout);
      const back = kadeCell && layout.works.kade.back;
      const kade = quayPlanks ? null : kadehaven(layout, terrain);
      const q = quayPlanks ? quay : kade;
      const pier = (q && q.pier) || [];
      if (kadeCell && grid.freeCell(kadeCell[0], kadeCell[1], true)) {
        block = kadeCell;
        look = [kadeCell[0] - back[0], kadeCell[1] - back[1]];
      } else if (q && q.shore && pier.length) {
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
    } else if (m.civicType === 'castle') {
      // Not a lot round the square: those are three by three and sit off the lattice on
      // purpose, and the castle is seven. See `castleSite`.
      // Out beyond the town's plan (TOWN_REACH), overlooking it rather than wedged into the gap
      // between two streets on the gold pit's lot - and only when there is no such ground,
      // anywhere at all, as it used to be.
      block = castleSite(grid, sup, terrain, lat, townCentre, null, TOWN_REACH)
        || castleSite(grid, sup, terrain, lat, townCentre);
    } else if (m.civicType === 'shipyard') {
      const site = yardSite(grid, terrain, sup, lat, layout, coastline());
      if (site) { block = site.at; turned = site.rot; }
    } else if (m.civicType === 'ship') {
      const site = shipSite(id, grid, terrain, layout, coastline());
      if (site) { block = site.at; turned = site.rot; }
    } else if (m.civicType === 'fishery') {
      const site = fisherySite(grid, terrain, sup, lat, layout, coastline());
      if (site) { block = site.at; turned = site.rot; }
    } else if (QUAYSIDE.has(m.civicType)) {
      const site = harbourSite(grid, terrain, sup, lat, layout, coastline());
      if (site) { block = site.at; turned = site.rot; }
    } else if (m.civicType === 'piratetavern') {
      const site = pirateTavernSite(grid, terrain, sup, lat, layout, coastline());
      if (site) { block = site.at; turned = site.rot; }
    } else if (m.civicType === 'quarry') {
      block = quarrySite(grid, terrain, sup, lat, layout)
        || tradeSite(grid, sup, lat, townCentre)
        || findBlockAround(grid, townCentre, { skipRing0: true, avoid: planCells(townCentre) });
    } else if (TRADES.has(m.civicType)) {
      // The three trades from before the ladder went past a hundred fall back the way they
      // always have; the ones after it may not come down half on a lot of the town's plan.
      const avoid = OLD_TRADES.has(m.civicType) ? null : planCells(townCentre);
      block = tradeSite(grid, sup, lat, townCentre) || findBlockAround(grid, townCentre, { skipRing0: true, avoid });
    } else {
      // The town's plan. A building on one of its lots gets its road after the streets are
      // paved, below: laid now, it would find the street still grass and wander off round
      // the block to the square instead of stepping out onto the stone at its door.
      const site = townSite(grid, layout, townHeld, m.civicType, { sup, lat });
      if (site) { block = site.at; look = site.look; planned = true; }
      else block = findBlockAround(grid, townCentre, { skipRing0: true });
    }
    if (!block) { unplaced.push(id); return; }
    const lot = lotOf(m.civicType);
    const n = lot.w;
    const rot = turned !== null ? turned
      : n === 3 && !planned ? openRot(grid, block, n, townCentre)
        : facing([block[0] + (n >> 1), block[1] + (n >> 1)], look || townCentre);
    // `w` along x and `d` along z as the lot lies: the same number twice on every square lot,
    // and the ship's and the yard's two sides the right way round for their rot.
    const { w, d } = stamped(lot, rot);
    if (w > 1 || d > 1) grid.fillBlock(block[0], block[1], w, d, PLOT);
    else if (!ON_SQUARE[m.civicType]) grid.set(block[0], block[1], PLOT);
    layout.plots[id] = { gx: block[0], gz: block[1], w, d, rot };
    // The castle, a workshop, a street lot beyond the commons and a building at the water all
    // take ground that may have been nobody's: the town's from now on, or a hamlet would read
    // a super-cell with a building on it as free land. The yard only for its dry end - the
    // super-cells it reaches out to sea over are water nobody can hold - and a ship never.
    if (n === CASTLE_LOT || (n === 3 && (planned || TRADES.has(m.civicType) || CLAIMS_LAND.has(m.civicType)))) claimForTown(sup, lat, layout, block, n);
    else if (id === YARD_ID) claimCellsForTown(sup, lat, layout, yardRows(layout.plots[id], 0, YARD_DRY));
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) squareTaken.add(`${block[0] + x},${block[1] + z}`);
    // A ship has no door and so no road; the yard's opens at its landward end (`plotDoor`).
    const door = plotDoor(id, layout.plots[id]);
    if (door && !planned) layCivicRoad(grid, layout, `path:${id}`, civicRoad(grid, layout, layout.plots[id], door));
  };
  for (const m of model.milestones) if (m.unlocked) placeMilestone(m);

  // ---- the gold pit --------------------------------------------------------------
  // The keeper's five-hour usage window as a pile of bars, which every settler who sets to
  // work walks over to first (Plans/DONE/goudkuil.md). A three by three like any civic building
  // with a door - it wants a road to its mouth, a pavement in front of it and a spot a
  // settler can walk to, and all three come with the size - and open towards the town.
  //
  // Not a milestone: the limit is there from the first session, so the pit is too. And not
  // `takeCivicLot`, deliberately. The eight lots round the square are exactly enough for the
  // town hall and the seven three by three milestones, and a pit that took one would send
  // the school half a mile out of town years from now. `findBlockAround` takes the nearest
  // free block on the town's lattice instead, which on a young island is the ring just
  // outside the lots and on a crowded one is as near as there is room.
  //
  // Here, after the milestones and before the civic roads are relaid, so that a milestone
  // unlocking on the same scan still gets first pick, and so that the frontage block below
  // paves in front of the pit when it stands close enough to the square. Sticky like every
  // civic plot: written once, and scan.mjs never deletes a `civic:` plot.
  //
  // Its own lot of the town's plan first (GOLDPIT_LOT, behind the library with its mouth on
  // the alley), and only when that is taken the nearest free block.
  if (!layout.plots[GOLDPIT_ID]) {
    const own = [townCentre[0] + GOLDPIT_LOT.at[0], townCentre[1] + GOLDPIT_LOT.at[1]];
    const mine = townLotOpen(grid, townHeld, own[0], own[1], { sup, lat });
    const block = mine ? own : findBlockAround(grid, townCentre, { skipRing0: true });
    if (block) {
      const rot = mine ? facing([block[0] + 1, block[1] + 1], [townCentre[0] + GOLDPIT_LOT.look[0], townCentre[1] + GOLDPIT_LOT.look[1]])
        : openRot(grid, block, 3, townCentre);
      grid.fillBlock(block[0], block[1], 3, 3, PLOT);
      layout.plots[GOLDPIT_ID] = { gx: block[0], gz: block[1], w: 3, d: 3, rot };
      markPath(grid, layout, `path:${GOLDPIT_ID}`, routePath(grid, nearestWalkable(grid, outsideDoor(block[0], block[1], rot))));
    } else unplaced.push(GOLDPIT_ID);
  }

  // ---- the goldsmith and the gold mine ---------------------------------------------
  // Where the pit's gold comes from (Plans/DONE/goudmijn.md): the mine holds the keeper's week,
  // and when the five-hour window turns over, the page has a cartload wheeled from the mine
  // to the goldsmith and his bars from there to the pit. Both are there from the first scan
  // for the pit's own reason - the limits come with the first session - and both are placed
  // after it, so the pit's own lot is decided exactly as it always was. Three by three, with
  // a door, a road and the town's claim on the ground under them, like the workshops: the
  // road is what the carts run on.
  //
  // The goldsmith as near the pit as there is a free block, so the last leg is short and in
  // town; the mine on high ground outside it (`mineSites`). Sticky like every civic plot.
  // A lot is taken only when its road reaches the square on this same scan: the router does
  // not bridge a civic road, so a hill across the river from the town had no road on the
  // scan that placed it (seed 7 on 128), got one the scan after - over a hamlet road's
  // bridge laid meanwhile - and the second scan was no longer a no-op. Candidates come best
  // first; each is tried stood on the grid, so the road cannot run through its own lot, and
  // given back if it does not reach. MINE_TRIES bounds a search that is a full route each.
  const standAt = (id, given, look, { waitInland = false } = {}) => {
    const { inland, coastal } = byCoast(grid, given);
    // The mine waits for ground off the coast while the island can still grow: on the founding
    // island (32 on a 64 grid) every free block is on the sand's edge once the town's plan is
    // held, and the first mine there stood on the beach beside a harbour's pier. The next ring
    // of ground brings an inland lot, and the pit meanwhile fills at once, as it does with no
    // mine at all (goldrun.js). Not in `unplaced`: nothing is short of room, and a house left
    // over is what makes the island grow - a mine waiting must not.
    if (waitInland && !inland.length && canGrowFurther(layout, cap)) return false;
    const reach = reachCount(grid, townCentre);
    const seen = new Set();
    // MINE_TRIES for each of the two lists, not for both together: the inland lots first, but
    // not at the price of the coast. On seed 7 (128) twelve inland lots across the river used
    // every try with no road, the coast was never asked, and the mine turned up a scan later.
    for (const candidates of [inland, coastal]) {
      let tries = 0;
      for (const block of candidates) {
        const k = `${block[0]},${block[1]}`;
        if (seen.has(k) || !grid.freeBlock(block[0], block[1], 3, 3, false)) continue;
        seen.add(k);
        if (tries++ >= MINE_TRIES) break;
        grid.fillBlock(block[0], block[1], 3, 3, PLOT);
        // Nor may it cut a pocket of land off: harbours are planned after these two, and a
        // lot on the last dry block before a small island's sand sealed the strip a slipway
        // had to come up through - the approach found no way round, and the scan after pruned
        // the slipway and laid it again (the founding island, 32 on a 64 grid).
        if (reach - reachCount(grid, townCentre) > 9) { grid.fillBlock(block[0], block[1], 3, 3, FREE); continue; }
        // openRot's pick first, then the other three in its order: a door facing the sea on a
        // small island's rim has open ground in front of it and no way off it.
        const first = openRot(grid, block, 3, look);
        for (const turn of [0, 1, 3, 2]) {
          const rot = (first + turn) % 4;
          const road = routePath(grid, nearestWalkable(grid, outsideDoor(block[0], block[1], rot)));
          if (!road) continue;
          layout.plots[id] = { gx: block[0], gz: block[1], w: 3, d: 3, rot };
          claimForTown(sup, lat, layout, block, 3);
          markPath(grid, layout, `path:${id}`, road);
          return true;
        }
        grid.fillBlock(block[0], block[1], 3, 3, FREE);
      }
    }
    unplaced.push(id);
    return false;
  };
  // When neither site rule finds anything - a small island, where the town's plan and the
  // rim leave few blocks - the nearest free blocks of the lattice off the plan, and past
  // those any free three by three off the plan, nearest the square first. Off the lattice
  // only as the last resort: across a lane it can cut the walk of a hamlet not yet founded,
  // but the founding island (32 on a 64 grid) has no lattice block left once the town's
  // plan is held, and the mine would otherwise wait for the island to grow.
  const fallback = () => {
    const avoid = planCells(townCentre);
    const ok = (gx, gz) => {
      if (!grid.freeBlock(gx, gz, 3, 3, false)) return false;
      for (let z = 0; z < 3; z++) {
        for (let x = 0; x < 3; x++) {
          if (avoid.has(`${gx + x},${gz + z}`)) return false;
          const who = sup.at(...superOf(lat, gx + x, gz + z));
          if (who !== NONE && who !== TOWN) return false;
        }
      }
      return true;
    };
    const out = [];
    for (let r = 1; r <= MAX_RING && out.length < MINE_TRIES; r++) {
      for (const [dx, dz] of RINGS[r]) {
        const [gx, gz] = blockAt(townCentre, dx, dz);
        if (ok(gx, gz)) out.push([gx, gz]);
      }
    }
    for (let r = 2; r <= LOOSE_REACH && out.length < MINE_TRIES; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const gx = townCentre[0] + dx - 1, gz = townCentre[1] + dz - 1;
          if (ok(gx, gz)) out.push([gx, gz]);
        }
      }
    }
    return out;
  };
  if (!layout.plots[GOLDSMITH_ID]) {
    const pit = layout.plots[GOLDPIT_ID];
    const near = pit ? [pit.gx + 1, pit.gz + 1] : townCentre;
    standAt(GOLDSMITH_ID, [...goldsmithSites(grid, sup, lat, townCentre, near), ...fallback()], near);
  }
  if (!layout.plots[GOLDMINE_ID]) {
    const trade = tradeSite(grid, sup, lat, townCentre);
    const extra = trade ? [trade] : [];
    standAt(GOLDMINE_ID, [...mineSites(grid, terrain, sup, lat, townCentre), ...extra, ...fallback()], townCentre, { waitInland: true });
  }

  // ---- the streets ---------------------------------------------------------------
  // Each of the four STREETS is paved from the square out to the far edge of the last civic
  // building standing on it - a corner of the ring counts as far as its own lot - and no
  // further, so a street grows with its shops rather than running out empty into the country.
  // Two cells wide, over grass and over any road that happened to run there; round a house or
  // anything else standing in the way, which is the one thing a street may not take.
  //
  // Paved as plaza (SQUARE), and into `town.paved`, so every reader of the paving - the ground,
  // the router, the crowd, a neighbour's copy of the bundle - has it without being told. The
  // same cells go into `town.streets` too, for the one reader that must leave them out: the
  // Friday gathering (shared/roads.mjs `gatherCells`), which belongs on the square and would
  // otherwise send half the village to stand in the high street.
  //
  // Before the civic roads below, so a shop's road is the step from its door onto the stone.
  {
    const c = townCentre;
    const civic = new Set(Object.entries(layout.plots)
      .filter(([id, p]) => id.startsWith('civic:') && p.w === 3).map(([, p]) => `${p.gx},${p.gz}`));
    const standing = (at) => civic.has(`${c[0] + at[0]},${c[1] + at[1]}`);
    const far = STREETS.map(() => 0);
    for (const [corner, n] of Object.entries(RING_STREET)) if (standing(RING[corner].at)) far[n] = Math.max(far[n], RING_FAR);
    for (const lot of STREET_LOTS) if (standing(lot.at)) far[lot.street] = Math.max(far[lot.street], lot.far);
    const laid = new Set((layout.town.paved || []).map(ckey));
    const streets = [];
    STREETS.forEach((street, n) => {
      if (!far[n]) return;
      for (const cell of streetCells(c, street, far[n])) {
        const k = ckey(cell);
        if (laid.has(k)) continue;
        const v = grid.get(cell[0], cell[1]);
        if (v !== FREE && v !== PATH) continue;
        grid.set(cell[0], cell[1], SQUARE);
        laid.add(k);
        streets.push(cell);
      }
    });
    layout.town.paved = [...(layout.town.paved || []), ...streets];
    layout.town.streets = streets;
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
  // `plotDoor` rather than a square's front: a ship has no road to lay, and the yard's comes
  // in at its landward end.
  for (const [id, p] of Object.entries(layout.plots).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!id.startsWith('civic:')) continue;
    const door = plotDoor(id, p);
    if (!door) continue;
    if (layout.paths.some((q) => q.id === `path:${id}`)) continue;
    layCivicRoad(grid, layout, `path:${id}`, civicRoad(grid, layout, p, door));
  }

  // ---- frontage ----------------------------------------------------------------
  // A pavement one cell deep in front of every civic building, so the square reaches
  // the doorsteps instead of leaving a strip of grass between the stone and the walls.
  // This is what stops the centre reading as buildings scattered near a patio, and it
  // is how the centre keeps growing once the square itself has stopped.
  {
    const centre = layout.town.centre;
    const reach = FRONTAGE_REACH;
    const footings = footingCells(layout);
    // What the plaza already covers. The square above no longer marks a footing cell as
    // SQUARE, so without this a lamp on the plaza's own rim would be recorded twice.
    const laid = new Set((layout.town.paved || []).map((c) => `${c[0]},${c[1]}`));
    const frontage = [];
    for (const [id, p] of Object.entries(layout.plots)) {
      // Nothing paves the water round a ship or the sand round a slipway: neither ever stands
      // this near the square, and neither is a building with a doorstep on to the plaza.
      if (!id.startsWith('civic:') || p.w < 3 || afloat(id)) continue;
      if (Math.abs(p.gx + (p.w >> 1) - centre[0]) > reach || Math.abs(p.gz + (p.d >> 1) - centre[1]) > reach) continue;
      for (let gz = p.gz - 1; gz <= p.gz + p.d; gz++) {
        for (let gx = p.gx - 1; gx <= p.gx + p.w; gx++) {
          const edge = gx === p.gx - 1 || gx === p.gx + p.w || gz === p.gz - 1 || gz === p.gz + p.d;
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

  // ---- the pirate's sea chest ----------------------------------------------------
  // Once the Salty Kraken stands (PUB_ID, Plans/piratenkroeg.md), behind it on its landward side:
  // the first of `chestSpots(pub)` whose cell is bare dry ground or pavement, nothing standing on
  // it, no doorstep and no road's cell, and whose keeper's cell in front of it (where the pirate
  // stands, lib/crowd.mjs) is ground a body can stand on - never a pier, never water. Facing
  // away from the wall, so his flag is towards whoever comes round the corner.
  //
  // Before there is a pub, and wherever the pub has no such spot, on the village tavern's
  // pavement beside the doorstep and never on it - the postbox's bargain, and for the same
  // reason: the step is where the front path starts, and a chest planted there would wall the
  // tavern in. The cell along the front of the door that the keeper's `aside` points to first,
  // then the other; facing the way the tavern faces. Read off the tavern's own `rot`, never off an
  // island: the sea's starter islands stand the tavern at rot 2 (lib/islandbundle.mjs), and have
  // no pub.
  //
  // Placed twice: here, and again after the rungs at the water that an island's first scan puts
  // off (`deferred`), which is where a pub founded with the island first stands - so that the
  // scan after that one is a no-op too. Sticky like every civic plot once placed; the only move
  // it ever makes is the one lifted at the top of this function, to the pub.
  const placeChest = (last) => {
    if (layout.plots[PIRATE_ID]) return;
    const pub = layout.plots[PUB_ID];
    if (!pub && pubRung && !last) return;          // the pub may yet stand this scan
    const taken = occupiedCells(layout);
    const key = (c) => `${c[0]},${c[1]}`;
    if (pub) {
      const steps = new Set();
      for (const [pid, p] of Object.entries(layout.plots)) { const dr = plotDoor(pid, p); if (dr) steps.add(key(dr.step)); }
      const roads = new Set();
      for (const q of layout.paths) { for (const c of q.cells || []) roads.add(key(c)); for (const c of q.strand || []) roads.add(key(c)); }
      for (const r of layout.roads || []) for (const c of r.cells || []) roads.add(key(c));
      const bare = (c) => !taken.has(key(c)) && !steps.has(key(c)) && grid.t.isLand(c[0], c[1]) && !grid.t.isWater(c[0], c[1]);
      const chestOk = (c) => bare(c) && !roads.has(key(c)) && (grid.get(c[0], c[1]) === SQUARE || grid.freeCell(c[0], c[1], true));
      const keeperOk = (c) => bare(c) && grid.get(c[0], c[1]) !== PIER
        && ([PATH, SQUARE].includes(grid.get(c[0], c[1])) || grid.freeCell(c[0], c[1], true));
      const spot = chestSpots(pub).find((s) => chestOk(s.cell) && keeperOk(s.keeper));
      if (spot) {
        layout.plots[PIRATE_ID] = { gx: spot.cell[0], gz: spot.cell[1], w: 1, d: 1, rot: spot.rot };
        grid.set(spot.cell[0], spot.cell[1], PLOT);
        return;
      }
      if (!last) return;
    }
    if (liftedChest) {
      // Nowhere behind the pub: back where it stood, in the same place among the plots, so the
      // file is byte for byte what it was.
      const c = liftedChest.plot;
      if (taken.has(`${c.gx},${c.gz}`)) { unplaced.push(PIRATE_ID); return; }
      putBackAt(layout.plots, PIRATE_ID, c, liftedChest.index);
      grid.set(c.gx, c.gz, PLOT);
      return;
    }
    const tavern = layout.plots['civic:tavern'];
    if (!tavern) return;
    const step = outsideDoor(tavern.gx, tavern.gz, tavern.rot);
    const [ax, az] = ALONG_FRONT[tavern.rot];
    const free = ([gx, gz]) => grid.get(gx, gz) === SQUARE && !taken.has(`${gx},${gz}`);
    const beside = [[step[0] + ax, step[1] + az], [step[0] - ax, step[1] - az]].find(free) || null;
    if (beside) layout.plots[PIRATE_ID] = { gx: beside[0], gz: beside[1], w: 1, d: 1, rot: tavern.rot };
    else unplaced.push(PIRATE_ID);
  };
  placeChest(false);

  // ---- the treasure statue -------------------------------------------------------
  // Set down in the town centre by the keeper's page (POST /api/treasure `placed`, lib/treasure.mjs)
  // and never taken away: `model.treasure.placed` says so, and this is the scan that gives it a
  // cell. Written once, on the first scan that sees it, and sticky from then on like every civic
  // plot - which is what "a house never moves" needs from it: the statue arrives on a cell nothing
  // stands on and every plot already written keeps its cell. Where it stands is worked out from
  // the layout as it is, deterministically (TREASURE_SPOTS, in order), and a later scan finds
  // the plot there and does nothing, so the scan after is byte for byte the one before.
  //
  // Only ever a cell of the plaza's own paving (`layout.town.paved`): outside it a hamlet's
  // house could still take the grass, because a one-cell plot is not stamped on the grid (see
  // ON_SQUARE). Never a doorstep of any civic building.
  if (model.treasure && model.treasure.placed === true && !layout.plots[TREASURE_ID]) {
    const c = layout.town.centre;
    const taken = occupiedCells(layout);
    const paved = new Set((layout.town.paved || []).map((cell) => `${cell[0]},${cell[1]}`));
    const steps = new Set();
    for (const [id, p] of Object.entries(layout.plots)) {
      const door = id.startsWith('civic:') ? plotDoor(id, p) : null;
      if (door) steps.add(`${door.step[0]},${door.step[1]}`);
    }
    let at = null;
    for (const [ox, oz] of TREASURE_SPOTS) {
      const k = `${c[0] + ox},${c[1] + oz}`;
      if (paved.has(k) && !taken.has(k) && !steps.has(k)) { at = [c[0] + ox, c[1] + oz]; break; }
    }
    if (at) layout.plots[TREASURE_ID] = { gx: at[0], gz: at[1], w: 1, d: 1, rot: facing(at, c) };
    else unplaced.push(TREASURE_ID);
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
    // A new house of a quay with a resort goes to the resort's next free lot, at the boardwalk.
    // With every lot taken it lodges on the commons, like any house its land has no room for -
    // and it does not wait for a ring: a ring gives the resort no lots.
    if (h.district === 'quay' && layout.resort && rec) {
      const n = freeResortLot(layout);
      if (n >= 0) {
        const p = resortPlot(layout, n);
        grid.fillBlock(p.gx, p.gz, p.w, p.d, PLOT);
        layout.plots[h.id] = p;
        continue;
      }
      rec.guest = true;
      growParcel(sup, commonsLobe, TOWN, commonsLobe.cells.length + 4, false, grid);
      layout.town.commons = commonsLobe.cells;
      const slot = freeCellIn({ lobes: [commonsLobe] }, 'town');
      if (!slot) { unplaced.push(h.id); continue; }
      const [gx, gz] = blockOf(lat, slot.cell[0], slot.cell[1]);
      const rot = facing([gx + 1, gz + 1], townCentre);
      grid.fillBlock(gx, gz, 3, 3, PLOT);
      layout.plots[h.id] = { gx, gz, w: 3, d: 3, rot, cell: slot.cell, district: h.district, lobe: -1, commons: true };
      cellTaken.add(`town|${slot.cell[0]},${slot.cell[1]}`);
      moved.push(h.id);
      continue;
    }
    const allowBeach = h.harbour === true;
    let slot = rec ? freeCellIn(rec, h.district) : null;
    let owner = h.district, lobeIdx = slot ? slot.li : -1;

    // No room on our own land: grow it, and only then fall back to the commons. The
    // commons is a real place - a market town with houses around the square - not a bin.
    // Room for one house more than the land holds, not one more than the population: a
    // hamlet whose cells outnumber its people but whose last free cell a shed, a road or a
    // neighbour's house took (one that changed project, say) asked for no land at all, and
    // its next house went to the square with open countryside beside the hamlet.
    //
    // And when that gives land but no plot, one super-cell more that a house can stand on
    // (`roomy`), on the nearest rung of `growLobe` that has one. A super-cell with a road
    // through it is land a garden may have and a house may not, and the nearest cells to a
    // hamlet are the ones its own road and its neighbours' run through. It has to be a
    // filter, not a preference: every rung counts cells, so the first one was satisfied by a
    // roaded cell and the wider rungs, where the open ground was, never ran. Measured,
    // founded small and grown to 240 settlers: on seed 11 a hamlet asked four times, got four
    // cells with a path across every one and sent its house to the commons with roadless
    // ground on its other side; on seed 42, 240 on 128, a third of the houses on the commons
    // had a free super-cell right beside their own hamlet.
    if (!slot && rec) {
      const cells = (rec.lobes || []).reduce((a, l) => a + l.cells.length - (l.green ? 1 : 0), 0);
      ensureParcel(sup, rec, Math.max((popOf.get(h.district) || 1) + 1, cells + 1), {
        k: ordOf.get(h.district), allowBeach, near: null, grid, lat, id: h.district,
      });
      slot = freeCellIn(rec, h.district);
      const lobes = rec.lobes || [];
      for (const lobe of [...lobes].reverse()) {
        if (slot) break;
        const n = lobe.cells.length + 1;
        if (growLobe(sup, lobe, ordOf.get(h.district), n, n, allowBeach, grid, { roomy: true })) slot = freeCellIn(rec, h.district);
      }
      // Short of land a house can use, whatever the count says - which is what lets it wait
      // for a ring by the sea below (`landWouldHelp`). The scan's last word on `guest` is the
      // district loop's, settled after placing, so this decides only this scan's waiting.
      // Measured, seed 7 founded small: three hamlets sent a house to the commons in the very
      // scan whose ring raised free ground beside them, because `ensureParcel` had handed
      // each a roaded cell and so none counted as short.
      if (!slot && lobes.length) rec.guest = true;
      lobeIdx = slot ? slot.li : -1;
    }
    // On an island that can still grow, a house with no room on its own land waits for
    // the next ring rather than taking the commons. Measured before this: an island founded
    // small put 38 of its first 41 houses round the square, because growing only happened
    // once the commons was full too - and a house on the commons never moves again, so the
    // island grew into a market town with its hamlets round the outside of it.
    //
    // Once, though. A hamlet boxed in by its neighbours has no more room after a ring than
    // before it, and a house that waited and still has none was asking the island to grow
    // for nothing: measured, one such house took an island from a coast of 59 to its grid's
    // 120 in a single scan. So it waits one ring, and after that the commons it is.
    //
    // And only when a ring could give it land at all (`landWouldHelp`). "Once" is per scan,
    // so a hamlet that no ring can help asked again on every scan it gained a house, and
    // each time the island paid a whole ring for one house that then went to the commons
    // anyway. Measured on seed 1337, ten settlers a scan to 340: the last three rings (77 to
    // 101 to 132 to 172, a grid of 384) were each for a single such house, and without them
    // the island stops at 101 on 224 like the seven other seeds measured. Only for an island
    // that already grows: one founded on its whole grid places exactly as it always has.
    //
    // A district that stands nowhere yet is the exception to "once": it is not boxed in, it
    // is short of countryside. On an island founded small the first rings lie almost wholly
    // inside the town core, where a farmstead may not be founded, so the very first settler
    // of a fresh install waited one ring, still found no seed, and moved onto the commons for
    // good (measured on five seeds; tests/layout-measure.test.mjs caught it in a checkout with
    // no data/). It keeps waiting while the island can grow - every ring is more countryside.
    const unfounded = !!layout.grow && !(rec && (rec.lobes || []).length);
    if (!slot && rec && canGrow && (!waited.has(h.id) || unfounded) && (!layout.grow || landWouldHelp(rec, terrain, lat))) { unplaced.push(h.id); waiting.push(h.id); continue; }
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
    let end = p.road[p.road.length - 1];
    let cells = routePath(grid, end, { isGoal: (cell, v) => v === SQUARE, budget: 250000, bridge: true });
    // A causeway that is a stub - `causeway` hands back one cell when no walk over land
    // reaches ground a road can use - can end boxed in: its own dike on one side and beach
    // on the others, and the router may cross neither. Measured on the live island: polder
    // 2's causeway was one cell with dike above and to the right and three cells of beach
    // below it before meadow, sealed off from the sea by the dike, so no growth ring ever
    // raised it either; the approach was never laid and the stub was orphaned paving. So the
    // causeway is carried on over the beach, the shortest way to ground a road may use, the
    // way a harbour's slipway crosses its beach: the cells join `p.road` (not in the terrain
    // hash, only in the paving) and are forced back every scan like the rest of it.
    if (!(cells && cells.length > 1)) {
      const over = beachWalk(grid, end);
      if (over) {
        p.road.push(...over);
        for (const c of over) grid.set(c[0], c[1], FREE);
        markPath(grid, layout, `road:polder:${n}`, over);
        end = p.road[p.road.length - 1];
        cells = routePath(grid, end, { isGoal: (cell, v) => v === SQUARE, budget: 250000, bridge: true });
      }
    }
    if (cells && cells.length > 1) markRoad(grid, layout, id, cells);
  }

  // ---- the ways in the keeper set -------------------------------------------------
  // `layout.gates[district][side] = { at }` (the `gate` op in lib/plan.mjs, Plans/DONE/ingangen-verplaatsen.md)
  // is where the keeper wants the way into a hamlet on that side. The sign and the gap in the
  // fence follow the page's own reading of it (shared/entrances.mjs); what the server owes is the
  // road: from the gate cell to the square, laid once under a name of its own and as sticky as a
  // polder's approach, braided onto the roads there are (`markPath` records only what it paves
  // itself, so a gate on a lane that already leads to town costs the island nothing). The `gate`
  // op takes it off the list when the gate moves or shuts, and it is laid again from the new place.
  for (const id of Object.keys(layout.gates || {}).sort()) {
    for (const side of ['n', 'e', 's', 'w']) {
      const g = layout.gates[id] && layout.gates[id][side];
      if (!g || g.closed || !Array.isArray(g.at)) continue;
      const pid = `road:gate:${id}:${side}`;
      if (layout.paths.some((q) => q.id === pid)) continue;
      const cells = routePath(grid, g.at, { isGoal: (cell, v) => v === SQUARE, budget: 250000, bridge: true });
      if (cells && cells.length > 1) markRoad(grid, layout, pid, cells);
    }
  }

  // ---- the crossing --------------------------------------------------------------
  // Here and not in the milestone loop: a bridge is a road, and until the line above has
  // run there is no road on the island for one to join. The trigger is the settler count
  // and nothing else, for the polders' own reason - a scan has to be a pure function of
  // the model, or a rescan of an unchanged island would build somewhere else and rewrite
  // layout.json, which is the one thing that must never happen.
  if (mostEver >= BRIDGE_AT) planBridge(grid, layout, townCentre, unplaced, lat);

  // ---- the harbours ----------------------------------------------------------------
  // Four ways off the island instead of one, each with its own road to the square - see
  // planHarbours and Plans/DONE/vier-havens.md. Planned once, like the fairway, and after the
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

  // The stone quay has to be reached from the square: its road is recorded, and a road nobody
  // can walk to is taken up by `pruneUnreachable` on the next scan and laid again on the one
  // after. On Hoogezand the quay's approach runs over its first cell; where nothing does, a road
  // of its own from the quay's landward end to the square, laid once like a harbour's approach.
  {
    const cells = kadeRoadCells(layout);
    if (cells.length && !layout.paths.some((q) => q.id === `${KADE_ROAD}:approach`)) {
      const open = reachableFromSquare({ paths: layout.paths, bridges: layout.bridges, island: { town: layout.town }, districts: [] }, size);
      if (!cells.some(([gx, gz]) => open.has(gx + gz * size))) {
        const route = routePath(grid, cells[0], { isGoal: (cell, v) => v === SQUARE, budget: 250000, bridge: true });
        if (route && route.length > 1) markRoad(grid, layout, `${KADE_ROAD}:approach`, route);
      }
    }
  }

  // The way to the resort: from the jetty's foot inland over the sand (a strandpad, `strand` on
  // the record, forced back every scan like a slipway) and on to the square. Laid once, under a
  // name of its own; the resort's boardwalk begins at its first cell.
  if (layout.resort && !layout.paths.some((q) => q.id === RESORT_ROAD)) {
    const sand = layout.resort.strand.filter(([gx, gz]) => grid.get(gx, gz) === BLOCKED);
    const last = layout.resort.strand[layout.resort.strand.length - 1];
    const out = layout.resort.out;
    const from = [last[0] - out[0], last[1] - out[1]];
    const v = grid.get(from[0], from[1]);
    const route = v === PATH || v === SQUARE ? [] : routePath(grid, from, { isGoal: (cell, x) => x === SQUARE, budget: 400000 });
    if (route) layCivicRoad(grid, layout, RESORT_ROAD, { cells: [...layout.resort.strand, ...route], strand: sand });
  }

  // ---- the rungs at the water, on an island's first scan ----------------------------
  // What the milestone loop put off because there were no harbours yet (`deferred` there):
  // the yard, the ships, the harbour buildings, the fishery and a crane with no quay. Here,
  // straight after the harbours and their roads, in ladder order, on the ground as it now
  // stands. Every scan after this one finds the harbours on record and places them up there.
  for (const m of deferred) placeMilestone(m);
  // And the pirate's chest, behind a pub that has only now been placed (see "the pirate's sea
  // chest" above).
  placeChest(true);

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
    // The first few cells of the road, not only the first: a hamlet that has filled in round
    // its gate has no free cell beside the head, and a merge (lib/plan.mjs) hands the office
    // exactly such a gate - the one of the piece that grew most. Measured on the live island,
    // Settlers' office found nowhere to stand again at a gate forty-four houses deep.
    let at = null, hx, hz;
    for (const head of road.cells.slice(0, OFFICE_REACH)) {
      for (const [dx, dz] of N4) {
        const c = [head[0] + dx, head[1] + dz];
        if (grid.freeCell(c[0], c[1], false)) { at = c; [hx, hz] = head; break; }
      }
      if (at) break;
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

  // ---- the civic roads, relaid once more ------------------------------------------
  // The pass before the frontage runs before any house has a front path, and on an island
  // that has just lost the roads a civic building leaned on, that is sometimes too early.
  // Measured on a copy of the live island with its village emptied: the scan took up 39 of
  // 40 hamlets and their roads, `pruneUnreachable` then dropped `path:civic:fishery`, which
  // had braided onto one of them, and that pass could not lay it again - from the far west
  // coast to the square across unroaded ground `routePath` finds nothing in its 40000 pops
  // (144 cells at 400000). The front paths laid above then paved much of the way, the *next*
  // scan found it cheap and laid it (178 cells at the default budget, 37 of them new), and a
  // second scan of the same island was not a no-op.
  //
  // So a civic lot still without a road is tried once more here, with the same call and in
  // the same order, now that the front paths are down. A second pass rather than a bigger
  // budget or another goal for the first: either would re-route the road of every civic
  // building on every island where that pass already works, and those must come out as they
  // always have; this only ever adds a road that is missing. The same call as the pass above
  // (`civicRoad`, strandpad and all), so a harbour building roaded here gets the road it would
  // have got there. A lot no road reaches is tried again and records nothing, as it does above.
  //
  // After the frontage, which the first pass is careful not to be, so a door that now opens
  // onto that stone is passed over: a road from it would be two cells of the plaza on record
  // as a road, and would stop the first pass ever trying it properly again. Such a lot stands
  // within FRONTAGE_REACH of the square and could walk nowhere before its frontage was laid,
  // which is not the case this is for. Before the quay deck and the cleared ground, which both
  // read `layout.paths`: laid after them, this road would be in them only from the next scan.
  for (const [id, p] of Object.entries(layout.plots).sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!id.startsWith('civic:')) continue;
    const door = plotDoor(id, p);
    if (!door) continue;
    if (layout.paths.some((q) => q.id === `path:${id}`)) continue;
    const from = nearestWalkable(grid, door.step);
    if (grid.get(from[0], from[1]) === SQUARE) continue;
    layCivicRoad(grid, layout, `path:${id}`, civicRoad(grid, layout, p, door));
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
    if (!rec || (!rec.lobes?.length && !layout.resort)) continue;
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
    // And every boardwalk: a recorded road over water a dig made (the harbour's, planKade) - the
    // quay's approach included, which runs outside the parcel. Without it the settlers would
    // walk that road on the harbour's bed.
    const boards = dugKeys(layout);
    for (const p of layout.paths) {
      for (const c of p.cells || []) {
        const k = `${c[0]},${c[1]}`;
        if (basin.has(k) || (boards.has(k) && terrain.isWater(c[0], c[1]))) put(c);
      }
    }

    // A three-cell plot puts its house in the middle and its outside doorstep two cells
    // away. The broad deck belongs to the building model; these two boards bridge the
    // remaining half-cell and meet the street at the recorded outside doorstep.
    // A house on the resort is joined to the resort's boardwalk, below, not to this one: the walk
    // from the harbour's shore further down would otherwise lay planks across the land to it.
    const resortDeck = new Map();
    for (const h of houses) {
      if (!h.harbour || h.district !== d.id) continue;
      const p = layout.plots[h.id];
      if (!p || p.commons) continue;
      p.quay = true;
      const into = Number.isInteger(p.lot) ? (c) => resortDeck.set(`${c[0]},${c[1]}`, c) : put;
      into(doorCell(p.gx, p.gz, p.rot));
      into(outsideDoor(p.gx, p.gz, p.rot));
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
    // The resort's boardwalk: the jetty and as much of the spines as the houses on it need
    // (`resortCells`), which grows with the district. It meets the land at the jetty's foot,
    // where `road:quay:resort` begins.
    const rc = resortCells(layout);
    if (rc) for (const c of rc.drawn) resortDeck.set(`${c[0]},${c[1]}`, c);
    for (const [k, c] of resortDeck) if (grid.in(c[0], c[1])) deck.set(k, c);
    rec.deck = [...deck.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  // ---- who lodges on the commons -------------------------------------------------
  // `guest` is written twice in a pass under two different questions: the district loop asks
  // `ensureParcel` for room for the population it has, the house loop for room for one more
  // than it has placed - and whichever wrote last decides what went to disk. The next scan's
  // district loop always asks the first question, so a pass that ended on the second (a
  // house that found no plot, lodged on the commons, and left `guest` as "one more does not
  // fit") had its flag flipped back by the scan after it: that scan was not a no-op. It
  // showed on every freshly founded island's second scan (hence the layout tests' habit of
  // settling twice) and, once relief moved the ground, on the scan after a ring in
  // tests/canvas-grow.test.mjs. So it is settled here, once, as the district loop defines it.
  for (const d of districts) {
    const rec = layout.districts[d.id];
    if (!rec || !Array.isArray(rec.lobes)) continue;
    // A quay with a resort has the resort's lots for room, and whatever of its old parcel still
    // has a house on it (the resort ran out of lots before they all moved).
    if (d.kind === 'quay' && layout.resort) {
      const land = rec.lobes.reduce((a, l) => a + l.cells.length - (l.green ? 1 : 0), 0);
      rec.guest = layout.resort.lots.length + land < d.population;
      continue;
    }
    const room = rec.lobes.reduce((a, l) => a + l.cells.length - (l.green ? 1 : 0), 0);
    rec.guest = tierOf(d.population) === 'farmstead' ? !rec.lobes.length : room < d.population;
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

  // The harbour funnel waits for the harbours (`planHaven`), and this pass may just have planned
  // them. Then the island is placed once more, in this same scan, and that pass plans the funnel
  // before anything else and digs its head - so a civic lifted out of the way is set down again
  // here, and the scan after this one is still a no-op. The stone quay waits for the funnel and
  // the quay district (`planKade`, `kadeDue`) and is taken the same way, so a pass that planned
  // the funnel may be followed by one more. Twice at the most: whatever those passes decide.
  const havenDue = layout.fairway && (layout.fairway.line || []).length && layout.harbours != null && !(layout.works && layout.works.haven !== undefined);
  if (havenPass < 2 && (havenDue || kadeDue(layout))) {
    return placeAll(layout, model, { seed, size: layout.size, cap, grown, waited, havenPass: havenPass + 1 });
  }
  // No room left for somebody, on an island that can still grow: one ring of new ground,
  // and everybody placed again on it. See `growStep`. The passes above start counting again on
  // the new ground: a ring can plan the harbours again, and a quay that waited for the island to
  // grow (`planKade`) is then due on this scan - counted on, it was left to the next, which was
  // then not a no-op (measured, seed 7 founded on 96: the quay decided on the scan after).
  if (canGrow && unplaced.some((id) => String(id).startsWith('house:'))) {
    if (growStep(layout, { seed, size, cap })) return placeAll(layout, model, { seed, size: layout.size, cap, grown: grown + 1, waited: new Set([...waited, ...waiting]), havenPass: 0 });
  }
  return { layout, terrain, unplaced };
}

// Where the castle's CASTLE_LOT square goes (Plans/DONE/groot-kasteel.md). `from` is the lot it
// stands on today, to grow it in place; without one it is a new castle.
//
// Either way every cell it gains has to be FREE - not a road, not the square, not one of the
// lots held back for the civic buildings - on ground the town or nobody owns, never a
// hamlet's, and the lot as a whole flat to within CASTLE_RELIEF.
//
//   new      the nearest block of two by two super-cells on the lattice, measured from the
//            town centre to the middle of the lot. On the lattice because a seven then covers
//            two plots and the lane between them and leaves every other lane alone.
//   growing  any seven by seven that holds the old three by three, and three preferences in
//            this order: the front stays where it was, so the square and the road to the gate
//            do; on the lattice; nearest the town centre. Measured on seed 1337 that is up
//            and to the east of the old lot: west of it the ground drops 1.3 into the pond.
//
// Returns the min corner, or null.
function castleSite(grid, sup, terrain, lat, centre, from = null, clear = 0) {
  const n = CASTLE_LOT, p = lat.pitch;
  // A lot that comes within `clear` cells of the centre, either way - the town's plan.
  const inPlan = ([gx, gz]) => clear > 0 && gx <= centre[0] + clear && gx + n - 1 >= centre[0] - clear
    && gz <= centre[1] + clear && gz + n - 1 >= centre[1] - clear;
  const own = (gx, gz) => !!from && gx >= from.gx && gx < from.gx + from.w && gz >= from.gz && gz < from.gz + from.d;
  const fits = ([gx, gz]) => {
    let lo = Infinity, hi = -Infinity;
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const cx = gx + x, cz = gz + z;
        if (!own(cx, cz) && !grid.freeCell(cx, cz, false)) return false;
        const [i, j] = superOf(lat, cx, cz);
        const who = sup.at(i, j);
        if (who !== NONE && who !== TOWN) return false;
        const h = terrain.heightAt(cx, cz);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    return hi - lo <= CASTLE_RELIEF;
  };
  const d2 = ([gx, gz]) => dist2([gx + n / 2, gz + n / 2], centre);
  const cands = [];
  if (from) {
    const onLattice = ([gx, gz]) => (((gx - lat.anchor[0]) % p) + p) % p === 0 && (((gz - lat.anchor[1]) % p) + p) % p === 0;
    const front = ([gx, gz]) => (from.rot === 0 ? gz === from.gz
      : from.rot === 1 ? gx + n === from.gx + from.w
        : from.rot === 2 ? gz + n === from.gz + from.d
          : gx === from.gx);
    for (let gz = from.gz + from.d - n; gz <= from.gz; gz++) {
      for (let gx = from.gx + from.w - n; gx <= from.gx; gx++) cands.push([gx, gz]);
    }
    const score = (c) => (front(c) ? 0 : 2) + (onLattice(c) ? 0 : 1);
    cands.sort((a, b) => score(a) - score(b) || d2(a) - d2(b) || a[1] - b[1] || a[0] - b[0]);
  } else {
    const [ci, cj] = superOf(lat, centre[0], centre[1]);
    for (let j = cj - MAX_RING; j <= cj + MAX_RING; j++) {
      for (let i = ci - MAX_RING; i <= ci + MAX_RING; i++) cands.push(blockOf(lat, i, j));
    }
    cands.sort((a, b) => d2(a) - d2(b) || a[1] - b[1] || a[0] - b[0]);
  }
  return cands.find((c) => !inPlan(c) && fits(c)) || null;
}

// What the castle's lot takes of the land register: every super-cell under it that was
// nobody's becomes the town's, in the register this scan and in the commons for good, or a
// hamlet would see a super-cell with a castle on it as free land to claim and never manage
// to put a house there.
function claimForTown(sup, lat, layout, [gx, gz], n) {
  const cells = [];
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) cells.push([gx + x, gz + z]);
  claimCellsForTown(sup, lat, layout, cells);
}
// The same for any cells, in the order given: the shipyard's dry end (`yardRows`), which is
// no square.
function claimCellsForTown(sup, lat, layout, cells) {
  const had = new Set(layout.town.commons.map((c) => `${c[0]},${c[1]}`));
  for (const [cx, cz] of cells) {
    const [i, j] = superOf(lat, cx, cz);
    if (sup.at(i, j) !== NONE) continue;
    sup.claim(i, j, TOWN, null);
    if (!had.has(`${i},${j}`)) { had.add(`${i},${j}`); layout.town.commons.push([i, j]); }
  }
}

// A castle placed before it stood on CASTLE_LOT grows to it where it stands, once, as soon
// as the ground allows - and stays the old size, drawn at the old size, for as long as it
// does not. It never moves somewhere else: that is the keeper's to decide, not a scan's.
//
// Its old road stays, and the new gate gets a stretch of its own to it under the same name.
// Not taken up and laid again: a road laid later over the castle's cells never wrote them
// down (`markPath` records only what it paves itself), so on paper they are the castle's
// alone and in fact they may be a hamlet's way into town. `castleSite` refuses a road cell,
// so the old road is never under the new lot; with the front kept it runs on from right in
// front of it. Measured on seed 1337 the new gate opens onto that road, and the stretch is
// nothing - the filter is there because `markPath` hands back a square cell it has seen.
function growCastle(grid, sup, terrain, lat, layout) {
  const p = layout.plots[CASTLE_ID];
  if (!p || p.w >= CASTLE_LOT) return;
  const site = castleSite(grid, sup, terrain, lat, layout.town.centre, p);
  if (!site) return;
  grid.fillBlock(site[0], site[1], CASTLE_LOT, CASTLE_LOT, PLOT);
  claimForTown(sup, lat, layout, site, CASTLE_LOT);
  layout.plots[CASTLE_ID] = { gx: site[0], gz: site[1], w: CASTLE_LOT, d: CASTLE_LOT, rot: p.rot };
  const gate = outsideDoor(site[0], site[1], p.rot, CASTLE_LOT);
  const had = new Set(((layout.paths.find((q) => q.id === `path:${CASTLE_ID}`) || {}).cells || []).map(ckey));
  markPath(grid, layout, `path:${CASTLE_ID}`, (routePath(grid, nearestWalkable(grid, gate)) || []).filter((c) => !had.has(ckey(c))));
}

// The last resort for a civic building whose reserved lot is gone: the nearest free
// block on the town's own lattice. Houses no longer come through here - they take a
// super-cell of their district's parcel, or a place on the commons.
// `avoid` is a set of cells the block may not touch - `planCells`, for a rung past a hundred,
// which may not come down half on a lot of the town's plan the way an older one could.
function findBlockAround(grid, centre, { skipRing0 = false, allowBeach = false, avoid = null } = {}) {
  const clear = (gx, gz) => {
    if (!avoid) return true;
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) if (avoid.has(`${gx + x},${gz + z}`)) return false;
    return true;
  };
  for (let r = skipRing0 ? 1 : 0; r <= MAX_RING; r++) {
    for (const [dx, dz] of RINGS[r]) {
      const [gx, gz] = blockAt(centre, dx, dz);
      if (grid.freeBlock(gx, gz, 3, 3, allowBeach) && clear(gx, gz)) return [gx, gz];
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

// ---- the kadehaven, the rede and the yard ------------------------------------------------
// Where the ladder past a hundred puts what it earns (Plans/DONE/mijlpalen-tot-tweehonderd.md).
// The centre is full by then - the square stopped growing at ninety and the castle has the
// last good ground of the town's plan - so the rungs go to the water: a yard on the coast, the
// ships it launches at anchor off it, and the buildings a harbour lives by along the quay.
//
// The **kadehaven** is the word for the harbour where they gather, and it is one of the four
// the island already has (planHarbours): the quay district's, when there is one, because a
// kade is what that district is; else the harbour at the quay the island has always shown,
// the side where its first boat lies (`standingQuay`); else the harbour nearest the town. The
// live island has no quay district at all - no Cowork task ever founded one - which is what
// left its crane waiting for good before this. Worked out on every scan, never stored: only a
// plot is sticky, and a building that stands keeps its place however the answer changes.
//
// The **rede** is the water a ship lies at anchor on: four by sixteen of it, parallel to the
// coast so that from the quay you see her broadside, 8 to 20 cells from the kadehaven's pier
// head, nearest the head wins, and on none of the water anybody else needs - see `seaCell`
// and `redeCell` for the six rules. A ship is a plot like any other, `civic:ship` with no
// door, so the bundle, every page and every visitor draw her from `buildings` with no new
// field, and everything that refuses a cell something stands on refuses hers: the fairway
// (`fairwayHeld`) and, through `keptWater`, the polders.
//
// The **yard** is five by sixteen square to the coast, its landward rows on dry ground (beach
// allowed, as for harbour houses) and its seaward ones in open water: the slipway runs from
// its sheds down into the sea, and its front - the model's +Z - is the sea end.

export const YARD_ID = 'civic:shipyard';
// `civic:ship`, `civic:ship:2`, `civic:ship:3` - the Batavia and the two after her
// (civicIdOf in lib/village.mjs).
export const isShipId = (id) => /^civic:ship(:\d+)?$/.test(String(id));
// The two lots that stand in the sea, wholly or partly.
const afloat = (id) => isShipId(id) || id === YARD_ID;

// The civic types placed at the water. The milestone loop waits for the harbours for these
// (`deferred` there) on a scan that has none yet.
const AT_THE_WATER = new Set(['shipyard', 'ship', 'fishery', 'warehouse', 'weighhouse', 'piratetavern']);
// The two that stand on the kadehaven's quay itself (`harbourSite`).
const QUAYSIDE = new Set(['warehouse', 'weighhouse']);
// Everything past a hundred that turns its front to the water, and so moves when a growth
// ring turns that water to meadow (`doomedBy`): the two above, the fisherman's hut, and the Salty
// Kraken at 52, whose door is on the water too.
const FACES_WATER = new Set(['warehouse', 'weighhouse', 'fishery', 'piratetavern']);
// The three by threes past a hundred that take their ground for the town, the way a trade does
// (`claimForTown`): the harbour buildings, the Salty Kraken and the quarry.
const CLAIMS_LAND = new Set(['warehouse', 'weighhouse', 'fishery', 'quarry', 'piratetavern']);
// The trades that were rungs before the ladder went past a hundred. They keep the fallback they
// always had; a newer one may not come down half on a lot of the town's plan (`planCells`).
const OLD_TRADES = new Set(['sawmill', 'smithy', 'stable']);

// How deep the rede has to be, cell mean. The sea is at about -0.6 a few cells off most
// coasts, so this keeps a ship off the shallows without sending her to the horizon.
export const REDE_DEPTH = -0.4;
// How far from the kadehaven's pier head, in cells, the nearest cell of a rede may lie.
export const REDE_NEAR = 8;
export const REDE_FAR = 20;
// How close to a plank, a slipway or a berth any water a ship or a slipway's toe takes may
// come: two cells, so a Benchy coming alongside the head has her own water.
export const HARBOUR_CLEAR = 2;
// The lane out from every pier head that a boat leaving the harbour takes: this many cells
// either side of the line the planks point along, from the head out to the edge of the grid.
export const CORRIDOR_HALF = 2;
// The galleon's turning room, in world units round where she lies (`shipBerth`): half of her
// thirteen over the bowsprit, which is what she sweeps turning on the spot, and half a cell.
export const GALLEON_ROOM = 7;
// Ships two and three anchor beside the first, this far apart: a hull four wide and a cell of
// open water between.
export const FLEET_PITCH = 5;
// The yard's rows, counted from its landward end: the first YARD_DRY on ground a building may
// stand on (the shed, the sheer legs, the timber), the last YARD_WET in open water (the
// slipway's toe, where a hull floats off). The six between may be either - beach, the
// waterline, shallows - because a coast is not a step and the slipway is what crosses it.
export const YARD_DRY = 6;
export const YARD_WET = 4;
// How far from a harbour's shore cell the middle of the yard may be, in cells.
const YARD_REACH = 24;
// The highest a corner of the yard's dry rows may stand above the sea: the slipway's toe is
// 1.25 below the ground the yard is stood on (scripts/build-shipyard.py), so higher than this
// and it comes out of the water.
export const YARD_LAND_MAX = 1.2;
// How far from a harbour's shore a harbour building or the fishery may stand, in cells.
const COAST_REACH = 16;
// How much the ground may rise across the quarry's lot: what the three by three's porch skirt
// hides (PORCH_SKIRT, 0.7, in web/js/buildings.js).
const QUARRY_RELIEF = 0.7;

// Which way a front faces, by rot: `facing`'s convention, 0 = -z (north), 1 = +x, 2 = +z, 3 = -x.
const LOOK = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const rotOf = ([dx, dz]) => LOOK.findIndex(([x, z]) => x === dx && z === dz);

// The cells of every lot of the town's plan - the ring, the sixteen street lots and the gold
// pit's - taken or not. What stands at the water or with the trades past a hundred may not
// come down half on one: the plan is the town's, and its lots are not all held yet.
function planCells(centre) {
  const out = new Set();
  for (const lot of [...Object.values(RING), ...STREET_LOTS, GOLDPIT_LOT]) {
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) out.add(`${centre[0] + lot.at[0] + x},${centre[1] + lot.at[1] + z}`);
  }
  return out;
}

// The kadehaven as `{ n, side, shore, pier, slip }`: `n` its index in `layout.harbours` (so its
// slipway is `road:harbour:<n>`), or -1 for a quay district whose planks are not one of the
// harbours - a quay re-picked since, say - which is still the kadehaven. Null on an island
// with no harbour at all.
//
// On an island with no quay district the second rule asks where the first boat lies, which is
// the quay every page derives from the landing (quayFor with no planks - mooringsFor's
// `legacy`): the harbour that is that quay, and when it is none of them - on a grown island
// the harbours are planned again when a ring drowns one, and the landing's quay need not be
// among the new ones - the harbour on its side of the town, which is still "the side where
// the island's first boat lies". Measured on the live island: its galleon lies at a quay of its
// own at [209,66] north of the square and the north harbour is at [154,46]; asked by shore
// alone the rule fell through to the nearest harbour, the east one, a hundred and twenty
// cells down the coast from the boat.
export function kadehaven(layout, terrain) {
  const harbours = layout.harbours || [];
  const pick = (n) => {
    if (n < 0) return null;
    const h = harbours[n];
    return { n, side: h.side, shore: h.shore, pier: h.pier, slip: h.slip || [] };
  };
  const at = (shore) => pick(harbours.findIndex((h) => h && h.shore && h.shore[0] === shore[0] && h.shore[1] === shore[1]));
  const centre = layout.town.centre;
  const q = layout.districts && layout.districts.quay;
  if (q && q.shore && (q.pier || []).length) {
    return at(q.shore) || { n: -1, side: sideOf(q.shore, centre), shore: q.shore, pier: q.pier, slip: [] };
  }
  const first = layout.landing ? quayFor(terrain, layout.landing) : null;
  if (first) {
    const side = sideOf(first.shore, centre);
    const own = at(first.shore) || pick(harbours.findIndex((h) => h && h.side === side && h.shore && (h.pier || []).length));
    if (own) return own;
  }
  const near = nearestHarbour(layout, centre);
  return near ? at(near.shore) : null;
}

// A harbour as the sites below measure from it: its pier head, the way its planks run out to
// sea, and the way along the coast.
function frameOf(h) {
  const head = h.pier[h.pier.length - 1];
  const run = [Math.sign(h.pier[0][0] - h.shore[0]), Math.sign(h.pier[0][1] - h.shore[1])];
  return { ...h, head, run, across: [run[1], -run[0]] };
}

// The harbours in the order a building at the water tries them: the kadehaven, then the
// others in HARBOUR_SIDES order from it - the order Plans/DONE/mijlpalen-tot-tweehonderd.md hands
// the fleet out in, so "the next harbour" means the same thing to both.
function harboursFrom(layout, kade) {
  const hs = layout.harbours || [];
  const out = kade ? [kade] : [];
  const from = kade ? kade.n : -1;
  for (let k = 1; k <= hs.length; k++) {
    const n = (from + k + hs.length) % hs.length;
    const h = hs[n];
    if (n === from || !h || !h.shore || !(h.pier || []).length) continue;
    out.push({ n, side: h.side, shore: h.shore, pier: h.pier, slip: h.slip || [] });
  }
  return out.map(frameOf).filter((f) => rotOf(f.run) >= 0);
}

// Everything about the island's water that the rede, the yard and the harbour buildings are
// kept off, worked out once per pass (`coastline` in placeAll):
//   near      every cell within HARBOUR_CLEAR of a plank, a slipway, or a berth - all three
//             of every harbour, boats or not, because a berth is what `mooringsFor` lays out
//             from the harbour alone and the fleet grows into it without asking;
//   corridor  the lane out from every pier head;
//   swings    the galleon's turning room, round the spot `shipBerth` lays her in - the same
//             sum the page does, on the same ground (placeIsland, the island at the origin),
//             from the same moorings, which is why it lives in shared/quay.mjs now;
//   fairway   the dredged channel, and `works` every cell a polder raised.
// `harbours` is what it was worked out from, so a pass that plans the harbours after it asks
// again.
export function waterfront(layout, terrain, model) {
  const kade = kadehaven(layout, terrain);
  const order = harboursFrom(layout, kade);
  const frames = [...order];
  const q = layout.districts && layout.districts.quay;
  if (q && q.shore && (q.pier || []).length && !frames.some((f) => f.shore[0] === q.shore[0] && f.shore[1] === q.shore[1])) {
    const f = frameOf({ shore: q.shore, pier: q.pier, slip: [] });
    if (rotOf(f.run) >= 0) frames.push(f);
  }
  const near = new Set();
  const mark = ([gx, gz]) => {
    for (let dz = -HARBOUR_CLEAR; dz <= HARBOUR_CLEAR; dz++) for (let dx = -HARBOUR_CLEAR; dx <= HARBOUR_CLEAR; dx++) near.add(`${gx + dx},${gz + dz}`);
  };
  for (const f of frames) for (const c of [...f.pier, ...f.slip]) mark(c);
  // The village as scan.mjs hands it to every page, as far as the moorings read it: the
  // harbours, full, and the quay's planks when the village has a quay district - a quay on
  // record for a district nobody lives in any more is not in village.json, so no page moors
  // at it either.
  const quayLive = !!(q && (q.pier || []).length && ((model && model.districts) || []).some((d) => d.id === 'quay'));
  const view = {
    island: {
      landing: layout.landing,
      harbours: (layout.harbours || []).filter(Boolean).map((h) => ({ side: h.side, shore: h.shore, pier: h.pier, boats: BOATS_PER_HARBOUR })),
    },
    districts: quayLive ? [{ pier: q.pier, shore: q.shore || null }] : [],
  };
  const moorings = mooringsFor('x', terrain, view);
  for (const m of moorings) mark([Math.floor(m.x + terrain.half), Math.floor(m.z + terrain.half)]);
  const first = moorings.find((m) => m.id === 'boat:x');
  // On an island with a stone quay the galleon lies in the big ships' water (shared/quay.mjs
  // `shipWater`), the same sum every page does with the same `works`.
  const galleon = first ? shipBerth(first, placeIsland(terrain).worldHeight, shipWater(layout.works, terrain.half)) : null;
  const corridor = (gx, gz) => frames.some((f) => {
    const dx = gx - f.head[0], dz = gz - f.head[1];
    return dx * f.run[0] + dz * f.run[1] >= 1 && Math.abs(dx * f.across[0] + dz * f.across[1]) <= CORRIDOR_HALF;
  });
  const swings = (gx, gz) => {
    if (!galleon) return false;
    const [x, z] = terrain.cellWorld(gx, gz);
    return (x - galleon.x) * (x - galleon.x) + (z - galleon.z) * (z - galleon.z) <= GALLEON_ROOM * GALLEON_ROOM;
  };
  const works = new Set();
  for (const p of layout.polders || []) {
    for (const c of [...(p.cells || []), ...(p.dike || []), ...(p.pools || []), ...(p.road || [])]) works.add(ckey(c));
  }
  const fairway = new Set(((layout.fairway && layout.fairway.cells) || []).map(ckey));
  // The big ships' water, or null: where the rede lies on an island with a stone quay.
  const ships = shipWaterOf(layout.works);
  return { harbours: layout.harbours, kade, order, frames, near, galleon, corridor, swings, works, fairway, ships };
}

// Water a ship or a slipway's toe may take, less the depth: nothing standing on it or paving
// it, water the tide reaches, not the fairway nor anything a polder raised, not near a plank,
// a slipway or a berth, not in a harbour's lane, not where the galleon turns, and a cell of
// open water between it and anything already standing.
function seaCell(grid, terrain, wf, gx, gz) {
  if (!grid.in(gx, gz) || grid.get(gx, gz) !== BLOCKED) return false;
  if (!terrain.isWater(gx, gz) || !openWater(terrain, gx, gz)) return false;
  const k = `${gx},${gz}`;
  if (wf.fairway.has(k) || wf.works.has(k) || wf.near.has(k)) return false;
  if (wf.corridor(gx, gz) || wf.swings(gx, gz)) return false;
  for (const [dx, dz] of N8) if (grid.get(gx + dx, gz + dz) === PLOT) return false;
  return true;
}
// The rede's rules, a cell at a time: deep enough to anchor in, and a `seaCell`. Exported for
// the tests that hold a ship to them.
export const redeCell = (grid, terrain, wf, gx, gz) => terrain.heightAt(gx, gz) < REDE_DEPTH && seaCell(grid, terrain, wf, gx, gz);

// A cell test asked through a memo, so the searches below judge each cell once however many
// lots it lies under. Only within one search: a lot placed after it changes the answers.
function memoOf(grid, test) {
  const seen = new Int8Array(grid.size * grid.size);
  return (gx, gz) => {
    if (!grid.in(gx, gz)) return false;
    const i = gx + gz * grid.size;
    if (!seen[i]) seen[i] = test(gx, gz) ? 1 : 2;
    return seen[i] === 1;
  };
}
function rectOk(gx, gz, w, d, ok) {
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (!ok(gx + x, gz + z)) return false;
  return true;
}

// The rede off one harbour: the strip of `redeCell`s nearest its pier head, measured from the
// head to the strip's middle, with its nearest cell REDE_NEAR to REDE_FAR from the head. Her
// bow points along the coast, `across`, a quarter turn from the way the planks run.
function redeSite(grid, terrain, wf, f) {
  const rot = rotOf(f.across);
  const { w, d } = stamped(SHIP_LOT, rot);
  const [hx, hz] = f.head;
  const ok = memoOf(grid, (gx, gz) => redeCell(grid, terrain, wf, gx, gz));
  let best = null, bk = null;
  for (let gz = hz - REDE_FAR - d + 1; gz <= hz + REDE_FAR; gz++) {
    for (let gx = hx - REDE_FAR - w + 1; gx <= hx + REDE_FAR; gx++) {
      const gap = Math.max(gx - hx, 0, hx - (gx + w - 1), gz - hz, hz - (gz + d - 1));
      if (gap < REDE_NEAR || gap > REDE_FAR) continue;
      const cx = 2 * gx + w - (2 * hx + 1), cz = 2 * gz + d - (2 * hz + 1);
      const key = [cx * cx + cz * cz, gz, gx];
      if (bk && !lessTuple(key, bk)) continue;
      if (!rectOk(gx, gz, w, d, ok)) continue;
      best = [gx, gz]; bk = key;
    }
  }
  return best ? { at: best, rot } : null;
}

// Where a ship anchors. The second and the third beside the first, FLEET_PITCH apart across
// her beam and turned the same way - the nearest free slot first, and of two equally near the
// one nearer a harbour head - so a fleet of three lies 2-1-3 where the water allows and 1-2-3
// where it allows only one side. A slot may slide up to FLEET_SLIDE along her length, the
// least slide first: measured on seed 5, the galleon's turning room took the last cell of the
// slot square beside the Batavia, and without the slide the second ship went two slots out and
// the third a cell off the line. A ship with no first to lie beside, or no room beside her,
// takes the rede of the kadehaven, and failing that of each harbour in turn.
const FLEET_SLIDE = 4;
// With a stone quay the ships anchor in the big ships' water (`wf.ships`, shared/quay.mjs
// `shipWaterOf`: the pirates' half of the funnel, off the channel's lane, past the quay's end),
// bows along the funnel rather than broadside to the coast - a hull sixteen long does not fit
// across that half anywhere on Hoogezand (fifteen at most) - nearest the kadehaven's pier head,
// and no nearer to it than REDE_NEAR. KADE_REDE_FAR instead of REDE_FAR: the ships' water begins
// past the quay's end, which on Hoogezand is 24 rows beyond the pier head already, and the
// galleon's turning room lies across its first rows.
//
// And in lanes: the ship's side nearest the axis SHIP_LANE cells off it, or FLEET_PITCH more,
// or twice that - so three ships and their open water between them fit the half of the funnel
// they have (fifteen cells on Hoogezand: 4 + 1 + 4 + 1 + 4 and a cell to spare). Taken where it
// happened to be nearest the head, the first ship lay two cells off a lane and there was room
// for two; the second and third lie beside her FLEET_PITCH apart, so on a lane too.
export const KADE_REDE_FAR = 64;
function kadeRedeSite(grid, terrain, layout, wf) {
  const w0 = layout.works, h = w0 && w0.haven, f = wf.order[0];
  const frame = h && w0.kade ? kadeFrame(h, w0.kade.cells[0]) : null;
  if (!frame || !f) return null;
  const [dx, dz] = h.dir;
  const rot = Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 1 : 3) : (dz > 0 ? 2 : 0);
  const { w, d } = stamped(SHIP_LOT, rot);
  const [hx, hz] = f.head;
  const ok = memoOf(grid, (gx, gz) => wf.ships(gx, gz) && redeCell(grid, terrain, wf, gx, gz));
  const onLane = (gx, gz) => {
    const near = Math.max(frame.o([gx, gz]), frame.o([gx + w - 1, gz + d - 1]));
    const off = -near - SHIP_LANE;
    return off >= 0 && off % FLEET_PITCH === 0;
  };
  let best = null, bk = null;
  for (let gz = hz - KADE_REDE_FAR - d + 1; gz <= hz + KADE_REDE_FAR; gz++) {
    for (let gx = hx - KADE_REDE_FAR - w + 1; gx <= hx + KADE_REDE_FAR; gx++) {
      const gap = Math.max(gx - hx, 0, hx - (gx + w - 1), gz - hz, hz - (gz + d - 1));
      if (gap < REDE_NEAR || gap > KADE_REDE_FAR || !onLane(gx, gz)) continue;
      const cx = 2 * gx + w - (2 * hx + 1), cz = 2 * gz + d - (2 * hz + 1);
      const key = [cx * cx + cz * cz, gz, gx];
      if (bk && !lessTuple(key, bk)) continue;
      if (!rectOk(gx, gz, w, d, ok)) continue;
      best = [gx, gz]; bk = key;
    }
  }
  return best ? { at: best, rot } : null;
}
function shipSite(id, grid, terrain, layout, wf) {
  const first = layout.plots['civic:ship'];
  if (id !== 'civic:ship' && first) {
    const beam = first.w > first.d ? [0, 1] : [1, 0];
    const length = [beam[1], beam[0]];
    const ok = memoOf(grid, (gx, gz) => (!wf.ships || wf.ships(gx, gz)) && redeCell(grid, terrain, wf, gx, gz));
    const heads = wf.frames.map((f) => f.head);
    const reach = ([gx, gz]) => Math.min(...heads.map(([hx, hz]) => {
      const cx = 2 * gx + first.w - (2 * hx + 1), cz = 2 * gz + first.d - (2 * hz + 1);
      return cx * cx + cz * cz;
    }));
    let best = null, bk = null;
    for (const k of [1, -1, 2, -2]) {
      for (let s = -FLEET_SLIDE; s <= FLEET_SLIDE; s++) {
        const at = [first.gx + beam[0] * k * FLEET_PITCH + length[0] * s, first.gz + beam[1] * k * FLEET_PITCH + length[1] * s];
        const key = [Math.abs(k), Math.abs(s), heads.length ? reach(at) : 0, k, s];
        if (bk && !lessTuple(key, bk)) continue;
        if (!rectOk(at[0], at[1], first.w, first.d, ok)) continue;
        bk = key; best = at;
      }
    }
    if (best) return { at: best, rot: first.rot };
  }
  if (wf.ships) {
    const site = kadeRedeSite(grid, terrain, layout, wf);
    if (site) return site;
  }
  for (const f of wf.order) {
    const site = redeSite(grid, terrain, wf, f);
    if (site) return site;
  }
  return null;
}

// Cell (t, u) of a yard lot at `rot` with its min corner at gx, gz: row t counted from the
// landward end (0) to the sea end (YARD_LOT.d - 1), u across it. The front faces LOOK[rot],
// so the sea end is the row on that side.
function yardCell(rot, gx, gz, t, u) {
  const far = YARD_LOT.d - 1;
  if (rot === 0) return [gx + u, gz + far - t];
  if (rot === 2) return [gx + u, gz + t];
  if (rot === 1) return [gx + t, gz + u];
  return [gx + far - t, gz + u];
}
// Rows `from` to `to` (not included) of a yard plot as it stands, landward end first.
export function yardRows(p, from, to) {
  const out = [];
  for (let t = from; t < to; t++) for (let u = 0; u < YARD_LOT.w; u++) out.push(yardCell(p.rot, p.gx, p.gz, t, u));
  return out;
}

// Where the yard goes: at the kadehaven, or failing that at each harbour in turn, the lot whose
// middle is nearest the harbour's shore cell - square to the coast by construction, since dry
// rows at one end and open water at the other is what square to a coast is - with the way the
// harbour's own planks run out preferred on a tie. Its dry rows on ground a harbour house could
// stand on and that is the town's or nobody's, never on a lot of the town's plan; its wet rows
// `seaCell`s; the rows between free sand, the waterline or tidal water, nothing standing on
// any of them. The planks, the ramp and the slipway are PIER and PATH to the grid, so the yard
// can take none of them.
function yardSite(grid, terrain, sup, lat, layout, wf) {
  const plan = planCells(layout.town.centre);
  const ours = (gx, gz) => { const [i, j] = superOf(lat, gx, gz); const who = sup.at(i, j); return who === NONE || who === TOWN; };
  // Low enough, too: the page stands the yard on the highest land corner of its dry rows
  // (web/js/shipyard.js shipyardGround), and the slipway falls 1.25 below that to its toe, so
  // over YARD_LAND_MAX the toe stands clear of the sea it is meant to launch into.
  const low = (gx, gz) => Math.max(terrain.corner(gx, gz), terrain.corner(gx + 1, gz), terrain.corner(gx, gz + 1), terrain.corner(gx + 1, gz + 1)) <= YARD_LAND_MAX;
  const dry = memoOf(grid, (gx, gz) => grid.freeCell(gx, gz, true) && low(gx, gz) && ours(gx, gz) && !plan.has(`${gx},${gz}`));
  const wet = memoOf(grid, (gx, gz) => seaCell(grid, terrain, wf, gx, gz));
  const between = memoOf(grid, (gx, gz) => {
    const v = grid.get(gx, gz);
    if (v !== FREE && v !== BLOCKED) return false;
    const k = `${gx},${gz}`;
    if (wf.fairway.has(k) || wf.works.has(k)) return false;
    if (terrain.isWater(gx, gz)) return openWater(terrain, gx, gz) && !wf.near.has(k) && !wf.corridor(gx, gz);
    if (!ours(gx, gz) || plan.has(k)) return false;
    return grid.freeCell(gx, gz, true) || terrain.heightAt(gx, gz) < BEACH_MAX;
  });
  // At a harbour with a stone quay (planKade) the yard belongs on the pirates' bank, wholly out
  // of the funnel and the cell round it: the harbour's water is the quay's boats' and the big
  // ships', and the far bank is where the big ships are built (Plans/quay-en-rivier.md, fase 3).
  const bank = kadeBankOf(layout);
  const kept = bank ? havenKeys(layout, 1) : null;
  const pirate = (gx, gz) => bank(gx, gz) === 'pirate' && !kept.has(`${gx},${gz}`);
  const fits = (gx, gz, rot, atKade) => {
    for (let t = 0; t < YARD_LOT.d; t++) {
      const test = t < YARD_DRY ? dry : t >= YARD_LOT.d - YARD_WET ? wet : between;
      for (let u = 0; u < YARD_LOT.w; u++) {
        const [cx, cz] = yardCell(rot, gx, gz, t, u);
        if (!test(cx, cz) || (atKade && !pirate(cx, cz))) return false;
      }
    }
    return true;
  };
  for (const f of wf.order) {
    const [sx, sz] = f.shore;
    const atKade = !!bank && !!wf.kade && f.n === wf.kade.n;
    const pref = rotOf(f.run);
    const rots = [pref, ...[0, 1, 2, 3].filter((r) => r !== pref)];
    let best = null, bk = null;
    rots.forEach((rot, rank) => {
      const { w, d } = stamped(YARD_LOT, rot);
      for (let gz = sz - YARD_REACH - d; gz <= sz + YARD_REACH; gz++) {
        for (let gx = sx - YARD_REACH - w; gx <= sx + YARD_REACH; gx++) {
          const cx = 2 * gx + w - (2 * sx + 1), cz = 2 * gz + d - (2 * sz + 1);
          if (Math.abs(cx) > 2 * YARD_REACH || Math.abs(cz) > 2 * YARD_REACH) continue;
          const key = [cx * cx + cz * cz, rank, gz, gx];
          if (bk && !lessTuple(key, bk)) continue;
          if (!fits(gx, gz, rot, atKade)) continue;
          best = { at: [gx, gz], rot }; bk = key;
        }
      }
    });
    if (best) return best;
  }
  return null;
}

// A three by three on land with its front on open water - its door opens on the quay's edge -
// whose middle is nearest `near` within `reach`, on ground the town's or nobody's and off every
// lot of the town's plan. `prefer` is the rot tried first on each block; the rest follow in
// order. The front cell has to be plain water: a plank is PIER and so not.
//
// And only a lot a road reaches on this same scan, the way `standAt` takes the goldsmith's and
// the mine's: each candidate, best first, is stood on the grid and asked `civicRoad` - the one
// the placing lays straight after - and given back if there is none, or none that begins
// within a settler's reach of the door (`atDoor`: a road on paper is not one to walk to). A
// door on the sea leaves the road to find the lot from its sides, and a lot can be boxed in on
// all of them: seed 2024 on the ladder to 200 at size 128 put its weigh house on a spit of
// beach whose one way ashore ran through the warehouse's lot, and it never got a road - on
// seed 10 the weigh house's road began five cells from its door. Asked here rather than of
// the plot once placed, because a plot is sticky: a lot taken without a road keeps none for
// good. The cells go back to what they were, not to FREE - a coast lot may stand on beach,
// which is BLOCKED. COAST_TRIES bounds a search that is a full route each; past it the
// harbour is given up and `harbourSite` goes on to the next, as it does for a coast with no
// room.
//
// `sand` is the second round (`harbourSite`): the door's step may be one cell of beach with the
// open water straight past it - the building a cell back from the waterline, still facing the
// sea, its road coming up the sand to the door (`civicRoad`'s strandpad). A three by three
// whose step is the water itself is rare, 0 to 2 at a harbour on the ladder at 128, and on
// seeds 12, 17, 20, 21, 30 and 39 there was none at any harbour even before a road was asked for.
const COAST_TRIES = 12;
function coastSite(grid, terrain, sup, lat, layout, near, prefer, reach, sand = false) {
  const plan = planCells(layout.town.centre);
  const ours = (gx, gz) => { const [i, j] = superOf(lat, gx, gz); const who = sup.at(i, j); return who === NONE || who === TOWN; };
  const dry = memoOf(grid, (gx, gz) => grid.freeCell(gx, gz, true) && ours(gx, gz) && !plan.has(`${gx},${gz}`));
  const wet = (gx, gz) => grid.get(gx, gz) === BLOCKED && terrain.isWater(gx, gz) && openWater(terrain, gx, gz);
  const beach = (gx, gz) => grid.get(gx, gz) === BLOCKED && terrain.isLand(gx, gz) && terrain.isBeach(gx, gz);
  const front = (gx, gz, rot) => {
    const [ox, oz] = outsideDoor(gx, gz, rot);
    if (!sand) return wet(ox, oz);
    const [fx, fz] = LOOK[rot];
    return beach(ox, oz) && wet(ox + fx, oz + fz);
  };
  const rots = prefer >= 0 ? [prefer, ...[0, 1, 2, 3].filter((r) => r !== prefer)] : [0, 1, 2, 3];
  const found = [];
  for (let gz = Math.max(0, near[1] - reach - 1); gz <= Math.min(grid.size - 3, near[1] + reach - 1); gz++) {
    for (let gx = Math.max(0, near[0] - reach - 1); gx <= Math.min(grid.size - 3, near[0] + reach - 1); gx++) {
      const dx = gx + 1 - near[0], dz = gz + 1 - near[1];
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
      if (!rectOk(gx, gz, 3, 3, dry)) continue;
      const rank = rots.findIndex((rot) => front(gx, gz, rot));
      if (rank < 0) continue;
      found.push({ key: [dx * dx + dz * dz, rank, gz, gx], at: [gx, gz], rot: rots[rank] });
    }
  }
  found.sort((a, b) => (lessTuple(a.key, b.key) ? -1 : lessTuple(b.key, a.key) ? 1 : 0));
  const had = new Uint8Array(9);
  for (const { at: [gx, gz], rot } of found.slice(0, COAST_TRIES)) {
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) had[x + 3 * z] = grid.get(gx + x, gz + z);
    grid.fillBlock(gx, gz, 3, 3, PLOT);
    const p = { gx, gz, w: 3, d: 3, rot };
    const road = civicRoad(grid, layout, p, { step: outsideDoor(gx, gz, rot) });
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) grid.set(gx + x, gz + z, had[x + 3 * z]);
    if (atDoor(road, doorCell(gx, gz, rot, 3, 3))) return { at: [gx, gz], rot };
  }
  return null;
}

// The Salty Kraken's lot (Plans/piratenkroeg.md): a three by three at the water with its door on
// it, like the warehouse's - and for now it is the warehouse's, `harbourSite`. It is its own
// function so that there is one place to say where the pub goes: it is to stand on the pirate
// bank of the haven, across the funnel from the stone quay, and is retargeted to the pirate bank
// once works.haven exists (Plans/quay-en-rivier.md, on fix/quay-en-rivier). Never
// `harbourSite` changed for it.
function pirateTavernSite(grid, terrain, sup, lat, layout, wf) {
  return harbourSite(grid, terrain, sup, lat, layout, wf);
}

// The warehouse and the weigh house: on the kadehaven's quay, nearest its shore cell, front to
// the water and to the way the planks run where the coast allows; failing that at the next
// harbour, and so on round. And failing every harbour, round again with the door on the sand
// (`coastSite`'s `sand`) - after all of them rather than at each, so the sand is only ever the
// answer where no harbour had a lot facing the water with a road to its door.
function harbourSite(grid, terrain, sup, lat, layout, wf) {
  const kade = kadeSite(grid, sup, lat, layout);
  if (kade) return kade;
  for (const sand of [false, true]) {
    for (const f of wf.order) {
      const site = coastSite(grid, terrain, sup, lat, layout, f.shore, rotOf(f.run), COAST_REACH, sand);
      if (site) return site;
    }
  }
  return null;
}

// Behind a stone quay (planKade): a three by three on the landward side of the quay with its
// door's step on the quay's back row, so the quay itself stays a clear walk from end to end and
// the building's front is on the harbour all the same. The lot nearest the quay's seaward end -
// where the crane stands - that is free ground (beach allowed, as for every harbour building),
// the town's or nobody's and off the town's plan. The step is `road:kade`, so the road is there.
function kadeSite(grid, sup, lat, layout) {
  const w = layout.works, k = w && w.kade, h = w && w.haven;
  if (!k || !h) return null;
  const plan = planCells(layout.town.centre);
  const own = new Set(k.cells.map(ckey));
  const rot = rotOf([-k.back[0], -k.back[1]]);
  const ours = (gx, gz) => { const [i, j] = superOf(lat, gx, gz); const who = sup.at(i, j); return who === NONE || who === TOWN; };
  const ok = (gx, gz) => grid.freeCell(gx, gz, true) && ours(gx, gz) && !plan.has(`${gx},${gz}`) && !own.has(`${gx},${gz}`);
  const seaward = (c) => (c[0] - h.top[0]) * h.dir[0] + (c[1] - h.top[1]) * h.dir[1];
  const rear = k.cells.filter((c) => !own.has(`${c[0] + k.back[0]},${c[1] + k.back[1]}`))
    .sort((a, b) => seaward(b) - seaward(a) || a[1] - b[1] || a[0] - b[0]);
  for (const step of rear) {
    for (let gz = step[1] - 3; gz <= step[1] + 1; gz++) {
      for (let gx = step[0] - 3; gx <= step[0] + 1; gx++) {
        const [ox, oz] = outsideDoor(gx, gz, rot);
        if (ox !== step[0] || oz !== step[1]) continue;
        if (rectOk(gx, gz, 3, 3, ok)) return { at: [gx, gz], rot };
      }
    }
  }
  return null;
}

// The fisherman's hut: at a harbour that is not the kadehaven, the one nearest the town - so
// each harbour the island has gets something of its own - and on an island with only the one,
// on any coast at all, nearest the town.
function fisherySite(grid, terrain, sup, lat, layout, wf) {
  const centre = layout.town.centre;
  const others = wf.order.slice(wf.kade ? 1 : 0).sort((a, b) => dist2(a.shore, centre) - dist2(b.shore, centre) || a.n - b.n);
  for (const f of others) {
    const site = coastSite(grid, terrain, sup, lat, layout, f.shore, rotOf(f.run), COAST_REACH);
    if (site) return site;
  }
  return coastSite(grid, terrain, sup, lat, layout, centre, -1, grid.size);
}

// The quarry: the three by three on the highest, roughest free ground - the windmill's rule
// (the highest free cell) for a lot, with the slope added in because a quarry is a rock face
// and not a hilltop meadow - as long as the lot is flat enough for its porch skirt to hide
// (QUARRY_RELIEF), on ground the town's or nobody's, and out beyond the town's plan
// (TOWN_REACH, the new castle's rule): on an island of 128 the hill is often the town's own
// rise, and measured on seed 5 the highest free block was nine cells from the square, between
// two streets. Walked in the terrain's own order and taken strictly, so the first of two equal
// lots wins on every scan.
function quarrySite(grid, terrain, sup, lat, layout) {
  const [cx0, cz0] = layout.town.centre;
  const inTown = (gx, gz) => gx <= cx0 + TOWN_REACH && gx + 2 >= cx0 - TOWN_REACH && gz <= cz0 + TOWN_REACH && gz + 2 >= cz0 - TOWN_REACH;
  let best = null, bs = -Infinity;
  for (const [gx, gz] of terrain.landCells) {
    if (inTown(gx, gz) || !grid.freeBlock(gx, gz, 3, 3, false)) continue;
    let lo = Infinity, hi = -Infinity, s = 0, ok = true;
    for (let z = 0; z < 3 && ok; z++) {
      for (let x = 0; x < 3 && ok; x++) {
        const cx = gx + x, cz = gz + z;
        const [i, j] = superOf(lat, cx, cz);
        const who = sup.at(i, j);
        if (who !== NONE && who !== TOWN) { ok = false; break; }
        const h = terrain.heightAt(cx, cz);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
        s += h + terrain.slope(cx, cz);
      }
    }
    if (!ok || hi - lo > QUARRY_RELIEF) continue;
    if (s > bs) { bs = s; best = [gx, gz]; }
  }
  return best;
}

// The gold mine (Plans/DONE/goudmijn.md): the quarry's rule - the highest, roughest lot that is
// flat enough to stand on - but on the town's lattice and within MINE_RING of the square.
// A mine belongs in the hills, and on an island of 384 the highest ground can be a minute's
// walk away, where nobody standing in town would ever see a cart come out of it; so each
// ring out costs MINE_FAR, which on ground that is all one height takes the nearest ring
// and otherwise lets a real hill win. Outside the town's plan (TRADE_RING, the workshops'
// ring) and on ground that is the town's or nobody's. Lattice blocks rather than any cell,
// unlike the quarry: the mine is there from the first scan, and a lot off the lattice across
// a lane would cut the walks of hamlets not yet founded.
const MINE_RING = 7;
const MINE_FAR = 1.5;
const MINE_TRIES = 12;
const LOOSE_REACH = 24;

// How many cells a road could reach from `from`: the ground the router walks (FREE, PATH,
// the square, a deck), four-connected. Used to see whether a lot cuts a pocket off.
function reachCount(grid, from) {
  return floodFrom(grid, from).count;
}
// The flood itself, for `civicRoad`, which needs to know which cells were reached and not
// only how many.
function floodFrom(grid, from) {
  const size = grid.size;
  const seen = new Uint8Array(size * size);
  const q = [from[0] + from[1] * size];
  seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) {
    const k = q[h], x = k % size, z = (k - x) / size;
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      if (!grid.in(nx, nz)) continue;
      const n = nx + nz * size;
      if (seen[n]) continue;
      const v = grid.cells[n];
      if (v !== FREE && v !== PATH && v !== SQUARE && v !== BRIDGE) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  return { seen, count: q.length };
}

// A list of lots split into those that keep off the coast and those that do not, each in the
// order it came. Off the coast is INLAND cells of dry, routable ground all round the lot. The
// goldsmith takes an inland lot first and the coast only when there is no other; the mine waits
// for one while the island can still grow (standAt).
const INLAND = 2;
function byCoast(grid, blocks) {
  const inland = ([gx, gz]) => {
    for (let z = gz - INLAND; z < gz + 3 + INLAND; z++) {
      for (let x = gx - INLAND; x < gx + 3 + INLAND; x++) {
        if (!grid.in(x, z) || !grid.t.isLand(x, z) || grid.t.isBeach(x, z) || grid.get(x, z) === BLOCKED) return false;
      }
    }
    return true;
  };
  const a = [], b = [];
  for (const block of blocks) (inland(block) ? a : b).push(block);
  return { inland: a, coastal: b };
}

function mineSites(grid, terrain, sup, lat, centre) {
  const found = [];
  for (let r = TRADE_RING; r <= MINE_RING; r++) {
    for (const [dx, dz] of RINGS[r]) {
      const [gx, gz] = blockAt(centre, dx, dz);
      if (!grid.freeBlock(gx, gz, 3, 3, false)) continue;
      let lo = Infinity, hi = -Infinity, s = 0, ok = true;
      for (let z = 0; z < 3 && ok; z++) {
        for (let x = 0; x < 3 && ok; x++) {
          const cx = gx + x, cz = gz + z;
          const [i, j] = superOf(lat, cx, cz);
          const who = sup.at(i, j);
          if (who !== NONE && who !== TOWN) { ok = false; break; }
          const h = terrain.heightAt(cx, cz);
          if (h < lo) lo = h;
          if (h > hi) hi = h;
          s += h + terrain.slope(cx, cz);
        }
      }
      if (!ok || hi - lo > QUARRY_RELIEF) continue;
      found.push({ block: [gx, gz], s: s - MINE_FAR * r, n: found.length });
    }
  }
  // Best first; a tie keeps the ring order, so the same block wins on every scan.
  return found.sort((a, b) => b.s - a.s || a.n - b.n).map((f) => f.block);
}

// The goldsmith: the free blocks of the town's lattice nearest the gold pit (`near`), within
// TRADE_RING of the square, off every lot of the town's plan - those are the shops', as the
// pit left them - and on ground that is the town's or nobody's. Nearest first, ties in the
// ring order, so the same block wins on every scan.
function goldsmithSites(grid, sup, lat, centre, near) {
  const plan = planCells(centre);
  const found = [];
  for (let r = 1; r <= TRADE_RING; r++) {
    for (const [dx, dz] of RINGS[r]) {
      const [gx, gz] = blockAt(centre, dx, dz);
      if (!grid.freeBlock(gx, gz, 3, 3, false)) continue;
      let ok = true;
      for (let z = 0; z < 3 && ok; z++) {
        for (let x = 0; x < 3 && ok; x++) {
          if (plan.has(`${gx + x},${gz + z}`)) { ok = false; break; }
          const [i, j] = superOf(lat, gx + x, gz + z);
          const who = sup.at(i, j);
          if (who !== NONE && who !== TOWN) ok = false;
        }
      }
      if (ok) found.push({ block: [gx, gz], d: dist2([gx + 1, gz + 1], near), n: found.length });
    }
  }
  return found.sort((a, b) => a.d - b.d || a.n - b.n).map((f) => f.block);
}

// ---- the lots at sea, and the ground that moves ----------------------------------------
// Water the polders must leave alone: the fairway, every zone, and every cell a ship or the
// yard stands on with the ring of cells round it - the ring because a polder's dike is the
// ring of cells round its super-cells, so a polder that came within one cell of a ship would
// wall her in or build its sea wall across her. The ladder (`planPolder`) and the planner's
// preview (lib/survey.mjs) both read it; a keeper's polder over a ship is refused by the check
// every dike already gets (`fairwayHeld`, which counts every plot).
export function keptWater(layout) {
  const out = new Set([...((layout.fairway && layout.fairway.cells) || []), ...zoneCells(layout)].map(ckey));
  // The harbour strip and a cell's ring round it, for the reason a ship has one: a polder's wall
  // is the ring of cells round its own and would lift the strip's edge.
  for (const k of havenKeys(layout, 1)) out.add(k);
  // Every dug channel and harbour, and the stone quay, with the ring round them too: a polder
  // over the harbour the quay was built for would wall its boats in.
  const w = layout.works;
  for (const c of [...((w && w.dig) || []).flatMap((d) => d.cells), ...((w && w.kade && w.kade.cells) || [])]) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) out.add(`${c[0] + dx},${c[1] + dz}`);
  }
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (!afloat(id)) continue;
    for (let z = -1; z <= p.d; z++) for (let x = -1; x <= p.w; x++) out.add(`${p.gx + x},${p.gz + z}`);
  }
  // The resort as it will grow, with its ring: a polder would wall its lagoon in.
  for (const k of resortKeep(layout)) out.add(k);
  return out;
}

// The water under a lot at sea that has to stay open sea for it to be what it is: all of a
// ship, the seaward rows of the yard.
function waterOf(id, p) {
  if (isShipId(id)) {
    const out = [];
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) out.push([p.gx + x, p.gz + z]);
    return out;
  }
  if (id === YARD_ID) return yardRows(p, YARD_LOT.d - YARD_WET, YARD_LOT.d);
  return null;
}

// The first ship or yard this ground has cut off from the sea, or null. A polder's wall can
// leave a ship in a pond without touching her - it closes the mouth of the bay she lies in,
// and its pools are then filled to the polder's height - which no rule about cells can see
// coming, so it is asked of the ground once the polder is dug: `reclaim` digs another polder
// instead, and the keeper's is refused (lib/plan.mjs).
export function afloatDrowned(layout, T) {
  for (const [id, p] of Object.entries(layout.plots || {})) {
    const cells = waterOf(id, p);
    if (cells && cells.some(([gx, gz]) => !openWater(T, gx, gz))) return id;
  }
  return null;
}

// What a growth ring turns to meadow among the lots at sea and the buildings facing it, asked
// of the ground as it would be (`doomedBy`): a ship whose water is no longer the rede's, a yard
// whose slipway's toe is no longer open sea, a building whose front no longer opens on the
// water. Each is placed again by the loop that placed it - on purpose, like the lighthouse.
function strandedAtSea(layout, T) {
  const out = [];
  const kade = new Set(((layout.works && layout.works.kade && layout.works.kade.cells) || []).map(ckey));
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (isShipId(id)) {
      const cells = waterOf(id, p);
      if (cells.some(([gx, gz]) => !(T.heightAt(gx, gz) < REDE_DEPTH) || !openWater(T, gx, gz))) out.push(id);
    } else if (id === YARD_ID) {
      if (waterOf(id, p).some(([gx, gz]) => !openWater(T, gx, gz))) out.push(id);
    } else if (id.startsWith('civic:') && FACES_WATER.has(id.slice('civic:'.length))) {
      // A door whose step is the stone quay is at the water, whatever lies under the step: the
      // warehouse stands behind the quay on purpose (kadeSite), and a ring must not move it.
      const [ox, oz] = outsideDoor(p.gx, p.gz, p.rot);
      if (!openWater(T, ox, oz) && !kade.has(`${ox},${oz}`)) out.push(id);
    }
  }
  return out;
}

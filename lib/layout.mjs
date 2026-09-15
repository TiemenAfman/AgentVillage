// Where everything stands. Two rules govern this file:
//   1. Deterministic  - the same village always produces the same town.
//   2. Sticky         - a building that already has a plot is never moved again,
//                       even if the algorithm below changes later.
// data/layout.json is therefore the source of truth; we only ever add to it.
//
// The ground is no longer derived here. `placeAll` is handed a **lot field** - the baked
// world seen in lots of four metres, from lib/world/lotfield.mjs - and everything below
// counts in lots. Every constant in this file keeps its number and means four times the
// metres it used to: PITCH 4 is a sixteen-metre super-cell, a 3x3 plot is twelve metres
// across, and the town square's 3/5/7 steps are 12, 20 and 28 m. That is the whole reason
// the unit is four and not some better-tuned number - it makes this a re-founding of the
// same algorithm rather than a rewrite of it.
import { makeRng } from '../shared/rng.mjs';
import { EARTHWORK_MAX, METRES_PER_LOT } from './world/lotfield.mjs';
import { readJson, writeJsonAtomic } from './paths.mjs';

export const LAYOUT_VERSION = 1;
// Houses, sheds, parcels and paths are re-planned when this changes; the terrain, the
// town square and everything civic are not. Bumping LAYOUT_VERSION instead would throw
// away the town, which is tied to the terrain and must never move.
export const PARCEL_VERSION = 1;
// Hamlet roads are re-routed when this changes, and nothing else is. They are the one
// piece of the layout that can be thrown away cheaply: pure derived geometry that no
// building stands on, which is why re-routing them needs a number of its own rather than
// a PARCEL_VERSION bump that would move every house to fix a road.
export const ROAD_VERSION = 2;

const FREE = 0, PLOT = 1, PATH = 2, BLOCKED = 3, SQUARE = 4, PIER = 5, RESERVED = 6, BRIDGE = 7;
const PITCH = 4;          // 3x3 plot + a one cell lane
const MAX_RING = 9;

// ---- hamlets ----------------------------------------------------------------
// Land is owned. Every project that has grown past a couple of sessions holds a parcel
// of super-cells (see `latticeOf`), and no parcel may touch another - the gap between
// them is the countryside, which is where the fields and the orchards go.
const NONE = -1, TOWN = -2;      // owner sentinels; a district uses its per-scan ordinal
const BELT = 1;                  // no super-cell may be 8-adjacent to anyone else's
export const MIN_HAMLET = 3;     // sessions before a project earns a green and a sign
const RCAP = 5;                  // hard lobe radius: worst case house-to-green is 5*4+2
const MAX_LOBES = 3;             // a boxed-in hamlet founds an annex rather than sprawl
const ANNEX_REACH = 8;           // and that annex stays within sight of the parcel it left
const SOFT = 1500;               // growth penalty for creeping up on a neighbour
const TOWN_CORE_R = 2;           // super-cells held by the town: plaza, civic lots, frontage
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

export function emptyLayout(seed, size) {
  return {
    v: LAYOUT_VERSION, parcelV: PARCEL_VERSION, seed, size, worldRev: null,
    lattice: null, districts: {}, plots: {}, paths: [], bridges: [], links: [], cleared: [], polders: [],
    landing: null, town: null,
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
  l.links = l.links || [];
  l.cleared = l.cleared || [];
  l.polders = l.polders || [];
  return migrateRoads(migrateParcels(l));
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
function migrateRoads(l) {
  if (l.roadV === ROAD_VERSION) return l;
  for (const d of Object.values(l.districts)) {
    for (const lobe of d.lobes || []) lobe.road = null;
  }
  l.paths = (l.paths || []).filter((p) => !String(p.id).startsWith('road:'));
  l.cleared = [];
  l.roadV = ROAD_VERSION;
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

class Grid {
  constructor(lots) {
    this.t = lots;
    this.size = lots.size;
    this.cells = new Uint8Array(this.size * this.size);
    for (let gz = 0; gz < this.size; gz++) {
      for (let gx = 0; gx < this.size; gx++) {
        if (!lots.isBuildable(gx, gz)) this.cells[gx + gz * this.size] = BLOCKED;
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
  // Free, and level enough to stand on. The second half is the one that changed with the
  // island: on ground with real relief, "every lot is buildable" says nothing about
  // whether a *building* fits across them. What decides that is how much earth has to
  // move to make one level platform, and that is a question about the block, not about
  // any lot in it. Measured on the new island a slope test left 25 plots where the
  // earthwork test finds 140 - the same ground, asked a question it can answer.
  //
  // The quay is exempt. It builds on the sandy shore, which `isBuildable` excludes
  // outright, so `earthwork` would hand back Infinity for every block it ever tries.
  freeBlock(gx, gz, w, d, allowBeach) {
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (!this.freeCell(gx + x, gz + z, allowBeach)) return false;
    if (!allowBeach && this.t.earthwork(gx, gz, w, d) > EARTHWORK_MAX) return false;
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
function latticeOf(layout) {
  if (!layout.lattice) {
    layout.lattice = { anchor: [layout.town.centre[0] - 1, layout.town.centre[1] - 1], pitch: PITCH };
  }
  return layout.lattice;
}
const blockOf = (lat, i, j) => [lat.anchor[0] + lat.pitch * i, lat.anchor[1] + lat.pitch * j];
const centreOfCell = (lat, c) => [lat.anchor[0] + lat.pitch * c[0] + 1, lat.anchor[1] + lat.pitch * c[1] + 1];
const superOf = (lat, gx, gz) => [
  Math.floor((gx - lat.anchor[0]) / lat.pitch),
  Math.floor((gz - lat.anchor[1]) / lat.pitch),
];

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const sd2 = (a, b) => { const i = a[0] - b[0], j = a[1] - b[1]; return i * i + j * j; };
const scheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
// Every comparison in this file is an integer tuple. Floats would make the layout depend
// on rounding, and Math.hypot is allowed to be approximated - neither may decide a plot.
function lessTuple(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
  return false;
}

// ---- polders, and why there are no new ones ---------------------------------
// The island's old escape valve. `gridSize` could not grow - it was the terrain's own
// argument, so raising it moved the coast, failed the `size` check in loadLayout and
// reset the town square - and by around three hundred houses the buildable blocks were
// gone and new projects stopped getting a hamlet at all. So the village took land off
// the water instead: a blob of super-cells, a dike around it, a causeway into town.
//
// The world is baked once over the whole envelope now and published a chunk at a time,
// so the island grows by publishing ground that was always there. That removes the
// problem polders answered, and with it the worst ordering dependency in this file: the
// terrain used to be rebuilt once per polder, and the hash had to be recorded *after*
// reclaiming or every scan would replant the island. All of that is gone.
//
// The two constants stay because the chronicle is written from them - scan.mjs dates a
// polder from its index - and because an island that reclaimed land before the
// re-founding still has it on record. Nothing reclaims any more.
export const POLDER_AT = 150;       // the first polder: the mill, and the land it drains
export const POLDER_EVERY = 25;     // one more for every this many settlers after that

const ckey = (c) => `${c[0]},${c[1]}`;

// ---- crossings: the island is an archipelago --------------------------------
// A district is a git repository, and the generator gives some of them an islet of their
// own - the green belt made physical. That only works if you can get there.
//
// The router already builds bridges: `crossingSpan` lets a road step over water and
// `markRoad` turns whatever it carried into a deck. What it will not do is *look* for a
// crossing - MAX_SPAN caps a leap at five lots, twenty metres, and raising that would have
// roads vaulting every bay on the island rather than following the shore. So a channel
// between two landmasses is decided here instead, once, and laid down as ground the router
// can then walk over like any other.
//
// Sticky, like everything else in this file: a crossing is laid in the life of an island
// exactly once, and `layout.links` is only ever appended to.
export const CAUSEWAY_MAX_M = 45;    // a bank of stone you walk over; beyond this it is a wall
export const BRIDGE_MAX_M = 110;     // a deck on piles; beyond this it wants a boat

/** Four-connected landmasses of the lot field, labelled. Sea is -1. */
function labelLandmasses(lots) {
  const size = lots.size;
  const label = new Int16Array(size * size).fill(-1);
  const area = [];
  let next = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (!lots.isLand(i, j) || label[i + j * size] >= 0) continue;
      const k = next++;
      const q = [[i, j]];
      label[i + j * size] = k;
      let n = 0;
      while (q.length) {
        const [a, b] = q.pop();
        n++;
        for (const [dx, dz] of N4) {
          const x = a + dx, z = b + dz;
          if (x < 0 || z < 0 || x >= size || z >= size) continue;
          if (!lots.isLand(x, z) || label[x + z * size] >= 0) continue;
          label[x + z * size] = k;
          q.push([x, z]);
        }
      }
      area.push(n);
    }
  }
  return { label, area, count: next };
}

/**
 * The shortest straight crossing between two landmasses, or null if there is none inside
 * `maxLots`. Straight and not merely shortest: a deck is built along an axis, and a
 * staircase of diagonal steps is a jetty falling over rather than a bridge. One lot of
 * skew is allowed so a channel that is not quite square still gets crossed.
 */
function shortestCrossing(coastA, coastB, maxLots) {
  let best = null;
  for (const a of coastA) {
    for (const b of coastB) {
      const dx = Math.abs(a[0] - b[0]), dz = Math.abs(a[1] - b[1]);
      const span = Math.max(dx, dz);
      if (span > maxLots) continue;
      // A deck may lean, but not much: up to a third of its length sideways, which is about
      // eighteen degrees off the axis it is built along. Demanding it be square cost more
      // than it bought - on seed 1337 one district's nearest square crossing was 116 m of
      // open water while the channel beside it was 52 m, so the island was written off as
      // unreachable to avoid building a slightly skewed bridge.
      if (Math.min(dx, dz) * 3 > span) continue;
      // Integer tuple, like every other comparison here: the span first, then the lots
      // themselves, so the same island always picks the same channel.
      const key = [span, a[0], a[1], b[0], b[1]];
      if (best === null || lessTuple(key, best.key)) best = { key, a, b, span };
    }
  }
  return best;
}

/** The lots a crossing covers, endpoints included. Near-straight, so this is a walk. */
function crossingCells(a, b) {
  const steps = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  const cells = [];
  for (let n = 0; n <= steps; n++) {
    const t = steps === 0 ? 0 : n / steps;
    cells.push([Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t)]);
  }
  return cells;
}

/**
 * Connect every landmass somebody lives on to the one the town stands on.
 *
 * Runs after the parcels are handed out, because until then nobody lives anywhere, and
 * before a single road is routed, because a road has to be able to walk the crossing. The
 * order crossings are laid in is shortest-first over the whole archipelago, so an islet
 * that is near a second islet is reached through it rather than by a longer leap from the
 * mainland - and because that order is decided by an integer tuple, the same island always
 * comes out wired the same way.
 */
function linkLandmasses(grid, layout, lots, needed) {
  const size = lots.size;
  const { label } = labelLandmasses(lots);
  const labelAt = (c) => (grid.in(c[0], c[1]) ? label[c[0] + c[1] * size] : -1);
  const main = labelAt(layout.town.centre);
  if (main < 0) return [];

  const coast = new Map();
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const l = label[i + j * size];
      if (l < 0) continue;
      let edge = false;
      for (const [dx, dz] of N4) if (!lots.isLand(i + dx, j + dz)) edge = true;
      if (!edge) continue;
      if (!coast.has(l)) coast.set(l, []);
      coast.get(l).push([i, j]);
    }
  }

  // What is already reachable: the mainland, and whatever the crossings of earlier scans
  // reach. Read back from the lots rather than from a stored label, because labels are
  // recomputed every scan and the lots are what is sticky.
  const connected = new Set([main]);
  for (const link of layout.links) {
    for (const end of [link.from, link.to]) {
      const l = labelAt(end);
      if (l >= 0) connected.add(l);
    }
  }

  const want = new Set();
  for (const c of needed) {
    const l = labelAt(c);
    if (l >= 0 && l !== main) want.add(l);
  }

  const maxLots = Math.ceil(BRIDGE_MAX_M / METRES_PER_LOT);
  const stranded = [];
  for (let guard = want.size; guard > 0; guard--) {
    let pick = null;
    for (const to of [...want].sort((a, b) => a - b)) {
      if (connected.has(to)) continue;
      for (const from of [...connected].sort((a, b) => a - b)) {
        const cross = shortestCrossing(coast.get(from) || [], coast.get(to) || [], maxLots);
        if (cross && (pick === null || lessTuple(cross.key, pick.cross.key))) pick = { cross, to };
      }
    }
    if (!pick) break;

    const cells = crossingCells(pick.cross.a, pick.cross.b);
    const water = cells.filter(([gx, gz]) => !lots.isLand(gx, gz));
    const lengthM = water.length * METRES_PER_LOT;
    layout.links.push({
      id: `link:${pick.cross.a[0]},${pick.cross.a[1]}-${pick.cross.b[0]},${pick.cross.b[1]}`,
      // A causeway is a bank of earth and a bridge is a deck on piles, and the difference
      // is real: one is ground you can build a hedge along, the other is not. The client
      // draws both as a deck today because the ground is baked and nothing can raise it
      // yet; recording which is which is what lets a causeway become earth later without
      // every island having to be re-wired.
      kind: lengthM <= CAUSEWAY_MAX_M ? 'causeway' : 'bridge',
      lengthM,
      axis: Math.abs(pick.cross.a[0] - pick.cross.b[0]) >= Math.abs(pick.cross.a[1] - pick.cross.b[1]) ? 'x' : 'z',
      from: pick.cross.a,
      to: pick.cross.b,
      cells: water,
    });
    connected.add(pick.to);
  }
  for (const l of want) if (!connected.has(l)) stranded.push(l);
  return stranded;
}

/** Lay every crossing on record into the cell grid, so a road may walk it. */
function applyLinks(grid, layout, lots) {
  for (const link of layout.links) {
    for (const [gx, gz] of link.cells) grid.set(gx, gz, BRIDGE);
    // The two feet of the crossing are its abutments: road, so a route can reach them even
    // when the shore they land on is beach and therefore BLOCKED.
    for (const end of [link.from, link.to]) {
      if (grid.in(end[0], end[1]) && lots.isLand(end[0], end[1]) && grid.get(end[0], end[1]) === BLOCKED) {
        grid.set(end[0], end[1], PATH);
      }
    }
  }
}

// ---- an islet per repository -------------------------------------------------
// The green belt made physical. `BELT` already insists that no two parcels touch and calls
// the gap between them countryside; putting a district on a rock of its own makes that gap
// water, which is the most permanent separation the island has to offer. It is also what the
// archipelago is *for*: the skerries are baked at founding and published one at a time as the
// village grows (`lib/world/growth.mjs`), and a rock nobody lives on is scenery.
//
// The islet a district holds is recorded in `layout.districts[id].islet` and is as sticky as
// a plot: the number is the skerry index from `shape.mjs`, which is a fixed lattice position
// and therefore means the same thing whatever else is above water.
//
// This turns one islet - named by a point on it - into the super-cells a parcel may use. The
// test is the 3x3 plot rather than the whole super-cell, for the same reason `Super` asks it
// that way: a lane running onto the beach is not a reason to write off a building site.
function isletGround(lots, sup, lat, islets) {
  const out = new Map();
  if (!islets || !islets.length) return out;
  const size = lots.size;
  const { label } = labelLandmasses(lots);
  const labelAt = (lx, lz) => (lx >= 0 && lz >= 0 && lx < size && lz < size ? label[lx + lz * size] : -1);

  for (const isl of islets) {
    // The centroid of a horseshoe-shaped islet falls in its own lagoon, so the point is a
    // hint: walk outward until it is standing on something.
    let lbl = labelAt(isl.at[0], isl.at[1]);
    for (let r = 1; lbl < 0 && r <= MAX_RING; r++) {
      for (const [dx, dz] of RINGS[r]) {
        const l = labelAt(isl.at[0] + dx, isl.at[1] + dz);
        if (l >= 0) { lbl = l; break; }
      }
    }
    if (lbl < 0) continue;
    const cells = new Set();
    for (const [i, j] of sup.free) {
      const [gx, gz] = blockOf(lat, i, j);
      let all = true;
      for (let z = 0; z < 3 && all; z++) {
        for (let x = 0; x < 3; x++) if (labelAt(gx + x, gz + z) !== lbl) { all = false; break; }
      }
      if (all) cells.add(`${i},${j}`);
    }
    if (cells.size) out.set(isl.index, cells);
  }
  return out;
}

class Super {
  // `held` is ground that exists but is not for sale: the dike and the causeway of a
  // polder. Raised flat land is buildable as far as the terrain is concerned, so without
  // this a hamlet would happily put a house on top of its own sea wall.
  constructor(lots, lat, held) {
    this.lat = lat;
    this.R = Math.ceil(lots.size / lat.pitch) + 1;
    this.n = 2 * this.R + 1;
    const n2 = this.n * this.n;
    this.build = new Uint8Array(n2);      // all sixteen lots buildable
    this.beach = new Uint8Array(n2);      // all sixteen on land and gentle - the quay only
    this.slope = new Uint16Array(n2);     // mean slope x 1000, so it stays an integer
    this.held = held || null;
    // Super-cells spoken for by a district's islet. Filled in once the archipelago has been
    // handed out; until then nothing is reserved and nothing may be, because that is the
    // decision being made.
    this.reserved = null;
    this.owner = new Int16Array(n2).fill(NONE);
    // Ground worth ever looking at again: the super-cells that are land. On a 1024 m
    // envelope there are 17,161 super-cells and the island covers perhaps 1,600 of them,
    // so the other 94% are open sea that no seed can ever be picked from. `pickSeed` used
    // to walk the whole square once per rung of its ladder; it walks this instead.
    this.free = [];
    for (let j = -this.R; j <= this.R; j++) {
      for (let i = -this.R; i <= this.R; i++) {
        const [gx, gz] = blockOf(lat, i, j);
        let build = 1, beach = 1, sum = 0;
        for (let z = 0; z < lat.pitch; z++) {
          for (let x = 0; x < lat.pitch; x++) {
            const cx = gx + x, cz = gz + z;
            const kept = held && held.has(`${cx},${cz}`);
            // The plot is the 3x3 at the corner of the block; the fourth row and column
            // are the lane. Demanding all sixteen lots was free on a flat island and is
            // not on this one - it threw away 278 of 532 super-cells that hold a perfectly
            // good house, because one corner of the lane ran onto the beach or a bank. So
            // the question is asked of the ground a building actually stands on.
            const onPlot = x < 3 && z < 3;
            if (onPlot && (kept || !lots.isBuildable(cx, cz))) build = 0;
            if (kept || !lots.isLand(cx, cz) || lots.slope(cx, cz) >= 0.8) beach = 0;
            sum += lots.slope(cx, cz);
          }
        }
        // And level enough to terrace, which is the same question `freeBlock` asks later.
        // Answering it here as well is what keeps a district from claiming a parcel of
        // cliff face and then finding it has nowhere to put the houses.
        if (build && lots.earthwork(gx, gz, 3, 3) > EARTHWORK_MAX) build = 0;
        const o = this.di(i, j);
        this.build[o] = build;
        this.beach[o] = beach;
        this.slope[o] = Math.min(65535, Math.round((sum / (lat.pitch * lat.pitch)) * 1000));
        if (build || beach) this.free.push([i, j]);
      }
    }
    // Row-major already, so the order is the same one the old square scan visited in -
    // which matters, because ties in pickSeed are broken by (j, i) and a different visit
    // order would hand the same village a different seed.
    this._dirty = false;
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
  // `within` is the one landmass a district may settle on, as a set of super-cell keys: see
  // "an islet per repository" above. Null everywhere else, which is the mainland's answer to
  // the same question - the whole island, less whatever rocks have owners (`reserved`).
  eligible(i, j, k, allowBeach, within = null) {
    const key = `${i},${j}`;
    if (within) { if (!within.has(key)) return false; }
    else if (this.reserved && this.reserved.has(key)) return false;
    if (!this.usable(i, j, allowBeach)) return false;
    if (this.owner[this.di(i, j)] !== NONE) return false;
    return !this.foreignWithin(i, j, BELT, k);
  }
  clearOf(i, j, r) { return !this.foreignWithin(i, j, r, NONE - 1000); }   // nobody at all nearby
  // How much room a seed really has: a flood fill of eligible cells within the radius,
  // stopped as soon as it has seen enough. A square window would happily hand a big
  // hamlet a three-cell ledge on the coast.
  capacity(i, j, r, cap, k, allowBeach, within = null) {
    if (!this.eligible(i, j, k, allowBeach, within)) return 0;
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
        if (!this.eligible(c[0], c[1], k, allowBeach, within)) continue;
        seen.add(key); q.push(c);
      }
    }
    return n;
  }
  /// Drop the super-cells that have been claimed since the last sweep, so the candidate
  /// list shrinks as the island fills instead of staying the size it was on day one.
  compact() {
    if (!this._dirty) return;
    this.free = this.free.filter(([i, j]) => this.owner[this.di(i, j)] === NONE);
    this._dirty = false;
  }
  claim(i, j, k, grid) {
    this.owner[this.di(i, j)] = k;
    this._dirty = true;
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
function growParcel(sup, lobe, k, tg, allowBeach, grid, within = null) {
  const rr = radiusOf(tg);
  while (lobe.cells.length < tg) {
    const cand = new Map();
    for (const [ci, cj] of lobe.cells) {
      for (const [di, dj] of N4) {
        const a = ci + di, b = cj + dj;
        if (scheb([a, b], lobe.seed) > rr) continue;
        if (!sup.eligible(a, b, k, allowBeach, within)) continue;
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

// Where a new hamlet settles. Five rungs rather than one rule: full clearance with room
// to grow, full clearance, one ring of clearance, farmstead-sized room, anywhere legal.
// The last rung puts late arrivals on the far coast, which is where the free basins are,
// so a satellite hamlet needs no special case.
const SEED_LADDER = [[2, 1.25], [2, 1.0], [1, 1.0], [1, 0.35], [0, 0.0]];
// A lone farm is one house in the countryside. Asking it to keep two rings of clearance
// carves 400 cells of island out for a single session, and after nineteen of those the
// real hamlets have nowhere left to settle - measured.
const FARM_LADDER = [[1, 1.0], [0, 0.0]];

function pickSeed(sup, tg, { allowBeach = false, near = null, k = -99, maxFrom = 0, ladder = SEED_LADDER, within = null } = {}) {
  const rr = radiusOf(tg);
  const anchor = near || [0, 0];
  // Over the land, not over the envelope. The square scan this replaces cost R^2 per rung
  // of the ladder - 1,225 cells on the old 64 m island, but 17,161 on a 1024 m one, and a
  // scan that founds thirty hamlets would have walked that five times each. The list is
  // the land only, and it gets shorter every time a district takes a super-cell.
  sup.compact();
  for (const [clear, slack] of ladder) {
    let best = null, bk = null;
    for (const [i, j] of sup.free) {
      if (maxFrom && scheb([i, j], anchor) > maxFrom) continue;
      if (!sup.eligible(i, j, k, allowBeach, within)) continue;
      if (clear && !sup.clearOf(i, j, clear)) continue;
      const need = Math.max(1, Math.ceil(tg * slack));
      const room = sup.capacity(i, j, rr, need, k, allowBeach, within);
      if (room < need) continue;
      const key = [-(room * 100) + 90 * scheb([i, j], anchor) + sup.slope[sup.di(i, j)], j, i];
      if (bk === null || lessTuple(key, bk)) { bk = key; best = [i, j]; }
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
function ensureParcel(sup, rec, pop, { k, allowBeach, near, grid, lat, within = null }) {
  const capacity = () => rec.lobes.reduce((a, l) => a + l.cells.length - (l.green ? 1 : 0), 0);
  const tg = parcelTarget(pop);

  if (!rec.lobes.length) {
    const seed = pickSeed(sup, tg, { allowBeach, near, k, within });
    if (!seed) { rec.guest = true; return; }
    sup.claim(seed[0], seed[1], k, grid);
    rec.lobes.push(newLobe(lat, seed));
  }

  let guard = 0;
  while (capacity() < pop && guard++ < 16) {
    const last = rec.lobes[rec.lobes.length - 1];
    const spentByOthers = capacity() - (last.cells.length - (last.green ? 1 : 0));
    const want = Math.max(tg - spentByOthers, last.cells.length + (pop - capacity()));
    if (growParcel(sup, last, k, want, allowBeach, grid, within)) continue;
    if (capacity() >= pop) break;
    if (rec.lobes.length >= MAX_LOBES) break;
    // An annex is the next hamlet along the same lane, so it is leashed to the parcel it
    // grew out of. Without the leash a boxed-in project scattered single cells across the
    // island - three "hamlets" of one house each, one of them on the opposite coast.
    //
    // `within` is deliberately dropped here, and only here. A hamlet on an islet keeps its
    // core on its own rock, but if it outgrows it - the rocks on this island are 0.46 to
    // 1.14 ha, four to twenty-two super-cells, and the biggest project has twenty-three
    // houses - it annexes ashore rather than turning half its settlers into lodgers on the
    // commons. ANNEX_REACH still leashes it to eight super-cells, and the channel is 21 to 36 m,
    // so the annex lands on the coast facing its own islet.
    const seed = pickSeed(sup, parcelTarget(pop - capacity()), { allowBeach, near: last.seed, k, maxFrom: ANNEX_REACH });
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
function facing(plotCentre, target) {
  const dx = target[0] - plotCentre[0], dz = target[1] - plotCentre[1];
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 1 : 3;
  return dz >= 0 ? 2 : 0;
}
function doorCell(gx, gz, rot) {
  if (rot === 0) return [gx + 1, gz];
  if (rot === 1) return [gx + 2, gz + 1];
  if (rot === 2) return [gx + 1, gz + 2];
  return [gx, gz + 1];
}
function outsideDoor(gx, gz, rot) {
  if (rot === 0) return [gx + 1, gz - 1];
  if (rot === 1) return [gx + 3, gz + 1];
  if (rot === 2) return [gx + 1, gz + 3];
  return [gx - 1, gz + 1];
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
const REUSE = 0.04;       // a cell that is already road, or an existing bridge
const TURN = 0.9;         // changing direction
const SLOPE = 3;          // per unit of slope
// A fresh cell of deck. A river never quite severs the island - you can always walk
// around its head - so this is not a wall but a price: a three cell crossing is worth
// building once the way round is more than about twenty cells of road, and never for the
// sake of a shortcut. An existing crossing costs REUSE instead, so it is always the
// cheaper answer, which is what makes hamlet after hamlet come over the same bridge.
const SPAN = 8;
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
    if (grid.t.isWet(x, z)) wet = true;
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

// `zone` masks the search to one parcel, so a front path can only reach its own hamlet's
// green and the braiding happens locally - a lane network inside the hamlet instead of
// forty threads crawling across the countryside. `isGoal` lets the hamlet's own road
// leave, by refusing to accept the green it started next to.
function routePath(grid, from, { zone = null, zoneId = 0, isGoal = null, budget = 40000, bridge = false } = {}) {
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
      if (zone && zone[ncell] !== zoneId) continue;
      const nc = c
        + (fresh ? SPAN : nv === PATH || nv === SQUARE || nv === BRIDGE ? REUSE : 1)
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
function markPath(grid, layout, id, cells) {
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
  if (fresh.length) layout.paths.push({ id, cells: fresh });
}

// The same, for a route that was allowed to cross water. Everything the route carried
// over the gorge becomes a bridge and is written into the layout, so it is there on the
// next scan whoever laid it; the rest is road as usual. A run the route only walked over
// - somebody else's bridge - is left alone, exactly as a shared stretch of road is.
function markRoad(grid, layout, id, cells) {
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

// Where each kind of furniture stands, as offsets from the town centre, in the order
// it is put out. Lamps take the corners, benches the middle of each side, flower beds
// the stretches between them, terraces the outer corners near the frontage. Scattering
// them by whatever cell happened to be free is what made the square look littered.
const FURNITURE_SPOTS = {
  planter: [[-1, -2], [1, 2], [2, -1], [-2, 1], [-1, 3], [1, -3], [3, 2], [-3, -2]],
  lamp: [[-3, -3], [3, -3], [-3, 3], [3, 3], [-3, 2], [3, -2]],
  bench: [[-3, -1], [3, 1], [-3, 1], [3, -1], [-1, -3]],
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
// offsets from the town centre so they keep their place when the square grows. The
// sprint board holds the middle.
const ON_SQUARE = { fountain: [0, 0], well: [-2, -2], statue: [2, -2], tables: [-2, 2] };
// Civic types that take a single cell instead of a full three by three lot.
const SMALL = new Set(['well', 'tables', 'fountain', 'statue', 'lighthouse', 'windmill', 'poldermill']);

// ---- what the town paves -----------------------------------------------------
// The two pieces of ground the village lays stone on, as geometry and nothing else: the
// square around its centre, and a ring one cell deep in front of every civic building
// near it. Both are walked twice - once on the way down, to reserve the ground, and once
// at the end to read `town.paved` back off the finished layout - so the shape of each
// lives here rather than inline at either of the two places.
const FRONTAGE_REACH = 6;

function squareCells(layout) {
  const [cx, cz] = layout.town.centre;
  const half = ((layout.town.size || 3) - 1) / 2;
  const out = [];
  for (let gz = cz - half; gz <= cz + half; gz++) for (let gx = cx - half; gx <= cx + half; gx++) out.push([gx, gz]);
  return out;
}

// A pavement one cell deep in front of every civic building, so the square reaches the
// doorsteps instead of leaving a strip of grass between the stone and the walls. This is
// what stops the centre reading as buildings scattered near a patio, and it is how the
// centre keeps growing once the square itself has stopped. Only the buildings near the
// middle: a lighthouse on the far shore does not pave a plaza around itself.
function frontageCells(layout) {
  const [cx, cz] = layout.town.centre;
  const out = [];
  for (const [id, p] of Object.entries(layout.plots)) {
    if (!id.startsWith('civic:') || p.w !== 3) continue;
    if (Math.abs(p.gx + 1 - cx) > FRONTAGE_REACH || Math.abs(p.gz + 1 - cz) > FRONTAGE_REACH) continue;
    for (let gz = p.gz - 1; gz <= p.gz + 3; gz++) {
      for (let gx = p.gx - 1; gx <= p.gx + 3; gx++) {
        if (gx === p.gx - 1 || gx === p.gx + 3 || gz === p.gz - 1 || gz === p.gz + 3) out.push([gx, gz]);
      }
    }
  }
  return out;
}

// The paving, read off the finished layout rather than collected cell by cell as the
// stone goes down. The difference is the whole point. Both blocks above lay their stone
// before the civic quarter is complete, and a one-cell plot - the sprint board, the
// island's board, a well on the square - is written into `layout.plots` without ever
// being stamped on the grid. So on the scan that founded one the cell was still free and
// was paved, and on the next scan the replay at the top of placeAll had marked it PLOT
// and that same block skipped it: a layout.json rewritten for nothing, one scan after
// every founding. Asking the finished layout is a question about what stands there, not
// about what had happened yet, so it has the same answer on every scan.
//
// What stands on the stone does not lift it. A well, a board, a lamp or a bench takes a
// single cell and keeps the pavement under its feet - which is also how the square
// looked on the scan that founded them. Ground that is built on is not paving: a three
// by three lot, a shed in somebody's yard, a pier, a reserved lot, water.
function pavedCells(grid, lots, layout) {
  const foot = new Set(), built = new Set();
  for (const [id, p] of Object.entries(layout.plots)) {
    if (p.w === 1 && p.d === 1 && !id.startsWith('shed:')) foot.add(`${p.gx},${p.gz}`);
    else for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) built.add(`${p.gx + x},${p.gz + z}`);
  }
  const out = [], seen = new Set();
  for (const [gx, gz] of [...squareCells(layout), ...frontageCells(layout)]) {
    const k = `${gx},${gz}`;
    if (seen.has(k)) continue;
    const stone = grid.get(gx, gz) === SQUARE
      || (foot.has(k) && !built.has(k) && lots.isBuildable(gx, gz));
    if (!stone) continue;
    seen.add(k);
    out.push([gx, gz]);
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

// Start again on new ground. The caller holds this object, so it is emptied in place
// rather than replaced. What went before is kept as a note - the one time this matters is
// the re-founding, when a village that already stood somewhere moves to the baked island,
// and the chronicle should be able to say so.
function resetForNewTerrain(layout, seed, size, worldRev) {
  const previous = layout.plots
    ? { worldRev: layout.worldRev || null, size: layout.size, plots: Object.keys(layout.plots).length, town: layout.town || null }
    : null;
  const fresh = emptyLayout(seed, size);
  for (const k of Object.keys(layout)) delete layout[k];
  Object.assign(layout, fresh);
  layout.worldRev = worldRev;
  // What the village left behind, so the chronicle can say something true about the day
  // it moved instead of quietly pretending it was always here.
  if (previous && previous.plots > 0) {
    layout.refoundedAt = new Date().toISOString();
    layout.previous = previous;
  }
}

/**
 * @param {object}  layout  the sticky record, updated in place
 * @param {object}  model   the village model (settlers, districts, buildings)
 * @param {object}  opts
 * @param {object}  opts.lots      a lot field from lib/world/lotfield.mjs
 * @param {string}  opts.worldRev  the revision of the baked world that field came from
 * @param {Array<{index: number, at: [number, number]}>} [opts.islets]  the islets that are
 *        above water, from `isletSpecs` in lib/world/growth.mjs. Empty is the whole of the
 *        old behaviour: every district settles wherever `pickSeed` finds room.
 */
// Why a building ended up with nowhere to stand. Silent unless PH_DEBUG is set: a scan
// that leaves anyone homeless is worth investigating, and "76 unplaced" on its own says
// nothing about whether the island is full or the district is.
function homeless(what, id, district) {
  if (!process.env.PH_DEBUG) return;
  process.stderr.write(`  ${what} ${id}${district ? ` district=${district}` : ''}\n`);
}

export function placeAll(layout, model, { lots, seed, worldRev, islets = [] } = {}) {
  if (!lots) throw new Error('placeAll needs a lot field: the ground is baked, not derived');
  const size = lots.size;
  // The ground changed under a layout that was planned on different ground. `loadLayout`
  // cannot see this: it compares `v`, `seed` and `size`, and a re-baked world can leave
  // all three alone while moving every coastline. Left be, each house would keep the plot
  // the old island gave it and some would stand in the water - measured once, when the
  // rivers were first cut: fourteen houses in a river and not one bridge. So a changed
  // world is treated exactly as a changed seed. A missing revision is a mismatch and not
  // a free pass, which is also what re-founds the village onto the new island the first
  // time this runs. A fresh layout is empty, so resetting it costs nothing.
  if (layout.worldRev !== worldRev) resetForNewTerrain(layout, seed, size, worldRev);
  layout.bridges = layout.bridges || [];
  layout.links = layout.links || [];
  const grid = new Grid(lots);
  const centre = [size / 2, size / 2];
  const unplaced = [];

  // ---- where the town is ---------------------------------------------------------
  // First of all, and on its own, because the super-lattice is anchored on the town
  // centre. On a village that already has a town this is a no-op; on a brand-new one
  // there is nothing else on the island yet for it to disturb. The paving is left to the
  // square-growth block further down, which lays these same lots and records them.
  if (!layout.town) {
    const sq = flattestBlock(grid, centre[0] - 1, centre[1] - 1, { w: 3, d: 3 });
    if (!sq) throw new Error('no flat ground for the town square');
    layout.town = { square: sq, centre: [sq[0] + 1, sq[1] + 1] };
  }

  // Ground an old polder made: walkable, never settled. Nothing reclaims any more, but a
  // layout from before the re-founding can still carry a dike on record, and forcing
  // those lots to PATH is what keeps a house off the top of a sea wall.
  const held = new Set();
  for (const p of layout.polders || []) {
    for (const c of [...(p.dike || []), ...(p.road || [])]) held.add(`${c[0]},${c[1]}`);
  }
  for (const k of held) { const [gx, gz] = k.split(',').map(Number); grid.set(gx, gz, PATH); }

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
  // A bridge stands over water, which the grid calls BLOCKED, so it is put back before
  // anything is routed. From here on it is a cell a road may walk over for almost
  // nothing, which is what makes the next hamlet cross where the last one did.
  for (const b of layout.bridges) for (const [gx, gz] of b.cells) grid.set(gx, gz, BRIDGE);
  applyLinks(grid, layout, lots);

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
    layout.town.square = [townCentre[0] - half, townCentre[1] - half];
    for (const [gx, gz] of squareCells(layout)) {
      const v = grid.get(gx, gz);
      if (v === PLOT || v === BLOCKED || v === PIER || v === RESERVED) continue;
      grid.set(gx, gz, SQUARE);
    }
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

  // The sprint board stands in the middle of the town square, where everyone passes.
  if (!layout.plots['civic:board']) {
    // On the square, but on a corner of it: dead centre is where the fountain goes,
    // and a board standing there is something you have to walk around all day.
    const c = layout.town.centre;
    const at = [c[0] + 2, c[1] + 2];
    layout.plots['civic:board'] = { gx: at[0], gz: at[1], w: 1, d: 1, rot: facing(at, c) };
  }

  // The island's own board faces it from the opposite corner: the work of the village
  // on one side, the work on the village itself on the other.
  if (!layout.plots['civic:issues']) {
    const c = layout.town.centre;
    const at = [c[0] - 2, c[1] + 2];
    layout.plots['civic:issues'] = { gx: at[0], gz: at[1], w: 1, d: 1, rot: facing(at, c) };
  }

  if (!layout.landing) {
    const beach = nearestCell(lots.beachCells.length ? lots.beachCells : lots.coastCells, townCentre);
    layout.landing = beach || null;
  }

  // ---- the land register -----------------------------------------------------
  // Everything a district already owns is replayed onto the super-grid first, so land is
  // as sticky as the buildings standing on it: a parcel only ever grows.
  const lat = latticeOf(layout);
  const sup = new Super(lots, lat, held);
  const districts = [...model.districts].sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.id.localeCompare(b.id));
  const ordOf = new Map(districts.map((d, k) => [d.id, k]));
  const popOf = new Map(districts.map((d) => [d.id, d.population]));

  for (let j = -TOWN_CORE_R; j <= TOWN_CORE_R; j++) {
    for (let i = -TOWN_CORE_R; i <= TOWN_CORE_R; i++) if (sup.in(i, j)) sup.claim(i, j, TOWN, null);
  }
  layout.town.commons = layout.town.commons || [];
  for (const [i, j] of layout.town.commons) if (sup.in(i, j)) sup.claim(i, j, TOWN, null);
  for (const [id, rec] of Object.entries(layout.districts)) {
    const k = ordOf.has(id) ? ordOf.get(id) : TOWN;
    for (const lobe of rec.lobes || []) for (const [i, j] of lobe.cells) sup.claim(i, j, k, grid);
  }

  // ---- who gets an islet -----------------------------------------------------
  // Before the commons is grown and long before a single hamlet is seeded, because the
  // answer decides which ground the rest of the island may not touch.
  //
  // In **arrival order**, not in seeding order: which rock a project ends up on is a fact
  // about the project, and a later scan that finds one of them has grown must not be able to
  // shuffle the archipelago. `districts` is sorted on firstSeenAt, which is the same ordinal
  // the district routes and paints by. Assignment happens once, the moment a project earns a
  // hamlet, and lives on the district record from there on.
  //
  // A quay is exempt: its parcel has to reach the planks it laid on the mainland shore. So is
  // a lone farmstead - one session does not need a private island, and there are fewer rocks
  // than there are projects.
  const isletLand = isletGround(lots, sup, lat, islets);
  const isletOf = new Map();
  for (const [id, rec] of Object.entries(layout.districts)) {
    if (Number.isInteger(rec.islet) && isletLand.has(rec.islet)) isletOf.set(id, rec.islet);
  }
  {
    const claimed = new Set(isletOf.values());
    // How many super-cells of this rock this district could actually take, counted no further
    // than it needs to know.
    const roomOn = (cells, k, need) => {
      let n = 0;
      for (const key of cells) {
        const [i, j] = key.split(',').map(Number);
        if (sup.eligible(i, j, k, false) && ++n >= need) break;
      }
      return n;
    };
    for (const d of districts) {
      if (isletOf.has(d.id) || d.kind === 'quay') continue;
      if (tierOf(d.population) === 'farmstead') continue;
      const rec = layout.districts[d.id];
      if (rec && rec.lobes && rec.lobes.length) continue;      // already settled: nothing moves
      // A rock holds a hamlet, not a town. These are 0.46 to 1.14 ha and carry four to
      // twenty-two super-cells; the biggest project on the real island has twenty-three
      // houses. Handing it an islet anyway costs measurably, because a district cut off by
      // water cannot spread into the countryside next door: at 100 settlers it took the
      // homeless from 8 to 31, at 300 from 176 to 203. So a project only gets a rock it fits
      // on. Measured again on the sixteen-rock archipelago: 0/3/188 unplaced at 50/100/300
      // settlers with five districts offshore, against 0/2/162 with nobody offshore at all -
      // the rocks pay for themselves up to a hundred settlers and cost at three hundred,
      // which is a village four times the size of the one this island has.
      //
      // One super-cell per house, and not `parcelTarget` - a hamlet on an islet gives up its
      // kitchen gardens before it gives up its island, and demanding the full target with its
      // garden slack left only one district in twelve on an islet at all. Measured over
      // 50/100/300 settlers this is the rule that separates the most projects for the least
      // homelessness: 3/2/4 districts offshore for 0/12/186 unplaced, against 0/8/176 with
      // nobody offshore at all.
      //
      // Somebody else's parcel may also already have spilled across the channel onto a rock
      // in an earlier life of the island - which is the very thing this replaces. Land is
      // sticky, so that one is lost; take the next one. Asking here rather than in the
      // seeding loop is what keeps the answer the same on every scan.
      const need = d.population;
      for (const isl of islets) {
        if (claimed.has(isl.index) || !isletLand.has(isl.index)) continue;
        if (roomOn(isletLand.get(isl.index), ordOf.get(d.id), need) < need) continue;
        isletOf.set(d.id, isl.index);
        claimed.add(isl.index);
        break;
      }
    }
  }
  const isletWithin = (id) => (isletOf.has(id) ? isletLand.get(isletOf.get(id)) : null);
  // An islet belongs to the repository it was given to. Without this the commons, or simply
  // the biggest hamlet - seeded first - would reach across a 26 m channel, take the rock, and
  // the district it was meant for would find it occupied. Super-cells are 16 m, so the
  // lattice is perfectly happy to step over the water even though nobody could walk it.
  sup.reserved = new Set();
  for (const k of isletOf.values()) for (const key of isletLand.get(k)) sup.reserved.add(key);

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
      const seed = pickSeed(sup, Math.max(1, d.population), { allowBeach, k, ladder: FARM_LADDER });
      if (seed) {
        sup.claim(seed[0], seed[1], k, grid);
        const lobe = { seed, cells: [seed], green: 0, square: null, centre: centreOfCell(lat, seed), paved: [], road: null };
        growParcel(sup, lobe, k, Math.max(1, d.population), allowBeach, grid);
        rec.lobes.push(lobe);
      }
      rec.guest = !rec.lobes.length;
    }
    if (tier === 'farmstead') {
      // Both fields unconditionally, even for a guest with no land of its own. Set only
      // inside the `lobes.length` branch, the record came out of its first scan without
      // them and the greens-retirement loop at the top of placeAll stamped them on during
      // the *next* one - so a brand-new island rewrote layout.json once more than it had
      // to. Nothing moved, but "two consecutive scans are byte-identical" was not true.
      rec.square = null;
      rec.paved = [];
      // no green and no sign, but a farmstead with land is still a place
      if (rec.lobes.length) rec.centre = rec.lobes[0].centre;
      layout.districts[d.id] = rec;
      continue;
    }

    // The quay picks its shore and its planks first; its parcel then has to reach them.
    let near = null;
    if (d.kind === 'quay' && !rec.pier.length) {
      const coast = [...lots.coastCells].sort((a, b) => dist2(a, townCentre) - dist2(b, townCentre));
      let bestScore = -Infinity, bestShore = null, bestPier = null;
      for (const c of coast.slice(0, 200)) {
        const dir = seawardDirection(lots, c);
        if (!dir) continue;
        const score = dir.n * 1.6 - Math.sqrt(dist2(c, townCentre)) * 0.5;
        if (score > bestScore) { bestScore = score; bestShore = c; bestPier = pierCells(lots, c, dir.d); }
      }
      if (bestShore) {
        rec.shore = bestShore; rec.pier = bestPier;
        for (const [gx, gz] of bestPier) grid.set(gx, gz, PIER);
      }
    }
    if (rec.shore) near = superOf(lat, rec.shore[0], rec.shore[1]);

    // On its own rock if it has one. `near` is dropped with it: the anchor pulls a seed
    // towards the town, and there is exactly one landmass to choose from anyway.
    const within = isletWithin(d.id);
    ensureParcel(sup, rec, d.population, { k, allowBeach, near: within ? null : near, grid, lat, within });
    if (within && !rec.lobes.length) {
      // The rock turned out to hold nothing this district could stand on - too steep, or
      // already taken by a neighbour whose parcel reached it first. Hand it back and settle
      // ashore like any other hamlet, rather than leaving the whole project lodging in town.
      const freed = isletOf.get(d.id);
      isletOf.delete(d.id);
      delete rec.islet;
      if (process.env.PH_DEBUG) process.stderr.write(`  islet ${freed} had no room for ${d.id}\n`);
      ensureParcel(sup, rec, d.population, { k, allowBeach, near, grid, lat });
    } else if (isletOf.has(d.id)) {
      rec.islet = isletOf.get(d.id);
    }

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
    // Both fields unconditionally, for the same reason the farmstead branch above says so:
    // a hamlet that got no land of its own came out of its first scan without them, and the
    // greens-retirement loop at the top of placeAll stamped them on during the next one. On
    // the old flat island every hamlet got land and the path was never walked; on ground
    // with real relief a guest hamlet is ordinary, and a brand-new island rewrote
    // layout.json one more time than it had to.
    rec.square = null;
    rec.paved = [];
    if (rec.lobes.length) rec.centre = rec.lobes[0].centre;
    layout.districts[d.id] = rec;
  }

  // Which parcel each cell belongs to, for the masked routing further down. Parcels are
  // disjoint and the belts belong to nobody, so this is never ambiguous.
  const zone = new Int16Array(size * size).fill(NONE);
  const paintZone = (cells, k) => {
    for (const [i, j] of cells) {
      const [gx, gz] = blockOf(lat, i, j);
      for (let z = 0; z < lat.pitch; z++) {
        for (let x = 0; x < lat.pitch; x++) {
          if (grid.in(gx + x, gz + z)) zone[(gx + x) + (gz + z) * size] = k;
        }
      }
    }
  };
  paintZone(layout.town.commons, TOWN);
  for (const [id, rec] of Object.entries(layout.districts)) {
    const k = ordOf.has(id) ? ordOf.get(id) : TOWN;
    for (const lobe of rec.lobes || []) paintZone(lobe.cells, k);
  }

  // ---- crossings ---------------------------------------------------------------
  // Here, and not earlier: until the parcels are handed out nobody lives on an islet, and
  // a crossing to an empty rock is a bridge to nowhere. And not later either - every road
  // below has to be able to walk what this lays down.
  {
    const needed = [layout.town.centre];
    for (const rec of Object.values(layout.districts)) {
      for (const lobe of rec.lobes || []) {
        for (const cell of lobe.cells) needed.push(blockOf(lat, cell[0], cell[1]));
      }
    }
    const before = layout.links.length;
    const stranded = linkLandmasses(grid, layout, lots, needed);
    if (layout.links.length > before) applyLinks(grid, layout, lots);
    if (stranded.length && process.env.PH_DEBUG) {
      process.stderr.write(`  ${stranded.length} landmass(es) too far to reach from town\n`);
    }
  }

  // ---- civic milestones ------------------------------------------------------
  for (const m of model.milestones) {
    if (!m.unlocked) continue;
    const id = `civic:${m.civicType}`;
    if (layout.plots[id]) continue;
    let block = null;
    if (ON_SQUARE[m.civicType]) {
      const [ox, oz] = ON_SQUARE[m.civicType];                                            // on the square itself
      block = [townCentre[0] + ox, townCentre[1] + oz];
    } else if (m.civicType === 'lighthouse') {
      const c = nearestCell(lots.coastCells.filter(([gx, gz]) => grid.freeBlock(gx, gz, 1, 1, true)), farthestFrom(lots.coastCells, townCentre) || townCentre);
      block = c ? [c[0], c[1]] : null;
    } else if (m.civicType === 'poldermill') {
      // On the dike of the first polder, facing the water it drains. The cell nearest
      // town, so the mill reads as belonging to the village rather than to the sea, and
      // if the island had no shallows to reclaim the mill simply waits.
      const p = layout.polders[0];
      block = p ? nearestCell(p.dike.filter(([gx, gz]) => grid.get(gx, gz) === PATH), townCentre) : null;
    } else if (m.civicType === 'windmill') {
      let best = null, bh = -9;
      for (const [gx, gz] of lots.landCells) {
        if (!grid.freeBlock(gx, gz, 1, 1, false)) continue;
        const h = lots.heightAt(gx, gz);
        if (h > bh && h < 5.0) { bh = h; best = [gx, gz]; }
      }
      block = best;
    } else block = takeCivicLot(grid, layout) || findBlockAround(grid, townCentre, { skipRing0: true });
    if (!block) { unplaced.push(id); homeless('civic', id); continue; }
    const w = SMALL.has(m.civicType) ? 1 : 3;
    const rot = facing([block[0] + (w >> 1), block[1] + (w >> 1)], townCentre);
    if (w === 3) grid.fillBlock(block[0], block[1], 3, 3, PLOT);
    else if (!ON_SQUARE[m.civicType]) grid.set(block[0], block[1], PLOT);
    layout.plots[id] = { gx: block[0], gz: block[1], w, d: w, rot };
    if (w === 3) markPath(grid, layout, `path:${id}`, routePath(grid, outsideDoor(block[0], block[1], rot)));
  }

  // ---- frontage ----------------------------------------------------------------
  // The stone in front of the civic buildings; `frontageCells` says which ground that is.
  for (const [gx, gz] of frontageCells(layout)) {
    const v = grid.get(gx, gz);
    if (v !== FREE && v !== PATH) continue;
    grid.set(gx, gz, SQUARE);
  }

  // ---- the paving ---------------------------------------------------------------
  // Derived, once both blocks that lay stone have run: `town.paved` is read off the
  // finished layout rather than gathered as the stone went down, because those two blocks
  // both run before the square is finished being built on. See `pavedCells`. It has to
  // come before the furniture, which is the one thing below that asks where the paving is.
  layout.town.paved = pavedCells(grid, lots, layout);

  // ---- what stands on the square ---------------------------------------------
  // Lamps and flower beds want the edge, where they frame the space; benches and
  // terraces want the middle, where people actually sit. Both take their cells in a
  // fixed order, so the square fills up the same way every time and nothing that is
  // already standing is ever asked to move.
  {
    const centre = layout.town.centre;
    const paved = new Set((layout.town.paved || []).map((c) => `${c[0]},${c[1]}`));
    const busy = new Set();
    for (const p of Object.values(layout.plots)) {
      for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) busy.add(`${p.gx + x},${p.gz + z}`);
    }
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
      if (!cell) { unplaced.push(f.id); homeless('small-civic', f.id); continue; }
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
        k: ordOf.get(h.district), allowBeach, near: null, grid, lat,
        within: isletWithin(h.district),
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
    if (!slot) { unplaced.push(h.id); homeless('house', h.id, h.district); continue; }

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
    if (!mp) { unplaced.push(s.id); homeless('shed-noparent', s.id); continue; }
    const door = doorCell(mp.gx, mp.gz, mp.rot);
    // the eight yard cells of the master's plot, clockwise, never the doorstep
    const yard = [];
    for (const [dx, dz] of RINGS[1]) {
      const c = [mp.gx + 1 + dx, mp.gz + 1 + dz];
      if (c[0] === door[0] && c[1] === door[1]) continue;
      yard.push(c);
    }
    let cell = yard.find(([gx, gz]) => grid.get(gx, gz) === PLOT && !smallTaken.has(`${gx},${gz}`));
    if (!cell) {
      for (let r = 2; r <= 4 && !cell; r++) {
        for (const [dx, dz] of RINGS[r]) {
          const c = [mp.gx + 1 + dx, mp.gz + 1 + dz];
          if (grid.freeCell(c[0], c[1], false)) { cell = c; grid.set(c[0], c[1], PLOT); break; }
        }
      }
    }
    if (!cell) { unplaced.push(s.id); homeless('shed', s.id); continue; }
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
  // Masked to the house's own parcel: the only square inside the mask is its hamlet's
  // green, so the braiding that REUSE produces happens locally and comes out as a lane
  // network instead of a thread across the countryside. It is also far cheaper, the
  // search space being one parcel rather than the island.
  for (const id of moved) {
    const p = layout.plots[id];
    const zoneId = p.commons ? TOWN : (ordOf.has(p.district) ? ordOf.get(p.district) : TOWN);
    const door = outsideDoor(p.gx, p.gz, p.rot);
    const inZone = grid.in(door[0], door[1]) && zone[door[0] + door[1] * size] === zoneId;
    markPath(grid, layout, `path:${id}`, routePath(grid, door, inZone ? { zone, zoneId } : {}));
  }

  // ---- cleared ground (the forest never grows back) ---------------------------
  const cleared = new Set(layout.cleared.map(([gx, gz]) => `${gx},${gz}`));
  const add = (gx, gz) => cleared.add(`${gx},${gz}`);
  for (const p of Object.values(layout.plots)) {
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) add(p.gx + x, p.gz + z);
  }
  for (const p of layout.paths) for (const [gx, gz] of p.cells) add(gx, gz);
  layout.cleared = [...cleared].map((s) => s.split(',').map(Number)).filter(([gx, gz]) => grid.in(gx, gz));

  // ---- who lodges in town ------------------------------------------------------
  // `guest` means "this project has settlers living on the commons rather than at home".
  // It used to be set where that was *decided* - inside ensureParcel, from capacity
  // against population - which made it a fact about the route the scan took rather than
  // about where the village ended up. On the second scan the houses are already placed,
  // ensureParcel never runs, and the flag flipped back: the village looked settled one
  // scan and homeless the next, forever. Read it off the finished layout instead, which
  // is the same answer every time whatever order it was reached in.
  for (const [id, rec] of Object.entries(layout.districts)) {
    rec.guest = Object.values(layout.plots).some((p) => p.district === id && p.commons);
  }

  return { layout, lots, unplaced };
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
function seawardDirection(terrain, cell) {
  let best = null, bestN = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let n = 0;
    for (let i = 1; i <= 6; i++) { if (!terrain.isWater(cell[0] + dx * i, cell[1] + dz * i)) break; n++; }
    if (n > bestN) { bestN = n; best = [dx, dz]; }
  }
  return best ? { d: best, n: bestN } : null;
}

// Planks from the shore cell out over the water, stopping at the far side of an inlet.
function pierCells(terrain, shore, dir) {
  const cells = [];
  for (let i = 1; i <= 5; i++) {
    const c = [shore[0] + dir[0] * i, shore[1] + dir[1] * i];
    if (!terrain.isWater(c[0], c[1])) break;
    cells.push(c);
  }
  return cells;
}

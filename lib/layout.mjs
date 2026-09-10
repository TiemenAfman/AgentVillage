// Where everything stands. Two rules govern this file:
//   1. Deterministic  - the same village always produces the same town.
//   2. Sticky         - a building that already has a plot is never moved again,
//                       even if the algorithm below changes later.
// data/layout.json is therefore the source of truth; we only ever add to it.
import { makeTerrain } from '../shared/terrain.mjs';
import { makeRng } from '../shared/rng.mjs';
import { readJson, writeJsonAtomic } from './paths.mjs';

export const LAYOUT_VERSION = 1;
// Houses, sheds, parcels and paths are re-planned when this changes; the terrain, the
// town square and everything civic are not. Bumping LAYOUT_VERSION instead would throw
// away the town, which is tied to the terrain and must never move.
export const PARCEL_VERSION = 1;

const FREE = 0, PLOT = 1, PATH = 2, BLOCKED = 3, SQUARE = 4, PIER = 5, RESERVED = 6, BRIDGE = 7;
const PITCH = 4;          // 3x3 plot + a one cell lane
const MAX_RING = 9;

// ---- hamlets ----------------------------------------------------------------
// Land is owned. Every project that has grown past a couple of sessions holds a parcel
// of super-cells (see `latticeOf`), and no parcel may touch another - the gap between
// them is the countryside, which is where the fields and the orchards go.
const NONE = -1, TOWN = -2;      // owner sentinels; a district uses its per-scan ordinal
const BELT = 1;                  // no super-cell may be 8-adjacent to anyone else's
const MIN_HAMLET = 3;            // sessions before a project earns a green and a sign
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
// A green three across while this is a hamlet, paved and five across once it is a village.
const GREEN_STEPS = [{ at: 12, size: 3 }, { at: 30, size: 5 }];
// How wide the town square is, by the number of settlers who have lived here. It stops
// at five: the civic lots begin three cells out, so anything wider starts biting chunks
// out of its own edges and the square stops reading as a rectangle. Past that the
// centre grows outward instead, by paving the frontage in front of each building.
const SQUARE_STEPS = [{ at: 30, size: 5 }, { at: 90, size: 7 }];

export function emptyLayout(seed, size) {
  return {
    v: LAYOUT_VERSION, parcelV: PARCEL_VERSION, seed, size, terrainHash: null,
    lattice: null, districts: {}, plots: {}, paths: [], bridges: [], cleared: [], polders: [],
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
  l.cleared = l.cleared || [];
  l.polders = l.polders || [];
  return migrateParcels(l);
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
function polderCandidate(terrain, lat, i, j) {
  const [gx, gz] = blockOf(lat, i, j);
  for (let z = 0; z < lat.pitch; z++) {
    for (let x = 0; x < lat.pitch; x++) {
      const cx = gx + x, cz = gz + z;
      if (!terrain.inGrid(cx, cz)) return false;
      if (!terrain.isWater(cx, cz)) return false;
      if (terrain.heightAt(cx, cz) < POLDER_DEPTH) return false;
    }
  }
  return true;
}

// A polder has to join the island, or the houses on it get no road. The first one wades
// out from the shore; every one after that may also lean on a polder already standing,
// which by then is simply more shore.
function touchesShore(terrain, lat, i, j) {
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
  let seed = null, bk = null;
  for (let j = -R; j <= R; j++) {
    for (let i = -R; i <= R; i++) {
      if (!polderCandidate(terrain, lat, i, j)) continue;
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
        if (!polderCandidate(terrain, lat, c[0], c[1])) continue;
        const key = [sd2(c, seed), c[1], c[0]];
        if (bestKey === null || lessTuple(key, bestKey)) { bestKey = key; best = c; }
      }
    }
    if (!best) break;                    // the shallows run out; a smaller polder will do
    supers.push(best); own.add(ckey(best));
  }

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
  if (layout.polders.length >= want) return null;
  let terrain = makeTerrain(seed, { size, polders: layout.polders });
  let changed = false;
  while (layout.polders.length < want) {
    const p = planPolder(terrain, lat, layout);
    if (!p) break;                                   // the shallows are all reclaimed
    layout.polders.push(p);
    terrain = makeTerrain(seed, { size, polders: layout.polders });
    p.road = causeway(terrain, p, layout.town.centre);
    changed = true;
  }
  return changed ? terrain : null;
}

class Super {
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

// Where a new hamlet settles. Five rungs rather than one rule: full clearance with room
// to grow, full clearance, one ring of clearance, farmstead-sized room, anywhere legal.
// The last rung puts late arrivals on the far coast, which is where the free basins are,
// so a satellite hamlet needs no special case.
const SEED_LADDER = [[2, 1.25], [2, 1.0], [1, 1.0], [1, 0.35], [0, 0.0]];
// A lone farm is one house in the countryside. Asking it to keep two rings of clearance
// carves 400 cells of island out for a single session, and after nineteen of those the
// real hamlets have nowhere left to settle - measured.
const FARM_LADDER = [[1, 1.0], [0, 0.0]];

function pickSeed(sup, tg, { allowBeach = false, near = null, k = -99, maxFrom = 0, ladder = SEED_LADDER } = {}) {
  const rr = radiusOf(tg);
  const anchor = near || [0, 0];
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
        const key = [-(room * 100) + 90 * scheb([i, j], anchor) + sup.slope[sup.di(i, j)], j, i];
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
function ensureParcel(sup, rec, pop, { k, allowBeach, near, grid, lat }) {
  const capacity = () => rec.lobes.reduce((a, l) => a + l.cells.length - (l.green ? 1 : 0), 0);
  const tg = parcelTarget(pop);

  if (!rec.lobes.length) {
    const seed = pickSeed(sup, tg, { allowBeach, near, k });
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
  let terrain = makeTerrain(seed, { size, polders: layout.polders });
  // A layout with no hash on it was planned before this check existed, which means it was
  // planned on ground that has since had rivers cut through it - so a missing hash is a
  // mismatch, not a free pass. Without this, an island carried over from before the
  // rivers kept every plot while the water arrived underneath: measured, fourteen houses
  // ended up standing in a river and not one bridge was built. A fresh layout is empty,
  // so resetting it costs nothing.
  if (layout.terrainHash !== terrain.hash) {
    resetForNewTerrain(layout, seed, size);
    terrain = makeTerrain(seed, { size, polders: layout.polders });   // and no polders now
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

  // The dike and the causeway: raised ground you may walk but not settle. Forced rather
  // than filled, because a beach cell the causeway crosses is BLOCKED as far as the cell
  // grid knows, and a road has to be able to cross it to reach the new land at all.
  const held = new Set();
  for (const p of layout.polders) {
    for (const c of [...(p.dike || []), ...(p.road || [])]) held.add(`${c[0]},${c[1]}`);
  }
  for (const k of held) { const [gx, gz] = k.split(',').map(Number); grid.set(gx, gz, PATH); }

  // Re-apply what was decided in earlier runs, so nothing ever moves. A green is only
  // ever widened, so the size on record is the size to lay back down.
  for (const d of Object.values(layout.districts)) {
    for (const lobe of d.lobes || []) {
      if (!lobe.square) continue;
      grid.fillBlock(lobe.square[0], lobe.square[1], lobe.green, lobe.green, SQUARE);
    }
    for (const [gx, gz] of d.pier || []) grid.set(gx, gz, PIER);
  }
  for (const p of Object.values(layout.plots)) {
    grid.fillBlock(p.gx, p.gz, p.w, p.d, PLOT);
  }
  for (const p of layout.paths) for (const [gx, gz] of p.cells) if (grid.get(gx, gz) === FREE) grid.set(gx, gz, PATH);
  // A bridge stands over water, which the grid calls BLOCKED, so it is put back before
  // anything is routed. From here on it is a cell a road may walk over for almost
  // nothing, which is what makes the next hamlet cross where the last one did.
  for (const b of layout.bridges) for (const [gx, gz] of b.cells) grid.set(gx, gz, BRIDGE);

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
    const paved = [];
    for (let gz = townCentre[1] - half; gz <= townCentre[1] + half; gz++) {
      for (let gx = townCentre[0] - half; gx <= townCentre[0] + half; gx++) {
        const v = grid.get(gx, gz);
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

  // The sprint board stands in the middle of the town square, where everyone passes.
  if (!layout.plots['civic:board']) {
    // On the square, but on a corner of it: dead centre is where the fountain goes,
    // and a board standing there is something you have to walk around all day.
    const c = layout.town.centre;
    const at = [c[0] + 2, c[1] + 2];
    layout.plots['civic:board'] = { gx: at[0], gz: at[1], w: 1, d: 1, rot: facing(at, c) };
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
      const coast = [...terrain.coastCells].sort((a, b) => dist2(a, townCentre) - dist2(b, townCentre));
      let bestScore = -Infinity, bestShore = null, bestPier = null;
      for (const c of coast.slice(0, 200)) {
        const dir = seawardDirection(terrain, c);
        if (!dir) continue;
        const score = dir.n * 1.6 - Math.sqrt(dist2(c, townCentre)) * 0.5;
        if (score > bestScore) { bestScore = score; bestShore = c; bestPier = pierCells(terrain, c, dir.d); }
      }
      if (bestShore) {
        rec.shore = bestShore; rec.pier = bestPier;
        for (const [gx, gz] of bestPier) grid.set(gx, gz, PIER);
      }
    }
    if (rec.shore) near = superOf(lat, rec.shore[0], rec.shore[1]);

    ensureParcel(sup, rec, d.population, { k, allowBeach, near, grid, lat });

    // The green: cut once, then only ever widened. A hamlet's is grass, a village's is
    // paved - the renderer lays only what `paved` names in stone.
    for (const lobe of rec.lobes) {
      if (lobe.green === 0) lobe.green = 3;
      for (const step of GREEN_STEPS) if (d.population >= step.at) lobe.green = Math.max(lobe.green, step.size);
      const c = centreOfCell(lat, lobe.seed);
      const half = (lobe.green - 1) / 2;
      const paved = [];
      for (let gz = c[1] - half; gz <= c[1] + half; gz++) {
        for (let gx = c[0] - half; gx <= c[0] + half; gx++) {
          const v = grid.get(gx, gz);
          if (v === PLOT || v === BLOCKED || v === PIER || v === RESERVED) continue;
          grid.set(gx, gz, SQUARE);
          paved.push([gx, gz]);
        }
      }
      lobe.centre = c;
      lobe.square = [c[0] - half, c[1] - half];
      lobe.paved = tier === 'village' ? paved : [];
    }
    if (rec.lobes.length) {
      rec.square = rec.lobes[0].square;
      rec.centre = rec.lobes[0].centre;
      rec.paved = rec.lobes.flatMap((l) => l.paved || []);
    }
    layout.districts[d.id] = rec;
  }

  // Every district that is a git repository gets an office on its green. It has to wait
  // until the greens exist: before the land register ran there was no square to put it
  // on, and every office was silently skipped.
  for (const d of model.districts) {
    if (!d.gitRepo) continue;
    const id = `civic:office:${d.id}`;
    if (layout.plots[id]) continue;
    const rec = layout.districts[d.id];
    const sq = rec && rec.square;
    if (!sq) continue;                       // a lone farmstead has no green to stand on
    const at = [sq[0] + rec.lobes[0].green - 1, sq[1] + rec.lobes[0].green - 1];
    if (grid.get(at[0], at[1]) !== SQUARE) continue;
    layout.plots[id] = { gx: at[0], gz: at[1], w: 1, d: 1, rot: 0 };
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
      const c = nearestCell(terrain.coastCells.filter(([gx, gz]) => grid.freeBlock(gx, gz, 1, 1, true)), farthestFrom(terrain.coastCells, townCentre) || townCentre);
      block = c ? [c[0], c[1]] : null;
    } else if (m.civicType === 'poldermill') {
      // On the dike of the first polder, facing the water it drains. The cell nearest
      // town, so the mill reads as belonging to the village rather than to the sea, and
      // if the island had no shallows to reclaim the mill simply waits.
      const p = layout.polders[0];
      block = p ? nearestCell(p.dike.filter(([gx, gz]) => grid.get(gx, gz) === PATH), townCentre) : null;
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
    const rot = facing([block[0] + (w >> 1), block[1] + (w >> 1)], townCentre);
    if (w === 3) grid.fillBlock(block[0], block[1], 3, 3, PLOT);
    else if (!ON_SQUARE[m.civicType]) grid.set(block[0], block[1], PLOT);
    layout.plots[id] = { gx: block[0], gz: block[1], w, d: w, rot };
    if (w === 3) markPath(grid, layout, `path:${id}`, routePath(grid, outsideDoor(block[0], block[1], rot)));
  }

  // ---- frontage ----------------------------------------------------------------
  // A pavement one cell deep in front of every civic building, so the square reaches
  // the doorsteps instead of leaving a strip of grass between the stone and the walls.
  // This is what stops the centre reading as buildings scattered near a patio, and it
  // is how the centre keeps growing once the square itself has stopped.
  {
    const centre = layout.town.centre;
    const reach = 6;
    const frontage = [];
    for (const [id, p] of Object.entries(layout.plots)) {
      if (!id.startsWith('civic:') || p.w !== 3) continue;
      if (Math.abs(p.gx + 1 - centre[0]) > reach || Math.abs(p.gz + 1 - centre[1]) > reach) continue;
      for (let gz = p.gz - 1; gz <= p.gz + 3; gz++) {
        for (let gx = p.gx - 1; gx <= p.gx + 3; gx++) {
          const edge = gx === p.gx - 1 || gx === p.gx + 3 || gz === p.gz - 1 || gz === p.gz + 3;
          if (!edge) continue;
          const v = grid.get(gx, gz);
          if (v !== FREE && v !== PATH) continue;
          grid.set(gx, gz, SQUARE);
          frontage.push([gx, gz]);
        }
      }
    }
    layout.town.paved = [...(layout.town.paved || []), ...frontage];
  }

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
        k: ordOf.get(h.district), allowBeach, near: null, grid, lat,
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
      if (lobe.road || !lobe.square) continue;
      // "Any square but my own." Asking the zone instead does not work: a five-wide green
      // reaches one cell into the neighbouring super-cell, so its own outer ring can carry
      // somebody else's zone and the road arrives back where it started, three cells long.
      const ownGreen = new Set();
      for (let gz = lobe.square[1]; gz < lobe.square[1] + lobe.green; gz++) {
        for (let gx = lobe.square[0]; gx < lobe.square[0] + lobe.green; gx++) {
          if (grid.in(gx, gz)) ownGreen.add(gx + gz * size);
        }
      }
      // Leave on the town-facing side, one cell clear of the green - whatever its width.
      const rot = facing(lobe.centre, townCentre);
      const c = lobe.centre, out = (lobe.green - 1) / 2 + 1;
      const from = rot === 0 ? [c[0], c[1] - out]
        : rot === 1 ? [c[0] + out, c[1]]
          : rot === 2 ? [c[0], c[1] + out]
            : [c[0] - out, c[1]];
      // A country road crosses the island, and the default search budget - sized for a
      // front path of a dozen cells - ran out halfway. There are only a couple of dozen
      // of these searches per island and each is made once, so let it look properly.
      const cells = routePath(grid, from, {
        isGoal: (cell, v) => v === SQUARE && !ownGreen.has(cell),
        budget: 250000,
        bridge: true,
      });
      if (!cells || cells.length <= 1) continue;
      const id = `road:${d.id}:${li}`;
      markRoad(grid, layout, id, cells);
      lobe.road = id;
    }
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
  for (const d of Object.values(layout.districts)) {
    for (const lobe of d.lobes || []) {
      if (!lobe.square) continue;                       // a farmstead has no green
      for (let z = 0; z < lobe.green; z++) for (let x = 0; x < lobe.green; x++) add(lobe.square[0] + x, lobe.square[1] + z);
    }
  }
  for (const p of layout.paths) for (const [gx, gz] of p.cells) add(gx, gz);
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

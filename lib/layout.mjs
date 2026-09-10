// Where everything stands. Two rules govern this file:
//   1. Deterministic  - the same village always produces the same town.
//   2. Sticky         - a building that already has a plot is never moved again,
//                       even if the algorithm below changes later.
// data/layout.json is therefore the source of truth; we only ever add to it.
import { makeTerrain } from '../shared/terrain.mjs';
import { readJson, writeJsonAtomic } from './paths.mjs';

export const LAYOUT_VERSION = 1;

const FREE = 0, PLOT = 1, PATH = 2, BLOCKED = 3, SQUARE = 4, PIER = 5, RESERVED = 6;
const PITCH = 4;          // 3x3 plot + a one cell lane
const MAX_RING = 9;
// How wide the town square is, by the number of settlers who have lived here. It stops
// at five: the civic lots begin three cells out, so anything wider starts biting chunks
// out of its own edges and the square stops reading as a rectangle. Past that the
// centre grows outward instead, by paving the frontage in front of each building.
const SQUARE_STEPS = [{ at: 30, size: 5 }, { at: 90, size: 7 }];

export function emptyLayout(seed, size) {
  return { v: LAYOUT_VERSION, seed, size, districts: {}, plots: {}, paths: [], cleared: [], polders: [], landing: null, town: null };
}

export function loadLayout(file, seed, size) {
  const l = readJson(file, null);
  if (!l || l.v !== LAYOUT_VERSION || l.seed !== seed || l.size !== size) return emptyLayout(seed, size);
  l.districts = l.districts || {};
  l.plots = l.plots || {};
  l.paths = l.paths || [];
  l.cleared = l.cleared || [];
  l.polders = l.polders || [];
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
const REUSE = 0.04;       // a cell that is already road
const TURN = 0.9;         // changing direction
const SLOPE = 3;          // per unit of slope
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NODIR = 4;          // the state we start in, before the first step

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

function routePath(grid, from) {
  if (!grid.in(from[0], from[1])) return null;
  const size = grid.size;
  const start = from[0] + from[1] * size;
  const { cost, prev, gen, now } = scratch(grid);
  const heap = new Heap();
  const s0 = start * 5 + NODIR;
  cost[s0] = 0; prev[s0] = -1; gen[s0] = now;
  heap.push(0, s0);

  let pops = 0;
  while (heap.size && pops++ < 40000) {
    const [c, state] = heap.pop();
    if (c > cost[state]) continue;
    const cell = (state / 5) | 0, dir = state % 5;
    const cx = cell % size, cz = (cell - cx) / size;
    const here = grid.cells[cell];
    if (here === SQUARE && cell !== start) {
      const cells = [];
      for (let s = state; s !== -1; s = prev[s]) {
        const k = (s / 5) | 0, kx = k % size;
        cells.push([kx, (k - kx) / size]);
      }
      cells.reverse();
      return cells;
    }
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS[d][0], nz = cz + DIRS[d][1];
      if (!grid.in(nx, nz)) continue;
      const ncell = nx + nz * size;
      const nv = grid.cells[ncell];
      if (nv !== FREE && nv !== PATH && nv !== SQUARE) continue;
      const nc = c
        + (nv === PATH || nv === SQUARE ? REUSE : 1)
        + SLOPE * grid.t.slope(nx, nz)
        + (dir !== NODIR && dir !== d ? TURN : 0);
      const ns = ncell * 5 + d;
      if (gen[ns] === now && nc >= cost[ns]) continue;
      gen[ns] = now; cost[ns] = nc; prev[ns] = state;
      // Push what the array actually stored, not `nc`. `cost` is a Float32Array, so it
      // rounds; the heap holds float64. Pushing the unrounded value makes the staleness
      // test above (`c > cost[state]`) fire on the rounding difference and throw away a
      // perfectly good step, which silently truncates the search.
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
    if (v !== FREE) continue;
    grid.set(gx, gz, PATH);
    fresh.push([gx, gz]);
  }
  if (fresh.length) layout.paths.push({ id, cells: fresh });
}

const GOLDEN = 2.399963229728653;   // radians

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
const SMALL = new Set(['well', 'tables', 'fountain', 'statue', 'lighthouse', 'windmill']);

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

export function placeAll(layout, model, { seed, size = 64 } = {}) {
  const terrain = makeTerrain(seed, { size, polders: layout.polders });
  const grid = new Grid(terrain);
  const centre = [size / 2, size / 2];
  const unplaced = [];

  // Re-apply what was decided in earlier runs, so nothing ever moves.
  for (const d of Object.values(layout.districts)) {
    grid.fillBlock(d.square[0], d.square[1], 3, 3, SQUARE);
    for (const [gx, gz] of d.pier || []) grid.set(gx, gz, PIER);
  }
  for (const p of Object.values(layout.plots)) {
    grid.fillBlock(p.gx, p.gz, p.w, p.d, PLOT);
  }
  for (const p of layout.paths) for (const [gx, gz] of p.cells) if (grid.get(gx, gz) === FREE) grid.set(gx, gz, PATH);

  // ---- the town square and the town hall ------------------------------------
  if (!layout.town) {
    const sq = flattestBlock(grid, centre[0] - 1, centre[1] - 1, { w: 3, d: 3 });
    if (!sq) throw new Error('no flat ground for the town square');
    grid.fillBlock(sq[0], sq[1], 3, 3, SQUARE);
    layout.town = { square: sq, centre: [sq[0] + 1, sq[1] + 1] };
  }
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

  // Every district that is a git repository gets an office on its square. The corner
  // opposite the plaque, so the two do not crowd each other.
  for (const d of model.districts) {
    if (!d.gitRepo) continue;
    const id = `civic:office:${d.id}`;
    if (layout.plots[id]) continue;
    const sq = layout.districts[d.id] && layout.districts[d.id].square;
    if (!sq) continue;
    layout.plots[id] = { gx: sq[0] + 2, gz: sq[1] + 2, w: 1, d: 1, rot: 0 };
  }

  if (!layout.landing) {
    const beach = nearestCell(terrain.beachCells.length ? terrain.beachCells : terrain.coastCells, townCentre);
    layout.landing = beach || null;
  }

  // ---- district centres ------------------------------------------------------
  const districts = [...model.districts].sort((a, b) => a.firstSeenAt - b.firstSeenAt || a.id.localeCompare(b.id));
  let order = Object.keys(layout.districts).length;
  for (const d of districts) {
    if (layout.districts[d.id]) continue;
    let square = null, pier = [], quayShore = null;
    if (order === 0 && d.kind === 'project') {
      square = layout.town.square;              // the founding district shares the town square
    } else if (d.kind === 'quay') {
      // The harbour wants a shore cell facing open water, with room for a square just
      // inland of it. The square itself must stay on land; the pier walks out to sea.
      const coast = [...terrain.coastCells].sort((a, b) => dist2(a, townCentre) - dist2(b, townCentre));
      let bestScore = -Infinity, bestSquare = null, bestPier = null, bestShore = null;
      for (const c of coast.slice(0, 200)) {
        const dir = seawardDirection(terrain, c);
        if (!dir) continue;
        const inland = [c[0] - dir.d[0], c[1] - dir.d[1]];
        const cand = [inland[0] - 1, inland[1] - 1];
        if (!grid.freeBlock(cand[0], cand[1], 3, 3, true)) continue;
        const score = dir.n * 1.6 - Math.sqrt(dist2(c, townCentre)) * 0.5;
        if (score > bestScore) {
          bestScore = score; bestSquare = cand; bestShore = c;
          bestPier = pierCells(terrain, c, dir.d);
        }
      }
      if (bestSquare) { square = bestSquare; pier = bestPier; quayShore = bestShore; }
    }
    if (!square) square = spiralBlock(grid, townCentre, layout, order);
    if (!square) { unplaced.push(d.id); continue; }
    grid.fillBlock(square[0], square[1], 3, 3, SQUARE);
    for (const [gx, gz] of pier) grid.set(gx, gz, PIER);
    layout.districts[d.id] = { square, centre: [square[0] + 1, square[1] + 1], order: order++, pier, shore: quayShore };
    if (d.id !== districts[0].id || order > 1) {
      markPath(grid, layout, `path:${d.id}`, routePath(grid, [square[0] + 1, square[1] + 3]));
    }
    order = Object.keys(layout.districts).length;
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
  for (const h of houses) {
    if (layout.plots[h.id]) continue;
    const d = layout.districts[h.district];
    if (!d) { unplaced.push(h.id); continue; }
    const allowBeach = h.harbour === true;
    const block = findBlockAround(grid, d.centre, { skipRing0: true, allowBeach })
      || findBlockAround(grid, townCentre, { skipRing0: true, allowBeach });
    if (!block) { unplaced.push(h.id); continue; }
    const rot = facing([block[0] + 1, block[1] + 1], d.centre);
    grid.fillBlock(block[0], block[1], 3, 3, PLOT);
    layout.plots[h.id] = { gx: block[0], gz: block[1], w: 3, d: 3, rot };
    moved.push(h.id);
  }

  // Paving waits until the sheds have claimed their yards further down, so a street
  // never costs the village a building.

  // ---- sheds: in the master's own yard ---------------------------------------
  const sheds = model.buildings
    .filter((b) => b.kind === 'shed')
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const yardUse = new Map();
  for (const [id, p] of Object.entries(layout.plots)) {
    if (!id.startsWith('shed:')) continue;
    const m = layout.shedOf && layout.shedOf[id];
    if (m) yardUse.set(m, (yardUse.get(m) || 0) + 1);
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
    let cell = yard.find(([gx, gz]) => grid.get(gx, gz) === PLOT && !isTaken(layout, gx, gz));
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
    layout.shedOf[s.id] = s.master;
  }

  // ---- front paths -------------------------------------------------------------
  // Left until the sheds have claimed their yards, so a road never costs a building.
  for (const id of moved) {
    const p = layout.plots[id];
    markPath(grid, layout, `path:${id}`, routePath(grid, outsideDoor(p.gx, p.gz, p.rot)));
  }

  // ---- cleared ground (the forest never grows back) ---------------------------
  const cleared = new Set(layout.cleared.map(([gx, gz]) => `${gx},${gz}`));
  const add = (gx, gz) => cleared.add(`${gx},${gz}`);
  for (const p of Object.values(layout.plots)) {
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) add(p.gx + x, p.gz + z);
  }
  for (const d of Object.values(layout.districts)) {
    for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) add(d.square[0] + x, d.square[1] + z);
  }
  for (const p of layout.paths) for (const [gx, gz] of p.cells) add(gx, gz);
  layout.cleared = [...cleared].map((s) => s.split(',').map(Number)).filter(([gx, gz]) => grid.in(gx, gz));

  return { layout, terrain, unplaced };
}

function isTaken(layout, gx, gz) {
  for (const p of Object.values(layout.plots)) {
    if (p.w === 1 && p.gx === gx && p.gz === gz) return true;
  }
  return false;
}

// Each district lays its plots on its own lattice, which keeps streets tidy. When the
// lattice is full we fall back to any free block anywhere, nearest first, so the last
// arrivals still get a home instead of nothing.
function findBlockAround(grid, centre, { skipRing0 = false, allowBeach = false, anywhere = true } = {}) {
  for (let r = skipRing0 ? 1 : 0; r <= MAX_RING; r++) {
    for (const [dx, dz] of RINGS[r]) {
      const [gx, gz] = blockAt(centre, dx, dz);
      if (grid.freeBlock(gx, gz, 3, 3, allowBeach)) return [gx, gz];
    }
  }
  return anywhere ? findAnyBlock(grid, centre, allowBeach) : null;
}

function findAnyBlock(grid, near, allowBeach) {
  let best = null, bd = Infinity;
  for (let gz = 0; gz < grid.size - 2; gz++) {
    for (let gx = 0; gx < grid.size - 2; gx++) {
      if (!grid.freeBlock(gx, gz, 3, 3, allowBeach)) continue;
      const d = dist2([gx + 1, gz + 1], near);
      if (d < bd) { bd = d; best = [gx, gz]; }
    }
  }
  return best;
}

function spiralBlock(grid, townCentre, layout, k0) {
  const taken = Object.values(layout.districts).map((d) => d.centre);
  for (let k = 1; k <= 800; k++) {
    const r = 6 + 1.8 * Math.sqrt(k + k0 * 3);
    const a = (k + k0 * 7) * GOLDEN;
    const gx = Math.round(townCentre[0] + r * Math.cos(a)) - 1;
    const gz = Math.round(townCentre[1] + r * Math.sin(a)) - 1;
    if (!grid.freeBlock(gx, gz, 3, 3, false)) continue;
    const c = [gx + 1, gz + 1];
    if (dist2(c, townCentre) < 49) continue;
    if (taken.some((t) => dist2(t, c) < 64)) continue;
    return [gx, gz];
  }
  return findBlockAround(grid, townCentre, { skipRing0: true });
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

// Where everything stands. Two rules govern this file:
//   1. Deterministic  - the same village always produces the same town.
//   2. Sticky         - a building that already has a plot is never moved again,
//                       even if the algorithm below changes later.
// data/layout.json is therefore the source of truth; we only ever add to it.
import { makeTerrain } from '../shared/terrain.mjs';
import { readJson, writeJsonAtomic } from './paths.mjs';

export const LAYOUT_VERSION = 1;

const FREE = 0, PLOT = 1, PATH = 2, BLOCKED = 3, SQUARE = 4, PIER = 5;
const PITCH = 4;          // 3x3 plot + a one cell lane
const MAX_RING = 9;

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

// Walk from a door to the nearest existing path or square, over free/path cells.
function routePath(grid, from) {
  const size = grid.size;
  const startIdx = from[0] + from[1] * size;
  if (!grid.in(from[0], from[1])) return null;
  const prev = new Int32Array(size * size).fill(-1);
  const seen = new Uint8Array(size * size);
  const queue = [startIdx];
  seen[startIdx] = 1;
  let head = 0, expansions = 0;
  while (head < queue.length && expansions < 4000) {
    const cur = queue[head++]; expansions++;
    const cx = cur % size, cz = (cur - cx) / size;
    const v = grid.get(cx, cz);
    if ((v === PATH || v === SQUARE) && cur !== startIdx) {
      const cells = [];
      for (let k = cur; k !== -1; k = prev[k]) cells.push([k % size, (k - (k % size)) / size]);
      cells.reverse();
      return cells;
    }
    const nb = [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]];
    for (const [nx, nz] of nb) {
      if (!grid.in(nx, nz)) continue;
      const idx = nx + nz * size;
      if (seen[idx]) continue;
      const nv = grid.cells[idx];
      if (nv !== FREE && nv !== PATH && nv !== SQUARE) continue;
      seen[idx] = 1; prev[idx] = cur; queue.push(idx);
    }
  }
  return null;
}

function markPath(grid, layout, id, cells) {
  if (!cells || cells.length === 0) return;
  for (const [gx, gz] of cells) if (grid.get(gx, gz) === FREE) grid.set(gx, gz, PATH);
  layout.paths.push({ id, cells });
}

const GOLDEN = 2.399963229728653;   // radians

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

  if (!layout.plots['civic:townhall']) {
    const hall = findBlockAround(grid, townCentre, { skipRing0: true });
    if (hall) {
      const rot = facing([hall[0] + 1, hall[1] + 1], townCentre);
      grid.fillBlock(hall[0], hall[1], 3, 3, PLOT);
      layout.plots['civic:townhall'] = { gx: hall[0], gz: hall[1], w: 3, d: 3, rot };
      markPath(grid, layout, 'path:civic:townhall', routePath(grid, outsideDoor(hall[0], hall[1], rot)));
    }
  }

  // The sprint board stands in the middle of the town square, where everyone passes.
  if (!layout.plots['civic:board']) {
    const c = layout.town.centre;
    layout.plots['civic:board'] = { gx: c[0], gz: c[1], w: 1, d: 1, rot: 0 };
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
    if (m.civicType === 'well') block = [layout.town.square[0], layout.town.square[1]];   // on the square itself
    else if (m.civicType === 'lighthouse') {
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
    } else block = findBlockAround(grid, townCentre, { skipRing0: true });
    if (!block) { unplaced.push(id); continue; }
    const w = m.civicType === 'well' || m.civicType === 'lighthouse' || m.civicType === 'windmill' ? 1 : 3;
    const rot = facing([block[0] + (w >> 1), block[1] + (w >> 1)], townCentre);
    if (w === 3) grid.fillBlock(block[0], block[1], 3, 3, PLOT);
    else if (m.civicType !== 'well') grid.set(block[0], block[1], PLOT);
    layout.plots[id] = { gx: block[0], gz: block[1], w, d: w, rot };
    if (w === 3) markPath(grid, layout, `path:${id}`, routePath(grid, outsideDoor(block[0], block[1], rot)));
  }

  // ---- houses ----------------------------------------------------------------
  const houses = model.buildings
    .filter((b) => b.kind !== 'shed')
    .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
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
    markPath(grid, layout, `path:${h.id}`, routePath(grid, outsideDoor(block[0], block[1], rot)));
  }

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

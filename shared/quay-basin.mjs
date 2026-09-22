import { makeSimplex2D, hash32 } from './rng.mjs';

// A harbour basin is an overlay on the saved terrain, not a terrain migration.
// Keep its floor and landings shared: the drawing, water depth and feet must agree,
// while the island's terrain hash and every recorded house stay where they were.
export const BASIN_FLOOR = -1.15;
export const BASIN_DECK = 0.44;
export const BANK_WIDTH = 2.8;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// The sea must know the permanent decks even before a browser has measured them.
// Shared with the page so an old placements snapshot cannot put feet underground.
export function quayDeckHeights(village, size) {
  const heights = new Map();
  for (const d of village?.districts || []) {
    if (d.kind !== 'quay') continue;
    for (const [gx, gz] of [...(d.deck || []), ...(d.pier || [])]) heights.set(gx + gz * size, BASIN_DECK);
  }
  for (const b of village?.buildings || []) {
    if (!b.harbour || !b.plot?.quay) continue;
    const p = b.plot;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) {
      heights.set((p.gx + x) + (p.gz + z) * size, BASIN_DECK);
    }
  }
  return heights;
}

function parcelWaterField(village, size) {
  const mask = new Uint8Array(size * size);
  const lat = village?.island?.lattice;
  if (!lat) return mask;
  for (const d of village.districts || []) for (const l of d.lobes || []) {
    const p = l.parcel;
    if (!p) continue;
    for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) {
      if (p.rows[j]?.[i] !== '1') continue;
      const gx = lat.anchor[0] + (p.i0 + i) * lat.pitch;
      const gz = lat.anchor[1] + (p.j0 + j) * lat.pitch;
      for (let z = gz; z < gz + lat.pitch; z++) for (let x = gx; x < gx + lat.pitch; x++) {
        if (x >= 0 && z >= 0 && x < size && z < size) mask[x + z * size] = d.kind === 'quay' ? 255 : 0;
      }
    }
  }
  return mask;
}

// One full cell around the parcel, including diagonal corners. This is shoreline
// clearance, not a change to ownership or a reason to move the saved plots.
export function quayWaterField(village, size) {
  const original = parcelWaterField(village, size), expanded = original.slice();
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    if (!original[x + z * size]) continue;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < size && nz < size) expanded[nx + nz * size] = 255;
    }
  }
  return expanded;
}

export function createQuayBasin(village, terrain) {
  const { size, half } = terrain;
  const mask = quayWaterField(village, size);
  const wet = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size && !!mask[gx + gz * size];
  const edges = [], ramps = [];
  const originalMask = parcelWaterField(village, size);
  const deck = new Set((village?.districts || []).filter(d => d.kind === 'quay')
    .flatMap(d => d.deck || []).map(([x, z]) => x + z * size));
  // Only a road crossing the bank is an entrance; a doorstep beside it is not.
  const entrances = new Set();
  for (const path of village?.paths || []) {
    const cells = path.cells || [];
    for (let i = 1; i < cells.length; i++) {
      let [a, b] = [cells[i - 1], cells[i]];
      if (wet(...a) === wet(...b)) continue;
      if (!wet(...a)) [a, b] = [b, a];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      if (Math.abs(dx) + Math.abs(dz) === 1) entrances.add(`${a[0]},${a[1]}:${dx},${dz}`);
    }
  }
  // Extend each landward entrance over the new cell; its ramp is both geometry
  // and a shared walking surface, so the added strip cannot strand the boardwalk.
  for (const key of [...deck]) {
    const gx = key % size, gz = Math.floor(key / size);
    if (!originalMask[key]) continue;
    for (const [dx, dz] of N4) {
      const nx = gx + dx, nz = gz + dz;
      if (wet(nx, nz) && !originalMask[nx + nz * size]) deck.add(nx + nz * size);
    }
  }
  const platforms = (village?.buildings || []).filter(b => b.harbour && b.plot?.quay)
    .map(b => ({ x: b.plot.gx - half, z: b.plot.gz - half, w: b.plot.w, d: b.plot.d }));
  for (let gz = 0; gz < size; gz++) for (let gx = 0; gx < size; gx++) {
    if (!wet(gx, gz)) continue;
    for (const [dx, dz] of N4) {
      if (wet(gx + dx, gz + dz)) continue;
      const x = gx - half + .5 + dx * .5, z = gz - half + .5 + dz * .5;
      const edge = { x, z, dx, dz };
      edges.push(edge);
      if (entrances.has(`${gx},${gz}:${dx},${dz}`) && deck.has(gx + gz * size)
        && terrain.worldHeight(x + dx * .5, z + dz * .5) > .05) {
        const y = terrain.worldHeight(x, z);
        let run = 1;
        // Use the straight approach already laid, never a house plot beside it.
        while (run < 5 && deck.has((gx - dx * run) + (gz - dz * run) * size)
          && wet(gx - dx * run, gz - dz * run)) run++;
        // Stop at that last board's centre, not its far bank: on a narrow inlet
        // the far edge is land again and cannot be the low end of this ramp.
        const length = Math.min(4, Math.max(1.5, Math.ceil(Math.abs(y - BASIN_DECK) / .45)), run - .5);
        ramps.push({ ...edge, y, length, steps: Math.max(1, Math.ceil(Math.abs(y - BASIN_DECK) / .15)) });
      }
    }
  }
  const contains = (x, z) => wet(Math.floor(x + half), Math.floor(z + half));
  const rampHeight = (x, z) => {
    for (const r of ramps) {
      const along = (x - r.x) * r.dx + (z - r.z) * r.dz;
      const across = (x - r.x) * r.dz - (z - r.z) * r.dx;
      if (along >= -r.length && along <= 0 && Math.abs(across) <= .38) {
        return stairHeight(r, along);
      }
    }
    return null;
  };
  const noise = makeSimplex2D(hash32(`quay-bank:${terrain.seed}`));
  const bankDistance = (x, z) => {
    let nearest = Infinity;
    for (const e of edges) {
      // Distance to the whole segment, including its ends: a corner then becomes
      // one continuous slope instead of two overlapping strips of bank.
      const along = (x - e.x) * e.dz - (z - e.z) * e.dx;
      const t = Math.max(-.5, Math.min(.5, along));
      const dx = x - e.x - e.dz * t, dz = z - e.z + e.dx * t;
      nearest = Math.min(nearest, dx * dx + dz * dz);
    }
    return Math.sqrt(nearest);
  };
  // A grassy collar keeps the lip away from the cadastral rectangle. Its width
  // wanders gently; both the cut and its shingle start from the same contour.
  const lipDistance = (x, z) => Math.max(0, bankDistance(x, z) - .4 - noise(x * .42, z * .42) * .28);
  const bankCoverage = (x, z) => {
    const t = Math.min(1, lipDistance(x, z) / 1.65);
    return t * t * (3 - 2 * t);
  };
  const height = (x, z) => {
    const original = terrain.worldHeight(x, z);
    if (!contains(x, z)) return original;
    const width = BANK_WIDTH + noise(x * .65, z * .65) * .45;
    const t = Math.min(1, lipDistance(x, z) / width);
    // Round both the grassy lip and the submerged foot, like the river's cut.
    const blend = t * t * (3 - 2 * t);
    const bed = Math.min(BASIN_FLOOR, original);
    let y = original + (bed - original) * blend;
    // Fill beneath the stairs up to the uncut landing, rather than carving a
    // hollow slot behind the top tread. Feather sideways into the bank.
    for (const r of ramps) {
      const along = (x - r.x) * r.dx + (z - r.z) * r.dz;
      const across = Math.abs((x - r.x) * r.dz - (z - r.z) * r.dx);
      if (along < -r.length || along > 0 || across > .85) continue;
      const plank = BASIN_DECK + (r.y - BASIN_DECK) * (along / r.length + 1);
      const feather = Math.max(0, (across - .38) / .47);
      const cut = plank;
      y = cut + (y - cut) * feather * feather * (3 - 2 * feather);
    }
    // The bank can curl around an existing house, but never rise through its
    // platform. Feather the clearance outside the footprint to avoid a square pit.
    for (const p of platforms) {
      const dx = Math.max(p.x - x, 0, x - p.x - p.w);
      const dz = Math.max(p.z - z, 0, z - p.z - p.d);
      const t = Math.min(1, Math.sqrt(dx * dx + dz * dz) / .7);
      // A platform near the edge must not leave a hole at the dry-land seam.
      const seam = Math.min(1, bankDistance(x, z) / .7);
      const cut = y + (Math.min(y, -.15) - y) * seam * seam * (3 - 2 * seam);
      y = cut + (y - cut) * t * t * (3 - 2 * t);
    }
    return y;
  };
  return { mask, edges, ramps, contains, rampHeight, bankDistance, bankCoverage, height };
}

// The sea, player and drawing use identical treads, rising at most .15 each.
export function stairHeight(r, along) {
  const step = Math.min(r.steps, Math.max(0, 1 + Math.floor((along / r.length + 1) * r.steps + 1e-9)));
  return BASIN_DECK + (r.y - BASIN_DECK) * step / r.steps;
}

const cache = new WeakMap();
export function quayBasin(village, terrain) {
  if (!village) return null;
  let entry = cache.get(village);
  if (!entry || entry.terrain !== terrain) {
    entry = { terrain, basin: createQuayBasin(village, terrain) };
    cache.set(village, entry);
  }
  return entry.basin;
}

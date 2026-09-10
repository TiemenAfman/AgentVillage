// The island itself. This module is the contract between the Node layout (where may a
// house stand?) and the browser renderer (what does the ground look like?), so it must
// produce identical numbers in both runtimes. See the rule at the top of rng.mjs.
import { hash32, makeRng, makeSimplex2D, fbm2, smoothstep, clamp, lerp } from './rng.mjs';

export const SEA_LEVEL = 0;
export const BEACH_MAX = 0.35;
export const BUILD_SLOPE_MAX = 0.6;
export const BUILD_HEIGHT_MAX = 4.2;
export const POLDER_H = 80 / 256;   // reclaimed land sits just above the water
export const DIKE_H = 224 / 256;

// ---- rivers -----------------------------------------------------------------
// One or two watercourses, from the flank of the hill down the gradient to the sea. A
// river has to be genuinely below SEA_LEVEL for `isWater` to call it water, so what is
// cut is not a channel but a valley whose floor is flooded: the bed at RIVER_BED, the
// banks climbing at RIVER_RISE per cell, and `min` against the ground everywhere - so
// out on the low coastal plain it barely cuts, and up on the hill it is a ravine. Take
// the valley away and cutting to below sea level from a summit four units up leaves a
// slot canyon with vertical walls.
const RIVER_BED = -0.55;
const RIVER_RISE = 1.5;            // how fast the bank climbs out of the bed, per cell
const RIVER_W0 = 0.6;              // half-width at the source
const RIVER_W1 = 0.95;             // and at the mouth: a river widens as it goes
const RIVER_PULL = 0.45;           // pull toward the mouth, per cell of ground gained
const RIVER_WOBBLE = 0.16;         // hashed per cell, so the course meanders
const RIVER_CENTRE_KEEP = 11;      // world units of the island centre a river leaves alone

// 16 unit vectors at 22.5 degree steps, written out as literals because the
// trigonometric functions are not allowed in this module.
const DIRS16 = [
  [1, 0], [0.9238795325112867, 0.3826834323650898], [0.7071067811865476, 0.7071067811865476], [0.3826834323650898, 0.9238795325112867],
  [0, 1], [-0.3826834323650898, 0.9238795325112867], [-0.7071067811865476, 0.7071067811865476], [-0.9238795325112867, 0.3826834323650898],
  [-1, 0], [-0.9238795325112867, -0.3826834323650898], [-0.7071067811865476, -0.7071067811865476], [-0.3826834323650898, -0.9238795325112867],
  [0, -1], [0.3826834323650898, -0.9238795325112867], [0.7071067811865476, -0.7071067811865476], [0.9238795325112867, -0.3826834323650898],
];

function distTo(x, z, c) { const dx = x - c[0], dz = z - c[1]; return Math.sqrt(dx * dx + dz * dz); }
function bump(t) { return t * t * (3 - 2 * t); }

function boxBlur(H, N) {
  const out = new Float64Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let sum = 0, cnt = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj;
        if (jj < 0 || jj >= N) continue;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= N) continue;
          sum += H[ii + jj * N]; cnt++;
        }
      }
      out[i + j * N] = sum / cnt;
    }
  }
  return out;
}

// Where one river runs. Steepest descent from a source on the flank of the hill, four
// connected, with two corrections that a bare gradient walk needs on a blurred fbm: a
// seaward pull, which carries the course straight over the pits the noise is full of, and
// a hashed wobble, so it meanders instead of running dead down the fall line. It stops on
// the first cell that is already under water - the sea, or the lake - which is where a
// river ends. The middle of the island is refused outright: the town square is picked as
// the flattest ground near the centre of the grid and a river through it would take the
// square, the civic lots and the commons with it.
function riverCourse(H, N, size, start, mouth) {
  const half = size / 2;
  const inGrid = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size;
  const cellH = (gx, gz) =>
    0.25 * (H[gx + gz * N] + H[gx + 1 + gz * N] + H[gx + (gz + 1) * N] + H[gx + 1 + (gz + 1) * N]);
  const world = (gx, gz) => [gx - half + 0.5, gz - half + 0.5];
  const toMouth = (gx, gz) => {
    const [x, z] = world(gx, gz);
    const dx = x - mouth[0], dz = z - mouth[1];
    return Math.sqrt(dx * dx + dz * dz);
  };
  const middle = (gx, gz) => {
    const [x, z] = world(gx, gz);
    return Math.sqrt(x * x + z * z) < RIVER_CENTRE_KEEP;
  };

  const course = [];
  const seen = new Uint8Array(size * size);
  let cur = start;
  if (!inGrid(cur[0], cur[1]) || middle(cur[0], cur[1])) return course;
  for (let step = 0; step < size * 3; step++) {
    course.push(cur);
    seen[cur[0] + cur[1] * size] = 1;
    if (cellH(cur[0], cur[1]) < SEA_LEVEL) break;
    const d0 = toMouth(cur[0], cur[1]);
    let best = null, bestScore = Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur[0] + dx, nz = cur[1] + dz;
      if (!inGrid(nx, nz) || seen[nx + nz * size] || middle(nx, nz)) continue;
      const wob = ((hash32(`river:${nx}:${nz}`) % 1000) / 1000 - 0.5) * 2 * RIVER_WOBBLE;
      const score = cellH(nx, nz) + RIVER_PULL * (toMouth(nx, nz) - d0) + wob;
      if (score < bestScore) { bestScore = score; best = [nx, nz]; }
    }
    if (!best) break;
    cur = best;
  }
  return course;
}

// The valley around one course. Every corner within reach is pulled down to the profile
// its distance from the course asks for, and never up: `min` is what makes the same
// numbers cut a ravine on the hill and no more than a dip on the coastal plain.
function carveRiver(H, N, size, course) {
  const n = course.length;
  const reach = Math.ceil(RIVER_W1 - RIVER_BED / RIVER_RISE) + 2;
  for (let s = 0; s < n; s++) {
    const [gx, gz] = course[s];
    const w = RIVER_W0 + (RIVER_W1 - RIVER_W0) * (n > 1 ? s / (n - 1) : 1);
    const cx = gx + 0.5, cz = gz + 0.5;          // the cell centre, in corner coordinates
    for (let j = Math.max(0, gz - reach); j <= Math.min(size, gz + reach); j++) {
      for (let i = Math.max(0, gx - reach); i <= Math.min(size, gx + reach); i++) {
        const dx = i - cx, dz = j - cz;
        const t = RIVER_BED + RIVER_RISE * Math.max(0, Math.sqrt(dx * dx + dz * dz) - w);
        const k = i + j * N;
        if (t < H[k]) H[k] = t;
      }
    }
  }
}

export function hashHeights(H) {
  let h = 0x811c9dc5;
  for (let k = 0; k < H.length; k++) {
    const v = Math.round(H[k] * 256) | 0;
    h ^= v & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function makeTerrain(seed, opts) {
  const size = (opts && opts.size) || 64;
  const polders = (opts && opts.polders) || [];
  const N = size + 1, half = size / 2;
  let H = new Float64Array(N * N);
  const nShape = makeSimplex2D(hash32(seed + ':shape'));
  const nCoast = makeSimplex2D(hash32(seed + ':coast'));
  const rng = makeRng(seed).fork('terrain');

  const kHill = rng.int(16);
  const hillDist = 11 + rng.range(0, 4);
  const hillCentre = [DIRS16[kHill][0] * hillDist, DIRS16[kHill][1] * hillDist];
  const kSh = (kHill + (rng.chance(0.5) ? 2 : 14)) % 16;
  const shoulderCentre = [DIRS16[kSh][0] * (hillDist - 2), DIRS16[kSh][1] * (hillDist - 2)];
  const kLake = (kHill + 7 + rng.int(3)) % 16;
  const lakeDist = 8 + rng.range(0, 4);
  const lakeCentre = [DIRS16[kLake][0] * lakeDist, DIRS16[kLake][1] * lakeDist];
  const LAKE_R = 4;
  const coastScale = half * 0.9375;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i - half, z = j - half;
      const e01 = fbm2(nShape, x * 0.055, z * 0.055, { octaves: 4 }) * 0.5 + 0.5;
      const d = Math.sqrt(x * x + z * z) / coastScale;
      const dw = d + 0.18 * fbm2(nCoast, x * 0.03, z * 0.03, { octaves: 2 });
      const fall = 1 - smoothstep(0.55, 1.0, dw);
      let h = (0.35 + 0.65 * e01) * fall * 3.2 - 0.6;
      h -= 1.9 * smoothstep(0.9, 1.35, dw);                          // deeper water further out
      const th = clamp(1 - distTo(x, z, hillCentre) / 8, 0, 1);      // the hill
      h += 4.6 * bump(th);
      const ts = clamp(1 - distTo(x, z, shoulderCentre) / 6, 0, 1);  // its shoulder
      h += 1.8 * bump(ts);
      const tl = clamp(1 - distTo(x, z, lakeCentre) / LAKE_R, 0, 1); // the lake
      const sl = bump(tl);
      if (sl > 0) h = Math.min(h, lerp(0.3, -0.9, sl));
      H[i + j * N] = h;
    }
  }
  H = boxBlur(boxBlur(H, N), N);
  for (let k = 0; k < H.length; k++) H[k] = Math.max(-2.5, Math.round(H[k] * 256) / 256);

  // ---- rivers ---------------------------------------------------------------
  // Cut before the polders, and drawn from a fork of the seed of its own: a river is what
  // the island does by itself and a polder is what people did to it afterwards, so the
  // dike wins where the two meet. The fork matters for a duller reason too - drawing
  // these numbers from `rng` would have shifted every draw after it and moved the hill,
  // its shoulder and the lake on every island that already exists.
  const rr = makeRng(seed).fork('rivers');
  const courses = [];
  // A source on the flank of the hill and a mouth a quarter of a turn round the coast, so
  // the river runs across the island rather than straight out of the nearest shore - the
  // shortest way down from a hill sitting eleven cells off centre is a four cell creek in
  // the corner, which divides nothing. A second river, when there is one, leaves by the
  // other side, so the two do not merge and the land ends up in three pieces.
  const sides = rr.chance(0.55) ? [1, -1] : [rr.chance(0.5) ? 1 : -1];
  for (const side of sides) {
    const kSrc = (kHill + side * (2 + rr.int(2)) + 16) % 16;
    const kEnd = (kHill + side * (4 + rr.int(3)) + 16) % 16;
    const start = [
      Math.round(hillCentre[0] + DIRS16[kSrc][0] * 3 + half - 0.5),
      Math.round(hillCentre[1] + DIRS16[kSrc][1] * 3 + half - 0.5),
    ];
    const mouth = [DIRS16[kEnd][0] * (half - 2), DIRS16[kEnd][1] * (half - 2)];
    const course = riverCourse(H, N, size, start, mouth);
    if (course.length >= 6) courses.push(course);
  }
  for (const course of courses) carveRiver(H, N, size, course);
  if (courses.length) {
    for (let k = 0; k < H.length; k++) H[k] = Math.max(-2.5, Math.round(H[k] * 256) / 256);
  }

  const setCell = (gx, gz, v) => {
    if (gx < 0 || gz < 0 || gx >= size || gz >= size) return;
    H[gx + gz * N] = v;
    H[gx + 1 + gz * N] = v;
    H[gx + (gz + 1) * N] = v;
    H[gx + 1 + (gz + 1) * N] = v;
  };
  for (const p of polders) {
    for (const c of p.cells || []) setCell(c[0], c[1], POLDER_H);
    for (const c of p.dike || []) setCell(c[0], c[1], DIKE_H);
  }

  const inGrid = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size;
  const corner = (i, j) => H[clamp(i, 0, size) + clamp(j, 0, size) * N];
  const cornersOf = (gx, gz) => [corner(gx, gz), corner(gx + 1, gz), corner(gx, gz + 1), corner(gx + 1, gz + 1)];
  const heightAt = (gx, gz) => { const c = cornersOf(gx, gz); return (c[0] + c[1] + c[2] + c[3]) * 0.25; };
  const slope = (gx, gz) => {
    const c = cornersOf(gx, gz);
    return Math.max(c[0], c[1], c[2], c[3]) - Math.min(c[0], c[1], c[2], c[3]);
  };
  const isLand = (gx, gz) => {
    if (!inGrid(gx, gz)) return false;
    const c = cornersOf(gx, gz);
    return c[0] >= SEA_LEVEL && c[1] >= SEA_LEVEL && c[2] >= SEA_LEVEL && c[3] >= SEA_LEVEL;
  };
  const isWater = (gx, gz) => !inGrid(gx, gz) || heightAt(gx, gz) < SEA_LEVEL;
  const isBeach = (gx, gz) => {
    if (!isLand(gx, gz)) return false;
    const c = cornersOf(gx, gz);
    return c[0] < BEACH_MAX && c[1] < BEACH_MAX && c[2] < BEACH_MAX && c[3] < BEACH_MAX;
  };
  const isBuildable = (gx, gz) =>
    isLand(gx, gz) && !isBeach(gx, gz) && slope(gx, gz) < BUILD_SLOPE_MAX && heightAt(gx, gz) < BUILD_HEIGHT_MAX;

  // Bilinear height at a world position; used to stand figures and props on the ground.
  const worldHeight = (x, z) => {
    const fx = clamp(x + half, 0, size - 1e-6), fz = clamp(z + half, 0, size - 1e-6);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const h00 = corner(i, j), h10 = corner(i + 1, j), h01 = corner(i, j + 1), h11 = corner(i + 1, j + 1);
    return lerp(lerp(h00, h10, u), lerp(h01, h11, u), v);
  };
  const cellWorld = (gx, gz) => [gx - half + 0.5, gz - half + 0.5];

  // Which cells the rivers actually made wet, and which ones ended up as their banks.
  // Derived from `isWater` rather than from the course, so what is drawn and what a
  // bridge may be thrown over can never disagree with what the layout calls water. A
  // course cell that ran out into the sea is water there too, so the mouth is included
  // and the reeds simply stop where the beach begins.
  const RIVER_NEAR = 4;
  const nearRiver = new Uint8Array(size * size);
  for (const course of courses) {
    for (const [gx, gz] of course) {
      for (let dz = -RIVER_NEAR; dz <= RIVER_NEAR; dz++) {
        for (let dx = -RIVER_NEAR; dx <= RIVER_NEAR; dx++) {
          const nx = gx + dx, nz = gz + dz;
          if (inGrid(nx, nz)) nearRiver[nx + nz * size] = 1;
        }
      }
    }
  }
  const wet = new Uint8Array(size * size);
  const riverCells = [], riverBankCells = [];
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      if (!nearRiver[gx + gz * size] || !isWater(gx, gz)) continue;
      wet[gx + gz * size] = 1;
      riverCells.push([gx, gz]);
    }
  }
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const k = gx + gz * size;
      if (!nearRiver[k] || wet[k]) continue;
      if (wet[gx + 1 + gz * size] || (gx > 0 && wet[gx - 1 + gz * size])
        || (gz + 1 < size && wet[gx + (gz + 1) * size]) || (gz > 0 && wet[gx + (gz - 1) * size])) {
        riverBankCells.push([gx, gz]);
      }
    }
  }
  const isRiver = (gx, gz) => (inGrid(gx, gz) ? wet[gx + gz * size] === 1 : false);

  const landCells = [], beachCells = [], coastCells = [];
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      if (!isLand(gx, gz)) continue;
      landCells.push([gx, gz]);
      if (isBeach(gx, gz)) beachCells.push([gx, gz]);
      if (isWater(gx + 1, gz) || isWater(gx - 1, gz) || isWater(gx, gz + 1) || isWater(gx, gz - 1)) {
        coastCells.push([gx, gz]);
      }
    }
  }

  return {
    size, N, half, H, seed,
    hillCentre, lakeCentre,
    heightAt, slope, isLand, isWater, isBeach, isBuildable, worldHeight, cellWorld, inGrid, corner,
    landCells, beachCells, coastCells,
    rivers: courses, riverCells, riverBankCells, isRiver,
    hash: hashHeights(H),
  };
}

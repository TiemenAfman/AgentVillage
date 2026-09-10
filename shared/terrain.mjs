// The island itself. This module is the contract between the Node layout (where may a
// house stand?) and the browser renderer (what does the ground look like?), so it must
// produce identical numbers in both runtimes. See the rule at the top of rng.mjs.
import { hash32, makeRng, makeSimplex2D, fbm2, smoothstep, clamp, lerp } from './rng.mjs';

export const SEA_LEVEL = 0;
export const BEACH_MAX = 0.35;
export const BUILD_SLOPE_MAX = 0.6;
export const BUILD_HEIGHT_MAX = 4.2;
// Reclaimed land sits just above the water - but it must sit *above* BEACH_MAX, not
// below it. At 80/256 every corner of a fresh polder was under the beach threshold, so
// `isBeach` called the new land sand, `isBuildable` refused it, and the whole escape
// valve produced ground nobody could build on. 96/256 is the first multiple of the
// heightfield's own 1/256 quantum that clears 0.35, so a polder is the lowest meadow on
// the island rather than the highest beach.
export const POLDER_H = 96 / 256;
export const DIKE_H = 224 / 256;

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
    hash: hashHeights(H),
  };
}

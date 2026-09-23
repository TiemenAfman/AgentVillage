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

// The dredged fairway. The other thing people do to a coast: a polder takes water off the
// island, a fairway takes ground off the sea, and the two are the same mechanism pointed
// in opposite directions - a list of cells in the layout, handed to `makeTerrain`, sticky
// for ever.
//
// The depth is the river's own bed rather than a number of its own, quantised the way the
// carve is quantised (`Math.round(RIVER_BED * 256)`), so the estuary's floor is the floor
// the river already had and there is no step at the mouth where the dredger stopped. It is
// applied with `min`, never `max`: a dredge digs, so deep water stays deep and only the bar
// is taken away.
export const CHANNEL_H = -141 / 256;

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
const RIVER_MOUTH_REACH = 2;       // how near the sea has to be for the beach to be a mouth

// ---- the volcano --------------------------------------------------------------
// One island that is not a hill with a village on it but a mountain with a hole in the top
// (Plans/vulkaan-in-het-midden.md). It is asked for by name - `volcano: true` - and never
// derived from a seed, so every island that exists hashes exactly as it did.
//
// Every number is a share of `half`, so the same mountain comes out at 64 as at 128 and
// only the test at 128 is the one it was drawn for. At 128:
//
//   - the coast lies at about r = 50 (VOLCANO_COAST of half, less the beach's own reach),
//     with a shelf of sand two to four cells deep (VOLCANO_SHORE), and the grid edge is
//     open water on every side;
//   - the rim is a circle at r = 9 (VOLCANO_RIM), 15.3 up (VOLCANO_PEAK, capped at 16);
//   - the flank between is concave, like every stratovolcano: 0.4 t + 0.6 t^2 of the peak,
//     so it runs out onto the coastal flat at 0.15 a cell and is 0.6 a cell under the rim,
//     with ridges on it. Measured over every land cell, `slope` has its median at 0.47 and
//     its 99th percentile at 1.1. That is a climb and not a wall - A* in
//     shared/settlerwalk.mjs prices slope, it never refuses it, and a settler's walk has no
//     slope rule at all - and it leaves about 3,200 buildable cells on the lower flank, the
//     ring from the beach up to BUILD_HEIGHT_MAX, which is where the sea will want houses;
//   - the crater is a bowl about 4 deep with a flat floor across its inner 40%, which is a
//     lava pool.
//
// Squares are the only powers: `pow` is one of the functions this module may not call.
const VOLCANO_COAST = 0.80;        // coast radius, as a share of half
const VOLCANO_RIM = 0.14;          // crater rim radius, as a share of half
const VOLCANO_PEAK = 0.24;         // rim height, as a share of half...
const VOLCANO_PEAK_MAX = 16;       // ...capped, or a 512 grid is a pillar in the sky
const VOLCANO_DEPTH = 0.28;        // crater depth, as a share of the rim height
const VOLCANO_POOL = 0.4;          // the flat floor, as a share of the rim radius
const VOLCANO_SHORE = 0.1;         // the beach shelf, as a share of the way from coast to rim
const VOLCANO_RIDGE = 0.11;        // how high the radial ridges stand at mid-flank, of the peak
const VOLCANO_ROUGH = 0.025;       // plain bumpiness, everywhere there is land, of the peak

// The lava. A flow is routed exactly the way a river is - `riverCourse`, from a cell on the
// rim with a mouth a little round the coast - but it is not carved the way a river is: a
// river has to go below SEA_LEVEL to be water at all, and the one sea plane at y = 0 is what
// is drawn in its bed. Lava has a surface of its own (web/js/lava.js), so it wants a gully
// and not a flooded valley: LAVA_DEPTH under the ground either side of it, following the
// fall of the mountain all the way down, and never under LAVA_FLOOR, so that on the last
// cells of beach, where the ground itself is barely above the water, the sea plane cannot
// show through the flow.
const LAVA_DEPTH = 0.5;
const LAVA_BANK = 1.4;             // how far out, past the flow's edge, the bank reaches
// The two widths are exported for web/js/lava.js, which draws the flow as wide as this says
// it is: a ribbon narrower than the cells that hurt would be a trap.
export const LAVA_W0 = 0.55;       // half-width at the rim
export const LAVA_W1 = 0.85;       // and at the sea
const LAVA_FLOOR = 0.12;           // the lowest the bed may lie, above SEA_LEVEL
const LAVA_REACH = 0.25;           // a cell is lava if its middle is this close to the flow's edge
const LAVA_PULL = 0.18;            // pull toward the mouth, per cell - under half the river's
const LAVA_WOBBLE = 0.3;           // and nearly twice the river's meander

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
//
// The options are the lava's, and each default is the river's own number, so a river is
// routed exactly as it was before they existed. A lava flow starts on the crater rim,
// which is well inside RIVER_CENTRE_KEEP, so it keeps only the crater itself; it runs on to
// the waterline instead of stopping two cells short, because the steam where it meets the
// sea is the point; and it wobbles off a salt of its own so that it does not meander in step
// with a river that is not there. It is pulled less and wobbles more (LAVA_PULL, LAVA_WOBBLE):
// on a cone every cell is downhill from the one above it, so the river's pull alone drew a
// ruler-straight line from the rim to the mouth, and a flow is meant to find the valleys
// between the ridges instead.
function riverCourse(H, N, size, start, mouth, {
  keep = RIVER_CENTRE_KEEP, mouthReach = RIVER_MOUTH_REACH, salt = 'river',
  pull = RIVER_PULL, wobble = RIVER_WOBBLE,
} = {}) {
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
    return Math.sqrt(x * x + z * z) < keep;
  };
  // Is there real water within `r` cells, judged on the ground as it was before any of
  // this was cut? Off the grid counts: that is open sea.
  const seaWithin = (gx, gz, r) => {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = gx + dx, nz = gz + dz;
        if (!inGrid(nx, nz) || cellH(nx, nz) < SEA_LEVEL) return true;
      }
    }
    return false;
  };

  const course = [];
  const seen = new Uint8Array(size * size);
  let cur = start;
  if (!inGrid(cur[0], cur[1]) || middle(cur[0], cur[1])) return course;
  for (let step = 0; step < size * 3; step++) {
    course.push(cur);
    seen[cur[0] + cur[1] * size] = 1;
    if (cellH(cur[0], cur[1]) < SEA_LEVEL) break;
    // Stop where the beach begins and let the sea do the rest, rather than gouging an
    // estuary across the coastal flat: that widest stretch is the one nothing can bridge
    // anyway - `MAX_SPAN` refuses it - and it eats the most buildable coast. But only
    // where the water is near enough for the valley to reach it. Stopping on a flat that
    // is merely low leaves a pond with no way out, measured on one island in eight.
    if (cellH(cur[0], cur[1]) < BEACH_MAX && seaWithin(cur[0], cur[1], mouthReach)) break;
    const d0 = toMouth(cur[0], cur[1]);
    let best = null, bestScore = Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur[0] + dx, nz = cur[1] + dz;
      if (!inGrid(nx, nz) || seen[nx + nz * size] || middle(nx, nz)) continue;
      const wob = ((hash32(`${salt}:${nx}:${nz}`) % 1000) / 1000 - 0.5) * 2 * wobble;
      const score = cellH(nx, nz) + pull * (toMouth(nx, nz) - d0) + wob;
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

// The mountain, before any lava has run down it. See VOLCANO_* above for the shape; what is
// here is the order it is put together in and why.
//
// The coast is warped by noise the way an island's is, but the warp is faded out towards
// the middle: `t` is measured from the warped coast, so a warp that reached the rim would
// raise one side of it two units above the other and leave a step where the outer flank
// met a bowl that had been cut to a round number.
//
// The ridges run down the mountain rather than round it, and they get there without an
// angle: the noise is sampled on the unit direction (x/r, z/r), which is the same point for
// every r along a ray, so whatever it does it does in stripes down the fall line. A share of
// r is added to the sample so they bend on the way down instead of being spokes - and the
// bend is what gives the lava its curves, because a flow finds the valley between two ridges
// and follows it: with straight ridges the flows came out ruled lines from rim to sea. `0.5 - |n|` turns the smooth noise into creases, and `4 t (1 - t)` keeps them off
// the beach and off the rim, where they would notch the one line that has to read clearly.
function volcanoGround(seed, size, N, half) {
  const nRidge = makeSimplex2D(hash32(seed + ':ridge'));
  const nRough = makeSimplex2D(hash32(seed + ':rough'));
  const nCoast = makeSimplex2D(hash32(seed + ':coast'));
  const coast = half * VOLCANO_COAST;
  const rim = Math.max(3, half * VOLCANO_RIM);
  const peak = Math.min(VOLCANO_PEAK_MAX, half * VOLCANO_PEAK);
  const depth = peak * VOLCANO_DEPTH;
  const flank = (t) => peak * (0.4 * t + 0.6 * t * t);
  const H = new Float64Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i - half, z = j - half;
      const r = Math.sqrt(x * x + z * z);
      const nx = x / half, nz = z / half;           // noise in the island's own proportions
      const warp = 0.08 * fbm2(nCoast, nx * 1.9, nz * 1.9, { octaves: 2 }) * smoothstep(0.3, 0.6, r / coast);
      const dw = r / coast + warp;
      const t = clamp((1 - dw) / (1 - rim / coast), 0, 1);
      // The beach is a shelf of its own and not the foot of the cone: the cone alone runs
      // through the band between the waterline and BEACH_MAX in under two cells, which on a
      // coast this long is a line and not a beach. So the first VOLCANO_SHORE of the way up
      // is sand held just under BEACH_MAX, and the cone starts from its back edge.
      let h = -0.25 + 0.55 * smoothstep(0, 0.04, t)
        + flank(clamp((t - VOLCANO_SHORE) / (1 - VOLCANO_SHORE), 0, 1));
      // Both kept off the beach shelf, where a third of a unit either way is the whole
      // difference between sand, meadow and sea.
      const inland = smoothstep(VOLCANO_SHORE * 0.5, VOLCANO_SHORE * 2, t);
      if (r > 0) {
        const ux = x / r, uz = z / r;
        const n = fbm2(nRidge, ux * 3.2 + (r / half) * 2.4, uz * 3.2 - (r / half) * 1.7, { octaves: 3 });
        h += peak * VOLCANO_RIDGE * 4 * t * (1 - t) * (0.5 - Math.abs(n)) * 2 * inland;
      }
      h += peak * VOLCANO_ROUGH * fbm2(nRough, nx * 7, nz * 7, { octaves: 3 }) * (0.15 + 0.85 * inland) * (t > 0 ? 1 : 0);
      h -= 2.2 * smoothstep(1.0, 1.3, dw);             // off the shelf into deep water
      // The bowl, inside the rim: down from the rim's own height to a flat floor.
      if (r < rim) {
        const s = r / rim;
        const up = bump(clamp((s - VOLCANO_POOL) / (1 - VOLCANO_POOL), 0, 1));
        h = flank(1) + 0.3 - depth * (1 - up)
          + peak * VOLCANO_ROUGH * 0.5 * fbm2(nRough, nx * 7, nz * 7, { octaves: 3 }) * up;
      }
      H[i + j * N] = h;
    }
  }
  return { H, rim, peak, depth, pool: rim * VOLCANO_POOL, floor: flank(1) + 0.3 - depth };
}

// The gully under one flow. The same shape of loop as carveRiver, and the same `min`, so two
// flows that cross take the deeper of the two - but measured against `O`, the ground as it
// was before any lava, rather than against H as it is being cut: measured against H, the
// second flow over a crossing would dig a second half-unit under the first.
function carveLava(H, O, N, size, course) {
  const n = course.length;
  const reach = Math.ceil(LAVA_W1 + LAVA_BANK) + 1;
  for (let s = 0; s < n; s++) {
    const [gx, gz] = course[s];
    const w = LAVA_W0 + (LAVA_W1 - LAVA_W0) * (n > 1 ? s / (n - 1) : 1);
    const cx = gx + 0.5, cz = gz + 0.5;
    for (let j = Math.max(0, gz - reach); j <= Math.min(size, gz + reach); j++) {
      for (let i = Math.max(0, gx - reach); i <= Math.min(size, gx + reach); i++) {
        const dx = i - cx, dz = j - cz;
        const k = i + j * N;
        const cut = LAVA_DEPTH * (1 - smoothstep(w, w + LAVA_BANK, Math.sqrt(dx * dx + dz * dz)));
        if (cut <= 0) continue;
        // Never under LAVA_FLOOR - unless the ground was already lower, which is the sea's
        // edge, and a gully is not allowed to raise anything either.
        const t = Math.max(O[k] - cut, Math.min(O[k], LAVA_FLOOR));
        if (t < H[k]) H[k] = t;
      }
    }
  }
}

// How far (x, z) is from a polyline, in corner coordinates, and how far along it the
// nearest point is (0 at the first point, 1 at the last). Squared, which is all the
// comparisons below need and saves a root per segment.
function nearestOnCourse(x, z, pts) {
  let best = Infinity, along = 0;
  for (let s = 0; s < pts.length; s++) {
    const [ax, az] = pts[s];
    const [bx, bz] = pts[Math.min(pts.length - 1, s + 1)];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const u = l2 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0;
    const ex = x - (ax + dx * u), ez = z - (az + dz * u);
    const d2 = ex * ex + ez * ez;
    if (d2 < best) { best = d2; along = pts.length > 1 ? Math.min(1, (s + u) / (pts.length - 1)) : 1; }
  }
  return { d2: best, along };
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
  const fairway = (opts && opts.fairway) || null;
  // No island at all: every corner open sea. For a page that stands in a world without an
  // island of its own - the app on a phone, whose "home" is a free berth of water - so the
  // page's one home-at-the-origin drawing path still has a terrain to draw, and it draws
  // exactly the sea around it. Absent for every real island, which therefore hashes as
  // it always did.
  const open = !!(opts && opts.open);
  // The volcano in the middle of the sea (Plans/vulkaan-in-het-midden.md): a mountain with a
  // crater and lava instead of a hill, a lake and rivers. Absent for every other island, and
  // everything below that it touches is behind it, so those still hash as they always did.
  const volcano = !!(opts && opts.volcano) && !open;
  const N = size + 1, half = size / 2;
  let H = new Float64Array(N * N);
  const nShape = makeSimplex2D(hash32(seed + ':shape'));
  const nCoast = makeSimplex2D(hash32(seed + ':coast'));
  const rng = makeRng(seed).fork('terrain');

  const kHill = rng.int(16);
  const hillDist = 11 + rng.range(0, 4);
  let hillCentre = [DIRS16[kHill][0] * hillDist, DIRS16[kHill][1] * hillDist];
  const kSh = (kHill + (rng.chance(0.5) ? 2 : 14)) % 16;
  const shoulderCentre = [DIRS16[kSh][0] * (hillDist - 2), DIRS16[kSh][1] * (hillDist - 2)];
  const kLake = (kHill + 7 + rng.int(3)) % 16;
  const lakeDist = 8 + rng.range(0, 4);
  let lakeCentre = [DIRS16[kLake][0] * lakeDist, DIRS16[kLake][1] * lakeDist];
  const LAKE_R = 4;
  const coastScale = half * 0.9375;

  const vol = volcano ? volcanoGround(seed, size, N, half) : null;
  if (vol) {
    H = vol.H;
    // Its summit is the crater and it has no lake. The crater stands in for both rather
    // than leaving them undefined, because some readers take a point off these without
    // asking (the fireflies in world.js, which a volcano does not draw anyway).
    hillCentre = [0, 0];
    lakeCentre = [0, 0];
  } else {
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
  }
  H = boxBlur(boxBlur(H, N), N);
  for (let k = 0; k < H.length; k++) H[k] = Math.max(-2.5, Math.round(H[k] * 256) / 256);

  // ---- lava -----------------------------------------------------------------
  // Before the rivers would be, and in their place: a volcano has none. Two flows, leaving
  // the rim at least ninety degrees apart so they never merge into one, each with its mouth
  // two sixteenths of a turn round the coast from where it started - the same trick the
  // rivers use to cross ground rather than drop straight to the nearest shore, turned down
  // because a flow is meant to reach the sea, not wander. A fork of its own, like the
  // rivers', so nothing else here moves if these numbers change.
  const lavaFlows = [];
  let floorQ = 0;
  if (vol) {
    const lr = makeRng(seed).fork('lava');
    const k1 = lr.int(16);
    const k2 = (k1 + 5 + lr.int(7)) % 16;
    const coast = half * VOLCANO_COAST;
    for (const k of [k1, k2]) {
      const side = lr.chance(0.5) ? 1 : -1;
      const kEnd = (k + side * 2 + 16) % 16;
      const start = [
        Math.round(DIRS16[k][0] * vol.rim + half - 0.5),
        Math.round(DIRS16[k][1] * vol.rim + half - 0.5),
      ];
      const mouth = [DIRS16[kEnd][0] * (coast + 2), DIRS16[kEnd][1] * (coast + 2)];
      const course = riverCourse(H, N, size, start, mouth, {
        keep: vol.rim - 1.5, mouthReach: 1, salt: 'lava', pull: LAVA_PULL, wobble: LAVA_WOBBLE,
      });
      if (course.length >= 6) lavaFlows.push(course);
    }
    const O = H.slice();
    for (const course of lavaFlows) carveLava(H, O, N, size, course);
    // The crater floor, made exactly flat after the blur has rounded it, so that the pool
    // drawn on it is one level and nothing of the ground pokes up through the lava.
    floorQ = Math.round(vol.floor * 256) / 256;
    const poolR = vol.pool + 0.5;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = i - half, z = j - half;
        if (x * x + z * z < poolR * poolR && H[i + j * N] > floorQ) H[i + j * N] = floorQ;
      }
    }
    for (let k = 0; k < H.length; k++) H[k] = Math.max(-2.5, Math.round(H[k] * 256) / 256);
  }

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
  const sides = vol ? [] : rr.chance(0.55) ? [1, -1] : [rr.chance(0.5) ? 1 : -1];
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

  // ---- the fairway ----------------------------------------------------------
  // Dug before the polders, and for the same reason the rivers are: where a sea wall and a
  // channel want the same cell the wall has to win, or a polder gets a hole in it that
  // nothing on the island would ever fill. In practice they never meet - `planFairway`
  // refuses every cell a polder already holds - but the ordering is what makes that a
  // belt and not the only brace.
  //
  // `min` on each of the four corners rather than `setCell`'s flat assignment: a dredger
  // that *raised* the bottom of the deep water it crosses would build the bar it was sent
  // to remove, and a cell is four corners shared with its neighbours, so lowering the
  // whole cell is what leaves a channel with sides instead of a row of pits.
  const dig = (gx, gz) => {
    if (gx < 0 || gz < 0 || gx >= size || gz >= size) return;
    for (const k of [gx + gz * N, gx + 1 + gz * N, gx + (gz + 1) * N, gx + 1 + (gz + 1) * N]) {
      if (H[k] > CHANNEL_H) H[k] = CHANNEL_H;
    }
  };
  if (fairway) for (const c of fairway.cells || []) dig(c[0], c[1]);

  for (const p of polders) {
    for (const c of p.cells || []) setCell(c[0], c[1], POLDER_H);
    // Water the works cornered. A dike drawn round whole super-cells leaves wedges of
    // sea between the new wall and the old shore that the tide can no longer reach, and
    // they read as puddles in somebody's front garden. They are filled to the height of
    // the polder itself: they lie outside the wall, so they are shore rather than
    // meadow, but they are dry. Which cells those are is decided once in lib/layout.mjs
    // and written into the polder, never worked out here - a polder planned before this
    // existed has no `pools`, carves exactly the ground it always carved, and so hashes
    // the same. That is what keeps an island that already has one from being replanned
    // from nothing the first time it runs this code.
    for (const c of p.pools || []) setCell(c[0], c[1], POLDER_H);
    for (const c of p.dike || []) setCell(c[0], c[1], DIKE_H);
  }

  if (open) H.fill(-2.5);

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
  const buildableGround = (gx, gz) =>
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

  // Which cells are lava, which are the basalt either side of it, and which are the crater.
  // Measured off the course the way the gully was cut - a cell whose middle lies within the
  // flow's own half-width of it, plus LAVA_REACH so that a flow's corners are not a
  // checkerboard of safe cells - and then only where the ground is genuinely above the
  // water, so that the last cell of a flow is never one whose corner the sea has already
  // taken: that is where the steam is, and hurting somebody for standing in the surf would
  // be the one place the rule is felt to be wrong. The pool on the crater floor is lava too.
  //
  // Every island carries these, empty, so a caller on the sea can ask `isLava` of any
  // terrain without asking first whether it is the volcano.
  const lavaMask = new Uint8Array(size * size);
  const bankMask = new Uint8Array(size * size);
  const craterMask = new Uint8Array(size * size);
  const lavaCells = [], lavaBankCells = [];
  let crater = null;
  if (vol) {
    crater = { centre: [0, 0], r: vol.rim, floor: floorQ, pool: vol.pool };
    const lines = lavaFlows.map((course) => course.map(([gx, gz]) => [gx + 0.5, gz + 0.5]));
    const aboveSea = (gx, gz) => {
      const c = cornersOf(gx, gz);
      return c[0] > SEA_LEVEL && c[1] > SEA_LEVEL && c[2] > SEA_LEVEL && c[3] > SEA_LEVEL;
    };
    for (let gz = 0; gz < size; gz++) {
      for (let gx = 0; gx < size; gx++) {
        const k = gx + gz * size;
        const [x, z] = cellWorld(gx, gz);
        const r2 = x * x + z * z;
        if (r2 < (vol.rim + 1) * (vol.rim + 1)) craterMask[k] = 1;
        if (r2 < vol.pool * vol.pool) { lavaMask[k] = 1; continue; }
        if (!aboveSea(gx, gz)) continue;
        for (const line of lines) {
          const { d2, along } = nearestOnCourse(gx + 0.5, gz + 0.5, line);
          const w = LAVA_W0 + (LAVA_W1 - LAVA_W0) * along;
          const lava = w + LAVA_REACH, bank = w + LAVA_BANK;
          if (d2 < lava * lava) lavaMask[k] = 1;
          else if (d2 < bank * bank) bankMask[k] = 1;
        }
      }
    }
    for (let gz = 0; gz < size; gz++) {
      for (let gx = 0; gx < size; gx++) {
        const k = gx + gz * size;
        if (lavaMask[k]) { bankMask[k] = 0; lavaCells.push([gx, gz]); } else if (bankMask[k]) lavaBankCells.push([gx, gz]);
      }
    }
  }
  const isLava = (gx, gz) => (inGrid(gx, gz) ? lavaMask[gx + gz * size] === 1 : false);
  // Nothing is built in lava, on the basalt beside it or in the crater. The rest of the
  // mountain is ordinary ground, and the sea will want the lower flank for houses.
  const isBuildable = vol
    ? (gx, gz) => buildableGround(gx, gz) && !lavaMask[gx + gz * size] && !bankMask[gx + gz * size] && !craterMask[gx + gz * size]
    : buildableGround;

  return {
    size, N, half, H, seed,
    hillCentre, lakeCentre,
    heightAt, slope, isLand, isWater, isBeach, isBuildable, worldHeight, cellWorld, inGrid, corner,
    landCells, beachCells, coastCells,
    rivers: courses, riverCells, riverBankCells, isRiver,
    volcano, crater, lavaFlows, lavaCells, lavaBankCells, isLava,
    fairway,
    hash: hashHeights(H),
  };
}

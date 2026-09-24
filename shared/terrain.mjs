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
// Every length is a share of `half`, so the same mountain comes out at 64 as at 192 and
// only the test at 192 (shared/volcano.mjs VOLCANO.size) is the one it was drawn for. The
// first cut was a 128-grid cone 15.3 high with a 9-cell crater 3.8 deep and ridges that
// stood half a unit off the mean - from the next island it read as a pudding. At 192:
//
//   - the coast lies at about r = 76 (VOLCANO_COAST of half, less the beach's own reach),
//     with a shelf of sand about four cells deep (VOLCANO_SHORE), and the grid edge is open
//     water on every side;
//   - then the apron: foothills climbing gently to VOLCANO_APRON_H, just under
//     BUILD_HEIGHT_MAX, over the first VOLCANO_APRON of the way in. That ring is where the
//     guardhouse and the Codex houses stand (shared/volcano.mjs), and it is a number of its
//     own rather than the foot of the cone because a concave cone steep enough to stand 40
//     high has no foot flat enough to build on;
//   - the cone rises out of it, concave like every stratovolcano (0.3 s + 0.7 s^2 of the
//     climb), to a rim at r = 14 (VOLCANO_RIM) about 38 up (VOLCANO_PEAK, capped at
//     VOLCANO_PEAK_MAX) - 150 m of mountain at four metres a unit;
//   - the crater is a bowl about 10 deep with a flat floor across its inner 40%, which is a
//     lava pool;
//   - and on all of it the relief (volcanoRelief, below): radial ridges and V-shaped
//     ravines, broken cliff bands on the upper cone, crags, a jagged rim breached where each
//     flow leaves it, parasitic cones on the lower cone and hummocky fields of old lava.
//
// That is a climb and not a wall for anybody walking - A* in shared/settlerwalk.mjs prices
// slope, it never refuses it, and a settler's walk has no slope rule at all - but it is a
// wall for building, which is the point: only the apron is ground a house can stand on.
//
// Squares are the only powers: `pow` is one of the functions this module may not call.
const VOLCANO_COAST = 0.80;        // coast radius, as a share of half
const VOLCANO_RIM = 0.15;          // crater rim radius, as a share of half
const VOLCANO_PEAK = 0.40;         // rim height, as a share of half...
const VOLCANO_PEAK_MAX = 44;       // ...capped, or a 512 grid is a pillar in the sky
const VOLCANO_DEPTH = 0.27;        // crater depth, as a share of the rim height
const VOLCANO_POOL = 0.4;          // the flat floor, as a share of the rim radius
const VOLCANO_SHORE = 0.06;        // the beach shelf, as a share of the way from coast to rim
const VOLCANO_APRON = 0.3;         // where the foothills have finished rising, of the same way
// The apron's height, in units rather than as a share: it is measured against
// BUILD_HEIGHT_MAX (4.2), which is a unit too, and a share would put the whole apron over
// the line on a big grid and leave the sea nowhere to build.
const VOLCANO_APRON_H = 3.1;
const VOLCANO_CONE = 0.26;         // where the cone starts to rise out of the apron
const VOLCANO_RIDGE = 0.08;        // how high the radial ridges stand, of the peak
const VOLCANO_RAVINE = 0.09;       // how deep the ravines between them cut, of the peak
const VOLCANO_CRAG = 0.05;         // the crags on the upper cone, of the peak
const VOLCANO_JAG = 0.06;          // how far the rim wanders up and down, of the peak
const VOLCANO_BREACH = 0.13;       // how deep the rim is notched where a flow leaves it, of the peak
const VOLCANO_TERRACE = 4;         // the height of one cliff band, in units
const VOLCANO_ROUGH = 0.012;       // plain bumpiness, everywhere there is land, of the peak
const VOLCANO_VENTS = 3;           // parasitic cones on the lower cone

// The lava. A flow runs from a cell on the rim to a mouth a little round the coast, like a
// river from its source (the route is `lavaCourse`, below) - but it is not carved the way a river is: a
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
// How a flow bends on its way down (lavaCourse). Cells throughout, measured sideways off the
// line a flow would take if it did not bend at all.
const LAVA_BEND_GAP = [9, 14];     // cells of descent from one bend to the next
const LAVA_BEND = [5, 8];          // how far a bend swings out, to alternate sides
const LAVA_SWING = 9;              // the furthest a flow may stray from its line, either side
const LAVA_SETTLE = 6;             // cells below the rim before it may swing at all
const LAVA_KEEP_BEND = 0.12;       // cost per cell^2 of straying from the bend it was given
const LAVA_KEEP_SMOOTH = 0.35;     // cost per cell^2 of stepping sideways, so it curves, not zigzags
const LAVA_VALLEY = 1;             // weight of the ground: a unit lower than its ring is a unit cheaper
// How much of the way down the flow's line has finished turning towards its mouth. All of it
// at 1, and the last of the turn fell on the beach shelf, where the line ran along the coast
// for ten cells before the sea took it; done by 70% the last stretch runs straight out.
const LAVA_SWEEP = 0.7;

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
// Lava used to be routed through here too, with options for a smaller keep, a shorter mouth
// reach and a weaker pull. It no longer is (see lavaCourse): a greedy walk on a cone goes
// down the fall line whatever the pull, because every step down the mountain outscores any
// step across it, and the flows came out as ruled lines. The river numbers are back to
// being the only ones, as literals, so a river is routed exactly as it always was.
function riverCourse(H, N, size, start, mouth) {
  const keep = RIVER_CENTRE_KEEP, mouthReach = RIVER_MOUTH_REACH, salt = 'river';
  const pull = RIVER_PULL, wobble = RIVER_WOBBLE;
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

// The mountain's big shape, before the relief and before any lava has run down it: beach
// shelf, apron, cone and bowl, all smooth, because this is what makeTerrain blurs like any
// other island's ground. See VOLCANO_* above for the numbers.
//
// The coast is warped by noise the way an island's is, but the warp is faded out towards
// the middle: `t` is measured from the warped coast, so a warp that reached the rim would
// raise one side of it two units above the other and leave a step where the outer flank
// met a bowl that had been cut to a round number.
function volcanoGround(seed, size, N, half) {
  const nCoast = makeSimplex2D(hash32(seed + ':coast'));
  const coast = half * VOLCANO_COAST;
  const rim = Math.max(3, half * VOLCANO_RIM);
  const peak = Math.min(VOLCANO_PEAK_MAX, half * VOLCANO_PEAK);
  const depth = peak * VOLCANO_DEPTH;
  // The way from the coast (t = 0) to the rim (t = 1), as heights: sand, apron, cone. The
  // apron is eased in and out so it has no edge, and the cone starts inside it at no slope
  // of its own, so there is no crease where the foothills stop and the mountain starts.
  const profile = (t) => {
    const s = clamp((t - VOLCANO_CONE) / (1 - VOLCANO_CONE), 0, 1);
    return -0.25 + 0.55 * smoothstep(0, 0.04, t)
      + (VOLCANO_APRON_H - 0.3) * smoothstep(VOLCANO_SHORE, VOLCANO_APRON, t)
      + (peak - VOLCANO_APRON_H) * (0.3 * s + 0.7 * s * s);
  };
  const top = profile(1);
  const H = new Float64Array(N * N);
  const T = new Float64Array(N * N);                 // t per corner, for the relief
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i - half, z = j - half;
      const r = Math.sqrt(x * x + z * z);
      const nx = x / half, nz = z / half;           // noise in the island's own proportions
      const warp = 0.08 * fbm2(nCoast, nx * 1.9, nz * 1.9, { octaves: 2 }) * smoothstep(0.3, 0.6, r / coast);
      const dw = r / coast + warp;
      const t = clamp((1 - dw) / (1 - rim / coast), 0, 1);
      // The beach is a shelf of its own and not the foot of the cone: the slope alone runs
      // through the band between the waterline and BEACH_MAX in under two cells, which on a
      // coast this long is a line and not a beach. So the first VOLCANO_SHORE of the way up
      // is sand held just under BEACH_MAX, and the apron starts from its back edge.
      let h = profile(t);
      h -= 2.2 * smoothstep(1.0, 1.3, dw);             // off the shelf into deep water
      // The bowl, inside the rim: down from the rim's own height to a flat floor.
      if (r < rim) {
        const s = r / rim;
        const up = bump(clamp((s - VOLCANO_POOL) / (1 - VOLCANO_POOL), 0, 1));
        h = top + 0.3 - depth * (1 - up);
      }
      H[i + j * N] = h;
      T[i + j * N] = t;
    }
  }
  return { H, T, coast, rim, peak, depth, pool: rim * VOLCANO_POOL, floor: top + 0.3 - depth };
}

// Where the parasitic cones stand: VOLCANO_VENTS of them on the lower cone, on bearings the
// lava leaves alone. A flow starts on its own bearing and swings two sixteenths towards its
// side on the way down, so those three bearings and one more beyond them (its bends swing
// it up to nine cells further) are taken; the vents go on what is left, the first at random and each after it as far round from the others as it
// can get. Their own fork of the seed, so nothing else moves if these numbers do.
function volcanoVents(seed, vol, flows) {
  const vr = makeRng(seed).fork('vents');
  const taken = new Uint8Array(16);
  for (const { k, side } of flows) {
    for (let s = 0; s <= 3; s++) taken[(k + side * s + 32) % 16] = 1;
  }
  const free = [];
  for (let k = 0; k < 16; k++) if (!taken[k]) free.push(k);
  const gap = (a, b) => { const d = Math.abs(a - b) % 16; return d > 8 ? 16 - d : d; };
  const picked = [];
  while (picked.length < VOLCANO_VENTS && free.length) {
    let best = -1, bestGap = -1;
    if (!picked.length) best = free[vr.int(free.length)];
    else {
      for (const k of free) {
        let g = 16;
        for (const p of picked) g = Math.min(g, gap(k, p));
        if (g > bestGap) { bestGap = g; best = k; }
      }
      if (bestGap < 2) break;
    }
    picked.push(best);
    free.splice(free.indexOf(best), 1);
  }
  const span = vol.coast - vol.rim;
  return picked.map((k) => {
    const t = vr.range(0.36, 0.5);
    const r = vol.coast - t * span;
    const R = span * vr.range(0.075, 0.1);         // its foot, in cells
    return {
      x: DIRS16[k][0] * r, z: DIRS16[k][1] * r, r: R,
      h: vol.peak * vr.range(0.1, 0.15),           // how high it stands off the flank
      pit: R * 0.38,                               // its own little crater
    };
  });
}

// The relief, on the blurred ground: everything that makes the mountain rugged rather than
// a smooth cone with creases in it. After the blur and not before it, because two box
// blurs take out every feature a few cells across, which is exactly the size a ravine, a
// crag or a cliff band is. In order:
//
//   - Radial ridges and ravines. They run down the mountain rather than round it, and they
//     get there without an angle: the noise is sampled on the unit direction (x/r, z/r),
//     which is the same point for every r along a ray, so whatever it does it does in
//     stripes down the fall line. A share of r is added to the sample, and a domain warp
//     over the whole island, so they bend and branch on the way down instead of being
//     spokes - and the bends are what give the lava its curves, because a flow finds the
//     valley between two ridges and follows it: with straight ridges the flows came out
//     ruled lines from rim to sea. `1 - |n|`, squared, is a sharp crest on a broad back; a
//     narrow `1 - 5|n|` of a second noise is a V cut into it, which is a ravine. Both grow
//     up the cone and are faded off the apron, where they would eat the building ground,
//     and eased near the rim, which has relief of its own.
//   - The rim: wandering up and down round the circle, crags on it, and a breach where
//     each flow leaves - measured as the dot product of the direction with the flow's own
//     bearing, which is the cosine without asking for one. Faded out down the outer flank
//     and down the bowl wall, never onto the floor, which is flattened to one level later.
//   - The parasitic cones (volcanoVents), each with a pit in its top.
//   - Cliff bands on the upper cone: the height is terraced - a bench, then a riser - and
//     blended in through a noise mask, so the bands are broken ledges rather than contour
//     rings painted round the whole mountain.
//   - Crags: a thresholded noise, so what comes out is separate spikes of rock, not a
//     bumpy blanket.
//   - Old lava fields: a patch mask over the cone and the top of the apron, hummocky ground
//     inside it. The mask is handed back per corner (0..255) so web/js/world.js paints the
//     same patches dark that are rough here.
//
// Only + - * /, floor, abs, sqrt and the simplex noise, like the rest of this module.
function volcanoRelief(H, vol, seed, size, N, half, flows, vents) {
  const nRidge = makeSimplex2D(hash32(seed + ':ridge'));
  const nRavine = makeSimplex2D(hash32(seed + ':ravine'));
  const nWarp = makeSimplex2D(hash32(seed + ':warp'));
  const nRim = makeSimplex2D(hash32(seed + ':rim'));
  const nBand = makeSimplex2D(hash32(seed + ':band'));
  const nCrag = makeSimplex2D(hash32(seed + ':crag'));
  const nField = makeSimplex2D(hash32(seed + ':field'));
  const nRough = makeSimplex2D(hash32(seed + ':rough'));
  const { rim, peak, pool, T } = vol;
  const fields = new Uint8Array(N * N);
  const breach = flows.map(({ k }) => DIRS16[k]);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = i + j * N;
      const t = T[k];
      if (t <= 0) continue;                          // the sea keeps its floor
      const x = i - half, z = j - half;
      const r = Math.sqrt(x * x + z * z);
      const nx = x / half, nz = z / half;
      const inland = smoothstep(VOLCANO_SHORE * 0.5, VOLCANO_SHORE * 2, t);
      const cone = smoothstep(VOLCANO_CONE - 0.02, VOLCANO_CONE + 0.2, t);
      let h = H[k];
      h += peak * VOLCANO_ROUGH * fbm2(nRough, nx * 7, nz * 7, { octaves: 3 }) * (0.15 + 0.85 * inland);
      if (r > 0.5) {
        const ux = x / r, uz = z / r;
        const wx = 0.4 * fbm2(nWarp, nx * 2.3, nz * 2.3, { octaves: 2 });
        const wz = 0.4 * fbm2(nWarp, nx * 2.3 + 17.3, nz * 2.3 - 9.1, { octaves: 2 });
        const along = r / half;
        // Ridges and ravines, outside the bowl.
        if (r >= rim) {
          const n1 = fbm2(nRidge, ux * 3.0 + along * 2.2 + wx, uz * 3.0 - along * 1.6 + wz, { octaves: 2, gain: 0.3 });
          const a = Math.max(0, 1 - Math.abs(n1) * 1.5);
          const n2 = nRavine(ux * 2.3 + along * 1.4 + wz, uz * 2.3 + along * 2.1 - wx);
          const v = Math.max(0, 1 - Math.abs(n2) * 3.2);
          const amp = peak * cone * (0.55 + 0.45 * t) * (1 - 0.6 * smoothstep(0.9, 1, t));
          h += amp * (VOLCANO_RIDGE * (a * a - 0.3) - VOLCANO_RAVINE * v * v);
        }
        // The rim: jagged, crowned with crags, breached by every flow.
        const nearRim = r < rim ? smoothstep(pool, rim, r) : 1 - smoothstep(rim, rim + 9, r);
        if (nearRim > 0) {
          let d = peak * VOLCANO_JAG * fbm2(nRim, ux * 2.6, uz * 2.6, { octaves: 3 });
          d += peak * VOLCANO_JAG * 1.6 * Math.max(0, fbm2(nRim, ux * 7 + 31.7, uz * 7 - 5.3, { octaves: 2 }) - 0.1);
          for (const [bx, bz] of breach) {
            const c = ux * bx + uz * bz;             // cos of the angle to the flow's bearing
            d -= peak * VOLCANO_BREACH * smoothstep(0.955, 0.995, c);
          }
          h += d * nearRim;
        }
      }
      // The parasitic cones, and the pit in each.
      for (const v of vents) {
        const dx = x - v.x, dz = z - v.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d >= v.r) continue;
        h += v.h * bump(1 - d / v.r);
        if (d < v.pit) h -= v.h * 0.7 * bump(1 - d / v.pit);
      }
      // Cliff bands on the upper cone, broken up by a mask.
      if (r >= rim) {
        const band = smoothstep(peak * 0.22, peak * 0.34, h) * (1 - smoothstep(peak * 0.9, peak, h));
        const mask = smoothstep(0.05, 0.35, fbm2(nBand, nx * 3.4, nz * 3.4, { octaves: 2 }));
        const w = 0.55 * band * mask;
        if (w > 0) {
          const q = h / VOLCANO_TERRACE, f = Math.floor(q);
          const ter = (f + smoothstep(0.5, 0.85, q - f)) * VOLCANO_TERRACE;
          h += (ter - h) * w;
        }
        // Crags: separate spikes on the upper half of the cone.
        const c = fbm2(nCrag, nx * 10, nz * 10, { octaves: 2 });
        h += peak * VOLCANO_CRAG * Math.max(0, c - 0.46) * 6 * smoothstep(0.4, 0.6, t);
      }
      // Old lava fields: hummocky ground in patches.
      const fm = smoothstep(0.1, 0.28, fbm2(nField, nx * 2.7, nz * 2.7, { octaves: 2 }))
        * smoothstep(VOLCANO_CONE - 0.06, VOLCANO_CONE + 0.06, t) * (1 - smoothstep(0.8, 0.9, t));
      if (fm > 0) {
        h += 0.35 * fm * fbm2(nField, nx * 18 + 3.1, nz * 18 - 7.7, { octaves: 2 });
        fields[k] = Math.round(fm * 255);
      }
      H[k] = h;
    }
  }
  return fields;
}

// Where one lava flow runs, from the rim cell in direction `d0` to the sea round the coast in
// direction `d1` (unit vectors off DIRS16).
//
// Not a greedy walk. That was tried first, as riverCourse with a weaker pull and a stronger
// wobble, and on a cone it cannot bend: every step down the mountain gains more than any step
// across it, so however the pull and the wobble were tuned the flow went down the fall line,
// 52 cells with a sideways spread of five, and read from orbit as two ruled lines. So the flow
// is chosen whole, as a curve:
//
//   - the line it would take without bending is a gentle spiral, the direction swept from d0
//     to d1 while the radius climbs from the rim to the mouth one cell per step;
//   - off that line it is given bends: a target that swings to alternate sides every
//     LAVA_BEND_GAP cells by LAVA_BEND, drawn from `rng` so that each flow bends its own way
//     and nothing else on the island moves if these numbers change;
//   - and the ground decides the rest. A dynamic programme over every sideways offset (half a
//     cell apart, up to LAVA_SWING) at every step picks the one curve that is cheapest in
//     straying from its bend, stepping sideways, and standing high. "High" is measured
//     against the mean of the ground at the same radius, not against the ground itself - the
//     cone falls away sideways off a spiral too, and a flow drawn to the lowest ground would
//     just slide round the mountain - so what pulls it is the valleys between the ridges,
//     which is what a flow follows.
//
// A step moves at most one cell sideways per cell down, and the swing allowed at each step
// (LAVA_SWING, eased in over LAVA_SETTLE) is always less than the radius there - at 64 as at
// 128 - so the distance from the crater grows every step: the flow never turns back up the
// mountain, and the staircase of cells it rasterises to does not run into itself. The first
// LAVA_SETTLE cells are held to the line and the bends are grown into over the upper flank, so
// the flow leaves the rim going down it and not along the crater's lip.
//
// The staircase stops where a river's would: on the first cell under water, or the first
// beach cell with the sea one cell off - the steam where it meets the sea is the point. The
// arithmetic is +, -, *, / and sqrt, and ties go to the lower index, so both runtimes pick the
// same curve. Measured at 128 on the sea's own seed: 66 and 69 cells (they were 52 and 53),
// straying up to ten cells either side of the straight line from rim to mouth (was five), three
// bends each. On the 192-grid volcano, rugged and with three flows: 97, 93 and 89 cells, 516
// lava cells, each turning three to five times on the way down, and they have found the
// ravines - which is where a flow should run.
function lavaCourse(H, N, size, vol, d0, d1, mouthR, reachR, rng) {
  const half = size / 2;
  const rim = vol.rim;
  const inGrid = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size;
  const cellH = (gx, gz) =>
    0.25 * (H[gx + gz * N] + H[gx + 1 + gz * N] + H[gx + (gz + 1) * N] + H[gx + 1 + (gz + 1) * N]);
  const seaWithin = (gx, gz, r) => {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = gx + dx, nz = gz + dz;
        if (!inGrid(nx, nz) || cellH(nx, nz) < SEA_LEVEL) return true;
      }
    }
    return false;
  };
  // The ground at a world point, bilinear over the corners, as worldHeight reads it.
  const ground = (x, z) => {
    const fx = clamp(x + half, 0, size - 1e-6), fz = clamp(z + half, 0, size - 1e-6);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = H[i + j * N], b = H[i + 1 + j * N], c = H[i + (j + 1) * N], d = H[i + 1 + (j + 1) * N];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
  // The mean of the ground in rings half a cell wide: the mountain with its ridges averaged out.
  const BIN = 2;
  const nb = Math.ceil(half * 1.5 * BIN) + 1;
  const sum = new Float64Array(nb), cnt = new Float64Array(nb);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i - half, z = j - half;
      const b = Math.min(nb - 1, Math.floor(Math.sqrt(x * x + z * z) * BIN));
      sum[b] += H[i + j * N]; cnt[b] += 1;
    }
  }
  const ring = (r) => { const b = Math.min(nb - 1, Math.floor(r * BIN)); return cnt[b] ? sum[b] / cnt[b] : 0; };

  const n = Math.ceil(reachR - rim);
  const sweep = (mouthR - rim) * LAVA_SWEEP;
  const axis = (i) => {
    const s = Math.min(1, i / sweep);
    const ux = d0[0] + (d1[0] - d0[0]) * s, uz = d0[1] + (d1[1] - d0[1]) * s;
    const L = Math.sqrt(ux * ux + uz * uz);
    return [ux / L, uz / L];
  };
  // (x, z) of step i at sideways offset l: out along the axis to its radius, then across it.
  const pointAt = (i, l) => { const [ux, uz] = axis(i); const R = rim + i; return [ux * R - uz * l, uz * R + ux * l]; };

  // The bends: a waypoint every LAVA_BEND_GAP cells, alternating sides, eased between.
  const target = new Float64Array(n + 1);
  let side = rng.chance(0.5) ? 1 : -1;
  let pi = 0, pl = 0;
  while (pi < n) {
    const ni = pi + rng.range(LAVA_BEND_GAP[0], LAVA_BEND_GAP[1]);
    const nl = side * rng.range(LAVA_BEND[0], LAVA_BEND[1]);
    for (let i = Math.ceil(pi); i <= Math.min(n, Math.floor(ni)); i++) target[i] = pl + (nl - pl) * bump((i - pi) / (ni - pi));
    pi = ni; pl = nl; side = -side;
  }
  // Grown into over the upper flank. A cell sideways is a far bigger turn at the rim, nine
  // cells out, than at the coast: given the full swing at once the first bend left the rim
  // nearly along it, a dead-straight run round the crater's lip before it ever went down.
  for (let i = 0; i <= n; i++) target[i] *= smoothstep(0, 3 * LAVA_SETTLE, i);

  const J = 2 * LAVA_SWING, nj = 2 * J + 1;      // offsets -LAVA_SWING..+LAVA_SWING, half a cell apart
  let cost = new Float64Array(nj).fill(Infinity);
  cost[J] = 0;                                   // step 0 is the rim cell itself, on the line
  const back = [null];
  for (let i = 1; i <= n; i++) {
    const env = LAVA_SWING * smoothstep(0, LAVA_SETTLE, i);
    const next = new Float64Array(nj).fill(Infinity);
    const from = new Int16Array(nj).fill(-1);
    for (let j = 0; j < nj; j++) {
      const l = (j - J) * 0.5;
      if (Math.abs(l) > env + 1e-9) continue;
      let best = Infinity, bk = -1;
      for (let k = Math.max(0, j - 2); k <= Math.min(nj - 1, j + 2); k++) {
        if (cost[k] === Infinity) continue;
        const dl = (j - k) * 0.5;
        const c = cost[k] + LAVA_KEEP_SMOOTH * dl * dl;
        if (c < best) { best = c; bk = k; }
      }
      if (bk < 0) continue;
      const [x, z] = pointAt(i, l);
      const off = l - target[i];
      next[j] = best + LAVA_KEEP_BEND * off * off + LAVA_VALLEY * (ground(x, z) - ring(Math.sqrt(x * x + z * z)));
      from[j] = bk;
    }
    back.push(from);
    cost = next;
  }
  let jEnd = J;
  for (let j = 0; j < nj; j++) if (cost[j] < cost[jEnd]) jEnd = j;
  const lat = new Float64Array(n + 1);
  for (let i = n, j = jEnd; i >= 0; i--) { lat[i] = (j - J) * 0.5; if (i > 0) j = back[i][j]; }
  // The programme prices a sideways step, not a change of heading, so what it hands back is
  // straight runs joined at corners - a flow that read as a line of dog-legs from above.
  // Two passes of a small kernel round the corners off. A mean of neighbouring offsets is
  // never steeper than the steepest of them, so the curve still moves at most one cell across
  // per cell down, and it still leaves the rim on the line.
  for (let pass = 0; pass < 4; pass++) {
    const was = lat.slice();
    for (let i = 1; i <= n; i++) {
      let s = 0, w = 0;
      for (let d = -2; d <= 2; d++) {
        const k = Math.min(n, Math.max(0, i + d)), c = 3 - (d < 0 ? -d : d);
        s += was[k] * c; w += c;
      }
      lat[i] = s / w;
    }
  }

  // Down the curve a fifth of a cell at a time, into four-connected cells: a diagonal step
  // gets the lower of the two cells beside it, which is the way the lava would spill.
  // A curve that comes back into a cell it already crossed (a tight bend's corner cells can)
  // cuts the little loop off rather than leaving a gap in the chain: `at` is each cell's place
  // in the course, plus one.
  const course = [];
  const at = new Int32Array(size * size);
  let done = false, ashore = false, last = null;
  const add = (gx, gz) => {
    if (!inGrid(gx, gz)) { done = true; return; }
    last = [gx, gz];
    const k = gx + gz * size;
    if (at[k]) {
      while (course.length > at[k]) { const [ox, oz] = course.pop(); at[ox + oz * size] = 0; }
      return;
    }
    course.push(last);
    at[k] = course.length;
    const h = cellH(gx, gz);
    if (h < SEA_LEVEL || (h < BEACH_MAX && seaWithin(gx, gz, 1))) done = true;
    else if (h < BEACH_MAX || seaWithin(gx, gz, 3)) ashore = true;
  };
  const SUB = 5;
  for (let i = 0; i < n && !done && !ashore; i++) {
    const [ax, az] = pointAt(i, lat[i]), [bx, bz] = pointAt(i + 1, lat[i + 1]);
    for (let q = 0; q < SUB && !done && !ashore; q++) {
      const gx = Math.floor(ax + (bx - ax) * (q / SUB) + half), gz = Math.floor(az + (bz - az) * (q / SUB) + half);
      if (last && gx === last[0] && gz === last[1]) continue;
      if (last && gx !== last[0] && gz !== last[1]) {
        const a = [gx, last[1]], b = [last[0], gz];
        const pick = !inGrid(b[0], b[1]) || (inGrid(a[0], a[1]) && cellH(a[0], a[1]) <= cellH(b[0], b[1])) ? a : b;
        add(pick[0], pick[1]);
        if (done || ashore) break;
      }
      add(gx, gz);
    }
  }
  // On the sand the curve is done with: it was drawn for a coast at one radius, the real one
  // is warped in and out, and following it on over a shelf three cells deep ran the flow along
  // the beach for a dozen cells and back again. From the first beach cell it goes straight
  // down to the water, the lowest neighbour each step, which on the shelf is a few cells.
  for (let step = 0; last && !done && step < 12; step++) {
    let best = null, bestH = Infinity;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = last[0] + dx, nz = last[1] + dz;
      if (!inGrid(nx, nz) || at[nx + nz * size]) continue;
      const h = cellH(nx, nz);
      if (h < bestH) { bestH = h; best = [nx, nz]; }
    }
    if (!best) break;
    add(best[0], best[1]);
  }
  return course;
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

// ---- growing ----------------------------------------------------------------------------
// An island grows by accretion, never by being worked out again at a bigger size: every
// corner that was land stays exactly the height it was, and what is added is sea that has
// become ground - the way a polder is, except shaped like a bigger island of the same seed
// rather than walled and flat. Plans/eiland-laten-groeien.md has the argument.
//
// A step is a radius - where the coast of the bigger island lies, in cells, exactly what
// `coastScale` is for an island founded on a grid (half * 0.9375) - and `hold`, the cells
// something stood on when it was taken, in local coordinates (gx - half) so that growing
// the grid round them later does not move them. A bare number is a step holding nothing. Its ground comes from
// the founding formula with that radius in place of the grid's, and the one condition that
// makes it independent of the grid it is drawn on is that the grid's edge lies in water deep
// enough to be flat: past dw = 1.35 every corner is exactly -2.5 before the blur, so the
// blur there averages equal numbers and gives them back unchanged. With the coast noise at
// most 0.18 either way, that is 1.53 radii out, and the blur reaches two corners further.
const GROW_REACH = 1.53;
const GROW_EDGE = 4;
// How a new strip rises from the old shore: a corner next to the old land is at most this
// high, and every corner further out may rise this much more, until the bigger island's own
// ground is lower than that. Without the ramp the new land starts at the bigger island's
// height at that radius - its inland, a metre and more up - and the old beach becomes the
// foot of a wall.
const GROW_SHORE = BEACH_MAX + 0.05;
const GROW_RISE = 0.18;
// Rivers keep their banks: nothing within this many corners of a founding river's course
// is accreted, or the first ring of new ground would fill the river bed to beach height.
const GROW_RIVER_KEEP = 4;

// The founding coast of a grid, in the same units as a step.
export function foundingCoast(size) { return (size / 2) * 0.9375; }
// The smallest grid a coast of `r` may be drawn on without the grid's edge showing in it.
export function gridForCoast(r) { return 2 * (Math.ceil(GROW_REACH * r) + GROW_EDGE); }

function checkGrow(grow, size) {
  const base = grow.base;
  const steps = Array.isArray(grow.steps) ? grow.steps : [];
  if (!Number.isInteger(base) || base < 16 || base > size || (size - base) % 2) {
    throw new Error(`an island founded on ${base} cannot be drawn on a grid of ${size}`);
  }
  let last = foundingCoast(base);
  const out = [];
  for (const s of steps) {
    const r = typeof s === 'number' ? s : s && s.r;
    const hold = (s && typeof s === 'object' && Array.isArray(s.hold)) ? s.hold : [];
    if (!(typeof r === 'number' && r > last)) throw new Error(`a growth step of ${r} does not grow the island`);
    if (gridForCoast(r) > size) throw new Error(`a coast of ${r} needs a grid of ${gridForCoast(r)}, not ${size}`);
    out.push({ r, hold });
    last = r;
  }
  return { base, steps: out };
}

// The founding grid set down in the middle of a bigger one. What lies outside it is open
// sea, which is what the founding grid's own edge already treated it as.
function embed(H0, base, size) {
  const N0 = base + 1, N = size + 1, k = (size - base) / 2;
  const H = new Float64Array(N * N).fill(-2.5);
  for (let j = 0; j < N0; j++) {
    for (let i = 0; i < N0; i++) H[i + k + (j + k) * N] = H0[i + j * N0];
  }
  return H;
}

// The bigger island's own ground, before any of it is laid: the founding loop with a coast
// of `r` rather than the grid's, the same hill, shoulder and lake (they are measured from
// the middle, not from the edge), blurred the same way.
function groundForCoast(seed, size, r, g) {
  const N = size + 1, half = size / 2;
  const nShape = makeSimplex2D(hash32(seed + ':shape'));
  const nCoast = makeSimplex2D(hash32(seed + ':coast'));
  let F = new Float64Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i - half, z = j - half;
      const e01 = fbm2(nShape, x * 0.055, z * 0.055, { octaves: 4 }) * 0.5 + 0.5;
      const d = Math.sqrt(x * x + z * z) / r;
      const dw = d + 0.18 * fbm2(nCoast, x * 0.03, z * 0.03, { octaves: 2 });
      const fall = 1 - smoothstep(0.55, 1.0, dw);
      let h = (0.35 + 0.65 * e01) * fall * 3.2 - 0.6;
      h -= 1.9 * smoothstep(0.9, 1.35, dw);
      const th = clamp(1 - distTo(x, z, g.hillCentre) / 8, 0, 1);
      h += 4.6 * bump(th);
      const ts = clamp(1 - distTo(x, z, g.shoulderCentre) / 6, 0, 1);
      h += 1.8 * bump(ts);
      const tl = clamp(1 - distTo(x, z, g.lakeCentre) / 4, 0, 1);
      const sl = bump(tl);
      if (sl > 0) h = Math.min(h, lerp(0.3, -0.9, sl));
      F[i + j * N] = h;
    }
  }
  F = boxBlur(boxBlur(F, N), N);
  for (let k = 0; k < F.length; k++) F[k] = Math.max(-2.5, Math.round(F[k] * 256) / 256);
  return F;
}

// One ring of new ground. Only the sea and the beach it washes are touched - joined to the
// grid's edge - so the lake, and anything else the tide never reached, is left as it is; and never within
// reach of a founding river, so the river keeps its bed and ends where it always did. A
// corner is only ever raised, never lowered.
function accrete(H, size, seed, { r, hold }, g) {
  const N = size + 1;
  const F = groundForCoast(seed, size, r, g);
  // What stays exactly as it is: everything above the beach, and every corner of a cell the
  // step was told something stands on (`hold`). The rest of the old shore - the sand, and
  // the low lip of the meadow behind it - rises with the new ground; holding all of it was
  // the first version, and it left every old coastline behind as a ring of sand in the
  // meadow, growth rings. The terrain cannot know what stands where, so the layout says so
  // when it takes the step and the step keeps the list (Plans/eiland-laten-groeien.md).
  const half = size / 2;
  const land = new Uint8Array(N * N);
  for (let k = 0; k < H.length; k++) if (H[k] >= BEACH_MAX) land[k] = 1;
  for (const [lx, lz] of hold) {
    const gx = lx + half, gz = lz + half;
    if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
    const a = gx + gz * N;
    land[a] = 1; land[a + 1] = 1; land[a + N] = 1; land[a + N + 1] = 1;
  }

  const keep = new Uint8Array(N * N);
  for (const course of g.courses || []) {
    for (const [gx, gz] of course) {
      for (let j = Math.max(0, gz - GROW_RIVER_KEEP); j <= Math.min(size, gz + 1 + GROW_RIVER_KEEP); j++) {
        for (let i = Math.max(0, gx - GROW_RIVER_KEEP); i <= Math.min(size, gx + 1 + GROW_RIVER_KEEP); i++) keep[i + j * N] = 1;
      }
    }
  }

  // The sea: every corner that is not land and is joined to the edge through corners that
  // are not land either.
  const sea = new Uint8Array(N * N);
  const queue = new Int32Array(N * N);
  let head = 0, tail = 0;
  const seaSeed = (i, j) => { const k = i + j * N; if (!land[k] && !sea[k]) { sea[k] = 1; queue[tail++] = k; } };
  for (let i = 0; i < N; i++) { seaSeed(i, 0); seaSeed(i, size); seaSeed(0, i); seaSeed(size, i); }
  while (head < tail) {
    const k = queue[head++], i = k % N, j = (k - i) / N;
    if (i > 0) seaSeed(i - 1, j);
    if (i < size) seaSeed(i + 1, j);
    if (j > 0) seaSeed(i, j - 1);
    if (j < size) seaSeed(i, j + 1);
  }

  // How far out from the land each sea corner lies, in steps of one corner, diagonals
  // included, so the ramp runs out evenly round a headland.
  const dist = new Int32Array(N * N).fill(-1);
  head = 0; tail = 0;
  for (let k = 0; k < H.length; k++) if (land[k]) { dist[k] = 0; queue[tail++] = k; }
  while (head < tail) {
    const k = queue[head++], i = k % N, j = (k - i) / N;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni > size || nj > size) continue;
        const n = ni + nj * N;
        if (dist[n] >= 0 || !sea[n]) continue;
        dist[n] = dist[k] + 1;
        queue[tail++] = n;
      }
    }
  }

  for (let k = 0; k < H.length; k++) {
    if (!sea[k] || keep[k] || dist[k] < 1) continue;
    const v = Math.min(F[k], GROW_SHORE + (dist[k] - 1) * GROW_RISE);
    if (v > H[k]) H[k] = Math.round(v * 256) / 256;
  }
}

// The island as it was founded: the ground, the hill, the lake, the rivers - or the
// volcano's mountain and its lava - all on a grid of `size`, which for an island that has
// never grown is the whole of it. Split out of makeTerrain so a grown island can still be
// built on the grid it was founded on and set down in the middle of a bigger one: the
// coast here is measured off `half`, so the same seed on a bigger grid is a different
// island (Plans/eiland-laten-groeien.md).
function groundOf(seed, size, volcano) {
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

  // ---- lava, and the volcano's relief ----------------------------------------
  // Where the flows leave the rim is decided before the relief, because the relief breaches
  // the rim there and keeps the parasitic cones off their way down. Three flows, leaving the
  // rim at least ninety degrees apart so they never merge into one, each with its mouth two
  // sixteenths of a turn round the coast from where it started - the same trick the rivers
  // use to cross ground rather than drop straight to the nearest shore, turned down because
  // a flow is meant to reach the sea, not wander. A fork of its own, like the rivers', so
  // nothing else here moves if these numbers change. (The 128-grid volcano had two; on a
  // mountain half as big again a third is what keeps it from looking half asleep.)
  const lavaFlows = [];
  let floorQ = 0, fields = null, vents = [];
  let flowPlan = [];
  const lr = makeRng(seed).fork('lava');
  if (vol) {
    const k1 = lr.int(16);
    const k2 = (k1 + 5 + lr.int(2)) % 16;
    const k3 = (k2 + 5 + lr.int(2)) % 16;
    flowPlan = [k1, k2, k3].map((k) => ({ k, side: lr.chance(0.5) ? 1 : -1 }));
    vents = volcanoVents(seed, vol, flowPlan);
    fields = volcanoRelief(H, vol, seed, size, N, half, flowPlan, vents);
  }
  for (let k = 0; k < H.length; k++) H[k] = Math.max(-2.5, Math.round(H[k] * 256) / 256);

  if (vol) {
    const coast = vol.coast;
    for (const { k, side } of flowPlan) {
      const kEnd = (k + side * 2 + 16) % 16;
      // Its bends from a fork of their own, so that one flow's bends never shift another's.
      const course = lavaCourse(H, N, size, vol, DIRS16[k], DIRS16[kEnd], coast + 2, coast + 8, lr.fork(`bends:${k}`));
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
  return { H, courses, hillCentre, shoulderCentre, lakeCentre, vol, lavaFlows, floorQ, fields, vents };
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
  // An island that has grown (Plans/eiland-laten-groeien.md): founded on a grid of
  // `grow.base`, set down in the middle of this one, and every ring of ground it has gained
  // since laid round it by `accrete`. Absent - or a base the size of the grid and no steps -
  // is the island as it always was, bit for bit. The volcano does not grow.
  const grow = opts && opts.grow && !volcano && !open ? checkGrow(opts.grow, size) : null;
  const N = size + 1, half = size / 2;
  const g = groundOf(seed, grow ? grow.base : size, volcano);
  const { hillCentre, lakeCentre, vol, lavaFlows, floorQ, fields, vents } = g;
  let H = g.H, courses = g.courses;
  if (grow) {
    const k = (size - grow.base) / 2;
    if (k) {
      H = embed(g.H, grow.base, size);
      courses = courses.map((c) => c.map(([gx, gz]) => [gx + k, gz + k]));
    }
    for (const step of grow.steps) accrete(H, size, seed, step, { ...g, courses });
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
    // `top` is the rim's own height before the relief, which web/js/world.js scales its
    // colour bands by; `vents` the parasitic cones, local like `centre`, which lava.js puts
    // a wisp of smoke over.
    crater = {
      centre: [0, 0], r: vol.rim, floor: floorQ, pool: vol.pool, top: vol.peak,
      vents: vents.map((v) => ({ x: v.x, z: v.z, r: v.r, pit: v.pit })),
    };
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
    // The old lava fields, per corner, 0..255 - rough ground here, painted dark in
    // web/js/world.js. Null on every island but the volcano.
    oldLava: fields,
    fairway,
    hash: hashHeights(H),
  };
}

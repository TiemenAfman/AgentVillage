import { makeRng, hash32 } from '../../shared/rng.mjs';
import { CLASS } from './classify.mjs';

// Rivers and lakes, cut into the baked grid.
//
// The old generator could get away with defining water as "below sea level": its island was
// only five metres tall, so a channel cut to -0.55 m was a river anywhere on it. On a 46 m
// island that stops working - a stream at 30 m elevation is still a stream. So fresh water here
// is not defined by height but by class, and its surface sits a fixed depth above the bed it
// runs in. One constant, no extra channel in the chunk format, and a river can climb a hill.
//
// This runs on the grid rather than on the continuous field, and it has to: a river is a walk
// from one sample to the next, and that only exists once there are samples.

export const RIVER_DEPTH = 1.1;        // metres from bed to surface
export const LAKE_DEPTH = 2.2;

const SOURCE_MIN_FRAC = 0.55;          // a spring starts on the upper part of the massif
const SOURCE_MIN_INLAND = 55;          // metres, so a river is not a gully in the beach
const BANK_RISE = 1.35;                // how fast the bank climbs out of the bed, per metre
const WOBBLE = 0.35;                   // metres of hashed noise on the descent, so it meanders

/**
 * Cut watercourses into a baked field. Mutates `height` and writes into `waterClass`.
 *
 * @param {{height: Float32Array, coast: Float32Array, n: number, envelopeM: number,
 *          metresPerSample: number}} grid
 * @param {number|string} seed
 * @param {{rivers?: number, lakes?: number, scale?: number}} opts
 * @returns {{waterClass: Uint8Array, rivers: object[], lakes: object[]}}
 */
export function carveWater(grid, seed, { rivers = 2, lakes = 1, scale = 1 } = {}) {
  const { height, coast, n, envelopeM, metresPerSample } = grid;
  const half = envelopeM / 2;
  const at = (i, j) => i + j * n;
  const inGrid = (i, j) => i >= 0 && j >= 0 && i < n && j < n;
  const worldOf = (i) => i * metresPerSample - half;

  const waterClass = new Uint8Array(n * n);
  const rng = makeRng(seed).fork('water');

  // Steps to open water, by breadth-first search from every sea sample at once.
  //
  // The obvious thing is to follow `coast`, which is already a signed distance to the shore -
  // but only before the domain warp. Warped, it has local maxima, and a descent that insists on
  // decreasing it dead-ends against them; measured, rivers stopped 50 m short of the sea. A BFS
  // field is monotone by construction, so a walk down it always arrives.
  const toSea = new Int32Array(n * n).fill(-1);
  {
    const queue = new Int32Array(n * n);
    let head = 0, tail = 0;
    for (let k = 0; k < toSea.length; k++) {
      if (coast[k] <= 0) { toSea[k] = 0; queue[tail++] = k; }
    }
    while (head < tail) {
      const k = queue[head++];
      const i = k % n, j = (k - (k % n)) / n;
      const d = toSea[k] + 1;
      if (i > 0 && toSea[k - 1] < 0) { toSea[k - 1] = d; queue[tail++] = k - 1; }
      if (i < n - 1 && toSea[k + 1] < 0) { toSea[k + 1] = d; queue[tail++] = k + 1; }
      if (j > 0 && toSea[k - n] < 0) { toSea[k - n] = d; queue[tail++] = k - n; }
      if (j < n - 1 && toSea[k + n] < 0) { toSea[k + n] = d; queue[tail++] = k + n; }
    }
  }

  // Only the main island gets watercourses: an islet 60 m across has no catchment worth
  // speaking of, and a river on one would be a drain.
  let peak = 0, peakAt = -1;
  for (let k = 0; k < height.length; k++) {
    if (coast[k] > 0 && height[k] > peak) { peak = height[k]; peakAt = k; }
  }
  if (peakAt < 0) return { waterClass, rivers: [], lakes: [] };

  // ---- springs ---------------------------------------------------------------------
  // High ground, well inland, and spread out: two rivers leaving by the same flank divide
  // nothing, and the whole point of a river here is that it cuts the island into parts a
  // bridge has to reach across.
  const candidates = [];
  for (let j = 2; j < n - 2; j++) {
    for (let i = 2; i < n - 2; i++) {
      const k = at(i, j);
      if (toSea[k] < SOURCE_MIN_INLAND * scale) continue;
      if (height[k] < peak * SOURCE_MIN_FRAC) continue;
      candidates.push(k);
    }
  }
  if (!candidates.length) return { waterClass, rivers: [], lakes: [] };

  const springs = [];
  const minApart = 70 * scale;
  for (let attempt = 0; attempt < 400 && springs.length < rivers; attempt++) {
    const k = candidates[rng.int(candidates.length)];
    const x = worldOf(k % n), z = worldOf(Math.floor(k / n));
    if (springs.every((s) => Math.hypot(x - s.x, z - s.z) > minApart)) springs.push({ k, x, z });
  }

  const courses = [];
  for (const spring of springs) {
    const course = descend(spring.k);
    if (course.length >= 12) courses.push(course);
  }

  // ---- lakes ------------------------------------------------------------------------
  // On a shoulder rather than in a hole: a bowl scooped into gentle high ground reads as a
  // tarn, and the outflow is simply where a river passes.
  const pools = [];
  // A lake wants gentle ground, not high ground, so it draws from its own list: a tarn on a
  // low shoulder is as good as one near the summit, and insisting on the summit found none at
  // all on most seeds.
  const basins = [];
  for (let j = 2; j < n - 2; j++) {
    for (let i = 2; i < n - 2; i++) {
      const k = at(i, j);
      if (coast[k] < 50 * scale) continue;
      if (height[k] < 3 || height[k] > peak * 0.85) continue;
      basins.push(k);
    }
  }
  for (let attempt = 0; attempt < 600 && pools.length < lakes && basins.length; attempt++) {
    const k = basins[rng.int(basins.length)];
    const i = k % n, j = Math.floor(k / n);
    const radius = (14 + rng.range(0, 12)) * scale;
    const r = Math.ceil(radius / metresPerSample);
    if (i - r < 1 || j - r < 1 || i + r > n - 2 || j + r > n - 2) continue;
    // Refuse anywhere steep: a lake on a slope is a waterfall standing still.
    let lo = Infinity, hi = -Infinity;
    for (let dj = -r; dj <= r; dj += 2) {
      for (let di = -r; di <= r; di += 2) {
        const h = height[at(i + di, j + dj)];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    if (hi - lo > 9 * scale) continue;
    if (pools.some((p) => Math.hypot(p.i - i, p.j - j) * metresPerSample < 90 * scale)) continue;
    pools.push({ i, j, radius, level: lo });
  }

  for (const pool of pools) carveLake(pool);
  for (const course of courses) carveRiver(course);

  return {
    waterClass,
    rivers: courses.map((c, index) => ({
      id: `river:${index}`,
      mouth: worldPoint(c[c.length - 1].k),
      source: worldPoint(c[0].k),
      lengthM: Math.round((c.length - 1) * metresPerSample),
      spine: simplify(c.map((p) => worldPoint(p.k)), 12 * scale),
    })),
    lakes: pools.map((p, index) => ({
      id: `lake:${index}`,
      centre: [round1(worldOf(p.i)), round1(worldOf(p.j))],
      radiusM: round1(p.radius),
      surfaceY: round1(p.level),
    })),
  };

  // ---- the walk ---------------------------------------------------------------------
  // Steepest descent, four-connected, with a hashed wobble so it meanders rather than running
  // dead down the fall line. A pure gradient walk on fractal ground stalls in every pit it
  // meets; when that happens here the course steps to the lowest neighbour regardless and the
  // carve smooths it out, which is what a real stream does to a hollow.
  function descend(startK) {
    const course = [];
    let k = startK;
    let level = height[k];

    for (let step = 0; step < n * 3; step++) {
      course.push({ k, level });
      if (coast[k] <= 0) break;                       // reached the sea: this is the mouth

      const i = k % n, j = Math.floor(k / n);
      // Only neighbours a step nearer the sea are eligible, and the lowest of those wins: the
      // water finds its way down within a corridor that is guaranteed to arrive.
      let best = -1, bestScore = Infinity;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (!inGrid(ni, nj)) continue;
        const nk = at(ni, nj);
        if (toSea[nk] >= toSea[k]) continue;
        const wob = ((hash32(`${seed}:river:${ni}:${nj}`) % 2000) / 2000 - 0.5) * 2 * WOBBLE;
        const score = height[nk] + wob;
        if (score < bestScore) { bestScore = score; best = nk; }
      }
      if (best < 0) break;
      k = best;
      // The surface only ever falls. Without this a course that crosses a rise would carry its
      // water uphill, and the carve would gouge a trench through the hill to let it.
      level = Math.min(level, height[k]);
    }
    return course;
  }

  function carveRiver(course) {
    const last = course.length - 1;
    for (let s = 0; s <= last; s++) {
      const { k, level } = course[s];
      const i = k % n, j = Math.floor(k / n);
      // A river widens as it goes: a brook at the spring, something a bridge has to span at
      // the mouth.
      const wM = (1.6 + 3.4 * (s / Math.max(1, last))) * scale;
      const reach = Math.ceil((wM + (RIVER_DEPTH + 1.2) / BANK_RISE) / metresPerSample);

      for (let dj = -reach; dj <= reach; dj++) {
        for (let di = -reach; di <= reach; di++) {
          const ni = i + di, nj = j + dj;
          if (!inGrid(ni, nj)) continue;
          const nk = at(ni, nj);
          if (coast[nk] <= 0) continue;                 // the sea has its own profile
          const dist = Math.hypot(di, dj) * metresPerSample;
          const bed = level - RIVER_DEPTH + BANK_RISE * Math.max(0, dist - wM);
          if (bed < height[nk]) height[nk] = bed;
          if (dist <= wM && !waterClass[nk]) waterClass[nk] = CLASS.RIVER;
        }
      }
    }
  }

  function carveLake(pool) {
    const r = Math.ceil(pool.radius / metresPerSample);
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const ni = pool.i + di, nj = pool.j + dj;
        if (!inGrid(ni, nj)) continue;
        const nk = at(ni, nj);
        if (coast[nk] <= 0) continue;
        const dist = Math.hypot(di, dj) * metresPerSample;
        if (dist > pool.radius) continue;
        // Flat bottom, so the surface a fixed depth above it is flat too - which is the one
        // thing every lake in the world has in common.
        const bed = pool.level - LAKE_DEPTH + BANK_RISE * Math.max(0, dist - (pool.radius - 4 * scale));
        if (bed < height[nk]) height[nk] = bed;
        if (dist <= pool.radius - 4 * scale) waterClass[nk] = CLASS.LAKE;
      }
    }
  }

  function worldPoint(k) {
    return [round1(worldOf(k % n)), round1(worldOf(Math.floor(k / n)))];
  }
}

function round1(v) { return Math.round(v * 10) / 10; }

/** Drop points a straight line already covers, so a spine travels as a dozen points not a thousand. */
function simplify(points, minStep) {
  const out = [points[0]];
  for (const p of points) {
    const last = out[out.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= minStep) out.push(p);
  }
  const end = points[points.length - 1];
  if (out[out.length - 1] !== end) out.push(end);
  return out;
}

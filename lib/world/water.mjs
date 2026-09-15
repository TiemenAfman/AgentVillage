import { makeRng } from '../../shared/rng.mjs';
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

const HEAD_AREA = 200;                 // m2 of catchment before a hillside rill is a stream
const MOUTH_AREA = 2000;               // m2 of catchment before a mouth is a river, not a gutter
const MIN_LENGTH = 110;                // metres; anything shorter is a gully, not a river
const BANK_RISE = 1.35;                // how fast the bank climbs out of the bed, per metre
const FILL_EPS = 0.001;                // metres of fall the pit fill gives a flat, per step

// Eight neighbours, and the reason there are eight. A four-connected walk can only leave a
// sample along a grid axis, so on ground with no strong gradient of its own it goes straight,
// and every river this generator drew came out as a bar parallel to x or z.
const DI = [1, 1, 0, -1, -1, -1, 0, 1];
const DJ = [0, 1, 1, 1, 0, -1, -1, -1];
const INV_LEN = DI.map((di, d) => 1 / Math.hypot(di, DJ[d]));

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
  const { height, coast, main, n, envelopeM, metresPerSample } = grid;
  const half = envelopeM / 2;
  const at = (i, j) => i + j * n;
  const inGrid = (i, j) => i >= 0 && j >= 0 && i < n && j < n;
  const worldOf = (i) => i * metresPerSample - half;
  const areaOf = (m2) => m2 * scale * scale;

  const waterClass = new Uint8Array(n * n);
  const rng = makeRng(seed).fork('water');

  // Where the water actually goes.
  //
  // The first version of this walked down a breadth-first distance to the sea, on the grounds
  // that such a field is monotone and a walk down it is guaranteed to arrive. It arrives - but
  // it arrives at the nearest sea in a straight line. Four-connected, that distance drops along
  // exactly one or two of the four neighbours, so "the lowest of the eligible ones" is not a
  // choice at all, and the course came out as a bar along a grid axis no longer than its spring
  // was inland: 60 m of river on an island 400 m across.
  //
  // What a river follows is drainage, so that is what gets computed instead - on the terrain
  // rather than on a distance field.
  const { filled, receiver, area } = routeFlow();

  // Only the main island gets watercourses, and that has to be said rather than left to fall
  // out of the thresholds. `coast` is the union with the skerries; `main` is the main island
  // on its own, which is the same grid pass 2 shapes the shore off (see `bake.mjs`).
  //
  // The catchment threshold does exclude a skerry from having a *river* - a rock 120 m across
  // has no drainage to speak of. The lakes were the ones that got through: a 1.1 ha rock has a
  // sample 55 m from its own waterline, `basins` asks for 50, and so a rock that happened to
  // be inside the window joined the list the pool sites are drawn from. That made the whole
  // bake depend on how much sea was in shot again - a skerry outside a 640 m window is not in
  // the list, `rng.int` lands somewhere else, and the mainland gets a different lake. Measured
  // on seed 1401: 9.6 m of drift at -150,9 between a 640 m bake and a 1024 m one.
  const onMain = (k) => (main ? main[k] > 0 : coast[k] > 0);
  let peak = 0, peakAt = -1;
  for (let k = 0; k < height.length; k++) {
    if (onMain(k) && height[k] > peak) { peak = height[k]; peakAt = k; }
  }
  if (peakAt < 0) return { waterClass, rivers: [], lakes: [] };

  // ---- courses ---------------------------------------------------------------------
  // A river is found from its mouth, not from its spring. Every land sample that empties
  // straight into the sea is a candidate mouth; the one with the most ground draining through
  // it is the biggest river on the island, and stepping up its strongest tributary each time
  // follows the main stem to the spring at the end of it. Guessing at the spring instead is
  // what made the old rivers short - the guess had to be well inland, almost nowhere is, so
  // every spring sat just inside the minimum and the river was over as soon as it began.
  const outlets = [];
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const k = at(i, j);
      if (!onMain(k)) continue;
      const r = receiver[k];
      if (r < 0 || coast[r] > 0) continue;
      if (area[k] < areaOf(MOUTH_AREA)) continue;
      outlets.push(k);
    }
  }
  // Longest first, not largest first. A wide mouth on a short steep flank is a torrent, not a
  // river, and the thing being asked for here is a course long enough to divide the island.
  const traced = outlets
    .map((outlet) => trace(outlet))
    .map((course) => ({ course, metres: courseLength(course) }))
    .filter((c) => c.metres >= MIN_LENGTH * scale)
    .sort((a, b) => b.metres - a.metres);

  // Spread out: two rivers leaving by the same flank divide nothing, and the whole point of a
  // river here is that it cuts the island into parts a bridge has to reach across.
  const minApart = 70 * scale;
  const courses = [], mouths = [];
  for (const { course } of traced) {
    if (courses.length >= rivers) break;
    const mouth = course[course.length - 1].k;
    const x = worldOf(mouth % n), z = worldOf(Math.floor(mouth / n));
    if (!mouths.every((m) => Math.hypot(x - m[0], z - m[1]) > minApart)) continue;
    courses.push(course);
    mouths.push([x, z]);
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
      if (!onMain(k) || coast[k] < 50 * scale) continue;
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
      lengthM: Math.round(courseLength(c)),
      spine: simplify(c.map((p) => worldPoint(p.k)), 12 * scale),
    })),
    lakes: pools.map((p, index) => ({
      id: `lake:${index}`,
      centre: [round1(worldOf(p.i)), round1(worldOf(p.j))],
      radiusM: round1(p.radius),
      surfaceY: round1(p.level),
    })),
  };

  // ---- drainage ---------------------------------------------------------------------
  /**
   * Fill the pits, point every land sample downhill, and add up what drains through it.
   *
   * 1. A fractal heightfield is full of hollows a metre deep, and a walk that insists on going
   *    downhill dies in the first one it meets. A priority flood inward from the sea raises
   *    each hollow to the level of its lowest outflow - which is what a pond standing in it
   *    would do - and leaves a surface on which every land sample has a strictly lower
   *    neighbour, so a walk down it still always reaches the sea.
   * 2. Steepest descent on that surface, eight-connected, gives each sample its receiver.
   * 3. Summing catchment downstream turns that field into a river network. The number is what
   *    separates a rill from a river, and it makes finding the main stem a lookup rather than
   *    a guess.
   */
  function routeFlow() {
    const size = n * n;
    const filled = new Float32Array(size);
    const done = new Uint8Array(size);

    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < size; k++) {
      const h = height[k];
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }

    // A bucket queue rather than a heap. The flood only ever pushes a level strictly above the
    // one it is standing at, so a scan that never walks backwards is already a priority queue -
    // and it costs O(1) an operation instead of O(log n), over a million samples, three times
    // in a test run.
    const STEP = 0.004;                                  // metres per bucket
    const nb = Math.ceil((hi - lo + 64) / STEP) + 2;     // headroom for what the fill adds
    const head = new Int32Array(nb).fill(-1);
    const next = new Int32Array(size).fill(-1);
    // The bucket edges sit on absolute multiples of STEP, and only the *offset* comes from the
    // deepest sample. Measuring from `lo` itself makes them a grid that shifts by a fraction of
    // a bucket when `lo` does, and `lo` is the bottom of the ocean - which is reached in a
    // 1024 m window and need not be in a 640 m one. Two samples that shared a bucket in one
    // window then landed in different buckets in the other, the flood reached a hollow from the
    // other side, and the island came out with a river 14 m shorter. Same island, same seed,
    // different amount of sea in shot.
    const base = Math.floor(lo / STEP);
    const push = (k, v) => {
      let b = Math.floor(v / STEP) - base;
      if (b < 0) b = 0; else if (b >= nb) b = nb - 1;
      next[k] = head[b];
      head[b] = k;
    };

    for (let k = 0; k < size; k++) {
      if (coast[k] > 0) continue;                        // the sea is where the flood starts
      filled[k] = height[k];
      done[k] = 1;
      push(k, height[k]);
    }

    for (let b = 0; b < nb; b++) {
      while (head[b] >= 0) {
        const k = head[b];
        head[b] = next[k];
        const i = k % n, j = (k - i) / n;
        const lift = filled[k] + FILL_EPS;
        for (let d = 0; d < 8; d++) {
          const ni = i + DI[d], nj = j + DJ[d];
          if (!inGrid(ni, nj)) continue;
          const nk = at(ni, nj);
          if (done[nk]) continue;
          done[nk] = 1;
          filled[nk] = height[nk] > lift ? height[nk] : lift;
          push(nk, filled[nk]);
        }
      }
    }

    const receiver = new Int32Array(size).fill(-1);
    const indegree = new Int32Array(size);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = at(i, j);
        if (coast[k] <= 0) continue;
        let best = -1, bestSlope = 0;
        for (let d = 0; d < 8; d++) {
          const ni = i + DI[d], nj = j + DJ[d];
          if (!inGrid(ni, nj)) continue;
          const nk = at(ni, nj);
          const slope = (filled[k] - filled[nk]) * INV_LEN[d];
          if (slope > bestSlope) { bestSlope = slope; best = nk; }
        }
        receiver[k] = best;
        if (best >= 0) indegree[best]++;
      }
    }

    // Catchment, in one pass downstream: a sample can be added up as soon as everything
    // draining into it has been. The receiver field has no cycles - every step is to a
    // strictly lower sample of the filled surface - so peeling off the samples nothing drains
    // into terminates with all of them counted.
    const cell = metresPerSample * metresPerSample;
    const area = new Float32Array(size);
    const stack = new Int32Array(size);
    let top = 0;
    for (let k = 0; k < size; k++) {
      if (coast[k] <= 0) continue;
      area[k] = cell;
      if (indegree[k] === 0) stack[top++] = k;
    }
    while (top > 0) {
      const k = stack[--top];
      const r = receiver[k];
      if (r < 0 || coast[r] <= 0) continue;              // it has reached the sea
      area[r] += area[k];
      if (--indegree[r] === 0) stack[top++] = r;
    }

    return { filled, receiver, area };
  }

  /** The course through one mouth: up the strongest tributary to the spring, then back down. */
  function trace(outlet) {
    const up = [outlet];
    let k = outlet;
    for (let step = 0; step < n * 4; step++) {
      const i = k % n, j = Math.floor(k / n);
      let best = -1, bestArea = areaOf(HEAD_AREA);
      for (let d = 0; d < 8; d++) {
        const ni = i + DI[d], nj = j + DJ[d];
        if (!inGrid(ni, nj)) continue;
        const nk = at(ni, nj);
        if (receiver[nk] !== k) continue;                // not a tributary of this sample
        if (area[nk] > bestArea) { bestArea = area[nk]; best = nk; }
      }
      if (best < 0) break;                               // the spring: nothing left worth a channel
      up.push(best);
      k = best;
    }
    up.reverse();
    // The surface the water runs on is the filled one, which falls at every step by
    // construction. Taking the terrain instead is what made a course crossing a hollow carry
    // the hollow level onward and gouge a trench through the far lip to let it out.
    const course = up.map((sample) => ({ k: sample, level: filled[sample] }));
    const mouth = receiver[up[up.length - 1]];
    course.push({ k: mouth, level: height[mouth] });
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

  /**
   * How far the water travels, in metres.
   *
   * Counting samples instead is off by up to 41%: the walk is eight-connected now, and a
   * diagonal step covers 1.41 m of ground rather than one. It showed up as rivers whose stated
   * length was shorter than the straight line from spring to mouth.
   */
  function courseLength(course) {
    let m = 0;
    for (let s = 1; s < course.length; s++) {
      const a = course[s - 1].k, b = course[s].k;
      const di = (b % n) - (a % n), dj = Math.floor(b / n) - Math.floor(a / n);
      m += Math.hypot(di, dj) * metresPerSample;
    }
    return m;
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

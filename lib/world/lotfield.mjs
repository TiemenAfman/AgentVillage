import { CLASS } from './classify.mjs';

// The layout's view of the island.
//
// `lib/layout.mjs` never wanted a heightfield. It wanted to know, per unit of ground, whether you
// may build there, whether it is beach, how steep it is and how high. It asked `makeTerrain` for
// that because the two were written together, and the unit happened to be a metre.
//
// A metre is the wrong unit for a village. A road one metre wide is not a road; two people cannot
// pass on it. So the layout now works in **lots of four metres**, and this is the field it reads.
// Every constant in layout.mjs keeps its number and means four times the metres: PITCH 4 is a
// 16 m super-cell, a 3x3 plot is 12 m across, and the town square's 3/5/7 steps become 12, 20 and
// 28 m. That is why this is a re-founding and not a rewrite.
//
// Deriving it from the baked world rather than from a generator also settles an old problem. The
// thresholds that decide buildable from beach used to live in two languages at once - JS and the
// C# port - with a hash to notice when the copies drifted. There is one copy now, here, and the
// client is told the answer.

export const METRES_PER_LOT = 4;

// Whether you can build somewhere is not a question about slope. It is a question about how much
// earth has to move, and that is what a hillside village answers by terracing: cut into the
// slope, fill the outside, stand the house on the level you made.
//
// Measured on this island, slope was the wrong test by a wide margin. At a plot of 12 m on a
// 16 m pitch, a slope threshold of 0.34 left 25 places to build on an island that holds 160
// houses; 42% of the land is flat enough per sample, but in patches too small and too scattered
// for a plot to land on. Asking instead how much earth a plot costs gives 121 places at 3.5 m of
// cut and fill and 187 at 5 m - the same island, a question it can actually answer.
export const EARTHWORK_MAX = 4.0;     // metres between the lowest and highest ground under a plot
// Walkable is far more permissive: a road may climb what a house may not.
export const WALK_SLOPE_MAX = 0.75;
// The one thing a house may not stand on. Not "beach" as a whole - the dry backshore is where a
// coastal village goes, and on this island it is most of the level ground there is - but the wet
// foreshore, which is under water twice a day.
export const NO_BUILD_CLASSES = new Set([CLASS.BEACH, CLASS.RIVER, CLASS.LAKE]);

/**
 * @param {{height: Float32Array, classes: Uint8Array, coast: Float32Array, n: number,
 *          envelopeM: number, metresPerSample: number}} field  a bake from lib/world/bake.mjs
 */
export function makeLotField(field) {
  const { height, classes, coast, n, envelopeM, metresPerSample } = field;
  const samplesPerLot = Math.round(METRES_PER_LOT / metresPerSample);
  const size = Math.round(envelopeM / METRES_PER_LOT);
  const half = size / 2;

  // Packed per lot, one array each rather than an array of objects: 65,536 lots on a 1024 m
  // envelope, and the layout engine walks all of them more than once per scan.
  const meanY = new Float32Array(size * size);
  const minY = new Float32Array(size * size);
  const maxY = new Float32Array(size * size);
  const maxSlope = new Float32Array(size * size);
  const flags = new Uint8Array(size * size);
  const cls = new Uint8Array(size * size);

  const LAND = 1, BEACH = 2, BUILDABLE = 4, WALKABLE = 8, WET = 16;

  const slopeAtSample = (i, j) => {
    const l = height[Math.max(0, i - 1) + j * n];
    const r = height[Math.min(n - 1, i + 1) + j * n];
    const d = height[i + Math.max(0, j - 1) * n];
    const u = height[i + Math.min(n - 1, j + 1) * n];
    const gx = (r - l) / (2 * metresPerSample);
    const gz = (u - d) / (2 * metresPerSample);
    return Math.sqrt(gx * gx + gz * gz);
  };

  const tally = new Uint16Array(16);
  for (let lz = 0; lz < size; lz++) {
    for (let lx = 0; lx < size; lx++) {
      const k = lx + lz * size;
      tally.fill(0);

      let sum = 0, steepest = 0, land = 0, wet = 0, sand = 0, count = 0;
      let lowest = Infinity, highest = -Infinity;
      const i0 = lx * samplesPerLot, j0 = lz * samplesPerLot;
      for (let dj = 0; dj < samplesPerLot; dj++) {
        for (let di = 0; di < samplesPerLot; di++) {
          const i = Math.min(n - 1, i0 + di), j = Math.min(n - 1, j0 + dj);
          const s = i + j * n;
          const h = height[s];
          sum += h;
          if (h < lowest) lowest = h;
          if (h > highest) highest = h;
          const slope = slopeAtSample(i, j);
          if (slope > steepest) steepest = slope;
          const c = classes[s];
          tally[c]++;
          count++;
          if (c === CLASS.SEA || c === CLASS.SHALLOW) { /* open water */ }
          else if (c === CLASS.RIVER || c === CLASS.LAKE) wet++;
          else land++;
          if (c === CLASS.BEACH) sand++;          // the wet foreshore only; dune is buildable
          if (coast[s] > 0) { /* inside the coastline */ }
        }
      }

      meanY[k] = sum / count;
      minY[k] = lowest;
      maxY[k] = highest;
      maxSlope[k] = steepest;

      let dominant = 0, best = -1;
      for (let c = 0; c < tally.length; c++) if (tally[c] > best) { best = tally[c]; dominant = c; }
      cls[k] = dominant;

      let f = 0;
      // Land only when the whole lot is land. A lot half in the sea is a shoreline, and putting a
      // building on it is how a house ends up standing in the water - the old grid made the same
      // demand of its four corners, for the same reason.
      if (land === count) f |= LAND;
      if (wet > 0) f |= WET;
      if (sand * 2 >= count) f |= BEACH;
      if ((f & LAND) && steepest < WALK_SLOPE_MAX) f |= WALKABLE;
      // Per lot this is only a filter: land, and not the wet foreshore. Whether a *plot* fits is
      // a question about the block it covers, which is `earthwork` below.
      if ((f & LAND) && !(f & BEACH)) f |= BUILDABLE;
      flags[k] = f;
    }
  }

  const inGrid = (lx, lz) => lx >= 0 && lz >= 0 && lx < size && lz < size;
  const at = (lx, lz) => lx + lz * size;
  const has = (lx, lz, bit) => (inGrid(lx, lz) ? (flags[at(lx, lz)] & bit) !== 0 : false);

  const landCells = [];
  const beachCells = [];
  const coastCells = [];
  for (let lz = 0; lz < size; lz++) {
    for (let lx = 0; lx < size; lx++) {
      if (!has(lx, lz, LAND)) continue;
      landCells.push([lx, lz]);
      if (has(lx, lz, BEACH)) beachCells.push([lx, lz]);
      if (!has(lx + 1, lz, LAND) || !has(lx - 1, lz, LAND)
        || !has(lx, lz + 1, LAND) || !has(lx, lz - 1, LAND)) {
        coastCells.push([lx, lz]);
      }
    }
  }

  return {
    size,
    half,
    metresPerLot: METRES_PER_LOT,
    envelopeM,

    inGrid,
    isLand: (lx, lz) => has(lx, lz, LAND),
    isWater: (lx, lz) => !has(lx, lz, LAND),
    isBeach: (lx, lz) => has(lx, lz, BEACH),
    isBuildable: (lx, lz) => has(lx, lz, BUILDABLE),
    isWalkable: (lx, lz) => has(lx, lz, WALKABLE),
    /// Fresh water: a river or a lake runs through this lot, so a road has to bridge it.
    isWet: (lx, lz) => has(lx, lz, WET),
    classOf: (lx, lz) => (inGrid(lx, lz) ? cls[at(lx, lz)] : CLASS.SEA),

    /**
     * Metres between the lowest and the highest ground under a block of lots: what it would cost
     * to terrace a level platform there. This, not slope, is what decides whether a plot fits.
     * Returns Infinity when any lot of the block is unusable, so a caller can compare and stop.
     */
    earthwork: (lx, lz, w = 1, d = 1) => {
      let lowest = Infinity, highest = -Infinity;
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const i = lx + dx, j = lz + dz;
          if (!inGrid(i, j) || !has(i, j, BUILDABLE)) return Infinity;
          const k = at(i, j);
          if (minY[k] < lowest) lowest = minY[k];
          if (maxY[k] > highest) highest = maxY[k];
        }
      }
      return highest - lowest;
    },

    /// The level a terrace under this block would sit at: the middle of what it spans, so the cut
    /// and the fill are the same size and neither wall is twice the other.
    platformY: (lx, lz, w = 1, d = 1) => {
      let lowest = Infinity, highest = -Infinity;
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const k = at(Math.max(0, Math.min(size - 1, lx + dx)), Math.max(0, Math.min(size - 1, lz + dz)));
          if (minY[k] < lowest) lowest = minY[k];
          if (maxY[k] > highest) highest = maxY[k];
        }
      }
      return (lowest + highest) / 2;
    },
    slope: (lx, lz) => (inGrid(lx, lz) ? maxSlope[at(lx, lz)] : 0),
    heightAt: (lx, lz) => (inGrid(lx, lz) ? meanY[at(lx, lz)] : -34),

    /// Centre of a lot, in world metres.
    cellWorld: (lx, lz) => [(lx - half + 0.5) * METRES_PER_LOT, (lz - half + 0.5) * METRES_PER_LOT],
    /// Ground height at a world position, straight off the sample grid.
    worldHeight: (x, z) => {
      const i = Math.max(0, Math.min(n - 1, Math.round((x + envelopeM / 2) / metresPerSample)));
      const j = Math.max(0, Math.min(n - 1, Math.round((z + envelopeM / 2) / metresPerSample)));
      return height[i + j * n];
    },

    landCells,
    beachCells,
    coastCells,
  };
}

/** What the field is made of, for tuning the thresholds against something other than a hunch. */
export function lotFieldStats(lots) {
  let land = 0, buildable = 0, beach = 0, walkable = 0, wet = 0;
  for (let lz = 0; lz < lots.size; lz++) {
    for (let lx = 0; lx < lots.size; lx++) {
      if (!lots.isLand(lx, lz)) continue;
      land++;
      if (lots.isBuildable(lx, lz)) buildable++;
      if (lots.isBeach(lx, lz)) beach++;
      if (lots.isWalkable(lx, lz)) walkable++;
      if (lots.isWet(lx, lz)) wet++;
    }
  }
  const m2 = METRES_PER_LOT * METRES_PER_LOT;
  return {
    lots: lots.size * lots.size,
    land,
    landHa: (land * m2) / 10000,
    buildable,
    buildableHa: (buildable * m2) / 10000,
    beach,
    walkable,
    wet,
    coast: lots.coastCells.length,
  };
}

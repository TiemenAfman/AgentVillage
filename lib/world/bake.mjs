import { makeShape } from './shape.mjs';
import { makeRelief, MAX_GRADIENT } from './relief.mjs';
import { makeClassifier } from './classify.mjs';
import { carveWater } from './water.mjs';

// One pass over the whole envelope.
//
// This is the step that makes growth possible. The generator does not run again, ever: the
// entire 1024 m world - main island, shelf, sub-islands, open sea - is evaluated once at
// founding and written as immutable chunks. Growing the island later publishes chunks that
// already exist rather than generating new ground, so every metre of land that anyone has
// built on is byte-identical forever and no house can move.
//
// It is also the only place the gradient cap can be applied. A continuous height function
// cannot clamp its own slope - there is no neighbour to compare against - so the cap runs
// here, on the grid, as a relaxation pass.

export const METRES_PER_SAMPLE = 1;
export const CHUNK_M = 64;                       // 64 m: one chunk, one navmesh tile, one LOD unit

/**
 * Evaluate the whole envelope onto one grid.
 *
 * @param {number|string} seed
 * @param {{envelopeM?: number, radiusM?: number, onProgress?: (frac: number) => void}} opts
 */
export function bakeField(seed, { envelopeM = 1024, radiusM = 208, onProgress = null } = {}) {
  const shape = makeShape(seed, { radiusM, envelopeM });
  const relief = makeRelief(seed, shape);
  const classifier = makeClassifier(seed, shape, relief);

  const n = envelopeM / METRES_PER_SAMPLE + 1;    // samples per side, corner lattice
  if (!Number.isInteger(n)) throw new Error(`envelope ${envelopeM} is not a whole number of samples`);
  const half = envelopeM / 2;
  const at = (i, j) => i + j * n;
  const worldX = (i) => i * METRES_PER_SAMPLE - half;

  const coast = new Float32Array(n * n);
  const height = new Float32Array(n * n);
  const classes = new Uint8Array(n * n);

  // ---- pass 1: the coast field ---------------------------------------------------
  for (let j = 0; j < n; j++) {
    const z = worldX(j);
    for (let i = 0; i < n; i++) coast[at(i, j)] = shape.coast(worldX(i), z);
    if (onProgress && j % 64 === 0) onProgress((j / n) * 0.35);
  }

  // ---- pass 2: heights -----------------------------------------------------------
  // The beach width needs the coast normal, which is the gradient of the field from pass 1.
  // Reading it off the grid rather than resampling turns five coast evaluations per sample
  // into none.
  const swellX = Math.cos(relief.swell), swellZ = Math.sin(relief.swell);
  for (let j = 0; j < n; j++) {
    const z = worldX(j);
    for (let i = 0; i < n; i++) {
      const k = at(i, j);
      const d = coast[k];
      let wBeach = null;
      if (d > 0) {
        const gx = coast[at(Math.min(i + 1, n - 1), j)] - coast[at(Math.max(i - 1, 0), j)];
        const gz = coast[at(i, Math.min(j + 1, n - 1))] - coast[at(i, Math.max(j - 1, 0))];
        const len = Math.hypot(gx, gz) || 1;
        const exposure = 0.5 + 0.5 * ((-gx / len) * swellX + (-gz / len) * swellZ);
        wBeach = (4 + 15 * exposure) * relief.scale;
      }
      height[k] = relief.height(worldX(i), z, d, wBeach);
    }
    if (onProgress && j % 64 === 0) onProgress(0.35 + (j / n) * 0.35);
  }

  // ---- pass 3: fresh water ----------------------------------------------------------
  // Before the cap, so a ravine the river cuts is subject to the same 45-degree rule as the
  // rest of the island, and before classification, so the banks are classified as banks.
  const water = carveWater(
    { height, coast, n, envelopeM, metresPerSample: METRES_PER_SAMPLE },
    seed, { scale: relief.scale });
  if (onProgress) onProgress(0.74);

  // ---- pass 4: the gradient cap ---------------------------------------------------
  const capped = capGradient(height, n, METRES_PER_SAMPLE, MAX_GRADIENT);
  if (onProgress) onProgress(0.78);

  // ---- pass 5: classification ------------------------------------------------------
  for (let j = 0; j < n; j++) {
    const z = worldX(j);
    for (let i = 0; i < n; i++) {
      const k = at(i, j);
      const gx = (height[at(Math.min(i + 1, n - 1), j)] - height[at(Math.max(i - 1, 0), j)]) / (2 * METRES_PER_SAMPLE);
      const gz = (height[at(i, Math.min(j + 1, n - 1))] - height[at(i, Math.max(j - 1, 0))]) / (2 * METRES_PER_SAMPLE);
      // Water wins: a carved channel is a river whatever its slope says.
      classes[k] = water.waterClass[k] || classifier.classify(worldX(i), z, height[k], coast[k], Math.hypot(gx, gz));
    }
    if (onProgress && j % 64 === 0) onProgress(0.78 + (j / n) * 0.22);
  }
  if (onProgress) onProgress(1);

  return {
    seed, n, envelopeM, radiusM, metresPerSample: METRES_PER_SAMPLE,
    height, classes, coast,
    cappedSamples: capped,
    rivers: water.rivers, lakes: water.lakes,
    shape, relief,
  };
}

/**
 * Clamp the heightfield so no step between neighbours exceeds `maxGradient` metres per metre.
 *
 * Iterative and symmetric: each sweep pulls the *higher* of an offending pair down, so a cliff
 * face is shaved rather than a valley filled, and the island never grows. Anything shaved off
 * here is what a rock shell will put back as real geometry, with an undercut a heightfield
 * could never express.
 */
export function capGradient(height, n, metresPerSample, maxGradient) {
  const maxStep = maxGradient * metresPerSample;
  const diag = maxStep * Math.SQRT2;
  let touched = 0;

  for (let sweep = 0; sweep < 24; sweep++) {
    let changed = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = i + j * n;
        const h = height[k];
        if (h <= 0) continue;                        // the sea shelf has its own profile
        for (const [di, dj, limit] of [[1, 0, maxStep], [0, 1, maxStep], [1, 1, diag], [1, -1, diag]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
          const nk = ni + nj * n;
          const diff = height[k] - height[nk];
          if (diff > limit) { height[k] = height[nk] + limit; changed++; }
          else if (-diff > limit) { height[nk] = height[k] + limit; changed++; }
        }
      }
    }
    touched += changed;
    if (!changed) break;
  }
  return touched;
}

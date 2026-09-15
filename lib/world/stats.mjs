import { bakeField } from './bake.mjs';
import { CLASS_NAME } from './classify.mjs';

// What an island is made of, in numbers. Tuning a generator by eye alone is how you end up with
// terrain that is grey everywhere and no way to say why; this says which class took over.
//
// Measured on a real bake rather than on the continuous functions, and that matters: rivers,
// lakes and the gradient cap only exist once there is a grid, so the continuous path would
// report an island nobody will ever see. One code path, one answer.

// A bake is a second of work and these numbers are a pure function of the seed, so asking the
// same question twice should not cost twice. Small on purpose: this is a tuning aid, not a
// cache anybody depends on.
const memo = new Map();

/**
 * @param {number|string} seed
 * @param {{radiusM?: number, envelopeM?: number}} opts
 */
export function islandStats(seed, { radiusM = 208, envelopeM = 640 } = {}) {
  const key = `${seed}:${radiusM}:${envelopeM}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const measured = measureIsland(seed, radiusM, envelopeM);
  if (memo.size > 32) memo.delete(memo.keys().next().value);
  memo.set(key, measured);
  return measured;
}

function measureIsland(seed, radiusM, envelopeM) {
  const field = bakeField(seed, { envelopeM, radiusM });
  const { n, height, classes, shape } = field;
  const half = envelopeM / 2;

  const tally = new Map();
  const slopes = [];
  let land = 0, maxHeight = -Infinity;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      // mainCoast, not coast: these numbers describe the island. Counting the skerries in made
      // the area look like it varied by an eighth between seeds when in truth only the number
      // of sandbanks in shot had changed.
      if (shape.mainCoast(i - half, j - half) <= 0) continue;
      const k = i + j * n;
      land++;
      tally.set(classes[k], (tally.get(classes[k]) || 0) + 1);
      if (height[k] > maxHeight) maxHeight = height[k];
      if (i < minX) minX = i;
      if (i > maxX) maxX = i;
      if (j < minZ) minZ = j;
      if (j > maxZ) maxZ = j;
      if (land % 4 === 0) {
        const gx = (height[k + 1] - height[k - 1]) / 2;
        const gz = (height[k + n] - height[k - n]) / 2;
        slopes.push(Math.hypot(gx, gz));
      }
    }
  }

  slopes.sort((a, b) => a - b);
  const at = (q) => slopes[Math.min(slopes.length - 1, Math.floor(slopes.length * q))] ?? 0;

  const classShares = {};
  for (const [cls, count] of [...tally].sort((a, b) => b[1] - a[1])) {
    classShares[CLASS_NAME[cls]] = (100 * count) / land;
  }

  return {
    seed,
    landHa: land / 10000,
    extent: [maxX - minX, maxZ - minZ],
    maxHeight,
    slope: { p50: at(0.5), p90: at(0.9), p99: at(0.99) },
    classes: classShares,
    rivers: field.rivers.length,
    lakes: field.lakes.length,
    cappedSamples: field.cappedSamples,
  };
}

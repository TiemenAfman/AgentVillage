import { makeShape } from './shape.mjs';
import { makeRelief } from './relief.mjs';
import { makeClassifier, CLASS_NAME } from './classify.mjs';

// What an island is made of, in numbers. Tuning a generator by eye alone is how you end up
// with terrain that is grey everywhere and no way to say why; this says which class took over.

export function islandStats(seed, { radiusM = 208, step = 2 } = {}) {
  const shape = makeShape(seed, { radiusM });
  const relief = makeRelief(seed, shape);
  const classifier = makeClassifier(seed, shape, relief);

  const reach = radiusM * 1.6;
  const tally = new Map();
  const slopes = [];
  let n = 0, maxHeight = -Infinity;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

  for (let z = -reach; z <= reach; z += step) {
    for (let x = -reach; x <= reach; x += step) {
      const d = shape.coast(x, z);
      if (d <= 0) continue;
      const h = relief.height(x, z);
      const cls = classifier.classify(x, z, h, d);
      tally.set(cls, (tally.get(cls) || 0) + 1);
      n++;
      if (h > maxHeight) maxHeight = h;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      if (n % 5 === 0) slopes.push(classifier.slopeAt(x, z));
    }
  }

  slopes.sort((a, b) => a - b);
  const at = (q) => slopes[Math.min(slopes.length - 1, Math.floor(slopes.length * q))] ?? 0;

  const classes = {};
  for (const [cls, count] of [...tally].sort((a, b) => b[1] - a[1])) {
    classes[CLASS_NAME[cls]] = (100 * count) / n;
  }

  return {
    seed,
    landHa: (n * step * step) / 10000,
    extent: [Math.round(maxX - minX), Math.round(maxZ - minZ)],
    maxHeight,
    slope: { p50: at(0.5), p90: at(0.9), p99: at(0.99) },
    classes,
  };
}

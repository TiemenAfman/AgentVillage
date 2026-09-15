import { CLASS } from './classify.mjs';

// What the island *is*, named rather than derived.
//
// Today the client works this out for itself: `WorldManager`, `DistrictDecorator` and
// `PropSpawner` all read `terrain.HillCentre`, `terrain.LakeCentre` and `terrain.Rivers`,
// which exist only because the client runs the generator. Once the terrain arrives as bytes
// those are gone, and nothing can rediscover "the hill" from a heightfield without guessing.
//
// So the server names them. It is the same move as the class byte: ship the verdict instead of
// shipping the inputs and hoping both sides reach it.

/**
 * Label every land sample with the landmass it belongs to, and describe each one.
 *
 * @param {{height: Float32Array, coast: Float32Array, classes: Uint8Array, n: number,
 *          envelopeM: number, metresPerSample: number}} field
 */
export function findLandmasses(field) {
  const { coast, height, classes, n, envelopeM, metresPerSample } = field;
  const half = envelopeM / 2;
  const worldOf = (i) => i * metresPerSample - half;
  const label = new Int32Array(n * n).fill(-1);
  const masses = [];
  const stack = [];

  for (let start = 0; start < label.length; start++) {
    if (coast[start] <= 0 || label[start] >= 0) continue;

    const id = masses.length;
    // Four-connected: a landmass joined to another only by a diagonal touch of two samples is
    // two landmasses with a stepping stone, and calling it one would put a district's parcel
    // across open water.
    let samples = 0, peakH = -Infinity, peakK = start;
    let minI = n, maxI = -1, minJ = n, maxJ = -1;
    let sumI = 0, sumJ = 0;

    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const k = stack.pop();
      const i = k % n, j = (k - (k % n)) / n;
      samples++;
      sumI += i; sumJ += j;
      if (height[k] > peakH) { peakH = height[k]; peakK = k; }
      if (i < minI) minI = i;
      if (i > maxI) maxI = i;
      if (j < minJ) minJ = j;
      if (j > maxJ) maxJ = j;

      if (i > 0 && coast[k - 1] > 0 && label[k - 1] < 0) { label[k - 1] = id; stack.push(k - 1); }
      if (i < n - 1 && coast[k + 1] > 0 && label[k + 1] < 0) { label[k + 1] = id; stack.push(k + 1); }
      if (j > 0 && coast[k - n] > 0 && label[k - n] < 0) { label[k - n] = id; stack.push(k - n); }
      if (j < n - 1 && coast[k + n] > 0 && label[k + n] < 0) { label[k + n] = id; stack.push(k + n); }
    }

    // A handful of samples is a rock breaking the surface, not a landmass. Naming those would
    // fill the manifest with things no district could ever be put on.
    const areaM2 = samples * metresPerSample * metresPerSample;
    if (areaM2 < 400) continue;

    masses.push({
      id,
      areaHa: round2(areaM2 / 10000),
      centroid: [round1(worldOf(sumI / samples)), round1(worldOf(sumJ / samples))],
      bounds: [
        round1(worldOf(minI)), round1(worldOf(minJ)),
        round1(worldOf(maxI)), round1(worldOf(maxJ)),
      ],
      peak: { at: [round1(worldOf(peakK % n)), round1(worldOf((peakK - (peakK % n)) / n))], y: round1(peakH) },
    });
  }

  // Biggest first, so landmass 0 is always the island the town stands on however the flood
  // fill happened to run.
  masses.sort((a, b) => b.areaHa - a.areaHa);
  masses.forEach((m, index) => { m.index = index; });

  return { masses, label, classes };
}

/**
 * Landings: where a boat can come ashore. A beach sample with open water in front of it, one
 * per landmass, picked as the widest stretch of sand rather than the first one found.
 */
export function findLandings(field, masses, label) {
  const { classes, coast, n, envelopeM, metresPerSample } = field;
  const half = envelopeM / 2;
  const worldOf = (i) => i * metresPerSample - half;
  const best = new Map();

  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const k = i + j * n;
      if (classes[k] !== CLASS.BEACH) continue;
      // Right at the waterline, and facing real water rather than a river mouth.
      if (coast[k] > 6) continue;
      let sand = 0;
      for (let dj = -4; dj <= 4; dj++) {
        for (let di = -4; di <= 4; di++) {
          const nk = (i + di) + (j + dj) * n;
          if (nk >= 0 && nk < classes.length && classes[nk] === CLASS.BEACH) sand++;
        }
      }
      const id = label[k];
      const current = best.get(id);
      if (!current || sand > current.sand) best.set(id, { k, sand });
    }
  }

  const out = [];
  for (const mass of masses) {
    const pick = best.get(mass.id);
    if (!pick) continue;
    out.push({
      landmass: mass.index,
      at: [round1(worldOf(pick.k % n)), round1(worldOf((pick.k - (pick.k % n)) / n))],
    });
  }
  return out;
}

function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }

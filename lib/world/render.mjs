import { bakeField } from './bake.mjs';
import { BENCH } from './relief.mjs';
import { CLASS } from './classify.mjs';
import { clamp } from './noise.mjs';

// A top-down picture of an island. Deliberately not a beauty render: it is a *diagnostic*.
// Height reads as colour banded at the bench spacing, so a terrace pass that is not biting
// shows up as a smooth gradient instead of as steps, and the coastline is drawn as its own
// line so a silhouette can be judged on its own.
//
// Drawn from a bake, not from the continuous functions. It used to call `relief.height`
// directly, which meant the picture showed neither the rivers, nor the lakes, nor the gradient
// cap, nor the erosion - four of the six passes - and `CLASS_COLOUR` carried entries for RIVER
// and LAKE that could never be reached. Judging an island that is not the one being published is
// the exact failure this script was written to prevent, so it now shares one code path with
// `islandStats` and with `publishWorld`: what you see is what gets shipped.

const SEA = [
  [-24, [0.04, 0.10, 0.26]],
  [-6.4, [0.06, 0.24, 0.44]],
  [-1.5, [0.11, 0.44, 0.60]],
  [-0.4, [0.22, 0.66, 0.70]],
  [0, [0.42, 0.82, 0.80]],
];

function seaColour(depth) {
  for (let i = 0; i < SEA.length; i++) if (depth <= SEA[i][0]) return SEA[i][1];
  return SEA[SEA.length - 1][1];
}

// One colour per terrain class, darkened by height so a plateau still reads as higher than
// the meadow below it. Driven by the class byte rather than by a height threshold, so this
// picture shows exactly what the client will be told - if the beach looks wrong here, the
// beach *is* wrong, and not just this renderer.
const CLASS_COLOUR = {
  [CLASS.BEACH]: [0.90, 0.84, 0.66],
  [CLASS.DUNE]: [0.82, 0.79, 0.58],
  [CLASS.MEADOW]: [0.49, 0.64, 0.33],
  [CLASS.WOOD]: [0.29, 0.46, 0.25],
  [CLASS.SCREE]: [0.58, 0.55, 0.47],
  [CLASS.ROCK]: [0.50, 0.47, 0.44],
  [CLASS.CLIFF]: [0.42, 0.39, 0.37],
  [CLASS.RIVER]: [0.30, 0.55, 0.62],
  [CLASS.LAKE]: [0.22, 0.45, 0.55],
  [CLASS.POLDER]: [0.55, 0.66, 0.40],
};

/**
 * @param {{seed?: number|string, span?: number, radiusM?: number, erosion?: number,
 *          field?: object}} opts  `field` is a bake to draw; without one this bakes its own.
 */
export function renderIsland(canvas, { seed, span = 560, radiusM = 208, erosion = undefined, field = null }) {
  const f = field || bakeField(seed, { radiusM, erosion });
  const { n, height, classes, coast, envelopeM, metresPerSample } = f;
  const half = envelopeM / 2;
  const px2m = span / canvas.width;
  // Central differences one *pixel* apart rather than one sample apart: at two metres to the
  // pixel a one-sample slope is invisible, and the shade has to describe the ground the pixel
  // covers, not the ground under its centre.
  const step = Math.max(1, Math.round(px2m / metresPerSample));

  const sampleAt = (x, z) => {
    const i = Math.round((x + half) / metresPerSample);
    const j = Math.round((z + half) / metresPerSample);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return i + j * n;
  };

  for (let py = 0; py < canvas.height; py++) {
    const z = (py - canvas.height / 2) * px2m;
    for (let pxi = 0; pxi < canvas.width; pxi++) {
      const x = (pxi - canvas.width / 2) * px2m;
      const k = sampleAt(x, z);
      if (k < 0) { canvas.set(pxi, py, 0.04, 0.10, 0.26); continue; }

      if (coast[k] <= 0) {
        const [r, g, b] = seaColour(height[k]);
        canvas.set(pxi, py, r, g, b);
        continue;
      }

      const h = height[k];
      const base = CLASS_COLOUR[classes[k]] || [1, 0, 1];
      // A little darker with height, so benches stack visibly rather than reading as one plane.
      const tone = 1 - 0.26 * clamp(h / 46, 0, 1);
      let r = base[0] * tone, g = base[1] * tone, b = base[2] * tone;

      // Hillshade from the north-west, which is where the eye expects it. Without this a
      // bench and a slope of the same height are the same pixel and the picture says nothing.
      const i = k % n, j = (k - (k % n)) / n;
      const e = step * metresPerSample;
      const gx = (height[clampK(i + step, j)] - height[clampK(i - step, j)]) / (2 * e);
      const gz = (height[clampK(i, j + step)] - height[clampK(i, j - step)]) / (2 * e);
      const shade = clamp(0.62 + 0.75 * (-gx * 0.7 - gz * 0.7) / Math.sqrt(1 + gx * gx + gz * gz), 0.25, 1.45);
      r *= shade; g *= shade; b *= shade;

      // A contour every bench, so the steps are countable.
      const band = h / BENCH;
      if (band > 0.15 && Math.abs(band - Math.round(band)) < 0.03) { r *= 0.85; g *= 0.85; b *= 0.85; }

      canvas.set(pxi, py, r, g, b);
    }
  }

  function clampK(i, j) {
    return Math.min(n - 1, Math.max(0, i)) + Math.min(n - 1, Math.max(0, j)) * n;
  }
}

import { makeShape } from './shape.mjs';
import { makeRelief, BENCH } from './relief.mjs';
import { makeClassifier, CLASS } from './classify.mjs';
import { clamp, smoothstep } from './noise.mjs';

// A top-down picture of an island. Deliberately not a beauty render: it is a *diagnostic*.
// Height reads as colour banded at the bench spacing, so a terrace pass that is not biting
// shows up as a smooth gradient instead of as steps, and the coastline is drawn as its own
// line so a silhouette can be judged on its own.

// The shore profile, as the generator will bake it: metres seaward of the waterline mapped to
// a depth. A beach shelves gently and the bottom then falls away, which is what puts a wide
// band of turquoise against a windward shore and a narrow one against a cliff.
function depthAt(outM) {
  if (outM < 25) return -0.06 * outM;                  // foreshore, very shallow
  if (outM < 90) return -1.5 - 0.075 * (outM - 25);    // shelf
  return -6.4 - 0.12 * (outM - 90);                    // falling away
}

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

export function renderIsland(canvas, { seed, span = 560, radiusM = 208 }) {
  const shape = makeShape(seed, { radiusM });
  const relief = makeRelief(seed, shape);
  const classifier = makeClassifier(seed, shape, relief);
  const n = canvas.width;
  const mPerPx = span / n;
  const e = Math.max(1, mPerPx);

  for (let py = 0; py < n; py++) {
    const z = (py - n / 2) * mPerPx;
    for (let px = 0; px < n; px++) {
      const x = (px - n / 2) * mPerPx;
      const d = shape.coast(x, z);

      if (d <= 0) {
        const [r, g, b] = seaColour(relief.height(x, z));
        canvas.set(px, py, r, g, b);
        continue;
      }

      const h = relief.height(x, z);
      const cls = classifier.classify(x, z, h, d);
      const base = CLASS_COLOUR[cls] || [1, 0, 1];
      // A little darker with height, so benches stack visibly rather than reading as one plane.
      const tone = 1 - 0.26 * clamp(h / 46, 0, 1);
      let r = base[0] * tone, g = base[1] * tone, b = base[2] * tone;

      // Hillshade from the north-west, which is where the eye expects it. Without this a
      // bench and a slope of the same height are the same pixel and the picture says nothing.
      const gx = (relief.height(x + e, z) - relief.height(x - e, z)) / (2 * e);
      const gz = (relief.height(x, z + e) - relief.height(x, z - e)) / (2 * e);
      const shade = clamp(0.62 + 0.75 * (-gx * 0.7 - gz * 0.7) / Math.sqrt(1 + gx * gx + gz * gz), 0.25, 1.45);
      r *= shade; g *= shade; b *= shade;

      // A contour every bench, so the steps are countable.
      const band = h / BENCH;
      if (band > 0.15 && Math.abs(band - Math.round(band)) < 0.03) { r *= 0.85; g *= 0.85; b *= 0.85; }

      canvas.set(px, py, r, g, b);
    }
  }
}

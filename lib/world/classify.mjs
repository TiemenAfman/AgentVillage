import { makeNoise, fbm, smoothstep } from './noise.mjs';

// What each sample of ground *is*.
//
// This is the field that replaces `island.terrainHash` as the thing keeping the two sides
// honest. Today `BEACH_MAX 0.35`, `BUILD_SLOPE_MAX 0.6` and `BUILD_HEIGHT_MAX 4.2` are written
// out in both shared/terrain.mjs and TerrainGenerator.cs, and the hash exists to notice when
// the two copies drift apart. Ship the server's verdict as a byte per sample and that entire
// class of bug stops existing rather than being detected.
//
// One byte, so it packs beside the height in a chunk.

export const CLASS = {
  SEA: 0,
  SHALLOW: 1,
  BEACH: 2,
  DUNE: 3,
  MEADOW: 4,
  WOOD: 5,
  SCREE: 6,
  ROCK: 7,
  CLIFF: 8,
  RIVER: 9,
  LAKE: 10,
  POLDER: 11,
};

export const CLASS_NAME = Object.fromEntries(Object.entries(CLASS).map(([k, v]) => [v, k]));

// Slope above which the ground stops being walkable meadow and starts being bare rock. Well
// below the heightfield's own gradient cap (1.0), because what the cap refuses is a *cliff* -
// separate geometry - and this is the scree and bedrock on the way up to it.
const SCREE_SLOPE = 0.62;
const ROCK_SLOPE = 0.92;

export function makeClassifier(seed, shape, relief) {
  const forest = makeNoise(seed, 'forest');
  const scale = relief.scale;

  function slopeAt(x, z) {
    const e = 1.5 * scale;
    const gx = (relief.height(x + e, z) - relief.height(x - e, z)) / (2 * e);
    const gz = (relief.height(x, z + e) - relief.height(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz);
  }

  function classify(x, z, h = relief.height(x, z), d = shape.coast(x, z)) {
    if (d <= 0) return h > -2.5 ? CLASS.SHALLOW : CLASS.SEA;

    const beach = relief.beachWidth(x, z);
    if (d < beach) return CLASS.BEACH;
    if (d < beach + 10 * scale && h < 3.0) return CLASS.DUNE;

    const slope = slopeAt(x, z);
    if (slope > ROCK_SLOPE) return CLASS.ROCK;
    if (slope > SCREE_SLOPE) return CLASS.SCREE;

    // Tree cover: clustered rather than a uniform sprinkle, and thinner on the exposed coast
    // where the salt gets at it.
    const cover = fbm(forest, x / (58 * scale), z / (58 * scale), { octaves: 3 }) * 0.5 + 0.5;
    const salt = 1 - smoothstep(0, 90 * scale, d);
    return cover - 0.30 * salt > 0.44 ? CLASS.WOOD : CLASS.MEADOW;
  }

  return { classify, slopeAt };
}

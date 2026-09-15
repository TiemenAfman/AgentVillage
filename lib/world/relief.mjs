import { makeRng } from '../../shared/rng.mjs';
import { makeNoise, fbm, ridged, clamp, lerp, smoothstep } from './noise.mjs';

// Elevation.
//
// The old generator added two round bumps to a radial falloff and got a hill. The shape that
// actually reads as Sea of Thieves is a *bench*: a flat top, a steep face, another flat top.
// So the relief here is built continuous and then quantised to benches, under a mask - because
// terracing the whole island turns it into a wedding cake, and terracing none of it leaves the
// smooth hill we are trying to get rid of.
//
// One hard rule: the gradient is capped. A heightfield sampled every metre cannot express a
// cliff - a 25 m drop across one quad is an 87-degree triangle, which is what "shark fin"
// looked like from close up, and stretching Y only makes more of them. Anything steeper than
// the cap is clamped here and belongs to a rock shell, which is separate geometry.

export const H_MAX = 46;              // metres, for a 416 m island
export const BENCH = 7.5;             // metres between bench tops: 4x avatar height
const CLIFF_FRAC = 0.30;              // share of a bench's horizontal run spent on its face
const TERRACE = 0.82;                 // 0 = smooth hill, 1 = wedding cake
// 45 degrees. NOT enforced by `height()` - a continuous function cannot clamp its own
// gradient - but by the bake pass that samples it onto the chunk grid, where a neighbour
// exists to compare against. Anything the cap shaves off belongs to a rock shell, which is
// separate geometry. Exported so the bake and the tests read the same number.
export const MAX_GRADIENT = 1.0;

const GRAIN_M = 1.1;                  // surface texture added after terracing
const MASSIF_INLAND = 70;             // metres before the relief is allowed its full height
const BACKSHORE_M = 16;               // dune belt behind the beach
const BEACH_MIN = 4, BEACH_SWING = 15;

export function makeRelief(seed, shape) {
  const rng = makeRng(seed).fork('relief');
  const spine = makeNoise(seed, 'spine');
  const mid = makeNoise(seed, 'mid');
  const grain = makeNoise(seed, 'grain');
  const terraceNoise = makeNoise(seed, 'terrace');
  const scale = shape.radiusM / 208;

  // Where the weather comes from. One angle, drawn once, and it is what makes one coast a
  // wide flat beach and the opposite one a cliff with a wave-cut notch.
  const swell = rng.range(0, Math.PI * 2);
  const swellX = Math.cos(swell), swellZ = Math.sin(swell);

  /** Outward coast normal at a point, from the gradient of the coast field. */
  function coastNormal(x, z) {
    const e = 2 * scale;
    const gx = shape.coast(x + e, z) - shape.coast(x - e, z);
    const gz = shape.coast(x, z + e) - shape.coast(x, z - e);
    const len = Math.hypot(gx, gz) || 1;
    return [-gx / len, -gz / len];            // coast() grows inland, so negate to face the sea
  }

  /** How exposed this stretch of coast is to the swell, 0..1. */
  function exposure(x, z) {
    const [nx, nz] = coastNormal(x, z);
    return 0.5 + 0.5 * (nx * swellX + nz * swellZ);
  }

  function beachWidth(x, z) {
    return (BEACH_MIN + BEACH_SWING * exposure(x, z)) * scale;
  }

  /**
   * The continuous relief potential, 0..1, before terracing.
   *
   * Deliberately smooth. Terracing is a quantiser, so whatever frequency goes in comes out as
   * benches of that frequency - feed it the 26 m grain and the island turns into crumpled
   * foil rather than into plateaus. Everything fine-grained is added *after* the quantiser,
   * below, where it textures a surface instead of chopping it up.
   */
  function potential(x, z) {
    const r = ridged(spine, x / (250 * scale), z / (250 * scale), { octaves: 2, lacunarity: 2.07 });
    const m = fbm(mid, x / (170 * scale), z / (170 * scale), { octaves: 2 }) * 0.5 + 0.5;
    return clamp(0.62 * r + 0.38 * m, 0, 1);
  }

  /** Bench-quantise a height. Returns the terraced value at full strength. */
  function terrace(raw) {
    const k = raw / BENCH;
    const floorK = Math.floor(k);
    const t = k - floorK;
    const s = smoothstep(1 - CLIFF_FRAC, 1, t);
    return (floorK + s) * BENCH;
  }

  /**
   * Height in metres at a world position. Negative at sea.
   * This is the function the whole generator is for.
   */
  function height(x, z) {
    const d = shape.coast(x, z);                  // metres inland, negative at sea

    if (d <= 0) {
      // Seaward: a shelving foreshore, then the bottom falls away.
      const out = -d;
      if (out < 25 * scale) return -0.06 * out;
      if (out < 90 * scale) return -1.5 - 0.075 * (out - 25 * scale);
      return -6.4 - 0.12 * (out - 90 * scale);
    }

    const wBeach = beachWidth(x, z);
    // Beach, then dune, then the massif takes over.
    const beach = d < wBeach
      ? lerp(-0.2, 1.6, d / wBeach)
      : 1.6 + 2.4 * smoothstep(0, BACKSHORE_M * scale, d - wBeach);

    const massif = smoothstep(0, MASSIF_INLAND * scale, d);
    if (massif <= 0) return beach;

    const raw = potential(x, z) * H_MAX * scale * massif;
    // Half the island hard mesa country, half rolling meadow. Without this mask the terrace
    // pass runs everywhere and the whole island is a wedding cake; with it, two places on one
    // island feel like two places.
    const mask = smoothstep(0.35, 0.70, fbm(terraceNoise, x / (150 * scale), z / (150 * scale), { octaves: 2 }) * 0.5 + 0.5);
    let benched = lerp(raw, terrace(raw), TERRACE * mask);

    // Surface grain, on top of the quantiser rather than through it. Small enough that a
    // bench top still reads as flat, big enough that it is not a drawing.
    benched += GRAIN_M * scale * fbm(grain, x / (34 * scale), z / (34 * scale), { octaves: 3 });

    return lerp(beach, Math.max(beach, benched), massif);
  }

  return { height, potential, beachWidth, exposure, swell, scale };
}

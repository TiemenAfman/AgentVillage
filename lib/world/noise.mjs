import { hash32, makeSimplex2D, clamp, lerp, smoothstep } from '../../shared/rng.mjs';

// Noise for the island generator.
//
// The rule at the top of shared/rng.mjs - no Math.random, no transcendental functions - existed
// so that Node, the browser and the C# client could evaluate the same heightfield bit for bit.
// With the terrain shipped as data there is one evaluator, it runs once per island on the
// server, and that constraint is repealed. Everything below uses exp, pow and abs freely; what
// must stay stable is the *output*, which is quantised and written to disk, not the function.
//
// The simplex itself is still the one from shared/rng.mjs: it was already a proper Gustavson
// implementation and never needed the transcendentals in the first place.

export function makeNoise(seed, label) {
  return makeSimplex2D(hash32(`${seed}:${label}`));
}

/** Plain fractal noise, roughly -1..1. */
export function fbm(noise, x, y, { octaves = 4, lacunarity = 2.0, gain = 0.5, freq = 1 } = {}) {
  let amp = 1, f = freq, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/**
 * Ridged fractal noise, 0..1, with crests where plain fbm has zero crossings. This is what
 * gives a spine and side ridges instead of the blobby hills plain fbm produces - and a ridge
 * is what a terrace pass can cut into believable benches.
 */
export function ridged(noise, x, y, { octaves = 4, lacunarity = 2.07, gain = 0.5, freq = 1 } = {}) {
  let amp = 1, f = freq, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(x * f, y * f));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return sum / norm;
}

/**
 * Polynomial smooth minimum (Quilez). The whole reason the coastline gets necks, isthmuses and
 * bays: two overlapping discs joined with a plain `min` meet in a crease, joined with this they
 * meet in a waist. `k` is the blend width, in the same units as `a` and `b` - metres here.
 *
 * Polynomial rather than the exponential form on purpose. The exponential one subtracts
 * k*ln(2) even where the two shapes are nowhere near each other, so every lobe silently grows
 * by ~8 m at k=12 and the island inflates. This one is exactly `min` once |a-b| exceeds k.
 */
export function smoothMin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}

// Re-exported so a module needs only one import for the maths it uses. The definitions live
// in shared/rng.mjs; duplicating them here made two copies that could quietly disagree.
export { clamp, lerp, smoothstep };

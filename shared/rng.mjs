// Deterministic randomness shared by the Node scanner and the browser viewer.
// Rule: nothing in shared/ may call Math.random or the transcendental functions --
// only integer maths, + - * /, Math.floor/abs/min/max/sqrt -- so both runtimes agree
// bit for bit and a house never lands in the sea on one side and on grass on the other.

export function hash32(input) {
  const s = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const s = typeof seed === 'number' ? seed >>> 0 : hash32(seed);
  const next = mulberry32(s);
  return {
    seed: s,
    next,
    int: (n) => Math.floor(next() * n),
    range: (a, b) => a + next() * (b - a),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    fork: (label) => makeRng(hash32(s + ':' + label)),
  };
}

// 2D simplex noise (Gustavson), permutation shuffled by the seed.
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [1, 0], [-1, 0],
  [0, 1], [0, -1], [0, 1], [0, -1],
];
const F2 = 0.3660254037844386;   // 0.5 * (sqrt(3) - 1)
const G2 = 0.21132486540518713;  // (3 - sqrt(3)) / 6

export function makeSimplex2D(seed) {
  const rand = mulberry32(typeof seed === 'number' ? seed : hash32(seed));
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; permMod12[i] = perm[i] % 12; }

  return function noise2(xin, yin) {
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const gi0 = permMod12[ii + perm[jj]];
    const gi1 = permMod12[ii + i1 + perm[jj + j1]];
    const gi2 = permMod12[ii + 1 + perm[jj + 1]];
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (GRAD2[gi0][0] * x0 + GRAD2[gi0][1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (GRAD2[gi1][0] * x1 + GRAD2[gi1][1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (GRAD2[gi2][0] * x2 + GRAD2[gi2][1] * y2); }
    return 70 * (n0 + n1 + n2);
  };
}

export function fbm2(noise, x, y, opts) {
  const octaves = (opts && opts.octaves) || 4;
  const lacunarity = (opts && opts.lacunarity) || 2;
  const gain = (opts && opts.gain) || 0.5;
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

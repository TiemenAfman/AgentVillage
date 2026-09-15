// Draws the island's texture sheets. No image library and no downloads: the same trick
// scripts/make-icons.mjs uses, which is that a PNG is a header, a few chunks and a zlib
// stream (see scripts/png.mjs).
//
// Two kinds of sheet come out of here, and the difference is the whole design:
//
//   * `path-cobble` carries its own colour. The paving is the one surface the island
//     never had a colour for beyond a flat sand, so the stone is in the texture and the
//     mesh tints it barely at all.
//   * everything else is **detail only** - a grey sheet around 0.8, with the pattern in
//     brightness and almost none in hue. Those multiply over vertex colours that already
//     carry the season, the height band, the district and the time of day, and a sheet
//     with an opinion about colour would fight all four and win. Bark that is brown in
//     the texture *and* brown in the vertex colour comes out as mud.
//
// Everything wraps: the noise lattices are toroidal and the cell sites are matched
// across the seam, so a sheet tiled over a hillside has no visible grid.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { png } from './png.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'web', 'textures');
const N = 512;

// ---- the small amount of noise this needs ----------------------------------
// A value-noise lattice that wraps, so every octave is seamless and so is the sum.
function lattice(period, seed) {
  let s = (seed >>> 0) || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const a = new Float32Array(period * period);
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / N) * period, fy = (y / N) * period;
    const x0 = Math.floor(fx) % period, y0 = Math.floor(fy) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const tx = fade(fx - Math.floor(fx)), ty = fade(fy - Math.floor(fy));
    const a00 = a[y0 * period + x0], a10 = a[y0 * period + x1];
    const a01 = a[y1 * period + x0], a11 = a[y1 * period + x1];
    return (a00 * (1 - tx) + a10 * tx) * (1 - ty) + (a01 * (1 - tx) + a11 * tx) * ty;
  };
}
function fbm(seed, periods) {
  const octaves = periods.map((p, i) => lattice(p, seed + i * 7919));
  return (x, y) => {
    let sum = 0, amp = 1, norm = 0;
    for (const o of octaves) { sum += o(x, y) * amp; norm += amp; amp *= 0.5; }
    return sum / norm;
  };
}
// Distance on a torus: what makes the cell patterns meet across the seam.
const wrapD = (a, b) => { const d = Math.abs(a - b); return d > N / 2 ? N - d : d; };

// Scattered sites on a jittered lattice, for anything made of cells: cobbles, the
// stones of a wall, the clumps of a canopy.
function sites(cols, rows, jitter, seed, aspect = 1) {
  let s = (seed >>> 0) || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const out = [];
  const cw = N / cols, ch = N / rows;
  for (let r = 0; r < rows; r++) {
    // Every other course offset by half a stone, which is how a wall is laid and why a
    // stacked-stone sheet must not be a grid of squares.
    const stagger = aspect === 1 ? 0 : (r % 2) * cw * 0.5;
    for (let c = 0; c < cols; c++) {
      out.push({
        x: ((c + 0.5) * cw + stagger + (rnd() - 0.5) * cw * jitter + N) % N,
        y: ((r + 0.5) * ch + (rnd() - 0.5) * ch * jitter + N) % N,
        tone: 0.8 + rnd() * 0.4,
      });
    }
  }
  return out;
}
// F2 - F1: zero on the line between two neighbours, rising into the middle of a cell.
// That difference is the mortar, and the cell it belongs to is the nearest site.
function cells(list, aspect = 1) {
  return (x, y) => {
    let f1 = Infinity, f2 = Infinity, best = list[0];
    for (const s of list) {
      const dx = wrapD(x, s.x), dy = wrapD(y, s.y) * aspect;
      const d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; best = s; } else if (d < f2) f2 = d;
    }
    return { edge: Math.sqrt(f2) - Math.sqrt(f1), tone: best.tone };
  };
}

function draw(fn, channels = 3) {
  const px = Buffer.alloc(N * N * channels);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * N + x) * channels;
      px[i] = Math.max(0, Math.min(255, r | 0));
      px[i + 1] = Math.max(0, Math.min(255, g | 0));
      px[i + 2] = Math.max(0, Math.min(255, b | 0));
    }
  }
  return png(N, N, px, channels);
}
// A detail sheet: one brightness, a whisper of hue, centred near 0.8 so that multiplying
// it over a colour darkens rather than recolours.
const detail = (v, warm = 0) => [255 * v * (1 + warm * 0.05), 255 * v, 255 * v * (1 - warm * 0.04)];

// ---- the sheets ------------------------------------------------------------
const SHEETS = {
  // Dark slate cobbles, laid at about eight to a cell - a cell being four metres, so a
  // stone is roughly half a metre. This one keeps its colour: see the note at the top.
  'path-cobble': () => {
    const cob = cells(sites(8, 8, 0.6, 20260915));
    const grain = fbm(4242, [32, 64]);
    return draw((x, y) => {
      const c = cob(x, y);
      const mortar = Math.min(1, c.edge / 7);
      const t = c.tone * (0.9 + grain(x, y) * 0.2) * (0.18 + 0.82 * mortar);
      return [52 * t, 58 * t, 50 * t];
    });
  },
  // Bark: a vertical grain with deep fissures. The lattice is stretched up the trunk so
  // the noise runs with the wood rather than across it.
  bark: () => {
    const fine = fbm(77001, [6, 24]);
    const deep = fbm(77002, [3, 7]);
    return draw((x, y) => {
      const ridge = Math.abs(fine(x * 6 % N, y) - 0.5) * 2;
      const fissure = Math.pow(Math.abs(deep(x * 3 % N, y) - 0.5) * 2, 0.6);
      return detail(0.62 + 0.3 * (ridge * 0.4 + fissure * 0.6), 1);
    });
  },
  // Foliage: rounded clumps of leaf that overlap, each one brightest where it turns
  // towards the light. The first version of this ran the same lattice through cells(),
  // and that was a mistake with an obvious name - cells() draws the joint BETWEEN
  // neighbours, which is cobblestones. It put a paved street on every canopy on the
  // island. Leaves have no joints: they pile up, they overlap, and the only line in a
  // tree is where one clump ends and the one behind it carries on.
  foliage: () => {
    const puffs = sites(9, 9, 1.0, 88010);
    const reach = (N / 9) * 0.95;
    const fine = fbm(88011, [48, 96]);
    return draw((x, y) => {
      let lit = 0;
      for (const s of puffs) {
        const d = Math.hypot(wrapD(x, s.x), wrapD(y, s.y)) / reach;
        if (d < 1) lit = Math.max(lit, (1 - d * d) * s.tone);
      }
      return detail(0.68 + 0.24 * (lit * 0.72 + fine(x, y) * 0.28), -1);
    });
  },
  // Tilled soil: clods, and the ridge and hollow of the plough running one way. The
  // furrow decals the island already draws lie along the same axis.
  field: () => {
    const clod = fbm(31337, [24, 64, 128]);
    const rows = (y) => 0.5 + 0.5 * Math.sin((y / N) * Math.PI * 2 * 16);
    return draw((x, y) => detail(0.60 + 0.32 * (clod(x, y) * 0.6 + rows(y + clod(x, y) * 14) * 0.4), 1));
  },
  // Grass: blade-scale speckle over a slow unevenness, so a meadow has a nap without
  // any one tuft being visible from the air.
  grass: () => {
    const blades = fbm(50505, [96, 192]);
    const patch = fbm(50506, [5, 11]);
    return draw((x, y) => detail(0.66 + 0.3 * (blades(x, y) * 0.55 + patch(x, y) * 0.45), -1));
  },
  // Stacked stone, for the things built out of rubble rather than sawn: courses that
  // stagger, each stone its own tone, a deep joint between them.
  'stone-stacked': () => {
    const wall = cells(sites(9, 6, 0.35, 66012, 1.6), 1.6);
    const pit = fbm(66013, [48, 96]);
    return draw((x, y) => {
      const c = wall(x, y);
      const joint = Math.min(1, c.edge / 5);
      return detail(0.30 + 0.62 * c.tone * (0.22 + 0.78 * joint) * (0.92 + pit(x, y) * 0.16), 1);
    });
  },
};

fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const wrote = [];
for (const [name, make] of Object.entries(SHEETS)) {
  if (only.length && !only.includes(name)) continue;
  const f = path.join(OUT, `${name}.png`);
  fs.writeFileSync(f, make());
  wrote.push(`${name}.png (${Math.round(fs.statSync(f).size / 1024)} kB)`);
}
process.stderr.write(`[settlers] wrote ${wrote.join(', ')}\n`);

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
  // Sand, for the footpaths between the front doors. Detail only, unlike the cobbles
  // above: the colour of a sandy path is in the mesh, and a sheet with sand's own yellow
  // in it would multiply over that and come out as mustard - see the note at the top.
  // So what is drawn here is grit, the slow unevenness of a track that has been walked
  // rather than laid, and the odd pebble trodden into it, in brightness alone.
  //
  // Quiet, 0.74 to 0.95. This is the surface you look straight down at from two metres
  // in walk mode and it runs the length of the island in the overview; a loud sheet on it
  // would read as gravel from above and as static from below.
  'path-sand': () => {
    const grit = fbm(40401, [64, 128, 256]);
    const drift = fbm(40402, [6, 13]);
    const pebbles = sites(11, 11, 0.9, 40403);
    const reach = (N / 11) * 0.34;
    return draw((x, y) => {
      let stone = 0;
      for (const s of pebbles) {
        const d = Math.hypot(wrapD(x, s.x), wrapD(y, s.y)) / reach;
        if (d < 1) stone = Math.max(stone, (1 - d * d) * (s.tone - 0.8));
      }
      return detail(0.74 + 0.16 * (grit(x, y) * 0.55 + drift(x, y) * 0.45) + 0.12 * stone, 1);
    });
  },
  // Rounded river shingle with quiet, irregular joints. Like the field and path sheets
  // this carries detail rather than colour; the bank palette remains in world.js so it
  // still belongs to the island's light, season and distance haze.
  'river-shingle': () => {
    const pebble = cells(sites(14, 14, 0.95, 51511, 1.15), 1.15);
    const grain = fbm(51512, [36, 84, 168]);
    return draw((x, y) => {
      const c = pebble(x, y);
      const round = Math.min(1, c.edge / 5.5);
      const tone = (0.63 + 0.25 * c.tone * (0.38 + 0.62 * round)) * (0.92 + grain(x, y) * 0.16);
      return detail(tone, 1);
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
  // Leaf mass for a hedge. The same piling-up as `foliage` above and for the same reason
  // - leaves have no joints, so nothing here goes near cells() - but at hedge scale: a
  // hedge is a metre and a half of clipped growth rather than a canopy, so the clumps are
  // a quarter the size and there are five times as many. That scale has to be drawn in
  // rather than dialled in on the mesh: a canopy sheet shrunk down far enough to read as
  // hedge leaves takes its fine noise with it, and what arrives at the eye is mush.
  //
  // Quieter than foliage as well, 0.70 to 0.92. A boundary is a line across the island
  // and the eye follows it; a loud sheet on it would read as a hedge full of holes.
  'hedge-leaf': () => {
    const leaves = sites(16, 16, 1.0, 12021);
    const reach = (N / 16) * 1.05;
    const fine = fbm(12022, [24, 52]);
    return draw((x, y) => {
      let lit = 0;
      for (const s of leaves) {
        const d = Math.hypot(wrapD(x, s.x), wrapD(y, s.y)) / reach;
        if (d < 1) lit = Math.max(lit, (1 - d * d) * s.tone);
      }
      return detail(0.70 + 0.22 * (lit * 0.68 + fine(x, y) * 0.32), -1);
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
  // Plaster, for the walls the island renders. The island is drawn in the key Animal
  // Crossing is drawn in: the silhouette carries the building and nothing on the wall
  // may compete with it. So this is the quietest sheet of the set - a slow unevenness
  // that says a hand floated this wall, a fine tooth under it, and a span of 0.82 to
  // 0.96 rather than the near-black-to-white a stone sheet is allowed.
  'wall-plaster': () => {
    const float = fbm(60601, [4, 9]);
    const tooth = fbm(60602, [40, 88]);
    return draw((x, y) => detail(0.82 + 0.14 * (float(x, y) * 0.58 + tooth(x, y) * 0.42), 1));
  },
  // Pantiles. Not cells(): cells() draws the joint between two neighbours, which is
  // paving, and a roof is not paved - it is a stack of curved tiles, each lapping over
  // the course below, and what you see from the ground is the row of crowns and the
  // shadow line under each lap. So the pattern is drawn straight from the lattice a
  // roofer works on: twelve to a course, every other course offset by half a tile.
  //
  // Twelve tiles across a sheet and a sheet to the world unit puts a tile at about a
  // third of a metre, which is what a pantile is.
  'roof-tile': () => {
    const COLS = 12, ROWS = 16;
    const tw = N / COLS, th = N / ROWS;
    const grain = fbm(91101, [20, 56]);
    // Each tile a shade of its own, or a roof reads as wallpaper.
    const shade = (c, r) => 0.96 + ((((c * 73856093) ^ (r * 19349663)) >>> 0) % 100) / 100 * 0.08;
    return draw((x, y) => {
      const row = Math.floor(y / th);
      const fx = (x - (row % 2) * tw * 0.5 + N) % N;
      const col = Math.floor(fx / tw) % COLS;
      const u = (fx / tw) % 1, v = (y / th) % 1;
      // The crown: broad and flat over most of the tile, dipping quickly into the
      // channel at either side. The power is what keeps it a soft roll rather than a
      // groove cut with a knife.
      const crown = Math.pow(Math.max(0, Math.cos((u - 0.5) * Math.PI)), 0.35);
      // And the lap: the course above ends here, so the top of every tile sits in its
      // shadow and brightens as it comes out from under.
      const lap = Math.min(1, v / 0.26);
      return detail((0.79 + 0.17 * (crown * 0.45 + lap * 0.4 + grain(x, y) * 0.15)) * shade(col, row), 1);
    });
  },
  // Sawn boards, for decking and anything else laid plank by plank. Six to a sheet, and
  // the seam between two of them is a soft shadow rather than a cut line - these are
  // boards a carpenter fitted, not a grating.
  //
  // The grain runs the length of the board, and the way to get that out of a lattice
  // that has one period for both axes is to walk the y axis faster rather than the x
  // axis slower. Slower means a fractional step, and a fractional step does not come
  // back to where it started at the edge of the sheet - the seam would show. Six times
  // y, wrapped, both stretches the noise along the board and stays seamless.
  plank: () => {
    const ROWS = 6, bh = N / ROWS;
    const streak = fbm(70701, [10, 22]);
    const fine = fbm(70702, [28, 56]);
    const shade = (r) => 0.94 + ((((r + 1) * 2654435761) >>> 0) % 100) / 100 * 0.11;
    return draw((x, y) => {
      const row = Math.floor(y / bh), v = (y / bh) % 1;
      const seam = Math.min(1, Math.min(v, 1 - v) / 0.1);
      const g = streak(x, (y * 6) % N) * 0.62 + fine(x, (y * 3) % N) * 0.38;
      return detail((0.8 + 0.16 * (seam * 0.5 + g * 0.5)) * shade(row), 1);
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

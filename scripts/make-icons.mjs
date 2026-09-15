// Draws the island icon straight into PNG files. The format itself lives in png.mjs;
// this is only the drawing, and it needs nothing but flat colour.
import fs from 'node:fs';
import path from 'node:path';
import { png } from './png.mjs';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'web', 'icons');

// A small island seen from above: sea, beach, meadow, a hill and one house.
function draw(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const s = (v) => Math.round(v * size);
  const set = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };
  const SEA = [26, 74, 110], SHALLOW = [61, 122, 158], SAND = [232, 214, 164];
  const MEADOW = [143, 191, 90], UPLAND = [111, 166, 74], ROCK = [163, 157, 144];
  const WALL = [244, 236, 224], ROOF = [180, 78, 58];

  const cx = size / 2, cy = size / 2;
  const land = maskable ? size * 0.30 : size * 0.38;     // maskable icons need a safe margin
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = (y - cy) * 1.06;
      const d = Math.sqrt(dx * dx + dy * dy);
      // a soft, irregular coastline
      // whole harmonics only, or the coastline steps where the angle wraps at pi
      const a = Math.atan2(dy, dx);
      const wobble = 1 + 0.09 * Math.sin(a * 3 + 0.7) + 0.05 * Math.sin(a * 5 - 1.2);
      const edge = land * wobble;
      if (d > edge) set(x, y, d > edge * 1.22 ? SEA : SHALLOW);
      else if (d > edge * 0.88) set(x, y, SAND);
      else {
        const hill = Math.sqrt((x - cx * 1.18) ** 2 + (y - cy * 0.82) ** 2);
        if (hill < edge * 0.30) set(x, y, hill < edge * 0.16 ? ROCK : UPLAND);
        else set(x, y, MEADOW);
      }
    }
  }
  // one house, so it reads as a village and not a leaf
  const hw = Math.max(2, s(0.085)), hh = Math.max(2, s(0.075));
  const hx = Math.round(cx - hw / 2 - s(0.06)), hy = Math.round(cy + s(0.02));
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) set(hx + x, hy + y, WALL);
  for (let y = 0; y < Math.round(hh * 0.75); y++) {
    const w = Math.round(hw * (1 - y / (hh * 0.75)) + 2);
    for (let x = 0; x < w; x++) set(hx + Math.round((hw - w) / 2) + x, hy - y - 1, ROOF);
  }
  return png(size, size, px);
}

fs.mkdirSync(OUT, { recursive: true });
const wrote = [];
for (const size of [192, 512]) {
  const f = path.join(OUT, `island-${size}.png`);
  fs.writeFileSync(f, draw(size));
  wrote.push(`${path.basename(f)} (${fs.statSync(f).size} bytes)`);
}
const f = path.join(OUT, 'island-maskable-512.png');
fs.writeFileSync(f, draw(512, { maskable: true }));
wrote.push(`${path.basename(f)} (${fs.statSync(f).size} bytes)`);
process.stderr.write(`[settlers] wrote ${wrote.join(', ')}\n`);

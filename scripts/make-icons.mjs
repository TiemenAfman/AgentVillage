// Draws the island icon straight into PNG files. No image library: a PNG is a header,
// a few length-prefixed chunks and a zlib stream, and we only need flat colour.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'web', 'icons');

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;                                  // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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

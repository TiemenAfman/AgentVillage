#!/usr/bin/env node
// The village on the island, seen from above, without starting Godot.
//
// `scripts/island.mjs` shows the ground and `VerifyMetricsRunner` counts the buildings, and
// between the two there was nowhere to answer the only question that matters after a
// re-founding: does this read as a village? Not "did 267 plots fit" - that is a number - but
// whether the hamlets sit apart, whether the roads go anywhere, whether the town is the
// middle of something.
//
//   node scripts/village-map.mjs                          data/world + data/layout.json
//   node scripts/village-map.mjs --data <dir> --out a.png
//   node scripts/village-map.mjs --zoom 240               metres across, centred on the town
//
import fs from 'node:fs';
import path from 'node:path';
import { encodePng, makeCanvas } from '../lib/png.mjs';
import { loadWorld } from '../lib/world/load.mjs';
import { CLASS } from '../lib/world/classify.mjs';
import { METRES_PER_LOT } from '../lib/world/lotfield.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dataDir = arg('data', path.join(process.cwd(), 'data'));
const out = arg('out', 'village-map.png');
const px = Number(arg('px', 1100));
const zoom = Number(arg('zoom', 0));            // metres across; 0 means the whole island

const loaded = loadWorld(path.join(dataDir, 'world'));
if (!loaded) throw new Error(`no world in ${path.join(dataDir, 'world')} - run a scan first`);
const layoutFile = path.join(dataDir, 'layout.json');
if (!fs.existsSync(layoutFile)) throw new Error(`no layout in ${layoutFile} - run a scan first`);
const layout = JSON.parse(fs.readFileSync(layoutFile, 'utf8'));
const { field, manifest } = loaded;

// ---- ground ----------------------------------------------------------------
// Flatter than the diagnostic renderer on purpose: this picture is about the village, so
// the island is its paper. Height still shades it, or a hillside hamlet would read as a
// hamlet on a plain.
const GROUND = {
  [CLASS.BEACH]: [0.88, 0.82, 0.65],
  [CLASS.DUNE]: [0.84, 0.80, 0.62],
  [CLASS.MEADOW]: [0.72, 0.78, 0.58],
  [CLASS.WOOD]: [0.55, 0.65, 0.48],
  [CLASS.SCREE]: [0.74, 0.72, 0.66],
  [CLASS.ROCK]: [0.70, 0.68, 0.64],
  [CLASS.CLIFF]: [0.62, 0.60, 0.57],
  [CLASS.RIVER]: [0.40, 0.62, 0.72],
  [CLASS.LAKE]: [0.32, 0.54, 0.68],
  [CLASS.POLDER]: [0.74, 0.79, 0.60],
};

// One hue per district, walked around the wheel so neighbours differ. The town is its own.
function districtColour(k) {
  const h = (k * 0.618033988749895) % 1;           // golden angle: no two of twelve collide
  const i = Math.floor(h * 6), f = h * 6 - i;
  const q = 1 - f;
  switch (i % 6) {
    case 0: return [1, f, 0];
    case 1: return [q, 1, 0];
    case 2: return [0, 1, f];
    case 3: return [0, q, 1];
    case 4: return [f, 0, 1];
    default: return [1, 0, q];
  }
}

const half = manifest.envelopeM / 2;
const lotsAcross = Math.round(manifest.envelopeM / METRES_PER_LOT);
const anchorToWorld = (gx, gz) => [(gx - lotsAcross / 2) * METRES_PER_LOT, (gz - lotsAcross / 2) * METRES_PER_LOT];

// The frame: the whole island, or `--zoom` metres around the town.
let span = manifest.radiusM * 2.4;
let cx = 0, cz = 0;
if (zoom > 0) {
  span = zoom;
  if (layout.town) { const [wx, wz] = anchorToWorld(layout.town.centre[0], layout.town.centre[1]); cx = wx; cz = wz; }
}
const mPerPx = span / px;
const canvas = makeCanvas(px, px);

const sampleAt = (wx, wz) => {
  const i = Math.round((wx + half) / manifest.metresPerSample);
  const j = Math.round((wz + half) / manifest.metresPerSample);
  if (i < 0 || j < 0 || i >= field.n || j >= field.n) return null;
  return i + j * field.n;
};

for (let y = 0; y < px; y++) {
  for (let x = 0; x < px; x++) {
    const wx = cx + (x - px / 2) * mPerPx;
    const wz = cz + (y - px / 2) * mPerPx;
    const s = sampleAt(wx, wz);
    if (s === null) { canvas.set(x, y, 0.06, 0.16, 0.30); continue; }
    const h = field.height[s];
    const c = field.classes[s];
    if (h <= 0 || c === CLASS.SEA || c === CLASS.SHALLOW) {
      const t = Math.max(0, Math.min(1, -h / 20));
      canvas.set(x, y, 0.30 - 0.24 * t, 0.62 - 0.44 * t, 0.70 - 0.42 * t);
      continue;
    }
    const base = GROUND[c] || [0.70, 0.74, 0.60];
    // A cheap hillshade off the sample to the north-west, which is where the light is in
    // every one of the reference shots.
    const up = sampleAt(wx - 2, wz - 2);
    const d = up === null ? 0 : field.height[s] - field.height[up];
    const lit = Math.max(0.72, Math.min(1.28, 1 + d * 0.16));
    canvas.set(x, y, base[0] * lit, base[1] * lit, base[2] * lit);
  }
}

// ---- the village -----------------------------------------------------------
const toPx = (wx, wz) => [Math.round((wx - cx) / mPerPx + px / 2), Math.round((wz - cz) / mPerPx + px / 2)];
const dot = (wx, wz, r, col) => {
  const [x0, y0] = toPx(wx, wz);
  for (let y = y0 - r; y <= y0 + r; y++) {
    for (let x = x0 - r; x <= x0 + r; x++) {
      if (x < 0 || y < 0 || x >= px || y >= px) continue;
      if ((x - x0) ** 2 + (y - y0) ** 2 > r * r) continue;
      canvas.set(x, y, col[0], col[1], col[2]);
    }
  }
};
/** A block of lots, filled: this is how a plot is drawn at its real size. */
const block = (gx, gz, w, d, col) => {
  const [wx, wz] = anchorToWorld(gx, gz);
  const [x0, y0] = toPx(wx, wz);
  const [x1, y1] = toPx(wx + w * METRES_PER_LOT, wz + d * METRES_PER_LOT);
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (x < 0 || y < 0 || x >= px || y >= px) continue;
      canvas.set(x, y, col[0], col[1], col[2]);
    }
  }
};

// Roads under the buildings, because that is the order they were laid in.
for (const p of layout.paths || []) {
  for (const [gx, gz] of p.cells) block(gx, gz, 1, 1, [0.55, 0.51, 0.47]);
}
for (const [gx, gz] of (layout.town && layout.town.paved) || []) block(gx, gz, 1, 1, [0.66, 0.62, 0.57]);
// Crossings over the deck colour of a road, so an archipelago reads as wired or not.
for (const link of layout.links || []) {
  const col = link.kind === 'causeway' ? [0.70, 0.64, 0.50] : [0.46, 0.33, 0.24];
  for (const [gx, gz] of link.cells) block(gx, gz, 1, 1, col);
}

const ordOf = new Map([...Object.keys(layout.districts || {})].map((id, k) => [id, k]));
let houses = 0, sheds = 0, civics = 0, commons = 0;
for (const [id, p] of Object.entries(layout.plots || {})) {
  if (id.startsWith('civic:')) {
    civics++;
    block(p.gx, p.gz, p.w, p.d, [0.96, 0.93, 0.80]);
  } else if (p.w === 1) {
    sheds++;
    block(p.gx, p.gz, 1, 1, [0.45, 0.36, 0.30]);
  } else {
    houses++;
    if (p.commons) commons++;
    const col = p.commons || !ordOf.has(p.district)
      ? [0.86, 0.80, 0.72]
      : districtColour(ordOf.get(p.district)).map((v) => 0.30 + v * 0.60);
    block(p.gx, p.gz, p.w, p.d, col);
  }
}

if (layout.town) {
  const [wx, wz] = anchorToWorld(layout.town.centre[0], layout.town.centre[1]);
  dot(wx, wz, Math.max(3, Math.round(6 / mPerPx)), [0.10, 0.10, 0.12]);
}

fs.writeFileSync(out, encodePng(canvas.width, canvas.height, canvas.rgb));
process.stdout.write(
  `${out}  ${span.toFixed(0)} m across, ${mPerPx.toFixed(2)} m/px\n` +
  `${houses} houses (${commons} lodging on the commons), ${sheds} sheds, ${civics} civic, ` +
  `${(layout.paths || []).length} roads, ${Object.keys(layout.districts || {}).length} districts\n`,
);

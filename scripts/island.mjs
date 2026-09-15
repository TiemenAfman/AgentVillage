#!/usr/bin/env node
// Renders a seed as a top-down PNG, so an island can be judged without starting Godot.
//
// This exists because the previous round of visual work went wrong exactly here: twenty
// headless checks were green while the image was unusable. A generator you can look at in
// two seconds gets tuned; one you have to boot a game engine to see does not.
//
//   node scripts/island.mjs                          one island from the configured seed
//   node scripts/island.mjs --seed 42 --out a.png
//   node scripts/island.mjs --sheet 12               a contact sheet of twelve seeds
//
import fs from 'node:fs';
import path from 'node:path';
import { encodePng, makeCanvas } from '../lib/png.mjs';
import { renderIsland } from '../lib/world/render.mjs';
import { islandStats } from '../lib/world/stats.mjs';
import { publishWorld } from '../lib/world/publish.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const seed = Number(arg('seed', 1337));
const px = Number(arg('px', 900));              // image size in pixels
const span = Number(arg('span', 560));          // metres across the image
const radiusM = Number(arg('radius', 208));
const sheet = Number(arg('sheet', 0));
const outArg = arg('out', null);
const wantStats = process.argv.includes('--stats');
const publishTo = arg('publish', null);

if (publishTo) {
  const envelopeM = Number(arg('envelope', 1024));
  const t0 = Date.now();
  let last = '';
  const { manifest, bytes } = publishWorld(seed, publishTo, {
    envelopeM,
    radiusM,
    onProgress: (frac, what) => {
      if (!process.stdout.isTTY) return;      // a carriage return in a log file is a hundred lines
      const line = `${what} ${Math.round(frac * 100)}%`;
      if (line !== last) { process.stdout.write(line.padEnd(24) + String.fromCharCode(13)); last = line; }
    },
  });
  if (process.stdout.isTTY) process.stdout.write(''.padEnd(24) + String.fromCharCode(13));
  console.log(`${publishTo}  seed ${seed}, envelop ${envelopeM} m`);
  console.log(`  worldRev ${manifest.worldRev}  ${manifest.chunks.length} chunks  ` +
    `${(bytes / 1024).toFixed(0)} kB  in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(0);
}

if (wantStats) {
  // Numbers instead of a picture: the share of the island each terrain class takes, the
  // slope distribution, and the height reached. Tuning by eye alone is how the terrain ends
  // up grey everywhere without anyone being able to say why.
  const count = Number(arg('seeds', 1));
  for (let i = 0; i < count; i++) {
    const st = islandStats(seed + i, { radiusM });
    const share = Object.entries(st.classes)
      .sort((a, b) => b[1] - a[1])
      .map(([name, pct]) => `${name} ${pct.toFixed(0)}%`)
      .join('  ');
    console.log(
      `seed ${st.seed}  ${st.landHa.toFixed(1)} ha  ${st.extent[0]}x${st.extent[1]} m  ` +
      `top ${st.maxHeight.toFixed(0)} m  helling p50 ${st.slope.p50.toFixed(2)} p90 ${st.slope.p90.toFixed(2)}`);
    console.log(`          ${share}`);
  }
  process.exit(0);
}

function renderOne(s, size) {
  const canvas = makeCanvas(size, size);
  renderIsland(canvas, { seed: s, span, radiusM });
  return canvas;
}

if (sheet > 0) {
  // A grid of small renders: the fastest way to judge whether a generator produces variety
  // or the same island with the furniture moved.
  const cols = Math.ceil(Math.sqrt(sheet));
  const rows = Math.ceil(sheet / cols);
  const cell = Math.floor(px / cols);
  const sheetCanvas = makeCanvas(cell * cols, cell * rows);
  for (let i = 0; i < sheet; i++) {
    const one = renderOne(seed + i, cell);
    const ox = (i % cols) * cell, oy = Math.floor(i / cols) * cell;
    for (let y = 0; y < cell; y++) {
      const src = y * cell * 3;
      sheetCanvas.rgb.set(one.rgb.subarray(src, src + cell * 3), ((oy + y) * cell * cols + ox) * 3);
    }
    if (process.stdout.isTTY) process.stdout.write(`seed ${seed + i} (${i + 1}/${sheet})` + String.fromCharCode(13));
  }
  const out = outArg || `islands-${seed}-x${sheet}.png`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, encodePng(sheetCanvas.width, sheetCanvas.height, sheetCanvas.rgb));
  console.log(`${out}  ${sheet} seeds, ${cell}px each`);
} else {
  const canvas = renderOne(seed, px);
  const out = outArg || `island-${seed}.png`;
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, encodePng(canvas.width, canvas.height, canvas.rgb));
  console.log(`${out}  seed ${seed}, ${span} m across`);
}

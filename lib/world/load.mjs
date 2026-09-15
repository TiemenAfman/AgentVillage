import fs from 'node:fs';
import path from 'node:path';
import { decodeChunk, SAMPLES, QUANTUM } from './chunks.mjs';
import { CLASS } from './classify.mjs';

// Reading a published world back.
//
// The server bakes once and writes chunks; every scan after that reads them. That is the
// whole reason the chunks exist rather than a cached heightfield: baking the 1024 m
// envelope costs 1.7 seconds and a scan costs 0.9, so re-deriving the ground on every scan
// would have made the island the most expensive thing about the village. Reading it back
// costs about a fifth of a second and, more to the point, it is the *same bytes* the client
// draws - there is no second derivation to drift.
//
// Chunks overlap by one row: a 64 m chunk carries 65 samples so its edge is its neighbour's
// edge. Writing them in any order is therefore safe, because the duplicated rows agree.

/** Ocean where nothing was published. Deep enough that the client's water shader tints it. */
const UNPUBLISHED_DEPTH = -32;

/**
 * Reassemble the sample field from a published world.
 *
 * @param {string} dir  a directory holding manifest.json and chunk/
 * @returns {{manifest: object, field: object}|null}  null when there is no world there yet
 */
export function loadWorld(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { envelopeM, metresPerSample, chunkM } = manifest;
  const n = Math.round(envelopeM / metresPerSample) + 1;

  const height = new Float32Array(n * n).fill(UNPUBLISHED_DEPTH);
  const classes = new Uint8Array(n * n).fill(CLASS.SEA);

  const half = envelopeM / 2;
  for (const entry of manifest.chunks) {
    const file = path.join(dir, 'chunk', `${entry.cx}_${entry.cz}.${entry.hash}.bin`);
    if (!fs.existsSync(file)) {
      throw new Error(`the manifest names chunk ${entry.cx},${entry.cz} but ${path.basename(file)} is not there`);
    }
    const chunk = decodeChunk(fs.readFileSync(file));
    const originI = Math.round((entry.cx * chunkM + half) / metresPerSample);
    const originJ = Math.round((entry.cz * chunkM + half) / metresPerSample);
    for (let j = 0; j < SAMPLES; j++) {
      const sj = originJ + j;
      if (sj < 0 || sj >= n) continue;
      for (let i = 0; i < SAMPLES; i++) {
        const si = originI + i;
        if (si < 0 || si >= n) continue;
        const src = i + j * SAMPLES;
        const dst = si + sj * n;
        height[dst] = chunk.heights[src] * QUANTUM;
        classes[dst] = chunk.classes[src];
      }
    }
  }

  const field = {
    height,
    classes,
    n,
    envelopeM,
    metresPerSample,
    rivers: manifest.rivers || [],
    lakes: manifest.lakes || [],
  };
  return { manifest, field };
}

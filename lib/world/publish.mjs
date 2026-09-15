import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { bakeField, CHUNK_M, METRES_PER_SAMPLE } from './bake.mjs';
import { sliceChunk, encodeChunk, chunkHash, chunkHasLand, QUANTUM } from './chunks.mjs';

export const WORLD_VERSION = 2;

// Writing the world out.
//
// Two things are deliberate here and both are what make growth possible later.
//
// First, every chunk is named after a hash of its own bytes. An unchanged chunk keeps its
// filename forever, so it can be served `immutable` and cached for a year, and a client that
// already holds it never asks again.
//
// Second, the manifest lists which chunks are *published*, not which exist. The whole envelope
// is baked at founding; publishing more of it is how the island grows, and because the bytes
// were written once and are never rewritten, land that somebody built on cannot move.

/** Does this chunk belong in the world at all, or is it open ocean the client can fake? */
function worthPublishing(field, cx, cz, chunk) {
  if (chunkHasLand(chunk)) return true;
  // One ring of sea around the island as well: that is the shelf and the shallows, where the
  // water shader needs a real bottom to tint against.
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      if (chunkHasLand(sliceChunk(field, cx + dx, cz + dz))) return true;
    }
  }
  return false;
}

/**
 * Bake an island and write it as chunks plus a manifest.
 *
 * @param {number|string} seed
 * @param {string} outDir
 * @param {{envelopeM?: number, radiusM?: number, onProgress?: (frac: number, what: string) => void}} opts
 */
export function publishWorld(seed, outDir, { envelopeM = 1024, radiusM = 208, onProgress = null } = {}) {
  const report = (frac, what) => { if (onProgress) onProgress(frac, what); };

  const field = bakeField(seed, { envelopeM, radiusM, onProgress: (f) => report(f * 0.6, 'bakken') });

  const chunkDir = path.join(outDir, 'chunk');
  fs.mkdirSync(chunkDir, { recursive: true });

  const per = envelopeM / CHUNK_M;
  const half = per / 2;
  const chunks = [];
  let bytes = 0;
  let done = 0;

  for (let cz = -half; cz < half; cz++) {
    for (let cx = -half; cx < half; cx++) {
      const chunk = sliceChunk(field, cx, cz);
      done++;
      report(0.6 + (done / (per * per)) * 0.4, 'chunks');
      if (!worthPublishing(field, cx, cz, chunk)) continue;

      const encoded = encodeChunk(chunk);
      const hash = chunkHash(encoded);
      fs.writeFileSync(path.join(chunkDir, `${cx}_${cz}.${hash}.bin`), encoded);

      let minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < chunk.heights.length; k++) {
        const y = chunk.heights[k] * QUANTUM;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      chunks.push({ cx, cz, hash, bytes: encoded.length, minY: round2(minY), maxY: round2(maxY) });
      bytes += encoded.length;
    }
  }

  // Did the island run off the edge of the world? The envelope has to be comfortably larger
  // than the island or the coast is a straight line along the rim - and worse, growth has
  // nowhere to go. Reported rather than thrown, because a deliberately tiny envelope is
  // useful in a test.
  let clipped = false;
  const rim = field.n - 1;
  for (let i = 0; i <= rim && !clipped; i++) {
    if (field.height[i] > 0 || field.height[i + rim * field.n] > 0) clipped = true;
    if (field.height[i * field.n] > 0 || field.height[rim + i * field.n] > 0) clipped = true;
  }

  // The world's own revision: a hash over what was published, so the client can tell in one
  // string comparison whether anything about the ground changed. It is a cache key, not a
  // correctness check - there is only one generator now, so there is nothing to disagree with.
  const worldRev = crypto.createHash('sha256')
    .update(chunks.map((c) => `${c.cx},${c.cz},${c.hash}`).join(';'))
    .digest('hex').slice(0, 8);

  const manifest = {
    worldV: WORLD_VERSION,
    worldRev,
    seed,
    envelopeM,
    radiusM,
    metresPerSample: METRES_PER_SAMPLE,
    chunkM: CHUNK_M,
    quantum: QUANTUM,
    seaLevel: 0,
    clipped,
    generatedAt: new Date().toISOString(),
    chunks,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return { manifest, bytes, field };
}

function round2(v) { return Math.round(v * 100) / 100; }

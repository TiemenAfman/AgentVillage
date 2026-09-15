import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { bakeField, CHUNK_M, METRES_PER_SAMPLE } from './bake.mjs';
import { sliceChunk, encodeChunk, chunkHash, chunkHasLand, QUANTUM } from './chunks.mjs';
import { findLandmasses, findLandings } from './features.mjs';
import { RIVER_DEPTH, LAKE_DEPTH } from './water.mjs';
import { MAIN, buildManifest, isletGroups } from './growth.mjs';

export const WORLD_VERSION = 3;

// Writing the world out.
//
// Three things are deliberate here and all three are what make growth possible.
//
// First, every chunk is named after a hash of its own bytes. An unchanged chunk keeps its
// filename forever, so it can be served `immutable` and cached for a year, and a client that
// already holds it never asks again.
//
// Second, every chunk worth having is written to disk at founding, whether or not it is
// published yet. The 1.7 s bake therefore happens exactly once in the life of an island;
// growing it later is a list getting longer, not a generator running again.
//
// Third, the manifest lists which chunks are *published*, not which exist - that list lives
// in `atlas.json` beside it. The whole envelope is baked at founding; publishing more of it
// is how the island grows, and because the bytes were written once and are never rewritten,
// land that somebody built on cannot move.

/**
 * Bake an island and write it as chunks plus an atlas and a manifest.
 *
 * @param {number|string} seed
 * @param {string} outDir
 * @param {{envelopeM?: number, radiusM?: number, erosion?: number, islets?: number|'all',
 *          onProgress?: (frac: number, what: string) => void}} opts
 *        `islets` is how much of the archipelago to publish straight away: 0 (the default) is
 *        a founding, where only the mainland is above water and the village grows into the
 *        rest. `'all'` is for the preview tooling, which wants to see the whole envelope.
 */
export function publishWorld(seed, outDir, { envelopeM = 1024, radiusM = 208, erosion = undefined, islets = 0, onProgress = null } = {}) {
  const report = (frac, what) => { if (onProgress) onProgress(frac, what); };

  const field = bakeField(seed, { envelopeM, radiusM, erosion, onProgress: (f) => report(f * 0.6, 'bakken') });

  const chunkDir = path.join(outDir, 'chunk');
  fs.mkdirSync(chunkDir, { recursive: true });

  // What the island is, named rather than left to be rediscovered. The client used to read
  // terrain.HillCentre and terrain.Rivers off its own copy of the generator; with the terrain
  // arriving as bytes there is nothing left to read them from, so they travel here.
  const { masses, label } = findLandmasses(field);
  const landings = findLandings(field, masses, label);
  const groupOfMass = isletGroups(field, masses, label);
  const groupAt = (s) => {
    const id = label[s];
    if (id < 0) return null;
    // A rock of a handful of samples never became a landmass, so it has no group of its own.
    // It is a speck of the mainland's sea as far as publishing is concerned.
    return groupOfMass.has(id) ? groupOfMass.get(id) : MAIN;
  };

  const per = envelopeM / CHUNK_M;
  const half = per / 2;
  const owned = new Map();                                   // "cx,cz" -> Set(group)
  const sliced = new Map();
  let done = 0;

  for (let cz = -half; cz < half; cz++) {
    for (let cx = -half; cx < half; cx++) {
      const chunk = sliceChunk(field, cx, cz);
      done++;
      report(0.6 + (done / (per * per)) * 0.3, 'chunks');
      sliced.set(`${cx},${cz}`, chunk);
      const groups = new Set();
      const originI = (cx * CHUNK_M + envelopeM / 2) / METRES_PER_SAMPLE;
      const originJ = (cz * CHUNK_M + envelopeM / 2) / METRES_PER_SAMPLE;
      for (let j = 0; j <= CHUNK_M; j++) {
        const sj = Math.min(field.n - 1, Math.max(0, originJ + j));
        for (let i = 0; i <= CHUNK_M; i++) {
          const si = Math.min(field.n - 1, Math.max(0, originI + i));
          const g = groupAt(si + sj * field.n);
          if (g !== null) groups.add(g);
        }
      }
      if (!groups.size && chunkHasLand(chunk)) groups.add(MAIN);
      owned.set(`${cx},${cz}`, groups);
    }
  }

  const atlasChunks = [];
  let bytes = 0;
  done = 0;
  for (let cz = -half; cz < half; cz++) {
    for (let cx = -half; cx < half; cx++) {
      const chunk = sliced.get(`${cx},${cz}`);
      done++;
      report(0.9 + (done / (per * per)) * 0.1, 'schrijven');
      // A chunk comes in with the land on it. A chunk of open water comes in with whatever
      // land it touches - that ring is the shelf and the shallows, where the water shader
      // needs a real bottom to tint against - and this is also what keeps the ring a ring
      // around the island rather than one around the mainland with holes where the islets are
      // not above water yet. Everything past that ring is open ocean the client can fake.
      let needs = [...owned.get(`${cx},${cz}`)];
      if (!needs.length) {
        const ring = new Set();
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            for (const g of owned.get(`${cx + dx},${cz + dz}`) || []) ring.add(g);
          }
        }
        needs = [...ring];
      }
      if (!needs.length) continue;

      const encoded = encodeChunk(chunk);
      const hash = chunkHash(encoded);
      fs.writeFileSync(path.join(chunkDir, `${cx}_${cz}.${hash}.bin`), encoded);

      let minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < chunk.heights.length; k++) {
        const y = chunk.heights[k] * QUANTUM;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      atlasChunks.push({
        cx, cz, hash, bytes: encoded.length, minY: round2(minY), maxY: round2(maxY),
        needs: needs.sort((a, b) => a - b),
      });
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

  // The revision of the *ground*, as against `worldRev`, which is the revision of what has
  // been published of it. This is the one the layout is gated on: growing the island adds
  // land nobody has built on, so nothing has to move, while a re-bake changes the ground
  // under every house and has to re-found the village. Hashing the two together was the
  // first thing tried and it re-founded the whole island once per islet.
  const bakeRev = crypto.createHash('sha256')
    .update(`${WORLD_VERSION}|${seed}|${envelopeM}|${radiusM}|`)
    .update(atlasChunks.map((c) => `${c.cx},${c.cz},${c.hash}`).join(';'))
    .digest('hex').slice(0, 8);

  const available = [...new Set([...groupOfMass.values()].filter((g) => g !== MAIN))].sort((a, b) => a - b);

  const atlas = {
    worldV: WORLD_VERSION,
    bakeRev,
    seed,
    envelopeM,
    radiusM,
    metresPerSample: METRES_PER_SAMPLE,
    chunkM: CHUNK_M,
    quantum: QUANTUM,
    seaLevel: 0,
    clipped,
    generatedAt: new Date().toISOString(),
    // Fresh water is not defined by height - a stream at 30 m is still a stream - so its
    // surface sits a fixed depth above the bed it runs in. The client needs both numbers to
    // put water in a channel.
    riverDepth: RIVER_DEPTH,
    lakeDepth: LAKE_DEPTH,
    islets: available,
    landmasses: masses.map((m) => ({
      index: m.index,
      group: groupOfMass.get(m.id),
      // The islet this landmass is, for anyone who has to name it later - the layout records
      // it in `layout.districts[id].islet` and never looks at the flood-fill order again.
      islet: groupOfMass.get(m.id) === MAIN ? undefined : groupOfMass.get(m.id),
      areaHa: m.areaHa, centroid: m.centroid, bounds: m.bounds, peak: m.peak,
    })),
    landings: landings.map((l) => ({
      ...l,
      group: groupOfMass.get((masses.find((m) => m.index === l.landmass) || {}).id),
    })),
    rivers: field.rivers,
    lakes: field.lakes,
    chunks: atlasChunks,
  };
  fs.writeFileSync(path.join(outDir, 'atlas.json'), JSON.stringify(atlas, null, 2));

  const open = islets === 'all' ? available : available.slice(0, Math.max(0, Number(islets) || 0));
  const manifest = buildManifest(atlas, open);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return { manifest, atlas, bytes, field };
}

function round2(v) { return Math.round(v * 100) / 100; }

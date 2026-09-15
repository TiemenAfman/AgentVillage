import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { CHUNK_M, METRES_PER_SAMPLE } from './bake.mjs';

// The on-disk chunk: the unit the world is published in.
//
// 64 m square, sampled every metre, with a duplicated edge row and column - 65x65. The
// duplication is the whole reason chunks can carry their own collider and their own mesh
// without a seam: two neighbouring chunks agree on the samples they share, exactly, because
// they are the same numbers written twice.
//
// A chunk is immutable by construction. Growing the island publishes chunks, it never
// rewrites them, so the bytes under a house are the same bytes forever.
//
// Heights travel as int16 at 1/256 m, delta-coded along +x. That is not premature: the field
// is smooth, so consecutive deltas are tiny and gzip finds them; raw they are 8.5 kB a chunk
// and after this they are around a tenth of that.

export const MAGIC = 'PHC1';
export const SAMPLES = CHUNK_M / METRES_PER_SAMPLE + 1;      // 65
export const QUANTUM = 1 / 256;
const HEADER_BYTES = 4 + 4 + 4 + 2 + 2 + 4;

/** Slice one chunk out of a baked field. */
export function sliceChunk(field, cx, cz) {
  const heights = new Int16Array(SAMPLES * SAMPLES);
  const classes = new Uint8Array(SAMPLES * SAMPLES);
  const half = field.envelopeM / 2;
  const originI = (cx * CHUNK_M + half) / METRES_PER_SAMPLE;
  const originJ = (cz * CHUNK_M + half) / METRES_PER_SAMPLE;

  for (let j = 0; j < SAMPLES; j++) {
    for (let i = 0; i < SAMPLES; i++) {
      // Clamped rather than wrapped: a chunk on the rim of the envelope repeats its edge,
      // which is open ocean, so nothing has to special-case the boundary.
      const si = Math.min(field.n - 1, Math.max(0, originI + i));
      const sj = Math.min(field.n - 1, Math.max(0, originJ + j));
      const src = si + sj * field.n;
      const dst = i + j * SAMPLES;
      heights[dst] = Math.round(field.height[src] / QUANTUM);
      classes[dst] = field.classes[src];
    }
  }
  return { cx, cz, heights, classes };
}

export function encodeChunk(chunk) {
  const head = Buffer.alloc(HEADER_BYTES);
  head.write(MAGIC, 0, 'ascii');
  head.writeInt32LE(chunk.cx, 4);
  head.writeInt32LE(chunk.cz, 8);
  head.writeUInt16LE(CHUNK_M / METRES_PER_SAMPLE, 12);        // samples per side, less the edge
  head.writeUInt16LE(SAMPLES, 14);
  head.writeFloatLE(QUANTUM, 16);

  // Delta along +x, restarting each row so a row is independently decodable.
  const deltas = Buffer.alloc(SAMPLES * SAMPLES * 2);
  for (let j = 0; j < SAMPLES; j++) {
    let prev = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const v = chunk.heights[i + j * SAMPLES];
      deltas.writeInt16LE(clampInt16(v - prev), (i + j * SAMPLES) * 2);
      prev = v;
    }
  }

  return zlib.gzipSync(Buffer.concat([head, deltas, Buffer.from(chunk.classes)]), { level: 9 });
}

export function decodeChunk(buf) {
  const raw = zlib.gunzipSync(buf);
  const magic = raw.subarray(0, 4).toString('ascii');
  if (magic !== MAGIC) throw new Error(`not a Promptholm chunk: magic ${JSON.stringify(magic)}`);
  const cx = raw.readInt32LE(4);
  const cz = raw.readInt32LE(8);
  const samples = raw.readUInt16LE(14);
  if (samples !== SAMPLES) throw new Error(`chunk is ${samples} samples a side, this build expects ${SAMPLES}`);

  const heights = new Int16Array(samples * samples);
  const classes = new Uint8Array(samples * samples);
  for (let j = 0; j < samples; j++) {
    let prev = 0;
    for (let i = 0; i < samples; i++) {
      const k = i + j * samples;
      prev += raw.readInt16LE(HEADER_BYTES + k * 2);
      heights[k] = prev;
    }
  }
  const classOffset = HEADER_BYTES + samples * samples * 2;
  classes.set(raw.subarray(classOffset, classOffset + samples * samples));

  return { cx, cz, heights, classes };
}

/** Content hash, and therefore the chunk's filename: an unchanged chunk keeps its URL forever. */
export function chunkHash(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

/** Does this chunk contain anything but open sea? Used to decide what is worth publishing. */
export function chunkHasLand(chunk) {
  for (let k = 0; k < chunk.heights.length; k++) if (chunk.heights[k] > 0) return true;
  return false;
}

function clampInt16(v) {
  return v < -32768 ? -32768 : v > 32767 ? 32767 : v;
}

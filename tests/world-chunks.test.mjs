import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { bakeField, CHUNK_M, METRES_PER_SAMPLE } from '../lib/world/bake.mjs';
import { sliceChunk, encodeChunk, decodeChunk, chunkHash, SAMPLES, QUANTUM } from '../lib/world/chunks.mjs';
import { publishWorld, WORLD_VERSION } from '../lib/world/publish.mjs';
import { MAX_GRADIENT } from '../lib/world/relief.mjs';

// The chunk is the unit the world is published in, and the promise attached to it is that it
// never changes. These guard the two things that promise rests on: a chunk survives a round
// trip exactly, and two neighbouring chunks agree on the samples they share.

const ENVELOPE = 256;              // small enough to bake in a test, big enough to be real
// The island is 300-500 m across, so anything at ENVELOPE would be clipped by the rim and
// every chunk would touch land. The publish tests need room around it to have any sea to skip.
// The full 1024 and not the old 640: the archipelago reaches 450 m out from the middle now
// (sixteen rocks, and the last of them stand off the first ones), so 640 is a window the
// island really does run off the edge of - which is what `clipped` is there to say.
const OPEN_ENVELOPE = 1024;

let field;
test.before(() => { field = bakeField(1337, { envelopeM: ENVELOPE }); });

test('a chunk survives encoding and decoding exactly', () => {
  const chunk = sliceChunk(field, 0, 0);
  const back = decodeChunk(encodeChunk(chunk));
  assert.equal(back.cx, chunk.cx);
  assert.equal(back.cz, chunk.cz);
  assert.deepEqual([...back.heights], [...chunk.heights], 'heights differ after a round trip');
  assert.deepEqual([...back.classes], [...chunk.classes], 'classes differ after a round trip');
});

test('neighbouring chunks agree on the edge they share', () => {
  // This is what the duplicated edge row is for: without it two chunks would each have their
  // own idea of where the ground is along their common border, and the avatar would catch on
  // the seam. Assert it rather than trust it.
  const a = sliceChunk(field, 0, 0);
  const b = sliceChunk(field, 1, 0);
  for (let j = 0; j < SAMPLES; j++) {
    assert.equal(b.heights[j * SAMPLES], a.heights[SAMPLES - 1 + j * SAMPLES],
      `east edge of (0,0) and west edge of (1,0) disagree at row ${j}`);
  }
  const c = sliceChunk(field, 0, 1);
  for (let i = 0; i < SAMPLES; i++) {
    assert.equal(c.heights[i], a.heights[i + (SAMPLES - 1) * SAMPLES],
      `south edge of (0,0) and north edge of (0,1) disagree at column ${i}`);
  }
});

test('a chunk covers exactly its own 64 metres', () => {
  assert.equal(SAMPLES, CHUNK_M / METRES_PER_SAMPLE + 1);
  assert.equal(sliceChunk(field, 0, 0).heights.length, SAMPLES * SAMPLES);
});

test('the same chunk always hashes the same, a different one does not', () => {
  const a = encodeChunk(sliceChunk(field, 0, 0));
  const again = encodeChunk(sliceChunk(field, 0, 0));
  assert.equal(chunkHash(again), chunkHash(a), 'a chunk must keep its name forever');
  assert.notEqual(chunkHash(encodeChunk(sliceChunk(field, 1, 0))), chunkHash(a));
});

test('the gradient cap is applied to what actually gets written', () => {
  // The cap cannot run inside the continuous height function - there is no neighbour to
  // compare against - so it runs on the grid, and this is the only place it can be checked.
  const n = field.n;
  let worst = 0;
  for (let j = 1; j < n - 1; j++) {
    for (let i = 1; i < n - 1; i++) {
      const k = i + j * n;
      if (field.height[k] <= 0) continue;
      worst = Math.max(worst, Math.abs(field.height[k] - field.height[k + 1]));
      worst = Math.max(worst, Math.abs(field.height[k] - field.height[k + n]));
    }
  }
  assert.ok(worst <= MAX_GRADIENT * METRES_PER_SAMPLE + 1e-3,
    `a step of ${worst.toFixed(2)} m survived the cap of ${MAX_GRADIENT} m`);
  assert.ok(field.cappedSamples > 0, 'the cap never fired - is the terrain suspiciously flat?');
});

test('publishing writes a manifest and every chunk it names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-world-'));
  try {
    const { manifest } = publishWorld(1337, dir, { envelopeM: OPEN_ENVELOPE });
    assert.equal(manifest.worldV, WORLD_VERSION);
    assert.match(manifest.worldRev, /^[0-9a-f]{8}$/);
    assert.ok(manifest.chunks.length > 0, 'nothing was published');

    for (const c of manifest.chunks) {
      const file = path.join(dir, 'chunk', `${c.cx}_${c.cz}.${c.hash}.bin`);
      assert.ok(fs.existsSync(file), `the manifest names ${file} but it is not there`);
      assert.equal(fs.statSync(file).size, c.bytes);
      const decoded = decodeChunk(fs.readFileSync(file));
      assert.equal(decoded.cx, c.cx);
      assert.equal(decoded.cz, c.cz);
    }

    // Open ocean is not published: the client draws water without being told where it is.
    const per = OPEN_ENVELOPE / CHUNK_M;
    assert.ok(manifest.chunks.length < per * per, 'every chunk was published, empty sea included');
    assert.ok(manifest.chunks.some((c) => c.maxY > 0), 'no published chunk contains any land');
    assert.equal(manifest.clipped, false, 'the island ran off the edge of its own envelope');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('publishing the same seed twice gives the same world', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-b-'));
  try {
    const one = publishWorld(1337, a, { envelopeM: OPEN_ENVELOPE });
    const two = publishWorld(1337, b, { envelopeM: OPEN_ENVELOPE });
    assert.equal(two.manifest.worldRev, one.manifest.worldRev);
    assert.deepEqual(
      two.manifest.chunks.map((c) => `${c.cx},${c.cz},${c.hash}`),
      one.manifest.chunks.map((c) => `${c.cx},${c.cz},${c.hash}`));
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test('heights survive quantisation to a quarter of a centimetre', () => {
  assert.equal(QUANTUM, 1 / 256);
  const chunk = sliceChunk(field, 0, 0);
  const half = field.envelopeM / 2;
  for (let j = 0; j < SAMPLES; j += 7) {
    for (let i = 0; i < SAMPLES; i += 7) {
      const src = (half + i) + (half + j) * field.n;
      const stored = chunk.heights[i + j * SAMPLES] * QUANTUM;
      assert.ok(Math.abs(stored - field.height[src]) <= QUANTUM,
        `sample ${i},${j} drifted by ${(stored - field.height[src]).toFixed(4)} m`);
    }
  }
});

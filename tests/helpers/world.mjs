import { bakeField } from '../../lib/world/bake.mjs';
import { makeLotField } from '../../lib/world/lotfield.mjs';

// A baked island for the layout tests.
//
// The layout no longer derives the ground; it is handed a lot field. Baking one costs a
// second and a half, which is more than the whole layout suite, so it is baked once per
// seed and shared. That is safe because a lot field is read-only - `placeAll` writes to
// the layout and to its own cell grid, never to the ground.
//
// The envelope is smaller than the real one (384 m against 1024) and the island smaller
// with it. These tests are about invariants - a plot never moves, land never changes hands
// - and those hold at any size, while a full-size bake would put nine seconds on every run.

const cache = new Map();

export const TEST_ENVELOPE_M = 384;
export const TEST_RADIUS_M = 148;

export function testLots(seed, { envelopeM = TEST_ENVELOPE_M, radiusM = TEST_RADIUS_M } = {}) {
  const key = `${seed}:${envelopeM}:${radiusM}`;
  if (!cache.has(key)) {
    const field = bakeField(seed, { envelopeM, radiusM });
    cache.set(key, { lots: makeLotField(field), worldRev: `test-${key}` });
  }
  return cache.get(key);
}

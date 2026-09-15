import { bakeField } from '../../lib/world/bake.mjs';
import { makeLotField } from '../../lib/world/lotfield.mjs';
import { findLandmasses } from '../../lib/world/features.mjs';
import { isletGroups, isletSpecs, MAIN } from '../../lib/world/growth.mjs';

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
// The archipelago wants a bigger island than the rest of the layout tests do, and for two
// reasons. The skerries sit 26 to 78 m off a coastline that is itself 150 to 260 m out, so at
// 384 m of envelope they fall outside the window and there is nothing to test against. And
// they scale with the island: at `TEST_RADIUS_M` they come out at 0.2 ha and hold one
// super-cell, which is not a hamlet, so every district would be turned away as not fitting.
// At the real radius they are 0.4 to 0.9 ha, the same rocks the live island has. 1.4 s.
export const TEST_ISLET_ENVELOPE_M = 640;
export const TEST_ISLET_RADIUS_M = 208;

export function testLots(seed, { envelopeM = TEST_ENVELOPE_M, radiusM = TEST_RADIUS_M } = {}) {
  const key = `${seed}:${envelopeM}:${radiusM}`;
  if (!cache.has(key)) {
    const field = bakeField(seed, { envelopeM, radiusM });
    cache.set(key, { field, lots: makeLotField(field), worldRev: `test-${key}` });
  }
  return cache.get(key);
}

/**
 * The islets of a test island, in the shape `placeAll` wants them.
 *
 * Deliberately routed through the production `isletGroups`/`isletSpecs` rather than through a
 * fixture: the thing worth testing about an islet's number is that it is the skerry's own
 * index, and a hand-written list would agree with itself whatever the generator did.
 */
export function testIslets(seed, opts = {}) {
  const { field } = testLots(seed, { envelopeM: TEST_ISLET_ENVELOPE_M, radiusM: TEST_ISLET_RADIUS_M, ...opts });
  const { masses, label } = findLandmasses(field);
  const groups = isletGroups(field, masses, label);
  return isletSpecs({
    envelopeM: field.envelopeM,
    landmasses: masses
      .filter((m) => groups.get(m.id) !== MAIN)
      .map((m) => ({ index: m.index, islet: groups.get(m.id), centroid: m.centroid })),
  });
}

// The volcano in the middle of the sea, and the one copy of what it is.
//
// It is the sea's own island - the one exception to "the sea has no island of its own" -
// and it is allowed to be because it follows entirely from the numbers below. No islander
// sends it and nobody claims it: lib/fleet.mjs raises it from this identity when a sea
// starts, at [0, 0], before anybody joins, and never sweeps it. A restart raises exactly
// the same one, which is why the sea still writes nothing down.
//
// In shared/ rather than lib/ because both ends need the same answer: the sea builds its
// terrain from these numbers, and a page that is handed its bundle builds the identical
// ground from the same fields (seed, size, `volcano: true`) and checks the hash.
import { makeTerrain } from './terrain.mjs';

export const VOLCANO = Object.freeze({
  // Sixteen hex digits, like every other island id, so it passes ISLAND_ID in
  // lib/islandbundle.mjs and fits BOAT_ID and the `guest:<id>:` namespace without a special
  // case. All zeros because it lies at the origin; a real island's id is a sha256 prefix
  // (beaconId) and landing on this one by accident is a one in 2^64 event.
  id: '0000000000000000',
  // A word rather than a number. makeTerrain hashes its seed as a string either way; the
  // word is what the terrain was tuned on (shared/terrain.mjs, `volcano`), and it is also
  // what lets parseBundle tell the one island that may carry a word from every other.
  seed: 'volcano',
  size: 128,
  name: 'De Vulkaan',
  keeper: 'the sea',
  hostile: true,
  volcano: true,
});

export const isVolcano = (id) => id === VOLCANO.id;

// Its ground, the same call every side makes. `volcano: true` is what separates this
// terrain from an ordinary island of the same seed; until shared/terrain.mjs knows the
// flag it is ignored and this is a normal 128-grid island, which everything downstream
// also has to survive.
export function volcanoTerrain() {
  return makeTerrain(VOLCANO.seed, { size: VOLCANO.size, volcano: true });
}

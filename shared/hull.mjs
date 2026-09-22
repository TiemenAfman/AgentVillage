// How the baked Benchy sits in the water, and where a body standing in her has its feet.
//
// These lived in web/js/boat.js, next to the mesh they place, and they moved here the
// moment something with no mesh had to know them: the sea takes settlers out on the water
// now (shared/boating.mjs), and to lower one into a hull it has to know how far down the
// deck is. It draws nothing and imports no three.js, so the numbers had to come to it.
//
// scripts/build-benchy.py scales the coloured Blender source to fit a 0.54-high rider.
// The game mesh's cabin floor is measured by a downward ray at its centre; the ceiling
// is at 0.797, leaving headroom above the rider. tests/boat.test.mjs checks that fit.
// The keel then sits at y = 0, because every asset on this island must
// (scripts/model-rules.mjs refuses one that does not), so the island is what puts her in
// the water: DRAUGHT sinks the lower hull beneath the waterline, and the
// cabin floor is CABIN_FLOOR above the keel.
export const DRAUGHT = 0.13;
export const CABIN_FLOOR = 0.1855;
export const DECK_Y = CABIN_FLOOR - DRAUGHT;

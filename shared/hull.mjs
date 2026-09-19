// How the baked Benchy sits in the water, and where a body standing in her has its feet.
//
// These lived in web/js/boat.js, next to the mesh they place, and they moved here the
// moment something with no mesh had to know them: the sea takes settlers out on the water
// now (shared/boating.mjs), and to lower one into a hull it has to know how far down the
// deck is. It draws nothing and imports no three.js, so the numbers had to come to it.
//
// Both come off the baked hull rather than being chosen. scripts/build-benchy.py measures
// the cabin of the STL - floor at 8.2 mm, the underside of its roof at 36.8 - and scales
// the whole boat so that 28.5 mm holds a settler of 0.54 with a hand's width over his head.
// The keel then sits at y = 0, because every asset on this island must
// (scripts/model-rules.mjs refuses one that does not), so the island is what puts her in
// the water: DRAUGHT sinks her to the boot-topping, the band the paint changes at, and the
// cabin floor is CABIN_FLOOR above the keel.
export const DRAUGHT = 0.13;
export const CABIN_FLOOR = 0.179;
export const DECK_Y = CABIN_FLOOR - DRAUGHT;

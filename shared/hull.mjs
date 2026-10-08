// How the baked rowing boat sits in the water, and where a body in her is.
//
// These lived in web/js/boat.js, next to the mesh they place, and they moved here the
// moment something with no mesh had to know them: the sea takes settlers out on the water
// now (shared/boating.mjs), and to lower one into a hull it has to know how far down the
// deck is. It draws nothing and imports no three.js, so the numbers had to come to it.
//
// DECK_Y is a datum, not a boat any more. It was the 3D Benchy's cabin floor over the water
// (0.1855 above her keel, sunk 0.13), and every craft's deck is written above it
// (shared/crafts.mjs - the galleon's planks, her ladders, the walk map cut from her) and the sea
// lowers a settler into an outing's hull to it (lib/crowd.mjs). Moving it would lift everybody
// on the galleon off her deck, and an open sea from before would disagree with every page; so
// it keeps the Benchy's number exactly, written the way it was worked out.
export const DECK_Y = 0.1855 - 0.13;

// The rowing boat that replaced the Benchy (scripts/build-rowboat.py, Plans/roeiboot-en-schat.md).
// Her keel sits at y = 0, because every asset on this island must (scripts/model-rules.mjs
// refuses one that does not), so the island is what puts her in the water: DRAUGHT sinks her
// beneath the waterline - a light boat, 0.05 of her 0.21 depth, so the floorboards at 0.085 stay
// over the sea, which would otherwise show inside an open hull. Whoever is in her sits on the
// oarsman's thwart, whose top is SEAT above the keel (tests/boat.test.mjs measures it off the
// bake), and a sitting body's height is its seat (walk.js sitOn): SEAT_Y is that over the water.
// The page draws a rower and a settler on an outing there, not at DECK_Y.
export const DRAUGHT = 0.05;
export const SEAT = 0.159;
// The top of her floorboards over the keel, where feet - and the statue - go.
export const FLOORBOARDS = 0.085;
export const SEAT_Y = SEAT - DRAUGHT;

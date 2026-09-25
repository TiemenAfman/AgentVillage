// What each kind of boat is, for everybody who has to know without drawing it: how many
// may be aboard, where the helm is, and the deck they stand on (Plans/lopen-op-de-boot.md).
//
// The sea needs it to count a crew and keep a passenger on the planks (lib/boats.mjs,
// lib/players.mjs); the page needs it to walk on a deck and to draw who stands where. One
// copy, here, because those two disagreeing is a passenger the sea holds in the water while
// their own screen has them by the mast.
//
// Everything is in the hull's own frame (shared/deck.mjs): +z towards the bow, +x to the
// right of somebody facing it, the origin the middle of the hull on the waterline, y above
// DECK_Y (shared/hull.mjs). Units are the island's, like the rest of the world.
//
//   crew      how many may be aboard at once, pilot included
//   helm      where the pilot stands, [x, z], and faces the bow
//   deck      what can be stood on: rectangles { x, z, hx, hz, y }, centre and half-size,
//             y the height of that stretch of planking. Overlapping is fine - a point is on
//             the deck when it is inside any of them.
//   rails     what cannot be walked through: rectangles of the same shape, with no y. A
//             deck edge with no rail is where a body can step off - into the water, or onto
//             a quay the hull is lying against.
//
// No boat has more than one person yet. The Benchy is scaled for a single rider
// (scripts/build-benchy.py) and her whole deck is the helm: exactly what walk.js has always
// done with a pilot, pinned to the middle of the hull. A bigger boat is a new entry here
// with the numbers read off its model's anchors, not a change to anything that reads them.
export const CRAFTS = Object.freeze({
  benchy: Object.freeze({
    crew: 1,
    helm: Object.freeze([0, 0]),
    deck: Object.freeze([Object.freeze({ x: 0, z: 0, hx: 0.08, hz: 0.12, y: 0 })]),
    rails: Object.freeze([]),
  }),
});

// Which kind a boat is. Every boat there is today is a Benchy: an island's own, the ones its
// keeper builds at the harbours (lib/boatyard.mjs) and a wanderer's skiff (lib/boats.mjs).
// Asked by id rather than looked up in a table of ids, so a boat that has never been
// touched, and so has no record anywhere, still has an answer.
export const DEFAULT_CRAFT = 'benchy';
export function kindOf(boatId) {
  void boatId;
  return DEFAULT_CRAFT;
}
export const craftOf = (boatId) => CRAFTS[kindOf(boatId)];
export const crewOf = (boatId) => craftOf(boatId).crew;

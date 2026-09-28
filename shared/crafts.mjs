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
  // The pirate ship (scripts/build-pirateship.py, 13 long). Every number is read off the bake
  // by its own downward rays - the script prints the deck heights along the hull, and they
  // were measured across it too - less the waterline (1.469 above the keel) and DECK_Y:
  // the waist 2.63 above the keel, the forecastle 2.84, the quarterdeck 3.26 and the poop
  // 3.47. Planking a body can stand on is a little inside the bulwarks, which are the rails.
  // `sail` is how she handles (web/js/boat.js stepBoat): faster than the Benchy on the
  // straight, slower through a turn, and `probes` are the points of the hull tested against
  // the ground - bow and shoulders, in her frame, mirrored astern - because a bow point alone
  // lets a hull seven wide lie with half of it in the dunes.
  galleon: Object.freeze({
    crew: 5,
    helm: Object.freeze([0, -3.2]),
    deck: Object.freeze([
      Object.freeze({ x: 0, z: 0, hx: 1.75, hz: 2.3, y: 1.108 }),        // the waist
      Object.freeze({ x: 0, z: 3.45, hx: 1.1, hz: 1.15, y: 1.318 }),     // forecastle
      Object.freeze({ x: 0, z: 5.2, hx: 0.45, hz: 0.6, y: 1.886 }),      // the bow
      Object.freeze({ x: 0, z: -3.45, hx: 1.8, hz: 1.15, y: 1.738 }),    // quarterdeck
      Object.freeze({ x: 0, z: -5.35, hx: 1.8, hz: 0.75, y: 1.948 }),    // poop
    ]),
    rails: Object.freeze([
      ...[-1, 1].flatMap((s) => [
        { x: s * 1.9, z: 0, hx: 0.05, hz: 2.3 },
        { x: s * 1.25, z: 3.45, hx: 0.05, hz: 1.15 },
        { x: s * 0.6, z: 5.2, hx: 0.05, hz: 0.6 },
        { x: s * 1.95, z: -3.45, hx: 0.05, hz: 1.15 },
        { x: s * 1.95, z: -5.35, hx: 0.05, hz: 0.75 },
      ]),
      { x: 0, z: -6.15, hx: 1.95, hz: 0.05 },
      { x: 0, z: 5.85, hx: 0.5, hz: 0.05 },
      // The three masts, found by level rays at chest height across the centreline: the
      // foremast 3.15 forward, the mainmast amidships, the mizzen 5.4 aft, each about 0.13 thick.
      { x: 0, z: 3.15, hx: 0.15, hz: 0.15 },
      { x: 0, z: 0, hx: 0.15, hz: 0.15 },
      { x: 0, z: -5.4, hx: 0.15, hz: 0.15 },
    ].map(Object.freeze)),
    sail: Object.freeze({
      top: 13, accel: 3.2, turn: 0.7, turnMin: 0.12,
      probes: Object.freeze([[0, 6.3], [1.9, 4.2], [-1.9, 4.2], [2.2, 1.5], [-2.2, 1.5]].map(Object.freeze)),
    }),
  }),
});

// Which kind a boat is. An island's first boat - `boat:<region>`, the one it has always had,
// at the berth it always had - is its galleon, one an island; the ones its keeper builds at
// the harbours (`boat:<region>-<side><k>`, lib/boatyard.mjs) and a wanderer's skiff
// (`boat:w-<player>`, lib/boats.mjs) are Benchies. Asked by id rather than looked up in a
// table of ids, so a boat that has never been touched, and so has no record anywhere, still
// has an answer - and the sea and every page give the same one.
export const DEFAULT_CRAFT = 'benchy';
export function kindOf(boatId) {
  return typeof boatId === 'string' && /^boat:[0-9a-z]+$/.test(boatId) ? 'galleon' : DEFAULT_CRAFT;
}
export const craftOf = (boatId) => CRAFTS[kindOf(boatId)];
export const crewOf = (boatId) => craftOf(boatId).crew;

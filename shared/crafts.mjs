// What each kind of boat is, for everybody who has to know without drawing it: how many
// may be aboard, where the helm is, and the deck they stand on (Plans/DONE/lopen-op-de-boot.md).
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
// A ship is walked on her own model, not on these rectangles (shared/hullwalk.mjs: the map cut from her
// bake, web/js/shipwalk-map.js). What is listed here for the galleon is what the SEA needs, which has
// no mesh - the coarse hold a claimed deck position is clamped to - and where a ladder lands; the
// rectangles and rails are also the fallback of any craft without a model of its own to walk (shared/
// deck.mjs stepDeck, the rowing boat's one square).
//
//   crew      how many may be aboard at once, pilot included
//   helm      where the pilot stands, [x, z], and faces the bow
//   deck      what can be stood on: rectangles { x, z, hx, hz, y, slope }, centre and half-size,
//             y the height of that stretch of planking at its centre and `slope` how much it
//             rises per unit of z (none: flat). A staircase is a ramp, not a step - the model
//             draws treads and the walk stands on the line through them, so that a body on a
//             stair is on it and not in it. Overlapping is fine - a point is on the deck when it
//             is inside any of them, and stands on the highest.
//   rails     what cannot be walked through: rectangles of the same shape, with no y. A
//             deck edge with no rail is where a body can step off - into the water, or onto
//             a quay the hull is lying against. A rail with a `top` is a bulwark, and a body
//             whose feet are above it goes over it: that is how you leave a ship, by jumping.
//             No `top` is a mast, or the side of a staircase: a wall, which nobody clears.
//   ladders   how you get aboard from the water or a quay: a rope ladder hanging over the
//             side, with no key for it (Plans/DONE/lopen-op-de-boot.md, "Instappen"). `x`, `z` is
//             where its ropes hang, `hw` half the width between them, `top` the height of the
//             bulwark it hangs over and `foot` where its last rung is - under the water.
//             `land` is where the climber steps down onto the deck, clear of the rails. A body
//             walks into the foot of one to climb it and out onto its head from the deck to
//             climb down (shared/deck.mjs ladderUp / ladderDown), and stays on it, climbing
//             with the push at the hull and hanging still without one; the mesh is drawn from
//             these same numbers (web/js/boat.js), so what you climb is what you see.
//
// Every boat but the galleon is the rowing boat (scripts/build-rowboat.py,
// Plans/roeiboot-en-schat.md), which replaced the 3D Benchy and kept her rules: room for one,
// and her whole deck is the helm - the oarsman's thwart - exactly what walk.js has always
// done with a pilot, pinned to the middle of the hull. A bigger boat is a new entry here
// with the numbers read off its model's anchors, not a change to anything that reads them.

// The pirate ship's bake and where it floats: 12.29 from keel to masthead (build-pirateship.py prints
// it), and the waterline 7 of the source's 58.56 up. What web/js/boat.js draws her with, and what the
// walk map cut from her (scripts/build-shipwalk.mjs) is placed by - one copy, or a map is cut from a
// hull that is not the one that floats.
export const SHIP_TALL = 12.29;
export const SHIP_DRAUGHT = SHIP_TALL * 7 / 58.56;

// How far a bulwark stands above the planking beside it. The bake's run from 0.15 to 0.4; this
// is one number for all of them, and it has to stay under a jump (JUMP_V 3.1 against GRAVITY
// 12.5 in walk.js is 0.38) with room to spare for the width of the rail, or the ship is a cage.
const BULWARK = 0.25;
const rail = (x, z, hx, hz, deckY) => Object.freeze({ x, z, hx, hz, top: deckY + BULWARK });

export const CRAFTS = Object.freeze({
  rowboat: Object.freeze({
    crew: 1,
    helm: Object.freeze([0, 0]),
    deck: Object.freeze([Object.freeze({ x: 0, z: 0, hx: 0.08, hz: 0.12, y: 0 })]),
    rails: Object.freeze([]),
    ladders: Object.freeze([]),
  }),
  // The pirate ship (scripts/build-pirateship.py, 13 long). Every number is read off the bake
  // by its own downward rays - the script prints the deck heights along the hull, and they
  // were measured across it too - less the waterline (1.469 above the keel) and DECK_Y:
  // the waist 2.63 above the keel, the forecastle 2.84, the quarterdeck 3.26 and the poop
  // 3.47. Planking a body can stand on is a little inside the bulwarks, which are the rails.
  // `sail` is how she handles (web/js/boat.js stepBoat): faster than the rowing boat on the
  // straight, slower through a turn, and `probes` are the points of the hull tested against
  // the ground - bow and shoulders, in her frame, mirrored astern - because a bow point alone
  // lets a hull seven wide lie with half of it in the dunes.
  galleon: Object.freeze({
    crew: 5,
    helm: Object.freeze([0, -3.2]),
    deck: Object.freeze([
      Object.freeze({ x: 0, z: 0, hx: 1.75, hz: 2.3, y: 1.108 }),        // the waist
      // Up to the forecastle: a ramp the width of the deck, 1.108 to 1.318 between z 2.2 and 2.85.
      Object.freeze({ x: 0, z: 2.525, hx: 1.75, hz: 0.325, y: 1.212, slope: 0.31 }),
      // The forecastle, narrowing to the bow: 1.4 wide either side at z 3.2, 1.0 at 3.6, 0.8 at 4.0
      // and 0.6 at 4.4 (measured with rays along x; the rest is the rim, 0.2 higher).
      Object.freeze({ x: 0, z: 3.125, hx: 1.35, hz: 0.275, y: 1.318 }),
      Object.freeze({ x: 0, z: 3.65, hx: 1.0, hz: 0.25, y: 1.318 }),
      Object.freeze({ x: 0, z: 4.25, hx: 0.6, hz: 0.35, y: 1.318 }),
      // And on to the bow, a climb of 0.4 in every unit to the end of the bowsprit's deck.
      Object.freeze({ x: 0, z: 5.225, hx: 0.45, hz: 0.625, y: 1.77, slope: 0.4 }),
      Object.freeze({ x: 0, z: -3.45, hx: 1.8, hz: 1.15, y: 1.738 }),    // quarterdeck
      // The two flights up to it, either side of the bulkhead: 1.108 at z -1.4 to 1.738 at z -2.05
      // (a slope of -0.97; the treads of the bake are within 0.04 of that line), and the landing
      // at the top of each, which the quarterdeck's own rectangle starts too far aft to cover.
      ...[-1, 1].flatMap((s) => [
        Object.freeze({ x: s * 1.5, z: -1.725, hx: 0.35, hz: 0.325, y: 1.425, slope: -0.97 }),
        Object.freeze({ x: s * 1.5, z: -2.175, hx: 0.35, hz: 0.125, y: 1.738 }),
      ]),
      Object.freeze({ x: 0, z: -5.35, hx: 1.8, hz: 0.75, y: 1.948 }),    // poop
    ]),
    rails: Object.freeze([
      ...[-1, 1].flatMap((s) => [
        rail(s * 1.9, 0, 0.05, 2.3, 1.108),
        // The forecastle's rim, stepping in with the deck as it narrows.
        rail(s * 1.55, 2.85, 0.05, 0.55, 1.318),
        rail(s * 1.2, 3.65, 0.05, 0.25, 1.318),
        rail(s * 0.8, 4.25, 0.05, 0.35, 1.318),
        // The bow has no bulwark to speak of past its first stretch: the deck climbs and its edge
        // is the hull, so what stops you at the foot of it is a rail at the height of the deck there.
        rail(s * 0.6, 4.9, 0.05, 0.3, 1.5),
        // The inside of each flight of the quarterdeck stairs: a stringer, a wall from the waist
        // (no `top`). You go up them from the foot.
        Object.freeze({ x: s * 0.95, z: -1.75, hx: 0.04, hz: 0.35 }),
        rail(s * 1.95, -3.45, 0.05, 1.15, 1.738),
        rail(s * 1.95, -5.35, 0.05, 0.75, 1.948),
      ]),
      rail(0, -6.15, 1.95, 0.05, 1.948),
      // The front of the quarterdeck between its two flights is a wall with a door in it, and a
      // balustrade on top: from the waist it is 0.9 high and no way up, from the quarterdeck it
      // is the bulwark it is anywhere. Thin, so that the helm's step forward (z -2.6) is outside it.
      rail(0, -2.3, 1.1, 0.06, 1.738),
      rail(0, 5.85, 0.5, 0.05, 1.89),
      // The three masts, found by level rays at chest height across the centreline: the
      // foremast 3.15 forward, the mainmast amidships, the mizzen 5.4 aft, each about 0.13 thick.
      // No `top`: a mast is not gone over.
      ...[[0, 3.15], [0, 0], [0, -5.4]].map(([x, z]) => Object.freeze({ x, z, hx: 0.15, hz: 0.15 })),
    ]),
    // One over each side of the waist, where the hull is widest and lowest (the bulwark there
    // is the bake's 1.27 above DECK_Y, the hull's flare 2.35 out at that height, so ropes
    // hanging plumb at 2.42 clear it all the way to the water). At z 1.85, forward of the last of
    // the four gun ports: the source's cannons and their hoods stood out to 2.63 at z -2, -1, 0 and 1
    // (the guns are gone since - Plans/kanonnen.md - the hoods are the hull's and stay), and between them there is a window of 0.4 to 0.5, too little for a ladder 0.5 wide, but from
    // 1.4 to the end of the waist the side is clean (measured by level rays over the whole
    // height of the hull, as the rails were). The foot is well under the waterline - a swimmer
    // takes it from the surface - and the deck is stepped onto 1.35 from the middle, inside the
    // rail at 1.9. 0.28 wide (`hw`), round the climb's hands - the Traveller's wide ones too - and
    // no wider: 0.48, as it was, was a ladder wider than a body is tall.
    ladders: Object.freeze([1, -1].map((s) => Object.freeze({
      x: s * 2.42, z: 1.85, hw: 0.14, top: 1.27, foot: -0.65, land: Object.freeze([s * 1.35, 1.85]),
    }))),
    // And one up the mainmast to her crow's nest (shared/deck.mjs aloftPath; Plans/DONE/kraaiennest.md). The
    // nest is the bake's: an octagonal basket round the topmast, its floor 8.62 above DECK_Y, a stepped
    // dais in it (8.82, 8.96, 9.06, 9.2 towards the topmast) and its rim at 9.24, 0.72 out - so a body
    // stands on the ring of the 8.96 step and the rim stops it. Measured by level rays round the mast,
    // the column under the nest's starboard-aft face (315 degrees) is clear from the deck to the rim
    // but for one brace at 7.5: ahead of the mast hangs the mainsail, to either side the yards, and
    // straight aft three halyards. So the ladder hangs there, plumb, 0.8 out (outside the rim's flange),
    // its foot on the waist (1.12, what the walk map has there) and its rungs RUNG_STEP up from it.
    aloft: Object.freeze([Object.freeze({
      x: 0.8 * Math.SQRT1_2, z: -0.8 * Math.SQRT1_2, out: Object.freeze([Math.SQRT1_2, -Math.SQRT1_2]), hw: 0.14,
      foot: 1.12, top: 9.24, land: Object.freeze([0.297, -0.297]), floor: 8.96,
    })]),
    // Where to sit up there: on the dais's top step with your back to the topmast, looking out over
    // the bow (`yaw` in the hull's frame, 0 forward). `y` is the seat, as a stool's is (walk.js sitOn);
    // `reach` how far from it E offers it, and `floor` the height a body must be above to be in the nest.
    nest: Object.freeze({ seat: Object.freeze({ x: 0, z: 0.17, y: 9.2, yaw: 0 }), reach: 0.65, floor: 8.6 }),
    // What can be manned on her deck (one mechanism for every kind - Plans/kanonnen.md, and the
    // harpoon's plan beside it): walk.js manGun takes any of them, and `kind` says what is drawn there
    // and what the left button does. Her two guns, the keeper's own model (scripts/build-cannon.py):
    // one a side in the waist, between the mainmast (z 0) and the quarterdeck stairs (from z -1.4),
    // square out over the bulwark - which is 0.16 over the deck there and the bore 0.3, so a gun
    // clears it at any laying. `x`, `z` the middle of the carriage on the deck, `y` the deck under it
    // (the walk map's 1.108), `yaw` the way it points at rest in her frame (0 forward, so +pi/2 is
    // starboard, +x), `stand` where whoever mans it stands, behind the breech; `yawLim` how far it
    // traverses either side of `yaw` and `pitchLim` the elevation it is laid between (radians,
    // shared/cannon.mjs's GUN_TRAVERSE and GUN_PITCH_MIN/MAX for a gun). The order is the mount's
    // number on the wire ({t:'cannon', i}). web/js/boat.js welds every gun into the hull's one geometry.
    // After them her two harpoon guns (Plans/harpoen.md; the keeper: "Voorkasteel, 1 per boord"), on
    // the forecastle's planking (1.318) inside its rim (x 1.55 there), pointing out and forward -
    // `yaw` 1.0 is 57 degrees off the bow - so the forestay and the foremast (z 3.15) are behind the
    // line of fire and a ship ahead or abeam is in it. They swing wider than a gun (a harpoon is aimed,
    // not laid) and point down at the water, since what they catch floats. Appended, never inserted:
    // the index is the mount's number on the wire.
    mounts: Object.freeze([
      ...[1, -1].map((s) => Object.freeze({
        kind: 'cannon', x: s * 1.5, z: -1.0, y: 1.108, yaw: s * Math.PI / 2, stand: Object.freeze([s * 0.85, -1.0]),
        yawLim: 0.61, pitchLim: Object.freeze([-0.12, 0.42]),
      })),
      ...[1, -1].map((s) => Object.freeze({
        kind: 'harpoon', x: s * 1.1, z: 3.25, y: 1.318, yaw: s * 1.0, stand: Object.freeze([s * 0.78, 2.98]),
        yawLim: 0.95, pitchLim: Object.freeze([-0.45, 0.6]),
      })),
    ]),
    // A ship is mass, and every number after `turnMin` is that mass (stepBoat reads each one and
    // falls back to the rowing boat's when it is missing): she takes 6 s to reach her top speed, and
    // let go of the helm - or of W - she runs out for most of a minute instead of four seconds
    // (drag 0.1: 13 u/s is under 1 after 26 s and at `creep` after 45, some 130 units on). The rudder
    // is felt a second late and a swing carries on after it is centred (`yawLag`), a hard turn
    // costs her little way (`bite`) and S is a brake you feel for seconds (`astern`), not a kick.
    // `runOut` is how long the sea keeps taking her position from whoever let go of the wheel
    // (lib/boats.mjs letGo): longer than the run-out from full turbo, or she would freeze for
    // everybody else halfway through it (tests/boat-inertia.test.mjs holds the two together).
    sail: Object.freeze({
      top: 13, accel: 2.2, turn: 0.7, turnMin: 0.12,
      drag: 0.1, creep: 0.15, bite: 0.1, astern: 1.2, yawLag: 1.0, runOut: 60,
      probes: Object.freeze([[0, 6.3], [1.9, 4.2], [-1.9, 4.2], [2.2, 1.5], [-2.2, 1.5]].map(Object.freeze)),
    }),
    // How she rides the swell (web/js/boat.js `swellOf`; the page's alone, the sea never reads it).
    // She had the rowing boat's numbers - 0.03 up, 0.04 pitch, 0.03 roll, on periods of 3 to 5 s - and
    // on a hull 13 units (52 m) long a pitch of 0.04 is the bow going a metre up and down every few
    // seconds while she lies still: the keeper's "deint te veel, zeker bij stilstand". A ship this
    // size spans the short swell and averages it out, so lying still she only stirs: `still` is a
    // tenth of the rowing boat's pitch (bow ~10 cm), a quarter of its roll and rise, on periods of 7
    // to 11 s (`rates`, rad/s for rise, pitch, roll). Making way she cuts into it and moves more, up
    // to `way` at her top speed - still under half the rowing boat's pitch. Each is [rise, pitch, roll].
    swell: Object.freeze({
      still: Object.freeze([0.008, 0.004, 0.008]),
      way: Object.freeze([0.02, 0.014, 0.012]),
      rates: Object.freeze([0.9, 0.7, 0.55]),
    }),
  }),
});

// Which kind a boat is. An island's first boat - `boat:<region>`, the one it has always had,
// at the berth it always had - is its galleon, one an island; the ones its keeper builds at
// the harbours (`boat:<region>-<side><k>`, lib/boatyard.mjs) and a wanderer's skiff
// (`boat:w-<player>`, lib/boats.mjs) are rowing boats. Asked by id rather than looked up in a
// table of ids, so a boat that has never been touched, and so has no record anywhere, still
// has an answer - and the sea and every page give the same one.
export const DEFAULT_CRAFT = 'rowboat';
export function kindOf(boatId) {
  return typeof boatId === 'string' && /^boat:[0-9a-z]+$/.test(boatId) ? 'galleon' : DEFAULT_CRAFT;
}
export const craftOf = (boatId) => CRAFTS[kindOf(boatId)];
export const crewOf = (boatId) => craftOf(boatId).crew;

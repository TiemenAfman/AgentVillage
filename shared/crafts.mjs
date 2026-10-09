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
// The galleon carries more, read off her bake (shared/craft-galleon.mjs, below): `aloft` (a rope
// ladder up a mast into its top), `nest` (where to sit there), `mounts` (what can be manned, each with
// `stand` and `yaw`), `cargo`, her sizes and her `box`.
//
// Every boat but the galleon is the rowing boat (scripts/build-rowboat.py,
// Plans/roeiboot-en-schat.md), which replaced the 3D Benchy and kept her rules: room for one,
// and her whole deck is the helm - the oarsman's thwart - exactly what walk.js has always
// done with a pilot, pinned to the middle of the hull. A bigger boat is a new entry here
// with the numbers read off its model's anchors, not a change to anything that reads them.

// The galleon's own numbers come off her bake: scripts/build-craft.mjs reads the anchors her build
// script sets (scripts/build-pirateship.py: deck and stair corners, rails, masts, the rope ladders,
// the mounts, helm, nest, cargo, the waterline) and her hull's triangles, and writes
// shared/craft-galleon.mjs - literals only, like shared/quay.mjs's HEADINGS, so that this stays a module
// the sea reads as it is (Dockerfile.sea copies shared/ whole). What is tuned by hand rather than
// measured stays here, and is spread over GALLEON below: how many may be aboard, the bulwark's one
// height over its rails, a ladder's width, how she handles, her swell and the nest's reach.
import { GALLEON } from './craft-galleon.mjs';

// Where she floats: the bake's `anchor.waterline`, read into the craft. What web/js/boat.js draws her
// with, and what the walk map cut from her (scripts/build-shipwalk.mjs) is placed by - one copy, or a
// map is cut from a hull that is not the one that floats.
export const SHIP_DRAUGHT = GALLEON.draught;

// How far a bulwark stands above the planking beside it. The bake's run from 0.15 to 0.4; this
// is one number for all of them, and it has to stay under a jump (JUMP_V 3.1 against GRAVITY
// 12.5 in walk.js is 0.38) with room to spare for the width of the rail, or the ship is a cage.
const BULWARK = 0.25;
const rail = (x, z, hx, hz, deckY) => Object.freeze({ x, z, hx, hz, top: deckY + BULWARK });
// Half the width between a rope ladder's ropes, her side's and her mast's alike: round the climb's
// hands - the Traveller's wide ones too - and no wider: 0.48, as it was, was a ladder wider than a
// body is tall.
const LADDER_HW = 0.14;
// How far from the nest's seat E offers it.
const NEST_REACH = 0.65;

// Everything a craft carries is frozen, the generated record included: nothing reads it to write it.
function freeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const k of Object.keys(v)) freeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

export const CRAFTS = Object.freeze({
  rowboat: Object.freeze({
    crew: 1,
    helm: Object.freeze([0, 0]),
    deck: Object.freeze([Object.freeze({ x: 0, z: 0, hx: 0.08, hz: 0.12, y: 0 })]),
    rails: Object.freeze([]),
    ladders: Object.freeze([]),
  }),
  // The pirate ship (scripts/build-pirateship.py, 13 long). Every number but the ones named above
  // is the bake's (shared/craft-galleon.mjs): the planking as rectangles with their heights - the
  // waist 1.108 above DECK_Y, the forecastle 1.318, the quarterdeck 1.738 and the poop 1.948, the
  // stairs between them as ramps - the bulwarks as rails, where her masts stand, the rope ladders
  // over her waist (foot under the water, landing inside the rail) and the one up her mainmast to the
  // crow's nest (shared/deck.mjs aloftPath, Plans/DONE/kraaiennest.md), where to sit up there, and
  // what can be manned on her deck (Plans/kanonnen.md, Plans/harpoen.md: two guns in the waist
  // square out over the bulwark, two harpoon guns on the forecastle pointing out and forward; the
  // order is the mount's number on the wire, {t:'cannon', i}, and a mount is appended, never
  // inserted). `near` is how far from her middle nothing of her is, `beam` half her width overall
  // (the yards), `length` her hull at the water and `overall` stem to bowsprit, `tall` her masthead
  // over the water, `box` her outline to a ball (shared/cannon.mjs), `cargo` where a load stands on
  // her deck.
  galleon: freeze({
    crew: 5,
    helm: GALLEON.helm,
    deck: GALLEON.deck,
    // A rail with a floor under it is a bulwark, and its top is BULWARK over that floor; one without
    // (a stringer, a mast) is a wall nobody clears.
    rails: GALLEON.rails.map(({ floor, ...r }) => (floor === undefined ? r : rail(r.x, r.z, r.hx, r.hz, floor))),
    ladders: GALLEON.ladders.map((l) => ({ ...l, hw: LADDER_HW })),
    aloft: GALLEON.aloft.map((l) => ({ ...l, hw: LADDER_HW })),
    nest: { ...GALLEON.nest, reach: NEST_REACH },
    mounts: GALLEON.mounts,
    cargo: GALLEON.cargo,
    near: GALLEON.near,
    beam: GALLEON.beam,
    length: GALLEON.length,
    overall: GALLEON.overall,
    tall: GALLEON.tall,
    draught: GALLEON.draught,
    box: { hx: GALLEON.box.hx, hz: GALLEON.box.hz, y0: GALLEON.box.y0, y1: GALLEON.box.deck + BULWARK },
    // A ship is mass, and every number after `turnMin` is that mass (stepBoat reads each one and
    // falls back to the rowing boat's when it is missing): she takes 6 s to reach her top speed, and
    // let go of the helm - or of W - she runs out for most of a minute instead of four seconds
    // (drag 0.1: 13 u/s is under 1 after 26 s and at `creep` after 45, some 130 units on). The rudder
    // is felt a second late and a swing carries on after it is centred (`yawLag`), a hard turn
    // costs her little way (`bite`) and S is a brake you feel for seconds (`astern`), not a kick.
    // `runOut` is how long the sea keeps taking her position from whoever let go of the wheel
    // (lib/boats.mjs letGo): longer than the run-out from full turbo, or she would freeze for
    // everybody else halfway through it (tests/boat-inertia.test.mjs holds the two together).
    // `probes` are the points of the hull tested against the ground - bow and shoulders, in her
    // frame, mirrored astern - because a bow point alone lets a hull seven wide lie with half of it
    // in the dunes. They are still the hand-picked ones here, not GALLEON.probes (the bake's, cut
    // from her side at the water): shared/quay.mjs lays her berth out from them, so changing them
    // moves every island's galleon, which is the QUAY_VERSION bump of Plans/nieuwe-sloep.md's chip 4
    // and ships with the sloop, not before.
    sail: {
      top: 13, accel: 2.2, turn: 0.7, turnMin: 0.12,
      drag: 0.1, creep: 0.15, bite: 0.1, astern: 1.2, yawLag: 1.0, runOut: 60,
      probes: [[0, 6.3], [1.9, 4.2], [-1.9, 4.2], [2.2, 1.5], [-2.2, 1.5]],
    },
    // How she rides the swell (web/js/boat.js `swellOf`; the page's alone, the sea never reads it).
    // She had the rowing boat's numbers - 0.03 up, 0.04 pitch, 0.03 roll, on periods of 3 to 5 s - and
    // on a hull 13 units (52 m) long a pitch of 0.04 is the bow going a metre up and down every few
    // seconds while she lies still: the keeper's "deint te veel, zeker bij stilstand". A ship this
    // size spans the short swell and averages it out, so lying still she only stirs: `still` is a
    // tenth of the rowing boat's pitch (bow ~10 cm), a quarter of its roll and rise, on periods of 7
    // to 11 s (`rates`, rad/s for rise, pitch, roll). Making way she cuts into it and moves more, up
    // to `way` at her top speed - still under half the rowing boat's pitch. Each is [rise, pitch, roll].
    swell: {
      still: [0.008, 0.004, 0.008],
      way: [0.02, 0.014, 0.012],
      rates: [0.9, 0.7, 0.55],
    },
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

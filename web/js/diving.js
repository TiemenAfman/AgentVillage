// Diving: the third way a body moves in the water, next to floating at the surface (walk.js
// pins a swimmer at WATER_Y - SWIM_SINK) and being aboard. Pure, like stepBike and stepBoat:
// no THREE, no clock, no DOM, so tests/diving.test.mjs can drive it under Node, and walk.js
// hands it everything it needs to know about the water and the floor (Plans/onderwater-zwemmen.md).
//
// `y` is the FEET, as it is everywhere else (net.js sends it as it is, the sea clamps it to
// [-4, 60], and a peer draws a diver on it). A diver has no separate depth: how deep they are
// is `surface - y`, and the sea reads "under water" off exactly that (shared/breath.mjs `HEAD`
// - the copy this one is held equal to by tests/diving.test.mjs).

// Sideways, under the surface. A little slower than the surface stroke (SWIM_SPEED 1.9): the
// water is thicker down here and the boat's ratio in tests/boat.test.mjs stays true for both.
export const DIVE_SPEED = 1.6;
// Shift, out of the same body pool a run and a surface stroke use.
export const DIVE_TURBO = 2.6;
// Walking on the bottom: slower than a stroke, because you are pushing off the sand.
export const BOTTOM_SPEED = 1.1;

// Up and down. A body 0.54 tall sinking 1.3 units a second is a comfortable two seconds to the
// bottom of a 2.5 sea, and rising is a little quicker than sinking, the way it is in the water.
export const DIVE_DOWN = 1.3;
export const DIVE_UP = 1.7;
// How briskly the vertical speed follows what is asked (1/s, an exponential): let go of both
// keys and you drift to a stop in about half a second - neutral buoyancy, so you can hang in
// the water to look at something.
export const DIVE_RATE = 6;

// How much water it takes to go under at all. Holding C in the shallows crouches, as it always
// did; there has to be a body's height of sea to sink into.
export const DIVE_MIN_WATER = 0.6;
// A diver's head over their feet: the point that has to be under the surface to count as under
// water, and the room a deck over them has to leave. shared/breath.mjs `HEAD` is the sea's copy.
export const DIVE_HEAD = 0.5;
// How far the feet stay off the sand. A body pitched head-down has its head lower than its
// feet, so the floor is a little above the bed rather than exactly on it.
export const BED_CLEAR = 0.05;
// Where the sea gets too shallow to stay under: within this of the surface the water lifts you
// back up on its own, so you rise out of it instead of being snapped up when the bed climbs
// out of the water (walk.js would put a diver on the surface the moment the ground is dry).
export const SHALLOW = 0.3;
export const SHALLOW_LIFT = 0.6;

// May the body at `bed` go under? Only water deep enough to hold it.
export const canDive = (bed, surface = 0) => bed < surface - DIVE_MIN_WATER;

// Is the head under the surface? What `state.diving` means, and what the camera, the mist, the
// sound and the sea's air all key on.
export const headUnder = (y, surface = 0) => y + DIVE_HEAD < surface;

// One step of a body that is under water. `d` is { y, vy } (the feet and their vertical speed);
// `rise` is what is asked, -1 (down) to +1 (up), from C / pad B and Space / pad A. The world is
// `bed` (the height of the sea floor under the feet), `lid` (the lowest thing over the head -
// a deck - or Infinity), `surface` and `sink` (how far a floating body sits in it).
//
// Returns { y, vy, onBed, surfaced }. `surfaced` means the body has come back up to where
// walk.js floats a swimmer, and dive mode ends there: the ordinary swimming takes over at the
// very height this leaves, so there is no step.
export function stepDive(d, rise, dt, { bed, lid = Infinity, surface = 0, sink = 0.07 }) {
  const rest = surface - sink;
  let want = rise > 0 ? DIVE_UP * rise : DIVE_DOWN * rise;
  // The shallows lift a body that is not being pushed down.
  if (bed > rest - SHALLOW && want <= 0) want = DIVE_UP * SHALLOW_LIFT;
  let vy = d.vy + (want - d.vy) * (1 - Math.exp(-DIVE_RATE * dt));
  let y = d.y + vy * dt;
  // A deck over the head: the same hole walk.js closes for a jumper, from the other side. The
  // ceiling stops a rise; it never pushes a diver down through the bed.
  if (y + DIVE_HEAD > lid) {
    y = lid - DIVE_HEAD;
    if (vy > 0) vy = 0;
  }
  let onBed = false;
  const floor = bed + BED_CLEAR;
  if (y <= floor) {
    y = floor;
    if (vy < 0) vy = 0;
    onBed = true;
  }
  let surfaced = false;
  if (y >= rest && vy >= 0) {
    y = rest;
    vy = 0;
    onBed = false;
    surfaced = true;
  }
  return { y, vy, onBed, surfaced };
}

// The body's pitch about its own x axis (walk.js and peers.js turn the swimmer with it): the
// surface stroke lies at 1.32 (head forward, a little above horizontal); a descent tips the
// head down towards 2.2 and a climb tips it up towards 0.62. Driven by the vertical speed
// alone, which is why a peer can draw the same thing from two snapshots (peers.js).
export const SWIM_PITCH = 1.32;
export function divePitch(vy) {
  const t = vy < 0 ? Math.max(-1, vy / DIVE_DOWN) : Math.min(1, vy / DIVE_UP);
  return SWIM_PITCH - t * (t < 0 ? 0.9 : 0.7);
}

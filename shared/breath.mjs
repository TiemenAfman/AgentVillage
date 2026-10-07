// How long somebody can stay under water: the one copy of the sum, read by the sea
// (lib/breath.mjs, which decides who drowns) and by the page (web/js/main.js, which fills the
// bar by itself between the sea's words - the same split as health, lib/health.mjs and
// healthAt in web/js/net.js). Plans/onderwater-zwemmen.md, section "Adem en verdrinken".
//
// Plain arithmetic and nothing else - no trig, no clock, no random - because the page
// predicts the very number the sea keeps, and two runtimes that could differ in the last bit
// would disagree about when a bar is empty. `dt` comes in from outside for the same reason.
import { SEA_LEVEL } from './terrain.mjs';

// Seconds of air in a full lung: the bar drains one of these a second while submerged.
export const AIR_S = 30;
// A full refill takes this long at the surface, however empty you were.
export const REFILL_S = 3;
// Health lost a second once the air is gone (lib/health.mjs MAX_HEALTH is 100), so from whole
// it is a little over eight seconds to being sent home - long enough to see it coming, short
// enough that an empty bar is not a place to linger.
export const DROWN_PER_S = 12;
// How far above the feet the head is, in island units (one is four metres; the body is 0.54
// high, walk.js). Somebody is under when their *head* is: a swimmer at the surface is at
// y = -0.07 and never counts, a diver's y goes below -0.5.
export const HEAD = 0.5;

// The pose bit for "swimming". The sea keeps the numbers in lib/players.mjs `POSE` and the
// page in web/js/net.js `FLAG_SWIMMING`; shared/ may import neither, so this is a third copy,
// and tests/breath.test.mjs holds all three to one value.
export const SWIMMING = 2;

// Whether a body with pose flags `f` and height `y` (both as the pose message carries them)
// has its head under the sea. Swimming is required as well as depth: a settler on a jetty
// over deep water, or a body carried down by a lift, is not somebody holding their breath.
export function submerged(f, y) {
  return (f & SWIMMING) !== 0 && y + HEAD < SEA_LEVEL;
}

// The air left after `dt` seconds. Under water it drains one a second; otherwise it comes
// back at a full lung per REFILL_S. Clamped to [0, airS], and a `dt` that is not a positive
// number changes nothing (a frame that arrives late or twice must not be able to refill or
// empty anybody). `airS` and `refillS` are the defaults' overrides for a test that cannot wait
// half a minute; positional rather than an options object, because the page calls this every
// frame and an allocation per frame is not worth the tidiness.
export function stepAir(air, isSubmerged, dt, airS = AIR_S, refillS = REFILL_S) {
  if (!(dt > 0)) return air < 0 ? 0 : air > airS ? airS : air;
  const next = isSubmerged ? air - dt : air + (airS / refillS) * dt;
  return next < 0 ? 0 : next > airS ? airS : next;
}

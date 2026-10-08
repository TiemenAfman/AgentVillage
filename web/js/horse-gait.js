// Hoof paths are measured in the horse's own metres. A stance moves backwards at exactly
// the rider's speed; the lifted return has matching end velocities, so landing never snaps.
// Right lead: LH, RH+LF, RF becomes LH, RH, LF, RF at a gallop (Extension Horses gait chart).
//
// Refined against Preston Blair's two sheets (Cartoon Animation p. 358-359): legs are
// fl, fr, bl, br and every per-leg pair below is [fore, hind].
//  - Trot: the diagonals land together and there is a short suspension between them (duty
//    under a half). The fore lifts higher than the hind and folds its hoof right back under
//    the forearm; the hind tucks less. Body, ribcage and pelvis rise and fall together, twice
//    a stride: lowest at mid-stance, highest in the suspension (`horseBody`).
//  - Gallop: a see-saw, not a bob. Most compressed in the gathered suspension, ribcage high
//    and pelvis low while the hinds carry, most stretched (head lowest) as the weight goes over
//    to the fores, ribcage low and pelvis high while they carry. The fores reach forward and
//    the hinds trail (`reach`), so the stretched frame reads stretched.
//
// The gallop's numbers come from a reference horse measured as numbers only (Plans/
// paard-in-plaats-van-fiets.md, "De gangen van een referentiepaard, gemeten": one cadence of
// 1.27 Hz from walk to gallop, a stride of 4.3 leg lengths, 18-28% of it on the ground, the back
// 0.22 leg lengths up and down and pitching 3-22 degrees) and from the descriptions of the
// canter's rocking (head up as the hinds engage, lowest as the leading fore lands). At ChatGPT's
// 2 Hz the stride was 1.9 leg lengths and every hoof stayed within .08 of its rest spot: a jog in
// place with a rock on it. At 1.4 Hz it is three leg lengths at our 1.18, and the swing is no
// longer the stance played backwards: `trail` carries the lifted hoof back and up first (the
// fore folded under the chest, the hind kicked out behind), `over` carries it past its landing
// spot before it comes back to meet the ground (the fore reaching out, the hind far under the
// belly). Both are bumps with no slope at either end, so a landing still meets the stance line
// at the stance's own speed and nothing snaps.
// A horse is a way to get somewhere, so it outruns its rider: the Adventurer runs at 1.8 and
// sprints at 2.7 (avatar-gait.js), and at .72 and 1.18 the keeper walked past his own horse.
// The trot is now above a sprint and the gallop a good deal more; what pays for it is the
// cadence and a shorter time on the ground, since a planted hoof covers at most the leg's
// reach (~.29 a stance at this body height) and never slides: stance = v * duty / hz.
export const HORSE_TROT = 1.9;
export const HORSE_GALLOP = 3.4;
export const HORSE_PATTERNS = {
  trot: { land: [0, .5, .5, 0], duty: .36, lift: [.09, .066], flex: [1.35, .8], reach: [0, 0], peak: .38 },
  gallop: { land: [.42, .6, 0, .17], duty: .2, lift: [.13, .11], flex: [1.55, 1.15], reach: [.02, -.016], peak: .32,
    trail: [.035, .07], over: [.055, 0] },
  walk: { land: [.25, .75, 0, .5], duty: .72, lift: [.038, .03], flex: [.6, .35], reach: [0, 0], peak: .42 },
};
export const fraction = (x) => x - Math.floor(x);
export function horseCadence(speed, gait) {
  const v = Math.abs(speed);
  if (v < .001) return 0;
  // Below the normal pace shorten and slow the trot instead of sliding a stationary foot.
  if (gait === 'gallop') return 1.7 + .9 * Math.min(1, v / HORSE_GALLOP);
  if (gait === 'walk') return Math.max(.4, v / .29);
  return .75 + 1.75 * Math.min(1, v / HORSE_TROT);
}
// The swing's own clock, skewed so the hoof is highest and most folded at `peak` of the swing
// (it snaps up off the ground and then reaches forward to land), 0 and 1 at its two ends.
const skew = (t, peak) => t < peak ? .5 * t / peak : .5 + .5 * (t - peak) / (1 - peak);
export function hoofPath(cycle, leg, speed, gait, hz, out = {}) {
  const p = HORSE_PATTERNS[gait] || HORSE_PATTERNS.trot;
  const end = leg < 2 ? 0 : 1;
  const u = fraction(cycle - p.land[leg]), duty = p.duty;
  const step = hz > 0 ? speed * duty / hz : 0;
  const reach = speed ? p.reach[end] * Math.min(1, Math.abs(speed) / HORSE_TROT) : 0;
  // No cadence is standing, whatever speed is said: passing through nought between forward and
  // back the horse is 'stand' at a speed of a few thousandths, and the swing's tangent below
  // divided by that hz of 0 put Infinity into two hooves - the legs vanished (7 Oct 2026).
  out.contact = u < duty || !speed || !(hz > 0);
  if (out.contact) {
    out.z = reach + step * (.5 - u / duty);
    out.y = 0;
    out.flex = 0;
  } else {
    const t = (u-duty)/(1-duty), t2=t*t, t3=t2*t;
    const tangent = -speed * (1-duty) / hz;
    out.z = reach + (2*t3-3*t2+1)*(-step/2) + (-2*t3+3*t2)*(step/2)
      + (2*t3-3*t2+t)*tangent;
    const s = Math.sin(Math.PI * skew(t, p.peak)) ** 2;
    if (p.trail) {
      const k = Math.min(1, Math.abs(speed) / HORSE_GALLOP);
      const o = Math.sin(Math.PI * skew(t, .72)) ** 2;
      out.z += k * (p.over[end] * o - p.trail[end] * Math.sin(Math.PI * skew(t, .3)) ** 2);
      // A hoof reaching out is carried, not dragged: held up while it goes past its spot, so it
      // comes down onto the ground rather than skimming it - and lifted, the leg is shorter and
      // the reach never asks the IK for more than the leg has.
      out.y += k * .5 * p.lift[end] * o;
    }
    out.y = p.lift[end] * s;
    // Fetlock flexion: the toe turns down and back, the sole shows behind (positive is
    // toe down in the horse's level frame, see horse-rig.js solve).
    out.flex = p.flex[end] * s;
  }
  return out;
}
// The body's own motion over a stride, in fauna.js's pose words: bodyY up, bodyX leant
// forward (front down), headX nodded down. The rider rides it: the seat is on the body.
// bodyY carries the gait's own drop: the back is lowered just enough that the fore reaching
// out at the trot's landing (the body at its highest there) never hyperextends - the IK
// clamps a leg it cannot stretch, and a clamped hoof slides (tests/horse-rig.test.mjs).
const TAU = Math.PI * 2;
export function horseBody(cycle, gait, out = {}) {
  if (gait === 'gallop') {
    // Hinds carry around .22 of the stride (bl lands 0, br .17), the fores around .64, the
    // gathered flight is .86-1: front up (negative) while the hinds carry, down on the fores.
    // +-7 degrees: the reference's 3-22 is a swing of 19 about a tilt our bake already has.
    // The loaded end is always the low one, so the pitch only ever shortens a loaded leg.
    out.bodyX = -.12 * Math.cos(TAU * (cycle - .2));
    // Highest in the gathered suspension, lowest as it stretches over mid-stride. Lowered on
    // average so the hind landing straight out of the flight reaches the ground unclamped.
    out.bodyY = -.054 + .013 * Math.cos(TAU * (cycle - .93));
    // Head up as the hinds engage, lowest as the leading fore (fr, at .6) lands.
    out.headX = .03 + .1 * Math.cos(TAU * (cycle - .55));
    out.tailX = .32 + .06 * Math.cos(TAU * (cycle - .6));
    return out;
  }
  const duty = (HORSE_PATTERNS[gait] || HORSE_PATTERNS.trot).duty;
  // Twice a stride: lowest at each diagonal's mid-stance, highest in its suspension.
  const c = Math.cos(2 * TAU * (cycle - duty / 2));
  const amp = gait === 'walk' ? .003 : .008;
  out.bodyY = (gait === 'walk' ? -.038 : -.052) - amp * c;
  out.bodyX = 0;
  // Everything goes up and down together; the head drops a little more as the weight lands.
  out.headX = .025 + .02 * c;
  out.tailX = gait === 'walk' ? .05 : .1 + .04 * c;
  return out;
}

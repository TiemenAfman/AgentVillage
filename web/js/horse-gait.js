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
export const HORSE_TROT = .72;
export const HORSE_GALLOP = 1.18;
export const HORSE_PATTERNS = {
  trot: { land: [0, .5, .5, 0], duty: .46, lift: [.09, .066], flex: [1.35, .8], reach: [0, 0], peak: .38 },
  gallop: { land: [.4, .59, 0, .17], duty: .28, lift: [.12, .1], flex: [1.45, 1], reach: [.02, -.016], peak: .34 },
  walk: { land: [.25, .75, 0, .5], duty: .72, lift: [.038, .03], flex: [.6, .35], reach: [0, 0], peak: .42 },
};
export const fraction = (x) => x - Math.floor(x);
export function horseCadence(speed, gait) {
  const v = Math.abs(speed);
  if (v < .001) return 0;
  // Below the normal pace shorten and slow the trot instead of sliding a stationary foot.
  if (gait === 'gallop') return 1.85 + .2 * Math.min(1, v / HORSE_GALLOP);
  if (gait === 'walk') return Math.max(.4, v / .29);
  return .75 + .85 * Math.min(1, v / HORSE_TROT);
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
  out.contact = u < duty || !speed;
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
    // Hinds carry around .22 of the stride (bl lands 0, br .17), the fores around .63, the
    // gathered flight is .87-1: front up (negative) while the hinds carry, down on the fores.
    out.bodyX = -.06 * Math.cos(TAU * (cycle - .2));
    // Highest in the gathered suspension, lowest as it stretches over mid-stride.
    out.bodyY = -.03 + .012 * Math.cos(TAU * (cycle - .94));
    // Head highest when compressed, lowest when most stretched.
    out.headX = .03 + .07 * Math.cos(TAU * (cycle - .45));
    out.tailX = .32 + .06 * Math.cos(TAU * (cycle - .6));
    return out;
  }
  const duty = (HORSE_PATTERNS[gait] || HORSE_PATTERNS.trot).duty;
  // Twice a stride: lowest at each diagonal's mid-stance, highest in its suspension.
  const c = Math.cos(2 * TAU * (cycle - duty / 2));
  const amp = gait === 'walk' ? .003 : .008;
  out.bodyY = -.038 - amp * c;
  out.bodyX = 0;
  // Everything goes up and down together; the head drops a little more as the weight lands.
  out.headX = .025 + .02 * c;
  out.tailX = gait === 'walk' ? .05 : .1 + .04 * c;
  return out;
}

// The sea bed between the islands: sand, banks and trenches (Plans/onderwater-zwemmen.md, 3).
//
// Until now the ground under open water was one number. Terrain draws a heightfield only on
// its own island's grid, past it `OPEN_SEA` is what every reader falls back to, and nothing
// under the surface was ever seen - the water is opaque and the ocean disc hides the rest. Now
// that a swimmer can dive, there is a floor to stand on, and it has relief.
//
// **This is a draw-and-walk layer beside the terrain, and never part of it.** Nothing here is
// written into a terrain `H`: a corner of `H` - even one far offshore - is in the terrain hash
// (layout.mjs, plan.mjs and islandbundle.mjs all compare it), so a lower corner would move every
// house on the island and make every neighbour refuse the bundle. Quay-basin (shared/quay-
// basin.mjs) is the precedent for a layer that lies beside the terrain like this. And it never
// touches `height()` either: that stays the logical water surface - boats, guards, the colour
// of the water and water-patch.test.mjs's "coarse water is only valid over a flat OPEN_SEA" all
// read it. A trench is therefore deliberately invisible from above, and costs nothing there.
//
// Range, and why these numbers: mostly flat sand at OPEN_SEA (-2.5), with BANKS rising up to
// BED_TOP (-1.0) and TRENCHES dropping to BED_DEEPEST (-3.5).
//   - A boat starts to scrape at 0.35 (BOAT_SCRAPE in web/js/boat.js) and the shore detector
//     fires at 0.06, so a bank whose top is a metre and a half under the surface can never
//     touch a hull. That is the rule that makes the banks safe to add, and it is the reason
//     BED_TOP is a constant rather than an art choice.
//   - The sea clamps a pose's y to [-4, 60] (lib/players.mjs), so the deepest bed is above the
//     lowest thing a diver can be *sent* as. -3.5 leaves a body's worth of it for the feet.
//
// **The field is in the WORLD frame** (the sea's, where every pose travels), never the page's
// scene frame: a page draws its own island at the scene origin and translates the world by its
// berth (regions.mjs worldToScene), so two pages disagree about scene coordinates by exactly
// that berth. One field in world coordinates is what puts a bank in the same place for both,
// and a diver standing on it on the same sand on both screens. `archipelago.bedAt` adds the
// berth (`setBedHome`); this file only knows world coordinates.
//
// This file obeys shared/'s rule (see rng.mjs): + - * /, floor, abs, min, max and sqrt, and
// nothing else - no sin, cos, pow, no clock, no Math.random - because the diver's feet and the
// sea's clamp are decided from this number on more than one machine. tests/seabed.test.mjs
// reads the source to hold that.
import { makeSimplex2D, smoothstep, clamp } from './rng.mjs';

// The open sea's depth, which is regions.mjs OPEN_SEA. Written out here rather than imported:
// regions.mjs imports this file (its `bedAt` is built on it), and an import back would be a
// cycle. tests/seabed.test.mjs asserts the two are the same number.
export const BED_FLOOR = -2.5;
// How far a bank may rise above the floor and a trench sink under it. The tops and bottoms
// below are these added to BED_FLOOR, so the range has exactly one place it is decided.
export const BANK_RISE = 1.5;
export const TRENCH_DROP = 1.0;
export const BED_TOP = BED_FLOOR + BANK_RISE;          // -1.0
export const BED_DEEPEST = BED_FLOOR - TRENCH_DROP;    // -3.5
// Flat, within this many units of the nearest island or islet square, so the seam between an
// island's own heightfield and the field is a blend into level sand and never a cliff. Past
// it the relief comes in over BED_BAND..BED_FADE: 28 units for a bank to reach its full
// height, which is what keeps the slope of that ramp itself under a tenth.
export const BED_BAND = 12;
export const BED_FADE = 40;

// How big a feature is, in units: a bank or a trench is a hundred across, so a swim of half a
// minute crosses one and a boat's whole berth fits on it. Bigger than it looks like it needs
// to be, and that is the slope: the height of a bank is fixed (a metre and a half of it), so
// the only thing that sets how steep its side is is how far the noise takes to get from level
// to full, and the noise is a wave of this length. At 1/56 the steepest flank measured 0.65 -
// too steep to walk - and 1/120 measures 0.22 (tests/seabed.test.mjs holds it under 0.3).
const FEATURE_SCALE = 1 / 120;
// The second, smaller octave: it only bends the outline of the first, so a bank is not a
// smooth oval. Weighted well down, and slow: its gradient adds to the first's, and a 1/21 one
// at a sixth of the weight was 40% of the slope all by itself.
const DETAIL_SCALE = 1 / 45;
const DETAIL_WEIGHT = 0.05;
// Where in the noise a bank begins and a trench begins, and how wide the slope from level sand
// to the top of one is (in noise units). Set so that about one part in seven of the open sea
// is bank and about one in nine is trench (a bed more than a quarter above or below the floor:
// measured 14% and 11% over a 6000 x 6000 sample). The noise seldom goes past 0.8, so a top is
// only reached now and then (1%): BED_TOP is a ceiling, and most banks stand a little under it.
const BANK_FROM = 0.36;
const TRENCH_FROM = 0.36;
const RAMP = 0.55;
// The sand's own ripples: a few centimetres, in long crests. Anisotropic so they run one way
// like a tide's, and scaled down to nothing on a bank top or a trench floor so the ranges
// above hold without a clamp ever doing anything (there is one anyway, as a belt). Crests
// four to eight units apart: the fine ring of the page's bed (web/js/seabed.js, a vertex per
// unit) draws them, and the coarser ones sample past them.
const RIPPLE = 0.08;
const RIPPLE_X = 0.13;
const RIPPLE_Z = 0.22;

const feature = makeSimplex2D('seabed');
const detail = makeSimplex2D('seabed:detail');
const sand = makeSimplex2D('seabed:sand');

// How much higher (+) or lower (-) than the floor the bed is at a world point, before it is
// faded out towards an island. In [-TRENCH_DROP, BANK_RISE] whatever the point.
export function bedDelta(x, z) {
  const n = clamp(
    (1 - DETAIL_WEIGHT) * feature(x * FEATURE_SCALE, z * FEATURE_SCALE)
    + DETAIL_WEIGHT * detail(x * DETAIL_SCALE + 31.7, z * DETAIL_SCALE - 12.9),
    -1, 1);
  // One field with two sides: a bank is where it is high, a trench where it is low, so the
  // two can never be on the same spot and never stand next to each other without a stretch of
  // level sand between - which is what makes the slope between them a bank's own.
  const bank = smoothstep(BANK_FROM, BANK_FROM + RAMP, n);
  const trench = smoothstep(TRENCH_FROM, TRENCH_FROM + RAMP, -n);
  const ripple = RIPPLE * clamp(sand(x * RIPPLE_X, z * RIPPLE_Z), -1, 1) * (1 - Math.max(bank, trench));
  return clamp(BANK_RISE * bank - TRENCH_DROP * trench + ripple, -TRENCH_DROP, BANK_RISE);
}

// The bed at a world point that is `dist` outside the nearest island or islet square (0 or
// more; Infinity for none at all): the floor, plus the relief once it has faded in. The floor
// is handed in so a caller with a different sea level can use the same relief - regions.mjs
// passes its own OPEN_SEA, and the default is the same number.
export function fieldHeight(x, z, dist, floor = BED_FLOOR) {
  const t = smoothstep(BED_BAND, BED_FADE, dist);
  // Nothing to add within the band: skip the noise, which is most of what a page asks about.
  if (t === 0) return floor;
  return floor + bedDelta(x, z) * t;
}

// How far (x, z) is outside one square of `half` round `origin` ([x, z]): 0 on or inside it.
// The distance to a *rectangle*, so it is one-Lipschitz - and the ramp in `fieldHeight` is as
// gentle as it was designed to be whichever side of the square the point is, corners included.
export function distToSquare(x, z, origin, half) {
  const dx = Math.max(0, Math.abs(x - origin[0]) - half);
  const dz = Math.max(0, Math.abs(z - origin[1]) - half);
  return Math.sqrt(dx * dx + dz * dz);
}

// How far (x, z) is outside the nearest of `squares` (`{ origin: [x, z], half }` each, the
// shape createArchipelago's waterSquares and an islet's seabed use): 0 on or inside one,
// Infinity for no squares.
export function distToSquares(x, z, squares) {
  let best = Infinity;
  for (const s of squares) {
    const d = distToSquare(x, z, s.origin, s.half);
    if (d < best) best = d;
  }
  return best;
}

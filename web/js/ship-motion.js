// The galleon's sail and flag in motion (Plans/DONE/nieuwe-sloep.md, chip 2c): the sail follows the setting
// she is under (`b.underSail`, web/js/boat.js SAIL_STEPS) - furled up against its yard at 0, set and
// breathing at 1, and anywhere between while it is being taken in or let out - and the flag flies.
//
// Both are baked into her one asset as parts of their own (`pirateship sail`, `pirateship flag`;
// boat.js `isShipMoving` names them) and welded into the hull's one geometry as its last runs, the way
// her guns are (boat.js gunRuns), so a ship stays one draw call. This file is the arithmetic that moves
// their corners on the CPU, every frame, off the sea's clock (`t` in seconds, main.js frameSeconds) so
// every screen has the same cloth at the same place; the share of sail is this page's reading of the
// hull (main.js), never anything on the wire. Nothing here knows THREE or the DOM: plain Float32Arrays
// in and out, which is what lets tests/ship-sail.test.mjs furl a sail under Node.
//
// The sums are the Salty Kraken's (web/js/kraken-motion.js MOTION) - the same ripple across a set sail,
// the same wave along a flag - so the galleon and the pub read as one weather. tests/ship-sail.test.mjs
// holds the two copies equal; a sail at sea is drawn by this file, a sail on the rock by that one.
//
// Frames: positions are the hull's own (shared/crafts.mjs: +z forward, +x starboard, y above the sea
// after boat.js has sunk the bake by SHIP_DRAUGHT), as they lie in the hull's geometry.

const TAU = Math.PI * 2;

// A set sail: how far it breathes in and out at its foot, as a share of its height, how long one breath
// takes (s), and the smaller ripple running across it (share of height, waves across, speed). A flag: how
// far the fly end swings across, as a share of its length, how many waves run along it, how fast, how far
// the fly droops. The numbers are kraken-motion.js's `MOTION.sail` and `MOTION.flag` (held equal by test).
export const SHIP_MOTION = Object.freeze({
  sail: Object.freeze({ breathe: 0.035, breatheS: 3.7, ripple: 0.012, wave: 5.0, speed: 2.4 }),
  flag: Object.freeze({ swing: 0.09, wave: 4.2, speed: 5.0, droop: 0.03 }),
});

// Furling: the cloth is rolled up onto the yard from the foot, ROLL_TURNS turns of it, so the roll's
// radius is the sail's height over that many circumferences - a sail 3 tall rolls to about 0.19. Each
// corner goes to its place on the roll: the yard's own row stays on the yard, the foot ends up inside.
// Not a real furl (that bunches the cloth into gaskets), but a sail-shaped bundle under the yard, which
// is what a struck sail reads as from a boat's length away.
export const ROLL_TURNS = 2.5;
// A share of sail under this is the same as none: nothing ripples a bundle.
const SET_MIN = 1e-3;
// Within this of the luff's line a flag's corner is on the staff (see moveFlag).
const LUFF_EPS = 1e-6;

// ---- measuring ---------------------------------------------------------------------------------------
// Both measures take the part's corners already in the hull's frame (positions plus the part's `at`,
// less the draught), as a flat array of xyz. They are taken once, when the hull is welded.

// The main horizontal axis of a set of corners, by its covariance on the xz plane: [ax, az] unit, and
// the mean. `null` when there is no spread at all (a part of one point).
function axisOf(p, pick = () => true) {
  let cx = 0, cz = 0, n = 0;
  for (let i = 0; i < p.length; i += 3) if (pick(i)) { cx += p[i]; cz += p[i + 2]; n++; }
  if (!n) return null;
  cx /= n; cz /= n;
  let xx = 0, zz = 0, xz = 0;
  for (let i = 0; i < p.length; i += 3) {
    if (!pick(i)) continue;
    const dx = p[i] - cx, dz = p[i + 2] - cz;
    xx += dx * dx; zz += dz * dz; xz += dx * dz;
  }
  if (xx + zz < 1e-12) return null;
  const a = 0.5 * Math.atan2(2 * xz, xx - zz);
  return { along: [Math.cos(a), Math.sin(a)], centre: [cx, cz] };
}

// The sail: its yard is its highest row (the bake's origin is the yard's middle and the cloth hangs
// below it, Plans/DONE/nieuwe-sloep.md chip 3 - measured here off the corners all the same, so a sail baked
// otherwise still hangs from its top), its foot its lowest. `along` is the yard's own direction on the
// plane, read off the corners within YARD_BAND of the top (a yard braced round is not square to the
// ship), `normal` the way the cloth breathes, `half` how far the cloth reaches along the yard from its
// middle. `h` is the drop from yard to foot.
const YARD_BAND = 0.08;
export function measureSail(p) {
  let yard = -Infinity, foot = Infinity;
  for (let i = 1; i < p.length; i += 3) { if (p[i] > yard) yard = p[i]; if (p[i] < foot) foot = p[i]; }
  if (!Number.isFinite(yard)) return null;
  const top = axisOf(p, (i) => p[i + 1] >= yard - YARD_BAND) || axisOf(p) || { along: [1, 0], centre: [0, 0] };
  const [ax, az] = top.along;
  // The yard's line: through the middle of the top row, along `along`, at height `yard`. Where a corner
  // stands across that line (its offset along the normal) is left out of the furled point, so the roll
  // hangs plumb under the yard whichever way the cloth was bellied.
  const whole = axisOf(p) || top;
  let half = 0;
  for (let i = 0; i < p.length; i += 3) half = Math.max(half, Math.abs((p[i] - top.centre[0]) * ax + (p[i + 2] - top.centre[1]) * az));
  return {
    yard, foot, h: Math.max(yard - foot, 1e-6),
    along: [ax, az], normal: [-az, ax], centre: [top.centre[0], top.centre[1]],
    // Where the cloth's middle lies on the plane, for the breathe's falloff towards the leeches.
    mid: [whole.centre[0], whole.centre[1]],
    half: half || 1,
  };
}

// The flag: its luff is the edge at the staff, which is the part's origin `at` (the Batavia's flags
// are baked so, build-batavia.py, and the sloop's is to be: Plans/DONE/nieuwe-sloep.md chip 3). The fly runs
// away from it along the cloth's long axis; `dir` is that way on the plane, `side` the way the fly end
// swings, `len` how far the cloth reaches from the luff. A flag whose `at` is nowhere near either end
// (an older bake) flies from whichever end is nearer it, so it always flies from an edge.
export function measureFlag(p, at = [0, 0, 0]) {
  const ax = axisOf(p);
  if (!ax) return null;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const s = (p[i] - ax.centre[0]) * ax.along[0] + (p[i + 2] - ax.centre[1]) * ax.along[1];
    if (s < lo) lo = s; if (s > hi) hi = s;
  }
  const sAt = (at[0] - ax.centre[0]) * ax.along[0] + (at[2] - ax.centre[1]) * ax.along[1];
  // Towards the end further from the staff.
  const sign = Math.abs(sAt - lo) <= Math.abs(sAt - hi) ? 1 : -1;
  const dir = [ax.along[0] * sign, ax.along[1] * sign];
  const luffS = sign > 0 ? lo : hi;
  return {
    luff: [ax.centre[0] + ax.along[0] * luffS, ax.centre[1] + ax.along[1] * luffS],
    dir, side: [-dir[1], dir[0]],
    len: Math.max(hi - lo, 1e-6),
  };
}

// ---- moving ------------------------------------------------------------------------------------------
// `m` is { base: Float32Array (the baked corners in the hull's frame), sail | flag: the measure, seed }.
// `out` is a Float32Array as long as `base` - in boat.js a view onto the run's stretch of the hull's
// position array, so a move writes straight into the geometry. Both return `out`.

// The sail at sea time `t`, `share` of it set (0 furled .. 1 full; a backed sail, -1, is as much cloth
// as a full one). Every corner is blended between its baked place and its place on the roll, and the
// set part of it breathes and ripples by the Kraken's sum, scaled by the share: a bundle does not ripple.
export function moveSail(m, t, share, out) {
  const { base, sail: S } = m;
  const set = Math.min(1, Math.abs(Number.isFinite(share) ? share : 0));
  const K = SHIP_MOTION.sail;
  const seed = m.seed || 0;
  const r = S.h / (TAU * ROLL_TURNS);
  const [ax, az] = S.along, [nx, nz] = S.normal, [cx, cz] = S.centre;
  const breathe = set > SET_MIN ? Math.sin(TAU * t / K.breatheS + seed) : 0;
  for (let i = 0; i < base.length; i += 3) {
    const x = base[i], y = base[i + 1], z = base[i + 2];
    // Where along the yard this corner hangs, and how far down the cloth it is (0 at the yard, 1 at the foot).
    const s = (x - cx) * ax + (z - cz) * az;
    const k = Math.min(1, Math.max(0, (S.yard - y) / S.h));
    // Its place on the roll: on a circle of radius r under the yard's line, the yard's row at the top of it.
    const phi = k * TAU * ROLL_TURNS;
    const px = cx + ax * s, pz = cz + az * s;
    const fx = px + nx * r * Math.sin(phi), fy = S.yard - r + r * Math.cos(phi), fz = pz + nz * r * Math.sin(phi);
    let ox = x + (fx - x) * (1 - set), oy = y + (fy - y) * (1 - set), oz = z + (fz - z) * (1 - set);
    if (set > SET_MIN) {
      // The Kraken's sail: hung from its yard, the yard stays and the foot moves most, breathing in and
      // out across the middle and rippling across.
      const u = ((x - S.mid[0]) * ax + (z - S.mid[1]) * az) / S.half;
      const push = set * S.h * k * (K.breathe * breathe * (1 - Math.min(1, u * u))
        + K.ripple * Math.sin(K.wave * u - K.speed * t + seed));
      ox += nx * push; oz += nz * push;
    }
    out[i] = ox; out[i + 1] = oy; out[i + 2] = oz;
  }
  return out;
}

// The flag at sea time `t`: the Kraken's (and the Batavia's) sum, flying from its luff along `dir`,
// swinging across by `side` and drooping towards the fly end.
export function moveFlag(m, t, out) {
  const { base, flag: F } = m;
  const K = SHIP_MOTION.flag;
  const seed = m.seed || 0;
  const [lx, lz] = F.luff, [dx, dz] = F.dir, [sx, sz] = F.side;
  for (let i = 0; i < base.length; i += 3) {
    const x = base[i], y = base[i + 1], z = base[i + 2];
    // A hair off the luff is the luff: its line is worked out in doubles off Float32 corners, and a
    // staff column 1e-16 past it would swing by that much and never be still to the byte.
    const d0 = (x - lx) * dx + (z - lz) * dz, d = d0 > LUFF_EPS ? d0 : 0, k = d / F.len;
    const swing = K.swing * F.len * k * Math.sin(K.wave * d / F.len - K.speed * t + seed);
    out[i] = x + sx * swing;
    out[i + 1] = y - K.droop * F.len * k * k;
    out[i + 2] = z + sz * swing;
  }
  return out;
}

// The share of sail drawn follows the share asked for at SAIL_EASE a second, so taking in or letting out
// is seen happening (about two seconds from furled to full) rather than the cloth jumping. `dt` in
// seconds; a dt of 0 (the hull posed twice at one clock) changes nothing.
export const SAIL_EASE = 0.5;
export function easeShare(drawn, want, dt) {
  const to = Math.max(-1, Math.min(1, Number.isFinite(want) ? want : 0));
  if (!(dt > 0)) return drawn;
  const step = SAIL_EASE * dt;
  const d = to - drawn;
  return d > step ? drawn + step : d < -step ? drawn - step : to;
}

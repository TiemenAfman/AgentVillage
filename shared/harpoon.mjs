// The harpoon's arithmetic: a bolt in flight on a line, what it strikes, the shape of the line,
// reeling it in, and what a body on a taut line is doing (Plans/harpoen.md).
//
// In shared/ because a hooked player is reeled by their own page and a reel that drags a ship
// may one day be checked by the sea, and those two must agree to the bit. So shared/'s rules
// hold in full: no sin/cos/pow/atan, no clock, no three.js - only + - * / and sqrt, which IEEE
// rounds the same everywhere (tests/harpoon.test.mjs reads the source for it). Every step takes
// its `dt` from the caller, who keeps it fixed (a tick), as settlerwalk does.
//
// Bodies are plain { x, y, z, vx, vy, vz, m }: world coordinates, units a second, and `m` a mass
// (MASS below). A mass of Infinity is something the line cannot move - land, a rock, or a hull
// this page has no say over (lib/boats.mjs: only her pilot moves a boat).

import { SEA_LEVEL } from './terrain.mjs';

// How fast a bolt leaves the gun, and how it falls: slower than a cannonball (Plans/kanonnen.md
// has 38), heavier in the air, so a shot at its highest elevation lands near the end of the line.
export const BOLT_SPEED = 26;
export const BOLT_G = 9;
export const BOLT_DRAG = 0.05;      // of the speed, a second
// How much line the gun carries. A bolt past it is held by the line: it swings on, it does not fly.
export const ROPE_MAX = 40;
// How fast the gun reels in, and how short the line can be drawn (the bolt at the gun's mouth).
export const REEL_SPEED = 4;
export const REEL_MIN = 1.2;
// How hard a taut line takes up the stretch past its length, a second: 1/REEL_K s to close it.
export const REEL_K = 6;
// How heavy each thing is to the line. Only the ratio matters: the light end comes, the heavy stays.
export const MASS = Object.freeze({ statue: 1, chest: 1, player: 2, rowboat: 6, galleon: 60, land: Infinity });
// On a taut line (walk.js stepRope): how fast it is walked, carefully, a foot before the other, and how
// far the feet hang under it while it is slid down. Here so the motion workbench draws the same.
export const ROPE_WALK = 0.9;
export const ROPE_HANG = 0.42;
// The points a line is drawn and walked through.
export const ROPE_SEGS = 16;
// The rise over the run past which a taut line is slid down, not walked: about 20 degrees.
export const ZIP_SLOPE = 0.364;

// One step of a bolt in flight. `from` is where the line is made fast (the gun's mouth, this
// frame - the ship moves); `b` gains `x y z vx vy vz`. Past ROPE_MAX from `from` the line takes the
// outward part of its velocity, so a bolt at the end of its line swings down on it.
export function stepBolt(b, from, dt) {
  const k = 1 - BOLT_DRAG * dt;
  b.vx *= k; b.vz *= k; b.vy = b.vy * k - BOLT_G * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  const dx = b.x - from.x, dy = b.y - from.y, dz = b.z - from.z;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > ROPE_MAX * ROPE_MAX) {
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d;
    const s = ROPE_MAX / d;
    b.x = from.x + dx * s; b.y = from.y + dy * s; b.z = from.z + dz * s;
    const out = b.vx * nx + b.vy * ny + b.vz * nz;
    if (out > 0) { b.vx -= out * nx; b.vy -= out * ny; b.vz -= out * nz; }
  }
  return b;
}

// The first thing the bolt meets between `a` and `b` (two of its positions, a frame apart):
//   world.targets  [{ id, kind, x, y, z, r }] - a statue, a player, a hull (the page hands them in)
//   world.ground   (x, z) => the height of the ground there, or null where there is none
// Answers { kind, id?, x, y, z, t } with t along the segment 0..1, or null. A target is struck where
// the segment comes nearest it if that is inside its `r` (exact, no sampling); ground and water are
// sampled every STEP and the earlier of the two wins. Water is not a hold: `kind: 'water'`, and the
// caller lets the bolt sink and reels it home.
const STEP = 0.25;
export function boltHit(a, b, world = {}) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz;
  let best = null;
  for (const t of world.targets || []) {
    let u = len2 > 0 ? ((t.x - a.x) * dx + (t.y - a.y) * dy + (t.z - a.z) * dz) / len2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const px = a.x + dx * u - t.x, py = a.y + dy * u - t.y, pz = a.z + dz * u - t.z;
    if (px * px + py * py + pz * pz > t.r * t.r) continue;
    if (best && best.t <= u) continue;
    best = { kind: t.kind, id: t.id, x: a.x + dx * u, y: a.y + dy * u, z: a.z + dz * u, t: u };
  }
  const n = Math.max(1, Math.ceil(Math.sqrt(len2) / STEP));
  for (let i = 1; i <= n; i++) {
    const u = i / n;
    if (best && best.t <= u) break;
    const x = a.x + dx * u, y = a.y + dy * u, z = a.z + dz * u;
    const g = world.ground ? world.ground(x, z) : null;
    if (g != null && g > SEA_LEVEL && y <= g) return { kind: 'land', x, y: g, z, t: u };
    if (y <= SEA_LEVEL && (g == null || g <= SEA_LEVEL)) return { kind: 'water', x, y: SEA_LEVEL, z, t: u };
  }
  return best;
}

// The line between `a` and `b`, `length` long, as ROPE_SEGS + 1 points into `out` (flat
// [x, y, z, ...]). Taut (length no more than the chord) it is straight; slack it hangs in a
// parabola whose arc is the length: for a span c and a sag d that arc is c + 8d^2 / 3c, so the
// sag is sqrt(3c * slack / 8) - the catenary near enough for a line, and with no cosh in it.
export function ropeShape(a, b, length, out = new Array((ROPE_SEGS + 1) * 3), segs = ROPE_SEGS) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const c = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const slack = length > c ? length - c : 0;
  const sag = c > 1e-6 ? Math.sqrt(3 * c * slack / 8) : slack / 2;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    out[i * 3] = a.x + dx * t;
    out[i * 3 + 1] = a.y + dy * t - 4 * sag * t * (1 - t);
    out[i * 3 + 2] = a.z + dz * t;
  }
  return out;
}

// One tick of a line between two bodies. `r` is the line: { L, reeling }. Reeling draws L in at
// REEL_SPEED down to REEL_MIN. Where the bodies stand further apart than L the line pulls: an
// impulse along it, shared by their masses, that leaves them closing at REEL_K times the stretch
// (never pushes - a line does not). What it takes away is only the part of their velocities along
// the line, so a ship making way on a line to a rock goes round it rather than stopping.
// Answers the tension this tick (the impulse, 0 when slack) and sets r.taut.
export function stepReel(r, a, b, dt) {
  if (r.reeling) r.L = Math.max(REEL_MIN, r.L - REEL_SPEED * dt);
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  r.taut = d >= r.L - 1e-6;
  if (d <= r.L || d < 1e-9) return 0;
  const wa = invMass(a), wb = invMass(b);
  if (wa + wb === 0) return 0;
  const nx = dx / d, ny = dy / d, nz = dz / d;
  const vr = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny + (b.vz - a.vz) * nz;
  const want = -(d - r.L) * REEL_K;
  if (vr <= want) return 0;
  const j = (want - vr) / (wa + wb);                // < 0: b towards a, a towards b
  b.vx += nx * j * wb; b.vy += ny * j * wb; b.vz += nz * j * wb;
  a.vx -= nx * j * wa; a.vy -= ny * j * wa; a.vz -= nz * j * wa;
  return -j;
}
const invMass = (o) => (o.m === Infinity || !(o.m > 0) ? 0 : 1 / o.m);

// What a taut line between two fast points is to somebody on it: 'walk' (along it) while it rises
// less than ZIP_SLOPE over its run, 'zip' (slide down it) when steeper, 'none' when it hangs nearly
// plumb. `low` is the end it slides to (0 = a, 1 = b) and `slope` rise over run.
export function ropeMode(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z, rise = b.y - a.y;
  const run = Math.sqrt(dx * dx + dz * dz);
  const drop = rise < 0 ? -rise : rise;
  if (run < 0.25 || drop > run * 4) return { mode: 'none', slope: Infinity, low: rise < 0 ? 1 : 0 };
  const slope = drop / run;
  return { mode: slope <= ZIP_SLOPE ? 'walk' : 'zip', slope, low: rise < 0 ? 1 : 0 };
}

// Sliding down a steep line, hanging from it: s = { at, v }, `at` the distance from the high end
// along the line and `v` the speed down it. Gravity's share along a straight line is the drop over
// its length; friction takes ZIP_FRICTION of the speed a second and the speed is held under ZIP_TOP.
// Answers true while still on it (at < length).
export const ZIP_FRICTION = 0.25;
export const ZIP_TOP = 14;
export const ZIP_G = 12.5;          // walk.js GRAVITY: a body on a line falls as it does off one
export function stepZip(s, high, low, dt) {
  const dx = low.x - high.x, dy = low.y - high.y, dz = low.z - high.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) return false;
  s.v += (ZIP_G * (-dy / len) - ZIP_FRICTION * s.v) * dt;
  if (s.v > ZIP_TOP) s.v = ZIP_TOP;
  if (s.v < 0) s.v = 0;
  s.at += s.v * dt;
  return s.at < len;
}

// A point on a straight line from `a` to `b`, `d` along it.
export function alongLine(a, b, d, out = { x: 0, y: 0, z: 0 }) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const t = len > 0 ? Math.min(1, Math.max(0, d / len)) : 0;
  out.x = a.x + dx * t; out.y = a.y + dy * t; out.z = a.z + dz * t;
  return out;
}

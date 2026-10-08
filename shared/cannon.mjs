// The galleon's guns (Plans/kanonnen.md): how far they turn, how a ball flies and where it comes
// down. The one copy - the page aims, draws and explodes by it, the sea (lib/cannons.mjs) flies the
// same ball to see whom it hurts - and so it keeps shared/'s rule: no sin, cos or pow, no clock, no
// three. A ball's flight is the closed form of a throw (no drag), so where it is at any moment is a
// sum, the same on every machine to the bit, and nothing has to be stepped in lockstep: the page
// draws `ballAt(shot, t)` off its own clock and the sea asks the same function on its beat.
//
// Where a gun stands on the ship is shared/crafts.mjs's (`CRAFTS.galleon.cannons`); the angles that
// turn a gun into a direction need sin and cos, and are the page's (web/js/cannon.js muzzleOf), which
// hands the sea a velocity, never an angle.

// How far a gun turns either side of square out of her side (radians, 35 degrees), and the bore's
// elevation above level it may be laid between (absolute, -7 to +24 degrees). The model's barrel
// lies at 9.5 degrees on its carriage at rest (scripts/build-cannon.py prints it); the page turns it
// by the difference.
export const GUN_TRAVERSE = 0.61;
export const GUN_PITCH_MIN = -0.12;
export const GUN_PITCH_MAX = 0.42;
// Where it rests when nobody is on it: square out, laid a little up.
export const GUN_PITCH_REST = 0.08;
// How fast a gun follows the mouse, radians a second: a few tons of iron on trucks, not a turret.
export const GUN_TURN = 1.1;
// Seconds to ram a ball home (R), and between shots for the barrel to be sponged and run out again:
// unlimited shot (the keeper's call), so this is what paces a broadside.
export const LOAD_S = 1.6;
export const RECOIL_S = 0.9;
// The fuse (the keeper, after Sea of Thieves): firing lights it, and the gun goes off FUSE_S later.
// Firing again before then snuffs it, and lighting it again starts the two seconds over.
export const FUSE_S = 2;

// A ball: out of the muzzle at BALL_SPEED, under BALL_G. At the gun's highest it carries about 135
// units over flat water (v^2 sin 2a / g), the width of a big island; laid level from the deck, 35.
// BALL_G is gentler than a body's (walk.js GRAVITY 12.5) - a game's shot, not a physics lesson - so
// an arc is seen and a long shot has time to be watched.
export const BALL_SPEED = 38;
export const BALL_G = 7.5;
// A ball is given up on after this long (it has gone over the horizon, or into the haze).
export const BALL_LIFE = 9;
// The step a flight is searched at for what it hits: under a unit of travel at full speed, so a
// ball never passes through the side of a hull or a dune between two looks.
export const BALL_STEP = 0.02;
// What it does where it lands. A blast on land or a hull is BLAST_R across and costs up to BALL_HIT
// (lib/health.mjs MAX_HEALTH is 100: a ball at your feet is half of it), less towards the edge; a
// ball that hits a body square costs it BALL_HIT whole; a splash hurts nobody but a swimmer it lands on.
export const BLAST_R = 1.8;
export const BALL_HIT = 50;
export const BODY_R = 0.45;

// A body fired out of a gun (the keeper's "je moet ook jezelf kunnen afvuren"): slower than a ball,
// on a body's own gravity (walk.js GRAVITY, held equal by tests/cannon.test.mjs), so it flies about
// 30 units at the highest and comes down where walk mode's own landing - or its plunge into deep
// water - takes over.
export const HUMAN_SPEED = 21;
export const HUMAN_G = 12.5;

// The outline a ball can hit a ship by, in her own frame (+z forward, y above the sea's surface):
// her hull from under the waterline to the top of her bulwarks, the length of her from stern to
// the root of the bowsprit. Coarse on purpose - the sea flies the same ball and has no model.
export const HULL_BOX = Object.freeze({ hx: 2.0, hz: 6.2, y0: -1.2, y1: 2.0 });
// And a rowing boat's, which can be hit now that a hit can sink it (the keeper, 8 October 2026).
export const ROWBOAT_BOX = Object.freeze({ hx: 0.4, hz: 0.8, y0: -0.4, y1: 0.6 });
// How many balls a hull takes before she goes down (the keeper: a galleon has hull points, a rowing
// boat "2 levens, dat is zielig" - two). A hull with no hit for HULL_MEND_MS is whole again: the crew
// has patched her. A sunk boat comes back whole at her own mooring (lib/boats.mjs wreck); in her own
// island's waters a boat is not hurt at all.
export const HULL_HITS = Object.freeze({ galleon: 5, rowboat: 2 });
export const HULL_MEND_MS = 120000;
// A ball does not hit the ship it was fired from while it is still within this of its muzzle:
// the barrel's mouth stands over her own bulwark.
export const OWN_CLEAR = 1.2;

// Clamp a laying of the gun to what it can do: `yaw` is the traverse off its rest heading (radians),
// `pitch` the bore's elevation. `mount` (shared/crafts.mjs, a deck's `mounts`) may carry its own
// `yawLim` and `pitchLim`; without, a gun's.
export function clampLay(yaw, pitch, mount = null) {
  const y = mount && mount.yawLim != null ? mount.yawLim : GUN_TRAVERSE;
  const [lo, hi] = mount && mount.pitchLim ? mount.pitchLim : [GUN_PITCH_MIN, GUN_PITCH_MAX];
  return [yaw < -y ? -y : yaw > y ? y : yaw, pitch < lo ? lo : pitch > hi ? hi : pitch];
}

// Ease a laying towards where it is wanted at GUN_TURN, `dt` seconds.
export function slewLay(from, to, dt) {
  const step = GUN_TURN * dt;
  const out = [0, 0];
  for (let k = 0; k < 2; k++) {
    const d = to[k] - from[k];
    out[k] = d > step ? from[k] + step : d < -step ? from[k] - step : to[k];
  }
  return out;
}

// Where a shot is `t` seconds after it left the muzzle: `shot` is { o: [x, y, z], v: [x, y, z], g? }.
export function ballAt(shot, t, out = [0, 0, 0]) {
  const g = shot.g ?? BALL_G;
  out[0] = shot.o[0] + shot.v[0] * t;
  out[1] = shot.o[1] + shot.v[1] * t - 0.5 * g * t * t;
  out[2] = shot.o[2] + shot.v[2] * t;
  return out;
}

// Is a point inside a hull's outline? `h` is { x, z, fx, fz, y, box? } (lib/boats.mjs frameOf: her
// middle and the unit vector along her bow; `y` her rise in the swell, 0 if not known; `box` her
// outline, the galleon's HULL_BOX when not given).
export function inHull(h, x, y, z) {
  const dx = x - h.x, dz = z - h.z;
  const along = dx * h.fx + dz * h.fz;
  const across = dx * h.fz - dz * h.fx;
  const up = y - (h.y || 0);
  const box = h.box || HULL_BOX;
  return across > -box.hx && across < box.hx && along > -box.hz && along < box.hz
    && up > box.y0 && up < box.y1;
}

// The first thing a shot meets, searched from `from` seconds to `to` (at most BALL_LIFE). `world`:
//   height(x, z)  the ground there (the sea floor where it is under water; land above SEA_LEVEL 0)
//   hulls         [{ id, x, z, fx, fz, y }] ships that can be hit; the shot's own ship (`shot.b`)
//                 only once the ball is OWN_CLEAR out of the muzzle
//   bodies        [{ id, x, y, z }] (optional) feet of somebody who can be hit square; never the
//                 one who fired it (`shot.by`)
// Returns { t, at: [x, y, z], kind: 'splash' | 'blast' | 'hull' | 'body', id? } or null if it is
// still flying at `to` (or ran out of life: then `kind` 'lost').
export function ballHit(shot, world, from = 0, to = BALL_LIFE) {
  const end = to < BALL_LIFE ? to : BALL_LIFE;
  const p = [0, 0, 0];
  const own = shot.b || null;
  for (let t = from; t <= end + 1e-9; t += BALL_STEP) {
    ballAt(shot, t, p);
    const [x, y, z] = p;
    if (world.bodies) {
      for (const b of world.bodies) {
        if (b.id === shot.by) continue;
        const dx = x - b.x, dz = z - b.z, dy = y - (b.y + 0.3);
        if (dx * dx + dz * dz < BODY_R * BODY_R && dy > -0.45 && dy < 0.45) return { t, at: [x, y, z], kind: 'body', id: b.id };
      }
    }
    for (const h of world.hulls || []) {
      if (h.id === own) {
        const ox = x - shot.o[0], oy = y - shot.o[1], oz = z - shot.o[2];
        if (ox * ox + oy * oy + oz * oz < OWN_CLEAR * OWN_CLEAR) continue;
      }
      if (inHull(h, x, y, z)) return { t, at: [x, y, z], kind: 'hull', id: h.id };
    }
    const ground = world.height(x, z);
    if (ground >= 0 && y <= ground) return { t, at: [x, ground, z], kind: 'blast' };
    if (ground < 0 && y <= 0) return { t, at: [x, 0, z], kind: 'splash' };
  }
  return end >= BALL_LIFE ? { t: BALL_LIFE, at: ballAt(shot, BALL_LIFE), kind: 'lost' } : null;
}

// What a blast at `at` (kind from ballHit) costs a body standing at `p` (feet): BALL_HIT square on,
// down to nothing at BLAST_R. A splash hurts only somebody it lands right on (a swimmer).
export function blastOn(kind, at, p) {
  const dx = p[0] - at[0], dy = (p[1] + 0.3) - at[1], dz = p[2] - at[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  if (kind === 'body') return BALL_HIT;
  if (kind === 'splash' || kind === 'lost') return d2 < BODY_R * BODY_R * 4 ? BALL_HIT * 0.5 : 0;
  if (d2 >= BLAST_R * BLAST_R) return 0;
  // Linear in the distance, worked out without a square root by halving: d/R from d2/R2, which is
  // close enough for a game's falloff and the same on every machine.
  let lo = 0, hi = 1;
  const r2 = d2 / (BLAST_R * BLAST_R);
  for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (m * m < r2) lo = m; else hi = m; }
  return BALL_HIT * (1 - (lo + hi) / 2);
}

// A message's shot, checked: numbers that are numbers, a velocity no faster than a ball's (the sea
// believes a shot's origin and direction from the page, as it believes a pose, but not a speed).
export function parseShot(m, bound) {
  const num = (v, cap) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= cap ? v : null);
  if (!Array.isArray(m.o) || !Array.isArray(m.v) || m.o.length !== 3 || m.v.length !== 3) return null;
  const o = [num(m.o[0], bound), num(m.o[1], 60), num(m.o[2], bound)];
  const v = m.v.map((x) => num(x, BALL_SPEED * 1.01));
  if (o.includes(null) || v.includes(null)) return null;
  if (v[0] * v[0] + v[1] * v[1] + v[2] * v[2] > BALL_SPEED * BALL_SPEED * 1.02) return null;
  return { o, v };
}

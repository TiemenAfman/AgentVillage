// The director (Plans/regisseur.md): when nobody has touched the island for IDLE_S, the camera
// goes to look at something happening - a settler just arrived, the gold on its way, the timber
// wagon, the yard at work, somebody at work, one of the story animals, the fisherman - follows
// it while it circles it slowly, and after HOLD_S goes on to the next. Any input stops it where
// it stands.
//
// No DOM and no camera here, so it can be tested: `step` is handed where the camera looks from
// now and hands back where it should look from next; main.js puts that on the camera and the
// controls. What there is to look at comes from `sources()`, called only when a shot is picked -
// a list of candidates { key, label, weight, first, dist, where } where `where()` is a point
// [x, y, z] for as long as the thing is still worth watching, and null once it is not, and `dist`
// how far off it is best watched from (SHOT_DIST when not said: a settler is watched from closer
// than a wagon and its horse).

export const IDLE_S = 45;       // quiet this long before the camera wanders off by itself
export const FLY_S = 3;         // the flight from where the camera is to the first look
export const HOLD_S = 16;       // how long one thing is watched
export const SHOT_DIST = 8.5;   // how far off it is watched from
export const SHOT_EL = 0.5;     // and how high: radians over the horizon
export const ORBIT_RATE = 0.06; // how briskly it circles, radians a second
const FOLLOW = 2.5;             // how briskly the look follows a moving thing, per second
const RETRY_S = 8;              // nothing to look at: ask again this much later

const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const lerp = (a, b, k) => a + (b - a) * k;

// The way a camera at `position` looks at `target`: which way round, how high, how far.
export function viewOf(target, position) {
  const dx = position[0] - target[0], dy = position[1] - target[1], dz = position[2] - target[2];
  const flat = Math.hypot(dx, dz);
  return { az: Math.atan2(dx, dz), el: Math.atan2(dy, flat), dist: Math.hypot(flat, dy) };
}
export function poseOf(target, { az, el, dist }) {
  const c = Math.cos(el) * dist;
  return { target: [...target], position: [target[0] + Math.sin(az) * c, target[1] + Math.sin(el) * dist, target[2] + Math.cos(az) * c] };
}

// Which candidate: one marked `first` if there is any (an arrival will not wait), never the key
// just watched when there is anything else, and otherwise by weight.
export function pickShot(candidates, last, rand = Math.random) {
  const live = candidates.filter((c) => c && c.where());
  if (!live.length) return null;
  const fresh = live.filter((c) => c.key !== last);
  const pool = fresh.length ? fresh : live;
  const first = pool.filter((c) => c.first);
  const list = first.length ? first : pool;
  const total = list.reduce((n, c) => n + (c.weight || 1), 0);
  let r = rand() * total;
  for (const c of list) { r -= c.weight || 1; if (r <= 0) return c; }
  return list[list.length - 1];
}

export function createDirector({ sources, rand = Math.random, idleS = IDLE_S } = {}) {
  let idle = 0;
  let shot = null;
  let last = null;
  let retry = 0;

  function start(from) {
    const c = pickShot(sources(), last, rand);
    if (!c) return null;
    last = c.key;
    const v = viewOf(from.target, from.position);
    return {
      c, t: 0,
      from: { target: [...from.target], dist: v.dist, el: v.el },
      look: [...from.target],
      az: v.az,
    };
  }

  return {
    // Somebody did something: stand still where we are and start counting again.
    poke() {
      idle = 0;
      const was = !!shot;
      shot = null;
      return was;
    },
    active: () => !!shot,
    caption: () => (shot ? shot.c.label : null),
    key: () => (shot ? shot.c.key : null),
    // `can`: whether wandering is allowed at all right now (from above, no intro, nothing
    // open, switched on); `from`: { target, position } of the camera as it is. Returns the pose
    // to put the camera in, or null to leave it alone.
    step(dt, can, from) {
      const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
      if (!can) { idle = 0; shot = null; return null; }
      idle += d;
      if (!shot) {
        if (idle < idleS) return null;
        if (retry > 0) { retry -= d; return null; }
        shot = start(from);
        if (!shot) { retry = RETRY_S; return null; }
      }
      shot.t += d;
      const at = shot.c.where();
      // Gone, or watched long enough: on to the next from exactly where the camera is now.
      if (!at || shot.t >= FLY_S + HOLD_S) {
        shot = start(from);
        if (!shot) { retry = RETRY_S; return null; }
        return null;
      }
      shot.az += ORBIT_RATE * d;
      if (shot.t < FLY_S) {
        const k = ease(shot.t / FLY_S);
        shot.look = [0, 1, 2].map((i) => lerp(shot.from.target[i], at[i], k));
        return poseOf(shot.look, { az: shot.az, el: lerp(shot.from.el, SHOT_EL, k), dist: lerp(shot.from.dist, shot.c.dist || SHOT_DIST, k) });
      }
      const f = 1 - Math.exp(-FOLLOW * d);
      shot.look = [0, 1, 2].map((i) => shot.look[i] + (at[i] - shot.look[i]) * f);
      return poseOf(shot.look, { az: shot.az, el: SHOT_EL, dist: shot.c.dist || SHOT_DIST });
    },
  };
}

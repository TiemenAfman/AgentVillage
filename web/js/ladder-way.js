// A rope ladder's way, end to end, with its step over the top (Plans/DONE/ladder-op-en-af.md): what walk.js
// moves a climber along on every ladder there is - a ship's side, her mast, the Salty Kraken's hull -
// and what the motion workbench (avatar-motion.js) plays, so both draw the same climb.
//
// A ladder's way was a line up its rungs and then a step over the top at the height of the top: the
// feet came to the top rung's height on the rungs, still in the climb, and walked off sideways in the
// walk's pose - upright on the plank the frame after the last rung (the keeper's recording, 8 Oct
// 2026). Now the rungs end a body's step below the top, and the way over it is the one Mixamo's
// Climbing Up A Ladder To Standing takes (gait-clips.js `climbTop` `way`: how far forward and up the
// feet are at each of its rows), laid along the ladder from where the rungs end towards what it leads
// to. On that stretch the body goes at the clip's own pace, by the clip's time rather than by the
// distance covered, so the rig can play the clip at the moment the feet are at (`top`, 0..1) and the
// two never part: a hand on the rail stays on the rail as the feet come up.
//
// No clock and no three.js: points are { x, y, z } in whatever frame the caller climbs in (a hull's,
// or the world's), and the caller steps it (`climbAlong`) as it always stepped a ladder.
import { pathAt, pathLength, deckAt } from 'shared/deck.mjs';
import { nearestStand } from 'shared/hullwalk.mjs';
import { stepWay, CLIMB_SPEED } from './classic-avatar.js';
import { GAIT_CLIPS } from './gait-clips.js';

// Where a ship's rope ladder lands on her: the nearest place her model (`surface`, shared/hullwalk.mjs
// createSurface) can stand a body at the ladder's `land`, asked from a step over the planks there
// (deckAt, else the ladder's `top`), never the coordinate itself - a cannon or a post can stand where a
// table of numbers said there was nothing. One sum, so the top of a climb (walk.js startClimb), a hoist
// from a rowing boat (hoistOnto), what another page makes of a climber over the top (ladderAt, through
// `ladderPath`'s way with this as its end) and the motion workbench all end exactly where `ladderUp`
// lands: Mixamo's Climbing Up A Ladder To Standing is played along the way to this point, so a body
// found a different spot on arriving moved 0.14 in one frame. Without a surface, the deck's own point.
export function ladderLanding(surface, craft, ladder) {
  const [lx, lz] = ladder.land;
  const floor = deckAt(craft, lx, lz) ?? ladder.top;
  const at = surface ? nearestStand(surface, lx, lz, floor + 0.2) : null;
  return at ? { x: at.x, z: at.z, y: at.y } : { x: lx, z: lz, y: floor };
}

// How much of its own pace the climb over the top is played at: as fast, against the clip, as the
// rungs below it are climbed against the climb's own clip (CLIMB_SPEED, 1.8 times Climbing Up A
// Ladder's rise a second - the keeper's pick of 7 Oct 2026), so the body does not slow down at the top.
export function topPace() {
  const top = stepWay('climbTop'), C = GAIT_CLIPS.climb;
  return top && C && C.rise ? CLIMB_SPEED / (C.rise * top.leg / C.seconds) : 1;
}

// The way up a ladder, from `rope` = [foot, top, ...on] - its foot on the climber's line (rung 0, or
// where a swimmer's feet are), the head of its rungs straight above it, and then where the ladder leads:
// over a bulwark or a rim, and down onto what you stand on - and `from`, where the body stood when it
// took the ladder (or null). The head of the rungs is lowered so the step over the top ends at the
// height of the first point past it, `on[0]` (where the old way stepped over), on the line towards it;
// points of `on` the step has already come past are left out. Without the clip (a checkout that never
// baked it) the way is the old one.
//
// Returns { path, len, rungs: [from, to], top: { from, to, at: [d of each row] } | null }, `rungs` and
// `top` as distances along `path`; `top.at[k]` is how far along the path the clip's row k is.
const STRETCH = 1.4;
export function climbWay(rope, from = null) {
  const [foot, head, ...on] = rope;
  const step = stepWay('climbTop');
  const lead = from ? [from] : [];
  if (!step || !on.length) {
    const path = [...lead, ...rope];
    const a = from ? pathLength([from, foot]) : 0;
    return { path, len: pathLength(path), rungs: [a, a + pathLength([foot, head])], top: null };
  }
  const way = step.way, last = way[way.length - 1];
  const end = on[0];
  // the way over the top: towards where the ladder leads, along the ground
  let ix = end.x - head.x, iz = end.z - head.z;
  const il = Math.hypot(ix, iz) || 1;
  ix /= il; iz /= il;
  // the head of the rungs: a step's rise below where the step ends, never below the foot
  const base = { x: head.x, z: head.z, y: Math.max(foot.y, end.y - last[1]) };
  // never further forward than where the ladder lands: the Salty Kraken's mast ladders land 0.19 in
  // from the rungs, and the clip steps 0.33 forward - there the step is pressed into the room it has.
  // And drawn out up to STRETCH to reach a landing a little further in, rather than end short of it and
  // slide the rest over the planks at the climb's pace after standing up: the sloop's entry port lands
  // 0.43 in, where a body's footprint is first held up by her planks (the keeper, 13 Oct 2026).
  const ahead = (p) => (p.x - head.x) * ix + (p.z - head.z) * iz;
  const room = ahead(on[on.length - 1]);
  const press = last[0] > 0 && room > 0 && room < last[0] * STRETCH ? room / last[0] : last[0] > room && last[0] > 0 ? 0 : 1;
  const over = way.map(([f, u]) => ({ x: base.x + ix * f * press, z: base.z + iz * f * press, y: base.y + u }));
  // and on from where it ends, past what it has already come over
  const rest = on.filter((p, k) => k === on.length - 1 || ahead(p) > last[0] * press + 0.01);
  const path = [...lead, foot, base, ...over.slice(1), ...rest];
  const a = from ? pathLength([from, foot]) : 0;
  const b = a + pathLength([foot, base]);
  const at = [b];
  for (let k = 1; k < over.length; k++) at.push(at[k - 1] + pathLength([over[k - 1], over[k]]));
  return { path, len: pathLength(path), rungs: [a, b], top: { from: b, to: at[at.length - 1], at, seconds: step.seconds, points: over, dir: [ix, iz] } };
}

// Which way a climber faces at `d` on a way whose step over the top goes another way than they faced the
// rungs (`face`, a unit vector in the way's frame): up a mast's pins and out of a lubber's hole
// (shared/deck.mjs aloftPath with `hole`) the step is aside, since the mast is ahead. They turn towards it
// over the first TURN_ON_TOP of the step, so the clip steps the way the feet go; before it and on a way
// whose step goes the way they face, `face` itself.
const TURN_ON_TOP = 0.4;
export function facingOnWay(w, d, face) {
  const t = w && w.top;
  if (!t || !t.dir || d <= t.from) return face;
  const u = d >= t.to ? 1 : topAt(w, d);
  const k = Math.min(1, u / TURN_ON_TOP), s = k * k * (3 - 2 * k);
  const x = face[0] * (1 - s) + t.dir[0] * s, z = face[1] * (1 - s) + t.dir[1] * s;
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

// How far through the step over the top (0..1) somebody standing at `q` is, read off where they are
// and nothing else - which is all a page has of another player (peers.js, through walk.js ladderAt) -
// or null when they are not within `slack` of its way.
export function topNear(w, q, slack = 0.06) {
  const pts = w && w.top && w.top.points;
  if (!pts) return null;
  let best = slack, u = null;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l2 = dx * dx + dy * dy + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy + (q.z - a.z) * dz) / l2)) : 0;
    const d = Math.hypot(a.x + dx * t - q.x, a.y + dy * t - q.y, a.z + dz * t - q.z);
    if (d < best) { best = d; u = (k - 1 + t) / (pts.length - 1); }
  }
  return u;
}

// The same way, climbed down: walked backwards from its end (`from` is where the body stands at the
// top, and the way runs to it). Returned with the distances as they are on that path.
export function climbWayDown(rope, from = null) {
  const up = climbWay(rope, null);
  const path = from ? [...up.path, from] : up.path;
  return { ...up, path, len: pathLength(path) };
}

// How far through the step over the top (0..1, the clip's time) a distance `d` along the way is, or
// null off it.
export function topAt(w, d) {
  const t = w.top;
  if (!t || d < t.from || d > t.to) return null;
  const at = t.at;
  let k = 1;
  while (k < at.length - 1 && at[k] < d) k++;
  const span = at[k] - at[k - 1];
  return (k - 1 + (span > 0 ? (d - at[k - 1]) / span : 1)) / (at.length - 1);
}
function topDistance(w, u) {
  const at = w.top.at, n = at.length - 1;
  const x = Math.max(0, Math.min(1, u)) * n, k = Math.min(n - 1, Math.floor(x));
  return at[k] + (at[k + 1] - at[k]) * (x - k);
}

// One frame along the way: `wish` 1 up, -1 down, 0 hanging. On the rungs and the ground at either end
// at `speed` a second; on the step over the top by the clip's time, at `pace` of its own.
export function climbAlong(w, d, wish, dt, speed = CLIMB_SPEED, pace = topPace()) {
  if (!wish) return d;
  const t = w.top;
  const onTop = t && (wish > 0 ? d >= t.from && d < t.to : d > t.from && d <= t.to);
  if (onTop) {
    const u = topAt(w, d) + wish * pace * dt / t.seconds;
    return topDistance(w, u);
  }
  const next = d + wish * speed * dt;
  // not past the start of the step in one frame from below, nor its end from above
  if (t && wish > 0 && d < t.from && next > t.from) return t.from;
  if (t && wish < 0 && d > t.to && next < t.to) return t.to;
  return Math.max(0, Math.min(w.len, next));
}

// Where the body is on the way at `d`, and what the rig is to make of it: on the rungs (`rungs`), on
// the step over the top (`top`, 0..1), or neither (walking to the foot, or on from the top).
export function wayAt(w, d, out = { x: 0, y: 0, z: 0 }) {
  return pathAt(w.path, d, out);
}
export function onWay(w, d) {
  const top = topAt(w, d);
  if (top !== null) return { top };
  return d >= w.rungs[0] && d <= w.rungs[1] ? { top: null } : null;
}

// Up out of the water onto planks (walk.js climbOut, the keeper's 13 Oct 2026): Mixamo's Freehang Climb
// To Standing (gait-clips.js `climbOut`), by its time at HOIST_PACE of its own - 3.8 s at 1, a man worn
// out by a swim; 1.2 with the draw-in to the edge heaved the neck 0.063 in a frame, past
// tests/climb-out.test.mjs's 0.06 - along the
// way it measured the feet going (`way`, forward and up from where it starts). Its rise is fitted to the
// edge's height and whatever of the way forward it does not cover is shared out as it rises, so it ends
// exactly on `to`, the landing walk mode found. Where the feet are at `u` (0..1), from `from`: the clip
// hangs against the wall, so `from` is HANG_GAP short of the edge, and a swimmer who pressed Space further
// out (`start`) is drawn in to it over the first HOIST_REACH of the climb - or, measured, the body knelt
// on the air beside the planks, at their height, for a second.
export const HOIST_PACE = 1.1;
export const HANG_GAP = 0.08;
const HOIST_REACH = 0.25;
export function hoistAt(step, from, to, u, out = { x: 0, y: 0, z: 0 }, start = from) {
  const way = step.way, n = way.length - 1;
  const x = Math.max(0, Math.min(1, u)) * n, k = Math.min(n - 1, Math.floor(x)), t = x - k;
  const f = way[k][0] + (way[k + 1][0] - way[k][0]) * t, up = way[k][1] + (way[k + 1][1] - way[k][1]) * t;
  const [lastF, lastU] = way[n];
  const rise = to.y - from.y, s = lastU > 0 ? Math.max(0, Math.min(1, up / lastU)) : u;
  const dx = to.x - from.x, dz = to.z - from.z, run = Math.hypot(dx, dz) || 1;
  const along = f + (run - lastF) * s;
  out.x = from.x + dx / run * along;
  out.y = from.y + (lastU > 0 ? up * rise / lastU : rise * u);
  out.z = from.z + dz / run * along;
  const r = Math.max(0, Math.min(1, u / HOIST_REACH)), left = 1 - r * r * (3 - 2 * r);
  out.x += (start.x - from.x) * left;
  out.z += (start.z - from.z) * left;
  return out;
}

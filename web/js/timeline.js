// Where somebody else's thing is on this screen: drawn LAG_MS in the past, between the two
// samples we were last told about. Rendering slightly behind is what turns a stream of
// samples into somebody walking - or a boat sailing.
//
// One timeline for everything another machine moves, on purpose. The other people
// (peers.js) and the boats somebody else is steering (main.js `glideBoats`) are drawn from
// the same two numbers, because a pilot is drawn standing on their hull: a body and a hull
// on two different lags is a pilot left behind in the water, as far out as the boat goes in
// the difference (Plans/lopen-op-de-boot.md). Kept apart from peers.js so it can be tested:
// that file reaches walk.js, and walk.js cannot be loaded under Node.
import { lerpAngle } from 'shared/settlerwalk.mjs';

// How far behind the newest sample we draw. Two server ticks: enough to always have a
// pair to interpolate between, short enough that nobody feels remote.
export const LAG_MS = 120;
export const MAX_EXTRAPOLATE_MS = 200;

// How far along a -> b we are at `render` (a timestamp on this page's own clock, like the
// samples' `at`): 0..1 between them, and past the newest one a little further along the
// same line for up to MAX_EXTRAPOLATE_MS before holding. Better a step too far than a
// stutter every time a packet is late. Never below 0. `final` says b is where it stops -
// a boat let go of - and there is nothing to carry on towards.
export function progress(a, b, render, final = false) {
  const span = Math.max(1, b.at - a.at);
  let k = (render - a.at) / span;
  if (k > 1) k = final ? 1 : Math.min(1 + MAX_EXTRAPOLATE_MS / span, k);
  return Math.max(0, k);
}

// A position and a heading at `render`, written into `out`. The heading never extrapolates:
// carrying a turn on past the last sample is a hull swinging round and back every time a
// message is late.
export function sampleAt(a, b, render, out = {}, final = false) {
  const k = progress(a, b, render, final);
  out.x = a.x + (b.x - a.x) * k;
  out.z = a.z + (b.z - a.z) * k;
  out.yaw = lerpAngle(a.yaw, b.yaw, Math.min(1, k));
  return out;
}

// A track: the last few samples of one thing, oldest first, drawn in whichever stretch
// `render` falls in. Two samples are not enough once they arrive a beat apart and are drawn
// more than a beat late: the moment a new one comes in, `render` is still before the older
// of the pair, the drawing falls back to it and holds there - a hull that sails, stops for a
// fifth of a beat, and sails on, every beat. tests/timeline.test.mjs measured it at 0.19 at
// full speed. KEEP covers the lag with a beat to spare; only the newest stretch is ever
// carried on past its end, and not at all when the newest is `final`.
const KEEP = 4;
export function pushSample(track, s) {
  track.push(s);
  if (track.length > KEEP) track.splice(0, track.length - KEEP);
  return track;
}
export function trackAt(track, render, out = {}) {
  const n = track.length;
  if (n === 1) return sampleAt(track[0], track[0], render, out);
  let i = n - 2;
  while (i > 0 && track[i].at > render) i--;
  return sampleAt(track[i], track[i + 1], render, out, !!track[i + 1].final);
}

// How much the page draws, turned down while this machine cannot keep up and back up when it
// can. No DOM and no three.js, so it can be tested with a clock of its own (tests/quality.test.mjs);
// main.js hands it every frame and applies the rung it answers with.
//
// `modest` (main.js) is decided once, at boot, off the GPU's name - which knows desktop
// integrated graphics and nothing else, and says nothing about the island getting bigger, a
// second island coming into view or a laptop dropping to battery power. This watches the one
// thing that matters, the time from one frame to the next, and has three knobs to turn.
//
// The knobs are chosen for what they do NOT cost. Every one of them is a uniform or a number
// the next frame reads:
//   - `pixel`: the pixel ratio, as a fraction of the one the page booted with. The cheapest
//     cure for a GPU that is filling too many pixels, and a setSize, no shader.
//   - `shadowEvery`: redraw the shadow map every n-th frame. It is the whole scene drawn a
//     second time (render-stats.js counts it), and most of what casts a shadow stands still;
//     what moves - settlers, boats - has a shadow a frame or two behind it, at 30 frames a
//     second, which nobody sees from the sky.
//   - `imps`: a fraction of IMP_LIMIT, the volcano's skinned guards (imp.js), each a draw
//     call and a mixer of its own; the rest stay instanced figures, which is what they are
//     beyond the limit anyway.
// Deliberately not a knob:
//   - `renderer.shadowMap.enabled` or its type. Changing either recompiles every material on
//     the page - a stall of seconds on the machine that is already struggling, which is the
//     exact thing this is meant to prevent.
//   - DETAILED, the number of islands drawn whole (main.js). Raising or dropping one costs
//     about half a second of frame (islandsig.js); a governor that stutters to go faster is
//     worse than none.
//
// And not graphics-health.js either, which the plan this came from named: that file counts
// healthy frames to clear a context-loss retry and has nothing to do with speed.

// From full to lightest, one step at a time. `pixel` is a factor of the boot pixel ratio and
// the page never goes below MIN_PIXEL_RATIO whatever it says.
export const RUNGS = Object.freeze([
  Object.freeze({ name: 'full', pixel: 1, shadowEvery: 1, imps: 1 }),
  Object.freeze({ name: 'softer', pixel: 0.85, shadowEvery: 1, imps: 1 }),
  Object.freeze({ name: 'lighter', pixel: 0.85, shadowEvery: 2, imps: 0.75 }),
  Object.freeze({ name: 'light', pixel: 0.7, shadowEvery: 2, imps: 0.5 }),
  Object.freeze({ name: 'lightest', pixel: 0.6, shadowEvery: 3, imps: 0.375 }),
]);
export const MIN_PIXEL_RATIO = 0.6;

// Slower than this, a step down: 28 frames a second rather than 30, because a 30 Hz screen
// (or a browser holding a laptop at half rate) sits *on* 33.3 ms, and jitter round it would
// have it stepping down on a machine that is doing exactly what it is allowed to.
export const SLOW_MS = 1000 / 28;
// Faster than this, and for long enough, a step back up. Well clear of SLOW_MS: a rung that
// brought 30 frames to 36 is not room to spare, and stepping up from there comes straight back.
export const FAST_MS = 1000 / 50;
// How much time the judgement is made over, and how often it is made.
export const WINDOW_S = 4;
const JUDGE_S = 0.5;
// After a change: the old frames say nothing about the new rung, so the window starts over,
// and nothing is judged until the new one has run for this long.
export const SETTLE_S = 3;
// A step up waits this long on a fast window; a step up that had to be taken back doubles it
// (to MAX_UP_S), and one that holds halves it again. Without that memory a machine that is
// just fast enough for rung n but not n-1 would go up and down every twenty seconds for ever -
// a pixel ratio that changes is a visible jolt.
export const UP_AFTER_S = 20;
export const MAX_UP_S = 320;
// A frame longer than GAP_MS counts as GAP_MS. A one-off stall - an island being raised, a
// shader compiling - is then one long sample among a few hundred, which the median does not
// notice; a machine that takes that long for every frame is still the slowest there is, and
// gets stepped down. Dropping them instead, as the first version did, left a machine at two
// frames a second (measured, SwiftShader) on the full rung for ever. Longer than PAUSE_MS is
// no frame at all - a breakpoint, a laptop lid, a tab the browser stopped without saying it
// was hidden - and is left out.
const GAP_MS = 250;
const PAUSE_MS = 5000;
// The first seconds after `start` are shaders compiling and textures uploading.
export const GRACE_S = 8;

export function createQualityGovernor({ rungs = RUNGS, level = 0, auto = true } = {}) {
  let current = Math.max(0, Math.min(rungs.length - 1, level));
  let on = auto;
  let lastAt = null;
  let graceLeft = GRACE_S * 1000;
  // The window: frame intervals, oldest first, and their sum.
  let samples = [];
  let sum = 0;
  let sinceChange = 0, sinceJudge = 0;
  // How long every judgement has found the window fast, without a break. Not the time since
  // the last change: a page that sat on the lightest rung for an hour, slow all along, has
  // earned nothing by it when it turns fast.
  let fastFor = 0;
  let upHold = UP_AFTER_S * 1000;
  // Set when we stepped up, until that step has held for upHold (or been taken back).
  let tryingUp = null;

  const median = () => {
    const s = samples.slice().sort((a, b) => a - b);
    return s[s.length >> 1];
  };
  const reset = () => { samples = []; sum = 0; sinceChange = 0; sinceJudge = 0; fastFor = 0; };
  const go = (to) => { current = to; reset(); return rungs[current]; };

  return {
    rung: () => rungs[current],
    level: () => current,
    auto: () => on,
    // Stop or start judging. Off puts the page back on its best rung: "automatic" off means
    // "what this machine was given at boot", not "wherever it happened to be".
    setAuto(v) {
      on = !!v;
      tryingUp = null; upHold = UP_AFTER_S * 1000;
      if (!on && current !== 0) return go(0);
      reset();
      return null;
    },
    // Pin a rung by hand (?quality=n): judging stops.
    pin(to) {
      on = false;
      return go(Math.max(0, Math.min(rungs.length - 1, to | 0)));
    },
    // Every frame, with the frame's timestamp and whether the page is on screen. Returns the
    // new rung when it changed, null otherwise.
    frame(now, visible = true) {
      if (!visible) { lastAt = null; return null; }
      const raw = lastAt === null ? null : now - lastAt;
      lastAt = now;
      if (raw === null || !(raw > 0) || raw > PAUSE_MS) return null;
      const dt = Math.min(raw, GAP_MS);
      if (graceLeft > 0) { graceLeft -= dt; return null; }
      if (!on) return null;

      samples.push(dt); sum += dt;
      while (sum - samples[0] >= WINDOW_S * 1000) sum -= samples.shift();
      sinceChange += dt; sinceJudge += dt;
      if (tryingUp !== null && sinceChange >= upHold) {
        // The step up held: next time, try sooner.
        upHold = Math.max(UP_AFTER_S * 1000, upHold / 2);
        tryingUp = null;
      }
      if (sinceJudge < JUDGE_S * 1000) return null;
      const judged = sinceJudge;
      sinceJudge = 0;
      if (sinceChange < SETTLE_S * 1000 || sum < WINDOW_S * 1000 * 0.9) return null;

      const m = median();
      fastFor = m < FAST_MS ? fastFor + judged : 0;
      if (m > SLOW_MS && current < rungs.length - 1) {
        if (tryingUp !== null) { upHold = Math.min(MAX_UP_S * 1000, upHold * 2); tryingUp = null; }
        return go(current + 1);
      }
      if (current > 0 && fastFor >= upHold) {
        tryingUp = current - 1;
        return go(current - 1);
      }
      return null;
    },
  };
}

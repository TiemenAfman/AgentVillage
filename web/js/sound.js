// What the island sounds like: a bed of sea and wind under it, and a handful of things
// you can walk up to.
//
// Three rules shaped every decision in here, and they are worth stating before the code.
//
// **Nothing is fetched, ever.** Not at boot - that is the invariant in CLAUDE.md, and the
// boot screen stuck on "Charting the island…" is a failure this project has already had -
// and not after the switch either, because a sound file is a licence question and a binary
// blob in a repository that has neither. So every noise below is computed from a random
// number generator and an envelope, once, into an AudioBuffer. The whole set is 2.3 MB of
// Float32 and cost one 38 ms frame to make on this machine - which is why it is made on the
// click and not on the way in. Nothing is on disk and nothing is on the wire.
//
// **Nothing exists before a gesture.** `new THREE.AudioListener()` calls three.js's
// `AudioContext.getContext()`, which builds the one global AudioContext on the spot - and
// a browser that refuses autoplay gives you a suspended context and a console warning for
// your trouble. So this module is inert until `setOn(true)`, and the only two things that
// call it are the Sound chip (a click, which is a gesture) and, for somebody who left it on
// last time, the first pointerdown or keydown of the session. Before that there is no
// context, no listener, no buffer and no node: `stats()` says so, and that is checkable
// from the console.
//
// **A village of three hundred is not three hundred sources.** Every voice in here is
// allocated once, at build time, and nothing ever allocates a second one: a pool per family
// (four hammers, four workers, two gulls, two bells, four animals...) whose lengths are the
// ceiling `stats().cap` adds up, whatever the population (Plans/meer-geluiden.md). Which four
// hammers is decided by `nearestFirst` from shared/regions.mjs, with its load-bearing
// tiebreak, rather than a sort of its own. Only the first six buffers are made at the click;
// every other family is made the first time something of it is within reach (`need`).
//
// And two rules for what reaches this module. It is told everything through one snapshot
// (main.js soundSnapshot) and never called by a drawing module: what it must hear the moment it
// is seen is a **cue** that module keeps anyway - a counter (the smith's `hits`, the fisherman's
// `bites`, the bubbles' `emitted`), a word (the baker's `phase`, an animal's act, the wagon's
// stage) or the sea's clock - and this module diffs it against what it saw last pick. And every
// voice sits on a part and every part on a bus (sound-mix.js, Settings -> Audio).
//
// A fourth rule, softer, about taste: quiet and sparse beats busy. A gull cries once every
// half minute or so and only in daylight over the quay; the tavern only hums when there is
// somebody at the tables. If you are unsure whether you can hear it, that is roughly right.
import * as THREE from 'three';
import { nearestFirst } from 'shared/regions.mjs';
import { makeRng, clamp } from 'shared/rng.mjs';
import { MIX_BUSES, MIX_PARTS, busOf, clampMix, loadMix, saveMix } from './sound-mix.js';
import { createGreeter, PHRASES } from './greetings.js';

// Remembered per browser, like the avatar and the chat mode: which of them is a setting
// of the *island* is decided by whether it lives in config.json, and how loud somebody
// else's speakers are is nobody's business but theirs.
const KEY = 'promptholm.sound';

// How often the placed voices are re-decided: who is hammering, where the nearest quay is,
// how many are at the tables. Six times a second is far more often than any of those
// change and still walks the crowd a tenth as often as the frame loop does.
const PICK_S = 1 / 6;

// The hard ceilings. These are array lengths, not budgets to be checked: the pools are
// built once at this size and there is no code path that grows one.
const HAMMERS = 4;
const GULLS = 2;

// Past these a voice is not placed at all, so a village that stretches across the grid
// costs nothing for the half of it you are nowhere near. Measured in island units; the
// grid is 64 across, so 70 is "anywhere on this island" and no further.
const HAMMER_RANGE = 70;
const GULL_RANGE = 75;
const TAVERN_RANGE = 35;
const BORREL_RANGE = 70;

// A tavern heard from outside is heard through its door (Plans/meer-geluiden.md): its source hangs
// at the door, and a lowpass on it is open to PUB_OPEN at the threshold and shut to PUB_SHUT a few
// steps along the wall - the distance to the door is the whole of the occlusion, no raycast.
const PUB_OPEN = 1200;
const PUB_SHUT = 600;
const PUB_OPEN_R = 5;
// The Salty Kraken always has its crew in (Plans/piratenkroeg.md), so it hums even when nobody
// from the village is at its door; this much of a full house.
const KRAKEN_CREW = 0.35;
// Glasses: two pooled voices out of doors, one inside, and a clink every few seconds where it is
// busy - the gap shrinks with the crowd.
const CLINKS = 2;
const BELLS = 2;
// The crafts (phase 4): four one-shots for the workshops (anvil, cleaver, oven), four for the crowd
// at work beside the four hammers (axe, hoe, weeds, barrow, bars), and one loop for the sawmill's
// blade. Past these a workshop is not heard at all.
const CRAFTS = 4;
const WORKERS = 4;
const CRAFT_RANGE = 55;
const WORK_RANGE = 45;
const SAW_RANGE = 45;
// What each word in the crowd sounds like, and how often it is heard while somebody keeps at it.
// The crowd's own tempo is drawn in settler-figures.js off a private clock, so as with the hammer
// it is the tempo that is matched, not the phase.
const WORK_SOUNDS = {
  chop: { buf: 'chop', every: 1.15, volume: 0.5 },
  hoe: { buf: 'hoe', every: 1.35, volume: 0.4 },
  weed: { buf: 'weed', every: 1.7, volume: 0.35 },
  load: { buf: 'load', every: 0.9, volume: 0.4 },
  barrow: { buf: 'squeak', every: 0.75, volume: 0.3 },
  carry: { buf: 'squeak', every: 0.85, volume: 0.35 },
};
// The hour and the weather (phase 5): how loud each bed is at its fullest, and how often the three
// rare birds call. The bed's own loudness comes from where you are (inland, in the woods, by the
// sea) and the hour, all glided over seconds like the sea.
const DAWN_LOUD = 0.11;
const CRICKETS_LOUD = 0.07;
const RAIN_LOUD = 0.2;
const ROOFS_LOUD = 0.16;
const OWL_GAP = [70, 200];
const CUCKOO_GAP = [50, 140];
const FOGHORN_GAP = [40, 90];
const HORN_RANGE = 260;
// The animals (phase 6): four voices, nearest first, and never two calls in ANIMAL_GAP on the island.
const ANIMALS = 4;
const ANIMAL_RANGE = 40;
const ANIMAL_GAP = 2.5;
// Water and fire (phase 7): how far each is heard, and how loud.
const RIVER_RANGE = 30;
const LAVA_RANGE = 40;
const RUMBLE_RANGE = 320;
const RUMBLE_LOUD = 0.22;
const UNDER_LOUD = 0.16;
// What is left of the beds from above the water at the bottom of a dive.
const OVER_DEEP = 0.25;
// The rounds (phase 8): three one-shots and the wheels' loop, heard within ROUND_RANGE.
const ROUNDERS = 3;
const ROUND_RANGE = 45;
// A walking horse sets a hoof down about twice a second (timberrun.js's HORSE_SPEED is a walk).
const HOOF_EVERY = 0.48;
// The float lands this long after the strike (fisher.js casts again 0.9 s after it).
const PLOP_AFTER = 1.15;
// Two voices for the greetings (web/js/greetings.js decides who and when): the island never says
// hello more than twice at once.
const GREETERS = 2;
const CLINK_GAP = [3, 14];

// The church bell (Plans/meer-geluiden.md, "De kerkklok"): heard over the whole island, and on the
// sea's clock, so every page strikes at the same moment. Two voices, struck in turn, because a bell
// rings for four seconds and the next stroke comes after BELL_EVERY: one voice restarted would cut
// every stroke's tail off. Quiet from BELL_QUIET[0] until BELL_QUIET[1] (open question 8).
const BELL_RANGE = 320;
const BELL_EVERY = 2.4;
const BELL_QUIET = [23, 7];
// A step of the clock bigger than this is not an hour passing but a tab waking up or another sea:
// nothing is struck for it.
const BELL_SKIP_MIN = 15;

// How fast a settler hammers. settler-figures.js swings the arm and the hammer off
// `Math.sin(time * 8 + f.phase)`, so a blow lands once per 2*pi/8 seconds, and `f.phase`
// is on the figure where this can read it. What cannot be read is that file's own `time`,
// which starts when the crowd view is built and is private to it - so the taps here are
// the same tempo as the swing and share its per-settler offset, but the two are not phase
// locked. At any distance you would actually hear one from, tempo is what the ear checks.
const HAMMER_HZ = 8 / (2 * Math.PI);

// A gull every half minute or so, jittered, and never two in the same breath. Sparse on
// purpose: a gull is the one sound here that is recognisably *a thing* rather than
// texture, and a recognisable thing on a timer becomes a tic within a minute.
const GULL_GAP = [17, 48];

// The bed, in master-volume terms. The sea at the water's edge is the loudest thing on the
// island and it is still under a quarter of the range - everything else has to fit over it.
// It was 0.26, with waves every 10 s and wind at 0.085: far too loud and too busy on the live
// island (the keeper, 3 October 2026), so the bed is roughly halved and its loops are longer.
const SEA_LOUD = 0.12;
// The same sea from the middle of the island: next to nothing. It was 0.05, which with every
// river, lake and harbour channel counted as sea put surf in the middle of Hoogezand (the keeper,
// 2 October 2026).
const SEA_QUIET = 0.006;
// What counts as sea to the ears: water that is wide, not merely wet. Depth cannot tell them apart -
// a river's bed (RIVER_BED) and the dredged harbour (CHANNEL_H) are both -0.55 - but width can: a
// wet probe is sea only if there is water SEA_WIDE off it on at least three of its four sides,
// which a river two units across or a lake of radius four never has.
const SEA_WIDE = 5;
const WIND_LOUD = 0.045;         // inland, in the open
const WIND_QUIET = 0.02;         // down at the water, where the surf covers it

// How much of the whole thing is left after dark. Not silence: an island at night is the
// sea and the wind and nothing else, which is most of what is here anyway.
const NIGHT_DUCK = 0.55;
// And indoors, where the bed is coming through a wall.
const INDOOR_DUCK = 0.22;

// --------------------------------------------------------------- the synthesiser
//
// Everything below runs once, into a buffer, and never again. So it is written for
// legibility rather than speed: plain loops over Float32Arrays, one-pole filters where a
// slow-moving band is wanted and a biquad where a resonance is. None of it is in shared/,
// so sin, cos, exp and pow are all allowed - a noise that differs in the last bit between
// two machines is not a noise anybody can hear.

// The bed does not need a full sample rate: nothing in surf or wind lives above 5 kHz, and
// an AudioBufferSourceNode resamples whatever it is handed. At 11 kHz a ten-second stereo
// loop is 880 kB of Float32 instead of 3.5 MB, and the difference is above the top of
// anything in it.
const BED_SR = 11025;
// The placed voices do have edges in them - a hammer's tick is broadband - so they get
// twice that. Still half of CD, and they are all under a second and a half.
const HIT_SR = 22050;

function noise(n, rng) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = rng.next() * 2 - 1;
  return a;
}

// One-pole lowpass. `cut` is either a number of Hz or a function of the sample index, so
// a band can wander across the buffer without recomputing biquad coefficients per sample.
function lowpass(src, sr, cut) {
  const out = new Float32Array(src.length);
  const moving = typeof cut === 'function';
  const fixed = moving ? 0 : 1 - Math.exp(-2 * Math.PI * cut / sr);
  let y = 0;
  for (let i = 0; i < src.length; i++) {
    const a = moving ? 1 - Math.exp(-2 * Math.PI * cut(i) / sr) : fixed;
    y += a * (src[i] - y);
    out[i] = y;
  }
  return out;
}

// And its complement, which is all a highpass has to be here.
function highpass(src, sr, cut) {
  const lp = lowpass(src, sr, cut);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] - lp[i];
  return out;
}

// A resonant band-pass (the RBJ cookbook one, constant peak gain). This is what turns
// white noise into something with a pitch to it: the formant on a gull's cry and the ring
// of a hammer's tick are both this and nothing else.
function resonate(src, sr, freq, q) {
  const w = 2 * Math.PI * freq / sr;
  const alpha = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0;
  const a1 = (-2 * cw) / a0, a2 = (1 - alpha) / a0;
  const out = new Float32Array(src.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

// Fold the tail of a rendered channel back over its head, so the buffer can be looped
// without a click at the seam. Noise crossfaded with noise is inaudible; an *envelope*
// that does not line up is very audible indeed, which is why every swell and every gust
// below has a period that divides the final loop length exactly. Render `len + fade`
// samples, fold, keep `len`.
function seam(ch, len, fade) {
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    ch[i] = ch[i] * t + ch[len + i] * (1 - t);
  }
  return ch.subarray(0, len);
}

// Bring a finished channel to a known loudness. By RMS rather than by peak: noise has the
// occasional lone spike, and normalising to it leaves the other ten seconds too quiet.
function level(chs, target) {
  let sum = 0, n = 0, peak = 0;
  for (const ch of chs) {
    for (let i = 0; i < ch.length; i++) {
      sum += ch[i] * ch[i];
      if (Math.abs(ch[i]) > peak) peak = Math.abs(ch[i]);
    }
    n += ch.length;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  if (!(rms > 0) || !(peak > 0)) return;
  // To the loudness asked for, and then backed off if the loudest moment in it would clip.
  // Scaled rather than clamped: a clamp flattens the tip of a transient, and the one voice
  // in here with a real transient is the hammer, whose tip is the whole sound.
  const g = Math.min(target / rms, 0.96 / peak);
  for (const ch of chs) for (let i = 0; i < ch.length; i++) ch[i] *= g;
}

function intoBuffer(ctx, chs, sr) {
  const buf = ctx.createBuffer(chs.length, chs[0].length, sr);
  for (let c = 0; c < chs.length; c++) buf.copyToChannel(chs[c], c);
  return buf;
}

// --- the sea ---------------------------------------------------------------
//
// A wave is a low rumble that is always there and a wash of hiss that only arrives at the
// top of it, and the reason a real coastline does not sound like a fan is that the waves
// do not arrive on a beat. So the swell is three sines whose periods are the loop, a third
// of it and a seventh - all whole fractions, so the loop is seamless, and mutually prime,
// so within one turn of it no two crests land together twice.
function surfBuffer(ctx, secs = 18) {
  const sr = BED_SR;
  const len = Math.floor(sr * secs);
  const fade = Math.floor(sr * 0.8);
  const n = len + fade;
  const swell = (t) => 0.5 + 0.5 * (
    0.55 * Math.sin(2 * Math.PI * t / secs)
    + 0.30 * Math.sin(2 * Math.PI * t * 3 / secs + 1.7)
    + 0.15 * Math.sin(2 * Math.PI * t * 7 / secs + 4.1));
  const chs = [];
  for (let c = 0; c < 2; c++) {
    // A seed per channel, so the two are decorrelated and the bed has width. The same
    // envelope on both, so a wave still breaks at the same moment in each ear.
    const rng = makeRng(`surf:${c}`);
    const w = noise(n, rng);
    const body = lowpass(lowpass(w, sr, 300), sr, 300);
    const wash = highpass(lowpass(noise(n, rng), sr, 2600), sr, 900);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const e = swell(i / sr);
      // The hiss is cubed: it is the top of the wave and nothing else, and a linear
      // envelope on it leaves a permanent sizzle under the rumble that reads as tape.
      out[i] = body[i] * (0.30 + 0.70 * e) * 7 + wash[i] * (e * e * e) * 1.4;
    }
    chs.push(seam(out, len, fade));
  }
  level(chs, 0.2);
  return intoBuffer(ctx, chs, sr);
}

// --- the wind --------------------------------------------------------------
//
// Inland it is what you hear instead of the sea. A band of noise whose centre rises with
// the gust, because a stronger gust through the same grass is a brighter one - a fixed
// band with a moving gain is the sound of somebody turning a volume knob.
function windBuffer(ctx, secs = 20) {
  const sr = BED_SR;
  const len = Math.floor(sr * secs);
  const fade = Math.floor(sr * 0.8);
  const n = len + fade;
  const gust = (t) => 0.5 + 0.5 * (
    0.60 * Math.sin(2 * Math.PI * t / secs + 0.4)
    + 0.25 * Math.sin(2 * Math.PI * t * 2 / secs + 2.2)
    + 0.15 * Math.sin(2 * Math.PI * t * 5 / secs + 5.0));
  const chs = [];
  for (let c = 0; c < 2; c++) {
    const rng = makeRng(`wind:${c}`);
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) g[i] = gust(i / sr);
    const band = highpass(lowpass(noise(n, rng), sr, (i) => 420 + 900 * g[i]), sr, 240);
    const leaves = highpass(lowpass(noise(n, rng), sr, 4200), sr, 2100);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = band[i] * (0.25 + 0.75 * g[i]) * 4 + leaves[i] * g[i] * g[i] * 0.5;
    chs.push(seam(out, len, fade));
  }
  level(chs, 0.16);
  return intoBuffer(ctx, chs, sr);
}

// --- the tavern ------------------------------------------------------------
//
// Five people talking at once, heard through a wall. Each voice is a band of noise around
// its own pitch, gated into syllables; what makes it a murmur rather than five radios is
// that no two syllable rates are the same and about a third of the syllables are missed
// out. Mono, because it is a positional source and a stereo buffer would go round the
// panner rather than through it.
//
// The same machinery makes three rooms' worth (Plans/meer-geluiden.md, "De kroegen buiten"): the
// village tavern, the Salty Kraken - lower, rougher, a growl now and then and boots on the boards -
// and the borrel on the square, more voices and brighter, out in the open. The wall is no longer
// baked in: a tavern's murmur is heard whole inside, so what muffles it outside is a filter on the
// source that opens towards the door (steerPubs). What is baked is the top above `top` Hz, which
// even a room you are standing in does not give you over five people talking.
const MURMURS = {
  // Syllables per loop rather than per second, so every voice's gating is periodic in the
  // loop and the seam has nothing to hide. 19..29 over six seconds is 3.2 to 4.8 a second,
  // which is about the rate of speech you cannot make out the words of.
  village: { secs: 6, rates: [19, 21, 23, 26, 29], base: 230, step: 95, q: 2.2, top: 2200, laughs: 1, level: 0.14 },
  kraken: { secs: 7, rates: [17, 19, 22, 25, 27, 31], base: 165, step: 70, q: 1.6, top: 1700, laughs: 2, growls: 3, stamps: 9, level: 0.15 },
  borrel: { secs: 8, rates: [21, 23, 25, 27, 29, 33, 35, 37], base: 220, step: 60, q: 2.4, top: 3200, laughs: 3, level: 0.13 },
};
function* murmurSong(ctx, kind = 'village') {
  const o = MURMURS[kind];
  const sr = BED_SR, secs = o.secs;
  const len = Math.floor(sr * secs);
  const fade = Math.floor(sr * 0.5);
  const n = len + fade;
  const out = new Float32Array(n);
  // The village keeps the seeds it always had, so its murmur is the one the island already had.
  const seed = (v) => (kind === 'village' ? `murmur:${v}` : `murmur:${kind}:${v}`);
  for (let v = 0; v < o.rates.length; v++) {
    const rng = makeRng(seed(v));
    const k = o.rates[v];
    const f = o.base + v * o.step + rng.range(-25, 25);
    const band = resonate(noise(n, rng), sr, f, o.q);
    // Which syllables this voice actually says. One array of `k`, so cycle c and cycle
    // c + k say the same thing and the loop closes.
    const said = [];
    for (let i = 0; i < k; i++) said.push(rng.next() > 0.36);
    const phase = rng.next();
    for (let i = 0; i < n; i++) {
      const p = (i / sr) * (k / secs) + phase;
      const cycle = Math.floor(p);
      if (!said[((cycle % k) + k) % k]) continue;
      // A syllable is a bump, not a gate: a square edge on a band of noise is a click.
      const s = p - cycle;
      out[i] += band[i] * Math.pow(Math.sin(Math.PI * s), 1.6) * 0.9;
    }
    yield;
  }
  // What makes a room of people a room rather than a recording of one: now and then somebody
  // laughs - five quick "ha"s, falling - and in the Kraken somebody growls and somebody stamps.
  // Each written well inside the loop, clear of the fold at its seam, so the loop still closes.
  const rng = makeRng(`murmur:${kind}:room`);
  const inside = (dur) => Math.floor(fade + rng.next() * (len - fade - dur * sr));
  for (let l = 0; l < (o.laughs || 0); l++) {
    const at = inside(0.9), f0 = 480 + rng.range(-60, 90);
    const buzz = resonate(noise(Math.floor(0.9 * sr), rng), sr, f0, 3);
    for (let h = 0; h < 5; h++) {
      const a0 = Math.floor(h * 0.14 * sr), L = Math.floor(0.1 * sr);
      for (let i = 0; i < L; i++) out[at + a0 + i] += buzz[a0 + i] * Math.sin(Math.PI * i / L) * (1 - h * 0.13) * 1.6;
    }
  }
  for (let g = 0; g < (o.growls || 0); g++) {
    // "Arr": a low voice with its formant sliding down, half a second.
    const at = inside(0.6), L = Math.floor(0.55 * sr);
    const raw = noise(L, rng);
    for (let i = 0; i < L; i++) raw[i] *= Math.pow(Math.sin(Math.PI * i / L), 0.8);
    const sweep = lowpass(raw, sr, (i) => 900 - 500 * (i / L));
    const body = resonate(sweep, sr, 140 + rng.range(-15, 15), 4);
    for (let i = 0; i < L; i++) out[at + i] += (body[i] * 2.4 + sweep[i] * 0.6);
  }
  for (let s = 0; s < (o.stamps || 0); s++) {
    const at = inside(0.1), L = Math.floor(0.09 * sr);
    let ph = 0;
    for (let i = 0; i < L; i++) {
      const t = i / sr;
      ph += (45 + 25 * Math.exp(-t / 0.02)) / sr;
      out[at + i] += Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.03) * 0.5;
    }
  }
  yield;
  const chs = [seam(lowpass(out, sr, o.top), len, fade)];
  level(chs, o.level);
  return intoBuffer(ctx, chs, sr);
}
// The village's, at build() like the rest of the first set: run straight through.
function murmurBuffer(ctx) {
  const gen = murmurSong(ctx, 'village');
  for (;;) { const r = gen.next(); if (r.done) return r.value; }
}

// --- the church bell -------------------------------------------------------
//
// A bell is not a note: its partials are not harmonics, and each dies at its own rate - the hum an
// octave under, the prime, a minor third over it (the tierce, which is what makes a bell sound like
// a bell and not a glass), the fifth, the nominal an octave up, and a few higher ones that are gone
// in half a second. Each partial is a close pair a hair apart, so it beats slowly as it rings, and
// the clapper's knock is a few milliseconds of noise at the top. A village bell, not a cathedral's:
// the prime at 330 Hz. Made the first time the chapel is within reach of the clock, a partial a step.
const BELL_PARTIALS = [
  // ratio, level, seconds to die by e
  [0.5, 0.45, 3.4], [1, 1, 2.6], [1.19, 0.62, 2.0], [1.5, 0.32, 1.5],
  [2, 0.7, 1.5], [2.51, 0.3, 0.9], [2.99, 0.22, 0.7], [4.17, 0.16, 0.45],
];
function* bellSong(ctx) {
  const sr = HIT_SR;
  const n = Math.floor(sr * 4);
  const out = new Float32Array(n);
  const f0 = 330;
  for (const [ratio, amp, decay] of BELL_PARTIALS) {
    const f = f0 * ratio, beat = 0.6 + ratio * 0.35;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const e = Math.exp(-t / decay) * Math.min(1, t / 0.002);
      out[i] += amp * e * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * (f + beat) * t));
    }
    yield;
  }
  const rng = makeRng('bell');
  const knock = resonate(noise(Math.floor(sr * 0.03), rng), sr, 2600, 3);
  for (let i = 0; i < knock.length; i++) out[i] += knock[i] * Math.exp(-i / sr / 0.006) * 1.5;
  // The last tenth of a second to nothing, so the buffer ends in silence of its own.
  const tail = Math.floor(sr * 0.1);
  for (let i = 0; i < tail; i++) out[n - tail + i] *= 1 - (i + 1) / tail;
  const chs = [out];
  level(chs, 0.12);
  return intoBuffer(ctx, chs, sr);
}

// --- a greeting ------------------------------------------------------------
//
// Hello in no language at all (Plans/meer-geluiden.md, "Begroeting op straat"): a few syllables of a
// voice, each a pulse train at its pitch through the two formants of a vowel, with a tune that
// rises and falls like "hal-lo". Animal Crossing rather than a robot: the pitch moves within every
// syllable, the vowels change, and a breath of noise rides on top. Each settler plays it at their
// own rate (greetings.js voiceOf), so the same three phrases are a village of voices.
const VOWELS = { a: [780, 1200], o: [460, 820], e: [480, 1850], i: [300, 2250], u: [340, 720] };
const GREETINGS = [
  // [seconds, pitch at the start, pitch at the end, vowel] per syllable: "hal-lo", "mor-gen", "hoi-hoi"
  [[0.11, 230, 275, 'a'], [0.17, 270, 205, 'o']],
  [[0.12, 250, 260, 'o'], [0.14, 245, 210, 'e']],
  [[0.09, 260, 290, 'o'], [0.06, 280, 300, 'i'], [0.15, 300, 220, 'o'], [0.06, 230, 240, 'i']],
];
function* greetSong(ctx, which) {
  const sr = HIT_SR;
  const sylls = GREETINGS[which % GREETINGS.length];
  const gap = 0.035;
  const n = Math.floor(sr * (sylls.reduce((a, s) => a + s[0] + gap, 0) + 0.05));
  const raw = new Float32Array(n);
  const rng = makeRng(`greet:${which}`);
  const out = new Float32Array(n);
  let i0 = Math.floor(sr * 0.01), ph = 0;
  for (const [dur, p0, p1, v] of sylls) {
    const L = Math.floor(dur * sr);
    for (let i = 0; i < L; i++) {
      const k = i / L;
      ph += (p0 + (p1 - p0) * k) / sr;
      // A glottal pulse: a saw's falling edge, softened - the buzz a formant has to shape.
      const saw = 2 * (ph - Math.floor(ph)) - 1;
      raw[i0 + i] = (saw * 0.8 + (rng.next() * 2 - 1) * 0.12) * Math.pow(Math.sin(Math.PI * k), 0.7);
    }
    const [f1, f2] = VOWELS[v];
    const seg = raw.subarray(i0, i0 + L);
    const a = resonate(seg, sr, f1, 5), b = resonate(seg, sr, f2, 7);
    for (let i = 0; i < L; i++) out[i0 + i] = a[i] * 1.2 + b[i] * 0.8 + seg[i] * 0.08;
    i0 += L + Math.floor(gap * sr);
  }
  yield;
  const chs = [lowpass(out, sr, 4200)];
  level(chs, 0.09);
  return intoBuffer(ctx, chs, sr);
}

// --- the crafts -------------------------------------------------------------
//
// The workshops and the work (Plans/meer-geluiden.md, phase 4): the smith's anvil, the butcher's
// cleaver, the baker's oven door and the loaf set down, and in the crowd an axe in wood, a hoe in
// the soil, weeds pulled, a barrow's wheel and gold bars going into it. Each a one-shot of a few
// tenths of a second, made the first time anything of the kind is within earshot. And the
// sawmill's blade, the one loop: it always turns, and is harder and higher while a log is on it.
function shot(ctx, secs, seed, fn, gain) {
  const sr = HIT_SR;
  const n = Math.floor(sr * secs);
  const rng = makeRng(`craft:${seed}`);
  const out = fn(n, sr, rng);
  // A millisecond in and the last twentieth out, so no shot starts or stops on a step.
  const tail = Math.floor(n / 20);
  for (let i = 0; i < n; i++) {
    out[i] *= Math.min(1, i / (sr * 0.001));
    if (i > n - tail) out[i] *= (n - i) / tail;
  }
  const chs = [out];
  level(chs, gain);
  return intoBuffer(ctx, chs, sr);
}
const ring = (n, sr, parts) => {
  const out = new Float32Array(n);
  for (const [f, a, d] of parts) for (let i = 0; i < n; i++) out[i] += a * Math.exp(-i / sr / d) * Math.sin(2 * Math.PI * f * i / sr);
  return out;
};
const burst = (n, sr, rng, f, q, d, a = 1) => {
  const r = resonate(noise(n, rng), sr, f, q);
  for (let i = 0; i < n; i++) r[i] *= a * Math.exp(-i / sr / d);
  return r;
};
const add = (a, b) => { for (let i = 0; i < a.length; i++) a[i] += b[i]; return a; };
const CRAFT_SHOTS = {
  // Steel on steel: the anvil's inharmonic ring over the tick of the hammer face.
  anvil: (c) => shot(c, 0.8, 'anvil', (n, sr, rng) => add(ring(n, sr, [[820, 1, 0.5], [2263, 0.6, 0.3], [4428, 0.35, 0.16], [7323, 0.2, 0.08]]),
    burst(n, sr, rng, 4200, 1.5, 0.005, 2)), 0.1),
  // A cleaver through meat into the block: a wet thwack and the wood under it.
  cleaver: (c) => shot(c, 0.3, 'cleaver', (n, sr, rng) => add(burst(n, sr, rng, 360, 1.4, 0.04, 2), ring(n, sr, [[180, 0.7, 0.06], [310, 0.3, 0.035]])), 0.1),
  // The oven's iron door: a low knock, the ring of the plate, and the creak of the hinge before it.
  oven: (c) => shot(c, 0.6, 'oven', (n, sr, rng) => {
    const out = add(ring(n, sr, [[92, 0.8, 0.1], [410, 0.35, 0.22], [633, 0.2, 0.15]]), burst(n, sr, rng, 900, 2, 0.05, 0.4));
    let ph = 0;
    for (let i = 0; i < Math.floor(sr * 0.14); i++) { ph += (150 - 40 * i / (sr * 0.14)) / sr; out[i] += 0.15 * (2 * (ph - Math.floor(ph)) - 1) * Math.sin(Math.PI * i / (sr * 0.14)); }
    return out;
  }, 0.08),
  // A loaf set down on the board.
  thud: (c) => shot(c, 0.25, 'thud', (n, sr, rng) => add(ring(n, sr, [[120, 1, 0.06]]), lowpass(burst(n, sr, rng, 500, 1, 0.03, 1), sr, 900)), 0.06),
  // An axe into a log: the crack of the edge and the knock of the wood.
  chop: (c) => shot(c, 0.35, 'chop', (n, sr, rng) => add(burst(n, sr, rng, 1800, 2, 0.008, 2.5), ring(n, sr, [[230, 0.8, 0.05], [410, 0.4, 0.03]])), 0.1),
  // A hoe through the soil: a scrape, with a stone ticked at the start.
  hoe: (c) => shot(c, 0.3, 'hoe', (n, sr, rng) => {
    const scrape = burst(n, sr, rng, 1400, 1.2, 0.12, 1);
    for (let i = 0; i < n; i++) scrape[i] *= Math.min(1, i / (sr * 0.02));
    return add(scrape, burst(n, sr, rng, 3200, 4, 0.006, 0.8));
  }, 0.05),
  // Weeds pulled: three quick rustles.
  weed: (c) => shot(c, 0.35, 'weed', (n, sr, rng) => {
    const hiss = lowpass(highpass(noise(n, rng), sr, 2500), sr, 7000);
    for (let i = 0; i < n; i++) { const t = i / sr; const k = (t % 0.11) / 0.11; hiss[i] *= Math.sin(Math.PI * k) * (t < 0.33 ? 1 : 0); }
    return hiss;
  }, 0.04),
  // A barrow's wheel wanting oil: a short rising-and-falling squeak.
  squeak: (c) => shot(c, 0.18, 'squeak', (n, sr) => {
    const out = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      ph += (1700 + 600 * Math.sin(Math.PI * k) + 40 * Math.sin(2 * Math.PI * 31 * i / sr)) / sr;
      out[i] = (Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(4 * Math.PI * ph)) * Math.sin(Math.PI * k);
    }
    return out;
  }, 0.035),
  // Gold bars going into the barrow: two dull tinks.
  load: (c) => shot(c, 0.4, 'load', (n, sr) => {
    const a = ring(n, sr, [[1500, 1, 0.07], [3900, 0.4, 0.04]]);
    const b = ring(n, sr, [[1380, 0.7, 0.07], [3600, 0.3, 0.04]]);
    const off = Math.floor(sr * 0.13);
    for (let i = n - 1; i >= off; i--) a[i] += b[i - off];
    return a;
  }, 0.06),
};
// The sawmill's blade, a loop: the teeth's whine (harmonics of the tooth rate, wobbling once a
// loop) over a band of hiss. Mono, because it has a place; folded at the seam like the bed.
function sawBuffer(ctx, secs = 2) {
  const sr = HIT_SR;
  const len = Math.floor(sr * secs), fade = Math.floor(sr * 0.2), n = len + fade;
  const rng = makeRng('craft:saw');
  const hiss = highpass(lowpass(noise(n, rng), sr, 4200), sr, 1800);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const wob = 1 + 0.01 * Math.sin(2 * Math.PI * t / secs);
    let v = 0;
    for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * 180 * h * wob * t) / h;
    out[i] = v * 0.5 + hiss[i] * 1.2;
  }
  const chs = [seam(out, len, fade)];
  level(chs, 0.08);
  return intoBuffer(ctx, chs, sr);
}

// --- the hour and the weather -----------------------------------------------
//
// Plans/meer-geluiden.md, phase 5. Beds, all of them, but for three rare birds of their own: the
// dawn chorus, crickets after dark, rain (on the open, and on the roofs round you), and an owl, a
// cuckoo and the lighthouse's foghorn as one-shots with a place. Made the first time the hour or
// the sky asks for them. Everything is written into its loop modulo the loop's length, so a chirp
// that runs past the end lands at the start and there is no seam to fold.
const DAWN_SR = 16000;
function* dawnSong(ctx, secs = 12) {
  const sr = DAWN_SR, n = Math.floor(sr * secs);
  const out = new Float32Array(n);
  const rng = makeRng('dawn');
  const put = (i0, len, fn) => { for (let i = 0; i < len; i++) out[(i0 + i) % n] += fn(i / sr, i / len); };
  // Three kinds of bird: a sparrow's up-sweep, a blackbird's fluting phrase, and a wren's trill.
  for (let c = 0; c < 70; c++) {
    const i0 = Math.floor(rng.next() * n), kind = rng.next(), gain = 0.3 + rng.next() * 0.7;
    if (kind < 0.5) {
      const f0 = 3000 + rng.next() * 1200, f1 = f0 + 600 + rng.next() * 900, L = Math.floor(sr * (0.05 + rng.next() * 0.05));
      let ph = 0;
      put(i0, L, (t, k) => { ph += (f0 + (f1 - f0) * k) / sr; return Math.sin(2 * Math.PI * ph) * Math.sin(Math.PI * k) * gain; });
    } else if (kind < 0.8) {
      const notes = 3 + Math.floor(rng.next() * 3);
      let at = i0;
      for (let k = 0; k < notes; k++) {
        const f = 1700 + rng.next() * 900, L = Math.floor(sr * (0.09 + rng.next() * 0.08));
        let ph = 0;
        put(at, L, (t, u) => { ph += f * (1 + 0.02 * Math.sin(2 * Math.PI * 7 * t)) / sr; return (Math.sin(2 * Math.PI * ph) + 0.2 * Math.sin(4 * Math.PI * ph)) * Math.sin(Math.PI * u) * gain * 0.8; });
        at += L + Math.floor(sr * 0.03);
      }
    } else {
      const f = 4300 + rng.next() * 900, L = Math.floor(sr * (0.3 + rng.next() * 0.4));
      let ph = 0;
      put(i0, L, (t, k) => { ph += f / sr; return Math.sin(2 * Math.PI * ph) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 28 * t)) * Math.sin(Math.PI * k) * gain * 0.6; });
    }
    if (c % 10 === 9) yield;
  }
  const chs = [out];
  level(chs, 0.05);
  return intoBuffer(ctx, chs, sr);
}

// Crickets: a carrier near 4.5 kHz pulsed in threes, each cricket at a rate that divides the loop,
// so the pulsing is periodic and the loop closes.
function* cricketSong(ctx, secs = 6) {
  const sr = BED_SR, n = Math.floor(sr * secs);
  const out = new Float32Array(n);
  const rng = makeRng('crickets');
  for (let c = 0; c < 6; c++) {
    const f = 4100 + rng.next() * 700, per = 9 + c * 2, phase = rng.next(), gain = 0.5 + rng.next() * 0.5;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const p = (t * per / secs + phase) % 1;         // one chirp per period
      const inChirp = p * (secs / per);               // seconds into it
      if (inChirp > 0.11) continue;
      const pulse = (inChirp % 0.037) / 0.037;
      if (pulse > 0.55) continue;
      out[i] += Math.sin(2 * Math.PI * f * t) * Math.sin(Math.PI * pulse / 0.55) * gain;
    }
    yield;
  }
  const chs = [out];
  level(chs, 0.05);
  return intoBuffer(ctx, chs, sr);
}

// Rain: a hiss in the open, and the drops on the roofs and leaves round you, which are what you
// hear indoors as a drumming overhead. Stereo, folded at the seam like the sea.
function* rainSong(ctx, kind = 'rain', secs = 8) {
  const sr = BED_SR, len = Math.floor(sr * secs), fade = Math.floor(sr * 0.5), n = len + fade;
  const chs = [];
  for (let c = 0; c < 2; c++) {
    const rng = makeRng(`${kind}:${c}`);
    const out = kind === 'rain' ? highpass(lowpass(noise(n, rng), sr, 4200), sr, 700) : new Float32Array(n);
    if (kind === 'rain') for (let i = 0; i < n; i++) out[i] *= 0.6;
    // Drops: a tick each, ringing at the pitch of whatever it fell on.
    const drops = kind === 'rain' ? 220 : 900;
    for (let d = 0; d < drops; d++) {
      const i0 = Math.floor(rng.next() * (n - 400)), f = (kind === 'rain' ? 2400 : 1200) + rng.next() * 2200, a = 0.2 + rng.next() * 0.8;
      const L = Math.floor(sr * 0.02);
      for (let i = 0; i < L; i++) out[i0 + i] += Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / sr / 0.004) * a;
    }
    chs.push(seam(out, len, fade));
    yield;
  }
  level(chs, kind === 'rain' ? 0.12 : 0.08);
  return intoBuffer(ctx, chs, sr);
}

// The rare ones with a place.
const HOUR_SHOTS = {
  // A tawny owl: hoo... hu-hoooo, falling, with a tremble in the long one.
  owl: (c) => shot(c, 2.2, 'owl', (n, sr) => {
    const out = new Float32Array(n);
    const notes = [[0, 0.32, 410, 390], [0.85, 0.12, 400, 395], [1.05, 0.9, 420, 360]];
    for (const [at, dur, f0, f1] of notes) {
      const i0 = Math.floor(at * sr), L = Math.floor(dur * sr);
      let ph = 0;
      for (let i = 0; i < L && i0 + i < n; i++) {
        const k = i / L, t = i / sr;
        ph += (f0 + (f1 - f0) * k) * (1 + (dur > 0.5 ? 0.012 * Math.sin(2 * Math.PI * 18 * t) : 0)) / sr;
        out[i0 + i] += (Math.sin(2 * Math.PI * ph) + 0.15 * Math.sin(4 * Math.PI * ph)) * Math.pow(Math.sin(Math.PI * k), 0.6);
      }
    }
    return out;
  }, 0.07),
  // A cuckoo, two notes a third apart, and a blackbird would be the dawn's.
  cuckoo: (c) => shot(c, 0.9, 'cuckoo', (n, sr) => {
    const out = new Float32Array(n);
    for (const [at, dur, f] of [[0, 0.22, 660], [0.32, 0.34, 545]]) {
      const i0 = Math.floor(at * sr), L = Math.floor(dur * sr);
      for (let i = 0; i < L; i++) out[i0 + i] += (Math.sin(2 * Math.PI * f * i / sr) + 0.1 * Math.sin(4 * Math.PI * f * i / sr)) * Math.pow(Math.sin(Math.PI * i / L), 0.5);
    }
    return out;
  }, 0.06),
  // The lighthouse's foghorn: a long low reed swelling up and down, heard across the whole island.
  foghorn: (c) => shot(c, 3.2, 'foghorn', (n, sr) => {
    const out = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, e = Math.min(1, t / 0.5) * Math.min(1, (3.0 - t) / 0.8);
      ph += 108 / sr;
      let v = 0;
      for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * ph * h) / (h * h);
      out[i] = v * Math.max(0, e);
    }
    return lowpass(out, sr, 700);
  }, 0.12),
};

// --- the animals ------------------------------------------------------------
//
// Plans/meer-geluiden.md, phase 6: the story animals on their act words (a hen pecks and scratches,
// a goat butts, a sparrow chirps and takes off) and the ambient flocks and herds of herds.js on
// slow clocks of their own (a sheep, a cow, a hen, a duck), and the stable's horse. A voice that is
// a voice is a buzz at its pitch through two formants (`call`); the rest is noise and envelopes,
// like the crafts. Honest note, as for the gull: a cow is about the limit of what this does well.
function call(n, sr, rng, { f0, f1 = f0, form, vib = 0, vibHz = 6, trem = 0, tremHz = 8, breath = 0.1, at = 0, len = n }) {
  const raw = new Float32Array(n);
  const L = Math.min(len, n - at);
  let ph = 0;
  for (let i = 0; i < L; i++) {
    const k = i / L, t = i / sr;
    ph += (f0 + (f1 - f0) * k) * (1 + vib * Math.sin(2 * Math.PI * vibHz * t)) / sr;
    const env = Math.pow(Math.sin(Math.PI * k), 0.6) * (1 - trem + trem * (0.5 + 0.5 * Math.sin(2 * Math.PI * tremHz * t)));
    raw[at + i] = ((2 * (ph - Math.floor(ph)) - 1) + (rng.next() * 2 - 1) * breath) * env;
  }
  const out = new Float32Array(n);
  for (const [f, q, g] of form) add(out, resonate(raw, sr, f, q).map((v) => v * g));
  for (let i = 0; i < n; i++) out[i] += raw[i] * 0.05;
  return out;
}
const ANIMAL_SHOTS = {
  baa: (c) => shot(c, 0.9, 'baa', (n, sr, rng) => call(n, sr, rng, { f0: 260, f1: 230, form: [[700, 4, 1], [1700, 6, 0.5]], vib: 0.04, vibHz: 7, trem: 0.6, tremHz: 9 }), 0.08),
  moo: (c) => shot(c, 1.5, 'moo', (n, sr, rng) => {
    // "m" closed, then "oo" opening: the formant slides up a little as the mouth opens.
    const a = call(n, sr, rng, { f0: 125, f1: 98, form: [[300, 3, 1], [750, 5, 0.4]], vib: 0.01, breath: 0.05 });
    return lowpass(a, sr, 1400);
  }, 0.09),
  cluck: (c) => shot(c, 0.55, 'cluck', (n, sr, rng) => {
    const out = new Float32Array(n);
    for (const at of [0, 0.16, 0.3]) add(out, call(n, sr, rng, { f0: 340, f1: 300, form: [[950, 5, 1], [2600, 7, 0.3]], at: Math.floor(at * sr), len: Math.floor(0.07 * sr), breath: 0.25 }));
    return out;
  }, 0.07),
  quack: (c) => shot(c, 0.55, 'quack', (n, sr, rng) => {
    const out = new Float32Array(n);
    for (const at of [0, 0.26]) add(out, call(n, sr, rng, { f0: 380, f1: 260, form: [[1100, 4, 1], [2500, 6, 0.6]], at: Math.floor(at * sr), len: Math.floor(0.19 * sr), breath: 0.35 }));
    return out;
  }, 0.08),
  bleat: (c) => shot(c, 0.7, 'bleat', (n, sr, rng) => call(n, sr, rng, { f0: 420, f1: 360, form: [[850, 4, 1], [2100, 6, 0.6]], vib: 0.05, vibHz: 8, trem: 0.75, tremHz: 13 }), 0.07),
  snort: (c) => shot(c, 0.6, 'snort', (n, sr, rng) => {
    const r = lowpass(noise(n, rng), sr, 900);
    for (let i = 0; i < n; i++) { const t = i / sr; r[i] *= Math.exp(-t / 0.18) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 32 * t)); }
    return r;
  }, 0.07),
  peck: (c) => shot(c, 0.4, 'peck', (n, sr, rng) => {
    const out = new Float32Array(n);
    for (const at of [0, 0.13, 0.24]) {
      const i0 = Math.floor(at * sr);
      const tap = burst(Math.floor(sr * 0.03), sr, rng, 2200, 3, 0.004, 1);
      for (let i = 0; i < tap.length; i++) out[i0 + i] += tap[i];
    }
    return out;
  }, 0.04),
  scratch: (c) => shot(c, 0.4, 'scratch', (n, sr, rng) => {
    const r = highpass(lowpass(noise(n, rng), sr, 5000), sr, 1500);
    for (let i = 0; i < n; i++) { const t = i / sr; r[i] *= (t % 0.13) < 0.07 ? Math.sin(Math.PI * (t % 0.13) / 0.07) : 0; }
    return r;
  }, 0.035),
  chirp: (c) => shot(c, 0.35, 'chirp', (n, sr) => {
    const out = new Float32Array(n);
    for (const [at, f0, f1] of [[0, 3600, 5200], [0.14, 3900, 4800]]) {
      const i0 = Math.floor(at * sr), L = Math.floor(0.06 * sr);
      let ph = 0;
      for (let i = 0; i < L; i++) { ph += (f0 + (f1 - f0) * i / L) / sr; out[i0 + i] += Math.sin(2 * Math.PI * ph) * Math.sin(Math.PI * i / L); }
    }
    return out;
  }, 0.05),
  bonk: (c) => shot(c, 0.3, 'bonk', (n, sr, rng) => add(ring(n, sr, [[150, 1, 0.07], [260, 0.4, 0.04]]), burst(n, sr, rng, 700, 1.5, 0.02, 0.6)), 0.09),
  flap: (c) => shot(c, 0.4, 'flap', (n, sr, rng) => {
    const r = lowpass(noise(n, rng), sr, 1800);
    for (let i = 0; i < n; i++) { const t = i / sr; const k = (t % 0.085) / 0.085; r[i] *= Math.pow(Math.sin(Math.PI * k), 2) * Math.exp(-t / 0.25); }
    return r;
  }, 0.05),
};
// What each animal says, and when. A story animal's act word that changes to one of these is heard
// once; an ambient animal calls on its own clock, `every` seconds on average.
const ACT_SOUNDS = {
  chicken: { peck: 'peck', scratch: 'scratch', dust: 'scratch', fly: 'flap' },
  goat: { butt: 'butt', nudge: 'bleat', nibble: null },
  sparrow: { chirp: 'chirp', fly: 'flap', hop: null, steal: 'chirp' },
};
const ACT_ALIAS = { butt: 'bonk' };
const CALLS = {
  sheep: { buf: 'baa', every: 45 }, cow: { buf: 'moo', every: 70 }, chicken: { buf: 'cluck', every: 28 },
  duck: { buf: 'quack', every: 35 }, goat: { buf: 'bleat', every: 55 }, horse: { buf: 'snort', every: 60 },
};

// --- water and fire ---------------------------------------------------------
//
// Plans/meer-geluiden.md, phase 7: a river babbling where you stand by one, the volcano's rumble
// growing towards the crater and its lava bubbling by the nearest flow, and under the sea a low
// drone with the odd tick of a shrimp on the gravel, and the burble of the bubbles a diver breathes
// out. Loops, all folded at the seam or written modulo their length.
function* waterSong(ctx, kind, secs = 4) {
  const sr = BED_SR, len = Math.floor(sr * secs), fade = Math.floor(sr * 0.4), n = len + fade;
  const rng = makeRng(`water:${kind}`);
  const out = new Float32Array(n);
  if (kind === 'river') {
    // A few resonances that wander, each once a loop, over a hiss: water over stones.
    for (const [f0, swing, q] of [[420, 120, 3], [760, 200, 3.5], [1150, 260, 4], [1700, 300, 5]]) {
      const src = noise(n, rng), cutAt = (i) => f0 + swing * Math.sin(2 * Math.PI * i / len + f0);
      const lp = lowpass(src, sr, cutAt), band = highpass(lp, sr, f0 * 0.6);
      for (let i = 0; i < n; i++) out[i] += band[i] * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * i / len + q)) * 1.2;
      yield;
    }
    for (let g = 0; g < 40; g++) {
      const i0 = Math.floor(rng.next() * (n - sr * 0.05)), f = 500 + rng.next() * 900, L = Math.floor(sr * 0.03);
      for (let i = 0; i < L; i++) out[i0 + i] += Math.sin(2 * Math.PI * (f + 2000 * i / sr) * i / sr) * Math.sin(Math.PI * i / L) * 0.3;
    }
  } else if (kind === 'rumble') {
    // Under 80 Hz, breathing once and three times a loop, with a little of 150 Hz for a laptop.
    const low = lowpass(lowpass(noise(n, rng), sr, 70), sr, 70);
    const mid = lowpass(highpass(noise(n, rng), sr, 120), sr, 260);
    for (let i = 0; i < n; i++) {
      const e = 0.6 + 0.25 * Math.sin(2 * Math.PI * i / len) + 0.15 * Math.sin(2 * Math.PI * 3 * i / len + 1);
      out[i] = (low[i] * 14 + mid[i] * 0.6 + 0.25 * Math.sin(2 * Math.PI * 38 * i / sr)) * e;
    }
    yield;
  } else if (kind === 'lava') {
    // Blups: a pitch rising through each, under a sizzle.
    const sizzle = highpass(noise(n, rng), sr, 2800);
    for (let i = 0; i < n; i++) out[i] = sizzle[i] * 0.08;
    for (let b = 0; b < 26; b++) {
      const i0 = Math.floor(rng.next() * (n - sr * 0.1)), L = Math.floor(sr * (0.05 + rng.next() * 0.05)), f0 = 90 + rng.next() * 80;
      let ph = 0;
      for (let i = 0; i < L; i++) { ph += (f0 + 260 * i / L) / sr; out[i0 + i] += Math.sin(2 * Math.PI * ph) * Math.exp(-i / L * 3) * (0.5 + rng.next() * 0.5); }
    }
    yield;
  } else {
    // Under the sea: a low drone, and shrimp clicking on the gravel.
    const drone = lowpass(lowpass(noise(n, rng), sr, 220), sr, 220);
    for (let i = 0; i < n; i++) out[i] = drone[i] * 6 * (0.8 + 0.2 * Math.sin(2 * Math.PI * i / len));
    for (let c = 0; c < 70; c++) {
      const i0 = Math.floor(rng.next() * (n - 40)), f = 2200 + rng.next() * 1800, a = 0.1 + rng.next() * 0.3;
      for (let i = 0; i < 30; i++) out[i0 + i] += Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / 6) * a;
    }
    yield;
  }
  const chs = [seam(out, len, fade)];
  level(chs, kind === 'rumble' ? 0.14 : 0.09);
  return intoBuffer(ctx, chs, sr);
}
// A diver's breath going up: three blips, each a little higher.
const bubbleShot = (c) => shot(c, 0.35, 'bubble', (n, sr) => {
  const out = new Float32Array(n);
  [0, 0.09, 0.2].forEach((at, k) => {
    const i0 = Math.floor(at * sr), L = Math.floor(0.04 * sr), f0 = 420 + k * 160;
    let ph = 0;
    for (let i = 0; i < L; i++) { ph += (f0 + 900 * i / L) / sr; out[i0 + i] += Math.sin(2 * Math.PI * ph) * Math.sin(Math.PI * i / L); }
  });
  return out;
}, 0.05);

// --- the rounds -------------------------------------------------------------
//
// Plans/meer-geluiden.md, phase 8: the timber wagon (hooves, wheels, the timber thrown down), the
// gold run (the cart and the barrow on the road, bars on the pit) and the fisherman (the swish of
// the cast and the plop of the float). The wagon runs on the sea's clock already (timberrun.js
// tripAt), so two players side by side hear it in the same place.
const ROUND_SHOTS = {
  // A hoof on a road: a hollow knock and the thump under it.
  hoof: (c) => shot(c, 0.16, 'hoof', (n, sr, rng) => add(ring(n, sr, [[620, 0.8, 0.02], [940, 0.4, 0.012], [140, 0.6, 0.03]]), burst(n, sr, rng, 1500, 2, 0.006, 0.8)), 0.08),
  // Timber thrown down: three knocks of wood on wood, falling in pitch.
  plank: (c) => shot(c, 0.6, 'plank', (n, sr, rng) => {
    const out = new Float32Array(n);
    [[0, 260], [0.14, 220], [0.31, 190]].forEach(([at, f0]) => {
      const i0 = Math.floor(at * sr), k = ring(n - i0, sr, [[f0, 1, 0.05], [f0 * 1.7, 0.5, 0.03]]);
      const b = burst(n - i0, sr, rng, 900, 2, 0.01, 0.6);
      for (let i = 0; i < k.length; i++) out[i0 + i] += k[i] + b[i];
    });
    return out;
  }, 0.09),
  // The rod's line through the air.
  swish: (c) => shot(c, 0.3, 'swish', (n, sr, rng) => {
    const src = noise(n, rng);
    const r = lowpass(src, sr, (i) => 600 + 2400 * Math.sin(Math.PI * i / n));
    for (let i = 0; i < n; i++) r[i] = (src[i] - r[i] * 0.3) * Math.pow(Math.sin(Math.PI * i / n), 2) * 0.4;
    return highpass(r, sr, 500);
  }, 0.04),
  // The float landing: a drop of pitch and a splash.
  plop: (c) => shot(c, 0.32, 'plop', (n, sr, rng) => {
    const out = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) { const t = i / sr; ph += (900 * Math.exp(-t / 0.03) + 280) / sr; out[i] = Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.05); }
    return add(out, lowpass(burst(n, sr, rng, 1800, 1, 0.04, 0.4), sr, 4000));
  }, 0.06),
};
// Wheels on a road, a loop: a rumble with the knock of each turn of the rim.
function cartBuffer(ctx, secs = 2) {
  const sr = BED_SR, len = Math.floor(sr * secs), fade = Math.floor(sr * 0.2), n = len + fade;
  const rng = makeRng('round:cart');
  const out = lowpass(lowpass(noise(n, rng), sr, 320), sr, 320);
  for (let i = 0; i < n; i++) out[i] *= 6;
  for (let k = 0; k < 8; k++) {
    const i0 = Math.floor(k * len / 8 + rng.next() * sr * 0.03);
    for (let i = 0; i < Math.floor(sr * 0.04) && i0 + i < n; i++) out[i0 + i] += Math.sin(2 * Math.PI * 180 * i / sr) * Math.exp(-i / sr / 0.012) * 0.6;
  }
  const chs = [seam(out, len, fade)];
  level(chs, 0.08);
  return intoBuffer(ctx, chs, sr);
}

// --- a clink ---------------------------------------------------------------
//
// Two glasses meeting: two high rings a fourth and a bit apart, gone in a sixth of a second - the
// shanty's tankard (shantySong) on its own, so a tavern and the borrel can set it down whenever
// somebody drinks. Played at a rate jittered per clink, so no two are the same glass.
function clinkBuffer(ctx) {
  const sr = HIT_SR;
  const n = Math.floor(sr * 0.22);
  const rng = makeRng('clink');
  const src = noise(n, rng);
  const a = resonate(src, sr, 2800, 18), b = resonate(src, sr, 4100, 22), c = resonate(src, sr, 5300, 26);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = (a[i] + b[i] * 0.7 + c[i] * 0.35) * Math.exp(-t / 0.03) * Math.min(1, t / 0.0008);
  }
  const chs = [out];
  level(chs, 0.06);
  return intoBuffer(ctx, chs, sr);
}

// --- a hammer --------------------------------------------------------------
//
// Two things happen when a nail is hit: the steel ticks, and the board answers. The tick
// alone is a snare drum and the board alone is a woodblock; it is the pair that reads as
// somebody building something. Three tones for the board rather than one, because a plank
// rings at more than one pitch and a single decaying sine is unmistakably a synthesiser.
function hammerBuffer(ctx) {
  const sr = HIT_SR;
  const n = Math.floor(sr * 0.26);
  const rng = makeRng('hammer');
  const tick = resonate(noise(n, rng), sr, 2400, 1.1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    // A millisecond of attack. Starting at full amplitude on sample zero is a step, and a
    // step is a click on top of the tap - audible as a lisp at the front of every blow.
    const att = Math.min(1, t / 0.0012);
    const wood = Math.exp(-t / 0.045) * Math.sin(2 * Math.PI * t * 196) * 0.50
      + Math.exp(-t / 0.028) * Math.sin(2 * Math.PI * t * 337) * 0.30
      + Math.exp(-t / 0.016) * Math.sin(2 * Math.PI * t * 521) * 0.16;
    out[i] = att * (tick[i] * Math.exp(-t / 0.010) * 2.2 + wood);
  }
  const chs = [out];
  level(chs, 0.11);
  return intoBuffer(ctx, chs, sr);
}

// --- a gull ----------------------------------------------------------------
//
// The one sound in here that is a *thing* rather than a texture, and much the hardest to
// fake. A herring gull's call is nearly tonal, harsh, and falls across three or four
// syllables - so this is a sawtooth with a formant over it and a fast vibrato for the
// roughness, and not noise at all. Honest note for whoever reads this next: it is the one
// voice where a recording would plainly be better. It passes at a distance, over wind,
// which is the only place it is ever played.
function gullBuffer(ctx) {
  const sr = HIT_SR;
  const secs = 1.15;
  const n = Math.floor(sr * secs);
  const rng = makeRng('gull');
  // start, length, pitch at the start, pitch at the end. Each syllable falls, and each is
  // lower than the one before: that shape is the whole recognisable part of the call.
  const CRY = [
    [0.00, 0.20, 1180, 900],
    [0.30, 0.17, 1090, 830],
    [0.56, 0.24, 980, 690],
  ];
  const raw = new Float32Array(n);
  const breath = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let amp = 0, f = 0;
    for (const [at, dur, f0, f1] of CRY) {
      if (t < at || t > at + dur) continue;
      const k = (t - at) / dur;
      f = f0 + (f1 - f0) * k;
      // Fast in, slow out, with the tail of each syllable running into the gap.
      amp = Math.min(1, (t - at) / 0.012) * Math.pow(1 - k, 0.7);
    }
    if (amp <= 0) { phase += 900 / sr; continue; }
    // The roughness. A gull's voice is not clean and a clean one sounds like a recorder.
    const rough = 1 + 0.045 * Math.sin(2 * Math.PI * t * 42);
    phase += (f * rough) / sr;
    const saw = 2 * (phase - Math.floor(phase + 0.5));
    raw[i] = saw * amp;
    breath[i] = (rng.next() * 2 - 1) * amp * amp * 0.35;
  }
  // The formant is what makes it a bird and not a buzzer: most of the energy is pushed up
  // around 2.3 kHz, with enough of the raw tone left under it to keep the pitch.
  const formant = resonate(raw, sr, 2300, 3.2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = formant[i] * 1.5 + raw[i] * 0.35 + breath[i];
  // No seam: a cry is a one-shot and starts and ends in silence of its own.
  const chs = [lowpass(out, sr, 5200)];
  level(chs, 0.085);
  return intoBuffer(ctx, chs, sr);
}

// --- the rave --------------------------------------------------------------
//
// Saturday night in the castle (Plans/DONE/rave-in-het-kasteel.md): sixteen bars of techno in A
// minor, looped. Twelve bars of groove - four on the floor, a clap on two and four, open
// hats on the offbeat, a rolling bass under it and an acid line from bar five - then four of
// breakdown and build with no kick, a pad, a snare roll that tightens bar by bar and a riser,
// and a beat of nothing before bar one comes round again as the drop. A drop every half
// minute is a lot; a rave is a lot.
//
// The one copy of the song's shape, because web/js/rave.js lights the hall off it: the lasers
// go out for the breakdown, the strobe runs with the roll and the floor jumps on the drop.
// `build` is the first bar without a kick.
export const RAVE_SONG = { bpm: 132, bars: 16, build: 12 };

// Everything is written into the loop modulo its length, so a tail that runs past the last
// bar lands on the first one and the loop has no seam to fold: the crash on the drop and the
// kick's decay are the same samples either way round. Mono, like every placed voice, even
// though this one is not placed - it plays through one THREE.Audio, and what it gains from
// width is not worth twice the 2.6 MB. Made the first time it is wanted, never at build().
//
// And made a bar at a time: a generator, stepped once a frame by update() until it hands
// back the buffer. All at once it was 115 ms on this machine - cold code, run exactly once,
// so no amount of tightening the loops gets it under a frame - which is a stutter in the
// middle of somebody walking up to the castle. A step is a bar, the riser, or a quarter of
// the final mix, and the music starts about a third of a second after it was first wanted.
function* raveSong(ctx) {
  const sr = HIT_SR;
  const { bpm, bars, build } = RAVE_SONG;
  const beat = 60 / bpm, step = beat / 4;
  const n = Math.round(sr * beat * 4 * bars);
  const hit = new Float32Array(n);         // drums, which the sidechain leaves alone
  const tone = new Float32Array(n);        // everything the kick pushes down
  const side = new Float32Array(n).fill(1);
  const rng = makeRng('rave');
  const at = (bar, s) => Math.round((bar * 16 + s) * step * sr);
  const put = (dst, src, i0, gain) => { for (let i = 0; i < src.length; i++) dst[(i0 + i) % n] += src[i] * gain; };
  const env = (len, fn) => { const a = new Float32Array(Math.floor(len * sr)); for (let i = 0; i < a.length; i++) a[i] = fn(i / sr, i); return a; };
  const att = (t, s = 0.002) => Math.min(1, t / s);

  // The one-shots, made once and laid down wherever the pattern asks for them.
  let ph = 0;
  const kick = env(0.42, (t) => {
    ph += (46 + 115 * Math.exp(-t / 0.028)) / sr;
    const body = Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.17) * att(t, 0.001);
    return Math.tanh(body * 1.8) + (t < 0.004 ? (rng.next() * 2 - 1) * 0.3 * (1 - t / 0.004) : 0);
  });
  const hatNoise = highpass(noise(Math.floor(0.25 * sr), rng), sr, 6500);
  const closedHat = env(0.05, (t, i) => hatNoise[i] * Math.exp(-t / 0.011));
  const openHat = env(0.24, (t, i) => hatNoise[i] * Math.exp(-t / 0.065) * att(t));
  const clapNoise = resonate(noise(Math.floor(0.3 * sr), rng), sr, 1450, 1.1);
  const clap = env(0.3, (t, i) => {
    let a = Math.exp(-t / 0.075) * 0.6;
    for (const o of [0, 0.011, 0.023]) if (t >= o) a += Math.exp(-(t - o) / 0.0055);
    return clapNoise[i] * a;
  });
  const crashNoise = highpass(noise(Math.floor(1.8 * sr), rng), sr, 4200);
  const crash = env(1.8, (t, i) => crashNoise[i] * Math.exp(-t / 0.55) * att(t));
  const snareNoise = resonate(noise(Math.floor(0.2 * sr), rng), sr, 1900, 0.8);
  const snare = (pitch) => { let p = 0; return env(0.16, (t, i) => { p += pitch / sr; return (snareNoise[i] * 1.3 + Math.sin(2 * Math.PI * p) * 0.6) * Math.exp(-t / 0.05) * att(t); }); };
  const saw = (p) => 2 * (p - Math.floor(p + 0.5));
  // What the kick does to everything else, as a curve over one beat, made once: an exp() a
  // sample under every kick was a fifth of the time the song took to make.
  const pump = env(beat, (t) => 1 - 0.78 * Math.exp(-t / 0.085));
  // A bass note, made once per pitch: the song plays eight different ones 144 times.
  const bassNotes = new Map();
  const bassNote = (f) => {
    if (!bassNotes.has(f)) {
      let p = 0, y1 = 0, y2 = 0;
      bassNotes.set(f, env(step * 0.92, (t) => {
        p += f / sr;
        const x = saw(p) * Math.exp(-t / 0.08) * att(t, 0.003);
        y1 += 0.16 * (x - y1); y2 += 0.16 * (y1 - y2);     // two poles at ~600 Hz
        return y2;
      }));
    }
    return bassNotes.get(f);
  };

  // A bar's root, for the bass and the acid: A, A, F, G, over and over.
  const ROOTS = [55, 55, 43.65, 49];
  const rootOf = (bar) => ROOTS[bar % 4];
  // The acid line, in semitones over the bar's root, and whether each sixteenth sounds.
  const ACID = [0, 12, 0, 3, 0, 7, 12, 0, 10, 0, 3, 15, 0, 7, 5, 12];
  const ACID_ON = [1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1];
  const ACID_ACCENT = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0];
  yield;

  for (let bar = 0; bar < bars; bar++) {
    const groove = bar < build;
    const k = bar - build;                 // 0..3 through the build
    for (let s = 0; s < 16; s++) {
      const i0 = at(bar, s);
      if (groove) {
        if (s % 4 === 0) {
          put(hit, kick, i0, 0.95);
          // The pump: everything else ducks under the kick and comes back before the next.
          for (let j = 0; j < pump.length; j++) {
            const w = i0 + j < n ? i0 + j : i0 + j - n;
            if (pump[j] < side[w]) side[w] = pump[j];
          }
        }
        if (s === 4 || s === 12) put(hit, clap, i0, 0.42);
        if (s % 4 === 2) put(hit, openHat, i0, 0.2);
        else put(hit, closedHat, i0, [0.13, 0.07, 0, 0.09][s % 4]);
        // The rolling bass: every sixteenth the kick does not have, an octave up on the last.
        if (s % 4 !== 0) put(tone, bassNote(rootOf(bar) * (s % 4 === 3 ? 2 : 1)), i0, 0.55);
        if (bar >= 8 && (s === 3 || s === 11)) {
          // A chord stab on the offbeats of the second half, to lift it before the break.
          const chord = [220, 261.63, 329.63].map((c) => c * (rootOf(bar) / 55));
          const ps = chord.map(() => rng.next());
          put(tone, env(step * 1.6, (t) => {
            let v = 0;
            chord.forEach((f, c) => { ps[c] += f / sr; v += saw(ps[c]) + saw(ps[c] * 1.007); });
            return v * Math.exp(-t / 0.09) * att(t, 0.004) * 0.18;
          }), i0, 0.6);
        }
      } else if (k < 2) {
        put(hit, closedHat, i0, s % 2 ? 0.05 : 0.09);
      }
      // The acid line, from bar five, and on into the first half of the break with its
      // filter opening; a resonant state-variable filter swept per note.
      const acidBar = (bar >= 4 && groove) || k === 0 || k === 1;
      if (acidBar && ACID_ON[s]) {
        const f = rootOf(bar) * 2 * Math.pow(2, ACID[s] / 12);
        const sweep = groove ? 0.5 - 0.5 * Math.cos(Math.PI * 2 * ((bar - 4) * 16 + s) / 128) : 0.6 + 0.2 * k;
        const accent = ACID_ACCENT[s] ? 1 : 0;
        // Straight into the mix, with both envelopes stepped by multiplication rather than
        // an exp() per sample, and the filter's sin() taken as its first two terms - the
        // cutoff never passes 3.7 kHz, where that is a few per cent out and nobody can hear.
        const len = Math.floor(step * 0.95 * sr), gain = (groove ? 0.34 : 0.26) * (0.7 + 0.5 * accent);
        // The saw is its phase kept in -0.5..0.5 by hand, which is Math.floor's work for
        // nothing, and the index wraps by a compare: the modulo was most of this loop.
        const fk = Math.exp(-1 / (sr * (0.07 + 0.08 * accent))), ak = Math.exp(-1 / (sr * 0.2));
        const inc = f / sr, rise = 1 / (0.002 * sr);
        let p = 0, low = 0, band = 0, fe = 1, ae = 1;
        for (let i = 0; i < len; i++) {
          p += inc; if (p >= 0.5) p -= 1;
          let cut = 260 + 2400 * sweep * (0.35 + 0.65 * fe) + accent * 700;
          if (cut > 3000) cut = 3000;
          const w = Math.PI * cut / sr, fc = 2 * (w - w * w * w / 6);
          const hi = 2 * p - low - 0.28 * band;
          band += fc * hi; low += fc * band;
          const at0 = i * rise;
          const idx = i0 + i < n ? i0 + i : i0 + i - n;
          tone[idx] += low * ae * (at0 < 1 ? at0 : 1) * gain;
          fe *= fk; ae *= ak;
        }
      }
    }
    if (!groove) {
      // The roll tightens a bar at a time - crotchets, quavers, semiquavers, then
      // demisemiquavers - rising in pitch and level with it, and the last beat is a gap.
      const per = [4, 2, 1, 0.5][k];
      for (let h = 0; h < 16; h += per) {
        if (k === 3 && h >= 12) break;
        const g = (k * 16 + h) / 64;
        put(hit, snare(180 + g * 140), at(bar, h), 0.22 + 0.6 * g);
      }
      // A pad over the break: A minor for two bars, then G, which is what leans into the
      // drop. Three detuned saws a note, a slow swell, and nothing ducks it.
      // 360 000 saws a bar: plain loops over two small typed arrays, phases wrapped by hand
      // like the acid's. A forEach per sample with Math.floor in it was 47 ms of this.
      const chord = (k < 2 ? [220, 261.63, 329.63] : [196, 246.94, 293.66]);
      const inc = new Float64Array(9), ps = new Float64Array(9);
      for (let v = 0; v < 9; v++) { inc[v] = chord[Math.floor(v / 3)] * (1 + (v % 3 - 1) * 0.006) / sr; ps[v] = rng.next() - 0.5; }
      const i0 = at(bar, 0), len = at(bar + 1, 0) - i0;
      const swells = k % 2 === 0, swellK = 1 / (1.2 * sr);
      for (let i = 0; i < len; i++) {
        let v = 0;
        for (let o = 0; o < 9; o++) { let q = ps[o] + inc[o]; if (q >= 0.5) q -= 1; ps[o] = q; v += q; }
        const swell = swells ? i * swellK : 1;
        tone[i0 + i < n ? i0 + i : i0 + i - n] += v * 2 * (swell < 1 ? swell : 1) * 0.06;
      }
    }
    yield;
  }
  // The riser over the whole build: noise through a band sweeping up four octaves, rising.
  const b0 = at(build, 0), len = at(bars, 0) - b0 - Math.round(beat * sr);
  let low = 0, band = 0;
  for (let i = 0; i < len; i++) {
    const g = i / len;
    const fc = 2 * Math.sin(Math.PI * (300 * Math.pow(18, g)) / sr);
    const hi = (rng.next() * 2 - 1) - low - 0.5 * band;
    band += fc * hi; low += fc * band;
    tone[(b0 + i) % n] += band * g * g * 0.3;
  }
  put(hit, crash, at(0, 0), 0.32);
  yield;

  const out = new Float32Array(n);
  for (let q = 0; q < 4; q++) {
    for (let i = Math.floor(n * q / 4); i < Math.floor(n * (q + 1) / 4); i++) out[i] = Math.tanh((hit[i] + tone[i] * side[i]) * 1.1);
    yield;
  }
  const chs = [out];
  level(chs, 0.2);
  return intoBuffer(ctx, chs, sr);
}

// How loud the rave is: in the hall it is the loudest thing you will ever hear on this
// island, and from the square it is a thump through a wall that is gone before the harbour.
const RAVE_LOUD = 0.62;
const RAVE_OUT = 0.3;
const RAVE_RANGE = 34;

// --- the shanties ----------------------------------------------------------
//
// The Salty Kraken's jukebox (Plans/piratenkroeg.md): three tunes played by the room one after
// the other on one loop - the Kraken's own jig, and two real shanties whose tunes are
// traditional and nobody's (Drunken Sailor, the Wellerman; the arrangements are ours, and they
// are instrumental: the crew hum the chorus, they do not sing words). Boots stamping on every
// count with the knock of the floor under them, a tankard clinked every other bar, hands on the
// backbeat of a chorus, a bass under an accordion going oom-pah in the verse and held with the
// bellows swelling in the chorus, a fiddle on the tune, and the crew's "ooh" under it.
//
// Every tune runs at the same count, 0.6 s (a dotted crotchet of the jig, a crotchet of the
// others), so the crew nod on one beat through the whole loop whatever is playing
// (pirate-tavern.js reads `counts`). Made like the rave, a bar a step, modulo the loop so it has
// no seam, and only the first time the Kraken is within earshot. At 44.1 kHz rather than the
// placed voices' 22: a fiddle is what the ear hears the sample rate on.
const SONG_SR = 44100;

// A melody note is semitones over the tune's `key` (the fiddle's register); `H` holds the note
// before, `R` is a rest. A bar is `beatsPerBar * sub` slots. `harmony` is a chord name per bar.
const H = 'h', R = 'r';
const TUNES = [
  {
    id: 'kraken', name: 'The Salty Kraken', beatsPerBar: 2, sub: 3, chorus: 8, key: 220,
    harmony: ['Am', 'Am', 'G', 'Am', 'Am', 'Am', 'G', 'Am', 'C', 'G', 'Am', 'Am', 'C', 'G', 'D', 'Am'],
    melody: [
      [0, 3, 5, 7, 7, 5], [3, 0, 3, 2, 2, 2], [0, 3, 5, 7, 10, 7], [5, 3, 2, 0, H, R],
      [0, 3, 5, 7, 7, 5], [3, 0, 3, 2, 2, 2], [0, 3, 5, 7, 10, 7], [5, 3, 2, 0, H, R],
      [7, 10, 15, 15, 14, 12], [10, H, 7, 5, H, 2], [0, 3, 7, 12, H, 10], [7, H, H, 7, R, R],
      [7, 10, 15, 15, 14, 12], [10, H, 14, 14, 12, 10], [9, H, 5, 9, 12, 9], [7, H, H, 0, H, R],
    ],
  },
  {
    // "What shall we do with a drunken sailor", in D dorian; the chorus is "Way hay and up she rises".
    id: 'drunken-sailor', name: 'Drunken Sailor', beatsPerBar: 2, sub: 2, chorus: 8, key: 293.66,
    harmony: ['Dm', 'Dm', 'C', 'C', 'Dm', 'Dm', 'Am', 'Dm', 'Dm', 'Dm', 'C', 'C', 'Dm', 'Dm', 'Am', 'Dm'],
    melody: [
      [7, 7, 7, 7], [7, 0, 3, 7], [5, 5, 5, 5], [5, -2, 2, 5],
      [7, 7, 7, 7], [7, 9, 10, 12], [10, 7, 5, 2], [0, H, 0, H],
      [7, H, 7, H], [7, 0, 3, 7], [5, H, 5, H], [5, -2, 2, 5],
      [7, H, 7, H], [7, 9, 10, 12], [10, 7, 5, 2], [0, H, 0, R],
    ],
  },
  {
    // "There once was a ship that put to sea", in D minor; the chorus is "Soon may the Wellerman
    // come". The traditional tune, not any recording's arrangement of it.
    id: 'wellerman', name: 'Wellerman', beatsPerBar: 4, sub: 2, chorus: 8, key: 293.66,
    harmony: ['Dm', 'Dm', 'Bb', 'Dm', 'Dm', 'Dm', 'Bb', 'Dm', 'Bb', 'F', 'Dm', 'Bb', 'F', 'A', 'Bb', 'Dm'],
    melody: [
      [-5, H, 0, 0, 0, H, 3, H], [7, 7, 7, H, 7, H, H, R], [7, 8, H, 8, 5, 8, H, 7], [7, 3, H, 3, 2, 0, H, R],
      [-5, H, 0, 0, 0, H, 3, H], [7, 7, 7, H, 7, H, H, R], [8, 8, H, 7, 5, 3, 2, H], [0, H, H, H, R, R, R, R],
      [8, H, 8, 5, 8, H, 8, 7], [7, H, H, H, 3, 3, 3, 3], [5, 3, H, 2, H, 0, H, R], [8, H, 8, 5, 8, H, 8, 7],
      [7, H, H, H, 7, 5, H, 3], [H, 2, H, 0, H, H, H, R], [12, H, 10, H, 8, H, 7, H], [0, H, H, H, R, R, R, R],
    ],
  },
];
// Root (the bass) and three chord tones round the accordion's middle, in Hz.
const CHORDS = {
  Am: [55, [220, 261.63, 329.63]], G: [49, [196, 246.94, 293.66]], C: [65.41, [261.63, 329.63, 392]],
  D: [73.42, [220, 293.66, 369.99]], Dm: [73.42, [220, 293.66, 349.23]], Bb: [58.27, [233.08, 293.66, 349.23]],
  F: [87.31, [220, 261.63, 349.23]], A: [55, [220, 277.18, 329.63]],
};

// The one copy of the loop's shape: web/js/pirate-tavern.js nods the crew off `bpm` and `counts`.
export const SHANTY_SONG = (() => {
  let from = 0;
  const songs = TUNES.map((t) => {
    const s = { id: t.id, name: t.name, bars: t.melody.length, beatsPerBar: t.beatsPerBar, chorus: t.chorus, from };
    from += s.bars * s.beatsPerBar;
    return s;
  });
  return { bpm: 100, songs, counts: from };
})();

function* shantySong(ctx) {
  const sr = SONG_SR;
  const count = 60 / SHANTY_SONG.bpm;
  const n = Math.round(sr * count * SHANTY_SONG.counts);
  const mix = new Float32Array(n);
  const rng = makeRng('shanty');
  const pole = (hz) => 1 - Math.exp(-2 * Math.PI * hz / sr);
  const put = (src, i0, gain) => { for (let i = 0; i < src.length; i++) mix[(i0 + i) % n] += src[i] * gain; };
  const env = (len, fn) => { const a = new Float32Array(Math.floor(len * sr)); for (let i = 0; i < a.length; i++) a[i] = fn(i / sr, i); return a; };
  const att = (t, s = 0.002) => Math.min(1, t / s);

  // The one-shots. A stamp is a boot on boards: a low thud dropping from 70 to 45 Hz, and the
  // knock of the plank under it a hair later.
  let ph = 0;
  const stamp = env(0.09, (t) => {
    ph += (45 + 25 * Math.exp(-t / 0.02)) / sr;
    return Math.tanh(Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.035) * 2.2 * att(t, 0.001));
  });
  const knockNoise = resonate(noise(Math.floor(0.03 * sr), rng), sr, 900, 2);
  const knock = env(0.02, (t, i) => knockNoise[i] * Math.exp(-t / 0.006));
  const clapNoise = resonate(noise(Math.floor(0.2 * sr), rng), sr, 1200, 1.1);
  const clap = env(0.2, (t, i) => {
    let a = Math.exp(-t / 0.05) * 0.5;
    for (const o of [0, 0.009, 0.019]) if (t >= o) a += Math.exp(-(t - o) / 0.005);
    return clapNoise[i] * a;
  });
  // Two pewter tankards meeting: two rings a fourth and a bit apart, gone in a sixth of a second.
  const clinkSrc = noise(Math.floor(0.06 * sr), rng);
  const clinkA = resonate(clinkSrc, sr, 2800, 18), clinkB = resonate(clinkSrc, sr, 4100, 22);
  const clink = env(0.06, (t, i) => (clinkA[i] + clinkB[i] * 0.7) * Math.exp(-t / 0.018));
  yield;

  // What is kept from bar to bar, so a held chord or a hum does not restart at every barline:
  // the accordion's reed phases and its two poles, the crew's voices and their formants.
  const reedInc = new Float64Array(9), reedPh = new Float64Array(9);
  for (let v = 0; v < 9; v++) reedPh[v] = rng.next() - 0.5;
  let r1 = 0, r2 = 0;
  const voiceInc = new Float64Array(3), voicePh = new Float64Array(3);
  for (let v = 0; v < 3; v++) voicePh[v] = rng.next() - 0.5;
  // Two formants for "ooh" (about 330 and 800 Hz), as state-variable band-passes stepped here.
  const f1 = 2 * Math.sin(Math.PI * 330 / sr), f2 = 2 * Math.sin(Math.PI * 800 / sr);
  let l1 = 0, b1 = 0, l2 = 0, b2 = 0;
  const reedPole = pole(2200), bassPole = pole(280), fiddlePole = pole(3200);
  const bellows = Math.floor(0.03 * sr);

  const notes = [];
  for (const [ti, tune] of TUNES.entries()) {
    const song = SHANTY_SONG.songs[ti];
    const slot = count / tune.sub, slots = tune.beatsPerBar * tune.sub, sL = slot * sr;
    const at = (bar, k) => Math.round(((song.from + bar * tune.beatsPerBar) * count + k * slot) * sr);
    for (let bar = 0; bar < song.bars; bar++) {
      const sung = bar >= tune.chorus;
      const [root, chord] = CHORDS[tune.harmony[bar]];
      const b0 = at(bar, 0), len = at(bar + 1, 0) - b0;
      // The room: a boot on every count, the chorus clapping its backbeat, a clink now and then.
      for (let c = 0; c < tune.beatsPerBar; c++) {
        const i0 = at(bar, c * tune.sub);
        put(stamp, i0, (sung ? 0.8 : 0.65) * (c === 0 ? 1 : 0.85));
        put(knock, i0 + Math.floor(0.004 * sr), 0.25);
        if (sung && c % 2 === 1) put(clap, i0, 0.32);
      }
      if (bar % 2 === 1) put(clink, at(bar, slots - 2), 0.2);
      // The bass on each count: a saw through two poles near 280 Hz, longer in the chorus.
      for (let c = 0; c < tune.beatsPerBar; c++) {
        let p = 0, y1 = 0, y2 = 0;
        const L = Math.floor(count * (sung ? 0.97 : 0.75) * sr), i0 = at(bar, c * tune.sub);
        const f = c % 2 === 1 && !sung ? root * 1.5 : root;   // oom-pah: the fifth on the off count
        const decay = sung ? 0.35 : 0.18;
        for (let i = 0; i < L; i++) {
          const t = i / sr;
          p += f / sr; if (p >= 0.5) p -= 1;
          const x = 2 * p * Math.exp(-t / decay) * att(t, 0.004);
          y1 += bassPole * (x - y1); y2 += bassPole * (y1 - y2);
          mix[(i0 + i) % n] += y2 * 0.9;
        }
      }
      // The accordion: three reeds a note, a musette's hair apart, half saw and half square,
      // which is the reedy middle a saw alone does not have. Pah-pah on the off slots of the
      // verse; in the chorus held through the bar, swelling to its middle, with a breath of
      // the bellows at every barline - which is also what keeps a change of chord from clicking.
      for (let v = 0; v < 9; v++) reedInc[v] = chord[Math.floor(v / 3)] * (1 + (v % 3 - 1) * 0.008) / sr;
      const stabL = Math.floor(sL * 0.8);
      for (let i = 0; i < len; i++) {
        let s = 0;
        for (let o = 0; o < 9; o++) {
          let q = reedPh[o] + reedInc[o]; if (q >= 0.5) q -= 1; reedPh[o] = q;
          s += q + (q < 0 ? -0.25 : 0.25);
        }
        r1 += reedPole * (s - r1); r2 += reedPole * (r1 - r2);
        let g;
        if (sung) {
          g = (0.8 + 0.2 * Math.sin(Math.PI * i / len)) * Math.min(1, i / bellows, (len - i) / bellows) * 0.06;
        } else {
          const k = Math.floor(i / sL), w = i - Math.floor(k * sL);
          g = k % tune.sub !== 0 && w < stabL
            ? Math.min(1, w / (0.006 * sr), (stabL - w) / (0.01 * sr)) * Math.exp(-w / sr / 0.12) * 0.075 : 0;
        }
        mix[(b0 + i) % n] += r2 * g;
      }
      // A long bar (the Wellerman's is 2.4 s) is two steps, or it is a frame and a bit on this laptop.
      if (len > 1.5 * sr) yield;
      // The crew, in the chorus only: three voices an octave under the chord, humming "ooh",
      // with a slow vibrato each and the same breath at the barline as the bellows.
      if (sung) {
        for (let v = 0; v < 3; v++) voiceInc[v] = chord[v] / 2 / sr;
        for (let i = 0; i < len; i++) {
          const t = (b0 + i) / sr;
          let s = 0;
          for (let v = 0; v < 3; v++) {
            let q = voicePh[v] + voiceInc[v] * (1 + 0.006 * Math.sin(2 * Math.PI * (4.6 + v * 0.7) * t + v)); if (q >= 0.5) q -= 1; voicePh[v] = q;
            s += q;
          }
          l1 += f1 * b1; b1 += f1 * (s - l1 - 0.25 * b1);
          l2 += f2 * b2; b2 += f2 * (s - l2 - 0.3 * b2);
          const g = Math.min(1, i / (0.08 * sr), (len - i) / bellows) * 0.11;
          mix[(b0 + i) % n] += (b1 + 0.5 * b2) * g;
        }
      }
      // The fiddle's notes for this bar, rendered after the bars.
      for (let k = 0; k < slots; k++) {
        const s = tune.melody[bar][k];
        if (s === H) { if (notes.length) notes[notes.length - 1].q++; continue; }
        if (s !== R) notes.push({ i0: at(bar, k), sL, f: tune.key * Math.pow(2, s / 12), q: 1, gain: sung ? 0.19 : 0.16 });
      }
      yield;
    }
  }

  // The fiddle: each note from its slot to the next that is not a hold, a saw with vibrato
  // coming in after a tenth of a second and a breath of bow noise, through two poles near 3 kHz.
  for (let k = 0; k < notes.length; k++) {
    const { i0, sL, f, q, gain } = notes[k];
    const L = Math.floor(q * sL * 0.96);
    let p = rng.next() - 0.5, y1 = 0, y2 = 0;
    for (let i = 0; i < L; i++) {
      const t = i / sr;
      const vib = t > 0.1 ? 0.004 * Math.min(1, (t - 0.1) / 0.1) * Math.sin(2 * Math.PI * 5.5 * t) : 0;
      p += f * (1 + vib) / sr; if (p >= 0.5) p -= 1;
      const a = Math.min(1, t / 0.025, (L - i) / (0.04 * sr));
      const x = 2 * p + (rng.next() - 0.5) * 0.08;
      y1 += fiddlePole * (x - y1); y2 += fiddlePole * (y1 - y2);
      mix[(i0 + i) % n] += y2 * a * gain;
    }
    if (k % 24 === 23) yield;
  }
  yield;

  const out = new Float32Array(n);
  for (let q = 0; q < 6; q++) {
    for (let i = Math.floor(n * q / 6); i < Math.floor(n * (q + 1) / 6); i++) out[i] = Math.tanh(mix[i] * 1.2);
    yield;
  }
  const chs = [out];
  level(chs, 0.2);
  return intoBuffer(ctx, chs, sr);
}

// How loud: in the Kraken it is the room, and on the quay a tune through the wall that is gone
// a few houses on. Lowpassed to 480 outside, not the rave's 320 - a shanty lives in the middle,
// and at 320 only the boots came through.
const SHANTY_LOUD = 0.5;
const SHANTY_OUT = 0.22;
const SHANTY_RANGE = 22;

// --------------------------------------------------------------- the island's ears

function remembered() {
  try { return localStorage.getItem(KEY) === 'on'; } catch { return false; }
}
function remember(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* a private window still hears it */ }
}

// Whether this browser can make a noise at all. Checked rather than assumed, because the
// chip has to be able to say no rather than pretend to work.
export function soundPossible() {
  return typeof window !== 'undefined'
    && !!(window.AudioContext || window.webkitAudioContext);
}

/**
 * `island()` is the one thing this module is told - six times a second, and a snapshot
 * rather than a set of setters, because what sound wants to know is "how is the island
 * right now" and main.js is the only thing that can answer that. It returns:
 *
 *   night     0..1, how dark it is                     indoors   are we in a room
 *   depthAt   (x,z) -> world height; below 0 is water  tables    borrel sets standing out
 *   crowds    [Map(index -> figure), ...]              quays     [[x,z], ...] quay heads
 *   records   Map(id -> building record), ours only
 *
 * Two states, and they are not the same one. `on` is what the person asked for and is
 * remembered per browser; `built` is whether the audio graph exists, which it cannot until
 * the page has been touched. Keeping them apart is what lets the chip come up lit for
 * somebody who left it on, without a note having been played or a context created.
 */
// `makeElement` makes the media element the keeper's own tracks play through, and is main.js's to
// hand in: this module still fetches nothing and makes nothing that does (tests/sound.test.mjs).
// Without one, the keeper's tracks are not played and every room keeps its computed music.
export function createSound({ camera, scene, island, makeElement = null }) {
  let on = soundPossible() && remembered();
  let gestured = false;          // the browser will not start a context before this
  let ctx = null;
  let listener = null;
  let built = null;              // everything the graph owns, once it exists
  let since = PICK_S;            // forces a pick on the first frame after switching on
  let nextGull = GULL_GAP[0];
  let clock = 0;                 // seconds the graph has run; the hammers keep time by it
  let fade = 0;                  // seconds since the switch was last thrown on
  // The mix from Settings -> Audio (sound-mix.js), read once here and then kept by setMix: a
  // slider moved while the sound is off is remembered and heard the moment it comes on.
  const mix = loadMix();
  let masterAt = -1;
  let inside = false;            // the last pick's word on whether we are in a room             // what the listener was last set to, so a frame sets it once

  // What the last snapshot asked for, and where the bed has actually got to. Two numbers
  // rather than one because the bed crossfades over seconds: walking from the middle of
  // the island down to the beach should bring the sea up the way the ground comes down,
  // not switch it on at the waterline.
  const bed = { seaWant: 0, seaAt: 0, windWant: 0, windAt: 0, duckWant: 1, duckAt: 1 };

  // Under the sea everything is heard through water: one lowpass on the master bus - three's
  // listener has exactly one slot for a filter, `setFilter`, between its gain and the speakers
  // - open at 20 kHz (which is to say, not there) and closed to a muffle as the lens goes under
  // (web/js/underwater.js hands `setUnderwater` the eased 0..1). On the bus and not on the
  // beds, or the hammers and the gulls would carry on ringing through it. The amount is
  // remembered before there is a graph: a page that loads with the camera under water is
  // muffled from the first note.
  const OPEN_HZ = 20000, MUFFLED_HZ = 600;
  let muffle = null;
  let underwater = 0;
  let muffleAt = OPEN_HZ;

  function build() {
    listener = new THREE.AudioListener();
    ctx = listener.context;
    camera.add(listener);
    listener.setMasterVolume(0);          // brought up by update(), so a switch is not a thump
    muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = OPEN_HZ;
    muffle.Q.value = 0.7;
    listener.setFilter(muffle);
    muffleAt = OPEN_HZ;
    applyMuffle();

    // The mix (sound-mix.js, Settings -> Audio): a gain per bus on the listener's input, and a gain
    // per part on its bus. Every voice made below is moved off the listener onto its part's node
    // (`route`) the moment it exists. three r170's Audio connects `this.gain` to
    // `listener.getInput()` in its constructor and never touches that connection again - its
    // connect/disconnect/setFilters only rewire source -> filters -> getOutput(), and
    // PositionalAudio only panner -> gain - so one move, straight after `new`, holds for good.
    const buses = {};
    for (const b of MIX_BUSES) {
      buses[b] = ctx.createGain();
      buses[b].gain.value = mix[b];
      buses[b].connect(listener.getInput());
    }
    const parts = {};
    for (const [id, , b] of MIX_PARTS) {
      parts[id] = ctx.createGain();
      parts[id].gain.value = mix[id] ? 1 : 0;
      parts[id].connect(buses[b]);
    }
    const route = (audio, part) => {
      audio.gain.disconnect();
      audio.gain.connect(parts[part]);
      return audio;
    };

    const buffers = {
      surf: surfBuffer(ctx),
      wind: windBuffer(ctx),
      murmur: murmurBuffer(ctx),
      hammer: hammerBuffer(ctx),
      gull: gullBuffer(ctx),
      clink: clinkBuffer(ctx),
    };

    // The bed. Not positional: it is the weather, it has no place on the island, and a
    // panner on it would swing the sea round your head every time you turned the camera.
    const mkBed = (buffer, part = 'sea') => {
      const a = route(new THREE.Audio(listener), part);
      if (buffer) a.setBuffer(buffer);
      a.setLoop(true);
      a.setVolume(0);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 7000;
      filter.Q.value = 0.7;
      a.setFilters([filter]);
      if (buffer) a.play();
      return { audio: a, filter };
    };

    // Everything with a place on the island hangs off one group, so a panner can be
    // brought up to date with a single updateMatrixWorld - which matters indoors, where
    // this scene is not the one being rendered and three.js updates nobody in it.
    const anchor = new THREE.Group();
    scene.add(anchor);

    // A voice is made at build() whether or not its buffer exists yet: a family made the first
    // time it is wanted (`need`) hands its buffer over when it is done, and until then the voice
    // is a panner and a gain that nothing plays through.
    const mkVoice = (buffer, { ref, rolloff, volume, part, cut = null }) => {
      const holder = new THREE.Object3D();
      const a = route(new THREE.PositionalAudio(listener), part);
      if (buffer) a.setBuffer(buffer);
      a.setRefDistance(ref);
      a.setRolloffFactor(rolloff);
      a.setDistanceModel('exponential');
      a.setVolume(volume);
      let filter = null;
      if (cut) {
        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cut;
        filter.Q.value = 0.7;
        a.setFilters([filter]);
      }
      holder.add(a);
      anchor.add(holder);
      return { holder, audio: a, filter };
    };
    const mkLoop = (opts) => {
      const v = mkVoice(null, opts);
      v.audio.setLoop(true);
      return v;
    };

    built = {
      buffers,
      buses,
      parts,
      route,
      anchor,
      mkBed,
      sea: mkBed(buffers.surf),
      wind: mkBed(buffers.wind),
      // Sticky slots: a builder keeps the same voice for as long as they keep hammering,
      // so a blow does not jump between panners and the rhythm survives a re-pick.
      hammers: Array.from({ length: HAMMERS }, () => ({
        ...mkVoice(buffers.hammer, { ref: 7, rolloff: 1.9, volume: 0.5, part: 'work' }),
        id: null, f: null, next: 0,
      })),
      gulls: Array.from({ length: GULLS }, () => mkVoice(buffers.gull, { ref: 18, rolloff: 1.1, volume: 0.42, part: 'birds' })),
      // The two taverns, each its own loop hung at its door (steerPubs), and each its own bed for
      // when you are inside it. One village tavern and one Salty Kraken an island at most.
      pubs: {
        village: {
          out: mkLoop({ ref: 6, rolloff: 2.2, volume: 0, part: 'tavern', cut: PUB_SHUT }),
          in: mkBed(null, 'tavern'),
          buffer: 'murmur', busy: 0, at: null, clinkIn: CLINK_GAP[0],
        },
        kraken: {
          out: mkLoop({ ref: 6, rolloff: 2.0, volume: 0, part: 'tavern', cut: PUB_SHUT }),
          in: mkBed(null, 'tavern'),
          buffer: 'kraken', busy: 0, at: null, clinkIn: CLINK_GAP[0],
        },
      },
      // The glasses: two at the doors and on the square, one inside whichever room you are in.
      clinks: Array.from({ length: CLINKS }, () => mkVoice(buffers.clink, { ref: 4, rolloff: 1.8, volume: 0.5, part: 'tavern', cut: PUB_SHUT })),
      clinkRoom: mkBed(null, 'tavern'),
      borrel: { ...mkLoop({ ref: 8, rolloff: 1.6, volume: 0, part: 'borrel' }), clinkIn: CLINK_GAP[0] },
      borrelClinks: Array.from({ length: CLINKS }, () => mkVoice(buffers.clink, { ref: 5, rolloff: 1.7, volume: 0.45, part: 'borrel' })),
      // The church bell: two in the tower, struck in turn, and one through the wall of a room.
      bells: Array.from({ length: BELLS }, () => mkVoice(null, { ref: 24, rolloff: 0.7, volume: 0.9, part: 'bell' })),
      bellRoom: mkBed(null, 'bell'),
      // The workshops' blows, the crowd at work, and the saw's blade.
      crafts: Array.from({ length: CRAFTS }, () => mkVoice(null, { ref: 5, rolloff: 1.7, volume: 0.6, part: 'work' })),
      workers: Array.from({ length: WORKERS }, () => ({ ...mkVoice(null, { ref: 5, rolloff: 1.9, volume: 0.45, part: 'work' }), id: null, f: null, next: 0 })),
      saw: { ...mkLoop({ ref: 5, rolloff: 1.6, volume: 0, part: 'work', cut: 3000 }), want: 0 },
      // The hour and the weather: four beds, and one voice for the rare birds and the foghorn.
      hours: {
        dawn: { ...mkBed(null, 'birds'), want: 0, at: 0 },
        crickets: { ...mkBed(null, 'night'), want: 0, at: 0 },
        rain: { ...mkBed(null, 'weather'), want: 0, at: 0 },
        roofs: { ...mkBed(null, 'weather'), want: 0, at: 0 },
        rumble: { ...mkBed(null, 'water'), want: 0, at: 0 },
        under: { ...mkBed(null, 'underwater'), want: 0, at: 0, below: true },
      },
      // The river and the lava: a loop each, hung at the nearest point of what they belong to.
      river: { ...mkLoop({ ref: 5, rolloff: 1.5, volume: 0, part: 'water' }), want: 0 },
      lava: { ...mkLoop({ ref: 5, rolloff: 1.5, volume: 0, part: 'water' }), want: 0 },
      bubbles: mkBed(null, 'underwater'),
      rare: mkVoice(null, { ref: 14, rolloff: 1.0, volume: 0.6, part: 'birds' }),
      horn: mkVoice(null, { ref: 30, rolloff: 0.6, volume: 0.8, part: 'weather' }),
      // The rounds: the wagon's and the gold cart's wheels as one loop at whichever is nearer, and
      // three one-shots for hooves, timber, bars, the cast and the float.
      cart: { ...mkLoop({ ref: 5, rolloff: 1.6, volume: 0, part: 'rounds' }), want: 0 },
      rounders: Array.from({ length: ROUNDERS }, () => mkVoice(null, { ref: 5, rolloff: 1.7, volume: 0.6, part: 'rounds' })),
      // The animals' voices.
      animals: Array.from({ length: ANIMALS }, () => mkVoice(null, { ref: 4, rolloff: 1.7, volume: 0.6, part: 'birds' })),
      // Who says hello: two voices with a place, given each greeting's phrase as it is said.
      greeters: Array.from({ length: GREETERS }, () => ({ ...mkVoice(null, { ref: 3, rolloff: 1.6, volume: 0.7, part: 'greetings' }), id: null })),
      // The families made the first time they are wanted, a step a frame (need, makeMore).
      making: {},
      // The rave's music, made the first Saturday night it is within earshot, and the Salty
      // Kraken's shanty, made the first time you come near the harbour (makeSong).
      rave: null,
      shanty: null,
    };
    built.clinkRoom.audio.setLoop(false);
    built.bellRoom.audio.setLoop(false);
    built.bubbles.audio.setLoop(false);
    built.bubbles.filter.frequency.value = 9000;
    built.bellRoom.filter.frequency.value = 900;
    built.clinkRoom.audio.setBuffer(buffers.clink);
    built.clinkRoom.filter.frequency.value = 9000;
    for (const p of Object.values(built.pubs)) p.in.filter.frequency.value = 9000;
  }

  // The families that are not made at build(): a generator per buffer, stepped once a frame by
  // makeMore until it hands its buffer back, and started only by the first thing that wants it -
  // so a page that never goes near the Kraken never makes its murmur. `need` answers the buffer
  // once it exists and null until then.
  const LAZY = {
    kraken: (c) => murmurSong(c, 'kraken'),
    borrel: (c) => murmurSong(c, 'borrel'),
    bell: (c) => bellSong(c),
    ...Object.fromEntries(Object.entries(CRAFT_SHOTS).map(([k, make]) => [k, (c) => once(make, c)])),
    saw: (c) => once(sawBuffer, c),
    dawn: (c) => dawnSong(c),
    crickets: (c) => cricketSong(c),
    rain: (c) => rainSong(c, 'rain'),
    roofs: (c) => rainSong(c, 'roofs'),
    ...Object.fromEntries(Object.entries(HOUR_SHOTS).map(([k, make]) => [k, (c) => once(make, c)])),
    ...Object.fromEntries(Object.entries(ANIMAL_SHOTS).map(([k, make]) => [k, (c) => once(make, c)])),
    river: (c) => waterSong(c, 'river'),
    rumble: (c) => waterSong(c, 'rumble', 6),
    lava: (c) => waterSong(c, 'lava'),
    under: (c) => waterSong(c, 'under', 6),
    bubble: (c) => once(bubbleShot, c),
    ...Object.fromEntries(Object.entries(ROUND_SHOTS).map(([k, make]) => [k, (c) => once(make, c)])),
    cart: (c) => once(cartBuffer, c),
    ...Object.fromEntries(Array.from({ length: PHRASES }, (_, k) => [`greet${k}`, (c) => greetSong(c, k)])),
  };
  // A buffer that is quick to make, made in one step all the same, so every family goes through
  // need() and makeMore() and stats().making tells the truth.
  function* once(make, c) { yield; return make(c); }
  function need(name) {
    if (built.buffers[name]) return built.buffers[name];
    if (!built.making[name] && LAZY[name]) built.making[name] = LAZY[name](ctx);
    return null;
  }

  // The songs, and how each is heard: loud and whole inside, a muffled tune through the walls
  // outside, nothing past `range`. The village tavern has no song of its own - only the
  // keeper's tracks, when there are some (setPlaylists).
  const SONGS = {
    rave: { make: raveSong, loud: RAVE_LOUD, out: RAVE_OUT, range: RAVE_RANGE, cut: 320 },
    shanty: { make: shantySong, loud: SHANTY_LOUD, out: SHANTY_OUT, range: SHANTY_RANGE, cut: 480 },
    tavern: { make: null, loud: 0.45, out: 0.2, range: 22, cut: 480 },
  };

  // The keeper's own tracks (lib/music.mjs: HOME/audio/kroeg, rave, pirates), per song, as urls.
  // A song with tracks plays them whole, one after the other, through a media element - streamed,
  // not decoded whole, since an album of mp3s is hundreds of megabytes of samples - and its
  // computed version is never made. The same bed as a computed song: one source in and out, the
  // filter open inside and shut outside.
  let playlists = {};
  function setPlaylists(next) {
    playlists = {};
    if (!makeElement) return;
    for (const [kind, list] of Object.entries(next || {})) {
      if (Object.hasOwn(SONGS, kind) && Array.isArray(list) && list.length) playlists[kind] = list.filter((u) => typeof u === 'string');
    }
    if (!built) return;
    for (const kind of Object.keys(SONGS)) {
      const t = built.tracks && built.tracks[kind];
      if (t && !playlists[kind]) { t.el.pause(); t.want = 0; }
    }
  }
  function makeTracks(kind) {
    const el = makeElement();
    el.preload = 'auto';
    const a = built.route(new THREE.Audio(listener), 'tracks');
    a.setMediaElementSource(el);
    a.setVolume(0);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = SONGS[kind].cut;
    filter.Q.value = 0.9;
    a.setFilters([filter]);
    const t = { el, audio: a, filter, want: 0, index: 0, playing: false };
    // One track ends, the next begins; after the last, the first again.
    el.addEventListener('ended', () => {
      const list = playlists[kind];
      if (!list || !list.length) { t.playing = false; return; }
      t.index = (t.index + 1) % list.length;
      el.src = list[t.index];
      if (t.want > 0) el.play().catch(() => { t.playing = false; });
    });
    return t;
  }
  function steerTracks(kind, heard) {
    const o = SONGS[kind], list = playlists[kind];
    if (!heard && !(built.tracks && built.tracks[kind])) return;
    built.tracks = built.tracks || {};
    if (heard && !built.tracks[kind]) built.tracks[kind] = makeTracks(kind);
    const t = built.tracks[kind];
    if (!t) return;
    t.want = !heard ? 0 : heard.inside ? o.loud
      : o.out * Math.pow(clamp(1 - (heard.dist || 0) / o.range, 0, 1), 2);
    const now = ctx.currentTime;
    t.filter.frequency.setTargetAtTime(heard && heard.inside ? 16000 : o.cut, now, 0.12);
    t.audio.gain.gain.setTargetAtTime(t.want, now, t.want > 0 ? 0.25 : 0.6);
    if (t.want > 0 && !t.playing) {
      t.index = Math.min(t.index, list.length - 1);
      if (!t.el.src || !list.includes(t.el.src)) t.el.src = list[t.index];
      t.playing = true;
      t.el.play().catch(() => { t.playing = false; });
    } else if (t.want <= 0 && t.playing && t.audio.gain.gain.value <= 0.001) {
      // Paused, not stopped: walking back in picks the song up where it was.
      t.el.pause();
      t.playing = false;
    }
  }

  // One source for a song whether you are in the room or outside it, so the beat does not
  // start again at the door: walking in opens the filter, walking out closes it. Not
  // positional, like the bed - turning your head in a hall that loud changes nothing - and the
  // loudness outside is the distance to the building, which main.js measures.
  function makeSong(kind) {
    const a = built.route(new THREE.Audio(listener), 'songs');
    a.setLoop(true);
    a.setVolume(0);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = SONGS[kind].cut;
    filter.Q.value = 0.9;
    a.setFilters([filter]);
    return { audio: a, filter, since: 0, want: 0, making: SONGS[kind].make(ctx) };
  }

  // A bar of each song being written a frame, until it is done (raveSong says why).
  function makeMore() {
    for (const [name, gen] of Object.entries(built.making)) {
      const step = gen.next();
      if (!step.done) continue;
      delete built.making[name];
      built.buffers[name] = step.value;
    }
    for (const kind of Object.keys(SONGS)) {
      const r = built[kind];
      if (!r || !r.making) continue;
      const step = r.making.next();
      if (!step.done) continue;
      r.making = null;
      r.audio.setBuffer(step.value);
      built.buffers[kind] = step.value;
    }
  }

  // `heard` is main.js's word on a song: null when there is nothing to hear, else whether you
  // are in its room and how far the building is when you are not.
  function steerSong(kind, heard) {
    const o = SONGS[kind];
    if (playlists[kind]) {
      // The keeper's tracks instead: a computed song already playing goes quiet.
      if (built[kind] && built[kind].audio.isPlaying) { built[kind].want = 0; built[kind].audio.stop(); }
      steerTracks(kind, heard);
      return;
    }
    if (!o.make) return;
    if (heard && !built[kind]) built[kind] = makeSong(kind);
    const r = built[kind];
    if (!r) return;
    r.want = !heard ? 0 : heard.inside ? o.loud
      : o.out * Math.pow(clamp(1 - (heard.dist || 0) / o.range, 0, 1), 2);
    if (r.making) return;                 // still being written; it starts when it is done
    const now = ctx.currentTime;
    r.filter.frequency.setTargetAtTime(heard && heard.inside ? 16000 : o.cut, now, 0.12);
    r.audio.gain.gain.setTargetAtTime(r.want, now, r.want > 0 ? 0.25 : 0.6);
    if (r.want > 0 && !r.audio.isPlaying) {
      r.since = now;
      r.audio.play();
    } else if (r.want <= 0 && r.audio.isPlaying && r.audio.gain.gain.value <= 0.001) {
      r.audio.stop();
    }
  }
  const steerRave = (rave) => steerSong('rave', rave);
  const steerShanty = (shanty) => steerSong('shanty', shanty);
  const steerTavern = (tavern) => steerSong('tavern', tavern);

  // How far into the loop a song is, in seconds, at the moment what is being drawn now is
  // heard - which is the output latency later than the context's clock - or null when there
  // is nothing to keep time to. The hall's lights and the Kraken's nodding crew run on this.
  function songClock(kind) {
    // A keeper's track has no count this knows, so the room keeps its own time.
    if (playlists[kind]) return null;
    const r = built && built[kind];
    if (!on || !r || r.making || !r.audio.isPlaying || ctx.state !== 'running') return null;
    const dur = r.audio.buffer.duration;
    const t = ctx.currentTime - r.since - (ctx.outputLatency || 0) - (ctx.baseLatency || 0);
    return ((t % dur) + dur) % dur;
  }
  const raveClock = () => songClock('rave');
  const shantyClock = () => songClock('shanty');

  // Re-trigger a one-shot. three.js refuses `play()` on a source that is already running
  // and says so in the console, which on a hammer would be several warnings a second.
  function fire(voice, x, y, z, rate = 1) {
    voice.holder.position.set(x, y, z);
    const a = voice.audio;
    if (a.isPlaying) { try { a.stop(); } catch { /* it had already ended */ } }
    a.setPlaybackRate(rate);
    try { a.play(); } catch { /* the context went out under us; the next blow will do */ }
    // After play(), never before: three.js's PositionalAudio.updateMatrixWorld returns on
    // its first line when the source is not playing, so a panner moved ahead of the blow
    // keeps the position it had - and the first blow of every errand came from wherever
    // the last one did. The call is here at all because nothing updates this scene's
    // matrices while you are indoors and a room is what is being rendered.
    voice.holder.updateMatrixWorld(true);
  }

  // The cut-off is geometric in the amount, because pitch is: half way under is the middle of
  // the range as the ear hears it (about 3.5 kHz), not as the number says (10 kHz). Scheduled
  // only when it has moved by more than two per cent, so a camera bobbing under the surface
  // does not queue a ramp per frame. A no-op with no graph, which is every page that has not
  // been touched yet.
  function applyMuffle() {
    if (!muffle || !ctx) return;
    const hz = OPEN_HZ * Math.pow(MUFFLED_HZ / OPEN_HZ, underwater);
    if (Math.abs(Math.log(hz / muffleAt)) < 0.02) return;
    muffleAt = hz;
    muffle.frequency.setTargetAtTime(hz, ctx.currentTime, 0.08);
  }
  function setUnderwater(amount) {
    underwater = clamp(Number(amount) || 0, 0, 1);
    applyMuffle();
  }

  // How much of what is around the camera is water. Eight probes on a ring rather than one
  // under the eye, because standing on the last cell of a beach is standing on land and
  // should still sound like the coast. The archipelago is asked rather than the terrain, so
  // the channel between two islands answers "sea" instead of handing back the height of
  // the nearer coast - which is what OPEN_SEA in shared/regions.mjs is for.
  //
  // Two rings, near and further out, the near one counting double: the surf is heard from a few
  // houses back, and fades over a street or two rather than at one ring's edge. Only water deeper
  // than SEA_WIDE across counts - a river or a lake is not the sea - and the answer is squared on the way
  // out, so a single wet probe far off is a whisper and not a fifth of the beach.
  function seaAt(look, x, z) {
    if (!(look.depthAt(x, z) < 0)) return false;
    let n = 0;
    for (const [dx, dz] of [[SEA_WIDE, 0], [-SEA_WIDE, 0], [0, SEA_WIDE], [0, -SEA_WIDE]]) if (look.depthAt(x + dx, z + dz) < 0) n++;
    return n >= 3;
  }
  function coastliness(look) {
    let wet = 0;
    for (const [R, w] of [[12, 2], [26, 1]]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + R;
        if (seaAt(look, camera.position.x + Math.cos(a) * R, camera.position.z + Math.sin(a) * R)) wet += w;
      }
    }
    const k = wet / 24;
    return Math.min(1, k * (0.6 + 0.4 * k) * 1.25);
  }

  // Who is hammering, nearest first. `nearestFirst` wants rows with an `origin` and an
  // `id`, which is exactly what a settler has under other names - so it is borrowed rather
  // than reimplemented, and its tie-break by id comes along for free. That tie-break is
  // load-bearing: without it two builders equally far off would swap voices on every pick,
  // and a voice that changes hands starts its rhythm again.
  // How many bodies the last pick walked, and how many of them were at work. Kept only so
  // that `stats()` can put the two numbers side by side: "three hundred settlers, seven
  // voices" is the whole claim this module makes about its cost, and it is not a claim
  // anybody can check by listening.
  let seen = 0;
  let working = 0;

  function builders(look) {
    const rows = [];
    seen = 0;
    working = 0;
    for (const crowd of look.crowds) {
      if (!crowd) continue;
      for (const f of crowd.values()) {
        seen++;
        if (!f.visible || f.hidden || f.anim !== 'hammer') continue;
        working++;
        const dx = f.pos[0] - camera.position.x, dz = f.pos[1] - camera.position.z;
        if (dx * dx + dz * dz > HAMMER_RANGE * HAMMER_RANGE) continue;
        rows.push({ id: f.id, origin: f.pos, f });
      }
    }
    return nearestFirst(rows, [camera.position.x, camera.position.z]).slice(0, HAMMERS);
  }

  // Whether a part is worth playing at all: switched on, and neither its bus nor the master at
  // zero. The gain nodes already make a part that is off silent; this is what makes it free, so a
  // muted hammer is not started six times a second into a gain of nothing.
  const live = (part) => !!mix[part] && mix[busOf(part)] > 0 && mix.master > 0;

  // The last fifth of a range is a slope to nothing, so a source leaving the pool, or the island
  // falling behind you, fades rather than clicks off.
  const edge = (d, range) => clamp((range - d) / (0.2 * range), 0, 1);
  const flat = (at) => Math.hypot(at[0] - camera.position.x, at[2] - camera.position.z);

  // A loop with a place: given its buffer the moment there is one, glided to `want`, started on the
  // first moment it is wanted and stopped only once its gain has actually reached nothing - or
  // closing time would be a cut rather than a fade.
  function loopTo(v, buf, want) {
    const a = v.audio;
    if (buf && a.buffer !== buf) {
      if (a.isPlaying) a.stop();
      a.setBuffer(buf);
    }
    a.gain.gain.setTargetAtTime(want, ctx.currentTime, want > 0 ? 0.25 : 0.4);
    if (want > 0 && a.buffer && !a.isPlaying) a.play();
    else if (want <= 0 && a.isPlaying && a.getVolume() <= 0.001) a.stop();
  }

  // The taverns, and only ours. A hum from a neighbour's tavern sixty units of open water away is
  // not a sound that would carry. main.js hands the doors (`look.pubs`, [{ kind, at: [x, y, z] }]:
  // the village tavern's front, the Salty Kraken's PUB_GATE at the foot of its stair); a snapshot
  // without them is read off the records, door = the middle of the lot.
  function pubsOf(look) {
    if (Array.isArray(look.pubs)) return look.pubs;
    const out = [];
    if (!look.records) return out;
    for (const rec of look.records.values()) {
      const type = rec.spec && rec.spec.civicType;
      if ((type !== 'tavern' && type !== 'piratetavern') || !rec.group || !rec.group.visible) continue;
      const p = rec.group.position;
      out.push({ kind: type === 'tavern' ? 'village' : 'kraken', at: [p.x, p.y || 0, p.z] });
    }
    return out;
  }

  // Busier in the evening, quieter in the morning: the hour is the sea's (the snapshot's `hour`).
  const eveningOf = (hour) => (hour == null ? 1 : hour >= 18 || hour < 1 ? 1.25 : hour < 11 ? 0.75 : 1);

  function steerPubs(look) {
    const now = ctx.currentTime;
    const sites = { village: null, kraken: null };
    for (const p of pubsOf(look)) if (p && p.at && Object.hasOwn(sites, p.kind) && !sites[p.kind]) sites[p.kind] = p;
    // Busy means people stood still near the door, which is what a borrel is, plus anybody stood
    // still there the rest of the week. Walking past does not count: a street with somebody
    // crossing it is not a full bar. One walk of the crowd for both doors, and only for a door
    // within earshot.
    const near = [];
    for (const [kind, site] of Object.entries(sites)) {
      const pub = built.pubs[kind];
      pub.busy = 0;
      pub.d = site ? flat(site.at) : Infinity;
      if (site && !look.indoors && pub.d < TAVERN_RANGE) near.push([pub, site.at]);
    }
    if (near.length) {
      for (const crowd of look.crowds) {
        if (!crowd) continue;
        for (const f of crowd.values()) {
          if (!f.visible || f.hidden || f.anim === 'walk' || f.anim === 'haul' || f.anim === 'step'
            || f.anim === 'carry' || f.anim === 'barrow') continue;
          for (const [pub, at] of near) {
            const ex = f.pos[0] - at[0], ez = f.pos[1] - at[2];
            if (ex * ex + ez * ez < 11 * 11) pub.busy++;
          }
        }
      }
    }
    const room = look.indoors ? look.room || null : null;
    const evening = eveningOf(look.hour);
    for (const [kind, pub] of Object.entries(built.pubs)) {
      const site = sites[kind];
      pub.at = site ? site.at : null;
      const full = clamp(pub.busy / 9, 0, 1);
      pub.full = kind === 'kraken' ? KRAKEN_CREW + (1 - KRAKEN_CREW) * full : full;
      // Outside: through the door, by the distance to it.
      let want = 0;
      if (site && !look.indoors && live('tavern') && pub.d < TAVERN_RANGE) {
        want = Math.min(0.25, pub.full * 0.22 * evening) * edge(pub.d, TAVERN_RANGE);
      }
      pub.want = want;
      const buf = want > 0 || pub.out.audio.isPlaying ? need(pub.buffer) : null;
      if (pub.at) pub.out.holder.position.set(pub.at[0], pub.at[1] + 1, pub.at[2]);
      pub.out.filter.frequency.setTargetAtTime(
        PUB_SHUT + (PUB_OPEN - PUB_SHUT) * Math.exp(-(Number.isFinite(pub.d) ? pub.d : 99) / PUB_OPEN_R), now, 0.2);
      loopTo(pub.out, buf, want);
      // Last, for the reason given in fire(): a panner that is not playing ignores this.
      if (pub.at) pub.out.holder.updateMatrixWorld(true);
      // Inside: the room itself, unmuffled, as a bed. In the village tavern it is the room's whole
      // sound (it has no song of its own) and goes down under the keeper's tracks when there are
      // some; in the Kraken it sits under the jukebox.
      const inside = room === (kind === 'village' ? 'tavern' : 'piratetavern');
      pub.inside = inside;
      const inWant = inside && live('tavern') ? (kind === 'village' ? (playlists.tavern ? 0.12 : 0.26) : 0.11) : 0;
      loopTo(pub.in, inWant > 0 || pub.in.audio.isPlaying ? need(pub.buffer) : null, inWant);
    }
  }

  // The borrel on the square (gatheringAt in shared/daylight.mjs): its own loop at the middle of
  // the square while the village is out there, louder with every set of tables carried out and on
  // a Friday more than at coffee time. Outside a gathering the square is quiet but for the hammers.
  function steerBorrel(look) {
    const b = built.borrel;
    let want = 0;
    const g = look.gathering, at = look.square;
    if (g && at && !look.indoors && live('borrel')) {
      const d = flat(at);
      if (d < BORREL_RANGE) want = clamp(0.12 + 0.04 * (look.tables || 0), 0, 0.36) * (g.friday ? 1.3 : 1) * edge(d, BORREL_RANGE);
    }
    b.want = want;
    b.friday = !!(g && g.friday);
    b.at = at || null;
    if (b.at) b.holder.position.set(at[0], at[1] + 1.2, at[2]);
    loopTo(b, want > 0 || b.audio.isPlaying ? need('borrel') : null, want);
    if (b.at) b.holder.updateMatrixWorld(true);
  }

  // The bell strikes the hours on the sea's clock (`look.clock`, worldNow().hour - null under a lens,
  // which is not the sea's time): as many strokes as the hour on a clock face, BELL_EVERY apart, and
  // one lighter stroke on the half hour. Only a turn of the clock this page saw itself counts, and
  // only a short step forward - so a page loaded at ten past two does not strike two, and a tab
  // that slept an hour does not ring the hour it missed.
  const bell = { min: null, queue: [], next: 0, at: null };
  function steerBell(look) {
    const hour = look.clock;
    bell.at = look.bell && look.bell.at ? look.bell.at : null;
    if (hour == null || !Number.isFinite(hour) || !bell.at) { bell.min = null; bell.queue.length = 0; return; }
    if (live('bell')) need('bell');
    const m = Math.round(hour * 60) % 1440;
    const was = bell.min;
    bell.min = m;
    if (was == null || m === was) return;
    const step = (m - was + 1440) % 1440;
    if (step >= BELL_SKIP_MIN) return;
    for (let k = 1; k <= step; k++) {
      const minute = (was + k) % 1440;
      const h = Math.floor(minute / 60);
      if (h >= BELL_QUIET[0] || h < BELL_QUIET[1]) continue;
      const strokes = minute % 60 === 0 ? (h % 12) || 12 : minute % 60 === 30 ? 1 : 0;
      const from = bell.queue.length ? bell.queue[bell.queue.length - 1].t + BELL_EVERY : clock;
      for (let s = 0; s < strokes; s++) bell.queue.push({ t: from + s * BELL_EVERY, half: minute % 60 === 30 });
    }
  }
  // Strike what is due, on this module's own seconds (`clock`), which the queue was laid out on.
  function strike() {
    if (!bell.queue.length) return;
    const buf = built.buffers.bell;
    if (!live('bell')) { bell.queue.length = 0; return; }
    if (!buf) return;                 // still being made; the strokes wait for it
    // Strokes that waited for the buffer start from now, still BELL_EVERY apart - never all at once.
    const late = clock - bell.queue[0].t;
    if (late > 0.5) for (const q of bell.queue) q.t += late;
    while (bell.queue.length && clock >= bell.queue[0].t) {
      const q = bell.queue.shift();
      const rate = q.half ? 1.12 : 1;
      if (inside) {
        const a = built.bellRoom.audio;
        if (a.buffer !== buf) a.setBuffer(buf);
        if (a.isPlaying) { try { a.stop(); } catch { /* it had rung out */ } }
        a.setVolume(q.half ? 0.08 : 0.14);
        a.setPlaybackRate(rate);
        try { a.play(); } catch { /* the next stroke will do */ }
        continue;
      }
      if (!bell.at || flat(bell.at) > BELL_RANGE) continue;
      const v = built.bells[bell.next];
      bell.next = (bell.next + 1) % built.bells.length;
      if (v.audio.buffer !== buf) v.audio.setBuffer(buf);
      v.audio.setVolume(q.half ? 0.55 : 0.9);
      fire(v, bell.at[0], bell.at[1], bell.at[2], rate);
    }
  }

  // The hour and the sky. Each bed's want is worked out here from the snapshot's hour, night, sky,
  // `woods` (how much forest is round the ears, 0..1) and `roofs` (how many buildings), and the
  // frame glides it there (glideHours). A bed is started on the first moment it is wanted and
  // stopped once it has glided to nothing, so a clear noon runs no rain at all.
  let sky = 'clear', wetAt = 0;
  const span = (h, a, b, c, d) => (h < a || h > d ? 0 : h < b ? (h - a) / (b - a) : h <= c ? 1 : (d - h) / (d - c));
  function steerHours(look, wet) {
    const H = built.hours;
    sky = typeof look.sky === 'string' ? look.sky : 'clear';
    wetAt = wet;
    const raining = sky === 'rain', foggy = sky === 'fog';
    const woods = clamp(look.woods || 0, 0, 1);
    const hour = Number.isFinite(look.hour) ? look.hour : 12;
    const night = clamp(look.night || 0, 0, 1);
    const out = !look.indoors;
    const land = 1 - wet;
    H.dawn.want = out && live('birds') ? DAWN_LOUD * span(hour, 4.6, 5.2, 8.5, 10) * land * (0.4 + 0.6 * woods)
      * (raining ? 0.3 : foggy ? 0.6 : 1) : 0;
    H.crickets.want = out && live('night') ? CRICKETS_LOUD * clamp((night - 0.5) * 2, 0, 1) * land * (raining ? 0 : 1) : 0;
    H.rain.want = raining && live('weather') ? (out ? RAIN_LOUD : 0) : 0;
    // On the roofs round you: brighter the more of them there are; indoors, the roof over your head.
    H.roofs.want = raining && live('weather') ? (out ? ROOFS_LOUD * clamp((look.roofs || 0) / 6, 0, 1) : ROOFS_LOUD * 0.9) : 0;
    H.roofs.filter.frequency.setTargetAtTime(out ? 6000 : 650, ctx.currentTime, 0.4);
    for (const [name, b] of Object.entries(H)) if (b.want > 0) need(name);
    rareBirds(look, woods, hour, night, out);
  }
  function glideHours(dt) {
    const k = 1 - Math.exp(-dt / 2.5);
    for (const [name, b] of Object.entries(built.hours)) {
      b.at += (b.want - b.at) * k;
      const buf = built.buffers[name];
      const a = b.audio;
      if (buf && a.buffer !== buf) a.setBuffer(buf);
      a.setVolume(b.at * (b.below ? 1 : duckOver()));
      if (b.at > 0.0005 && a.buffer && !a.isPlaying) a.play();
      else if (b.want <= 0 && b.at < 0.0005 && a.isPlaying) a.stop();
    }
  }
  // The beds that come from above the water go down as the listener does: sound goes badly
  // through the surface, so at the bottom of a dive the wind, the birds, the crickets and the rain
  // are a quarter of what they were - on top of the master's lowpass (setUnderwater).
  const duckOver = () => 1 - (1 - OVER_DEEP) * underwater;

  // An owl in the woods at night, a cuckoo in them by day, the foghorn in a fog: each on a slow
  // clock of its own, never in the first minute, and only where it belongs.
  const rare = { owl: OWL_GAP[0], cuckoo: CUCKOO_GAP[0], horn: FOGHORN_GAP[0] / 2 };
  function rareBirds(look, woods, hour, night, out) {
    rare.owl -= PICK_S; rare.cuckoo -= PICK_S; rare.horn -= PICK_S;
    const away = (r0, r1) => {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      return [camera.position.x + Math.cos(a) * r, camera.position.z + Math.sin(a) * r];
    };
    if (rare.owl <= 0) {
      rare.owl = OWL_GAP[0] + Math.random() * (OWL_GAP[1] - OWL_GAP[0]);
      if (out && night > 0.6 && woods > 0.15 && live('night') && need('owl')) {
        const [x, z] = away(16, 32);
        built.rare.audio.setBuffer(built.buffers.owl);
        fire(built.rare, x, 6, z, 0.95 + Math.random() * 0.1);
      }
    }
    if (rare.cuckoo <= 0) {
      rare.cuckoo = CUCKOO_GAP[0] + Math.random() * (CUCKOO_GAP[1] - CUCKOO_GAP[0]);
      if (out && night < 0.3 && hour > 7 && hour < 19 && woods > 0.2 && sky !== 'rain' && live('birds') && need('cuckoo')) {
        const [x, z] = away(14, 28);
        built.rare.audio.setBuffer(built.buffers.cuckoo);
        fire(built.rare, x, 7, z, 0.97 + Math.random() * 0.06);
      }
    }
    if (rare.horn <= 0) {
      rare.horn = FOGHORN_GAP[0] + Math.random() * (FOGHORN_GAP[1] - FOGHORN_GAP[0]);
      const at = look.lighthouse;
      if (sky === 'fog' && at && flat(at) < HORN_RANGE && live('weather') && need('foghorn')) {
        built.horn.audio.setBuffer(built.buffers.foghorn);
        // Through a wall the horn is still the horn, only further off.
        built.horn.audio.setVolume(out ? 0.8 : 0.25);
        fire(built.horn, at[0], at[1] + 6, at[2], 1);
      }
    }
    // Asked for while the sky or the hour is right, so the first call is not lost to its buffer.
    if (night > 0.6 && woods > 0.15) need('owl');
    if (night < 0.3 && woods > 0.2) need('cuckoo');
    if (sky === 'fog' && look.lighthouse) need('foghorn');
  }

  // The river, the volcano and the sea from underneath. `look.river` and `look.lava` are the nearest
  // point of a river or a flow ([x, y, z], main.js measures them), `look.crater` where the volcano
  // stands; the under-sea bed follows the lens's own 0..1 (setUnderwater), and a bubble burbles
  // whenever the bubbles the divers breathe out (sea-life.js `emitted`, a cue) have gone up.
  let bubbledSeen = null, bubbleAt = -Infinity;
  function steerWater(look) {
    const out = !look.indoors;
    const H = built.hours;
    const crater = look.crater;
    const dc = crater ? flat(crater) : Infinity;
    H.rumble.want = out && crater && live('water') ? RUMBLE_LOUD * Math.pow(clamp(1 - dc / RUMBLE_RANGE, 0, 1), 2) : 0;
    H.under.want = live('underwater') ? UNDER_LOUD * underwater : 0;
    if (H.rumble.want > 0) need('rumble');
    if (H.under.want > 0) need('under');
    for (const [name, range, at] of [['river', RIVER_RANGE, look.river], ['lava', LAVA_RANGE, look.lava]]) {
      const v = built[name];
      const d = at ? flat(at) : Infinity;
      v.want = out && at && live('water') && d < range ? 0.45 * edge(d, range) * duckOver() : 0;
      if (at) v.holder.position.set(at[0], at[1] + 0.2, at[2]);
      loopTo(v, v.want > 0 || v.audio.isPlaying ? need(name) : null, v.want);
      if (at) v.holder.updateMatrixWorld(true);
    }
    const n = Number.isFinite(look.bubbled) ? look.bubbled : null;
    if (n != null && bubbledSeen != null && n > bubbledSeen && underwater > 0.5 && live('underwater')) {
      const buf = need('bubble');
      if (buf && clock - bubbleAt > 0.35) {
        bubbleAt = clock;
        const a = built.bubbles.audio;
        if (a.buffer !== buf) a.setBuffer(buf);
        if (a.isPlaying) { try { a.stop(); } catch { /* it had finished */ } }
        a.setVolume(0.3 + Math.random() * 0.2);
        a.setPlaybackRate(0.85 + Math.random() * 0.4);
        try { a.play(); } catch { /* the next breath will do */ }
      }
    }
    if (underwater > 0.3) need('bubble');
    bubbledSeen = n;
  }

  // The rounds (look.rounds, from main.js roundCues): the wagon's stage and its horse, the gold run's
  // cart and the pit's bar count, and each fisherman's `bites` - every one a cue the drawing
  // module already keeps for itself. Hooves and wheels while the horse walks, timber thrown down
  // while it loads and unloads, a tink for every bar that lands on the pit, and for a bite the
  // swish of the strike and, a moment after, the float.
  const roundsSeen = { bars: null, bites: new Map(), plops: [] };
  let hoofAt = 0, plankAt = 0;
  function roundShot(name, at, volume, rate = 0.9 + Math.random() * 0.2) {
    const buf = need(name);
    if (!buf || !at || flat(at) > ROUND_RANGE) return;
    const v = built.rounders.find((s) => !s.audio.isPlaying) || built.rounders[0];
    if (v.audio.buffer !== buf) { if (v.audio.isPlaying) v.audio.stop(); v.audio.setBuffer(buf); }
    v.audio.setVolume(volume * edge(flat(at), ROUND_RANGE));
    fire(v, at[0], at[1] + 0.3, at[2], rate);
  }
  function steerRounds(look) {
    const r = look.rounds || {};
    const ok = !look.indoors && live('rounds');
    const wagon = ok && r.wagon && r.wagon.at && flat(r.wagon.at) < ROUND_RANGE ? r.wagon : null;
    const gold = ok && r.gold && r.gold.at && flat(r.gold.at) < ROUND_RANGE ? r.gold : null;
    if (wagon) { need('hoof'); need('plank'); }
    // The wheels: whichever is rolling nearer.
    const rolling = [wagon && (wagon.stage === 'out' || wagon.stage === 'back') ? wagon.at : null, gold && gold.moving ? gold.at : null]
      .filter(Boolean).sort((a, b) => flat(a) - flat(b))[0] || null;
    const c = built.cart;
    c.want = rolling ? 0.4 * edge(flat(rolling), ROUND_RANGE) : 0;
    c.walking = !!(wagon && (wagon.stage === 'out' || wagon.stage === 'back'));
    c.wagon = wagon;
    if (rolling) c.holder.position.set(rolling[0], rolling[1] + 0.3, rolling[2]);
    loopTo(c, c.want > 0 || c.audio.isPlaying ? need('cart') : null, c.want);
    if (rolling) c.holder.updateMatrixWorld(true);
    // Bars landing on the pit: the count going up while a run delivers.
    if (Number.isFinite(r.bars)) {
      if (ok && r.pit && flat(r.pit) < ROUND_RANGE) need('load');
      if (roundsSeen.bars != null && r.bars > roundsSeen.bars && ok && r.pit) roundShot('load', r.pit, 0.45, 1.1);
      roundsSeen.bars = r.bars;
    }
    for (const fish of ok ? r.fishers || [] : []) {
      const was = roundsSeen.bites.get(fish.id);
      roundsSeen.bites.set(fish.id, fish.bites);
      need('swish'); need('plop');
      if (was == null || !(fish.bites > was)) continue;
      roundShot('swish', fish.at, 0.5);
      roundsSeen.plops.push({ t: clock + PLOP_AFTER, at: fish.float || fish.at });
    }
  }
  function rounds() {
    const c = built.cart;
    if (c.walking && c.wagon && clock >= hoofAt) {
      hoofAt = clock + HOOF_EVERY * (0.94 + Math.random() * 0.12);
      roundShot('hoof', c.wagon.at, 0.45, 0.85 + Math.random() * 0.3);
    }
    const w = c.wagon;
    if (w && (w.stage === 'load' || w.stage === 'unload') && clock >= plankAt) {
      plankAt = clock + 2.2 + Math.random() * 1.6;
      roundShot('plank', w.at, 0.55);
    }
    while (roundsSeen.plops.length && clock >= roundsSeen.plops[0].t) roundShot('plop', roundsSeen.plops.shift().at, 0.45);
  }

  // The animals. Story animals (look.animals: { id, species, act, at }) by their act word, diffed like
  // a cue - a word that changed to one with a sound is heard once, and the first sighting only
  // remembers; the ambient flocks and the stable (look.herds: { id, kind, at }) each on a clock of
  // its own, started at a random point so a field of sheep does not bleat in step. Nearest first,
  // at most ANIMALS voices and one call every ANIMAL_GAP seconds on the island. Daylight only for
  // the ambient ones: a field at night is asleep.
  const lastAct = new Map();
  const nextCall = new Map();
  let calledAt = -Infinity;
  function animalSay(buf, at, volume, rate) {
    if (!buf || clock - calledAt < ANIMAL_GAP) return false;
    calledAt = clock;
    const v = built.animals.find((s) => !s.audio.isPlaying) || built.animals[0];
    if (v.audio.buffer !== buf) { if (v.audio.isPlaying) v.audio.stop(); v.audio.setBuffer(buf); }
    v.audio.setVolume(volume);
    fire(v, at[0], at[1] + 0.3, at[2], rate);
    return true;
  }
  function steerAnimals(look) {
    if (look.indoors || !live('birds')) return;
    const story = (look.animals || []).filter((a) => a && a.at && flat(a.at) < ANIMAL_RANGE)
      .sort((a, b) => flat(a.at) - flat(b.at));
    for (const a of story) {
      const was = lastAct.get(a.id);
      lastAct.set(a.id, a.act);
      const words = ACT_SOUNDS[a.species] || {};
      const word = words[a.act];
      if (word) need(ACT_ALIAS[word] || word);
      if (was === undefined || was === a.act || !word) continue;
      animalSay(built.buffers[ACT_ALIAS[word] || word], a.at, 0.6 * edge(flat(a.at), ANIMAL_RANGE), 0.92 + Math.random() * 0.16);
    }
    if (lastAct.size > 64) lastAct.clear();
    if ((look.night || 0) > 0.5) return;
    const herd = (look.herds || []).filter((a) => a && a.at && CALLS[a.kind] && flat(a.at) < ANIMAL_RANGE)
      .sort((a, b) => flat(a.at) - flat(b.at)).slice(0, 12);
    for (const a of herd) {
      const c = CALLS[a.kind];
      need(c.buf);
      if (!nextCall.has(a.id)) nextCall.set(a.id, clock + Math.random() * c.every);
      if (clock < nextCall.get(a.id)) continue;
      nextCall.set(a.id, clock + c.every * (0.6 + Math.random() * 0.8));
      animalSay(built.buffers[c.buf], a.at, 0.55 * edge(flat(a.at), ANIMAL_RANGE), 0.9 + Math.random() * 0.2);
    }
    if (nextCall.size > 256) nextCall.clear();
  }

  // The workshops (look.crafts, from main.js craftCues): each a cue that this module diffs against
  // what it saw last pick. A counter that went up is a blow that landed (the smith's and the
  // butcher's `hits`); a word that changed is a step of the work (the baker's `phase`); `cutting` is
  // the sawmill's state. The first sighting of a workshop only remembers - a counter that was 312
  // when you walked up is not 312 blows.
  const seenCraft = new Map();
  function steerCrafts(look) {
    const cues = look.indoors || !live('work') ? [] : (look.crafts || []);
    let saw = null, sawD = SAW_RANGE;
    for (const c of cues) {
      if (!c || !c.at) continue;
      const d = flat(c.at);
      if (c.kind === 'saw') { if (d < sawD) { saw = c; sawD = d; } continue; }
      const was = seenCraft.get(c.id);
      seenCraft.set(c.id, { hits: c.hits, phase: c.phase });
      if (d > CRAFT_RANGE) continue;
      if (c.kind === 'smith' || c.kind === 'butcher') need(c.kind === 'smith' ? 'anvil' : 'cleaver');
      if (c.kind === 'baker') { need('oven'); need('thud'); }
      if (!was) continue;
      let buf = null, volume = 0.6, rate = 1;
      if ((c.kind === 'smith' || c.kind === 'butcher') && c.hits > was.hits) {
        buf = built.buffers[c.kind === 'smith' ? 'anvil' : 'cleaver'];
        rate = 0.95 + Math.random() * 0.1;
      } else if (c.kind === 'baker' && c.phase !== was.phase) {
        if (c.phase === 'bake') buf = built.buffers.oven;
        else if (c.phase === 'rest') { buf = built.buffers.thud; volume = 0.4; }
      }
      if (!buf) continue;
      const v = built.crafts.find((s) => !s.audio.isPlaying) || built.crafts[0];
      if (v.audio.buffer !== buf) { if (v.audio.isPlaying) v.audio.stop(); v.audio.setBuffer(buf); }
      v.audio.setVolume(volume * edge(d, CRAFT_RANGE));
      fire(v, c.at[0], c.at[1], c.at[2], rate);
    }
    if (seenCraft.size > 64) seenCraft.clear();
    // The saw: the nearest mill's blade, idling or under load.
    const s = built.saw;
    s.want = saw ? (saw.cutting ? 0.32 : 0.13) * edge(sawD, SAW_RANGE) : 0;
    if (saw) {
      s.holder.position.set(saw.at[0], saw.at[1], saw.at[2]);
      s.filter.frequency.setTargetAtTime(saw.cutting ? 5200 : 2400, ctx.currentTime, 0.15);
      s.audio.setPlaybackRate(saw.cutting ? 1.06 : 1);
    }
    loopTo(s, s.want > 0 || s.audio.isPlaying ? need('saw') : null, s.want);
    if (saw) s.holder.updateMatrixWorld(true);
  }

  // The crowd at work beside the hammers: the nearest few whose word makes a noise, sticky per
  // settler like the hammer slots, each heard at its word's own tempo.
  function steerWorkers(look) {
    const rows = [];
    if (!look.indoors && live('work')) {
      for (const crowd of look.crowds) {
        if (!crowd) continue;
        for (const f of crowd.values()) {
          if (!f.visible || f.hidden || !WORK_SOUNDS[f.anim]) continue;
          const dx = f.pos[0] - camera.position.x, dz = f.pos[1] - camera.position.z;
          if (dx * dx + dz * dz > WORK_RANGE * WORK_RANGE) continue;
          rows.push({ id: f.id, origin: f.pos, f });
        }
      }
    }
    const want = nearestFirst(rows, [camera.position.x, camera.position.z]).slice(0, WORKERS);
    const wanted = new Set(want.map((r) => r.id));
    for (const slot of built.workers) if (!wanted.has(slot.id)) { slot.id = null; slot.f = null; }
    for (const row of want) {
      need(WORK_SOUNDS[row.f.anim].buf);
      if (built.workers.some((s) => s.id === row.id)) continue;
      const free = built.workers.find((s) => s.id === null);
      if (!free) break;
      free.id = row.id;
      free.f = row.f;
      free.next = clock + ((row.f.phase || 0) / (2 * Math.PI)) * WORK_SOUNDS[row.f.anim].every;
    }
  }
  function work() {
    for (const slot of built.workers) {
      if (!slot.id || clock < slot.next || !live('work')) continue;
      const f = slot.f, kind = WORK_SOUNDS[f.anim];
      if (!f.visible || f.hidden || !kind) continue;
      slot.next = clock + kind.every * (0.92 + Math.random() * 0.16);
      const buf = built.buffers[kind.buf];
      if (!buf) continue;
      if (slot.audio.buffer !== buf) { if (slot.audio.isPlaying) slot.audio.stop(); slot.audio.setBuffer(buf); }
      slot.audio.setVolume(kind.volume);
      fire(slot, f.pos[0], (f.y || 0) + 0.4, f.pos[1], 0.9 + Math.random() * 0.2);
    }
  }

  // Hello (greetings.js): who to say it is the greeter's, how it sounds is ours. The phrases are
  // three small buffers, asked for the first time our settlers are about outside, and nobody is
  // asked to say anything until all of them exist - or the first hello would be spent (the greeter
  // keeps its cooldown) on a voice with nothing to play.
  const greeter = createGreeter();
  function greet(look) {
    const ours = look.ours;
    if (!ours || look.indoors || !live('greetings')) return;
    let ready = true;
    for (let k = 0; k < PHRASES; k++) if (!need(`greet${k}`)) ready = false;
    if (!ready) return;
    const lines = greeter.pick({ now: clock, walker: look.walker || null, figures: ours.values(), ear: [camera.position.x, camera.position.z] });
    for (const g of lines) {
      const buf = built.buffers[`greet${g.phrase}`];
      const v = built.greeters.find((s) => !s.audio.isPlaying) || built.greeters[0];
      if (v.audio.buffer !== buf) { if (v.audio.isPlaying) v.audio.stop(); v.audio.setBuffer(buf); }
      v.id = g.id;
      // Two of them passing in the street are further off and talking to each other, not to you.
      v.audio.setVolume(g.to === 'you' ? 0.7 : 0.45);
      fire(v, g.at[0], g.at[1], g.at[2], g.rate);
      greeted++;
    }
  }
  let greeted = 0;

  // A glass set down now and then wherever it is busy: at a tavern's door (through the same
  // wall as its murmur), in the room you are in, on the square at the borrel. Per frame rather
  // than per pick, on a timer per place whose gap shrinks as the place fills up.
  function gap(full) {
    return (CLINK_GAP[0] + Math.random() * (CLINK_GAP[1] - CLINK_GAP[0])) / (0.4 + full);
  }
  function clinks(dt) {
    if (!live('tavern') && !live('borrel')) return;
    for (const pub of Object.values(built.pubs)) {
      if (!(pub.want > 0.02) && !pub.inside) continue;
      pub.clinkIn -= dt;
      if (pub.clinkIn > 0) continue;
      pub.clinkIn = gap(pub.inside ? 1 : pub.full);
      const rate = 0.85 + Math.random() * 0.4;
      if (pub.inside) {
        const a = built.clinkRoom.audio;
        if (a.isPlaying) { try { a.stop(); } catch { /* it had already ended */ } }
        a.setVolume(0.25 + Math.random() * 0.25);
        a.setPlaybackRate(rate);
        try { a.play(); } catch { /* the next glass will do */ }
      } else if (pub.at) {
        const v = built.clinks.find((c) => !c.audio.isPlaying) || built.clinks[0];
        v.audio.setVolume((0.3 + 0.5 * pub.full) * edge(pub.d, TAVERN_RANGE));
        v.filter.frequency.value = pub.out.filter.frequency.value * 2.5;
        fire(v, pub.at[0] + (Math.random() - 0.5) * 1.2, pub.at[1] + 1, pub.at[2] + (Math.random() - 0.5) * 1.2, rate);
      }
    }
    const b = built.borrel;
    if (b.want > 0.02 && b.at && live('borrel')) {
      b.clinkIn -= dt;
      if (b.clinkIn <= 0) {
        b.clinkIn = gap(b.friday ? 1.6 : 0.8);
        const v = built.borrelClinks.find((c) => !c.audio.isPlaying) || built.borrelClinks[0];
        const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 5;
        fire(v, b.at[0] + Math.cos(a) * r, b.at[1] + 1, b.at[2] + Math.sin(a) * r, 0.85 + Math.random() * 0.4);
      }
    }
  }

  function repick(look) {
    inside = !!look.indoors;
    steerPubs(look);
    steerBorrel(look);
    steerBell(look);
    greet(look);
    steerCrafts(look);
    steerWorkers(look);
    steerAnimals(look);
    steerWater(look);
    steerRounds(look);
    steerRave(look.rave || null);
    steerShanty(look.shanty || null);
    steerTavern(look.tavern || null);

    // --- the bed ---
    const wet = coastliness(look);
    // Overcast and rain blow a step harder, and lower; a fog takes the edge off everything.
    const sk = typeof look.sky === 'string' ? look.sky : 'clear';
    const windy = sk === 'rain' ? 1.5 : sk === 'overcast' ? 1.25 : sk === 'fog' ? 0.7 : 1;
    // In the woods the leaves join in: more of the wind's own brightness is let through.
    const woods = clamp(look.woods || 0, 0, 1);
    bed.seaWant = SEA_QUIET + (SEA_LOUD - SEA_QUIET) * wet;
    bed.windWant = (WIND_LOUD + (WIND_QUIET - WIND_LOUD) * wet) * windy * (1 + 0.3 * woods);
    // Night takes the top off as well as turning it down: after dark the sea is further
    // away and the wind is in the trees rather than in your ears.
    const night = clamp(look.night || 0, 0, 1);
    bed.duckWant = (1 - night * (1 - NIGHT_DUCK)) * (look.indoors ? INDOOR_DUCK : 1) * (sk === 'fog' ? 0.75 : 1);
    const dull = sk === 'fog' ? 0.6 : sk === 'rain' || sk === 'overcast' ? 0.8 : 1;
    const cut = look.indoors ? 700 : (7000 - night * 4200) * dull;
    built.sea.filter.frequency.setTargetAtTime(cut, ctx.currentTime, 0.6);
    built.wind.filter.frequency.setTargetAtTime(cut * (1 + 0.4 * woods), ctx.currentTime, 0.6);
    steerHours(look, wet);

    // --- the hammers ---
    // Indoors nobody outside is worth hearing, and the bed is already down to a fifth.
    const want = look.indoors || !live('work') ? [] : builders(look);
    const wanted = new Set(want.map((r) => r.id));
    for (const slot of built.hammers) if (!wanted.has(slot.id)) { slot.id = null; slot.f = null; }
    for (const row of want) {
      if (built.hammers.some((s) => s.id === row.id)) continue;
      const free = built.hammers.find((s) => s.id === null);
      if (!free) break;
      free.id = row.id;
      free.f = row.f;
      // The first blow lands on the settler's own phase, so four builders in a row do not
      // strike together. `f.phase` was drawn from the `<id>:gait` stream by
      // settler-figures.js - read here, never drawn again, and never from the walk's own
      // stream, which is ordered and load-bearing.
      free.next = clock + ((row.f.phase || 0) / (2 * Math.PI)) / HAMMER_HZ;
    }
  }

  // A cry over the water, on its own slow clock. Daylight only: a gull calling at two in
  // the morning is a different bird and a worse island.
  function maybeGull(look, dt) {
    nextGull -= dt;
    if (nextGull > 0) return;
    nextGull = GULL_GAP[0] + Math.random() * (GULL_GAP[1] - GULL_GAP[0]);
    if (look.indoors || (look.night || 0) > 0.3 || !live('birds')) return;
    // Over the gulls herds.js has wheeling about, when there are some within reach; else over the
    // nearest quay head, as it always was.
    const spots = [...(look.herds || []).filter((a) => a && a.kind === 'gull' && a.at).map((a) => [a.at[0], a.at[2]]), ...(look.quays || [])];
    if (!spots.length) return;
    let best = null, bestD = GULL_RANGE * GULL_RANGE;
    for (const q of spots) {
      const dx = q[0] - camera.position.x, dz = q[1] - camera.position.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = q; }
    }
    if (!best) return;
    const voice = built.gulls.find((g) => !g.audio.isPlaying) || built.gulls[0];
    // Somewhere over the water off the end of the planks, and well up: a gull heard from
    // the height of a fence post is a chicken.
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 16;
    fire(voice, best[0] + Math.cos(a) * r, 7 + Math.random() * 7, best[1] + Math.sin(a) * r,
      0.9 + Math.random() * 0.3);
  }

  function update(dt) {
    // The whole cost of a silent island: one comparison a frame.
    if (!on || !built || ctx.state !== 'running') return;
    clock += dt;
    fade += dt;

    since += dt;
    let look = null;
    if (since >= PICK_S) { since = 0; look = island(); repick(look); }

    // The bed slides towards whatever the last pick asked for. Per frame rather than per
    // pick, so a walk down to the coast is a slope and not six steps a second.
    const k = 1 - Math.exp(-dt / 2.5);
    bed.seaAt += (bed.seaWant - bed.seaAt) * k;
    bed.windAt += (bed.windWant - bed.windAt) * k;
    bed.duckAt += (bed.duckWant - bed.duckAt) * (1 - Math.exp(-dt / 0.8));
    // Under the sea the surf is a dull rush (the master's lowpass does the dulling) and the wind is
    // nearly gone: it is a bed from above the water.
    built.sea.audio.setVolume(bed.seaAt * bed.duckAt * (1 - 0.4 * underwater));
    built.wind.audio.setVolume(bed.windAt * bed.duckAt * duckOver());
    // And the master comes up over a second and a half, because a bed that arrives all at
    // once reads as a fault rather than as an island - to the Master slider, not past it.
    const master = Math.min(1, fade / 1.5) * mix.master;
    if (master !== masterAt) { masterAt = master; listener.setMasterVolume(master); }

    if (look) maybeGull(look, PICK_S);
    clinks(dt);
    strike();
    work();
    glideHours(dt);
    rounds();
    makeMore();

    // The blows. Four `if`s a frame at the very worst, which is what a hard cap buys.
    for (const slot of built.hammers) {
      if (!slot.id || clock < slot.next || !live('work')) continue;
      const f = slot.f;
      // A little off true, per blow: four hammers on the same machine-cut beat is a
      // factory, and the settlers' own gait is jittered for exactly the same reason.
      slot.next = clock + 1 / HAMMER_HZ + (Math.random() - 0.5) * 0.09;
      if (!f.visible || f.hidden || f.anim !== 'hammer') continue;
      fire(slot, f.pos[0], (f.y || 0) + 0.8, f.pos[1], 0.86 + Math.random() * 0.3);
    }
  }

  // Build and resume, but only once the page has been touched. Called from the switch (a
  // click is a gesture) and from the gesture listener below (for somebody who left it on
  // last time). Before either, there is no context and nothing to suspend.
  function start() {
    if (!gestured || !soundPossible()) return;
    if (!built) build();
    fade = 0;
    masterAt = -1;
    since = PICK_S;
    nextGull = GULL_GAP[0];                     // never a gull in the first breath
    ctx.resume().catch(() => { /* the browser said no; the next gesture asks again */ });
  }

  function setOn(next) {
    if (!soundPossible()) return false;
    const want = !!next;
    if (want === on) return on;
    on = want;
    remember(on);
    if (on) { start(); return on; }
    // The graph is kept, so switching back on is instant, and the context is suspended,
    // so a switched-off island costs no audio thread at all.
    if (listener) listener.setMasterVolume(0);
    masterAt = -1;
    if (ctx) ctx.suspend().catch(() => { /* already gone */ });
    return on;
  }

  // Settings -> Audio. One slider or one part: kept per browser (saveMix, only what differs from
  // the default) and heard at once - the bus or part node glides there, and the master is set on
  // the next frame. Works with the sound off and before the graph exists: then it is only kept,
  // and build() starts every node where the mix says.
  function setMix(key, value) {
    const v = clampMix(key, value);
    if (v == null) return false;
    mix[key] = v;
    saveMix(key, v);
    applyMix();
    return true;
  }
  function resetMix() {
    const fresh = loadMix(null);
    for (const k of Object.keys(fresh)) { mix[k] = fresh[k]; saveMix(k, fresh[k]); }
    applyMix();
  }
  function applyMix() {
    masterAt = -1;
    if (!built) return;
    const now = ctx.currentTime;
    for (const b of MIX_BUSES) built.buses[b].gain.setTargetAtTime(mix[b], now, 0.05);
    for (const [id] of MIX_PARTS) built.parts[id].gain.setTargetAtTime(mix[id] ? 1 : 0, now, 0.05);
  }

  // The first touch of the page. Registered at construction and capturing, so it sees the
  // pointerdown that precedes the Sound chip's own click - which means that by the time
  // the chip's handler runs, a context may legally be made.
  const gesture = () => {
    gestured = true;
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) removeEventListener(ev, gesture, true);
    if (on) start();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) addEventListener(ev, gesture, true);

  // Out of earshot while the tab is in the background. Not a nicety: a browser that keeps
  // a hidden tab's audio running is a village murmuring out of a window nobody can see.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { ctx.suspend().catch(() => {}); return; }
    if (!on) return;
    ctx.resume().catch(() => {});
    // three.js moves the listener with `linearRampToValueAtTime(..., now + clock.getDelta())`,
    // and that clock runs on performance.now(), which does not stop when the tab does. The
    // first update after ten minutes hidden would otherwise schedule a ten-minute ramp and
    // leave the panning stuck where it was. This call eats the stale delta while the graph
    // is still silent; the render loop's own call, a frame later, is the short one that
    // lands.
    listener.updateMatrixWorld(true);
  });

  const songStats = (kind) => (built && built[kind] ? {
    making: !!built[kind].making,
    playing: built[kind].audio.isPlaying,
    want: Math.round(built[kind].want * 100) / 100,
    cut: Math.round(built[kind].filter.frequency.value),
  } : null);

  // Every placed voice by family, which is the ceiling `cap` counts - built once, at these
  // lengths, and never again. And the beds: the voices with no place (the sea, the wind, the two
  // rooms' murmur and the glass in the room you are in; the songs are counted on their own).
  const FAMILIES = {
    hammer: HAMMERS, gull: GULLS, pub: 2, clink: CLINKS, borrel: 1 + CLINKS, bell: BELLS, greet: GREETERS,
    craft: CRAFTS + 1, worker: WORKERS, rare: 2, animal: ANIMALS, water: 2, round: ROUNDERS + 1,
  };
  const CAP = Object.values(FAMILIES).reduce((a, b) => a + b, 0);
  function familyVoices() {
    return {
      hammer: built.hammers, gull: built.gulls,
      pub: Object.values(built.pubs).map((p) => p.out),
      clink: built.clinks, borrel: [built.borrel, ...built.borrelClinks], bell: built.bells,
      greet: built.greeters,
      craft: [...built.crafts, built.saw], worker: built.workers, rare: [built.rare, built.horn],
      animal: built.animals, water: [built.river, built.lava], round: [...built.rounders, built.cart],
    };
  }
  const placedVoices = () => Object.values(familyVoices()).flat();
  const flatVoices = () => [built.sea, built.wind, ...Object.values(built.pubs).map((p) => p.in), built.clinkRoom, built.bellRoom,
    ...Object.values(built.hours), built.bubbles];
  function families() {
    const out = {};
    for (const [name, voices] of Object.entries(familyVoices())) {
      out[name] = {
        cap: FAMILIES[name],
        placed: voices.filter((v) => v.id || v.audio.isPlaying).length,
        playing: voices.filter((v) => v.audio.isPlaying).length,
      };
    }
    return out;
  }

  const api = {
    // What the person asked for, which is what the chip draws. Not whether a note is being
    // played: the two differ for exactly as long as it takes somebody who left it on to
    // touch the page.
    get on() { return on; },
    get possible() { return soundPossible(); },
    setOn,
    toggle: () => setOn(!on),
    update,
    raveClock,
    shantyClock,
    // The keeper's own tracks per song ({ rave, shanty, tavern }: urls), from main.js's /api/music.
    setPlaylists,
    // The clock of a room's song by its name (interior.js `music`), or null.
    clockOf: (kind) => (kind === 'rave' ? raveClock() : kind === 'shanty' ? shantyClock() : null),
    // Under the sea, 0..1: the master bus goes through water (see applyMuffle).
    setUnderwater,
    // Settings -> Audio (sound-mix.js): a slider or a part, kept per browser and heard at once.
    setMix,
    resetMix,
    mix: () => ({ ...mix }),
    // There is nothing to hear from a test and nothing to see in a screenshot, so the only
    // way to check the two promises this module makes - that nothing exists before the
    // gesture, and that a village of three hundred is still nine sources - is to read them
    // back from the console. web/js/demo.js hangs `window.__sheet` out for the same reason.
    stats: () => ({
      on,
      gestured,
      built: !!built,
      context: ctx ? ctx.state : null,
      // The ceiling, and what is actually standing. These two are equal by construction:
      // every pool is built once, at its length, and nothing here allocates a voice again.
      cap: CAP,
      // How far under the sea the listener is, and where the master lowpass has been sent.
      underwater: Math.round(underwater * 100) / 100,
      muffle: Math.round(muffleAt),
      voices: built ? placedVoices().length : 0,
      bedSources: built ? flatVoices().length : 0,
      // Per family: the ceiling, how many have a place this moment and how many are sounding.
      families: built ? families() : null,
      // Settings -> Audio as this module holds it, and what each bus and part node is set to.
      mix: { ...mix },
      buses: built ? Object.fromEntries(MIX_BUSES.map((b) => [b, Math.round(built.buses[b].gain.value * 100) / 100])) : null,
      pubs: built ? Object.fromEntries(Object.entries(built.pubs).map(([k, p]) => [k, {
        want: Math.round(p.want * 100) / 100, busy: p.busy, inside: !!p.inside,
        playing: p.out.audio.isPlaying, inPlaying: p.in.audio.isPlaying, cut: Math.round(p.out.filter.frequency.value),
      }])) : null,
      borrel: built ? { want: Math.round(built.borrel.want * 100) / 100, playing: built.borrel.audio.isPlaying } : null,
      making: built ? Object.keys(built.making) : [],
      // The bell: strokes still to come this hour, and the minute of the sea's clock it last saw.
      bell: { queued: bell.queue.length, minute: bell.min },
      // How many hellos this page has said.
      greeted,
      // The hour's and the sky's beds: where each has glided to.
      hours: built ? Object.fromEntries(Object.entries(built.hours).map(([k, b]) => [k, Math.round(b.at * 1000) / 1000])) : null,
      sky,
      // Where the bed has got to, rounded. The only way to see that the sea comes up as
      // you walk down to it and goes quiet again after dark, short of having ears.
      bed: {
        sea: Math.round(bed.seaAt * 1000) / 1000,
        wind: Math.round(bed.windAt * 1000) / 1000,
        duck: Math.round(bed.duckAt * 100) / 100,
      },
      playing: built ? placedVoices().filter((v) => v.audio.isPlaying).length : 0,
      hammering: built ? built.hammers.filter((h) => h.id).length : 0,
      working: built ? built.workers.filter((h) => h.id).length : 0,
      // The population the last pick walked, and how much of it was at work. `crowd` may
      // be three hundred and `voices` is still seven.
      crowd: seen,
      atWork: working,
      buffers: built ? Object.keys(built.buffers).length : 0,
      // The rave is a bed rather than a placed voice, and it exists only once somebody has
      // been near the castle on a Saturday night: null until then.
      rave: songStats('rave'),
      // The Salty Kraken's shanty, the same way: null until somebody has been near the harbour.
      shanty: songStats('shanty'),
      // The keeper's own tracks, per song that has some: which is playing and how loud.
      tracks: built && built.tracks ? Object.fromEntries(Object.entries(built.tracks).map(([k, t]) => [k, {
        playing: t.playing, index: t.index, src: t.el.src, want: Math.round(t.want * 100) / 100,
        cut: Math.round(t.filter.frequency.value),
      }])) : null,
    }),
  };
  if (typeof window !== 'undefined') window.__sound = api;
  return api;
}

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
// allocated once, at build time, and nothing ever allocates a second one. Four hammers,
// two gulls, one tavern, two bed loops: nine sources, whatever the population. Which four
// hammers is decided by `nearestFirst` from shared/regions.mjs - the same ordering
// main.js already uses to decide which islands get drawn whole, rather than a second one
// that could disagree with it.
//
// A fourth rule, softer, about taste: quiet and sparse beats busy. A gull cries once every
// half minute or so and only in daylight over the quay; the tavern only hums when there is
// somebody at the tables. If you are unsure whether you can hear it, that is roughly right.
import * as THREE from 'three';
import { nearestFirst } from 'shared/regions.mjs';
import { makeRng, clamp } from 'shared/rng.mjs';

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
const TAVERN_RANGE = 60;

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
const SEA_LOUD = 0.26;
const SEA_QUIET = 0.05;          // the same sea heard from the middle of the island
const WIND_LOUD = 0.085;         // inland, in the open
const WIND_QUIET = 0.035;        // down at the water, where the surf covers it

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
function surfBuffer(ctx, secs = 10) {
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
function windBuffer(ctx, secs = 12) {
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
function murmurBuffer(ctx, secs = 6) {
  const sr = BED_SR;
  const len = Math.floor(sr * secs);
  const fade = Math.floor(sr * 0.5);
  const n = len + fade;
  const out = new Float32Array(n);
  // Syllables per loop rather than per second, so every voice's gating is periodic in the
  // loop and the seam has nothing to hide. 19..29 over six seconds is 3.2 to 4.8 a second,
  // which is about the rate of speech you cannot make out the words of.
  const RATES = [19, 21, 23, 26, 29];
  for (let v = 0; v < RATES.length; v++) {
    const rng = makeRng(`murmur:${v}`);
    const k = RATES[v];
    const f = 230 + v * 95 + rng.range(-25, 25);
    const band = resonate(noise(n, rng), sr, f, 2.2);
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
  }
  // Through the door. Everything above 900 Hz is what would let you make out a word, and
  // a tavern you can make out words in is a tavern you are standing inside.
  const muffled = lowpass(out, sr, 900);
  const chs = [seam(muffled, len, fade)];
  level(chs, 0.14);
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
export function createSound({ camera, scene, island }) {
  let on = soundPossible() && remembered();
  let gestured = false;          // the browser will not start a context before this
  let ctx = null;
  let listener = null;
  let built = null;              // everything the graph owns, once it exists
  let since = PICK_S;            // forces a pick on the first frame after switching on
  let nextGull = GULL_GAP[0];
  let clock = 0;                 // seconds the graph has run; the hammers keep time by it
  let fade = 0;                  // seconds since the switch was last thrown on

  // What the last snapshot asked for, and where the bed has actually got to. Two numbers
  // rather than one because the bed crossfades over seconds: walking from the middle of
  // the island down to the beach should bring the sea up the way the ground comes down,
  // not switch it on at the waterline.
  const bed = { seaWant: 0, seaAt: 0, windWant: 0, windAt: 0, duckWant: 1, duckAt: 1 };

  function build() {
    listener = new THREE.AudioListener();
    ctx = listener.context;
    camera.add(listener);
    listener.setMasterVolume(0);          // brought up by update(), so a switch is not a thump

    const buffers = {
      surf: surfBuffer(ctx),
      wind: windBuffer(ctx),
      murmur: murmurBuffer(ctx),
      hammer: hammerBuffer(ctx),
      gull: gullBuffer(ctx),
    };

    // The bed. Not positional: it is the weather, it has no place on the island, and a
    // panner on it would swing the sea round your head every time you turned the camera.
    const mkBed = (buffer) => {
      const a = new THREE.Audio(listener);
      a.setBuffer(buffer);
      a.setLoop(true);
      a.setVolume(0);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 7000;
      filter.Q.value = 0.7;
      a.setFilters([filter]);
      a.play();
      return { audio: a, filter };
    };

    // Everything with a place on the island hangs off one group, so a panner can be
    // brought up to date with a single updateMatrixWorld - which matters indoors, where
    // this scene is not the one being rendered and three.js updates nobody in it.
    const anchor = new THREE.Group();
    scene.add(anchor);

    const mkVoice = (buffer, { ref, rolloff, volume }) => {
      const holder = new THREE.Object3D();
      const a = new THREE.PositionalAudio(listener);
      a.setBuffer(buffer);
      a.setRefDistance(ref);
      a.setRolloffFactor(rolloff);
      a.setDistanceModel('exponential');
      a.setVolume(volume);
      holder.add(a);
      anchor.add(holder);
      return { holder, audio: a };
    };

    built = {
      buffers,
      anchor,
      sea: mkBed(buffers.surf),
      wind: mkBed(buffers.wind),
      // Sticky slots: a builder keeps the same voice for as long as they keep hammering,
      // so a blow does not jump between panners and the rhythm survives a re-pick.
      hammers: Array.from({ length: HAMMERS }, () => ({
        ...mkVoice(buffers.hammer, { ref: 7, rolloff: 1.9, volume: 0.5 }),
        id: null, f: null, next: 0,
      })),
      gulls: Array.from({ length: GULLS }, () => mkVoice(buffers.gull, { ref: 18, rolloff: 1.1, volume: 0.42 })),
      tavern: mkVoice(buffers.murmur, { ref: 6, rolloff: 2.2, volume: 0 }),
    };
    built.tavern.audio.setLoop(true);
  }

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

  // How much of what is around the camera is water. Eight probes on a ring rather than one
  // under the eye, because standing on the last cell of a beach is standing on land and
  // should still sound like the coast. The archipelago is asked rather than the terrain, so
  // the channel between two islands answers "sea" instead of handing back the height of
  // the nearer coast - which is what OPEN_SEA in shared/regions.mjs is for.
  function coastliness(look) {
    const R = 13;
    let wet = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (look.depthAt(camera.position.x + Math.cos(a) * R, camera.position.z + Math.sin(a) * R) < 0) wet++;
    }
    return wet / 8;
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

  // The tavern, and only ours. A hum from a neighbour's tavern sixty units of open water
  // away is not a sound that would carry, and looking for one would mean walking every
  // guest island's records as well.
  let tavernAt = null;
  function findTavern(look) {
    tavernAt = null;
    if (!look.records) return;
    for (const rec of look.records.values()) {
      if (rec.spec && rec.spec.civicType === 'tavern' && rec.group && rec.group.visible) {
        tavernAt = rec.group.position;
        return;
      }
    }
  }

  function repick(look) {
    findTavern(look);

    // --- the bed ---
    const wet = coastliness(look);
    bed.seaWant = SEA_QUIET + (SEA_LOUD - SEA_QUIET) * wet;
    bed.windWant = WIND_LOUD + (WIND_QUIET - WIND_LOUD) * wet;
    // Night takes the top off as well as turning it down: after dark the sea is further
    // away and the wind is in the trees rather than in your ears.
    const night = clamp(look.night || 0, 0, 1);
    bed.duckWant = (1 - night * (1 - NIGHT_DUCK)) * (look.indoors ? INDOOR_DUCK : 1);
    const cut = look.indoors ? 700 : 7000 - night * 4200;
    built.sea.filter.frequency.setTargetAtTime(cut, ctx.currentTime, 0.6);
    built.wind.filter.frequency.setTargetAtTime(cut, ctx.currentTime, 0.6);

    // --- the hammers ---
    // Indoors nobody outside is worth hearing, and the bed is already down to a fifth.
    const want = look.indoors ? [] : builders(look);
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

    // --- the tavern ---
    // Busy means people standing at the tables, which is what a borrel is, plus anybody
    // stood still near the door the rest of the week. Walking past does not count: a
    // street with somebody crossing it is not a full bar.
    let busy = 0;
    if (tavernAt && !look.indoors) {
      const dx = tavernAt.x - camera.position.x, dz = tavernAt.z - camera.position.z;
      if (dx * dx + dz * dz < TAVERN_RANGE * TAVERN_RANGE) {
        for (const crowd of look.crowds) {
          if (!crowd) continue;
          for (const f of crowd.values()) {
            if (!f.visible || f.hidden || f.anim === 'walk' || f.anim === 'haul' || f.anim === 'step') continue;
            const ex = f.pos[0] - tavernAt.x, ez = f.pos[1] - tavernAt.z;
            if (ex * ex + ez * ez < 11 * 11) busy++;
          }
        }
        // A set of tables carried out for the borrel counts double: whoever is sitting at
        // them was already counted by the loop above, and the furniture is how we know
        // they are there for a drink rather than standing in the street.
        busy += (look.tables || 0) * 2;
      }
    }
    const hum = clamp(busy / 9, 0, 1) * 0.5;
    if (tavernAt) built.tavern.holder.position.copy(tavernAt);
    built.tavern.audio.setVolume(hum);
    // Started on the first busy moment rather than at build time, so an island with no
    // tavern - or a quiet Tuesday - runs no source at all. Stopped again only once the
    // gain has actually reached zero, or closing time would be a cut rather than a fade.
    if (hum > 0 && !built.tavern.audio.isPlaying) built.tavern.audio.play();
    else if (hum <= 0 && built.tavern.audio.isPlaying && built.tavern.audio.getVolume() <= 0.001) {
      built.tavern.audio.stop();
    }
    // Last, for the reason given in fire(): a panner that is not playing ignores this.
    if (tavernAt) built.tavern.holder.updateMatrixWorld(true);
  }

  // A cry over the water, on its own slow clock. Daylight only: a gull calling at two in
  // the morning is a different bird and a worse island.
  function maybeGull(look, dt) {
    nextGull -= dt;
    if (nextGull > 0) return;
    nextGull = GULL_GAP[0] + Math.random() * (GULL_GAP[1] - GULL_GAP[0]);
    if (look.indoors || (look.night || 0) > 0.3) return;
    if (!look.quays || !look.quays.length) return;
    let best = null, bestD = GULL_RANGE * GULL_RANGE;
    for (const q of look.quays) {
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
    built.sea.audio.setVolume(bed.seaAt * bed.duckAt);
    built.wind.audio.setVolume(bed.windAt * bed.duckAt);
    // And the master comes up over a second and a half, because a bed that arrives all at
    // once reads as a fault rather than as an island.
    if (fade < 1.6) listener.setMasterVolume(Math.min(1, fade / 1.5));

    if (look) maybeGull(look, PICK_S);

    // The blows. Four `if`s a frame at the very worst, which is what a hard cap buys.
    for (const slot of built.hammers) {
      if (!slot.id || clock < slot.next) continue;
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
    if (ctx) ctx.suspend().catch(() => { /* already gone */ });
    return on;
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

  const api = {
    // What the person asked for, which is what the chip draws. Not whether a note is being
    // played: the two differ for exactly as long as it takes somebody who left it on to
    // touch the page.
    get on() { return on; },
    get possible() { return soundPossible(); },
    setOn,
    toggle: () => setOn(!on),
    update,
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
      cap: HAMMERS + GULLS + 1,
      voices: built ? built.hammers.length + built.gulls.length + 1 : 0,
      bedSources: built ? 2 : 0,
      // Where the bed has got to, rounded. The only way to see that the sea comes up as
      // you walk down to it and goes quiet again after dark, short of having ears.
      bed: {
        sea: Math.round(bed.seaAt * 1000) / 1000,
        wind: Math.round(bed.windAt * 1000) / 1000,
        duck: Math.round(bed.duckAt * 100) / 100,
      },
      playing: built
        ? built.hammers.filter((h) => h.audio.isPlaying).length
          + built.gulls.filter((g) => g.audio.isPlaying).length
          + (built.tavern.audio.isPlaying ? 1 : 0)
        : 0,
      hammering: built ? built.hammers.filter((h) => h.id).length : 0,
      // The population the last pick walked, and how much of it was at work. `crowd` may
      // be three hundred and `voices` is still seven.
      crowd: seen,
      atWork: working,
      buffers: built ? Object.keys(built.buffers).length : 0,
    }),
  };
  if (typeof window !== 'undefined') window.__sound = api;
  return api;
}

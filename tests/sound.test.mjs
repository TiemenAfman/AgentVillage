// What the island sounds like, checked without being able to hear it.
//
// Three promises web/js/sound.js makes that nothing on screen would ever show:
//
//   1. Nothing exists before a gesture. Not a suspended context, not a listener, not a
//      node. A browser refuses to start audio without one, and `new THREE.AudioListener()`
//      builds the one global AudioContext on the spot - so "we make it and leave it
//      suspended" is not good enough, and the only way to see the difference is from here.
//   2. A village of three hundred is nine sources. The pools are array literals built
//      once, and this drives three hundred hammering settlers past them to prove it.
//   3. Every noise is computed rather than fetched, because nothing in this project is
//      fetched at boot and a sample would be a licence in a repository that has none.
//
// The fake below is a Web Audio API with nothing behind it: it records what was asked for
// and hands back objects that answer. Enough of one that three.js's own Audio,
// PositionalAudio and AudioListener run over it unchanged - which is the point, because
// what is being tested is how this module drives them and not three.js itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';

register('./support/shared-loader.mjs', import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'web', 'js', 'sound.js'), 'utf8');

// --- a Web Audio API with nothing behind it --------------------------------

function param(value = 0) {
  return {
    value,
    setValueAtTime(v) { this.value = v; return this; },
    setTargetAtTime(v) { this.value = v; return this; },
    linearRampToValueAtTime(v) { this.value = v; return this; },
    exponentialRampToValueAtTime(v) { this.value = v; return this; },
    cancelScheduledValues() { return this; },
  };
}
const wire = () => ({ connect() {}, disconnect() {} });

function fakeContext() {
  const calls = { gain: 0, panner: 0, source: 0, buffer: 0, filter: 0 };
  const buffers = [];
  const live = new Set();            // buffer sources that have been started and not stopped
  const started = [];                // which buffer each start() played, in order
  const ctx = {
    calls, buffers, live, started,
    state: 'suspended',
    currentTime: 0,
    destination: wire(),
    // No positionX on the panner, so three.js takes its setPosition path - the one branch
    // it has that does not need an AudioParam per axis.
    listener: { setPosition() {}, setOrientation() {} },
    createGain() { calls.gain++; return { ...wire(), gain: param(1) }; },
    createBiquadFilter() { calls.filter++; return { ...wire(), type: '', frequency: param(0), Q: param(1) }; },
    createPanner() { calls.panner++; return { ...wire(), setPosition() {}, setOrientation() {} }; },
    createBufferSource() {
      calls.source++;
      const s = {
        ...wire(),
        buffer: null, loop: false, loopStart: 0, loopEnd: 0,
        detune: param(0), playbackRate: param(1), onended: null,
        start() { live.add(s); started.push(s.buffer); },
        stop() { live.delete(s); },
      };
      return s;
    },
    createBuffer(channels, length, sampleRate) {
      calls.buffer++;
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      const buf = {
        numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
        copyToChannel(src, c) { data[c].set(src.subarray(0, length)); },
        getChannelData: (c) => data[c],
      };
      buffers.push(buf);
      return buf;
    },
    resume() { ctx.state = 'running'; return Promise.resolve(); },
    suspend() { ctx.state = 'suspended'; return Promise.resolve(); },
  };
  return ctx;
}

// --- a page with nothing behind it either ----------------------------------

const listeners = new Map();
function addListener(type, fn) { (listeners.get(type) || listeners.set(type, new Set()).get(type)).add(fn); }
function removeListener(type, fn) { const s = listeners.get(type); if (s) s.delete(fn); }
function dispatch(type) { for (const fn of [...(listeners.get(type) || [])]) fn({ type }); }

let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
globalThis.document = {
  hidden: false,
  addEventListener: addListener,
  removeEventListener: removeListener,
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
};
globalThis.addEventListener = addListener;
globalThis.removeEventListener = removeListener;
// soundPossible() only asks whether the constructor is there; three.js is handed the fake
// itself through setContext below and never calls this one.
globalThis.window = globalThis;
globalThis.AudioContext = function NeverConstructed() {
  throw new Error('sound.js built an AudioContext of its own');
};

const THREE = await import('three');
const { createSound, soundPossible } = await import('../web/js/sound.js');

const ctx = fakeContext();
THREE.AudioContext.setContext(ctx);

// --- a village to listen to ------------------------------------------------

function figure(id, anim, x, z) {
  return { id, anim, pos: [x, z], y: 0, visible: true, hidden: false, phase: (id.length % 7) };
}

function village(n, { anim = 'hammer', tavern = true } = {}) {
  const crowd = new Map();
  for (let i = 0; i < n; i++) {
    // Spread over a grid the size of the island, so "the nearest four" is a real question
    // and not four settlers standing on the same cell.
    crowd.set(i, figure(`house:s${i}`, anim, (i % 20) - 10, Math.floor(i / 20) - 7));
  }
  const records = new Map();
  if (tavern) {
    records.set('civic:tavern', {
      spec: { civicType: 'tavern' },
      group: { visible: true, position: { x: 2, y: 0, z: 2, copy() {} } },
    });
  }
  return {
    night: 0,
    indoors: false,
    depthAt: (x, z) => (Math.abs(x) > 26 || Math.abs(z) > 26 ? -2.5 : 1.2),
    crowds: [crowd],
    quays: [[24, 0]],
    records,
    tables: 0,
  };
}

function made(look = village(3)) {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  return createSound({ camera, scene, island: () => look });
}

// --- 1. nothing before the gesture ----------------------------------------

test('a browser that has not been touched has no audio graph at all', () => {
  store = { 'promptholm.sound': 'on' };            // switched on in a previous session
  const before = ctx.calls.gain;
  const sound = made();
  assert.equal(sound.on, true, 'the switch is remembered per browser');
  const s = sound.stats();
  assert.equal(s.built, false);
  assert.equal(s.context, null, 'no context is even looked at');
  assert.equal(s.voices, 0);
  assert.equal(ctx.calls.gain, before, 'and nothing was asked of the audio API');
  // And a frame does nothing either: this is the line main.js calls sixty times a second.
  sound.update(0.016);
  assert.equal(sound.stats().built, false);
});

test('switching it on out of the blue still waits for a gesture', () => {
  store = {};
  const before = ctx.calls.gain;
  const sound = made();
  assert.equal(sound.on, false, 'muted by default');
  sound.setOn(true);
  assert.equal(sound.on, true, 'the intent is taken straight away');
  assert.equal(sound.stats().built, false, 'the graph is not');
  assert.equal(ctx.calls.gain, before);
  // The chip draws `on`, not `built`. If it drew the graph, the first click on a page that
  // had restored the setting would read as "turn it off".
  dispatch('pointerdown');
  assert.equal(sound.stats().built, true, 'the first touch of the page builds it');
  assert.equal(sound.stats().context, 'running');
});

// --- 2. nine sources, whatever the population -----------------------------

test('three hundred settlers hammering at once are still seven placed voices', () => {
  store = {};
  const look = village(300);
  // Every buffer source this run starts. The fake never fires `onended`, so a one-shot
  // here never finishes on its own - which is the worst case the cap has to hold under,
  // and a harsher test than a browser would give.
  const wasLive = ctx.live.size;
  const sound = made(look);
  sound.setOn(true);
  dispatch('pointerdown');

  const s0 = sound.stats();
  assert.equal(s0.voices, s0.cap, 'the pools are their own ceiling');
  assert.equal(s0.cap, 7, '4 hammers + 2 gulls + 1 tavern');
  assert.equal(s0.bedSources, 2, 'and the sea and the wind over them');

  // Half a minute of frames, with the camera walking east across the whole village, which
  // is what keeps re-deciding who the nearest four are.
  let peak = 0;
  for (let i = 0; i < 1800; i++) {
    sound.update(1 / 60);
    const s = sound.stats();
    peak = Math.max(peak, s.playing);
    assert.ok(s.hammering <= 4, `slots in use: ${s.hammering}`);
    assert.equal(s.voices, s.cap, 'nothing ever allocated a voice');
  }
  assert.ok(peak > 0, 'somebody was heard hammering');
  assert.ok(peak <= 7, `at most the cap was ever sounding, saw ${peak}`);
  // Nine started-and-not-stopped sources: two bed loops, and at most the seven placed
  // voices. Three hundred settlers, half a minute, and not a tenth.
  assert.ok(ctx.live.size - wasLive <= 9, `live sources: ${ctx.live.size - wasLive}`);
});

test('a slot follows the settler in it rather than the other way round', () => {
  store = {};
  const look = village(6, { anim: 'still' });
  // One builder, a long way from the rest, so there is no argument about who is nearest.
  const [first] = look.crowds[0].values();
  first.anim = 'hammer';
  const sound = made(look);
  sound.setOn(true);
  dispatch('pointerdown');
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  assert.equal(sound.stats().hammering, 1);
  // They finish the wall. The slot has to come free, or a village that stops building
  // keeps tapping for ever.
  first.anim = 'still';
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  assert.equal(sound.stats().hammering, 0);
});

test('a gull over the quay, rarely, and never after dark', () => {
  store = {};
  const look = village(6, { anim: 'still' });
  const sound = made(look);
  sound.setOn(true);
  dispatch('pointerdown');
  // The gull buffer is the fifth this run made; surf, wind, murmur and hammer come first.
  const gull = ctx.buffers[ctx.buffers.length - 1];
  const cries = () => ctx.started.filter((b) => b === gull).length;

  // Two minutes of daylight. GULL_GAP is 17 to 48 seconds, so two is the floor and five
  // the ceiling - and if it were ever more than that the island would have a seagull
  // problem rather than a coastline.
  for (let i = 0; i < 120 * 60; i++) sound.update(1 / 60);
  const byDay = cries();
  assert.ok(byDay >= 2 && byDay <= 6, `${byDay} cries in two minutes`);

  // And the same two minutes at two in the morning.
  look.night = 1;
  for (let i = 0; i < 120 * 60; i++) sound.update(1 / 60);
  assert.equal(cries(), byDay, 'a gull calling at night is a different bird');
});

test('the tavern hums when there is somebody at the tables, and not otherwise', () => {
  store = {};
  // Nobody near the door, and the tavern sixty units off, so distance is not the reason.
  const look = village(4, { anim: 'still' });
  for (const f of look.crowds[0].values()) { f.pos[0] = 40; f.pos[1] = 40; }
  const sound = made(look);
  sound.setOn(true);
  dispatch('pointerdown');
  const murmur = ctx.buffers[ctx.buffers.length - 3];  // surf, wind, murmur, hammer, gull
  const humming = () => ctx.started.filter((b) => b === murmur).length;
  for (let i = 0; i < 60; i++) sound.update(1 / 60);
  assert.equal(humming(), 0, 'an empty tavern runs no source at all');

  // Friday half past four: the tables come out and the village walks over.
  look.tables = 5;
  for (let i = 0; i < 60; i++) sound.update(1 / 60);
  assert.equal(humming(), 1, 'and starts one when there is something to hear');
});

// The castle on a Saturday night (Plans/rave-in-het-kasteel.md). 2.6 MB of music is not
// made for an island that never goes near its castle, and one source carries it from the
// square into the hall, so the beat does not start again at the door.
test('the rave is made the first time it is within earshot, and is one source in and out', () => {
  store = {};
  const look = village(3);
  const sound = made(look);
  sound.setOn(true);
  dispatch('pointerdown');
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  assert.equal(sound.stats().rave, null, 'no Saturday night, no music');
  assert.equal(sound.stats().buffers, 5, 'and nothing synthesised for it');
  assert.equal(sound.raveClock(), null);

  look.rave = { inside: false, dist: 12 };
  sound.update(1 / 6);
  assert.equal(sound.stats().rave.making, true, 'it is written a bar a frame, not in one stall');
  assert.equal(sound.stats().rave.playing, false);
  for (let i = 0; i < 60; i++) sound.update(1 / 60);
  const out = sound.stats().rave;
  assert.ok(out && out.playing, 'heard from the square');
  assert.ok(out.want > 0 && out.want < 0.3, `through the walls it is a thump, not the hall (${out.want})`);
  assert.ok(out.cut < 500, `and only the bass comes through (${out.cut} Hz)`);
  const music = ctx.buffers[ctx.buffers.length - 1];
  const sources = () => ctx.started.filter((b) => b === music).length;
  assert.equal(sources(), 1);

  look.rave = { inside: true };
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  const hall = sound.stats().rave;
  assert.ok(hall.want > out.want * 2, 'in the hall it is loud');
  assert.ok(hall.cut > 10000, 'and all of it');
  assert.equal(sources(), 1, 'the same source: walking in does not start the song again');

  ctx.currentTime = 5;
  const t = sound.raveClock();
  assert.ok(t > 4.5 && t <= 5, `the lights keep time to the music (${t})`);

  look.rave = null;
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  assert.equal(sound.stats().rave.playing, false, 'three o’clock: it stops');
  assert.equal(sound.raveClock(), null);
  ctx.currentTime = 0;
});

test('the rave loops without a seam, loud and inside the rails', async () => {
  const { RAVE_SONG } = await import('../web/js/sound.js');
  const music = ctx.buffers.find((b) => b.duration > 20);
  assert.ok(music, 'the test above made it');
  const bars = RAVE_SONG.bars * 4 * 60 / RAVE_SONG.bpm;
  assert.ok(Math.abs(music.duration - bars) < 0.001, `${RAVE_SONG.bars} bars, exactly (${music.duration} s)`);
  assert.equal(music.numberOfChannels, 1);
  const d = music.getChannelData(0);
  let sum = 0, peak = 0, worst = 0;
  for (let i = 0; i < d.length; i++) {
    assert.ok(Number.isFinite(d[i]), `sample ${i} is not a number`);
    sum += d[i] * d[i];
    peak = Math.max(peak, Math.abs(d[i]));
    if (i) worst = Math.max(worst, Math.abs(d[i] - d[i - 1]));
  }
  const rms = Math.sqrt(sum / d.length);
  assert.ok(peak <= 1, `it clips at ${peak}`);
  assert.ok(rms > 0.1, `a rave that quiet is a radio next door (rms ${rms})`);
  // Everything was written modulo the loop, so the step across the seam is a step like any.
  assert.ok(Math.abs(d[0] - d[d.length - 1]) <= worst, 'the loop point jumps');
  // And the build really is quieter in the low end than the groove: no kick in it. The kick
  // is the loudest thing in the song, so its bars carry more energy than the break's.
  const barLen = d.length / RAVE_SONG.bars;
  const energy = (bar) => { let e = 0; for (let i = bar * barLen; i < (bar + 1) * barLen; i++) e += d[Math.floor(i)] ** 2; return e; };
  assert.ok(energy(2) > energy(RAVE_SONG.build + 1), 'the break has no kick in it');
});

// --- 3. the noises themselves ---------------------------------------------

test('every voice is synthesised, finite, and inside the rails', () => {
  store = {};
  const sound = made();
  sound.setOn(true);
  dispatch('pointerdown');
  assert.equal(sound.stats().buffers, 5, 'sea, wind, murmur, hammer, gull');

  // The five this run made are the tail of the fake's list; earlier tests filled the head.
  const mine = ctx.buffers.slice(-5);
  for (const buf of mine) {
    assert.ok(buf.length > 1000, 'a buffer with nothing in it is silence nobody notices');
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      let sum = 0, peak = 0;
      for (let i = 0; i < d.length; i++) {
        assert.ok(Number.isFinite(d[i]), `sample ${i} of channel ${c} is not a number`);
        sum += d[i] * d[i];
        peak = Math.max(peak, Math.abs(d[i]));
      }
      const rms = Math.sqrt(sum / d.length);
      assert.ok(peak <= 1, `channel ${c} clips at ${peak}`);
      assert.ok(rms > 0.01, `channel ${c} is near silent (rms ${rms})`);
      // Not a constant either: a DC block would be finite, in range and completely wrong.
      assert.ok(peak > rms * 1.5, `channel ${c} has no shape to it`);
    }
  }
});

test('the bed loops without a click in it', () => {
  // The seam fold is what makes this true, and it is the one thing in the synthesiser that
  // is wrong in a way nobody reading the code would see: a mismatched envelope at the loop
  // point is a thump once every ten seconds. The head and the tail of a folded buffer sit
  // at the same point in the swell, so the step between the last sample and the first has
  // to be no worse than the steps inside it.
  const [surf, wind] = ctx.buffers.slice(-5);
  for (const buf of [surf, wind]) {
    assert.equal(buf.numberOfChannels, 2, 'the bed has width; the placed voices are mono');
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      let worst = 0;
      for (let i = 1; i < d.length; i++) worst = Math.max(worst, Math.abs(d[i] - d[i - 1]));
      const seam = Math.abs(d[0] - d[d.length - 1]);
      assert.ok(seam <= worst, `the loop point jumps ${seam}, worse than any step inside (${worst})`);
    }
  }
});

test('nothing in here is fetched, loaded or decoded', () => {
  // The invariant from CLAUDE.md, asserted on the one module most likely to break it:
  // audio is where sample files come from, and a lazily loaded one is still a file in a
  // repository with no licence for it and a loader on a path that has none.
  for (const bad of ['fetch(', 'XMLHttpRequest', 'AudioLoader', 'decodeAudioData', 'new Audio(']) {
    assert.ok(!SRC.includes(bad), `web/js/sound.js reaches for ${bad}`);
  }
  assert.ok(!/\bimport\s*\(/.test(SRC), 'and it loads no module of its own after boot');
});

// --- 4. going quiet --------------------------------------------------------

test('switched off, the context is suspended rather than merely silent', () => {
  store = {};
  const sound = made();
  sound.setOn(true);
  dispatch('pointerdown');
  assert.equal(sound.stats().context, 'running');
  sound.toggle();
  assert.equal(sound.on, false);
  assert.equal(sound.stats().context, 'suspended');
  assert.equal(store['promptholm.sound'], 'off', 'and this browser remembers');
  // Switching back on reuses the graph: the buffers cost a frame to make and making them
  // twice would put that frame in the middle of somebody's walk.
  const buffers = ctx.calls.buffer;
  sound.toggle();
  assert.equal(sound.stats().context, 'running');
  assert.equal(ctx.calls.buffer, buffers, 'nothing was synthesised a second time');
});

test('a tab nobody is looking at makes no noise', () => {
  store = {};
  const sound = made();
  sound.setOn(true);
  dispatch('pointerdown');
  assert.equal(sound.stats().context, 'running');
  globalThis.document.hidden = true;
  dispatch('visibilitychange');
  assert.equal(sound.stats().context, 'suspended');
  // And a frame that arrives while it is hidden - the animation loop does not always
  // stop - touches nothing.
  sound.update(0.016);
  assert.equal(sound.stats().context, 'suspended');
  globalThis.document.hidden = false;
  dispatch('visibilitychange');
  assert.equal(sound.stats().context, 'running');
});

test('a browser with no Web Audio is told so rather than left to fail', () => {
  const had = globalThis.AudioContext;
  delete globalThis.AudioContext;
  try {
    assert.equal(soundPossible(), false);
    store = { 'promptholm.sound': 'on' };
    const sound = made();
    assert.equal(sound.on, false, 'a remembered switch cannot turn on what is not there');
    assert.equal(sound.setOn(true), false);
    sound.update(0.016);
  } finally {
    globalThis.AudioContext = had;
  }
});

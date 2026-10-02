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
// Every node remembers what it was connected to, so a test can walk the graph from a playing
// source to the speakers and multiply the gains on the way (heard, below): that is how the
// Settings -> Audio buses are checked to silence what they say and nothing else.
const wire = () => {
  const n = {
    outs: new Set(),
    connect(to) { n.outs.add(to); return to; },
    disconnect(to) { if (to === undefined) n.outs.clear(); else n.outs.delete(to); },
  };
  return n;
};

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
    createGain() { calls.gain++; return Object.assign(wire(), { gain: param(1) }); },
    createBiquadFilter() { calls.filter++; return Object.assign(wire(), { type: '', frequency: param(0), Q: param(1) }); },
    createPanner() { calls.panner++; return Object.assign(wire(), { setPosition() {}, setOrientation() {} }); },
    // The keeper's own tracks go through a media element (web/js/sound.js setPlaylists).
    createMediaElementSource() { return wire(); },
    createBufferSource() {
      calls.source++;
      const s = Object.assign(wire(), {
        buffer: null, loop: false, loopStart: 0, loopEnd: 0,
        detune: param(0), playbackRate: param(1), onended: null,
        start() { live.add(s); started.push(s.buffer); },
        stop() { live.delete(s); },
      });
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
  removeItem: (k) => { delete store[k]; },
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

// How loud a node comes out of the speakers: the product of every gain on the loudest path from
// it to the destination, 0 when no path gets there.
function heard(node, seen = new Set()) {
  if (node === ctx.destination) return 1;
  if (seen.has(node)) return 0;
  seen.add(node);
  let best = 0;
  for (const to of node.outs || []) best = Math.max(best, heard(to, seen));
  seen.delete(node);
  return best * (node.gain ? node.gain.value : 1);
}
// The loudest of the live sources playing `buffer`, as heard; null when none is playing.
function loudest(buffer) {
  const playing = [...ctx.live].filter((s) => s.buffer === buffer);
  return playing.length ? Math.max(...playing.map((s) => heard(s))) : null;
}

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

function made(look = village(3), opts = {}) {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  return createSound({ camera, scene, island: () => look, ...opts });
}

// A media element with nothing behind it: what it was told to play, and an `ended` to fire.
function fakeElement() {
  const on = {};
  const el = {
    src: '', preload: '', playing: false, plays: 0,
    play() { el.playing = true; el.plays++; return Promise.resolve(); },
    pause() { el.playing = false; },
    addEventListener(type, fn) { on[type] = fn; },
    end() { el.playing = false; on.ended && on.ended(); },
  };
  return el;
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

test('three hundred settlers hammering at once are still thirty-eight placed voices', () => {
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
  assert.equal(s0.cap, 38, '4 hammers + 2 gulls + 2 taverns + 2 glasses + the borrel and its 2 glasses + 2 bells + 2 greetings + 4 workshops and a saw + 4 workers + a rare bird and a foghorn + 4 animals + a river and the lava + 3 for the rounds and their wheels');
  assert.equal(s0.cap, Object.values(s0.families).reduce((a, f) => a + f.cap, 0), 'every family counted');
  assert.equal(s0.bedSources, 13, 'and the sea, the wind, the two rooms, the glass and the bell in a room, the four of the hour and the sky, the rumble, the sea from below and its bubbles');

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
  assert.ok(peak <= s0.cap, `at most the cap was ever sounding, saw ${peak}`);
  // Started-and-not-stopped sources: the beds, and at most the placed voices. Three hundred
  // settlers, half a minute, and not a tenth.
  assert.ok(ctx.live.size - wasLive <= s0.cap + s0.bedSources, `live sources: ${ctx.live.size - wasLive}`);
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
  // The gull buffer is the fifth this run made; surf, wind, murmur and hammer come first, the
  // glass after it.
  const gull = ctx.buffers[ctx.buffers.length - 2];
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

test('the tavern hums when there is somebody at its door, and not otherwise', () => {
  store = {};
  // Nobody near the door, and nobody else either, so distance is not the reason.
  const look = village(4, { anim: 'still' });
  for (const f of look.crowds[0].values()) { f.pos[0] = 40; f.pos[1] = 40; }
  const sound = made(look);
  sound.setOn(true);
  dispatch('pointerdown');
  const murmur = ctx.buffers[ctx.buffers.length - 4];  // surf, wind, murmur, hammer, gull, clink
  const humming = () => ctx.started.filter((b) => b === murmur).length;
  for (let i = 0; i < 60; i++) sound.update(1 / 60);
  assert.equal(humming(), 0, 'an empty tavern runs no source at all');

  // Evening: three of them stand about outside the door.
  const [a, b, c] = look.crowds[0].values();
  for (const f of [a, b, c]) { f.pos[0] = 3; f.pos[1] = 3; }
  for (let i = 0; i < 60; i++) sound.update(1 / 60);
  assert.equal(humming(), 1, 'and starts one when there is something to hear');
  assert.equal(sound.stats().pubs.village.busy, 3);
  // Walking past is not drinking.
  for (const f of [a, b, c]) f.anim = 'walk';
  for (let i = 0; i < 200; i++) sound.update(1 / 60);
  assert.equal(sound.stats().pubs.village.busy, 0);
  assert.equal(sound.stats().pubs.village.playing, false, 'and it fades out and stops');
});

// The castle on a Saturday night (Plans/DONE/rave-in-het-kasteel.md). 2.6 MB of music is not
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
  assert.equal(sound.stats().buffers, 6, 'and nothing synthesised for it');
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
  const bars = RAVE_SONG.bars * 4 * 60 / RAVE_SONG.bpm;
  // Known by its length - the Salty Kraken's jukebox is longer than twenty seconds too.
  const music = ctx.buffers.find((b) => Math.abs(b.duration - bars) < 0.001);
  assert.ok(music, 'the test above made it');
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

// The Salty Kraken's shanty (Plans/piratenkroeg.md): the rave's machinery with a second song in
// it - made only when the Kraken is within earshot, one source in and out, and its own clock.
test('the shanty is made near the Kraken, muffled on the quay and whole inside, on one source', () => {
  store = {};
  const look = village(3);
  const sound = made(look);
  sound.setOn(true);
  dispatch('pointerdown');
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  assert.equal(sound.stats().shanty, null, 'nobody near the harbour, no shanty');
  assert.equal(sound.stats().buffers, 6, 'and nothing synthesised for it');
  assert.equal(sound.shantyClock(), null);
  assert.equal(sound.clockOf('shanty'), null);

  look.shanty = { inside: false, dist: 8 };
  sound.update(1 / 6);
  assert.equal(sound.stats().shanty.making, true, 'written a bar a frame');
  for (let i = 0; i < 200; i++) sound.update(1 / 60);
  const out = sound.stats().shanty;
  assert.ok(out && out.playing, 'heard from the quay');
  assert.ok(out.want > 0 && out.want < 0.22, `through the walls it is a tune, not the room (${out.want})`);
  assert.ok(out.cut < 600, `and only the middle comes through (${out.cut} Hz)`);
  const music = ctx.buffers[ctx.buffers.length - 1];
  const sources = () => ctx.started.filter((b) => b === music).length;
  assert.equal(sources(), 1);

  look.shanty = { inside: true };
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  const room = sound.stats().shanty;
  assert.ok(room.want > out.want * 2, 'inside it is loud');
  assert.ok(room.cut > 10000, 'and all of it');
  assert.equal(sources(), 1, 'the same source: stepping in does not start it again');

  ctx.currentTime = 5;
  const t = sound.shantyClock();
  assert.ok(t > 4.5 && t <= 5, `the crew nod to the music (${t})`);
  assert.equal(sound.clockOf('shanty'), t);
  assert.equal(sound.clockOf('nothing'), null);

  look.shanty = null;
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  assert.equal(sound.stats().shanty.playing, false, 'out of earshot it stops');
  ctx.currentTime = 0;
});

test('the jukebox loops without a seam, every tune on one count, each chorus fuller than its verse', async () => {
  const { SHANTY_SONG } = await import('../web/js/sound.js');
  const count = 60 / SHANTY_SONG.bpm;
  const secs = SHANTY_SONG.counts * count;
  assert.deepEqual(SHANTY_SONG.songs.map((s) => s.id), ['kraken', 'drunken-sailor', 'wellerman']);
  let from = 0;
  for (const s of SHANTY_SONG.songs) { assert.equal(s.from, from, `${s.id} follows the one before`); from += s.bars * s.beatsPerBar; }
  assert.equal(from, SHANTY_SONG.counts);
  const music = ctx.buffers.find((b) => Math.abs(b.duration - secs) < 0.001);
  assert.ok(music, `${SHANTY_SONG.counts} counts, exactly (${secs} s)`);
  assert.equal(music.sampleRate, 44100, 'a fiddle wants the full rate');
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
  assert.ok(rms > 0.08, `a shanty that quiet is nobody singing (rms ${rms})`);
  assert.ok(Math.abs(d[0] - d[d.length - 1]) <= worst, 'the loop point jumps');
  const perCount = d.length / SHANTY_SONG.counts;
  for (const s of SHANTY_SONG.songs) {
    const energy = (bar) => { let e = 0; const a = (s.from + bar * s.beatsPerBar) * perCount; for (let i = a; i < a + s.beatsPerBar * perCount; i++) e += d[Math.floor(i)] ** 2; return e; };
    assert.ok(energy(s.chorus + 1) > energy(1), `${s.name}: the chorus is the whole room`);
  }
});

// The keeper's own music (lib/music.mjs, HOME/audio): whole tracks one after the other, through
// the same bed as a computed song, and the computed one never made for a room that has tracks.
test('the keeper\'s own tracks play whole, one after the other, loud inside and muffled outside', () => {
  store = {};
  const look = village(3);
  const els = [];
  const sound = made(look, { makeElement: () => { const e = fakeElement(); els.push(e); return e; } });
  sound.setOn(true);
  dispatch('pointerdown');
  sound.setPlaylists({ shanty: ['/api/music/pirates/01-a.mp3', '/api/music/pirates/02-b.mp3'], tavern: [], bogus: ['x'] });
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  assert.equal(sound.stats().tracks, null, 'nothing made before anybody is near');

  look.shanty = { inside: false, dist: 6 };
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  assert.equal(sound.stats().shanty, null, 'the computed shanty is never made');
  assert.equal(els.length, 1, 'one element');
  const t = sound.stats().tracks.shanty;
  assert.ok(t.playing && t.src.endsWith('01-a.mp3'), 'the first track, from the quay');
  assert.ok(t.want > 0 && t.want < 0.22 && t.cut < 600, 'muffled through the walls');
  assert.equal(sound.shantyClock(), null, 'a track has no count: the crew keep their own');

  look.shanty = { inside: true };
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  assert.ok(sound.stats().tracks.shanty.cut > 10000 && sound.stats().tracks.shanty.want > 0.4, 'whole inside');
  assert.equal(els[0].plays, 1, 'stepping in does not start it again');

  els[0].end();
  assert.ok(els[0].src.endsWith('02-b.mp3') && els[0].playing, 'then the next');
  els[0].end();
  assert.ok(els[0].src.endsWith('01-a.mp3'), 'and round again');

  look.shanty = null;
  for (let i = 0; i < 60; i++) sound.update(1 / 60);
  assert.equal(els[0].playing, false, 'paused out of earshot');
  // An empty folder is no tracks: the village tavern stays with its murmur.
  look.tavern = { inside: true };
  for (let i = 0; i < 30; i++) sound.update(1 / 60);
  assert.equal(els.length, 1);
});

test('without an element to play through, tracks are ignored and the rooms keep their own music', () => {
  store = {};
  const look = village(3);
  const sound = made(look);
  sound.setOn(true);
  dispatch('pointerdown');
  sound.setPlaylists({ shanty: ['/api/music/pirates/01-a.mp3'] });
  look.shanty = { inside: true };
  sound.update(1 / 6);
  assert.equal(sound.stats().shanty.making, true, 'the computed shanty, as before');
  assert.equal(sound.stats().tracks, null);
});

// --- the taverns and the borrel (Plans/meer-geluiden.md, phase 1) -------

// Runs `secs` of frames.
const run = (sound, secs) => { for (let i = 0; i < secs * 60; i++) sound.update(1 / 60); };
function heardSound(look, opts) {
  const sound = made(look, opts);
  sound.setOn(true);
  dispatch('pointerdown');
  return sound;
}

test('a tavern is heard through its door: open at the threshold, shut along the wall', () => {
  store = {};
  const look = village(4, { anim: 'still', tavern: false });
  look.pubs = [{ kind: 'village', at: [2, 0, 2] }];
  for (const f of look.crowds[0].values()) { f.pos[0] = 3; f.pos[1] = 2; }
  const sound = heardSound(look);
  run(sound, 1);
  const atDoor = sound.stats().pubs.village;
  assert.ok(atDoor.playing && atDoor.want > 0, 'four at the door: it hums');
  // The camera stands at the origin, three units from the door. Move the door off along the wall.
  look.pubs = [{ kind: 'village', at: [16, 0, 2] }];
  for (const f of look.crowds[0].values()) { f.pos[0] = 17; f.pos[1] = 2; }
  run(sound, 1);
  const along = sound.stats().pubs.village;
  assert.ok(atDoor.cut > along.cut + 200, `the filter opens towards the door (${atDoor.cut} Hz there, ${along.cut} Hz along)`);
  assert.ok(along.cut >= 600 && atDoor.cut <= 1200);
});

test('the Salty Kraken hums with nobody from the village there, and has a voice of its own', () => {
  store = {};
  const look = village(2, { anim: 'still', tavern: false });
  for (const f of look.crowds[0].values()) { f.pos[0] = 40; f.pos[1] = 40; }
  look.pubs = [{ kind: 'kraken', at: [6, 0, 0] }];
  const sound = heardSound(look);
  sound.update(1 / 6);
  assert.deepEqual(sound.stats().making, ['kraken'], 'its murmur is made the first time it is wanted, a step a frame');
  run(sound, 1);
  const k = sound.stats().pubs.kraken;
  assert.ok(k.playing && k.want > 0, 'the crew are always in');
  assert.equal(sound.stats().pubs.village.playing, false, 'and the village tavern, which is not there, is silent');
  assert.equal(sound.stats().buffers, 7, 'one more buffer, the Kraken\'s own');
  const kraken = ctx.buffers[ctx.buffers.length - 1];
  assert.equal(kraken.numberOfChannels, 1);
  assert.ok(loudest(kraken) > 0, 'and it reaches the speakers');
});

test('inside the village tavern the murmur is the room, whole, and outside it is not', () => {
  store = {};
  const look = village(3, { anim: 'still' });
  const sound = heardSound(look);
  const murmur = ctx.buffers[ctx.buffers.length - 4];
  look.indoors = true;
  look.room = 'tavern';
  run(sound, 1);
  const s = sound.stats().pubs.village;
  assert.equal(s.inside, true);
  assert.equal(s.inPlaying, true, 'the room murmurs');
  assert.equal(s.playing, false, 'the door outside is not where we are');
  assert.ok(loudest(murmur) > 0);
  look.indoors = false;
  look.room = null;
  run(sound, 2);
  assert.equal(sound.stats().pubs.village.inPlaying, false, 'out of the door the room goes');
});

test('the borrel is a loop on the square while the village is out there, made only then', () => {
  store = {};
  const look = village(3, { anim: 'still', tavern: false });
  look.square = [0, 0, 4];
  const sound = heardSound(look);
  run(sound, 1);
  assert.equal(sound.stats().borrel.playing, false, 'no gathering, a quiet square');
  assert.equal(sound.stats().buffers, 6, 'and nothing made for it');
  look.gathering = { friday: false };
  look.tables = 2;
  run(sound, 2);
  const coffee = sound.stats().borrel;
  assert.ok(coffee.playing && coffee.want > 0, 'coffee time: the square talks');
  look.gathering = { friday: true };
  look.tables = 5;
  run(sound, 1);
  assert.ok(sound.stats().borrel.want > coffee.want, 'and on a Friday with the tables out, more');
  // Glasses on the square: the borrel's clinks.
  const clink = ctx.buffers.findLast((b) => b.length === Math.floor(22050 * 0.22));
  const before = ctx.started.filter((b) => b === clink).length;
  run(sound, 30);
  assert.ok(ctx.started.filter((b) => b === clink).length - before >= 2, 'somebody puts a glass down');
  look.gathering = null;
  run(sound, 3);
  assert.equal(sound.stats().borrel.playing, false, 'back to work');
});

test('Settings -> Audio: a bus or a part at zero silences what it says, and nothing else', () => {
  store = {};
  const look = village(40);
  look.pubs = [{ kind: 'village', at: [-8, 0, -6] }];
  for (const f of look.crowds[0].values()) if (f.pos[0] < -6) f.anim = 'still';
  const sound = heardSound(look);
  run(sound, 3);
  const surf = ctx.buffers[ctx.buffers.length - 6];
  const murmur = ctx.buffers[ctx.buffers.length - 4];
  const hammer = ctx.buffers[ctx.buffers.length - 3];
  const now = () => ({ surf: loudest(surf), murmur: loudest(murmur), hammer: loudest(hammer) });
  // A hammer is a one-shot, so it is heard only between blows: a second of frames finds one.
  const hammered = () => { let best = 0; for (let i = 0; i < 60; i++) { sound.update(1 / 60); best = Math.max(best, loudest(hammer) || 0); } return best; };
  const full = now();
  assert.ok(full.surf > 0 && full.murmur > 0, 'the sea and the tavern, at full');
  assert.ok(hammered() > 0, 'and a hammer');

  sound.setMix('speech', 0);
  run(sound, 0.2);
  assert.equal(loudest(murmur) || 0, 0, 'Speech at zero: the tavern is silent');
  assert.ok(loudest(surf) > 0, 'and the sea is not');
  assert.ok(hammered() > 0, 'nor the hammers');
  assert.deepEqual(JSON.parse(store['promptholm.sound.mix']), { speech: 0 }, 'only what moved is kept');

  sound.setMix('speech', 1);
  assert.equal(store['promptholm.sound.mix'], undefined, 'a slider back at full leaves nothing behind');
  sound.setMix('work', false);
  run(sound, 0.2);
  assert.equal(hammered(), 0, 'Crafts and hammers off: no blow is even struck');
  assert.ok(loudest(murmur) > 0 && loudest(surf) > 0, 'and the rest carries on');

  sound.setMix('work', true);
  // The bed is still gliding towards where the coast wants it, so measured across one frame.
  const was = loudest(surf);
  sound.setMix('ambience', 0.5);
  sound.update(1 / 60);
  const half = loudest(surf);
  assert.ok(Math.abs(half - was * 0.5) < was * 0.05, `Ambience at a half halves the sea (${half} of ${was})`);
  sound.setMix('master', 0);
  run(sound, 0.2);
  assert.equal(loudest(surf) || 0, 0, 'Master at zero: nothing at all');
  assert.equal(loudest(murmur) || 0, 0);
  assert.equal(sound.setMix('loudness', 3), false, 'a key that is not one of ours is refused');
  sound.resetMix();
  assert.equal(store['promptholm.sound.mix'], undefined, 'and the defaults keep nothing');
});

test('the mix is kept per browser and used from the first note', () => {
  store = { 'promptholm.sound.mix': JSON.stringify({ music: 0.25, tavern: false }) };
  const sound = made(village(3));
  assert.equal(sound.mix().music, 0.25, 'read back before there is a graph');
  assert.equal(sound.mix().tavern, false);
  sound.setMix('master', 0.5);
  assert.equal(sound.stats().built, false, 'and set without making one');
  sound.setOn(true);
  dispatch('pointerdown');
  assert.equal(sound.stats().buses.music, 0.25, 'the bus starts where the mix says');
  run(sound, 1);
  assert.equal(sound.stats().pubs.village.playing, false, 'and a part that is off is never started');
});

// --- the church bell (phase 2) ---------------------------------------------

// The bell's buffer is the only four-second one at the hammer's rate.
const bellBuffer = () => ctx.buffers.findLast((b) => b.sampleRate === 22050 && b.length === 22050 * 4);
const strokes = () => { const b = bellBuffer(); return b ? ctx.started.filter((s) => s === b).length : 0; };

function bellIsland() {
  const look = village(2, { anim: 'still', tavern: false });
  look.bell = { at: [10, 3, 0] };
  return look;
}
// Hours as worldNow() gives them: whole minutes over sixty.
const at = (h, m) => h + m / 60;

test('the bell strikes the hour on the sea\'s clock, as many times as the hour', () => {
  store = {};
  const look = bellIsland();
  look.clock = at(13, 58);
  const sound = heardSound(look);
  run(sound, 1);
  assert.ok(bellBuffer(), 'made the first time the chapel and the clock are both there');
  const before = strokes();
  look.clock = at(13, 59);
  run(sound, 1);
  assert.equal(strokes(), before, 'nothing on the minute before');
  look.clock = at(14, 0);
  run(sound, 1);
  assert.equal(strokes() - before, 1, 'the first stroke at once');
  run(sound, 6);
  assert.equal(strokes() - before, 2, 'two o\'clock: two strokes, and no more');
  assert.equal(sound.stats().bell.queued, 0);
  look.clock = at(14, 29);
  run(sound, 1);
  look.clock = at(14, 30);
  run(sound, 4);
  assert.equal(strokes() - before, 3, 'and one on the half hour');
  look.clock = at(14, 59);
  run(sound, 1);
  look.clock = at(15, 0);
  run(sound, 10);
  assert.equal(strokes() - before, 6, 'three at three');
});

test('the bell does not strike on loading, under a lens, after a long sleep or at night', () => {
  store = {};
  const look = bellIsland();
  look.clock = at(16, 0);
  const sound = heardSound(look);
  run(sound, 10);
  const before = strokes();
  assert.equal(before, strokes(), 'a page that loads at four does not strike four');
  look.clock = at(16, 29);
  run(sound, 1);
  look.clock = null;                       // ?hour, the chronicle: not the sea's time
  run(sound, 1);
  look.clock = at(16, 30);
  run(sound, 3);
  assert.equal(strokes(), before, 'the lens forgot the minute: no stroke on coming back');
  look.clock = at(16, 31);
  run(sound, 1);
  look.clock = at(18, 0);                  // a tab that slept an hour and a half
  run(sound, 10);
  assert.equal(strokes(), before, 'an hour it did not see pass is not rung');
  look.clock = at(22, 59);
  run(sound, 1);
  look.clock = at(23, 0);
  run(sound, 10);
  assert.equal(strokes(), before, 'quiet from eleven');
  look.clock = at(6, 59);
  run(sound, 1);
  look.clock = at(7, 0);
  run(sound, 20);
  assert.equal(strokes() - before, 7, 'and seven at seven');
});

test('switched off in Settings, the bell is not struck at all', () => {
  store = { 'promptholm.sound.mix': JSON.stringify({ bell: false }) };
  const look = bellIsland();
  look.clock = at(8, 59);
  const sound = heardSound(look);
  run(sound, 1);
  const before = strokes();
  look.clock = at(9, 0);
  run(sound, 25);
  assert.equal(strokes(), before);
});

test('the bell is a bell: finite, inside the rails, and dying away into silence', () => {
  const b = bellBuffer();
  assert.ok(b, 'made by the tests above');
  const d = b.getChannelData(0);
  let peak = 0, head = 0, tail = 0;
  for (let i = 0; i < d.length; i++) {
    assert.ok(Number.isFinite(d[i]));
    peak = Math.max(peak, Math.abs(d[i]));
    if (i < d.length / 8) head += d[i] * d[i];
    if (i > d.length * 7 / 8) tail += d[i] * d[i];
  }
  assert.ok(peak <= 1 && peak > 0.05, `peak ${peak}`);
  assert.ok(head > tail * 20, 'it rings out');
  assert.equal(Math.abs(d[d.length - 1]), 0, 'and ends in its own silence');
});

// --- greetings in the street (phase 3) ------------------------------------

test('a settler you walk up to says hello, once, in a voice of their own', () => {
  store = {};
  const look = village(3, { anim: 'still', tavern: false });
  const [a, b, c] = look.crowds[0].values();
  a.pos = [2, 0]; b.pos = [30, 30]; c.pos = [-30, -30];
  look.ours = look.crowds[0];
  look.walker = { x: 0, z: 0, fx: 1, fz: 0 };
  const sound = heardSound(look);
  run(sound, 1);
  assert.equal(sound.stats().greeted, 1, 'the one ahead of you greets you');
  run(sound, 20);
  assert.equal(sound.stats().greeted, 1, 'and not again for a while');
  // Turn your back on the next one: no hello.
  b.pos = [-2, 0];
  run(sound, 6);
  assert.equal(sound.stats().greeted, 1, 'nobody greets the back of your head');
  look.walker = { x: 0, z: 0, fx: -1, fz: 0 };
  run(sound, 1);
  assert.equal(sound.stats().greeted, 2, 'face them and they do');
  assert.ok(sound.stats().families.greet.cap === 2);
  // Indoors, nobody in the street is heard.
  look.indoors = true;
  c.pos = [-1.5, 0.4];
  run(sound, 6);
  assert.equal(sound.stats().greeted, 2);
});

test('Greetings off in Settings: nobody says anything', () => {
  store = { 'promptholm.sound.mix': JSON.stringify({ greetings: false }) };
  const look = village(1, { anim: 'still', tavern: false });
  const [a] = look.crowds[0].values();
  a.pos = [1.5, 0];
  look.ours = look.crowds[0];
  look.walker = { x: 0, z: 0, fx: 1, fz: 0 };
  const sound = heardSound(look);
  run(sound, 3);
  assert.equal(sound.stats().greeted, 0);
});

// --- the crafts (phase 4) --------------------------------------------------

// How many times the newest buffer of `secs` length at the hammer's rate has been started.
const shots = (secs) => {
  const b = ctx.buffers.findLast((x) => x.sampleRate === 22050 && x.length === Math.floor(22050 * secs));
  return b ? ctx.started.filter((s) => s === b).length : 0;
};

test('a blow that lands is heard once; a counter that stays put is not; the first look only remembers', () => {
  store = {};
  const look = village(1, { anim: 'still', tavern: false });
  const smith = { kind: 'smith', id: 'civic:smithy', at: [4, 0.5, 0], hits: 312 };
  look.crafts = [smith];
  const sound = heardSound(look);
  run(sound, 1);
  const anvil = () => shots(0.8);
  const before = anvil();
  assert.equal(before, 0, 'walking up to a smithy that has struck 312 times is not 312 blows');
  smith.hits = 313;
  run(sound, 0.5);
  assert.equal(anvil(), 1, 'one blow, one ring');
  run(sound, 2);
  assert.equal(anvil(), 1, 'and nothing while the count stands still');
  smith.hits = 314;
  look.indoors = true;
  run(sound, 0.5);
  assert.equal(anvil(), 1, 'nothing from a room');
  look.indoors = false;
  smith.hits = 315;
  run(sound, 0.5);
  assert.equal(anvil(), 2);
  // The baker: the oven door when the loaf goes in.
  const baker = { kind: 'baker', id: 'civic:bakery', at: [0, 0.5, 4], phase: 'in' };
  look.crafts = [baker];
  run(sound, 0.5);
  baker.phase = 'bake';
  run(sound, 0.5);
  assert.equal(shots(0.6), 1, 'the oven door');
});

test('the saw idles, and bites when a log is on it', () => {
  store = {};
  const look = village(1, { anim: 'still', tavern: false });
  const mill = { kind: 'saw', id: 'civic:sawmill', at: [6, 0.5, 0], cutting: false };
  look.crafts = [mill];
  const sound = heardSound(look);
  run(sound, 1);
  const idle = sound.stats().families.craft;
  assert.equal(idle.playing, 1, 'the blade always turns');
  const saw = ctx.buffers.findLast((x) => x.length === 22050 * 2);
  const quiet = loudest(saw);
  mill.cutting = true;
  run(sound, 0.5);
  assert.ok(loudest(saw) > quiet * 2, 'and is louder through a log');
  look.crafts = [];
  run(sound, 2);
  assert.equal(sound.stats().families.craft.playing, 0, 'walked away: it stops');
});

test('three hundred settlers chopping, hoeing and pushing barrows are four voices', () => {
  store = {};
  const words = ['chop', 'hoe', 'weed', 'barrow', 'carry', 'load'];
  const look = village(300, { anim: 'still', tavern: false });
  let i = 0;
  for (const f of look.crowds[0].values()) f.anim = words[i++ % words.length];
  const sound = heardSound(look);
  let peak = 0;
  for (let k = 0; k < 20 * 60; k++) {
    sound.update(1 / 60);
    const w = sound.stats().families.worker;
    peak = Math.max(peak, w.playing);
    assert.ok(w.placed <= 4);
  }
  assert.ok(peak > 0 && peak <= 4, `heard, and at most four at once (${peak})`);
  sound.setMix('work', false);
  const n = ctx.started.length;
  run(sound, 5);
  assert.equal(sound.stats().working, 0, 'Crafts and hammers off: nobody is picked');
  assert.ok(ctx.started.length - n <= 1, 'and nothing started');
});

test('every craft is synthesised, finite and inside the rails', () => {
  for (const secs of [0.8, 0.3, 0.6, 0.25, 0.35, 0.18, 0.4]) {
    const b = ctx.buffers.findLast((x) => x.sampleRate === 22050 && x.length === Math.floor(22050 * secs));
    if (!b) continue;
    const d = b.getChannelData(0);
    let peak = 0;
    for (const v of d) { assert.ok(Number.isFinite(v)); peak = Math.max(peak, Math.abs(v)); }
    assert.ok(peak > 0.01 && peak <= 1, `${secs} s: peak ${peak}`);
  }
  const saw = ctx.buffers.findLast((x) => x.length === 22050 * 2);
  const d = saw.getChannelData(0);
  let worst = 0;
  for (let i = 1; i < d.length; i++) worst = Math.max(worst, Math.abs(d[i] - d[i - 1]));
  assert.ok(Math.abs(d[0] - d[d.length - 1]) <= worst, 'the saw loops without a click');
});

// --- the hour and the weather (phase 5) ------------------------------------

// An island well inland: depthAt says land everywhere, so the sea does not drown the birds.
function inland(extra = {}) {
  const look = village(1, { anim: 'still', tavern: false });
  look.depthAt = () => 3;
  return Object.assign(look, extra);
}

test('the dawn chorus at dawn, inland, and not at noon or by the sea', () => {
  store = {};
  const look = inland({ hour: 6, night: 0.2, woods: 1 });
  const sound = heardSound(look);
  assert.equal(sound.stats().hours.dawn, 0);
  run(sound, 8);
  const dawn = sound.stats().hours.dawn;
  assert.ok(dawn > 0.05, `the birds sing at six (${dawn})`);
  assert.ok(sound.stats().buffers > 6, 'the chorus was made for it');
  look.hour = 12;
  run(sound, 12);
  assert.ok(sound.stats().hours.dawn < 0.005, 'and are done by noon');
  look.hour = 6;
  look.depthAt = () => -2.5;
  run(sound, 12);
  assert.ok(sound.stats().hours.dawn < 0.005, 'and over the sea there is only the sea');
});

test('crickets after dark, not by day and not in the rain', () => {
  store = {};
  const look = inland({ hour: 23, night: 1 });
  const sound = heardSound(look);
  run(sound, 8);
  assert.ok(sound.stats().hours.crickets > 0.04, 'a summer night');
  look.sky = 'rain';
  run(sound, 12);
  assert.ok(sound.stats().hours.crickets < 0.005, 'the rain shuts them up');
  assert.ok(sound.stats().hours.rain > 0.1, 'and is heard instead');
  assert.equal(sound.stats().sky, 'rain');
});

test('rain drums on the roofs round you, and on the one over your head indoors', () => {
  store = {};
  const look = inland({ hour: 14, night: 0, sky: 'rain', roofs: 0 });
  const sound = heardSound(look);
  run(sound, 10);
  const open = sound.stats().hours;
  assert.ok(open.rain > 0.1 && open.roofs < 0.01, 'in a field: the rain, no roofs');
  look.roofs = 8;
  run(sound, 10);
  assert.ok(sound.stats().hours.roofs > 0.1, 'in the street: the roofs too');
  look.indoors = true;
  run(sound, 12);
  const room = sound.stats().hours;
  assert.ok(room.rain < 0.01, 'inside, the open rain is gone');
  assert.ok(room.roofs > 0.1, 'and the roof over you drums');
  look.sky = 'clear';
  run(sound, 15);
  assert.ok(sound.stats().hours.roofs < 0.005, 'the shower passes');
  sound.setMix('weather', false);
  look.sky = 'rain';
  run(sound, 10);
  assert.equal(sound.stats().hours.rain, 0, 'Rain and fog off: none at all');
});

test('the foghorn only in a fog, only with a lighthouse, and rarely', () => {
  store = {};
  const look = inland({ hour: 14, night: 0, sky: 'fog' });
  const sound = heardSound(look);
  run(sound, 120);
  const horn = () => shots(3.2);
  assert.equal(horn(), 0, 'no lighthouse, no horn');
  look.lighthouse = [40, 0, 0];
  run(sound, 180);
  const n = horn();
  assert.ok(n >= 1 && n <= 5, `a horn now and then (${n} in three minutes)`);
  look.sky = 'clear';
  run(sound, 180);
  assert.equal(horn(), n, 'and none once the fog lifts');
});

test('an owl at night in the woods, a cuckoo by day in them, neither out in the open', () => {
  store = {};
  const look = inland({ hour: 2, night: 1, woods: 0 });
  const sound = heardSound(look);
  run(sound, 400);
  assert.equal(shots(2.2), 0, 'no wood, no owl');
  look.woods = 0.8;
  run(sound, 400);
  assert.ok(shots(2.2) >= 1, 'an owl in the wood');
  look.hour = 12;
  look.night = 0;
  const owls = shots(2.2);
  run(sound, 400);
  assert.ok(shots(0.9) >= 1, 'a cuckoo by day');
  assert.equal(shots(2.2), owls, 'and no owl at noon');
});

// --- the animals (phase 6) -------------------------------------------------

test('a story animal is heard when its act changes to one with a sound, once', () => {
  store = {};
  const hen = { id: 'animal:hen', species: 'chicken', act: 'peck', at: [3, 0, 0] };
  const look = inland({ hour: 12, animals: [hen] });
  const sound = heardSound(look);
  run(sound, 1);
  const pecks = () => shots(0.4);
  assert.equal(pecks(), 0, 'pecking when we arrived is not news');
  hen.act = 'still';
  run(sound, 1);
  hen.act = 'peck';
  run(sound, 1);
  assert.equal(pecks(), 1, 'she starts pecking: we hear it');
  run(sound, 5);
  assert.equal(pecks(), 1, 'and only once per start');
  hen.act = 'walk';
  run(sound, 4);
  assert.equal(pecks(), 1, 'walking has no sound of its own');
});

test('a field of three hundred sheep is four voices and a bleat every few seconds at most', () => {
  store = {};
  const herds = Array.from({ length: 300 }, (_, i) => ({ id: `sheep:${i}`, kind: 'sheep', at: [(i % 20) - 10, 0, Math.floor(i / 20) - 7] }));
  const look = inland({ hour: 12, herds });
  const sound = heardSound(look);
  let peak = 0;
  const baa = () => shots(0.9);
  for (let i = 0; i < 60 * 60; i++) { sound.update(1 / 60); peak = Math.max(peak, sound.stats().families.animal.playing); }
  const n = baa();
  assert.ok(peak <= 4, `four voices at most (${peak})`);
  assert.ok(n >= 4 && n <= 25, `bleating, but not a racket: ${n} in a minute`);
  look.night = 1;
  run(sound, 60);
  assert.equal(baa(), n, 'a field at night is asleep');
  look.night = 0;
  look.indoors = true;
  run(sound, 60);
  assert.equal(baa(), n, 'and not heard from a room');
});

// --- the sea is heard at the sea -------------------------------------------

test('the middle of the island does not hear the surf, even with a river through it', () => {
  store = {};
  // Land everywhere but a river 0.55 deep running past the camera, and open sea from x = 60.
  const look = inland();
  look.depthAt = (x, z) => (x > 60 ? -2.5 : Math.abs(z - 3) < 2 ? -0.55 : 1.5);
  const sound = heardSound(look);
  run(sound, 15);
  const middle = sound.stats().bed.sea;
  assert.ok(middle < 0.01, `a river is not a coastline (${middle})`);
  look.depthAt = (x) => (x > 1 ? -2.5 : 1.5);       // standing at the waterline
  run(sound, 15);
  assert.ok(sound.stats().bed.sea > 0.1, `on the beach the sea is the loudest thing (${sound.stats().bed.sea})`);
});

// --- water and fire (phase 7) ----------------------------------------------

test('a river babbles where you stand by it, and not across the island', () => {
  store = {};
  const look = inland({ river: [4, 0, 2] });
  const sound = heardSound(look);
  run(sound, 1);
  assert.equal(sound.stats().families.water.playing, 1, 'by the river');
  look.river = null;
  run(sound, 3);
  assert.equal(sound.stats().families.water.playing, 0, 'and gone when you walk off');
});

test('the volcano rumbles louder towards its crater', () => {
  store = {};
  const look = inland({ crater: [250, 30, 0] });
  const sound = heardSound(look);
  run(sound, 10);
  const far = sound.stats().hours.rumble;
  look.crater = [40, 30, 0];
  run(sound, 12);
  const near = sound.stats().hours.rumble;
  assert.ok(far > 0 && near > far * 3, `${far} far off, ${near} at its foot`);
  look.lava = [5, 1, 0];
  run(sound, 1);
  assert.ok(sound.stats().families.water.playing >= 1, 'and the lava bubbles beside you');
});

test('under the sea the beds from above go down and the sea\'s own comes up, with the bubbles', () => {
  store = {};
  const look = inland({ hour: 6, night: 0.2, woods: 1, bubbled: 0 });
  const sound = heardSound(look);
  run(sound, 10);
  const dry = sound.stats().hours;
  assert.ok(dry.dawn > 0.05 && dry.under === 0);
  const surface = loudest(ctx.buffers.findLast((b) => b.sampleRate === 16000));
  sound.setUnderwater(1);
  run(sound, 10);
  const wet = sound.stats().hours;
  assert.ok(wet.under > 0.1, 'the drone under the water');
  const below = loudest(ctx.buffers.findLast((b) => b.sampleRate === 16000));
  assert.ok(below < surface * 0.35, `the birds through the surface: ${below} of ${surface}`);
  const blips = () => shots(0.35);
  const n = blips();
  look.bubbled = 3;
  run(sound, 0.5);
  assert.equal(blips(), n + 1, 'a breath out: a burble');
  run(sound, 2);
  assert.equal(blips(), n + 1, 'and no more while nobody breathes');
  sound.setUnderwater(0);
  run(sound, 12);
  assert.ok(sound.stats().hours.under < 0.005, 'back up: gone');
});

// --- the rounds (phase 8) --------------------------------------------------

test('the timber wagon: hooves and wheels on the road, timber thrown down at either end', () => {
  store = {};
  const wagon = { stage: 'out', at: [6, 0, 0] };
  const look = inland({ rounds: { wagon } });
  const sound = heardSound(look);
  run(sound, 5);
  const hooves = shots(0.16);
  assert.ok(hooves >= 7 && hooves <= 14, `a walking horse, twice a second (${hooves} in five)`);
  assert.equal(sound.stats().families.round.playing >= 1, true, 'and the wheels');
  wagon.stage = 'unload';
  const h = shots(0.16);
  run(sound, 8);
  assert.equal(shots(0.16), h, 'standing still: no hooves');
  assert.ok(shots(0.6) >= 2, 'the timber going down');
  wagon.at = [200, 0, 0];
  wagon.stage = 'back';
  const far = shots(0.16);
  run(sound, 3);
  assert.equal(shots(0.16), far, 'out of earshot: nothing');
});

test('the fisherman: a swish on the strike and the float a moment after', () => {
  store = {};
  const fisher = { id: 'civic:fishery', at: [3, 0, 0], float: [3, 0, 3], bites: 4 };
  const look = inland({ rounds: { fishers: [fisher] } });
  const sound = heardSound(look);
  run(sound, 1);
  const swish = () => shots(0.3), plop = () => shots(0.32);
  assert.equal(swish() + plop(), 0, 'the bites before we came are not heard');
  fisher.bites = 5;
  run(sound, 0.3);
  assert.equal(swish(), 1, 'the strike');
  assert.equal(plop(), 0, 'and the float not yet');
  run(sound, 1.5);
  assert.equal(plop(), 1, 'there it lands');
});

test('bars landing on the pit tink, one for each', () => {
  store = {};
  const r = { bars: 20, pit: [5, 0, 0] };
  const look = inland({ rounds: r });
  const sound = heardSound(look);
  run(sound, 1);
  const tinks = () => shots(0.4);
  const n = tinks();
  r.bars = 21;
  run(sound, 0.5);
  assert.equal(tinks(), n + 1);
  run(sound, 2);
  assert.equal(tinks(), n + 1);
});

// --- 3. the noises themselves ---------------------------------------------

test('every voice is synthesised, finite, and inside the rails', () => {
  store = {};
  const sound = made();
  sound.setOn(true);
  dispatch('pointerdown');
  assert.equal(sound.stats().buffers, 6, 'sea, wind, murmur, hammer, gull, clink');

  // The six this run made are the tail of the fake's list; earlier tests filled the head.
  const mine = ctx.buffers.slice(-6);
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
  const [surf, wind, murmur] = ctx.buffers.slice(-6);
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
  // And the tavern's murmur, which is a loop too, and mono because it has a place.
  assert.equal(murmur.numberOfChannels, 1);
  const d = murmur.getChannelData(0);
  let worst = 0;
  for (let i = 1; i < d.length; i++) worst = Math.max(worst, Math.abs(d[i] - d[i - 1]));
  assert.ok(Math.abs(d[0] - d[d.length - 1]) <= worst, 'the murmur loops without a click');
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

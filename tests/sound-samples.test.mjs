// What is done to the keeper's recordings before they are played (web/js/sound-samples.js), and
// how sound.js takes them (setSamples). Held: every family's level is the loudness of the
// computed voice it replaces, a recording at any level comes out at that level, a loop of
// variants has no seam. How sound.js plays them (setSamples) is held in tests/sound.test.mjs,
// beside its fake Web Audio API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./support/shared-loader.mjs', import.meta.url);

globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const { synthFamily } = await import('../web/js/sound.js');
const { SFX_LEVEL, loudness, prepareShot, seamlessLoop, XFADE_S } = await import('../web/js/sound-samples.js');
const { SFX_FAMILIES } = await import('../shared/sfx.mjs');

// Buffers with nothing behind them but their numbers.
const ctx = {
  createBuffer(ch, length, sampleRate) {
    const data = Array.from({ length: ch }, () => new Float32Array(length));
    return { numberOfChannels: ch, length, sampleRate, duration: length / sampleRate,
      copyToChannel(src, c) { data[c].set(src.subarray(0, length)); }, getChannelData: (c) => data[c] };
  },
};
// A recording: noise at `amp`, `secs` long, on `ch` channels, from a seeded stream.
function noise(secs, amp, ch = 1, seed = 1, sr = 22050) {
  const b = ctx.createBuffer(ch, Math.floor(secs * sr), sr);
  let s = seed;
  for (let c = 0; c < ch; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) >>> 0; d[i] = amp * ((s / 2 ** 32) * 2 - 1); }
  }
  return b;
}
const run = (gen) => { for (;;) { const s = gen.next(); if (s.done) return s.value; } };
const db = (a, b) => Math.abs(20 * Math.log10(a / b));

test('every family\'s level is what its computed voice measures, within a decibel', () => {
  for (const name of Object.keys(SFX_FAMILIES)) {
    assert.ok(SFX_LEVEL[name] > 0, `${name} has a level`);
    const l = loudness(synthFamily(ctx, name));
    assert.ok(db(l, SFX_LEVEL[name]) < 1, `${name} measures ${l.toFixed(4)}, SFX_LEVEL says ${SFX_LEVEL[name]}: measure again`);
  }
});

test('a recording, loud or soft, stereo or mono, comes out at its family\'s level', () => {
  for (const [amp, ch] of [[0.9, 2], [0.02, 1], [0.3, 1]]) {
    const out = prepareShot(ctx, noise(0.6, amp, ch), 'gull');
    assert.equal(out.numberOfChannels, 1, 'a gull has a place, so it is mono');
    assert.ok(db(loudness(out), SFX_LEVEL.gull) < 0.5, `at ${amp}: ${loudness(out)}`);
  }
  assert.equal(prepareShot(ctx, noise(0.6, 0.3, 2), 'rain').numberOfChannels, 2, 'a bed keeps its width');
  // Silence is not turned up to anything.
  const quiet = prepareShot(ctx, ctx.createBuffer(1, 1000, 22050), 'gull');
  assert.ok(quiet.getChannelData(0).every((v) => v === 0));
});

test('a loop of variants has no seam, and is as loud as its family all the way round', () => {
  const takes = [noise(4, 0.5, 2, 1), noise(3, 0.05, 1, 2), noise(5, 0.2, 2, 3)];
  const loop = run(seamlessLoop(ctx, takes, 'surf', () => 0.5));
  // The crossfade is XFADE_S, but never more than a third of the shortest take (3 s here).
  const sr = 22050, x = Math.min(Math.floor(XFADE_S * sr), sr);
  assert.equal(loop.length, sr * 12 - 3 * x, 'every join, the last into the first too, overlaps by one crossfade');
  assert.equal(loop.numberOfChannels, 2);
  for (let c = 0; c < 2; c++) {
    const d = loop.getChannelData(c);
    // The loop point sits inside a crossfade, so it is no bigger a step than any other.
    let worst = 0;
    for (let i = 1; i < d.length; i++) worst = Math.max(worst, Math.abs(d[i] - d[i - 1]));
    assert.ok(Math.abs(d[0] - d[d.length - 1]) <= worst);
    // And no stretch of it is a hole or a shout: every second within 3 dB of the family's level.
    for (let i0 = 0; i0 + sr <= d.length; i0 += sr) {
      let sum = 0;
      for (let i = i0; i < i0 + sr; i++) sum += d[i] * d[i];
      assert.ok(db(Math.sqrt(sum / sr), SFX_LEVEL.surf) < 3, `second ${i0 / sr} of channel ${c}`);
    }
  }
  assert.equal(run(seamlessLoop(ctx, [], 'surf')), null);
});

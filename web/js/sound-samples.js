// What sound.js does to the keeper's own recordings before it plays them (Plans/meer-geluiden.md,
// phase 9; the names are shared/sfx.mjs). It is handed AudioBuffers that are ready - main.js
// fetched and decoded them (web/js/sfx-loader.js) - and this module only measures and copies
// samples, through the context's own createBuffer, so it runs under Node on a fake context too.
//
// Two things, and both are about the mix rather than the file:
//
// - **Loudness.** A recording comes at whatever level whoever made it chose, and the island's mix
//   was set by ear against the computed voices. So every variant is scaled to the loudness of the
//   computed buffer it replaces (`SFX_LEVEL`, measured off that buffer by the same `loudness`,
//   and held to it by tests/sound-samples.test.mjs), and the voice's own volume, the part and the
//   bus (Settings -> Audio) do the rest exactly as they did for the computed one. Loudness is a
//   gated RMS - the mean power of the 50 ms windows within GATE_DB of the loudest - so a gull with
//   a second of silence after it measures as a gull, not as a fifth of one.
// - **A loop with no seam.** The variants of a loop are laid end to end, each joined to the next by
//   an equal-power crossfade of XFADE_S, and the last into the first - the tail that runs past the
//   end is folded over the head - so the buffer's end *is* its start and the loop point is inside a
//   crossfade like every other join. The order is shuffled once, when the loop is made, so two
//   pages need not play the same take first; a file longer than LOOP_MAX_S is cut there, since a
//   five-minute stereo field recording is 115 MB of Float32 to hold.
//
// Placed voices (a PositionalAudio) are folded to mono, as every computed placed voice is; the
// beds keep up to two channels.
export const WINDOW_S = 0.05;
export const GATE_DB = 30;
export const XFADE_S = 1.5;
export const LOOP_MAX_S = 90;
// How far a recording's level may be moved to meet its family's. A file that needs more than this
// is mostly silence or already distorted, and turning it up 40 dB would bring up its hiss instead.
export const GAIN_RANGE = [1 / 32, 16];

// Which families are beds: heard as the weather is, with no place, so stereo is kept.
export const SFX_BEDS = new Set(['surf', 'wind', 'dawn', 'crickets', 'rain', 'roofs', 'rumble', 'under']);

// The loudness (`loudness` below) of each computed family as web/js/sound.js makes it - the level a
// recording of that family is brought to. Measured, not chosen: tests/sound-samples.test.mjs makes
// every computed buffer and fails when one has moved more than a decibel off its number here, so a
// change to a synthesiser comes with a new number rather than leaving recordings at the old level.
export const SFX_LEVEL = {
  surf: 0.1467, wind: 0.1600, murmur: 0.1397, kraken: 0.1497, borrel: 0.1294, river: 0.0896,
  lava: 0.1056, rumble: 0.1398, rain: 0.1199, roofs: 0.0798, dawn: 0.0560, crickets: 0.0518,
  under: 0.0900, saw: 0.0800, cart: 0.0791, gull: 0.1130, clink: 0.0726, hammer: 0.1236,
  bell: 0.1200, anvil: 0.1000, cleaver: 0.1095, oven: 0.0835, thud: 0.0600, chop: 0.1322,
  hoe: 0.0500, weed: 0.0400, squeak: 0.0335, load: 0.0641, owl: 0.0877, cuckoo: 0.0706,
  foghorn: 0.1239, baa: 0.0800, moo: 0.0900, cluck: 0.0948, quack: 0.0938, bleat: 0.0700,
  snort: 0.0700, peck: 0.0566, scratch: 0.0404, chirp: 0.0661, bonk: 0.0985, flap: 0.0500,
  bubble: 0.0661, hoof: 0.1011, plank: 0.0986, swish: 0.0400, plop: 0.0759,
};

// Gated RMS over every channel (see the head of this file). 0 for a silent buffer.
export function loudness(buf) {
  const sr = buf.sampleRate, n = buf.length, w = Math.max(1, Math.round(sr * WINDOW_S));
  const chans = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const powers = [];
  for (let i0 = 0; i0 < n; i0 += w) {
    const i1 = Math.min(n, i0 + w);
    let sum = 0;
    for (const d of chans) for (let i = i0; i < i1; i++) sum += d[i] * d[i];
    powers.push(sum / ((i1 - i0) * chans.length));
  }
  const top = Math.max(0, ...powers);
  if (!(top > 0)) return 0;
  const gate = top * Math.pow(10, -GATE_DB / 10);
  let sum = 0, k = 0;
  for (const p of powers) if (p >= gate) { sum += p; k++; }
  return Math.sqrt(sum / k);
}

// The gain that brings `buf` to `target`, within GAIN_RANGE and never past a peak of 1 (the
// computed voices keep inside the rails, tests/sound.test.mjs). 1 when there is nothing to go by.
// Measured on what will be played - after folding to mono, which takes 3 dB off two channels
// that do not agree - not on the file.
export function levelFor(buf, target) {
  const l = loudness(buf);
  if (!(l > 0) || !(target > 0)) return 1;
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  let g = Math.min(GAIN_RANGE[1], Math.max(GAIN_RANGE[0], target / l));
  if (peak > 0 && g * peak > 1) g = 1 / peak;
  return g;
}

// `buf`'s first `length` samples as `channels` channels: one folds every channel in, two take
// each its own (a mono file twice). As a buffer-shaped view, so `loudness` can measure it.
function folded(buf, channels, length = buf.length) {
  const data = Array.from({ length: channels }, (_, c) => {
    const out = new Float32Array(length);
    const src = channels === 1
      ? Array.from({ length: buf.numberOfChannels }, (_, k) => buf.getChannelData(k))
      : [buf.getChannelData(Math.min(c, buf.numberOfChannels - 1))];
    for (const d of src) for (let i = 0; i < length; i++) out[i] += d[i] / src.length;
    return out;
  });
  return { numberOfChannels: channels, length, sampleRate: buf.sampleRate, getChannelData: (c) => data[c] };
}
const channelsFor = (family, n) => (SFX_BEDS.has(family) ? Math.min(2, n) : 1);

// A one-shot as it is played: a copy, folded to mono unless it is a bed, at the family's level.
export function prepareShot(ctx, buf, family) {
  const f = folded(buf, channelsFor(family, buf.numberOfChannels));
  const g = levelFor(f, SFX_LEVEL[family]);
  const out = ctx.createBuffer(f.numberOfChannels, f.length, f.sampleRate);
  for (let c = 0; c < f.numberOfChannels; c++) {
    const d = f.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
    out.copyToChannel(d, c);
  }
  return out;
}

// The variants of a loop as one buffer that loops without a seam (the head of this file says how).
// A generator, a variant a step, so sound.js can make it a frame at a time beside its own families
// (makeMore). `rng` picks the order; Math.random by default.
export function* seamlessLoop(ctx, bufs, family, rng = Math.random) {
  const list = bufs.filter((b) => b && b.length > 0);
  if (!list.length) return null;
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const sr = list[0].sampleRate;
  const channels = channelsFor(family, Math.max(...list.map((b) => b.numberOfChannels)));
  const lengths = list.map((b) => Math.min(b.length, Math.floor(LOOP_MAX_S * sr)));
  // The crossfade never takes more than a third of the shortest variant, or two joins would meet.
  const x = Math.max(1, Math.min(Math.floor(XFADE_S * sr), Math.floor(Math.min(...lengths) / 3)));
  const total = lengths.reduce((a, b) => a + b, 0) - list.length * x;
  if (total < 2 * x) return null;
  const out = Array.from({ length: channels }, () => new Float32Array(total));
  let at = 0;
  for (let v = 0; v < list.length; v++) {
    const len = lengths[v], f = folded(list[v], channels, len), g = levelFor(f, SFX_LEVEL[family]);
    for (let c = 0; c < channels; c++) {
      const d = f.getChannelData(c), o = out[c];
      for (let i = 0; i < len; i++) {
        // Equal power: the two takes in a join are unrelated noise, so their powers add.
        const w = i < x ? Math.sin((Math.PI / 2) * (i + 0.5) / x)
          : i >= len - x ? Math.cos((Math.PI / 2) * (i - (len - x) + 0.5) / x) : 1;
        o[(at + i) % total] += d[i] * g * w;
      }
    }
    at += len - x;
    yield;
  }
  const buf = ctx.createBuffer(channels, total, sr);
  for (let c = 0; c < channels; c++) buf.copyToChannel(out[c], c);
  return buf;
}

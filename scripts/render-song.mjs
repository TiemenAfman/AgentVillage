// Render one of the rooms' computed songs to a WAV, to listen to outside the island:
//   node scripts/render-song.mjs tavern out.wav      (the village tavern's jazz)
//   node scripts/render-song.mjs shanty out.wav      (the Salty Kraken's jukebox)
//   node scripts/render-song.mjs rave out.wav        (the castle on a Saturday night)
// The song is made by the same code the page runs (web/js/sound.js synthSong), on a stand-in for
// the Web Audio context that only holds the samples.
import fs from 'node:fs';
import { register } from 'node:module';

register('../tests/support/shared-loader.mjs', import.meta.url);
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const [kind = 'tavern', out = `${kind}.wav`] = process.argv.slice(2);
const { synthSong } = await import('../web/js/sound.js');
const ctx = {
  createBuffer(ch, length, sampleRate) {
    const data = Array.from({ length: ch }, () => new Float32Array(length));
    return { numberOfChannels: ch, length, sampleRate, duration: length / sampleRate,
      copyToChannel(src, c) { data[c].set(src.subarray(0, length)); }, getChannelData: (c) => data[c] };
  },
};
const buf = synthSong(ctx, kind);
const pcm = buf.getChannelData(0);
const wav = Buffer.alloc(44 + pcm.length * 2);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write('WAVE', 8);
wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(buf.sampleRate, 24); wav.writeUInt32LE(buf.sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(pcm.length * 2, 40);
for (let i = 0; i < pcm.length; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
fs.writeFileSync(out, wav);
console.log(`${kind}: ${buf.duration.toFixed(1)} s at ${buf.sampleRate} Hz -> ${out}`);

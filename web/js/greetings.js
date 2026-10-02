// Who says hello (Plans/meer-geluiden.md, "Begroeting op straat"): one of our own settlers you walk
// past, close and in front of you, now and then - and, more rarely, two of them passing each other
// in the street. This decides who and when; web/js/sound.js asks it in its pick and says it.
//
// Pure and page-local: no DOM, no clock of its own (the caller hands `now` in seconds), nothing on
// the wire - a greeting is this screen's alone, and another player standing beside you does not
// hear it. Kept out of sound.js so tests/greetings.test.mjs can hold the rules without an audio
// graph, and so a speech bubble could be drawn off the same decision later without asking sound.
import { makeRng } from 'shared/rng.mjs';

// How close, how squarely in front of you (the cosine of ~70 degrees), and how often: a settler
// greets you at most once in GREET_AGAIN seconds, and the island at most once in GREET_GAP. A
// village that greets you at every step is a shopping centre.
export const GREET_R = 3.5;
export const GREET_COS = 0.34;
export const GREET_AGAIN = 90;
export const GREET_GAP = 4;
// Two of ours passing each other on foot: within PASS_R, within PASS_EAR of the ears, at most once
// in PASS_GAP on the whole island. Only the first PASS_LOOK walkers near the ears are compared, so
// a crowd of three hundred is not a pair search of forty-five thousand.
export const PASS_R = 1.5;
export const PASS_EAR = 25;
export const PASS_GAP = 20;
const PASS_LOOK = 40;
const WALKING = new Set(['walk', 'haul', 'carry', 'barrow']);

// The number of different little phrases sound.js makes (greetSong). The one copy.
export const PHRASES = 3;

// A settler's own voice: how high (a playback rate) and which phrase is theirs, from their id on a
// stream of its own - `<id>:voice`, like `<id>:gait` - and never from `<id>:walk`, which is ordered
// and load-bearing (shared/settlerwalk.mjs). The same settler always sounds like themselves.
const voices = new Map();
export function voiceOf(id) {
  let v = voices.get(id);
  if (!v) {
    const rng = makeRng(`${id}:voice`);
    v = { rate: 0.8 + rng.next() * 0.55, phrase: Math.floor(rng.next() * PHRASES) };
    if (voices.size > 2000) voices.clear();
    voices.set(id, v);
  }
  return v;
}

const drawn = (f) => f && f.visible !== false && !f.hidden && Array.isArray(f.pos);

export function createGreeter() {
  const said = new Map();          // id -> when they last said anything
  let lastGreet = -Infinity;
  let lastPass = -Infinity;
  const ready = (id, now) => !(said.get(id) > now - GREET_AGAIN);

  // `walker` is { x, z, fx, fz } (where you stand and the way you face, a unit vector) or null;
  // `figures` our own settlers (crowd-view.js figures: id, pos [x, z], y, anim, visible); `ear` the
  // listener's [x, z]. Answers what to say this pick: [{ id, at: [x, y, z], rate, phrase, to }],
  // `to` 'you' or 'them'. At most one of each.
  function pick({ now, walker, figures, ear }) {
    const out = [];
    if (!figures) return out;
    if (walker && now - lastGreet >= GREET_GAP) {
      let best = null, bestD = GREET_R;
      for (const f of figures) {
        if (!drawn(f) || !ready(f.id, now)) continue;
        const dx = f.pos[0] - walker.x, dz = f.pos[1] - walker.z;
        const d = Math.hypot(dx, dz);
        if (d >= bestD || d < 0.05) continue;
        if ((dx * walker.fx + dz * walker.fz) / d < GREET_COS) continue;
        best = f; bestD = d;
      }
      if (best) {
        lastGreet = now;
        said.set(best.id, now);
        out.push(say(best, 'you', now));
      }
    }
    if (ear && now - lastPass >= PASS_GAP) {
      const near = [];
      for (const f of figures) {
        if (!drawn(f) || !WALKING.has(f.anim) || !ready(f.id, now)) continue;
        if (Math.hypot(f.pos[0] - ear[0], f.pos[1] - ear[1]) > PASS_EAR) continue;
        near.push(f);
        if (near.length >= PASS_LOOK) break;
      }
      outer: for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const a = near[i], b = near[j];
          if (Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) > PASS_R) continue;
          // The one with the lower id speaks: which of two says it is no matter, as long as it is
          // the same one every time this pair meets.
          const who = a.id < b.id ? a : b;
          lastPass = now;
          said.set(a.id, now);
          said.set(b.id, now);
          out.push(say(who, 'them', now));
          break outer;
        }
      }
    }
    if (said.size > 4000) for (const [id, t] of said) if (t < now - GREET_AGAIN) said.delete(id);
    return out;
  }

  // A phrase of their own most times, and now and then one of the others - the same settler does
  // not say exactly the same thing every time you meet.
  function say(f, to, now) {
    const v = voiceOf(f.id);
    const phrase = (v.phrase + (Math.floor(now / 7) % 3 === 0 ? 1 : 0)) % PHRASES;
    return { id: f.id, at: [f.pos[0], (f.y || 0) + 1.1, f.pos[1]], rate: v.rate, phrase, to };
  }

  return { pick, said: () => said.size };
}

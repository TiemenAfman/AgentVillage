// The weather, and the sea is the only thing that has any.
//
// This is the cheapest thing there is that makes a shared world feel shared: one word,
// changed slowly on the sea's own clock, and everybody in that world stands in the same
// rain at the same moment without a single byte of state to keep. It costs no disk, and it
// must never be given any - lib/sea.mjs says at length why the sea writes nothing down,
// and the corollary here is that a restart is a fresh sky and that is the entire migration
// story. Nothing may key off "the weather before the restart"; there is no such thing.
//
// A spell is a word and two numbers:
//
//   sky     the word, and the only part a client has to understand
//   seed    a number the drawing may do as it likes with - which way the wind leans, how
//           hard it comes down - so one shower differs from the next without a second
//           message ever going out
//   since   when this spell began, so a client joining halfway through a downpour arrives
//           already wet instead of watching the rain fade in from nothing
//
// `until` stays here. A client that knew when the sky would turn would draw the turn
// before the sea had made it, and a sea that restarts in the meantime would be caught out
// by every page in the world at once.
//
// The vocabulary is closed on purpose, and the failure is one-directional by design: a
// client that does not recognise a word draws clear skies (web/js/weather.js), so adding a
// fifth sky here gives an old page sunshine rather than an exception. The same fallback is
// what a page gets from a sea too old to have any weather at all, which is why the two
// have to agree - and they do, because both of them are "clear".
import { makeRng } from '../shared/rng.mjs';

export const SKIES = ['clear', 'overcast', 'rain', 'fog'];

// How long a spell lasts before another is drawn, and how far that is stretched or
// squeezed. The island's clock is real time - an island hour is an hour - so eleven
// minutes is about a quarter of an afternoon, which is slow enough that the sky turning is
// something you notice having happened rather than something you watch. The stretch is
// there so a world never falls into a rhythm somebody can time: six minutes to twenty-one.
const SPELL_MS = 11 * 60 * 1000;
const STRETCH = [0.55, 1.9];

// What tends to follow what, as weights rather than probabilities so the table reads and
// edits a row at a time. Three things in it are deliberate:
//
//   Rain never comes out of a clear sky. It arrives through overcast, which is what makes
//   an afternoon going grey mean something instead of being decoration.
//
//   Nothing runs straight into itself except rain. A spell that renews is a long steady
//   downpour and is worth having; two clear spells in a row are indistinguishable from one
//   long one and would only spend a broadcast saying so.
//
//   Fog is the rare one, and it never follows rain. Rain clearing into fog is meteorology;
//   rain clearing into fog every third shower is a world where you can never see the
//   neighbours, and the neighbours are the reason there is a sea at all.
const NEXT = {
  clear: [['overcast', 6], ['fog', 2]],
  overcast: [['clear', 5], ['rain', 5], ['fog', 1]],
  rain: [['overcast', 6], ['clear', 3], ['rain', 2]],
  fog: [['clear', 5], ['overcast', 3]],
};

export function createWeather({ now = () => Date.now(), spellMs = SPELL_MS, seed = null } = {}) {
  // Seeded off the clock, so two seas started a second apart do not run the same weather,
  // and injectable so a test can say in advance what the sky is going to do. Deliberately
  // shared/rng.mjs rather than Math.random: this project has one generator and a second
  // source of randomness is a second thing to have to rule out when a world misbehaves.
  const rng = makeRng(seed == null ? (now() >>> 0) : seed);

  function draw(from) {
    const rows = NEXT[from] || NEXT.clear;
    let total = 0;
    for (const [, w] of rows) total += w;
    let r = rng.next() * total;
    for (const [sky, w] of rows) { r -= w; if (r <= 0) return sky; }
    return rows[rows.length - 1][0];
  }

  function begin(sky, at) {
    return {
      sky,
      seed: (rng.next() * 0x100000000) >>> 0,
      since: at,
      until: at + Math.round(spellMs * rng.range(STRETCH[0], STRETCH[1])),
    };
  }

  // Every world starts clear. A sea that has just come up is the one moment when nobody can
  // tell a fresh sky from a bug in one, so it opens with the sky that looks like nothing
  // having happened - which is also exactly what a client falls back to when this whole
  // feature is absent, so the two agree at the one point they are ever compared.
  let spell = begin('clear', now());

  const wire = () => ({ sky: spell.sky, seed: spell.seed, since: spell.since });

  return {
    current: wire,
    // Roll the sky over if this spell has run out, and hand back the new one. Null means
    // nothing changed, which is the answer almost every time this is asked: the caller
    // broadcasts on a word, not on a beat.
    tick() {
      const t = now();
      if (t < spell.until) return null;
      spell = begin(draw(spell.sky), t);
      return wire();
    },
  };
}

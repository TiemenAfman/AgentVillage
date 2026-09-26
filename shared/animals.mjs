// Who the island's story animals are, as words and numbers every side agrees on
// (Plans/dierenverhalen.md). The islander decides what happens to them (lib/animal-stories.mjs),
// the sea walks them (shared/animalwalk.mjs, lib/animal-crowd.mjs) and the page draws them
// (web/js/animal-view.js); each of those reads its vocabulary from here, so the one copy of
// "which acts exist, in which wire order" and "what does a restless goat do differently" is
// this file. Plain data and plain arithmetic, like the rest of shared/.

// The species that can be somebody. Every one of them already has a baked model and joint
// animation in web/js/fauna.js; the other six (horse, cow, sheep, duck, gull, pig) stay
// scenery until a story needs them.
export const STORY_SPECIES = ['chicken', 'goat', 'sparrow'];

// The most named animals one island keeps. A small cast with habits people remember is the
// point; a menagerie is the thing to avoid (docs/next/animal-stories.md, "Experience").
export const MAX_ANIMALS = 6;

// Who comes, in order. The first hen turns up the first time somebody is watching an island
// that is working; everybody after that needs a day and a few encounters since the last one.
export const ARRIVAL_ORDER = ['chicken', 'goat', 'sparrow', 'chicken', 'goat', 'sparrow'];

// What an animal is doing, as the sea says it and the page draws it. The ORDER IS THE WIRE
// FORMAT: a row carries the index, so new words go on the end and nothing is ever
// rearranged. An index a page has never heard of reads as 'still'.
export const ACTS = [
  'still', 'walk', 'feed', 'peck', 'dust', 'scratch', 'rest', 'nudge', 'nibble', 'butt',
  'watch', 'perch', 'hop', 'fly', 'chirp', 'steal', 'point',
];
export const ACT_OF = new Map(ACTS.map((a, i) => [a, i]));
// The acts that mean going somewhere: they ride at the walker rate and the page takes its
// heading from the movement rather than from the row's face.
export const MOVING_ACTS = new Set(['walk', 'fly']);

// How each species moves on the sea, in island units a second and in seconds. `walk` is the
// amble inside its patch (the same numbers web/js/fauna.js has always animated at), `hurry`
// the pace of an errand to somebody's door - a hen crossing a hamlet at an amble would take
// five minutes to get anywhere. `flies` is the sparrow's: it crosses by air, never by path.
// `reach` is how far from home, in island units, the story will send it to somebody's door:
// a hen visits the neighbours, not a house on the far side of the river - at `hurry` that
// is a minute's walk, where the island's whole width was five.
export const MOTION = {
  chicken: { walk: 0.12, hurry: 0.3, still: [1, 4], feed: [1.5, 4], roam: 0.9, reach: 16 },
  goat: { walk: 0.15, hurry: 0.34, still: [1, 5], feed: [2, 6], roam: 1.4, reach: 24 },
  sparrow: { walk: 0.06, hurry: 1.1, still: [2, 7], feed: [0.6, 1.8], roam: 1.2, flies: true, reach: 36 },
};

// Character. Two or three of these per animal, drawn once when it arrives and kept in the
// journal. They weigh which door it chooses (lib/animal-stories.mjs) and how it moves here
// (`motionOf`): a trait that changes nothing anybody can see is not a trait.
//   pace   how briskly it walks          roam   how far it wanders from home
//   calm   how long it stands still      busy   how much it likes a working house
//   known  how much it goes back to whoever it already knows
export const TRAITS = {
  bold: { busy: 3, calm: 0.8, line: 'bold' },
  shy: { busy: 0.33, roam: 0.8, line: 'shy' },
  curious: { known: 0.5, roam: 1.2, line: 'curious' },
  sociable: { known: 2.5, line: 'sociable' },
  restless: { pace: 1.3, calm: 0.5, roam: 1.3, line: 'restless' },
  homebody: { pace: 0.85, calm: 1.4, roam: 0.6, line: 'a homebody' },
  greedy: { line: 'greedy' },
  gentle: { line: 'gentle' },
  stubborn: { calm: 1.2, line: 'stubborn' },
  vain: { line: 'vain' },
};
// The ones that cannot both be true of one animal.
export const OPPOSITES = [['bold', 'shy'], ['restless', 'homebody'], ['gentle', 'stubborn'], ['curious', 'sociable']];
export const TRAIT_POOLS = {
  chicken: ['bold', 'shy', 'curious', 'sociable', 'restless', 'homebody', 'greedy', 'gentle'],
  goat: ['bold', 'shy', 'curious', 'sociable', 'restless', 'homebody', 'greedy', 'stubborn', 'gentle'],
  sparrow: ['bold', 'shy', 'curious', 'sociable', 'restless', 'vain', 'greedy'],
};

// How an animal with these traits moves, as multipliers on MOTION. The same answer on the sea
// (which walks it) and on the page (which only reads `pace` to pick a stride).
export function motionOf(species, traits = []) {
  const out = { pace: 1, roam: 1, calm: 1 };
  for (const t of traits) {
    const k = TRAITS[t];
    if (!k) continue;
    if (k.pace) out.pace *= k.pace;
    if (k.roam) out.roam *= k.roam;
    if (k.calm) out.calm *= k.calm;
  }
  return out;
}

// The permanent marks a story leaves (lib/animal-stories.mjs decides, lib/animal-life.mjs
// finds the ground, web/js/animal-view.js draws). Wire vocabulary: append only.
export const TRACE_KINDS = ['nest', 'lookout', 'perch', 'feeder', 'print', 'find', 'cache'];

// Names, per species. Short, and the sort a village gives its animals. Drawn without
// repeats on one island; a seventh hen (there is never a seventh) would get a number.
export const NAMES = {
  chicken: ['Pip', 'Henny', 'Dotje', 'Saffie', 'Kip', 'Mabel', 'Goldie', 'Wiebke', 'Clara', 'Pudding'],
  goat: ['Bram', 'Guus', 'Hilde', 'Billy', 'Nettie', 'Ramses', 'Doortje', 'Bokkie', 'Juffrouw', 'Teun'],
  sparrow: ['Tjilp', 'Pieter', 'Flits', 'Mus', 'Sproet', 'Pim', 'Veertje', 'Kwik', 'Snip', 'Dribbel'],
};

// What an animal's public card says it is doing, by act. The page's hover label and a
// visitor's card read this; the keeper's dossier says more.
export const HABIT_OF = {
  still: 'looking about', walk: 'on the move', feed: 'foraging', peck: 'pecking at a doorstep',
  dust: 'taking a dust bath', scratch: 'scratching out a hollow', rest: 'dozing in the sun',
  nudge: 'nudging at a door', nibble: 'nibbling a hedge', butt: 'butting a gate',
  watch: 'keeping watch', perch: 'perched on a roof', hop: 'hopping about a garden',
  fly: 'on the wing', chirp: 'singing from a chimney', steal: 'making off with something',
  point: 'showing somebody something',
};

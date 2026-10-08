// The keeper's own sound samples (Plans/meer-geluiden.md, phase 9): which names a file in
// HOME/audio/sfx may have, and what each stands in for. The one copy - lib/sfx.mjs lists and
// serves the folder by it, web/js/sfx-loader.js and web/js/sound.js take a sample by it.
//
// A family is one of web/js/sound.js's computed voices, under the name sound.js already gives it
// (its `buffers`, `LAZY` and the *_SHOTS tables); a file is `<family>.<ext>` or
// `<family>-<anything>.<ext>` - `surf-1.ogg`, `surf-2.ogg`, `gull-herring.mp3` - and every file of a
// family is a variant of it: a one-shot plays one of them at random each time, a loop plays them
// all, one after the other, joined by crossfades. Several takes of a gull keep a recognisable cry
// from becoming a tic. A family with no file keeps its computed voice.
//
// The rooms' music (the rave, the shanties) and the greetings' babble are not here: the music has
// its own folders (lib/music.mjs), and a greeting is a phrase per settler's voice, not a sound.

// name -> [loop?, what it is]. Order is the README's.
export const SFX_FAMILIES = {
  // The beds and the loops with a place.
  surf: [true, 'the sea on the shore - the bed by the coast'],
  wind: [true, 'the wind - the bed inland and on the heights'],
  murmur: [true, 'the village tavern\'s chatter, through its door and inside (replaces the island\'s own recording)'],
  kraken: [true, 'the Salty Kraken\'s crew, through its door and inside (replaces the island\'s own recording)'],
  borrel: [true, 'the village out on the square for coffee, lunch or the Friday borrel'],
  river: [true, 'a river where you stand by it'],
  lava: [true, 'lava bubbling by a flow on the volcano'],
  rumble: [true, 'the volcano\'s rumble, louder towards the crater'],
  rain: [true, 'rain, out of doors'],
  roofs: [true, 'rain on the roofs round you, and on the one over your head indoors'],
  dawn: [true, 'the dawn chorus, inland'],
  crickets: [true, 'crickets after dark'],
  under: [true, 'under the sea: the low hum a diver hears'],
  saw: [true, 'the sawmill\'s blade'],
  cart: [true, 'wheels on a road: the timber wagon and the gold cart'],
  // The one-shots.
  gull: [false, 'a gull over the quay'],
  clink: [false, 'glasses at a tavern and on the square'],
  hammer: [false, 'a settler hammering at their house'],
  bell: [false, 'one stroke of the church bell (it is struck as many times as the hour)'],
  anvil: [false, 'the smith\'s hammer on the anvil'],
  cleaver: [false, 'the butcher\'s cleaver into the block'],
  oven: [false, 'the baker\'s oven door'],
  thud: [false, 'a loaf set down on the board'],
  chop: [false, 'an axe into wood'],
  hoe: [false, 'a hoe in the soil'],
  weed: [false, 'weeds pulled up'],
  squeak: [false, 'a wheelbarrow\'s wheel'],
  load: [false, 'something heavy put down: a load, a gold bar'],
  owl: [false, 'an owl in the woods at night'],
  cuckoo: [false, 'a cuckoo in the woods by day'],
  foghorn: [false, 'the lighthouse\'s foghorn in a fog'],
  baa: [false, 'a sheep'],
  moo: [false, 'a cow'],
  cluck: [false, 'a hen'],
  quack: [false, 'a duck'],
  bleat: [false, 'a goat'],
  snort: [false, 'a horse'],
  peck: [false, 'a hen pecking'],
  scratch: [false, 'a hen scratching the ground'],
  chirp: [false, 'a sparrow'],
  bonk: [false, 'a goat butting something'],
  flap: [false, 'wings flapping'],
  bubble: [false, 'bubbles a diver breathes out'],
  hoof: [false, 'one hoof on a road'],
  plank: [false, 'timber thrown down'],
  swish: [false, 'a fishing rod cast'],
  plop: [false, 'the float landing in the water'],
};

export const sfxLoops = (family) => Object.hasOwn(SFX_FAMILIES, family) && SFX_FAMILIES[family][0];

// What a browser decodes (Chrome and WebView2 do all of these). The server's content types for
// them are lib/music.mjs MUSIC_TYPES, which tests/sfx.test.mjs holds to this list.
export const SFX_EXTS = ['.ogg', '.opus', '.mp3', '.wav', '.m4a', '.aac', '.flac'];

// A file name -> its family, or null. Bare names only (no folder, nothing hidden), letters, digits,
// `_`, `-` and `.`; matched without regard to case, so `Surf-1.OGG` is the sea too.
export function sfxFamilyOf(file) {
  if (typeof file !== 'string' || file.length > 120) return null;
  const m = /^([a-z]+)(?:-[a-z0-9_.-]*)?(\.[a-z0-9]+)$/i.exec(file);
  if (!m) return null;
  const family = m[1].toLowerCase();
  if (!Object.hasOwn(SFX_FAMILIES, family) || !SFX_EXTS.includes(m[2].toLowerCase())) return null;
  return family;
}

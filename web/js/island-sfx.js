// The island's own recordings: committed in web/audio and played on every page - the keeper's,
// a visitor's, the phone and the web - for a family that has no file of the keeper's own in
// HOME/audio/sfx (which still wins: web/js/sfx-loader.js `defaults`). Only what may be published
// goes here: every file is CC0, and web/audio/CREDITS.md says where it is from.
//
// The taverns' chatter is the reason this exists; the sheep, cows, hens and goats came next. Computed, it sounded like surf or static, and a
// recording that only the keeper heard left every other page with no chatter at all (the keeper,
// 8 October 2026).
// The farm animals' calls (the keeper, 8 and 9 October 2026): four takes each, so a field does not say
// the same thing twice running (sound.js need() picks one at random, never the last).
const takes = (family) => Object.freeze([1, 2, 3, 4].map((k) => `${family}-${k}.ogg`));

export const ISLAND_SFX = Object.freeze({
  murmur: Object.freeze(['tavern-chatter.ogg']),
  kraken: Object.freeze(['kraken-chatter.ogg']),
  baa: takes('baa'),
  moo: takes('moo'),
  cluck: takes('cluck'),
  bleat: takes('bleat'),
  snort: takes('snort'),
  quack: takes('quack'),
  crow: takes('crow'),
});

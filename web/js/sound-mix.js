// How loud each kind of sound is on this screen: Settings -> Audio (Plans/meer-geluiden.md, "Het
// tabblad Audio in Settings"). Four sliders and a switch per part, kept per browser like the Sound
// chip itself, because how loud somebody's speakers are is nobody's business but theirs.
//
// The one copy of the table: ui.js draws the tab from MIX_LEVELS and MIX_PARTS, and web/js/sound.js
// builds one gain node per bus and per part from the same two lists, so a part cannot be offered
// that the graph has no node for. Only sound.js writes (`sound.setMix`, which calls saveMix); the
// Sound chip stays the one on/off switch (`promptholm.sound`), and none of this touches it.
//
// DOM-free and three-free, so tests/sound-mix.test.mjs can hold it under Node with a map for
// storage.

export const MIX_KEY = 'promptholm.sound.mix';

// The sliders, 0..1. Master multiplies everything; every part below sits on exactly one of the other
// three. No fifth Effects slider (open question 9 in the plan): every part can be switched off on its
// own, and four sliders are four things anybody can tell apart.
export const MIX_LEVELS = Object.freeze([
  ['master', 'Master'],
  ['ambience', 'Ambience'],
  ['music', 'Music'],
  ['speech', 'Speech'],
]);
export const MIX_BUSES = Object.freeze(['ambience', 'music', 'speech']);
export const MIX_STEP = 0.05;

// [id, label, bus]. The order is the order the tab lists them in. An id is a key in the stored
// object beside the sliders' keys, so none of them may be one of those four.
export const MIX_PARTS = Object.freeze([
  ['sea', 'Sea and wind', 'ambience'],
  ['birds', 'Birds and animals', 'ambience'],
  ['night', 'Crickets and the night', 'ambience'],
  ['weather', 'Rain and fog', 'ambience'],
  ['work', 'Crafts and hammers', 'ambience'],
  ['bell', 'Church bell', 'ambience'],
  ['rounds', 'The rounds', 'ambience'],
  ['water', 'Rivers and the volcano', 'ambience'],
  ['underwater', 'Under water', 'ambience'],
  ['tavern', 'Tavern chatter', 'speech'],
  ['borrel', 'The borrel', 'speech'],
  ['greetings', 'Greetings', 'speech'],
  ['songs', 'The rave and the shanties', 'music'],
  ['jazz', 'Tavern jazz', 'music'],
  ['tracks', 'Your own tracks', 'music'],
]);
const PART_IDS = new Set(MIX_PARTS.map(([id]) => id));
const LEVEL_IDS = new Set(MIX_LEVELS.map(([id]) => id));
export const busOf = (part) => (MIX_PARTS.find(([id]) => id === part) || [])[2] || null;

// Parts that start switched off. They do not sound right yet (the keeper's word: "a bit broken"),
// so they stay off until they are mended - then take them out of here. Not off in sound.js: whoever
// switches one on in Settings -> Audio hears it, and since only what differs from the defaults is
// kept, that `true` is kept and survives taking a part out of this list.
export const MIX_OFF = Object.freeze(['sea', 'water', 'borrel']);

// Every slider at full and every part on but MIX_OFF's.
export function mixDefaults() {
  const out = {};
  for (const [id] of MIX_LEVELS) out[id] = 1;
  for (const [id] of MIX_PARTS) out[id] = !MIX_OFF.includes(id);
  return out;
}

// A value for `key` as it would be kept, or null for a key that is not one of ours or a value that
// is not one it can take: a slider is a number clamped to 0..1, a part is a boolean.
export function clampMix(key, value) {
  if (LEVEL_IDS.has(key)) {
    if (typeof value === 'boolean' || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
  }
  if (PART_IDS.has(key)) return typeof value === 'boolean' ? value : null;
  return null;
}

// This browser's localStorage, or null; even reading the name throws where site data is blocked.
function browserStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function readKept(storage) {
  try {
    const kept = JSON.parse((storage && storage.getItem(MIX_KEY)) || 'null');
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
  } catch { return {}; }
}

// The mix for this page: the defaults, with whatever this browser kept on top, field by field - a
// stored object with one bad field keeps the rest.
export function loadMix(storage = browserStorage()) {
  const out = mixDefaults();
  const kept = readKept(storage);
  for (const k of Object.keys(out)) {
    const v = clampMix(k, kept[k]);
    if (v != null) out[k] = v;
  }
  return out;
}

// One slider moved or one part switched: keep that one, and only while it differs from the default -
// so a slider dragged back to 100% leaves nothing behind, and a default changed later reaches it.
export function saveMix(key, value, storage = browserStorage()) {
  const v = clampMix(key, value);
  if (v == null) return;
  const kept = readKept(storage);
  if (v === mixDefaults()[key]) delete kept[key];
  else kept[key] = v;
  try {
    if (!storage) return;
    if (Object.keys(kept).length) storage.setItem(MIX_KEY, JSON.stringify(kept));
    else storage.removeItem(MIX_KEY);
  } catch { /* kept for this page only */ }
}

// Back to the defaults.
export function forgetMix(storage = browserStorage()) {
  try { if (storage) storage.removeItem(MIX_KEY); } catch { /* nothing kept to forget */ }
}

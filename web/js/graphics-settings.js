// The four graphics distances as numbers: what they start at, how far each slider goes, and
// what this browser remembered. No DOM and no three.js, so tests/graphics-settings.test.mjs
// can hold it, and one copy - ui.js draws the sliders from LIMITS and main.js applies what
// loadGraphics hands back, so the panel and the frame cannot start from two different 400s.
//
// Per browser, like Build mode and the YOU marker, and for the same reason: how far this
// screen draws is this machine's graphics card talking, not the island. Nothing here goes
// to the islander's config.json, which is the keeper's and shared by every page.
//
// What each one *does* is Plans/DONE/graphics-afstanden.md; this file only knows they are four.

// What each kind of machine starts at. The sliders are for turning it further down, or up;
// these are what a page gets before anybody has touched them, and a machine keeps following
// its own defaults for every slider it was never asked about (see saveGraphic).
//
// `full` is the island as it was before there were sliders - a far plane of 1400 (1250 +
// main.js's VIEW_MARGIN of 150), houses as far as the haze lets anybody see them, and the
// shadow box free to grow to world.js's widest (SHADOW_SPAN[1], a half-width of 190).
//
// `modest` is what main.js already calls a machine it runs lighter on - integrated graphics
// (MODEST_GPU) or `?modest` - and `phone` the app. The number that makes them playable is
// Object Distance: the haze closes no further out than it (main.js setFogRange), so the
// houses of a neighbour, their mills and their people are past the fog and out of the
// render list rather than drawn and hidden, and they come out of the mist as you sail in.
// A phone gets less again, because a phone draws a whole screen of it at a phone's GPU.
export const GRAPHICS_TIERS = Object.freeze({
  full: Object.freeze({ viewDistance: 1250, npcDistance: 1000, shadowDistance: 380 }),
  modest: Object.freeze({ viewDistance: 800, npcDistance: 300, shadowDistance: 160 }),
  phone: Object.freeze({ viewDistance: 600, npcDistance: 200, shadowDistance: 110 }),
});

// Object Distance is not a slider: it is View Distance times what this kind of machine can
// afford to draw of it. A desktop draws every house it can see (1.6: past the far plane), a
// lighter machine cuts them nearer than it sees, which is what keeps it playable - so the
// houses of a neighbour are in the haze and out of the render list, not drawn and hidden. One
// slider for how far you see, and no way to set a number that leaves houses standing in clear
// air or cut short in front of a horizon. The ratios are the old tier defaults over their View
// Distance (2000/1250, 550/800, 380/600, rounded).
export const OBJECT_RATIO = Object.freeze({ full: 1.6, modest: 0.7, phone: 0.65 });
export function objectDistanceOf(viewDistance, tier = 'full') {
  return Math.round(viewDistance * (OBJECT_RATIO[tier] ?? OBJECT_RATIO.full));
}
export const GRAPHICS_DEFAULTS = GRAPHICS_TIERS.full;

// Which of the three a page is: the phone app first (it is also `modest`, and more so).
export function graphicsTier({ modest = false, phone = false } = {}) {
  return phone ? 'phone' : modest ? 'modest' : 'full';
}

// The sliders' own ranges. A remembered number outside them is clamped rather than thrown
// away: somebody who had 600 before a maximum came down to 500 wants the furthest there is.
// Shadow Distance runs 85..380 because the box is never narrower than SHADOW_SPAN[0] nor
// wider than SHADOW_SPAN[1] (half-widths 42 and 190, world.js): a slider below 84 or above 380
// would move and change nothing.
export const GRAPHICS_LIMITS = Object.freeze({
  viewDistance: { min: 100, max: 20000, step: 10 },
  npcDistance: { min: 50, max: 1000, step: 10 },
  shadowDistance: { min: 85, max: 380, step: 5 },
});

// How far the haze is let out by View Distance, 0..1: nothing up to the desktop default (the
// island's own haze, as it always was), and all of it - the fog closing at the far plane and
// clear until four fifths of the way there - from HAZE_OPEN_AT up (the slider goes on past it,
// and then only the far plane moves). Before this the far plane
// moved and the fog, which main.js works out from the size of the island, did not, so a bigger
// View Distance changed nothing anybody could see. Continuous, so a nudge past the default is a
// nudge in the fog and not a jump.
export const HAZE_OPEN_AT = 6000;
export function hazeOpening(viewDistance) {
  const from = GRAPHICS_TIERS.full.viewDistance, to = HAZE_OPEN_AT;
  return Math.min(1, Math.max(0, (viewDistance - from) / (to - from)));
}

// What is stored is only what somebody set, never the whole four. The first two versions
// (`promptholm.graphics`, `.v2`) saved all four on any change, so a page that had moved only
// the shadows kept a View Distance it never chose - and a machine with integrated graphics
// would have kept a desktop's defaults after it got its own. `.v3` starts from nothing, once.
export const GRAPHICS_KEY = 'promptholm.graphics.v3';

// A value for `key`, clamped to its slider, or null for a key that is not one of the four
// or a value that is not a number. null rather than the default, so the caller can tell
// "leave it" from "put it back".
export function clampGraphic(key, value) {
  const lim = GRAPHICS_LIMITS[key];
  const n = Number(value);
  if (!lim || typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return null;
  return Math.min(lim.max, Math.max(lim.min, n));
}

// This browser's localStorage, or null. Even *reading* the name throws where site data is
// blocked, before any getItem is called, so it is looked up inside a try like every read.
function browserStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// The four for this page: the tier's defaults, with whatever this browser was told on top,
// each field on its own - a stored object with one bad field keeps the other three.
// `storage` defaults to localStorage and is a parameter so a test can hand in a map; storage
// that is missing or throws leaves the defaults.
export function loadGraphics(defaults = GRAPHICS_DEFAULTS, storage = browserStorage()) {
  const out = { ...defaults };
  const kept = readChosen(storage);
  for (const k of Object.keys(out)) {
    const v = clampGraphic(k, kept[k]);
    if (v != null) out[k] = v;
  }
  return out;
}

function readChosen(storage) {
  try {
    const kept = JSON.parse((storage && storage.getItem(GRAPHICS_KEY)) || 'null');
    return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {};
  } catch { return {}; }
}

// One slider was moved: remember that one, and only that one.
export function saveGraphic(key, value, storage = browserStorage()) {
  if (clampGraphic(key, value) == null) return;
  const kept = readChosen(storage);
  kept[key] = value;
  try { if (storage) storage.setItem(GRAPHICS_KEY, JSON.stringify(kept)); } catch { /* kept for this page only */ }
}

// Back to this machine's own defaults: forget every choice.
export function forgetGraphics(storage = browserStorage()) {
  try { if (storage) storage.removeItem(GRAPHICS_KEY); } catch { /* nothing kept to forget */ }
}

// Bloom and anti-aliasing (post.js, Plans/bloom-en-aa.md): choices, not distances, so a store of
// their own beside the four - `.v3` above keeps only numbers, and its tests hold it to that. Per
// browser for the same reason: it is this machine's graphics card. A phone starts with bloom off.
export const POST_KEY = 'promptholm.post.v1';
export const POST_CHOICES = Object.freeze({
  bloom: ['off', 'rooms'],
  aa: ['msaa', 'smaa', 'off'],
});
export const BLOOM_STRENGTH = { min: 0, max: 1.5, step: 0.05 };
export function postDefaults({ phone = false } = {}) {
  return { bloom: phone ? 'off' : 'rooms', aa: 'msaa', bloomStrength: 0.7 };
}
// A choice as stored, or null for one that is not on offer.
export function clampPost(key, value) {
  if (key === 'bloomStrength') {
    const n = Number(value);
    if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return null;
    return Math.min(BLOOM_STRENGTH.max, Math.max(BLOOM_STRENGTH.min, n));
  }
  return POST_CHOICES[key] && POST_CHOICES[key].includes(value) ? value : null;
}
export function loadPost(defaults = postDefaults(), storage = browserStorage()) {
  const out = { ...defaults };
  let kept = {};
  try { kept = JSON.parse((storage && storage.getItem(POST_KEY)) || 'null') || {}; } catch { kept = {}; }
  for (const k of Object.keys(out)) {
    const v = clampPost(k, kept[k]);
    if (v != null) out[k] = v;
  }
  return out;
}
export function savePost(key, value, storage = browserStorage()) {
  if (clampPost(key, value) == null) return;
  let kept = {};
  try { kept = JSON.parse((storage && storage.getItem(POST_KEY)) || 'null') || {}; } catch { kept = {}; }
  kept[key] = value;
  try { if (storage) storage.setItem(POST_KEY, JSON.stringify(kept)); } catch { /* kept for this page only */ }
}
export function forgetPost(storage = browserStorage()) {
  try { if (storage) storage.removeItem(POST_KEY); } catch { /* nothing kept to forget */ }
}

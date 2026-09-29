// The four graphics distances as numbers: what they start at, how far each slider goes, and
// what this browser remembered. No DOM and no three.js, so tests/graphics-settings.test.mjs
// can hold it, and one copy - ui.js draws the sliders from LIMITS and main.js applies what
// loadGraphics hands back, so the panel and the frame cannot start from two different 400s.
//
// Per browser, like Build mode and the YOU marker, and for the same reason: how far this
// screen draws is this machine's graphics card talking, not the island. Nothing here goes
// to the islander's config.json, which is the keeper's and shared by every page.
//
// What each one *does* is Plans/graphics-afstanden.md; this file only knows they are four.

// High by default: out of the box the island looks as it did before there were sliders -
// a far plane of 1400 (1250 + main.js's VIEW_MARGIN of 150), houses and people drawn as far
// as the haze lets anybody see them, and the shadow box free to grow to world.js's widest
// (SHADOW_SPAN[1], a half-width of 190). The sliders are for turning it down on a machine
// that needs it, not a budget everybody starts under.
//
// Object Distance starts at its maximum rather than at View Distance, and that is on purpose:
// 2000 seen at the corner of the frame is still deeper than the fog can ever close under a
// far plane of 1400 (fade.js fadeNeeded), so at the defaults the dither is not compiled into
// the building shader at all and every building, prop and boat renders exactly as it did.
export const GRAPHICS_DEFAULTS = Object.freeze({
  viewDistance: 1250,
  objectDistance: 2000,
  npcDistance: 1000,
  shadowDistance: 380,
});

// The sliders' own ranges. A remembered number outside them is clamped rather than thrown
// away: somebody who had 600 before a maximum came down to 500 wants the furthest there is.
// Shadow Distance stops at 380 because the box cannot get wider than SHADOW_SPAN[1] allows
// anyway; a slider past it would move and change nothing.
export const GRAPHICS_LIMITS = Object.freeze({
  viewDistance: { min: 100, max: 2000, step: 10 },
  objectDistance: { min: 50, max: 2000, step: 10 },
  npcDistance: { min: 50, max: 1000, step: 10 },
  shadowDistance: { min: 25, max: 380, step: 5 },
});

// `.v2` since the defaults went from 400/300/250/150 to what the island had before the
// sliders. The first version saved all four on any change, so a page that had moved only
// the shadows kept a View Distance of 400 it never chose - and would have gone on drawing
// the short world after this change. Starting from a new key forgets those, once.
export const GRAPHICS_KEY = 'promptholm.graphics.v2';

// A value for `key`, clamped to its slider, or null for a key that is not one of the four
// or a value that is not a number. null rather than the default, so the caller can tell
// "leave it" from "put it back".
export function clampGraphic(key, value) {
  const lim = GRAPHICS_LIMITS[key];
  const n = Number(value);
  if (!lim || value === null || value === '' || !Number.isFinite(n)) return null;
  return Math.min(lim.max, Math.max(lim.min, n));
}

// This browser's localStorage, or null. Even *reading* the name throws where site data is
// blocked, before any getItem is called, so it is looked up inside a try like every read.
function browserStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// The four as this browser last left them, each falling back to its default on its own - a
// stored object with one bad field keeps the other three. `storage` defaults to localStorage
// and is a parameter so a test can hand in a map; storage that is missing or throws gets the
// defaults.
export function loadGraphics(storage = browserStorage()) {
  const out = { ...GRAPHICS_DEFAULTS };
  let kept = null;
  try { kept = JSON.parse((storage && storage.getItem(GRAPHICS_KEY)) || 'null'); } catch { kept = null; }
  if (kept && typeof kept === 'object') {
    for (const k of Object.keys(out)) {
      const v = clampGraphic(k, kept[k]);
      if (v != null) out[k] = v;
    }
  }
  return out;
}

export function saveGraphics(values, storage = browserStorage()) {
  try { if (storage) storage.setItem(GRAPHICS_KEY, JSON.stringify(values)); } catch { /* kept for this page only */ }
}

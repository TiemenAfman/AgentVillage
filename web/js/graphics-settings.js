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

export const GRAPHICS_DEFAULTS = Object.freeze({
  viewDistance: 400,
  objectDistance: 300,
  npcDistance: 250,
  shadowDistance: 150,
});

// The sliders' own ranges. A remembered number outside them is clamped rather than thrown
// away: somebody who had 600 before a maximum came down to 500 wants the furthest there is.
export const GRAPHICS_LIMITS = Object.freeze({
  viewDistance: { min: 100, max: 600, step: 10 },
  objectDistance: { min: 50, max: 500, step: 10 },
  npcDistance: { min: 50, max: 400, step: 10 },
  shadowDistance: { min: 25, max: 300, step: 5 },
});

export const GRAPHICS_KEY = 'promptholm.graphics';

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

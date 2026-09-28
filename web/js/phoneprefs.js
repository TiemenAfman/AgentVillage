// What a phone player has set for their own hands and screen: how fast a drag looks round,
// whether up is up, which side the stick is on, and how hard the phone is asked to draw.
//
// Kept in localStorage like the sound chip (sound.js), because it belongs to this device and
// nobody else: the sea never hears of it, and a second phone starts from the defaults. Read
// live - `prefs()` every time - so a change in the settings panel takes on the next frame,
// except `quality`, which the renderer is built with and so only takes on the next start.
const KEY = 'promptholm.phone';

export const PHONE_DEFAULTS = Object.freeze({
  look: 1,          // drag-to-look speed, a multiplier: 0.5 slow ... 2 fast
  invert: false,    // drag up to look down, as some people fly
  lefty: false,     // the stick on the right and the buttons on the left
  quality: 'light', // 'light' (the `modest` path) or 'full' (what a desktop draws)
});

let cache = null;

export function prefs() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  cache = sanitise({ ...PHONE_DEFAULTS, ...saved });
  return cache;
}

export function setPref(name, value) {
  if (!Object.prototype.hasOwnProperty.call(PHONE_DEFAULTS, name)) return prefs();
  cache = sanitise({ ...prefs(), [name]: value });
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode: kept for this visit */ }
  return cache;
}

// Whatever was saved - by an older build, or by hand - comes back inside the ranges above.
function sanitise(p) {
  const look = Number(p.look);
  return {
    look: Number.isFinite(look) ? Math.min(2, Math.max(0.5, look)) : PHONE_DEFAULTS.look,
    invert: p.invert === true,
    lefty: p.lefty === true,
    quality: p.quality === 'full' ? 'full' : 'light',
  };
}

// Only for tests, which run many "devices" in one process.
export function resetPrefsCache() { cache = null; }

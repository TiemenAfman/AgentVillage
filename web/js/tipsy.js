// How much beer is in you, and how long it takes to walk it off (Plans/bier-en-dronken.md).
//
// The purple bar under the red and the yellow one. It is stamina.js turned upside down: it
// starts empty, a drink fills it, and after a while of not drinking it drains again - and
// like stamina it lives on the page and nowhere else. The sea never hears of it; what
// others see of a drunk is the path they walk, which is only a position.
//
// One pool per page, not per walk mode: main.js makes it and hands the same one to the
// island's walk and the tavern's, or a settler who drank at the bar would walk out of the
// door stone sober. Kept DOM-free and clock-free for the same reason stamina.js is:
// tests/tipsy.test.mjs fills and drains one under bare Node.

// What one whole drink adds (so about seven to fill the bar), how long after the last sip
// the body starts to clear it, and how long that then takes from full to sober. The one
// copy of each.
export const TIPSY = { dose: 0.15, delay: 8, sober: 60 };

// How blurred the view gets at a full bar, in CSS pixels, and how much of that breathes in
// and out. A steady blur reads as a broken screen; one that swims reads as a drink.
export const HAZE_PX = 3.2;
const HAZE_PULSE = 0.3;

export function createTipsy() {
  // `rest` counts the seconds since the last sip, which the delay is measured against.
  return { level: 0, rest: Infinity };
}

// `fraction` is how much of one drink went down since the last call - the arm hands it
// over a frame at a time while it gulps (classic-avatar.js swallowed()), which is what
// makes the bar climb during the swallow rather than jump when it is over.
// Hands the pool back, so a page can start with one already poured (main.js, `?tipsy=`).
export function drinkIn(t, fraction) {
  if (!(fraction > 0)) return t;
  t.level = Math.min(1, t.level + fraction * TIPSY.dose);
  t.rest = 0;
  return t;
}

export function stepTipsy(t, dt) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return;
  t.rest += dt;
  // Only the part of this step past the delay clears anything - the same care stamina.js
  // takes, so a long frame straddling the moment does not sober you a frame early.
  const clearing = Math.min(dt, t.rest - TIPSY.delay);
  if (clearing > 0) t.level = Math.max(0, t.level - clearing / TIPSY.sober);
}

// The blur for a level at time `s` (seconds, any clock). Squared, so the first beer or two
// is a sway in the walk and not yet a smear on the screen.
export function hazePx(level, s) {
  const l = Math.min(1, Math.max(0, level || 0));
  if (!l) return 0;
  return HAZE_PX * l * l * (1 - HAZE_PULSE + HAZE_PULSE * Math.sin(s * 1.3));
}

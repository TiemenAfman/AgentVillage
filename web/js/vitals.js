// The three bars over the walking strip: red for health, yellow for stamina, purple for beer,
// each behind its emoji - and, because it is what the purple one does to you, the blur.
//
// A bar with nothing to say is not worth a pixel, so it fades away - slowly, a second and a
// half after it got there, so the moment it tops up (or, for the beer, runs out) is still
// something you see - and one that moves is back on screen that same frame. All of that is
// CSS (`.vital.full`/`.vital.empty` in ui.css: a transition with a delay going out and none
// coming back), which is what keeps this file down to writing a few numbers, and only when
// they change: it is called every frame.
//
// Health is the sea's (lib/health.mjs keeps it per player and sends it privately; net.js
// turns that one message into a bar that fills by itself - see healthAt there), and main.js
// hands it over every frame like the stamina. Whole, it is the same invisible full bar as
// ever, so an island nobody has hurt looks exactly as it did before health counted. The
// beer is the page's own (web/js/tipsy.js) and says nothing until the first sip.
//
// A hit also flashes the bar (`.hurt-a`/`.hurt-b` in ui.css): a drop of HURT_STEP or more
// in one write, which a regen never is - it climbs - and a stamina bar never gets, since
// only health asks for it. Two class names with the same keyframes under two names, taken
// in turn, because re-adding a class whose animation already ran does not play it again,
// and forcing a reflow to make it would be a layout in the frame loop.
const HURT_STEP = 0.02;

// `haze` is what the blur is written onto: the canvas and the panels layer under it, both,
// or a board's hole would show a sharp page in a smeared world (the two are separate
// elements - see "one panels layer" in CLAUDE.md).
export function createVitals(root, { haze = [] } = {}) {
  const health = root.querySelector('.vital.health');
  const stamina = root.querySelector('.vital.stamina');
  const tipsy = root.querySelector('.vital.tipsy');

  let hurtFlip = false;

  // `rest` is the value at which the bar has nothing to say: 1 for the two that drain, 0 for
  // the one that fills.
  function write(bar, fraction, { spent = false, flash = false, rest = 1 } = {}) {
    if (!bar) return;
    const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : rest;
    // Rounded to a fifth of a percent: finer than a 184px bar can draw, and coarse enough
    // that a pool standing still does not rewrite the style every frame.
    const v = Math.round(f * 500) / 500;
    const said = `${v}${spent ? '!' : ''}`;
    if (bar.dataset.said === said) return;
    const was = parseFloat(bar.dataset.said);
    bar.dataset.said = said;
    if (flash && Number.isFinite(was) && was - v >= HURT_STEP) {
      bar.classList.remove(hurtFlip ? 'hurt-a' : 'hurt-b');
      bar.classList.add(hurtFlip ? 'hurt-b' : 'hurt-a');
      hurtFlip = !hurtFlip;
    }
    bar.style.setProperty('--f', String(v));
    if (rest) bar.classList.toggle('full', v >= 1);
    else bar.classList.toggle('empty', v <= 0);
    // Emptied and not yet back to RECOVER_AT: Shift does nothing, and the bar says why
    // rather than leaving somebody pressing it harder.
    bar.classList.toggle('spent', !!spent);
  }

  // Rounded to a tenth of a pixel, and `none` rather than blur(0) when sober: a filter of
  // any value makes the canvas a layer of its own, and a sober island should not pay for it.
  let blurSaid = '';
  function setHaze(px) {
    const v = Math.round(Math.max(0, px || 0) * 10) / 10;
    const said = v > 0 ? `blur(${v}px)` : '';
    if (said === blurSaid) return;
    blurSaid = said;
    for (const el of haze) if (el) el.style.filter = said;
  }

  return {
    setHealth: (fraction) => write(health, fraction, { flash: true }),
    setStamina: (pool) => write(stamina, pool ? pool.level : 1, { spent: pool && pool.spent }),
    setTipsy: (level) => write(tipsy, level || 0, { rest: 0 }),
    setHaze,
  };
}

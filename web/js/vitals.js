// The two bars over the walking strip: red for health, yellow for stamina.
//
// A full bar says nothing worth a pixel, so it fades away - slowly, a second and a half
// after it filled, so the moment it tops up is still something you see - and one that
// drops is back on screen that same frame. All of that is CSS (`.vital.full` in ui.css: a
// transition with a delay going out and none coming back), which is what keeps this file
// down to writing two numbers, and only when they change: it is called every frame.
//
// Health is the sea's (lib/health.mjs keeps it per player and sends it privately; net.js
// turns that one message into a bar that fills by itself - see healthAt there), and main.js
// hands it over every frame like the stamina. Whole, it is the same invisible full bar as
// ever, so an island nobody has hurt looks exactly as it did before health counted.
//
// A hit also flashes the bar (`.hurt-a`/`.hurt-b` in ui.css): a drop of HURT_STEP or more
// in one write, which a regen never is - it climbs - and a stamina bar never gets, since
// only health asks for it. Two class names with the same keyframes under two names, taken
// in turn, because re-adding a class whose animation already ran does not play it again,
// and forcing a reflow to make it would be a layout in the frame loop.
const HURT_STEP = 0.02;

export function createVitals(root) {
  const health = root.querySelector('.vital.health');
  const stamina = root.querySelector('.vital.stamina');

  let hurtFlip = false;

  function write(bar, fraction, spent = false, flash = false) {
    const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;
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
    bar.classList.toggle('full', v >= 1);
    // Emptied and not yet back to RECOVER_AT: Shift does nothing, and the bar says why
    // rather than leaving somebody pressing it harder.
    bar.classList.toggle('spent', !!spent);
  }

  return {
    setHealth: (fraction) => write(health, fraction, false, true),
    setStamina: (pool) => write(stamina, pool ? pool.level : 1, pool && pool.spent),
  };
}

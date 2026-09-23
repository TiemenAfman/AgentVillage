// The two bars over the walking strip: red for health, yellow for stamina.
//
// A full bar says nothing worth a pixel, so it fades away - slowly, a second and a half
// after it filled, so the moment it tops up is still something you see - and one that
// drops is back on screen that same frame. All of that is CSS (`.vital.full` in ui.css: a
// transition with a delay going out and none coming back), which is what keeps this file
// down to writing two numbers, and only when they change: it is called every frame.
//
// Health has no source yet. It will be the sea's (Plans/vulkaan-in-het-midden.md, step 2
// and 7: `hurt()` keeps it per player and sends it privately), so for now nothing calls
// setHealth and the red bar stays full, which is to say invisible.
export function createVitals(root) {
  const health = root.querySelector('.vital.health');
  const stamina = root.querySelector('.vital.stamina');

  function write(bar, fraction, spent = false) {
    const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 1;
    // Rounded to a fifth of a percent: finer than a 184px bar can draw, and coarse enough
    // that a pool standing still does not rewrite the style every frame.
    const v = Math.round(f * 500) / 500;
    const said = `${v}${spent ? '!' : ''}`;
    if (bar.dataset.said === said) return;
    bar.dataset.said = said;
    bar.style.setProperty('--f', String(v));
    bar.classList.toggle('full', v >= 1);
    // Emptied and not yet back to RECOVER_AT: Shift does nothing, and the bar says why
    // rather than leaving somebody pressing it harder.
    bar.classList.toggle('spent', !!spent);
  }

  return {
    setHealth: (fraction) => write(health, fraction),
    setStamina: (pool) => write(stamina, pool ? pool.level : 1, pool && pool.spent),
  };
}

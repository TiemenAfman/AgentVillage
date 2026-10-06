// The island's own tooltip, in place of the browser's grey box (Plans/minder-browser-meer-spel.md):
// the grey box with its system font was the most "web page" thing left on screen.
//
// Nothing has to be written differently: every `title` on the page stays where it is in the markup
// and in the code that sets it. The moment the mouse comes over an element with one, the text moves
// to `data-tip` - before the browser's own delay has run, so its box never shows - and ours is shown
// after DELAY_MS. A title set again later is simply moved again on the next hover. A trailing key in
// brackets, "Walk the island on foot (Enter)", is drawn as a key cap.
//
// Mouse only: a finger has no hover, and a held tip on a phone is a box nobody can close. Never
// under a pointer lock (on foot the mouse is the camera), and gone on any press, key or wheel.

const DELAY_MS = 450;

export function splitKey(text) {
  const m = /^(.*?)\s*\(([^()]{1,12})\)\s*$/.exec(text || '');
  return m ? { text: m[1], key: m[2] } : { text: text || '', key: null };
}

export function installTooltips(doc = globalThis.document) {
  if (!doc || !doc.body) return null;
  const tip = doc.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  doc.body.append(tip);
  let over = null, timer = 0;

  const hide = () => {
    clearTimeout(timer);
    over = null;
    tip.classList.remove('show');
    tip.hidden = true;
  };
  const textOf = (el) => {
    const t = el.getAttribute('title');
    if (t) { el.dataset.tip = t; el.removeAttribute('title'); }
    return el.dataset.tip || '';
  };
  const show = (el) => {
    if (over !== el || !el.isConnected || doc.pointerLockElement) return;
    const { text, key } = splitKey(el.dataset.tip);
    if (!text) return;
    tip.textContent = text;
    if (key) { const k = doc.createElement('kbd'); k.textContent = key; tip.append(k); }
    tip.hidden = false;
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
    const vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
    let x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(8, Math.min(vw - t.width - 8, x));
    let y = r.bottom + 8;
    if (y + t.height > vh - 8) y = r.top - t.height - 8;   // no room under it: above
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(Math.max(8, y))}px`;
    requestAnimationFrame(() => { if (over === el) tip.classList.add('show'); });
  };

  doc.addEventListener('pointerover', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const el = e.target && e.target.closest ? e.target.closest('[title], [data-tip]') : null;
    if (el === over) return;
    hide();
    if (!el || !textOf(el)) return;
    over = el;
    timer = setTimeout(() => show(el), DELAY_MS);
  }, true);
  doc.addEventListener('pointerout', (e) => {
    if (over && !(e.relatedTarget && over.contains(e.relatedTarget))) hide();
  }, true);
  for (const type of ['pointerdown', 'keydown', 'wheel']) doc.addEventListener(type, hide, { capture: true, passive: true });
  return { hide };
}

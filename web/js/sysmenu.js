// The menu behind Esc and the ☰ at the end of the chips, and the island's settings with it
// (Plans/DONE/esc-menu-en-knoppenbalk.md).
//
// The first version was a card of five buttons whose Settings opened the same narrow side
// panel as before: a way to two clicks where there had been one, and still a settings panel
// only the keeper ever saw - although most of what is in it (the keys, the YOU arrow, the
// director, the drawing) is kept by the browser and is every visitor's to change. So this is
// the settings now, in four tabs, and only the one tab that writes config.json is the keeper's:
//
//   This screen  sound, what is shown, the camera from the sky, how much is drawn
//   Controls     the keys on foot, and the touch controls on a phone
//   Island       house signs, island size, the sea, debug        (keeper only)
//   Help         the legend, the keys, which build this is
//
// ui.js draws the sections (#settings-body, each with its own data-tab) and owns every chip in
// here, found by id as before; this file only opens, closes and turns the tabs. The stylesheet
// shows the sections of the tab named in `data-tab` on the root.
//
// It is an overlay of the same shape as every other one (`open`, `close`, `isOpen`), so main.js
// puts it in PANELS and it gets for free what they have: B on a controller closes it, the
// phone's back button closes it (phoneBack), and the director waits while it is up.
//
// No pause. The sea goes on for everybody in it whether this menu is open or not, which is why
// its button says "Back to the island" and not "Resume".
const el = (id) => document.getElementById(id);
const TAB_KEY = 'promptholm.menu.tab';

// `closers`: ids of chips in here that open something beside the island (the legend), which
// the menu must get out of the way of; everything else - a toggle, a key being rebound - is
// done in place and leaves it standing, so you can see what you did.
export function createSysMenu({ onOpen = () => {}, onClose = () => {}, closers = [] } = {}) {
  const root = el('sysmenu');
  const btn = el('sysmenu-btn');
  const tabs = [...root.querySelectorAll('[data-tabbtn]')];
  let back = null;   // where the focus was, to give it back

  function show(tab) {
    const t = tabs.find((b) => b.dataset.tabbtn === tab && !b.hidden) || tabs[0];
    root.dataset.tab = t.dataset.tabbtn;
    for (const b of tabs) {
      const on = b === t;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
  }
  let last = 'screen';
  try { last = localStorage.getItem(TAB_KEY) || 'screen'; } catch { /* first tab */ }

  function isOpen() { return !root.hidden; }
  // `tab` to open on a particular one; otherwise where it was left.
  function open(tab) {
    if (isOpen()) { if (tab) show(tab); return; }
    back = document.activeElement;
    onOpen();
    show(tab || last);
    root.hidden = false;
    btn.classList.add('on');
    btn.setAttribute('aria-expanded', 'true');
    el('sysmenu-close').focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen()) return;
    root.hidden = true;
    btn.classList.remove('on');
    btn.setAttribute('aria-expanded', 'false');
    if (back && back.isConnected && root.contains(document.activeElement)) back.focus({ preventScroll: true });
    back = null;
    onClose();
  }
  const toggle = () => (isOpen() ? close() : open());

  btn.addEventListener('click', toggle);
  el('sysmenu-close').addEventListener('click', close);
  // Remembered only when somebody picks a tab: the Island tab is hidden until the page knows it
  // is the keeper's, and a fallback to the first tab at boot must not overwrite the choice.
  for (const b of tabs) b.addEventListener('click', () => {
    show(b.dataset.tabbtn);
    last = root.dataset.tab;
    try { localStorage.setItem(TAB_KEY, last); } catch { /* this page only */ }
  });
  // A click on the water round the card is "never mind".
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  for (const id of closers) { const b = el(id); if (b) b.addEventListener('click', close); }
  show(last);

  // `refresh` after a tab has been hidden or shown (the keeper's Island), so the menu is never
  // left open on a tab that is gone.
  return { open, close, isOpen, toggle, show, refresh: () => show(isOpen() ? root.dataset.tab : last) };
}

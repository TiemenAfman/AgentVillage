// Page-wide key hygiene: what the browser does with a key that the island never asked for.
// walk.js cancels the ctrl shortcuts on foot (BROWSER_KEYS there); this is the part that holds
// in every mode, because ctrl+A does not wait for the walker - from the sky it painted every
// nameplate and every panel blue, in the desktop window as much as in a tab.
//
// Kept apart from walk.js so that main.js can install it without a walk mode and a test can read
// it without one. A field, a textarea and anything contenteditable keep the shortcut: select
// all is exactly what somebody typing into one wants.

// A field on a board takes its letters. In here w is a w, not a step, and ctrl+A is a select all.
export function typingInto(el) {
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

// ctrl+A (cmd+A on a Mac) and nothing else: AltGr arrives as ctrl+alt on a Dutch layout, and
// AltGr+A is a letter of somebody's alphabet.
export function isSelectAll(e) {
  return !!(e.ctrlKey || e.metaKey) && !e.altKey && typeof e.key === 'string' && e.key.toLowerCase() === 'a';
}

// What the browser itself would do with a key, in every mode and outside every field: zoom the
// page (ctrl with + - = 0), find (ctrl+F, ctrl+G, F3), print, save, view source, open, history,
// downloads, bookmarks, caret browsing (F7), and Alt alone, which in a Chrome tab puts the focus
// on the toolbar's menu. F5, F11 and F12 are left alone: a reload is desktop.js's to ask about,
// fullscreen is wanted, and the developer tools are ours. A game never zooms its own HUD.
const CTRL_BROWSER = new Set(['+', '-', '=', '_', '0', 'f', 'g', 'p', 's', 'u', 'o', 'h', 'j', 'd', 'e', 'l', 'k']);
export function isBrowserKey(e) {
  if (typeof e.key !== 'string') return false;
  const k = e.key.toLowerCase();
  if (k === 'f3' || k === 'f7') return true;
  if (k === 'alt' && !e.ctrlKey) return true;
  return !!(e.ctrlKey || e.metaKey) && !e.altKey && CTRL_BROWSER.has(k);
}

export function installPageKeys(target = globalThis) {
  target.addEventListener('keydown', (e) => {
    if (typingInto(e.target)) return;
    if (isSelectAll(e) || isBrowserKey(e)) e.preventDefault();
  });
  // ctrl+wheel is the page zoom, and a laptop's pinch on the touchpad arrives as exactly that.
  // Never in a field either: nothing on the page is meant to grow. Not passive, or it cannot cancel.
  target.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  // Safari's pinch; Chrome's goes through touch-action in ui.css and the viewport meta.
  target.addEventListener('gesturestart', (e) => e.preventDefault());
  // A picture or an icon dragged off the HUD as a ghost image, onto the desktop as a file.
  target.addEventListener('dragstart', (e) => { if (!typingInto(e.target)) e.preventDefault(); });
  // The page menu (Copy / Select All) over the HUD, a card or the toolbar is as unwanted as the
  // selection it offers - text selection is off outside fields (ui.css), so the menu had nothing
  // to copy anyway. main.js already cancels it on the canvas; this is every other place. A field
  // keeps it: paste is what somebody in one is after.
  target.addEventListener('contextmenu', (e) => {
    if (!typingInto(e.target)) e.preventDefault();
  });
}

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

export function installPageKeys(target = globalThis) {
  target.addEventListener('keydown', (e) => {
    if (isSelectAll(e) && !typingInto(e.target)) e.preventDefault();
  });
  // The page menu (Copy / Select All) over the HUD, a card or the toolbar is as unwanted as the
  // selection it offers - text selection is off outside fields (ui.css), so the menu had nothing
  // to copy anyway. main.js already cancels it on the canvas; this is every other place. A field
  // keeps it: paste is what somebody in one is after.
  target.addEventListener('contextmenu', (e) => {
    if (!typingInto(e.target)) e.preventDefault();
  });
}

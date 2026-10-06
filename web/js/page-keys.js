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

// Where Tab is still the browser's: a field, and anything that is a dialog or a panel of its own
// (the menu and Settings, the update card, a board's form), where walking the controls with the
// keyboard is what Tab is for. Everywhere else - the canvas, the HUD's chips, the toolbar - Tab
// is no key of the game's, and left alone it walked the focus round the chips (the keeper,
// 0.9.1), leaving one of them focused, so the next Space or Enter clicked it.
const TAB_ZONES = '[role="dialog"], dialog, aside.panel, form';
export function tabBelongsToPage(el) {
  if (typingInto(el)) return true;
  return !!(el && typeof el.closest === 'function' && el.closest(TAB_ZONES));
}

export function installPageKeys(target = globalThis) {
  target.addEventListener('keydown', (e) => {
    if (isSelectAll(e) && !typingInto(e.target)) e.preventDefault();
    if (e.key === 'Tab' && !tabBelongsToPage(e.target)) e.preventDefault();
  });
  // A HUD chip clicked with the mouse keeps the focus, and a focused button is clicked again by
  // Space (jump) and Enter (walk) - so a chip let go of outside a dialog gives the focus back.
  target.addEventListener('pointerup', (e) => {
    const el = e.target && typeof e.target.closest === 'function' ? e.target.closest('button, [tabindex]') : null;
    if (!el || tabBelongsToPage(el)) return;
    setTimeout(() => { if (globalThis.document?.activeElement === el) el.blur(); }, 0);
  }, true);
  // The page menu (Copy / Select All) over the HUD, a card or the toolbar is as unwanted as the
  // selection it offers - text selection is off outside fields (ui.css), so the menu had nothing
  // to copy anyway. main.js already cancels it on the canvas; this is every other place. A field
  // keeps it: paste is what somebody in one is after.
  target.addEventListener('contextmenu', (e) => {
    if (!typingInto(e.target)) e.preventDefault();
  });
}

// The menu behind Esc and the ☰ at the end of the chips (Plans/esc-menu-en-knoppenbalk.md).
//
// What is in it is what used to stand in the bar and is set once and left: Settings, the
// Legend, Controls on a phone, Sound, the Show toggles, and which sea the island is in. Those
// chips are *moved* here in index.html, not copied, so everything ui.js did with them - the
// handlers, Settings hidden from everybody but the keeper, `on` and `aria-pressed` - carries
// on untouched, and this file only has to open, close and get out of the way.
//
// It is an overlay of the same shape as every other one (`open`, `close`, `isOpen`), so main.js
// puts it in PANELS and it gets for free what they have: B on a controller closes it, the
// phone's back button closes it (phoneBack), and the director waits while it is up.
//
// No pause. The sea goes on for everybody in it whether this menu is open or not, which is why
// its first button says "Back to the island" and not "Resume".
const el = (id) => document.getElementById(id);

export function createSysMenu({ onOpen = () => {}, onClose = () => {} } = {}) {
  const root = el('sysmenu');
  const btn = el('sysmenu-btn');
  let back = null;   // where the focus was, to give it back

  function isOpen() { return !root.hidden; }
  function open() {
    if (isOpen()) return;
    back = document.activeElement;
    root.hidden = false;
    btn.classList.add('on');
    btn.setAttribute('aria-expanded', 'true');
    el('sysmenu-close').focus({ preventScroll: true });
    onOpen();
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
  // A click on the water round the card is "never mind".
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  // A chip that opens something else - a panel, the sea picker - closes the menu on its way
  // there; the ones that switch something on or off (Sound, Show) leave it standing, so you
  // can see what you did.
  root.querySelector('.sysmenu-list').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b.id !== 'sound-btn') close();
  });

  return { open, close, isOpen, toggle };
}

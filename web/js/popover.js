// One small floating panel at a time, anchored to the button that asked for it: the
// inventory's pickers and dye palettes. It lives in document.body at position: fixed rather
// than inside the panel that opened it, because that panel scrolls (overflow: auto) and
// would clip anything positioned within it - and it sits one z-index above the .handover
// scrim so it floats over the panel it belongs to.
let current = null;

const OPPOSITE = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' };
const GAP = 8, MARGIN = 8;

// Try the asked side, then its opposite, then below, then above; the first that fits wins,
// and whatever wins is clamped into the viewport. No caret: a clamped caret points at nothing.
function place(el, anchor, side) {
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const fits = {
    right: a.right + GAP + w <= innerWidth - MARGIN,
    left: a.left - GAP - w >= MARGIN,
    bottom: a.bottom + GAP + h <= innerHeight - MARGIN,
    top: a.top - GAP - h >= MARGIN,
  };
  const pick = [side, OPPOSITE[side], 'bottom', 'top'].find((s) => fits[s]) || side;
  let x, y;
  if (pick === 'right' || pick === 'left') {
    x = pick === 'right' ? a.right + GAP : a.left - GAP - w;
    y = a.top + a.height / 2 - h / 2;
  } else {
    x = a.left + a.width / 2 - w / 2;
    y = pick === 'bottom' ? a.bottom + GAP : a.top - GAP - h;
  }
  el.style.left = `${Math.round(Math.max(MARGIN, Math.min(x, innerWidth - w - MARGIN)))}px`;
  el.style.top = `${Math.round(Math.max(MARGIN, Math.min(y, innerHeight - h - MARGIN)))}px`;
}

// Opens `content` beside `anchor`, closing whatever was open first. Returns { el, anchor,
// close }; close() is idempotent and hands focus back to the anchor.
export function openPopover({ anchor, content, side = 'bottom', onClose, className = '' }) {
  closePopover();
  const el = document.createElement('div');
  el.className = `popover ${className}`.trim();
  el.setAttribute('role', 'dialog');
  el.append(content);
  document.body.appendChild(el);
  place(el, anchor, side);

  const buttons = () => [...el.querySelectorAll('button:not([disabled])')];

  function onDown(e) {
    // The anchor's own click is left to the anchor, which toggles.
    if (el.contains(e.target) || anchor.contains(e.target)) return;
    close();
  }
  // Capture phase on the window: this runs before the studio's bubble-phase Escape (which
  // would close the whole panel) and before walk.js (which would read it as "back to the
  // sky"). One Escape closes the popover; the next one is the panel's. The arrows walk the
  // tiles, wrapping at either end.
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const list = buttons(), i = list.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    list[(i + step + list.length) % list.length].focus({ preventScroll: true });
  }
  // Tab, or a click on something focusable outside: relatedTarget says where focus went. A
  // click on nothing focusable leaves relatedTarget null, and is pointerdown's to judge.
  function onFocusOut(e) { if (e.relatedTarget && !el.contains(e.relatedTarget)) close(); }

  document.addEventListener('pointerdown', onDown, true);
  addEventListener('keydown', onKey, true);
  addEventListener('resize', close);
  el.addEventListener('focusout', onFocusOut);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onDown, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', close);
    el.remove();
    if (current && current.el === el) current = null;
    anchor.focus?.({ preventScroll: true });
    onClose?.();
  }

  // The current choice first, so Enter confirms it and the arrows start from it.
  (el.querySelector('button.on') || buttons()[0])?.focus({ preventScroll: true });
  current = { el, anchor, close };
  return current;
}

export function closePopover() { current?.close(); }

// Two keys that asked nobody, in the desktop window: F5 threw the page away (walk mode, an
// open panel, a conversation) and Alt+F4 closed the window, both one careless keystroke
// from happening. In promptholm.exe each now asks first.
//
// Only in the window. src-tauri/src/lib.rs sets PROMPTHOLM_DESKTOP with an initialization
// script on every page it loads; an ordinary browser tab never has it, and there F5 stays
// the browser's own. The close is started by Rust - Alt+F4 is the window manager's, not a
// key the page is ever told about - which holds the first close request and calls
// `window.promptholmConfirmClose`; saying yes navigates to promptholm://close, which the
// window's on_navigation turns into closing. A second Alt+F4 within a few seconds closes
// without asking (Rust's side), so a hung page can never trap anybody in the window.
//
// The card reuses the update gate's look (.update-gate in web/css/ui.css): one modal style.

let open = null;   // the card on screen, if any: { resolve, el }

function ask({ title, body, ok, cancel = 'Cancel' }) {
  if (open) return Promise.resolve(false);
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'update-gate';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    const card = document.createElement('div');
    card.className = 'update-gate-card';
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = body;
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'update-gate-primary';
    yes.textContent = ok;
    const row = document.createElement('div');
    row.className = 'update-gate-row';
    row.style.justifyContent = 'flex-end';
    row.style.marginTop = '12px';
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = cancel;
    row.append(no);
    card.append(h, p, yes, row);
    el.append(card);
    document.body.append(el);
    const done = (answer) => {
      el.remove();
      open = null;
      resolve(answer);
    };
    open = { el, done };
    yes.addEventListener('click', () => done(true));
    no.addEventListener('click', () => done(false));
    // Clicking the dimmed backdrop is "no", as in every dialog.
    el.addEventListener('click', (e) => { if (e.target === el) done(false); });
    yes.style.width = '100%';
    yes.style.border = '0';
    yes.style.cursor = 'pointer';
    yes.focus();
  });
}

// Enter confirms, Escape cancels - caught in the capture phase on window so walk.js, which
// also listens for Escape (it frees the mouse, then leaves walk mode), never sees the one
// that was meant for this card.
function onKey(e) {
  if (open) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); open.done(false); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); open.done(true); }
    return;
  }
  const reload = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'));
  if (!reload) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.repeat) return;
  // A pointer lock would keep the cursor away from the buttons.
  if (document.pointerLockElement) document.exitPointerLock();
  ask({
    title: 'Reload the island?',
    body: 'This page starts over: walk mode, open panels and conversations are left. The island itself keeps running.',
    ok: 'Reload',
  }).then((yes) => { if (yes) location.reload(); });
}

export function installDesktopGuards(win = globalThis.window) {
  if (!win || !win.PROMPTHOLM_DESKTOP) return false;
  win.addEventListener('keydown', onKey, true);
  win.promptholmConfirmClose = () => {
    if (document.pointerLockElement) document.exitPointerLock();
    ask({
      title: 'Close Promptholm?',
      body: 'The window closes; the island keeps running in the tray. Press Alt+F4 again to close straight away.',
      ok: 'Close',
    }).then((yes) => { if (yes) win.location.href = 'promptholm://close'; });
  };
  return true;
}

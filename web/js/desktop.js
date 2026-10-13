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
// Fullscreen is the window's here, not HTML's: Chromium's fullscreen puts its own "press Esc to
// exit full screen" bubble in the window and Esc is walk mode's key. F11 and the Fullscreen chip
// ask Rust (promptholm://fullscreen/<on|off|toggle|query>, the close's door - no IPC is opened to
// a remote page) and Rust answers with `window.promptholmFullscreen(bool)` whenever the window's
// state changes, so the chip follows the real window and never an idea of it.
//
// The card reuses the update gate's look (.update-gate in web/css/ui.css): one modal style.

let open = null;   // the card on screen, if any: { resolve, el }

const fullscreens = new WeakMap();   // window -> its controller, one each

// The desktop window's fullscreen, or null in a browser tab (where ui.js keeps HTML fullscreen).
export function desktopFullscreen(win = globalThis.window) {
  if (!win || !win.PROMPTHOLM_DESKTOP) return null;
  let fs = fullscreens.get(win);
  if (fs) return fs;
  let on = false;
  const listeners = new Set();
  // A cancelled navigation: Rust's on_navigation answers false, so the page stays where it is.
  const ask = (what) => { win.location.href = `promptholm://fullscreen/${what}`; };
  win.promptholmFullscreen = (now) => {
    now = !!now;
    if (now === on) return;
    on = now;
    for (const fn of listeners) fn(on);
  };
  fs = {
    get on() { return on; },
    toggle: () => ask('toggle'),
    set: (v) => ask(v ? 'on' : 'off'),
    query: () => ask('query'),
    onChange: (fn) => { listeners.add(fn); },
  };
  fullscreens.set(win, fs);
  return fs;
}

// Which graphics card the window draws on (Plans/sneller-op-igpu.md), the keeper's choice in
// Settings -> Graphics. Chromium picks its adapter once, when the window's GPU process starts,
// so a choice takes effect only in a new window: Rust keeps it in gpu.json beside window.json and
// starts the next window on it. Asked through promptholm://gpu/<fast|low|query|restart> (the
// close's door), answered `window.promptholmGpu({ running, chosen })`. `running` stays null
// until Rust has answered - a window from before this never does, and then there is no row.
export const GPU_CHOICES = ['fast', 'low'];
const gpus = new WeakMap();
export function desktopGpu(win = globalThis.window) {
  if (!win || !win.PROMPTHOLM_DESKTOP) return null;
  let g = gpus.get(win);
  if (g) return g;
  let running = null;
  let chosen = null;
  const listeners = new Set();
  const ask = (what) => { win.location.href = `promptholm://gpu/${what}`; };
  win.promptholmGpu = (said) => {
    const r = GPU_CHOICES.includes(said?.running) ? said.running : null;
    const c = GPU_CHOICES.includes(said?.chosen) ? said.chosen : r;
    if (r === running && c === chosen) return;
    running = r;
    chosen = c;
    for (const fn of listeners) fn({ running, chosen });
  };
  g = {
    get running() { return running; },
    get chosen() { return chosen; },
    choose: (v) => { if (GPU_CHOICES.includes(v)) ask(v); },
    restart: () => ask('restart'),
    query: () => ask('query'),
    onChange: (fn) => { listeners.add(fn); },
  };
  gpus.set(win, g);
  return g;
}

// What Settings says under the two chips. `name` is the card WebGL reports now (gpuShortName).
export function gpuNote({ running, chosen, name = '' } = {}) {
  const word = { fast: 'the fast graphics card', low: 'the power-saving graphics card' };
  const now = `This window draws on ${word[running] || 'its card'}${name ? ` (${name})` : ''}.`;
  if (!chosen || chosen === running) return `${now} Changing it restarts the window; the island keeps running.`;
  return `${now} After a restart it draws on ${word[chosen]}.`;
}

// Handed in by installDesktopGuards: take the mouse look back once a card is answered.
let resumeLock = () => {};
let installedOn = null;   // the window the guards were installed on, which F11 acts for

// The card gave the pointer lock up so its buttons could be clicked. Answered with a click the
// look comes back at once; answered with Escape it waits for the key to be up, or the browser
// handles that same Escape as the user leaving a fresh lock and takes it away again (walk.js
// requestLock has the measurement).
function giveBackLook(byKey) {
  if (!byKey) { resumeLock(); return; }
  const up = () => { removeEventListener('keyup', up, true); setTimeout(resumeLock, 60); };
  addEventListener('keyup', up, true);
}

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
    const done = (answer, byKey = false) => {
      el.remove();
      open = null;
      resolve(answer);
      if (!answer) giveBackLook(byKey);   // a yes leaves the page or closes the window
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
  // F11, as in any game window: the Tauri window's fullscreen (a bare key only, so a chord
  // some other tool wants is left alone). Not repeated, or holding it would flicker.
  if (e.key === 'F11' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) desktopFullscreen(installedOn)?.toggle();
    return;
  }
  if (open) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); open.done(false, true); }
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

export function installDesktopGuards(win = globalThis.window, hooks = {}) {
  if (!win || !win.PROMPTHOLM_DESKTOP) return false;
  if (hooks.resumeLock) resumeLock = hooks.resumeLock;
  installedOn = win;
  win.addEventListener('keydown', onKey, true);
  // A window that starts fullscreen (remembered from last time) or a page that was reloaded in
  // it has not been told yet.
  desktopFullscreen(win).query();
  // Two navigations in one task: the second replaces the first before either goes out, so the
  // card is asked a moment later.
  setTimeout(() => desktopGpu(win).query(), 300);
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

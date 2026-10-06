// Windowed or fullscreen, the one switch (Plans/minder-browser-meer-spel.md): Settings -> This screen
// -> Display, the button at the bottom right and Alt+Enter, as in every game, all go through here.
//
// Two ways underneath, one choice on top. In promptholm.exe (PROMPTHOLM_DESKTOP, desktop.js) the window
// itself goes fullscreen: borderless over the whole monitor, which is what Rust's set_fullscreen is on
// Windows. The page asks by navigating to promptholm://fullscreen/on|off, the same door desktop.js uses
// for a confirmed close, because a page served from the islander has no Tauri IPC. The element
// fullscreen of a browser would only fill the webview, which already fills the window. In a browser
// tab it is the Fullscreen API, which needs a press or a click - so a choice remembered from last time
// is applied on start in the window only.
//
// The choice is kept per browser in `promptholm.display` ('full' or nothing).

const KEY = 'promptholm.display';

const remembered = () => { try { return localStorage.getItem(KEY) === 'full'; } catch { return false; } };
const remember = (on) => { try { if (on) localStorage.setItem(KEY, 'full'); else localStorage.removeItem(KEY); } catch { /* this page only */ } };

// Alt+Enter, and in the window F11 too (WebView2 has no fullscreen of its own on it). Not AltGr
// (ctrl+alt on a Dutch layout), not a held key repeating.
export function isFullscreenKey(e, desktop = false) {
  if (e.repeat || e.ctrlKey || e.metaKey) return false;
  if (e.key === 'Enter' && e.altKey) return true;
  return desktop && e.key === 'F11' && !e.altKey;
}

export function createDisplay(win = globalThis.window) {
  const doc = win.document;
  const desktop = !!win.PROMPTHOLM_DESKTOP;
  const listeners = new Set();
  let windowFull = false;   // the desktop window's state, as last asked: it cannot be read back

  const element = () => doc.fullscreenElement || doc.webkitFullscreenElement || null;
  const isFull = () => (desktop ? windowFull : !!element());
  const tell = () => { for (const f of listeners) f(isFull()); };

  function set(on) {
    on = !!on;
    remember(on);
    if (desktop) {
      windowFull = on;
      win.location.href = `promptholm://fullscreen/${on ? 'on' : 'off'}`;
      tell();
      return;
    }
    if (on === !!element()) return;
    if (on) {
      const root = doc.documentElement;
      const ask = root.requestFullscreen || root.webkitRequestFullscreen;
      if (ask) Promise.resolve(ask.call(root)).catch(() => {});
    } else {
      const leave = doc.exitFullscreen || doc.webkitExitFullscreen;
      if (leave) Promise.resolve(leave.call(doc)).catch(() => {});
    }
  }

  // Follow the real state in a tab: Esc and the phone's back gesture leave fullscreen without us.
  doc.addEventListener('fullscreenchange', tell);
  doc.addEventListener('webkitfullscreenchange', tell);
  win.addEventListener('keydown', (e) => {
    if (!isFullscreenKey(e, desktop)) return;
    // Enter on its own is the sky's Walk key; with Alt it is this and nothing else.
    e.preventDefault();
    e.stopImmediatePropagation();
    set(!isFull());
  }, true);
  if (desktop && remembered()) set(true);

  return {
    isFull, set, desktop,
    toggle: () => set(!isFull()),
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
  };
}

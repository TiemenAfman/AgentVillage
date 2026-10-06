// The desktop window's two guards (web/js/desktop.js): F5 and a close ask first, but only
// in promptholm.exe - an ordinary browser tab keeps its own F5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A window just big enough for what desktop.js touches, with no DOM behind it.
function fakeWindow(flag) {
  const listeners = [];
  return {
    PROMPTHOLM_DESKTOP: flag,
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    listeners,
    location: { href: 'http://localhost:4747/' },
  };
}

const { installDesktopGuards } = await import('../web/js/desktop.js');

test('a browser tab is left alone', () => {
  const win = fakeWindow(undefined);
  assert.equal(installDesktopGuards(win), false);
  assert.equal(win.listeners.length, 0);
  assert.equal(win.promptholmConfirmClose, undefined);
});

test('the desktop window catches F5 in the capture phase and offers a close confirmation', () => {
  const win = fakeWindow(true);
  assert.equal(installDesktopGuards(win), true);
  const key = win.listeners.find((l) => l.type === 'keydown');
  assert.ok(key && key.capture === true, 'capture phase, so walk.js never sees the key first');
  assert.equal(typeof win.promptholmConfirmClose, 'function');
});

test('Rust and the page agree on the flag and on how a yes closes the window', () => {
  const rs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../web/js/desktop.js', import.meta.url), 'utf8');
  assert.match(rs, /PROMPTHOLM_DESKTOP = true/);
  assert.match(rs, /CLOSE_URL_SCHEME: &str = "promptholm"/);
  assert.match(rs, /window\.promptholmConfirmClose/);
  assert.match(js, /promptholm:\/\/close/);
  assert.match(rs, /Some\("close"\)/);
});

// --- fullscreen: the window's, not HTML's (web/js/desktop.js, src-tauri/src/lib.rs) ---

const { desktopFullscreen } = await import('../web/js/desktop.js');

test('a browser tab gets no desktop fullscreen, so ui.js keeps HTML fullscreen there', () => {
  assert.equal(desktopFullscreen(fakeWindow(undefined)), null);
});

test('the desktop fullscreen asks Rust by navigation and follows what Rust says', () => {
  const win = fakeWindow(true);
  const fs = desktopFullscreen(win);
  assert.equal(desktopFullscreen(win), fs, 'one controller per window');
  const seen = [];
  fs.onChange((on) => seen.push(on));
  fs.toggle();
  assert.equal(win.location.href, 'promptholm://fullscreen/toggle');
  assert.equal(fs.on, false, 'not on until the window says so');
  win.promptholmFullscreen(true);
  win.promptholmFullscreen(true);   // Rust may say it twice; the chip hears it once
  assert.equal(fs.on, true);
  fs.set(false);
  assert.equal(win.location.href, 'promptholm://fullscreen/off');
  win.promptholmFullscreen(false);
  assert.deepEqual(seen, [true, false]);
  fs.query();
  assert.equal(win.location.href, 'promptholm://fullscreen/query');
});

test('F11 toggles the window in the capture phase, once per press', () => {
  const win = fakeWindow(true);
  installDesktopGuards(win);
  const key = win.listeners.find((l) => l.type === 'keydown');
  const press = (extra = {}) => {
    const e = { key: 'F11', repeat: false, prevented: false, stopped: false, ...extra };
    e.preventDefault = () => { e.prevented = true; };
    e.stopImmediatePropagation = () => { e.stopped = true; };
    key.fn(e);
    return e;
  };
  win.location.href = '';
  const e = press();
  assert.ok(e.prevented && e.stopped, 'walk.js and the browser never see it');
  assert.equal(win.location.href, 'promptholm://fullscreen/toggle');
  win.location.href = '';
  press({ repeat: true });
  assert.equal(win.location.href, '', 'a held key does not flicker the window');
  win.location.href = '';
  press({ ctrlKey: true });
  assert.equal(win.location.href, '', 'a chord is left alone');
});

test('Rust and the page agree on the fullscreen door and on what comes back', () => {
  const rs = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../web/js/desktop.js', import.meta.url), 'utf8');
  assert.match(rs, /FULLSCREEN_HOST: &str = "fullscreen"/);
  assert.match(js, /promptholm:\/\/fullscreen\//);
  assert.match(rs, /window\.promptholmFullscreen/);
  assert.match(js, /win\.promptholmFullscreen = /);
  for (const what of ['on', 'off', 'toggle']) {
    assert.match(rs, new RegExp(`"${what}" =>`));
    assert.ok(js.includes(`'${what}'`) || js.includes(`? 'on' : 'off'`));
  }
});

test('the desktop window does not ask for the keyboard lock a tab needs for Ctrl+W', () => {
  const walk = readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8');
  assert.match(walk, /function lockKeys\(on\) \{\s*\/\/[^\n]*\n\s*if \(globalThis\.PROMPTHOLM_DESKTOP\) return;/);
});

test('walk and noclip ask again once the browser\'s cooldown after Escape is over', () => {
  // Chromium refuses a lock for ~1.3 s after the user's own Escape (SecurityError), measured in
  // the desktop window; a click inside the wait used to do nothing at all.
  for (const f of ['walk.js', 'noclip.js']) {
    const src = readFileSync(new URL(`../web/js/${f}`, import.meta.url), 'utf8');
    assert.match(src, /SecurityError/, f);
  }
});

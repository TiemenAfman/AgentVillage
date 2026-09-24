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

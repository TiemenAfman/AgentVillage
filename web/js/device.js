// What kind of page this is, in three words that used to be one (Plans/spelen-in-de-browser.md).
//
// STANDALONE (api.js) meant everything at once for as long as the Android app was the only page
// without an islander: no island, a phone, fingers. The web version is a page without an islander
// too, and somebody at it may be at a keyboard, holding a controller or on a tablet with a keyboard
// folded behind it. So:
//
//   STANDALONE   no islander (api.js). Everything that hangs on there being no island of our own.
//   APP          the Android app: the Rust commands, the update gate, the APK. A pack from before
//                the web carried no `host`, so a missing one is the app.
//   HANDHELD     a machine that is a phone or a tablet: the app, or a browser whose main pointer is
//                coarse and that has nothing that hovers. The graphics tier comes from this - from
//                the machine - and never from "has no islander": a laptop in a browser is a laptop.
//
// And which controls are shown is a fourth thing that changes while the page is open
// (`nextInputMode`): a touch shows the thumb controls, a key, a mouse or a pad hides them again.
// Pure enough for tests/device.test.mjs: the decisions are functions, and the constants below only
// ask the browser once.
import { STANDALONE } from './api.js';

export const WEB_PLAY = !!STANDALONE && STANDALONE.host === 'web';
export const APP = !!STANDALONE && !WEB_PLAY;

const media = (q) => {
  try { return !!(globalThis.matchMedia && globalThis.matchMedia(q).matches); } catch { return false; }
};

export function handheldOf({ app = false, coarse = false, hover = false } = {}) {
  return !!app || (!!coarse && !hover);
}
export const HANDHELD = handheldOf({ app: APP, coarse: media('(pointer: coarse)'), hover: media('(any-hover: hover)') });

// Which controls a page starts with. The app is a phone and nothing else; a page with an islander
// has no thumb controls at all; the web starts with fingers on a handheld machine.
export function firstInputMode({ app = false, standalone = false, handheld = false } = {}) {
  if (app) return 'touch';
  if (!standalone) return 'desk';
  return handheld ? 'touch' : 'desk';
}

// The mode after something happened. `ev` is `{ type, pointerType }` as a DOM event has them,
// or `{ type: 'pad' }` for a controller that was used. A key or a real mouse is the desk; a
// finger or a pen is touch. A mouse *button* on a touch laptop arrives as pointerType 'mouse'
// too, and that is right: it is a mouse. Touch screens also send compatibility mouse events,
// but never as pointer events of type 'mouse', which is why this reads pointer events only.
export function nextInputMode(mode, ev, { app = false } = {}) {
  if (app) return 'touch';
  if (!ev) return mode;
  if (ev.type === 'keydown' || ev.type === 'pad') return 'desk';
  if (ev.type === 'pointerdown' || ev.type === 'pointermove') {
    if (ev.pointerType === 'touch' || ev.pointerType === 'pen') return ev.type === 'pointerdown' ? 'touch' : mode;
    if (ev.pointerType === 'mouse') return 'desk';
  }
  return mode;
}

// Whether a pad's poll is somebody using it, rather than a resting stick's drift.
export function padUsed(p) {
  if (!p) return false;
  if (p.anyHit) return true;
  const m = p.move || { x: 0, y: 0 }, l = p.look || { x: 0, y: 0 };
  return Math.hypot(m.x, m.y) > 0.5 || Math.hypot(l.x, l.y) > 0.5;
}

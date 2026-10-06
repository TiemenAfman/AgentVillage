// Two fingers pinch the chart, as the wheel turns it (issue #93): the app on a phone has no
// wheel, and the pinch went to the camera behind the sheet. What has to hold is who hears
// which touch: one finger is still the touch controls' (a drag looks, a tap asks), and once a
// second lands both are the chart's - the first taken back from whoever had it with a
// pointercancel, so no stick stays pushed - until they leave the glass. The zoom itself is
// `zoomMapAt`, the wheel's (tests/minimap-projection.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
const node = () => ({
  style: {}, hidden: false, className: '', textContent: '', children: [],
  appendChild(c) { this.children.push(c); return c; },
  addEventListener: noop, setAttribute: noop, getContext: () => ctx, closest: () => null,
});
const panel = { ...node(), hidden: true, clientWidth: 400, clientHeight: 300, getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 }) };
globalThis.document = { getElementById: (id) => (id === 'worldmap' ? panel : node()), createElement: node, pointerLockElement: null };
// The window's capture listeners, in the order they were added; a stopped event goes no further.
const listeners = [];
globalThis.addEventListener = (type, fn, opts) => listeners.push({ type, fn, capture: !!(opts && opts.capture) });
globalThis.window = globalThis;
globalThis.Path2D = class {};
globalThis.PointerEvent = class { constructor(type, init) { Object.assign(this, init, { type, isTrusted: false }); } };

const { createWorldMap } = await import('../web/js/minimap.js');
const map = createWorldMap({ phone: true });
map.setVisible(true);

// A touch as the browser hands it to the window's capture phase: did it get past the chart?
function touch(type, id, x, y, target) {
  let stopped = false;
  const e = {
    type, pointerId: id, pointerType: 'touch', clientX: x, clientY: y, isTrusted: true, target,
    preventDefault: noop, stopImmediatePropagation() { stopped = true; },
  };
  for (const l of listeners) if (l.type === type && l.capture && !stopped) l.fn(e);
  return !stopped;
}
const layer = () => { const got = []; return { got, closest: () => null, dispatchEvent: (e) => got.push(e) }; };

test('one finger on the chart is left to the touch controls', () => {
  const t = layer();
  assert.equal(touch('pointerdown', 1, 100, 100, t), true);
  assert.equal(touch('pointermove', 1, 130, 110, t), true, 'a drag still looks about');
  assert.equal(touch('pointerup', 1, 130, 110, t), true, 'and a tap still asks what is there');
  assert.deepEqual(t.got, []);
});

test('a second finger makes it a pinch: the first is cancelled underneath, both are the chart\'s', () => {
  const a = layer(), b = layer();
  assert.equal(touch('pointerdown', 2, 150, 150, a), true);
  assert.equal(touch('pointerdown', 3, 250, 150, b), false, 'the second finger never reaches the camera');
  assert.equal(a.got.length, 1);
  assert.equal(a.got[0].type, 'pointercancel');
  assert.equal(a.got[0].pointerId, 2);
  assert.equal(touch('pointermove', 2, 120, 150, a), false);
  assert.equal(touch('pointermove', 3, 280, 150, b), false);
  assert.equal(touch('pointerup', 3, 280, 150, b), false);
  assert.equal(touch('pointermove', 2, 110, 150, a), false, 'the finger left behind is still the chart\'s');
  assert.equal(touch('pointerup', 2, 110, 150, a), false);
  // and after both have lifted, a finger is the touch controls' again
  const c = layer();
  assert.equal(touch('pointerdown', 4, 100, 100, c), true);
  assert.equal(touch('pointerup', 4, 100, 100, c), true);
});

test('a closed chart, or a touch on a button, is none of its business', () => {
  const btn = { closest: (s) => (s === 'button' ? {} : null), dispatchEvent: noop };
  const a = layer();
  assert.equal(touch('pointerdown', 5, 100, 100, a), true);
  assert.equal(touch('pointerdown', 6, 200, 100, btn), true, 'the close button is pressed, not pinched');
  touch('pointerup', 6, 200, 100, btn);
  touch('pointerup', 5, 100, 100, a);
  map.setVisible(false);
  const b = layer(), c = layer();
  assert.equal(touch('pointerdown', 7, 100, 100, b), true);
  assert.equal(touch('pointerdown', 8, 200, 100, c), true, 'with the chart shut, a pinch zooms the camera');
  assert.deepEqual(b.got, []);
});

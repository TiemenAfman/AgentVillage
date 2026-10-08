// The log over the walking strip (Plans/galjoen-vaart-houden.md): the speed of the boat under you,
// in knots, at her wheel or on her deck - read off the hull (boat.js logOf), written by vitals.js
// only when it changes, and asked for by main.js for ownHull() in walk mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { CRAFTS } from '../shared/crafts.mjs';
register('./support/shared-loader.mjs', import.meta.url);

globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { logOf, KNOTS_PER_UNIT } = await import('../web/js/boat.js');
const { createVitals } = await import('../web/js/vitals.js');
delete globalThis.document;

function fakeEl() {
  const classes = new Set();
  const style = {};
  return {
    hidden: true, dataset: {}, textContent: '', title: '',
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
    style: { setProperty: (k, v) => { style[k] = v; } },
    _style: style, _classes: classes,
  };
}

test('the log shows knots and a bar, and hides off every boat', () => {
  const log = fakeEl(), em = fakeEl(), span = fakeEl();
  log.querySelector = (q) => (q === 'em' ? em : q === 'span' ? span : null);
  const root = { querySelector: (q) => (q === '.vital.log' ? log : null) };
  const vitals = createVitals(root);

  const ship = { x: 0, z: 0, yaw: 0, v: CRAFTS.galleon.sail.top / 2, underSail: 0.5, craft: { spec: CRAFTS.galleon } };
  vitals.setLog(logOf(ship));
  assert.equal(log.hidden, false);
  assert.equal(em.textContent, `${(ship.v * KNOTS_PER_UNIT).toFixed(1)} kn`);
  assert.equal(log._style['--f'], '0.5');
  assert.ok(log._classes.has('sails'), 'sails set, and the log does not say so');
  assert.equal(span.textContent, '⛵');

  const rowboat = { x: 0, z: 0, yaw: 0, v: 3, craft: { spec: CRAFTS.rowboat } };
  vitals.setLog(logOf(rowboat));
  assert.equal(span.textContent, '🚣');
  assert.ok(!log._classes.has('sails'));

  vitals.setLog(null);
  assert.equal(log.hidden, true);
});

test('main.js asks for the log of the hull we are on, and Settings can switch it off', () => {
  const main = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /state\.vitals\.setLog\(logHull \? logOf\(logHull\) : null\)/);
  assert.match(main, /ownHull\(\) : null;/);
  const ui = readFileSync(new URL('../web/js/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /promptholm\.log/);
  const css = readFileSync(new URL('../web/css/ui.css', import.meta.url), 'utf8');
  assert.match(css, /body\.no-log \.vital\.log \{ display: none; \}/);
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(html, /class="vital log"/);
});

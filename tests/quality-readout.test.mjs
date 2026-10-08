// Settings -> Graphics says what this screen draws at (ui.js qualityRows): the machine's tier and
// why, the governor's rung and whether it chooses, the fps; the rung can be held by hand (what
// ?quality=n does) and the ?stats readout switched on - in promptholm.exe and on the phone there
// is no address bar to type either in. The storage is pure (graphics-settings.js); the wiring is
// read from the source, as tests/graphics-settings.test.mjs does, since there is no renderer here.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  QUALITY_KEY, QUALITY_LEVELS, clampQuality, loadQualityChoice, saveQualityChoice,
  STATS_KEY, loadStatsShown, saveStatsShown, qualityLine, gpuShortName,
} from '../web/js/graphics-settings.js';
import { RUNGS } from '../web/js/quality.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };

test('one held rung per step of the governor', () => {
  assert.equal(QUALITY_LEVELS, RUNGS.length);
});

test('nothing stored is automatic, and the old "Lighter when slow: off" is full held', () => {
  assert.equal(loadQualityChoice(memory()), 'auto');
  assert.equal(loadQualityChoice(null), 'auto');
  assert.equal(loadQualityChoice(broken), 'auto');
  // What the switch before this wrote when it was turned off.
  assert.equal(loadQualityChoice(memory({ [QUALITY_KEY]: '0' })), 0);
  assert.equal(loadQualityChoice(memory({ [QUALITY_KEY]: '3' })), 3);
  for (const bad of ['5', '-1', '1.5', 'full', '']) assert.equal(loadQualityChoice(memory({ [QUALITY_KEY]: bad })), 'auto', bad);
});

test('a held rung is stored, automatic forgets it', () => {
  const s = memory();
  saveQualityChoice(2, s);
  assert.equal(s.m.get(QUALITY_KEY), '2');
  assert.equal(loadQualityChoice(s), 2);
  saveQualityChoice('auto', s);
  assert.equal(s.m.has(QUALITY_KEY), false);
  saveQualityChoice(9, s);
  assert.equal(s.m.has(QUALITY_KEY), false);
  saveQualityChoice(1, broken); // never throws
  assert.equal(clampQuality(true), null);
  assert.equal(clampQuality(null), null);
  assert.equal(clampQuality('4'), 4);
});

test('the stats switch is off unless switched on, per browser', () => {
  const s = memory();
  assert.equal(loadStatsShown(s), false);
  saveStatsShown(true, s);
  assert.equal(s.m.get(STATS_KEY), '1');
  assert.equal(loadStatsShown(s), true);
  saveStatsShown(false, s);
  assert.equal(s.m.has(STATS_KEY), false);
  assert.equal(loadStatsShown(broken), false);
  assert.equal(loadStatsShown(null), false);
});

test('the line names the machine, why, the rung and the frame rate', () => {
  assert.equal(
    qualityLine({ tier: 'modest', reason: 'integrated graphics: Intel UHD Graphics 620', rung: 'lighter', auto: true, fps: 41.6 }),
    'Modest machine (integrated graphics: Intel UHD Graphics 620) · drawing at lighter, automatic · 42 fps',
  );
  assert.equal(qualityLine({ tier: 'phone', reason: 'light', rung: 'full', auto: false, fps: null }), 'Phone (light) · drawing at full, held · … fps');
  assert.equal(qualityLine({ tier: 'full', rung: 'softer' }), 'Standard machine · drawing at softer, automatic · … fps');
});

test('the GPU is named as a person would', () => {
  assert.equal(gpuShortName('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00003EA0) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'Intel UHD Graphics 620');
  assert.equal(gpuShortName('ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'NVIDIA GeForce RTX 4090');
  assert.equal(gpuShortName('Adreno (TM) 740'), 'Adreno 740');
  assert.equal(gpuShortName(''), '');
});

test('Settings draws it, and main.js answers every question it asks', () => {
  const ui = fs.readFileSync(new URL('../web/js/ui.js', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  // The quality block is in the Graphics section, and refreshed only while the menu is open.
  assert.match(ui, /return '<div><h3 class="sec">Graphics<\/h3>'\s*\+ qualityRows\(\)/);
  assert.match(ui, /onClose: \(\) => \{ qualityTick\(false\);/);
  assert.match(ui, /renderSettings\(\);\s*qualityTick\(true\);/);
  for (const h of ['qualityState', 'onQualityChoice', 'qualityNow', 'statsShown', 'onStatsShown']) {
    assert.ok(new RegExp(`handlers\\.${h}\\b`).test(ui), `ui.js asks ${h}`);
    assert.ok(new RegExp(`\\b${h}: `).test(main), `main.js answers ${h}`);
  }
  // ?stats still turns it on, and so does the stored switch.
  assert.match(main, /setStatsShown\(params\.has\('stats'\) \|\| loadStatsShown\(\)\)/);
  // ?quality still outranks the stored choice at boot.
  assert.match(main, /params\.has\('quality'\) \? Number\(params\.get\('quality'\)\) : loadQualityChoice\(\)/);
});

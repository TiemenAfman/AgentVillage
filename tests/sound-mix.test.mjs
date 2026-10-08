// Settings -> Audio's table and its storage (web/js/sound-mix.js, Plans/meer-geluiden.md, "Het
// tabblad Audio in Settings"): per browser, only what differs from the defaults, and nothing that
// a broken or missing localStorage can turn into an exception.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIX_KEY, MIX_LEVELS, MIX_PARTS, MIX_OFF, MIX_BUSES, busOf, clampMix, loadMix, saveMix, forgetMix, mixDefaults,
} from '../web/js/sound-mix.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function memory(initial = {}) {
  const m = { ...initial };
  return {
    m,
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
  };
}

test('every part sits on one of the three buses, and no id is used twice', () => {
  const ids = [...MIX_LEVELS.map(([k]) => k), ...MIX_PARTS.map(([k]) => k)];
  assert.equal(new Set(ids).size, ids.length);
  for (const [id, label, bus] of MIX_PARTS) {
    assert.ok(MIX_BUSES.includes(bus), `${id} is on ${bus}`);
    assert.equal(busOf(id), bus);
    assert.ok(label.length > 2);
  }
  assert.deepEqual(MIX_LEVELS.map(([k]) => k), ['master', ...MIX_BUSES], 'a slider per bus and the master');
});

test('defaults are every slider at full, and every part on but the borrel, the sea and the water', () => {
  const d = mixDefaults();
  for (const [k] of MIX_LEVELS) assert.equal(d[k], 1);
  assert.deepEqual([...MIX_OFF].sort(), ['borrel', 'sea', 'water'], 'off until they sound right');
  for (const [k] of MIX_PARTS) assert.equal(d[k], !MIX_OFF.includes(k), k);
  assert.deepEqual(loadMix(memory()), d);
  assert.deepEqual(loadMix(null), d, 'no storage at all');
});

test('only what differs is kept, and a bad field spoils nothing else', () => {
  const s = memory();
  saveMix('master', 0.4, s);
  saveMix('bell', false, s);
  assert.deepEqual(JSON.parse(s.m[MIX_KEY]), { master: 0.4, bell: false });
  saveMix('master', 1, s);
  assert.deepEqual(JSON.parse(s.m[MIX_KEY]), { bell: false }, 'back at the default: forgotten');
  saveMix('bell', true, s);
  assert.equal(s.m[MIX_KEY], undefined, 'nothing left: no key at all');
  saveMix('master', 7, s);
  assert.equal(loadMix(s).master, 1, 'clamped to 0..1');
  saveMix('volume', 0.5, s);
  saveMix('bell', 'no', s);
  assert.equal(loadMix(s).bell, true, 'a part is a boolean or nothing');
  s.m[MIX_KEY] = JSON.stringify({ music: 'loud', speech: 0.3, sea: 0 });
  const m = loadMix(s);
  assert.equal(m.music, 1);
  assert.equal(m.speech, 0.3);
  assert.equal(m.sea, false, 'not a boolean: the default, which is off');
  s.m[MIX_KEY] = '{not json';
  assert.deepEqual(loadMix(s), mixDefaults());
  forgetMix(s);
  assert.equal(s.m[MIX_KEY], undefined);
});

test('a part off by default is kept when switched on, and forgotten when switched off again', () => {
  const s = memory();
  for (const k of MIX_OFF) saveMix(k, true, s);
  assert.deepEqual(JSON.parse(s.m[MIX_KEY]), { sea: true, water: true, borrel: true });
  const m = loadMix(s);
  for (const k of MIX_OFF) assert.equal(m[k], true, `${k} stays on`);
  for (const k of MIX_OFF) saveMix(k, false, s);
  assert.equal(s.m[MIX_KEY], undefined, 'off again is the default: nothing kept');
  s.m[MIX_KEY] = JSON.stringify({ borrel: true });
  assert.equal(loadMix(s).borrel, true, 'a browser that switched it on before keeps it');
  assert.equal(loadMix(s).sea, false);
});

test('sound.js fires no part that is off, the sea bed included', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'web', 'js', 'sound.js'), 'utf8');
  assert.ok(/const live = \(part\) => !!mix\[part\]/.test(src), 'live() reads the part');
  assert.ok(/live\('borrel'\)/.test(src) && /live\('water'\)/.test(src) && /live\('sea'\)/.test(src));
});

test('storage that throws costs nothing but the memory', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadMix(broken), mixDefaults());
  saveMix('master', 0.2, broken);
  forgetMix(broken);
  assert.equal(clampMix('master', '0.5'), 0.5);
  assert.equal(clampMix('master', true), null);
  assert.equal(clampMix('master', ''), null);
});

test('the Audio tab is drawn from the same table, and the Sound chip lives in it', () => {
  const ui = fs.readFileSync(path.join(HERE, '..', 'web', 'js', 'ui.js'), 'utf8');
  const html = fs.readFileSync(path.join(HERE, '..', 'web', 'index.html'), 'utf8');
  assert.ok(/data-tabbtn="audio"/.test(html), 'a tab button');
  assert.ok(/<section data-tab="audio">[\s\S]*?id="sound-btn"/.test(html), 'and the chip, the master switch, in its section');
  assert.ok(ui.includes('MIX_PARTS') && ui.includes('MIX_LEVELS'), 'ui.js reads the one table');
  assert.ok(ui.includes('data-tab="audio"'));
});

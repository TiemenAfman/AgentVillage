// The island's clock, as its people keep it: how dark, and whether it is Friday borrel.
//
// Both were the browser's until the sea took the walking over, and neither came along -
// the sea stepped every crowd at noon and never rang the bell. shared/daylight.mjs is where
// they live now; this holds it to the sky the page draws and to the sea that uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NIGHT_CURVE, nightAt, borrelAt } from '../shared/daylight.mjs';
import { worldTime } from '../shared/worldclock.mjs';
import { zoneOffset } from '../lib/seaclock.mjs';
import { createCrowds } from '../lib/crowd.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

test('the night the people keep is the night the sky is drawn with', () => {
  // Read out of web/js/world.js rather than imported: that file wants three.js and a
  // document, and all that is compared here is two numbers a row.
  const src = fs.readFileSync(fileURLToPath(new URL('../web/js/world.js', import.meta.url)), 'utf8');
  const table = src.slice(src.indexOf('const DAY = ['), src.indexOf('];', src.indexOf('const DAY = [')));
  const rows = [...table.matchAll(/\{\s*h:\s*([\d.]+)[^}]*?night:\s*([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.ok(rows.length > 4, 'found the sky table');
  assert.deepEqual(NIGHT_CURVE, rows, 'shared/daylight.mjs and the DAY table in web/js/world.js disagree');
});

test('night falls and lifts along the curve', () => {
  assert.equal(nightAt(12), 0);
  assert.equal(nightAt(2), 1);
  assert.equal(nightAt(23.9), 1);
  assert.ok(nightAt(18) > 0.45 && nightAt(18) < 0.7, `dusk at six is ${nightAt(18)}`);
  assert.equal(nightAt(-4), nightAt(20), 'an hour wraps');
});

test('the borrel is Friday from half past four until five', () => {
  assert.equal(borrelAt(5, 16.5), true);
  assert.equal(borrelAt(5, 16.99), true);
  assert.equal(borrelAt(5, 17), false);
  assert.equal(borrelAt(5, 16.4), false);
  assert.equal(borrelAt(4, 16.75), false);
});

test('the borrel keeps the time of the sea, summer and winter', () => {
  // lib/sea.mjs asks borrelAt of worldTime on the sea clock's offset, and the page asks it
  // of the same worldTime on the welcome's `tz`. Europe/Amsterdam is what Dockerfile.sea
  // sets SEA_TZ to.
  const at = (ms) => worldTime(ms, zoneOffset('Europe/Amsterdam', ms));
  // Friday 25 September 2026 14:45 UTC is 16:45 in Amsterdam (CEST, +2).
  const summer = at(Date.UTC(2026, 8, 25, 14, 45));
  assert.equal(summer.weekday, 5);
  assert.equal(summer.hour, 16.75);
  assert.equal(borrelAt(summer.weekday, summer.hour), true);
  // Friday 8 January 2027 15:45 UTC is 16:45 in Amsterdam (CET, +1).
  const winter = at(Date.UTC(2027, 0, 8, 15, 45));
  assert.equal(winter.weekday, 5);
  assert.equal(winter.hour, 16.75);
  // And the day turns at the sea's midnight, not at UTC's.
  assert.equal(at(Date.UTC(2026, 8, 25, 22, 30)).weekday, 6);
});

function island(id) {
  const terrain = makeTerrain(1337, { size: 64 });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < 56; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const buildings = lane.slice(0, 6).map(([gx, gz], i) => ({
    id: `house:${i}`, kind: 'house', name: `House ${i}`, style: 'opus', plot: { gx, gz: gz + 1, w: 1, d: 1, rot: 0 },
  }));
  return { id, terrain, bundle: { island: { name: id, seed: 1337, gridSize: 64, landing: null, town: { paved: lane.slice(10, 13) } }, buildings, paths: [{ id: 'lane', cells: lane }] } };
}

test('the borrel reaches every crowd, a rebuilt one included', () => {
  const crowds = createCrowds({ now: () => 0 });
  const a = crowds.join(island('a'));
  crowds.setGather(true);
  // `available` is empty while the whole village is at the borrel - the one outside view
  // of the flag there is.
  assert.deepEqual(a.walk.available(8, null), []);
  // Republished mid-borrel: a fresh crowd, and it goes to the square too.
  const again = crowds.join(island('a'));
  assert.deepEqual(again.walk.available(8, null), []);
  a.advance(4000, 0);
  crowds.setGather(false);
  assert.ok(again.walk.available(8, null).length > 0, 'the bell rang and never stopped');
});

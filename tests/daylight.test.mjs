// The island's clock, as its people keep it: how dark, and whether the village is due on
// the square.
//
// Both were the browser's until the sea took the walking over, and neither came along -
// the sea stepped every crowd at noon and never rang the bell. shared/daylight.mjs is where
// they live now; this holds it to the sky the page draws and to the sea that uses it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NIGHT_CURVE, nightAt, GATHERINGS, WEEKDAYS, gatheringAt, islandClock } from '../shared/daylight.mjs';
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

// The times are the ones that get asked for in words - "a coffee at ten, lunch at half
// past twelve, tea at three" - and words are exactly what drifts a quarter of an hour the
// first time somebody touches a decimal. So they are written out here as minutes.
const at = (h, m) => h + m / 60;
const id = (g) => (g ? g.id : null);

test('the borrel is Friday from half past four until five', () => {
  assert.equal(id(gatheringAt(5, 16.5)), 'borrel');
  assert.equal(id(gatheringAt(5, 16.99)), 'borrel');
  assert.equal(gatheringAt(5, 17), null);
  assert.equal(gatheringAt(5, 16.4), null);
  assert.equal(gatheringAt(4, 16.75), null, 'a Thursday borrel');
});

test('three breaks on every working day', () => {
  for (const day of WEEKDAYS) {
    assert.equal(id(gatheringAt(day, at(10, 0))), 'coffee', `coffee at ten on day ${day}`);
    assert.equal(id(gatheringAt(day, at(10, 14))), 'coffee', 'still coffee at 10:14');
    assert.equal(gatheringAt(day, at(10, 15)), null, 'and over at 10:15 sharp');

    assert.equal(gatheringAt(day, at(12, 29)), null, 'not yet lunch at 12:29');
    assert.equal(id(gatheringAt(day, at(12, 30))), 'lunch');
    assert.equal(id(gatheringAt(day, at(12, 59))), 'lunch');
    assert.equal(gatheringAt(day, at(13, 0)), null, 'lunch is half an hour');

    assert.equal(id(gatheringAt(day, at(15, 0))), 'tea');
    assert.equal(id(gatheringAt(day, at(15, 14))), 'tea');
    assert.equal(gatheringAt(day, at(15, 15)), null, 'tea is a quarter of an hour');
  }
});

test('the weekend is the weekend', () => {
  for (const day of [0, 6]) {
    for (const g of GATHERINGS) {
      assert.equal(gatheringAt(day, g.from), null, `${g.id} rang on day ${day}`);
      assert.equal(gatheringAt(day, (g.from + g.until) / 2), null);
    }
  }
});

test('no two gatherings are on at once, and every edge is a quarter of an hour', () => {
  // Two at the same moment would leave one of them permanently losing the bell to
  // whichever comes first in the list - and the list's order is not meant to mean anything.
  for (const g of GATHERINGS) {
    assert.ok(g.until > g.from, `${g.id} ends before it starts`);
    for (const other of GATHERINGS) {
      if (other === g) continue;
      const shareADay = g.days.some((d) => other.days.includes(d));
      const overlap = g.from < other.until && other.from < g.until;
      assert.ok(!(shareADay && overlap), `${g.id} and ${other.id} are on at the same time`);
    }
    // A quarter of an hour is a whole number of minutes that divides by sixty exactly in
    // binary, so the minute the bell goes is the same minute on the sea and on the page and
    // no comparison in gatheringAt needs an epsilon.
    for (const edge of [g.from, g.until]) {
      const mins = Math.round(edge * 60);
      assert.equal(mins % 15, 0, `${g.id} turns at ${edge}, which is not a quarter of an hour`);
      assert.equal(mins / 60, edge, `${g.id}'s ${edge} does not survive the round trip`);
    }
  }
});

test('the island keeps Dutch time, summer and winter, whatever zone the sea is in', () => {
  // Friday 25 September 2026 14:45 UTC is 16:45 in Amsterdam (CEST, +2).
  const summer = islandClock(Date.UTC(2026, 8, 25, 14, 45));
  assert.deepEqual(summer, { day: 5, hour: 16.75 });
  assert.equal(id(gatheringAt(summer.day, summer.hour)), 'borrel');
  // Friday 8 January 2027 15:45 UTC is 16:45 in Amsterdam (CET, +1).
  const winter = islandClock(Date.UTC(2027, 0, 8, 15, 45));
  assert.deepEqual(winter, { day: 5, hour: 16.75 });
  // And the day turns at the island's midnight, not at UTC's.
  assert.equal(islandClock(Date.UTC(2026, 8, 25, 22, 30)).day, 6);
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

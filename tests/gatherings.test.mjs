// When the village is on the square, as a schedule.
//
// The times here are the ones that were asked for in words - "the borrel at ten, half past
// twelve and three on every working day" - and words are exactly what drifts a quarter of
// an hour the first time somebody touches a decimal. So they are written out as minutes.
//
// No loader and no document: shared/gatherings.mjs is read by the sea, and the moment this
// file needs a stub the sea can no longer ring the bell.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GATHERINGS, WEEKDAYS, gatheringAt, worldClock } from '../shared/gatherings.mjs';

const at = (h, m) => h + m / 60;
const SUN = 0, MON = 1, WED = 3, THU = 4, FRI = 5, SAT = 6;
const id = (g) => (g ? g.id : null);

test('three breaks on every working day, and the borrel on Friday alone', () => {
  for (const day of WEEKDAYS) {
    assert.equal(id(gatheringAt(day, at(10, 0))), 'coffee', `coffee at ten on day ${day}`);
    assert.equal(id(gatheringAt(day, at(10, 14))), 'coffee', 'still coffee at 10:14');
    assert.equal(id(gatheringAt(day, at(10, 15))), null, 'and over at 10:15 sharp');

    assert.equal(id(gatheringAt(day, at(12, 29))), null, 'not yet lunch at 12:29');
    assert.equal(id(gatheringAt(day, at(12, 30))), 'lunch');
    assert.equal(id(gatheringAt(day, at(12, 59))), 'lunch');
    assert.equal(id(gatheringAt(day, at(13, 0))), null, 'lunch is half an hour');

    assert.equal(id(gatheringAt(day, at(15, 0))), 'tea');
    assert.equal(id(gatheringAt(day, at(15, 14))), 'tea');
    assert.equal(id(gatheringAt(day, at(15, 15))), null, 'tea is a quarter of an hour');
  }

  assert.equal(id(gatheringAt(FRI, at(16, 29))), null);
  assert.equal(id(gatheringAt(FRI, at(16, 30))), 'borrel');
  assert.equal(id(gatheringAt(FRI, at(16, 59))), 'borrel');
  assert.equal(id(gatheringAt(FRI, at(17, 0))), null, 'and the borrel keeps its half hour');
  for (const day of [MON, WED, THU]) {
    assert.equal(id(gatheringAt(day, at(16, 45))), null, `no borrel on day ${day}`);
  }
});

test('the weekend is the weekend', () => {
  for (const day of [SAT, SUN]) {
    for (const g of GATHERINGS) {
      assert.equal(gatheringAt(day, g.from), null, `${g.id} rang on day ${day}`);
      assert.equal(gatheringAt(day, (g.from + g.until) / 2), null);
    }
  }
});

test('the list is what the manual says it is', () => {
  // Five workdays, one Friday, and nothing overlaps - two gatherings at once would have
  // one of them lose the bell to whichever comes first in the list.
  assert.deepEqual(WEEKDAYS, [MON, 2, WED, THU, FRI]);
  for (const g of GATHERINGS) {
    assert.ok(g.until > g.from, `${g.id} ends before it starts`);
    for (const other of GATHERINGS) {
      if (other === g) continue;
      const shareADay = g.days.some((d) => other.days.includes(d));
      const overlap = g.from < other.until && other.from < g.until;
      assert.ok(!(shareADay && overlap), `${g.id} and ${other.id} are on at the same time`);
    }
  }
});

test('worldClock reads the day and the hour off an epoch and an offset', () => {
  // Wednesday 23 September 2026, 10:35 UTC: half past twelve in Amsterdam (UTC+2, summer),
  // and the same instant is Wednesday at 06:35 in New York (UTC-4).
  const t = Date.UTC(2026, 8, 23, 10, 35);
  assert.deepEqual(worldClock(t, 120), { day: WED, hour: at(12, 35) });
  assert.deepEqual(worldClock(t, -240), { day: WED, hour: at(6, 35) });
  // Late on Wednesday in UTC is already Thursday east of it.
  assert.deepEqual(worldClock(Date.UTC(2026, 8, 23, 23, 30), 120), { day: THU, hour: at(1, 30) });
  // And early on Monday in UTC is still Sunday west of it.
  assert.deepEqual(worldClock(Date.UTC(2026, 8, 21, 3, 0), -300), { day: SUN, hour: at(22, 0) });
  // The epoch itself was a Thursday at midnight.
  assert.deepEqual(worldClock(0, 0), { day: THU, hour: 0 });
  // Whole minutes: the seconds are dropped rather than rounded, so 10:14:59 is still coffee.
  assert.equal(worldClock(Date.UTC(2026, 8, 23, 8, 14, 59), 120).hour, at(10, 14));
});

test('worldClock agrees with Date about every hour of a week', () => {
  // Checked against Date for a week at an offset that is not a whole hour - India is
  // +5:30 - because a shortcut in the day arithmetic would show there first.
  //
  // Compared in whole minutes rather than in decimal hours. Both sides are dividing by
  // sixty and the two do it in a different order, so 5:37 comes out a last bit apart -
  // which is not a disagreement about the time and would make this a test of IEEE 754.
  // What has to hold is that the two name the same minute. The thresholds the schedule is
  // read against are all quarter hours and those divide exactly, so the boundary itself
  // is never in doubt: `the list is what the manual says it is` above walks them.
  const start = Date.UTC(2026, 8, 20, 0, 7);
  for (let h = 0; h < 7 * 24; h++) {
    const t = start + h * 3600000;
    const shifted = new Date(t + 330 * 60000);
    const c = worldClock(t, 330);
    assert.equal(c.day, shifted.getUTCDay());
    assert.equal(Math.round(c.hour * 60), shifted.getUTCHours() * 60 + shifted.getUTCMinutes());
  }
});

test('the hours the schedule turns on divide exactly', () => {
  // Every `from` and `until` is a quarter of an hour, and a quarter of an hour is a whole
  // number of minutes that divides by sixty without a remainder in binary. So the minute
  // the bell goes is the minute it goes, on both machines, and no epsilon is needed
  // anywhere in the comparison `gatheringAt` makes.
  for (const g of GATHERINGS) {
    for (const edge of [g.from, g.until]) {
      const mins = Math.round(edge * 60);
      assert.equal(mins % 15, 0, `${g.id} turns at ${edge}, which is not a quarter of an hour`);
      assert.equal(mins / 60, edge, `${g.id}'s ${edge} does not survive the round trip`);
    }
  }
});

test('the schedule has no clock and no locale of its own', () => {
  // shared/ runs in Node and in the browser and must give the same answer in both. A Date
  // in here would read this machine's zone, and a settler would be at lunch on one screen
  // and at home on another.
  const src = fs.readFileSync(fileURLToPath(new URL('../shared/gatherings.mjs', import.meta.url)), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/\bnew Date\b|\bDate\.now\b|getTimezoneOffset|getDay\(|getHours\(/.test(code), 'gatherings.mjs reads a clock');
  assert.ok(!/Math\.(sin|cos|tan|pow|exp|log)\b/.test(code), 'gatherings.mjs uses a transcendental');
  assert.ok(!/from ['"](three|\.\.\/web|\.\.\/lib)/.test(code), 'gatherings.mjs imports outside shared/');
});

// The world's clock: the calendar the page reads off the sea's two numbers, the zone the sea
// reads them in, and the rule that nothing in the browser asks its own zone instead.
//
// Every one of these is a disagreement between two screens that nothing on either screen
// would report. A season a month out, a Friday that is Thursday for somebody else, an
// afternoon two hours behind the wall because the sea runs in a container - each of them
// looks like a perfectly ordinary island to whoever is looking at it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { worldTime, seasonOf } from '../shared/worldclock.mjs';
import { createSeaClock, zoneOffset } from '../lib/seaclock.mjs';
import { afloat, talk, SEA_V } from './support/sea.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---- the calendar ---------------------------------------------------------------------

test('the hour is the one the HUD has always shown: UTC plus the world\'s offset, whole minutes', () => {
  const t = Date.UTC(2026, 8, 23, 14, 30, 45);
  assert.equal(worldTime(t, 120).hour, 16.5);
  assert.equal(worldTime(t, 0).hour, 14.5);
  // West of Greenwich wraps back past midnight rather than going negative.
  assert.equal(worldTime(Date.UTC(2026, 8, 23, 2, 0), -300).hour, 21);
});

test('the month and the weekday turn over at the world\'s midnight, not this machine\'s', () => {
  // 22:30 UTC on the last of September is already the first of October in Amsterdam's
  // summer time - a Thursday.
  const t = Date.UTC(2026, 8, 30, 22, 30);
  assert.deepEqual([worldTime(t, 120).month, worldTime(t, 120).weekday], [9, 4]);
  assert.deepEqual([worldTime(t, 0).month, worldTime(t, 0).weekday], [8, 3]);
  // And the other way round: two in the morning on New Year's Day UTC is still New Year's
  // Eve in New York, in December and on a Wednesday.
  const ny = worldTime(Date.UTC(2026, 0, 1, 2, 0), -300);
  assert.deepEqual([ny.month, ny.weekday, ny.season], [11, 3, 'winter']);
});

test('the season is worked out once, and world.js hands out the same one', async () => {
  assert.deepEqual([0, 3, 6, 9, 11].map(seasonOf), ['winter', 'spring', 'summer', 'autumn', 'winter']);
  assert.equal(worldTime(Date.UTC(2026, 9, 1, 12), 0).season, 'autumn');
});

test('the moon keeps to the sky everybody else has: new, full, and new again', () => {
  const near = (a, b) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
  // Real moons, off the almanac. The mean lunation is out by up to half a day against the
  // real one, which is under two hundredths of a phase.
  assert.ok(near(worldTime(Date.UTC(2024, 0, 11, 11, 57), 0).moon, 0) < 0.03, 'a new moon');
  assert.ok(near(worldTime(Date.UTC(2024, 0, 25, 17, 54), 0).moon, 0.5) < 0.03, 'a full moon');
  // And it does not care whose afternoon it is.
  const t = Date.UTC(2026, 8, 23, 12);
  assert.equal(worldTime(t, 120).moon, worldTime(t, -480).moon);
});

// ---- the sea's zone -------------------------------------------------------------------

test('a zone by name comes to the right minutes on either side of summer time', () => {
  assert.equal(zoneOffset('Europe/Amsterdam', Date.UTC(2026, 6, 1, 12)), 120);
  assert.equal(zoneOffset('Europe/Amsterdam', Date.UTC(2026, 0, 15, 12)), 60);
  assert.equal(zoneOffset('UTC', Date.UTC(2026, 6, 1, 12)), 0);
  assert.equal(zoneOffset('America/New_York', Date.UTC(2026, 6, 1, 12)), -240);
  // Half-hour zones exist and are not rounded to the hour.
  assert.equal(zoneOffset('Asia/Kolkata', Date.UTC(2026, 6, 1, 12)), 330);
});

test('the clocks going back are said once, on the first check after they go', () => {
  // Summer time in Europe ends at 01:00 UTC on the last Sunday in October.
  const change = Date.UTC(2026, 9, 25, 1, 0);
  let t = change - 5 * 60_000;
  const clock = createSeaClock({ now: () => t, zone: 'Europe/Amsterdam' });
  assert.equal(clock.current().tz, 120);
  // Asked on every beat; nothing to say before the switch, however often.
  for (let i = 0; i < 40; i++) { t += 7_000; assert.equal(clock.tick(), null); }
  t = change + 2 * 60_000;
  const said = clock.tick();
  assert.deepEqual(said, { now: t, tz: 60 });
  t += 2 * 60_000;
  assert.equal(clock.tick(), null, 'and not again on the next check');
});

test('a zone the sea does not know is said once and the machine\'s own stands in', () => {
  const lines = [];
  const clock = createSeaClock({ zone: 'Europe/Atlantis', log: (m) => lines.push(m) });
  assert.notEqual(clock.zone(), 'Europe/Atlantis');
  assert.ok(Number.isFinite(clock.current().tz));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Atlantis/);
});

test('the welcome reads the world in the sea\'s zone, not the box it runs on', async () => {
  const t = Date.UTC(2026, 6, 1, 12);
  await afloat(async ({ wsUrl, base }) => {
    const c = talk(wsUrl);
    await c.ready;
    c.say({ t: 'join', v: SEA_V, as: 'client' });
    const hello = await c.until((m) => m.t === 'welcome');
    assert.equal(hello.now, t);
    assert.equal(hello.tz, 330);
    // The harbour office's own page asks /world, and it tells the same time.
    const world = await fetch(`${base}/world`).then((r) => r.json());
    assert.deepEqual([world.now, world.tz], [t, 330]);
    c.close();
    await c.closed;
  }, { now: () => t, zone: 'Asia/Kolkata' });
});

// ---- nobody asks their own zone -------------------------------------------------------

test('nothing in web/js/ or shared/ reads the calendar in this browser\'s own zone', () => {
  // The local getters are what this whole thing replaced. `demo.js` is the workbench, whose
  // tower deliberately shows the wall clock of whoever is looking at it; `ui.js` and
  // `mail.js` only format real dates - a session's start, a mail's arrival - which belong to
  // the reader and to nobody's world.
  const EXEMPT = new Set(['web/js/demo.js', 'web/js/ui.js', 'web/js/mail.js']);
  const LOCAL = /\.get(FullYear|Month|Date|Day|Hours|Minutes)\(/;
  const offenders = [];
  for (const dir of ['web/js', 'shared']) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!/\.m?js$/.test(f) || f.endsWith('-mesh.js')) continue;
      const rel = `${dir}/${f}`;
      if (EXEMPT.has(rel)) continue;
      readFileSync(join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
        if (LOCAL.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(offenders, [], 'go through worldTime() in shared/worldclock.mjs instead');
});

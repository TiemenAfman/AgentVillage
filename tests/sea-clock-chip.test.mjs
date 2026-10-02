// The clock chip is the sea's clock, and only the sea's host sets it (Plans/zeetijd-van-de-host.md).
//
// The keeper asked more than once for the chip to stop being a per-screen lens, and it kept
// coming back: a handler that cycles `hourOverride`, an H on ORBIT_KEYS. So the first half
// reads the source and fails on either. The second half is the one way the hour may move -
// the host's islander calling its own sea's `setTime`, which has no door on the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { createSeaClock } from '../lib/seaclock.mjs';
import { isPublicPath } from '../lib/access.mjs';
import { worldTime } from '../shared/worldclock.mjs';
import { afloat, talk, until, SEA_V } from './support/sea.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Some files are checked out with CRLF; the patterns below speak in \n.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// ---- nobody previews another hour from the chip -----------------------------------------

test('no key in ORBIT_KEYS opens the clock chip', () => {
  const main = read('web/js/main.js');
  const block = main.match(/const ORBIT_KEYS = \{([\s\S]*?)\};/);
  assert.ok(block, 'ORBIT_KEYS is where it was');
  assert.doesNotMatch(block[1], /clock-chip/, 'the clock is the sea\'s, not a key\'s');
  assert.doesNotMatch(read('web/index.html'), /id="clock-chip"[^>]*data-key/, 'and the chip shows no key badge');
});

test('the chip\'s click changes no hour on this screen, and does nothing for a non-host', () => {
  const main = read('web/js/main.js');
  const ui = read('web/js/ui.js');
  assert.doesNotMatch(main + ui, /onToggleTime/, 'the per-screen lens is gone');
  // `?hour` is the one writer of hourOverride left: a developer's lens for screenshots.
  const writes = main.match(/hourOverride\s*=[^=]/g) || [];
  assert.deepEqual(writes, [], 'nothing assigns state.hourOverride after the boot');
  assert.match(main, /hourOverride: params\.has\('hour'\)/, '?hour still sets it at the boot');
  // The chip's handler in main.js asks whether this is the host before anything else.
  const h = main.match(/onClockChip: \(chip\) => \{([\s\S]*?)\n {4}\},/);
  assert.ok(h, 'main.js answers onClockChip');
  assert.match(h[1].trim(), /^if \(!state\.seaHost\) return;/, 'a non-host gets nothing from the chip');
  assert.doesNotMatch(h[1], /hourOverride|seaSkewMs/, 'and the host changes the sea, not this screen');
  // ui.js hands the click on and does nothing of its own with it.
  const click = ui.match(/el\('clock-chip'\)\.addEventListener\('click', ([^\n]*)\);/);
  assert.ok(click, 'ui.js wires the chip');
  assert.match(click[1], /handlers\.onClockChip/);
});

test('the host is decided by the islander, keeper-only, and never on somebody else\'s sea', () => {
  const serve = read('serve.mjs');
  assert.equal(isPublicPath('/api/sea-time'), false, 'a visitor cannot reach the route');
  assert.match(serve, /function hostsSea\(\) \{ return seaModeOf\(\) !== 'join' && !!ownSea; \}/);
  assert.match(serve, /seaHost: who\.role === 'islander' && hostsSea\(\)/);
  const route = serve.match(/if \(p === '\/api\/sea-time' && req\.method === 'POST'\) \{\n([^\n]*)/);
  assert.ok(route, 'POST /api/sea-time is there');
  assert.match(route[1], /if \(!hostsSea\(\)\) return json\(res, 403/, 'refused first when we do not host');
  // The sea's beat keeps to the world's clock, shift and all.
  assert.match(read('lib/sea.mjs'), /worldTime\(clock\.at\(\), clock\.offset\(\)\)/);
});

// ---- the clock ----------------------------------------------------------------------------

test('a shift moves the world\'s moment and nothing else, and real time takes it back', () => {
  let t = Date.UTC(2026, 6, 1, 18, 0);                     // 20:00 in Amsterdam's summer
  const clock = createSeaClock({ now: () => t, zone: 'Europe/Amsterdam' });
  assert.equal(clock.shiftForHour(20), 0);
  // 07:00 asked at 20:00 is tomorrow morning, 18:00 is two hours ago: the nearest one.
  assert.equal(clock.shiftForHour(7), 11 * 3600e3);
  assert.equal(clock.shiftForHour(18), -2 * 3600e3);
  const c = clock.setShift(clock.shiftForHour(12));
  assert.equal(worldTime(c.now, c.tz).hour, 12);
  assert.equal(c.shift, -8 * 3600e3);
  // And then time runs on from there.
  t += 3600e3;
  assert.equal(worldTime(clock.at(), clock.offset()).hour, 13);
  assert.deepEqual(clock.setShift(0), { now: t, tz: 120, shift: 0 });
  // Never more than a week either way, whatever a page sends.
  assert.equal(clock.setShift(1e15).shift, 7 * 24 * 3600e3);
  assert.equal(clock.setShift('nonsense').shift, 0);
});

// ---- the sea ------------------------------------------------------------------------------

test('the host sets the time: every joined page is told, and a newcomer is welcomed in it', async () => {
  const t = Date.UTC(2026, 6, 1, 18, 0);
  await afloat(async ({ sea, wsUrl }) => {
    const a = talk(wsUrl);
    await a.ready;
    a.say({ t: 'join', v: SEA_V, as: 'client' });
    const hello = await a.until((m) => m.t === 'welcome');
    assert.equal(hello.shift, 0);

    const set = sea.setTime({ hour: 9 });
    const told = await a.until((m) => m.t === 'clock');
    assert.deepEqual(told, { t: 'clock', ...set });
    assert.equal(worldTime(told.now, told.tz).hour, 9);

    const b = talk(wsUrl);
    await b.ready;
    b.say({ t: 'join', v: SEA_V, as: 'client' });
    const later = await b.until((m) => m.t === 'welcome');
    assert.equal(worldTime(later.now, later.tz).hour, 9, 'a page that joins after is in the host\'s hour');

    sea.setTime({ real: true });
    const back = await a.until((m) => m.t === 'clock');
    assert.deepEqual([back.now, back.shift], [t, 0]);
    assert.throws(() => sea.setTime({ hour: 25 }));
    assert.throws(() => sea.setTime({}));
    for (const c of [a, b]) { c.close(); await c.closed; }
  }, { now: () => t, zone: 'Europe/Amsterdam' });
});

test('the sea has no door for its clock: no key, no token and no route moves it', async () => {
  const t = Date.UTC(2026, 6, 1, 18, 0);
  await afloat(async ({ sea, base }) => {
    for (const path of ['/clock', '/time', '/sea-time', '/api/sea-time', '/island/x/clock']) {
      const r = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sea-Key': 'k' },
        body: JSON.stringify({ hour: 3 }),
      });
      assert.notEqual(r.status, 200, `${path} answered`);
    }
    await until(() => true, 'a beat');
    assert.equal(sea.clock.shift(), 0);
    const world = await fetch(`${base}/world`).then((r) => r.json());
    assert.equal(world.now, t);
  }, { now: () => t, zone: 'Europe/Amsterdam', key: 'k' });
});

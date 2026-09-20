// The weather, both halves of it: the clock the sea keeps and the haze the island draws.
//
// Three things here are worth a test rather than a look, and each of them is a promise
// that would be broken silently.
//
//   The two copies of the vocabulary. lib/weather.mjs cannot import web/js and web/js must
//   not import lib/, so the four words are written out twice on purpose - and the day they
//   disagree, a sea starts sending a sky that every page in the world draws as sunshine
//   with nothing logged anywhere.
//
//   That clear weather is the island exactly as it was. Everything the weather does is a
//   multiplier on numbers that were tuned without it, so "clear is a no-op" is the only
//   thing standing between this feature and a quiet regression in how every island has
//   always looked.
//
//   And the floor under the haze. A downpour closing over the neighbours is the exact
//   failure applyFogRange in main.js was written to prevent - see RING in
//   web/js/horizon.js - and it is invisible on a machine with one island on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import { createWeather, SKIES } from '../lib/weather.mjs';
import { afloat, talk, SEA_V } from './support/sea.mjs';

// web/js/weather.js reaches world.js for seasonOf, and world.js asks for its texture sheets
// the moment it loads. The same stub tests/water-span.test.mjs uses.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const web = await import('../web/js/weather.js');
delete globalThis.document;

// ---- the clock the sea keeps ------------------------------------------------------

test('a world starts clear and stays in one sky until its spell is out', () => {
  let t = 1_000_000;
  const w = createWeather({ now: () => t, spellMs: 60_000, seed: 7 });
  assert.equal(w.current().sky, 'clear');
  assert.equal(w.current().since, 1_000_000);

  // Nothing at all until the spell runs out, however often it is asked. The sea asks on
  // every beat - fifteen times a second - and all but one of those must cost a broadcast
  // of nothing.
  for (let i = 0; i < 300; i++) { t += 100; assert.equal(w.tick(), null); }

  t += 3 * 60_000;                 // past the longest a spell can be stretched to
  const turned = w.tick();
  assert.ok(turned, 'the sky never turned');
  assert.equal(turned.since, t, 'a spell begins when the sky turned, not when it was asked');
  assert.equal(w.tick(), null, 'and the new one is a spell of its own');
});

test('the sky only ever says one of four words, and rain is never a surprise', () => {
  let t = 0;
  const w = createWeather({ now: () => t, spellMs: 1000, seed: 99 });
  let was = 'clear';
  let sawRain = 0;
  for (let i = 0; i < 400; i++) {
    t += 3000;
    const next = w.tick();
    assert.ok(next, 'a spell of 1000 ms should be over after 3000');
    assert.ok(SKIES.includes(next.sky), `the sea invented a sky: ${next.sky}`);
    // Rain arrives through an afternoon going grey, never out of a blue sky. That is the
    // one transition rule the look of the thing depends on - an overcast spell is what
    // makes the rain mean something rather than being a switch somebody threw.
    if (next.sky === 'rain') { sawRain++; assert.notEqual(was, 'clear'); }
    assert.notEqual(next.sky === 'fog' && was === 'rain', true, 'rain must not clear straight into fog');
    was = next.sky;
  }
  assert.ok(sawRain > 20, `only ${sawRain} showers in 400 spells - the table has stopped raining`);
});

test('two seas started a moment apart do not run the same weather', () => {
  const a = createWeather({ now: () => 1_700_000_000_000, spellMs: 1000 });
  const b = createWeather({ now: () => 1_700_000_000_001, spellMs: 1000 });
  // Seeded off the clock, so this is about there being no shared constant to fall back on.
  // Both start clear; it is the seed riding along with it that has to differ.
  assert.notEqual(a.current().seed, b.current().seed);
});

// ---- and what goes over the wire --------------------------------------------------

test('the welcome carries the sky, so a joiner is already standing in it', async () => {
  await afloat(async ({ wsUrl }) => {
    const c = talk(wsUrl);
    await c.ready;
    c.say({ t: 'join', v: SEA_V, as: 'client' });
    const hello = await c.until((m) => m.t === 'welcome');
    assert.ok(hello.weather, 'the welcome said nothing about the sky');
    assert.ok(SKIES.includes(hello.weather.sky));
    assert.equal(typeof hello.weather.since, 'number');
    c.close();
    await c.closed;
  });
});

test('the sky turning reaches everybody, as one word for the whole world', async () => {
  // A spell of a millisecond, so the beat rolls it over at once. Nothing else in the sea
  // is hurried: this is the one knob, and it exists so a test does not have to sit through
  // eleven minutes of somebody's afternoon.
  await afloat(async ({ wsUrl }) => {
    const a = talk(wsUrl);
    const b = talk(wsUrl);
    await Promise.all([a.ready, b.ready]);
    a.say({ t: 'join', v: SEA_V, as: 'client' });
    b.say({ t: 'join', v: SEA_V, as: 'client' });
    await a.until((m) => m.t === 'welcome');
    await b.until((m) => m.t === 'welcome');
    const [x, y] = await Promise.all([
      a.until((m) => m.t === 'weather', 60),
      b.until((m) => m.t === 'weather', 60),
    ]);
    assert.equal(x.sky, y.sky, 'two people in one world were told different weather');
    assert.equal(x.since, y.since);
    a.close(); b.close();
    await Promise.all([a.closed, b.closed]);
  }, { tickMs: 20, weather: { spellMs: 1 } });
});

// ---- the two copies of the vocabulary ---------------------------------------------

test('the sea and the island know the same four skies', () => {
  // Written out twice because neither side may import the other. If this ever fails, the
  // failure in the wild is silent: the sea sends a word, every page draws sunshine, and
  // nothing anywhere says why.
  assert.deepEqual([...web.SKIES].sort(), [...SKIES].sort());
});

// ---- the haze ---------------------------------------------------------------------

const { hazeRange } = web;

test('clear weather is the island exactly as it was', () => {
  // Both the shapes applyFogRange produces: one island on its own, and one with company.
  // Every number here is the one main.js had before there was any weather, so a change to
  // either floor that starts biting at thickness 1 fails here rather than in somebody's
  // screenshot.
  for (const half of [32, 64, 128]) {
    const alone = hazeRange({ near: half * 1.1, far: half * 3.4, half, out: 0, thick: 1 });
    assert.equal(alone.near, half * 1.1);
    assert.equal(alone.far, half * 3.4);

    const out = half * 4 + 20;
    const far = Math.max(half * 3.4, out + 110);
    const company = hazeRange({ near: half * 1.1, far, half, out, thick: 1 });
    assert.equal(company.near, half * 1.1);
    assert.equal(company.far, far);
  }
});

test('the thickest weather never closes over the furthest coast', () => {
  // A berth for two 64-grids puts a neighbour's far coast at 144. Fog is the thickest sky
  // there is, and it still has to leave that coast inside the haze rather than behind it -
  // an island with no water behind it reads as one that fell off the edge of the world,
  // which is the whole reason applyFogRange holds the haze off in the first place.
  const half = 32, out = 144;
  const base = Math.max(half * 3.4, out + 110);
  for (const thick of [0.42, 0.5, 0.7, 0.86]) {
    const h = hazeRange({ near: half * 1.1, far: base, half, out, thick });
    assert.ok(h.far > out, `fog at ${thick} closed to ${h.far}, inside a coast at ${out}`);
    assert.ok(h.far <= base, 'weather may only close the haze in, never open it out');
    assert.ok(h.near < h.far, 'the near haze overtook the far one');
  }
});

test('fog on an island with nobody else in the world still shows the island', () => {
  // No coast to protect out there, so the floor is our own land: the orbit camera at its
  // usual framing has to keep the town in front of the wall. A 64-grid is 32 half-widths
  // and is framed from about 90 units back.
  const half = 32;
  const h = hazeRange({ near: half * 1.1, far: half * 3.4, half, out: 0, thick: 0.42 });
  assert.ok(h.far >= half * 2.2, `fog closed to ${h.far} on a ${half}-half island`);
  assert.ok(h.far < half * 3.4, 'fog did nothing at all');
  assert.ok(h.near < h.far);
});

test('a sky nobody has heard of is clear weather, not an error', () => {
  // The one-directional failure the whole arrangement rests on: an old page in a new world
  // gets sunshine. It must not throw, and it must not leave the haze somewhere between two
  // skies - see setSky in web/js/weather.js.
  assert.doesNotThrow(() => web.setSky({ sky: 'hagelstorm', seed: 1, since: 2 }));
  assert.doesNotThrow(() => web.setSky(null));
  assert.doesNotThrow(() => web.setSky({}));
  // With no scene built, the haze is one - which is the same answer a page with no sea at
  // all gets, and the same answer clear weather gives.
  assert.equal(web.haze(), 1);
});

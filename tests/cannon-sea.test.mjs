// The guns on the sea (Plans/kanonnen.md, lib/cannons.mjs and the roster's `{t:'cannon'}`): a shot
// is passed on to everybody else only from somebody aboard the ship it was fired from, and the sea
// flies the same ball to hurt whoever stands where it comes down - never the one who fired it, never
// anybody on their own island, and through the one door (lib/health.mjs hurt, cause `cannon`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCannons } from '../lib/cannons.mjs';
import { createRoster } from '../lib/players.mjs';
import { BALL_HIT, BALL_SPEED } from '../shared/cannon.mjs';

function fakeWorld() {
  let t = 1000;
  const hurts = [], said = [];
  const island = { id: 'aaaa', origin: [100, 0], bundle: { island: { name: 'Home' } },
    terrain: { half: 20, worldHeight: () => 1 } };
  const fleet = { all: () => [island] };
  const players = [];
  const roster = { all: () => players, boats: { snapshot: () => [] } };
  const health = { hurt: (p, amount, cause) => { hurts.push({ id: p.id, amount, cause }); return 'hurt'; } };
  const cannons = createCannons({ fleet, roster, health, combat: null, broadcast: (m) => said.push(m), now: () => t });
  return { cannons, players, hurts, said, advance: (ms) => { t += ms; }, island };
}

test('a ball coming down on open sea by a swimmer hurts them; on land, whoever is in the blast', () => {
  const w = fakeWorld();
  // Fired level from 2 up at x 0, out along +x: down on open water about 20 on.
  w.players.push({ id: 'gunner', walking: true, posed: true, f: 0, x: 0, y: 1, z: 0 });
  w.players.push({ id: 'far', walking: true, posed: true, f: 0, x: 60, y: 0, z: 0 });
  w.cannons.fire({ id: 'gunner' }, { o: [0, 2, 0], v: [BALL_SPEED, 0, 0], n: 1 });
  for (let i = 0; i < 40; i++) { w.advance(100); w.cannons.tick(); }
  assert.equal(w.cannons.flying(), 0);
  assert.deepEqual(w.hurts, [], 'a splash far from anybody hurt somebody');
  // Now a body standing where it lands: it is hit square.
  const land = Math.sqrt(2 * 2 / 7.5) * BALL_SPEED;
  w.players.push({ id: 'target', walking: true, posed: true, f: 0, x: land - 0.2, y: 0, z: 0 });
  w.cannons.fire({ id: 'gunner' }, { o: [0, 2, 0], v: [BALL_SPEED, 0, 0], n: 2 });
  for (let i = 0; i < 40; i++) { w.advance(50); w.cannons.tick(); }
  const hit = w.hurts.find((h) => h.id === 'target');
  assert.ok(hit, 'the body it landed on was not hurt');
  assert.equal(hit.cause.kind, 'cannon');
  assert.ok(!w.hurts.some((h) => h.id === 'gunner'), 'the gunner was hurt by their own shot');
  const boom = w.said.find((m) => m.a === 'boom');
  assert.ok(boom && boom.by === 'gunner' && boom.n === 2, 'no boom said for a body hit');
});

test('nobody is hurt on their own island, a visitor there is', () => {
  const w = fakeWorld();
  // Down on the island (height 1 over x 80..120): a blast at about x 100.
  w.players.push({ id: 'gunner', walking: true, posed: true, f: 0, x: 0, y: 1, z: 0 });
  const v = [30, 13, 0];
  // Where it comes down: 2 + 13 t - 3.75 t^2 = 1 -> t ~ 3.54, x ~ 106.
  w.players.push({ id: 'keeper', island: 'aaaa', walking: true, posed: true, f: 0, x: 106.2, y: 1, z: 0 });
  w.players.push({ id: 'visitor', island: 'bbbb', walking: true, posed: true, f: 0, x: 106.2, y: 1, z: 0.4 });
  w.cannons.fire({ id: 'gunner' }, { o: [0, 2, 0], v, n: 3 });
  for (let i = 0; i < 100; i++) { w.advance(50); w.cannons.tick(); }
  assert.ok(!w.hurts.some((h) => h.id === 'keeper'), 'the keeper was hurt on their own island');
  const visitor = w.hurts.find((h) => h.id === 'visitor');
  assert.ok(visitor && visitor.amount > 0 && visitor.amount <= BALL_HIT);
  assert.equal(visitor.cause.island, 'Home');
});

test('the roster passes a shot on only from somebody aboard that ship, and not too fast', () => {
  const fired = [];
  const roster = createRoster({ cannon: (p, shot) => fired.push(shot), moorings: [{ id: 'boat:abcd', x: 0, z: 0, yaw: 0 }] });
  const sent = [[], []];
  const conn = (k) => ({ id: `c${k}aabbcc`, send: (x) => sent[k].push(JSON.parse(x)), close() {} });
  const c0 = conn(0), c1 = conn(1);
  const a = roster.attach(c0, {});
  roster.attach(c1, {});
  const say = (m) => roster.message(c0, JSON.stringify(m));
  say({ t: 'w', on: true });
  const shot = { t: 'cannon', a: 'fire', b: 'boat:abcd', i: 0, o: [1, 2, 3], v: [BALL_SPEED, 0, 0], n: 1 };
  say(shot);
  assert.equal(fired.length, 0, 'fired from a ship not aboard');
  roster.boats.board('boat:abcd', a.id, [0, 0]);
  assert.ok(roster.boats.aboard('boat:abcd', a.id), 'the test could not put the gunner aboard');
  say(shot);
  assert.equal(fired.length, 1);
  assert.ok(sent[1].some((m) => m.t === 'cannon' && m.a === 'fire' && m.id === a.id && m.b === 'boat:abcd'), 'not passed on');
  assert.ok(!sent[0].some((m) => m.t === 'cannon'), 'echoed to the gunner');
  say({ ...shot, n: 2 });
  assert.equal(fired.length, 1, 'a second shot at once was taken');
  say({ ...shot, v: [BALL_SPEED * 2, 0, 0] });
  assert.equal(fired.length, 1);
});

test('a hull takes its hits and sinks, back whole at her mooring with her crew in the water; at home she is safe', async () => {
  const { createBoats } = await import('../lib/boats.mjs');
  const { HULL_HITS } = await import('../shared/cannon.mjs');
  const id = 'aaaaaaaaaaaaaaaa';
  const ship = `boat:${id}`, rowboat = `boat:${id}-n0`;
  const boats = createBoats({ moorings: [{ id: ship, x: 10, z: 0, yaw: 0 }, { id: rowboat, x: 12, z: 0, yaw: 0 }] });
  const island = { id, origin: [0, 0], bundle: { island: { name: 'Home' } }, terrain: { half: 32, worldHeight: () => -2 } };
  const players = [{ id: 'aabbccdd', walking: true, posed: true, f: 0, x: 100, y: 1, z: 0, deck: { boat: ship } }];
  const said = [];
  const cannons = createCannons({
    fleet: { all: () => [island], get: (k) => (k === id ? island : null) },
    roster: { all: () => players, boats },
    health: { hurt: () => 'hurt' }, combat: null, broadcast: (m) => said.push(m), now: () => 1000,
  });
  // At her mooring she is in her own island's waters: nothing.
  assert.deepEqual(cannons.hitHull(ship), { id: ship, safe: true });
  // Out at sea, with somebody aboard.
  boats.board(ship, 'aabbccdd', [10, 0]);
  boats.take(ship, 'aabbccdd');
  boats.moved(ship, 'aabbccdd', 100, 0, 0);
  for (let k = 1; k < HULL_HITS.galleon; k++) assert.equal(cannons.hitHull(ship).hits, k);
  assert.ok(said.some((m) => m.t === 'cannon' && m.a === 'hull' && m.id === ship && m.of === HULL_HITS.galleon));
  assert.equal(cannons.hitHull(ship).sunk, true);
  const sunk = said.find((m) => m.t === 'boat' && m.sunk);
  assert.ok(sunk && sunk.id === ship && sunk.x === 10 && sunk.z === 0 && sunk.pilot === null, 'not back at her mooring');
  assert.deepEqual(sunk.sunk, [100, 0], 'not said where she went down');
  assert.equal(players[0].deck, null);
  assert.ok(!boats.aboard(ship, 'aabbccdd'), 'still aboard a sunk ship');
  // A rowing boat has two lives.
  boats.take(rowboat, 'aabbccdd');
  boats.moved(rowboat, 'aabbccdd', 100, 5, 0);
  assert.equal(cannons.hitHull(rowboat).hits, 1);
  assert.equal(cannons.hitHull(rowboat).sunk, true);
  // A wanderer's skiff is never hit.
  assert.equal(cannons.hitHull('boat:w-aabbccdd'), null);
});

test('a hull bar is a square a life for a rowing boat and one bar for a galleon', async () => {
  globalThis.document = globalThis.document || { createElement: () => ({}) };
  const { register } = await import('node:module');
  register('./support/shared-loader.mjs', import.meta.url);
  const { hullSegments } = await import('../web/js/hull-bars.js');
  assert.deepEqual(hullSegments(0, 2), [1, 1]);
  assert.deepEqual(hullSegments(1, 2), [1, 0]);
  assert.deepEqual(hullSegments(2, 5), [0.6]);
});

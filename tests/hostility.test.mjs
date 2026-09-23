import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalk } from '../shared/settlerwalk.mjs';
import { createHostility, GUARD_SPEED } from '../lib/hostility.mjs';
import { createHealth } from '../lib/health.mjs';
import { createRoster } from '../lib/players.mjs';

// `coast`, when given, is the local x beyond which the island is sea: ground at 1 on the
// near side, sea bed at -2 on the far side - deep enough that a guard's feet on the bottom
// are well over a metre below a swimmer's.
function setup({ coast = null } = {}) {
  let time = 1000;
  const height = (x) => (coast == null || x < coast ? 1 : -2);
  const cellWorld = (x, z) => [x - 15.5, z - 15.5];
  const terrain = { size: 32, half: 16, seed: 1, slope: () => 0,
    isLand: (gx, gz) => height(cellWorld(gx, gz)[0]) >= 0, worldHeight: (x) => height(x), cellWorld };
  const village = { buildings: [], districts: [] };
  const walk = createWalk(terrain, village);
  const f = walk.spawn('guard', { plot: { gx: 15, gz: 15, w: 3, d: 3, rot: 0 } }, [0, 0, 0]);
  const crowd = { id: 'enemy', walk, figures: walk.figures };
  const enemy = { id: 'enemy', terrain, origin: [-80, 20], bundle: { island: { hostile: true, name: 'Codex' } } };
  const home = { id: 'home', terrain, origin: [150, -40], bundle: { island: { town: { centre: [16, 16] } } } };
  const islands = new Map([['enemy', enemy], ['home', home]]);
  const p = { id: 'visitor', island: 'home', walking: true, x: -76, y: 1, z: 20, f: 0 };
  const evictions = [];
  let boats = [];
  const roster = { all: () => [p], boats: { snapshot: () => boats }, evict(player, at, name, boat) {
    evictions.push({ at, name, ...(boat ? { boat } : {}) }); [player.x, player.y, player.z] = at;
  } };
  const fleet = { all: () => [...islands.values()], get: id => islands.get(id) };
  const health = createHealth({ fleet, roster, now: () => time });
  const hostility = createHostility({ fleet, crowds: { get: id => id === 'enemy' ? crowd : null }, roster, health, now: () => time });
  return { f, p, walk, enemy, evictions, tick() { time += 50; hostility.tick(); health.tick(); walk.advance(1); },
    boats: value => { boats = value; } };
}

test('hostile residents pursue a landed visitor and send them to their displaced home', () => {
  const s = setup(), start = [...s.f.pos];
  for (let i = 0; i < 120 && !s.evictions.length; i++) s.tick();
  assert.notDeepEqual(s.f.pos, start, 'the resident actually walks toward the visitor');
  assert.equal(s.evictions.length, 1);
  assert.deepEqual(s.evictions[0], { at: [150.5, 1, -39.5], name: 'Codex' });
  s.tick();
  assert.equal(s.f.chartered, false, 'residents resume village life once the intruder leaves');
});

test('a guard runs at GUARD_SPEED while chasing, between a walk and a run', () => {
  assert.ok(GUARD_SPEED > 3.4 && GUARD_SPEED < 6.6, 'a sprint must outrun a guard and a walk must not');
  const s = setup(), before = s.f.speed;
  s.tick();
  assert.ok(s.f.chartered);
  assert.equal(s.f.speed, GUARD_SPEED);
  s.p.x = -110; s.tick();
  assert.equal(s.f.speed, before, 'a guard let go walks home at its own pace, not at a sprint');
});

// The island is nobody's: an islander whose own walker belongs to the hostile island is
// chased like anybody else, and is sent to that island's square.
test('a player whose island is the hostile one is a target too', () => {
  const s = setup();
  s.p.island = 'enemy';
  s.enemy.bundle.island.town = { centre: [16, 16] };
  for (let i = 0; i < 120 && !s.evictions.length; i++) s.tick();
  assert.equal(s.evictions.length, 1);
  assert.deepEqual(s.evictions[0], { at: [-79.5, 1, 20.5], name: 'Codex' });
});

test('orbiting players, players in a room, pilots and a friendly island do not trigger pursuit', () => {
  for (const change of [s => { s.p.walking = false; }, s => { s.p.room = 'tavern'; },
    s => { s.boats([{ pilot: 'visitor' }]); }, s => { s.enemy.bundle.island.hostile = false; }]) {
    const s = setup(); change(s); s.tick();
    assert.equal(s.f.chartered, false);
    assert.equal(s.evictions.length, 0);
  }
});

test('a visitor retreating to the sea releases the pursuing residents', () => {
  const s = setup(); s.tick(); assert.ok(s.f.chartered);
  s.p.x = -110; s.tick(); assert.equal(s.f.chartered, false);
});

// Land ends at local x = 1: cells 0..16 are dry, 17 and 18 are the strip a guard may
// swim, 19 and beyond are open water.
test('a swimmer just off the coast is chased through the water and caught', () => {
  const s = setup({ coast: 1 });
  Object.assign(s.p, { x: -80 + 2.4, y: -0.07, f: 2 });   // cell 18, swimming
  const route = [];
  for (let i = 0; i < 120 && !s.evictions.length; i++) { s.tick(); route.push(s.f.pos[0]); }
  assert.equal(s.evictions.length, 1, 'the swimmer in the strip was never caught');
  assert.ok(route.some(x => x >= 1), 'the guard actually went into the water after them');
  assert.ok(Math.max(...route) < 3, 'and not past the strip');
});

test('a swimmer further out than the strip is out of reach', () => {
  const s = setup({ coast: 1 });
  Object.assign(s.p, { x: -80 + 3.6, y: -0.07, f: 2 });   // cell 19
  for (let i = 0; i < 40; i++) s.tick();
  assert.equal(s.f.chartered, false);
  assert.equal(s.evictions.length, 0);
});

test('a swimmer who swims out past the strip releases the guard', () => {
  const s = setup({ coast: 1 });
  Object.assign(s.p, { x: -80 + 2.4, y: -0.07, f: 2 });
  s.tick(); assert.ok(s.f.chartered);
  s.p.x = -80 + 5; s.tick();
  assert.equal(s.f.chartered, false);
});

test('eviction updates the authoritative player and sends a private respawn message', () => {
  const messages = [];
  const roster = createRoster();
  const p = roster.attach({ id: 'aabbccdd', send: m => messages.push(JSON.parse(m)), close() {} }, { island: 'aaaaaaaa' });
  p.room = 'tavern'; p.f = 3;
  roster.evict(p, [110, 2, -20], 'Codex');
  assert.deepEqual([p.x, p.y, p.z, p.room, p.f], [110, 2, -20, null, 0]);
  assert.deepEqual(messages.at(-1), { t: 'evicted', x: 110, y: 2, z: -20, island: 'Codex' });
});

// A wanderer - the app on a phone - has no island to be sent home to, so the sea sends
// them back to their own skiff instead, and names it so the page climbs straight in.
test('a wanderer is caught and put back in their own skiff', () => {
  const s = setup();
  s.p.island = null;
  s.boats([{ id: 'boat:w-visitor', x: -120, z: 60, yaw: 0, pilot: null }]);
  for (let i = 0; i < 120 && !s.evictions.length; i++) s.tick();
  assert.equal(s.evictions.length, 1, 'a wanderer with a skiff was never caught');
  assert.deepEqual(s.evictions[0], { at: [-120, 0, 60], name: 'Codex', boat: 'boat:w-visitor' });
});

test('a wanderer with no skiff has nowhere to be sent and is left alone', () => {
  const s = setup();
  s.p.island = null;
  s.boats([{ id: 'boat:w-somebody-else', x: -120, z: 60, yaw: 0, pilot: null }]);
  for (let i = 0; i < 20; i++) s.tick();
  assert.equal(s.f.chartered, false);
  assert.equal(s.evictions.length, 0);
});

test('a caught player is immune for a moment and then fair game again', () => {
  const s = setup();
  for (let i = 0; i < 120 && !s.evictions.length; i++) s.tick();
  assert.equal(s.evictions.length, 1);
  // Put straight back in front of the guard: the five seconds hold.
  Object.assign(s.p, { x: -80 + s.f.pos[0], z: 20 + s.f.pos[1], y: s.f.y });
  for (let i = 0; i < 90; i++) s.tick();   // 4.5 s
  assert.equal(s.evictions.length, 1, 'caught again inside the immunity');
  for (let i = 0; i < 40 && s.evictions.length < 2; i++) s.tick();
  assert.equal(s.evictions.length, 2, 'never caught again after the immunity ran out');
});

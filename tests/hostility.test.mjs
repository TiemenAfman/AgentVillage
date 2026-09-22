import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalk } from '../shared/settlerwalk.mjs';
import { createHostility } from '../lib/hostility.mjs';
import { createRoster } from '../lib/players.mjs';

function setup() {
  let time = 1000;
  const terrain = { size: 32, half: 16, seed: 1, slope: () => 0,
    isLand: () => true, worldHeight: () => 1, cellWorld: (x, z) => [x - 15.5, z - 15.5] };
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
  const roster = { all: () => [p], boats: { snapshot: () => boats }, evict(player, at, name) {
    evictions.push({ at, name }); [player.x, player.y, player.z] = at;
  } };
  const hostility = createHostility({ fleet: { all: () => [...islands.values()], get: id => islands.get(id) },
    crowds: { get: id => id === 'enemy' ? crowd : null }, roster, now: () => time });
  return { f, p, walk, enemy, evictions, tick() { time += 50; hostility.tick(); walk.advance(1); },
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

test('home residents, orbiting players, swimmers and pilots do not trigger pursuit', () => {
  for (const change of [s => { s.p.island = 'enemy'; }, s => { s.p.walking = false; },
    s => { s.p.f = 2; }, s => { s.boats([{ pilot: 'visitor' }]); },
    s => { s.enemy.bundle.island.hostile = false; }]) {
    const s = setup(); change(s); s.tick();
    assert.equal(s.f.chartered, false);
    assert.equal(s.evictions.length, 0);
  }
});

test('a visitor retreating to the sea releases the pursuing residents', () => {
  const s = setup(); s.tick(); assert.ok(s.f.chartered);
  s.p.x = -110; s.tick(); assert.equal(s.f.chartered, false);
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

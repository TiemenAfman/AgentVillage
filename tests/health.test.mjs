import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealth, MAX_HEALTH, REGEN_AFTER_MS, REGEN_PER_S, IMMUNE_MS } from '../lib/health.mjs';

function setup(opts = {}) {
  let time = 10000;
  const terrain = { cellWorld: (x, z) => [x - 15.5, z - 15.5], worldHeight: () => 1.5 };
  const home = { id: 'home', terrain, origin: [150, -40], bundle: { island: { town: { centre: [16, 16] } } } };
  const islands = new Map([['home', home]]);
  const messages = [];
  const p = { id: 'visitor', island: 'home', x: 0, y: 1, z: 0, conn: { send: m => messages.push(JSON.parse(m)) } };
  let players = [p], boats = [];
  const evictions = [];
  const roster = { all: () => players, boats: { snapshot: () => boats }, evict(player, at, name, boat) {
    evictions.push({ at, name, ...(boat ? { boat } : {}) }); [player.x, player.y, player.z] = at;
  } };
  const health = createHealth({ fleet: { get: id => islands.get(id) }, roster, now: () => time, ...opts });
  return { health, p, home, evictions, messages,
    wait: ms => { time += ms; }, boats: v => { boats = v; }, players: v => { players = v; } };
}

const guard = { kind: 'guard', island: 'Codex' };

test('for now every hit sends an islander straight back to their own town square', () => {
  const s = setup();
  assert.equal(s.health.hurt(s.p, 1, guard), 'evicted');
  assert.deepEqual(s.evictions, [{ at: [150.5, 1.5, -39.5], name: 'Codex' }]);
  assert.equal(s.health.health(s.p), MAX_HEALTH, 'whole again at the square');
  // Nothing beyond the `evicted` the roster sends: the page never saw a lower number.
  assert.deepEqual(s.messages, []);
});

test('a wanderer is sent back to their own skiff, and one with no skiff cannot be hurt', () => {
  const s = setup();
  s.p.island = null;
  assert.equal(s.health.vulnerable(s.p), false);
  assert.equal(s.health.hurt(s.p, 1, guard), false);
  assert.equal(s.evictions.length, 0);
  s.boats([{ id: 'boat:w-somebody-else', x: 1, z: 1 }, { id: 'boat:w-visitor', x: -120, z: 60, yaw: 0, pilot: null }]);
  assert.equal(s.health.hurt(s.p, 1, guard), 'evicted');
  assert.deepEqual(s.evictions, [{ at: [-120, 0, 60], name: 'Codex', boat: 'boat:w-visitor' }]);
});

test('an islander whose home has no square and no landing cannot be hurt', () => {
  const s = setup();
  s.home.bundle.island.town = null;
  assert.equal(s.health.hurt(s.p, 1, guard), false);
  assert.equal(s.evictions.length, 0);
});

test('after being sent back, nothing lands for the immunity and then it does again', () => {
  const s = setup();
  s.health.hurt(s.p, 1, guard);
  s.wait(IMMUNE_MS - 1);
  assert.equal(s.health.immune(s.p.id), true);
  assert.equal(s.health.hurt(s.p, 1, guard), false);
  assert.equal(s.evictions.length, 1);
  s.wait(1);
  assert.equal(s.health.immune(s.p.id), false);
  assert.equal(s.health.hurt(s.p, 1, guard), 'evicted');
  assert.equal(s.evictions.length, 2);
});

// The arithmetic the health bar will run on, behind the switch that turns it on.
test('with the bar counting, a hit costs health and it comes back after quiet', () => {
  const s = setup({ oneHit: false });
  assert.equal(s.health.hurt(s.p, 40, guard), 'hurt');
  assert.equal(s.evictions.length, 0);
  assert.equal(s.health.health(s.p), 60);
  assert.deepEqual(s.messages.at(-1), { t: 'health', hp: 60, max: MAX_HEALTH, regenIn: REGEN_AFTER_MS, rate: REGEN_PER_S });
  s.wait(REGEN_AFTER_MS);
  assert.equal(s.health.health(s.p), 60, 'nothing back before the quiet is over');
  s.wait(1000);
  assert.equal(s.health.health(s.p), 60 + REGEN_PER_S);
  s.wait(60000);
  assert.equal(s.health.health(s.p), MAX_HEALTH, 'never more than whole');
});

test('any hurt is combat and starts the wait for regeneration again', () => {
  const s = setup({ oneHit: false });
  s.health.hurt(s.p, 30, guard);
  s.wait(REGEN_AFTER_MS - 500);
  s.health.hurt(s.p, 10, { kind: 'lava', island: 'Codex' });
  s.wait(REGEN_AFTER_MS - 1);
  assert.equal(s.health.health(s.p), 60, 'the second hit reset the quiet');
  s.wait(1001);
  assert.equal(s.health.health(s.p), 60 + REGEN_PER_S);
});

test('with the bar counting, the hit that empties it sends you back whole and says so', () => {
  const s = setup({ oneHit: false });
  s.health.hurt(s.p, 70, guard);
  assert.equal(s.health.hurt(s.p, 70, guard), 'evicted');
  assert.equal(s.evictions.length, 1);
  assert.equal(s.health.health(s.p), MAX_HEALTH);
  // The page was last told 30, so it has to hear that the body is whole again.
  assert.deepEqual(s.messages.at(-1), { t: 'health', hp: MAX_HEALTH, max: MAX_HEALTH, regenIn: 0, rate: REGEN_PER_S });
});

test('a player who leaves is forgotten, body and immunity both', () => {
  const s = setup({ oneHit: false });
  s.health.hurt(s.p, 10, guard);
  s.players([]);
  s.health.tick();
  s.players([s.p]);
  assert.equal(s.health.health(s.p), MAX_HEALTH);
});

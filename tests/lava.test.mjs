// Standing in the volcano's lava (lib/lava.mjs): who it hurts, through which door, and who
// it leaves alone. On the real volcano terrain, at a berth that is not the origin so that a
// mix-up between world and island-local coordinates cannot pass by accident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { volcanoTerrain, VOLCANO } from '../shared/volcano.mjs';
import { volcanoBundle } from '../lib/islandbundle.mjs';
import { createLava, LAVA_PER_S } from '../lib/lava.mjs';
import { createHealth } from '../lib/health.mjs';

const terrain = volcanoTerrain();
const bundle = volcanoBundle(terrain);
const ORIGIN = [300, -200];

// A lava cell halfway down the first flow, and a cell of plain flank well clear of it.
const course = terrain.lavaFlows[0];
const [lgx, lgz] = course.find(([gx, gz]) => terrain.isLava(gx, gz) && Math.abs(gx - terrain.half) > 20) || terrain.lavaCells[0];
const [safeGx, safeGz] = terrain.landCells.find(([gx, gz]) => {
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (terrain.isLava(gx + dx, gz + dz)) return false;
  return terrain.heightAt(gx, gz) > 1;
});
const at = (gx, gz) => {
  const [x, z] = terrain.cellWorld(gx, gz);
  return { x: x + ORIGIN[0], z: z + ORIGIN[1], y: terrain.worldHeight(x, z) };
};

function setup({ deck = 0 } = {}) {
  let time = 1000;
  const volcano = { id: VOLCANO.id, sea: true, bundle, terrain, origin: ORIGIN };
  const home = { id: 'home', origin: [0, 400], terrain: { cellWorld: (gx, gz) => [gx, gz], worldHeight: () => 1 },
    bundle: { island: { town: { centre: [2, 3] } } } };
  const islands = new Map([[volcano.id, volcano], ['home', home]]);
  const fleet = { all: () => [...islands.values()], get: (id) => islands.get(id) };
  const crowd = { walk: { groundOrDeck: (x, z) => terrain.worldHeight(x, z) + deck } };
  const p = { id: 'walker', island: 'home', walking: true, posed: true, room: null, f: 0, ...at(lgx, lgz) };
  const evictions = [];
  let boats = [];
  const roster = { all: () => [p], boats: { snapshot: () => boats },
    evict(player, where, name) { evictions.push({ where, name }); [player.x, player.y, player.z] = where; } };
  const health = createHealth({ fleet, roster, now: () => time });
  const hurts = [];
  const spy = { hurt: (...a) => { hurts.push(a); return health.hurt(...a); } };
  const lava = createLava({ fleet, crowds: { get: (id) => (id === VOLCANO.id ? crowd : null) }, roster, health: spy, now: () => time });
  return { p, evictions, hurts, lava, boats: (v) => { boats = v; }, tick() { time += 100; return lava.tick(); } };
}

test('a walker with their feet in the lava is hurt, as lava, and sent home', () => {
  assert.ok(terrain.isLava(lgx, lgz));
  const s = setup();
  assert.equal(s.tick(), 1);
  assert.equal(s.hurts.length, 1);
  const [who, amount, cause] = s.hurts[0];
  assert.equal(who, s.p);
  assert.deepEqual(cause, { kind: 'lava', island: 'De Vulkaan' });
  assert.ok(amount > 0 && amount <= LAVA_PER_S);
  assert.deepEqual(s.evictions, [{ where: [2, 1, 403], name: 'De Vulkaan' }]);
  // Home, and immune there for a moment: the next beats burn nobody.
  Object.assign(s.p, at(lgx, lgz));
  assert.equal(s.tick(), 0);
});

test('the flank beside it, a pilot, a room, a jump and a walker with no pose yet are all left alone', () => {
  for (const change of [
    (s) => Object.assign(s.p, at(safeGx, safeGz)),
    (s) => s.boats([{ id: 'boat:x', pilot: 'walker' }]),
    (s) => { s.p.room = 'tavern'; },
    (s) => { s.p.y += 2; },
    (s) => { s.p.walking = false; },
    (s) => { s.p.posed = false; },
  ]) {
    const s = setup();
    change(s);
    assert.equal(s.tick(), 0);
    assert.equal(s.hurts.length, 0);
    assert.equal(s.evictions.length, 0);
  }
});

test('a deck or a bridge over the lava carries whoever stands on it', () => {
  const s = setup({ deck: 0.6 });
  s.p.y += 0.6;
  assert.equal(s.tick(), 0);
  assert.equal(s.evictions.length, 0);
});

test('an island with no lava costs the check nothing and hurts nobody', () => {
  const hurts = [];
  const lava = createLava({
    fleet: { all: () => [{ id: 'x', origin: [0, 0], terrain: { lavaCells: [] }, bundle: { island: {} } }] },
    crowds: { get: () => null },
    roster: { all: () => [{ id: 'p', walking: true, x: 0, y: 0, z: 0 }], boats: { snapshot: () => [] } },
    health: { hurt: (...a) => hurts.push(a) },
  });
  assert.equal(lava.tick(), 0);
  assert.equal(hurts.length, 0);
});

// A route from above (web/js/body-route.js planRoute, walk.js goTo) walked by the real walk mode
// through a street of real houses (buildings.js), each on a residential plot's free angle - which is
// how a house stands on the island, and what made a route run into one and stop ("routing loopt tegen
// een huis aan en stopt", 8 October 2026): every cell middle on the way was free, but a turned wall's
// corner reached in between two of them. And a long route is ridden: on the horse at its start, off it
// at its end (Plans/paard-in-plaats-van-fiets.md "Van boven op pad").
// The walk-mode harness is tests/walk-solids.test.mjs's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = {
  createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop,
  pointerLockElement: null, exitPointerLock: noop,
};
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
const { createWalkMode } = await import('../web/js/walk.js');
const { solidAt, porchFloor } = await import('../web/js/solids.js');
const { buildBuilding } = await import('../web/js/buildings.js');
const { normalizeAvatar } = await import('../web/js/avatar.js');
const { planRoute, RIDE_FROM } = await import('../web/js/body-route.js');
const { MOUNT_TOP } = await import('../web/js/mount.js');
const { findPath } = await import('shared/settlerwalk.mjs');

const FRAME = 1 / 30;
const GROUND = 0.1;
const SIZE = 48, HALF = SIZE / 2;

// Flat dry ground, the island's own cell arithmetic.
const terrain = {
  size: SIZE, half: HALF,
  cellWorld: (gx, gz) => [gx - HALF + 0.5, gz - HALF + 0.5],
  inGrid: (gx, gz) => gx >= 0 && gz >= 0 && gx < SIZE && gz < SIZE,
  isLand: () => true,
  slope: () => 0,
  worldHeight: () => GROUND,
};

// A village: houses on 3 x 3 plots with a street of one cell between them, each turned by a free
// angle of its own (9 to 25 degrees either way, as the residential plots have them) - main.js
// blockersOf's walls and porchOf's floors, built from the real buildings.
function village(seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blockers = [];
  for (let bx = -HALF + 4; bx <= HALF - 6; bx += 4) {
    for (let bz = -HALF + 4; bz <= HALF - 6; bz += 4) {
      const built = buildBuilding({ id: `house:${bx}:${bz}`, kind: 'house', tier: 'house', style: 'claude' }, {});
      const deg = (9 + rnd() * 16) * (rnd() < 0.5 ? -1 : 1);
      const yaw = (deg * Math.PI) / 180 + Math.floor(rnd() * 4) * (Math.PI / 2);
      const where = { x: bx + 1.5, z: bz + 1.5, y: GROUND, yaw };
      for (const r of built.solids) blockers.push(solidAt(r, where));
      if (built.porch) blockers.push(...porchFloor(built.porch, where));
    }
  }
  return blockers;
}

function walker(blockers, at, character = 'traveller') {
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1, 0.5, 1000),
    terrain: { half: HALF, size: SIZE, worldHeight: () => GROUND },
    ground: { height: () => GROUND, bedAt: () => GROUND, regionAt: () => null, levelKey: () => null },
    material: new THREE.MeshBasicMaterial(), avatar: typeof character === 'string' ? normalizeAvatar({ character }) : character, bikes: true,
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
  });
  walk.park({ at, blockers });
  for (let i = 0; i < 5; i++) walk.update(FRAME);
  return walk;
}

// Walk a route until it is done (or `seconds` are up); what happened on the way.
function walkRoute(walk, seconds, watch = null) {
  for (let i = 0; i < seconds / FRAME; i++) {
    walk.update(FRAME);
    if (watch) watch(walk.state);
    if (!walk.state.route && !walk.state.bike && !walk.state.mount) break;
  }
  return walk.state;
}

// The route as it was before (main.js walkBodyTo, 0.11): a cell blocked where no spot in it is free,
// and nothing asked of the way between two of them.
const SPOTS = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3]];
function oldRoute(walk, to) {
  const cell = (x, z) => [Math.floor(x + HALF), Math.floor(z + HALF)];
  const spot = new Map();
  const blocked = { has(k) {
    const [cx, cz] = terrain.cellWorld(k % SIZE, Math.floor(k / SIZE));
    for (const [ox, oz] of SPOTS) if (!walk.blockedAt(cx + ox, cz + oz)) { spot.set(k, [cx + ox, cz + oz]); return false; }
    return true;
  } };
  const path = findPath(terrain, cell(walk.state.pos.x, walk.state.pos.z), cell(to[0], to[1]), blocked);
  if (!path) return null;
  const pts = path.slice(1).map(([x, z]) => spot.get(Math.floor(x + HALF) + Math.floor(z + HALF) * SIZE) || [x, z]);
  if (!walk.blockedAt(to[0], to[1])) pts.push(to);
  return pts;
}

// Every street crossing to every other one far enough off: the trips a click from above makes.
function trips() {
  const xs = [];
  for (let c = -HALF + 3.5; c <= HALF - 3; c += 4) xs.push(c);
  const out = [];
  for (const ax of xs) for (const az of xs) for (const bx of xs) for (const bz of xs) {
    if (Math.abs(ax - bx) + Math.abs(az - bz) >= 16 && (ax * 7 + az * 3 + bx + bz * 5) % 3 === 0) out.push([[ax, az], [bx, bz]]);
  }
  return out;
}

test('the old route ran into a turned house and stopped; the new one gets there', () => {
  const blockers = village(3);
  let oldStuck = 0, newStuck = 0, tried = 0;
  for (const [from, to] of trips().slice(0, 80)) {
    let walk = walker(blockers, from);
    const start = [walk.state.pos.x, walk.state.pos.z];
    const pts = oldRoute(walk, to);
    if (!pts) continue;
    tried++;
    walk.goTo(pts);
    let s = walkRoute(walk, 60);
    if (Math.hypot(s.pos.x - to[0], s.pos.z - to[1]) > 0.3) oldStuck++;
    walk = walker(blockers, from);
    const route = planRoute(terrain, start, to, walk.blockedAt);
    assert.ok(route, `no route from ${from} to ${to}`);
    walk.goTo(route.points);
    s = walkRoute(walk, 60);
    if (Math.hypot(s.pos.x - to[0], s.pos.z - to[1]) > 0.3) newStuck++;
  }
  assert.ok(tried >= 30, `only ${tried} trips`);
  assert.ok(oldStuck > 0, 'the old route never stuck - the test no longer reproduces the bug');
  assert.equal(newStuck, 0);
});

// main.js walkBodyTo's loop in small: plan, walk, and on getting stuck plan again from where the
// body stands round the cell it could not get into.
function goWalk(walk, to, { ride = null, replans = 3 } = {}) {
  const log = { stuck: 0, gaveUp: false };
  const go = (avoid, tries) => {
    const route = planRoute(terrain, [walk.state.pos.x, walk.state.pos.z], to, walk.blockedAt, { avoid });
    if (!route) { log.gaveUp = true; return false; }
    return walk.goTo(route.points, {
      ride: ride ?? route.cells >= RIDE_FROM,
      onStuck: ({ next }) => {
        log.stuck++;
        if (tries >= replans) { log.gaveUp = true; return; }
        const again = new Set(avoid || []);
        again.add(Math.floor(next[0] + HALF) + Math.floor(next[1] + HALF) * SIZE);
        go(again, tries + 1);
      },
    });
  };
  log.started = go(null, 0);
  return log;
}

test('a body held up by something the route did not know of plans again and gets there', () => {
  const blockers = village(3);
  const walk = walker([], [-20.5, -12.5]);
  const to = [-4.5, -12.5];
  const log = goWalk(walk, to, { ride: false });
  assert.ok(log.started);
  // The street it was planned along is not the street it finds: the village stands now, and a cart
  // across the way at x -12.5.
  walk.setBlockers([...blockers, { x: -12.5, z: -12.5, hx: 0.2, hz: 0.6 }]);
  const s = walkRoute(walk, 60);
  assert.ok(log.stuck >= 1, 'was never held up - the test does not test a replan');
  assert.equal(log.gaveUp, false);
  assert.ok(Math.hypot(s.pos.x - to[0], s.pos.z - to[1]) < 0.3, `stopped at ${s.pos.x.toFixed(2)}, ${s.pos.z.toFixed(2)}`);
});

test('a body walled in gives up instead of pushing at the wall for ever', () => {
  const walk = walker([], [-20.5, -12.5]);
  const to = [0.5, 0.5];
  const log = goWalk(walk, to, { ride: false });
  assert.ok(log.started);
  // A pen round the point it was going to.
  walk.setBlockers([
    { x: 0.5, z: -1.5, hx: 2.2, hz: 0.2 }, { x: 0.5, z: 2.5, hx: 2.2, hz: 0.2 },
    { x: -1.5, z: 0.5, hx: 0.2, hz: 2.2 }, { x: 2.5, z: 0.5, hx: 0.2, hz: 2.2 },
  ]);
  walkRoute(walk, 60);
  assert.equal(log.gaveUp, true);
  assert.equal(walk.state.route, null);
  // And with the pen known from the start there is no route at all.
  assert.equal(planRoute(terrain, [walk.state.pos.x, walk.state.pos.z], to, walk.blockedAt), null);
});

// A long route ridden: on at the start, a gallop on the way, off at the end where it was going.
function ride(character, check, label = character) {
  const blockers = village(3);
  let rides = 0;
  for (const [from, to] of trips().slice(0, 24)) {
    const walk = walker(blockers, from, character);
    const route = planRoute(terrain, [walk.state.pos.x, walk.state.pos.z], to, walk.blockedAt);
    if (!route || route.cells < RIDE_FROM) continue;
    rides++;
    goWalk(walk, to);
    let mountedAt = -1, frames = 0, top = 0, offEarly = false, wasOn = false;
    const s = walkRoute(walk, 90, (st) => {
      frames++;
      const r = st.mount || st.bike;
      if (r && mountedAt < 0) mountedAt = frames;
      if (r) { top = Math.max(top, r.v); check(st); wasOn = true; }
      else if (wasOn && st.route && st.route.length > 1) offEarly = true;
    });
    assert.ok(mountedAt >= 0 && mountedAt <= 2, `${label} did not get on at the start (${mountedAt})`);
    assert.equal(offEarly, false, `${label} got off on the way from ${from} to ${to}`);
    assert.ok(!s.mount && !s.bike, `${label} still riding at the end`);
    assert.ok(Math.hypot(s.pos.x - to[0], s.pos.z - to[1]) < 0.3, `${label} stopped at ${s.pos.x.toFixed(2)}, ${s.pos.z.toFixed(2)}, not ${to}`);
    if (character !== 'traveller') assert.ok(top > MOUNT_TOP * 1.2, `${label} never galloped: ${top.toFixed(2)}`);
  }
  assert.ok(rides >= 10, `only ${rides} long routes`);
}

test('a long route is ridden by the Adventurer: on the horse, a gallop on the straights, off at the end', () => {
  ride('adventurer', (s) => assert.ok(s.mount && !s.bike));
});

test('the Wanderer rides a horse too, the Traveller his bicycle', () => {
  const wanderer = normalizeAvatar({ character: 'adventurer', body: 'female' });
  assert.equal(wanderer.character, 'adventurer');
  ride(wanderer, (s) => assert.ok(s.mount && !s.bike), 'the Wanderer');
  ride('traveller', (s) => assert.ok(s.bike && !s.mount));
});

test('a short route is walked', () => {
  const blockers = village(3);
  const walk = walker(blockers, [-20.5, -12.5], 'adventurer');
  const to = [-16.5, -8.5];
  const route = planRoute(terrain, [walk.state.pos.x, walk.state.pos.z], to, walk.blockedAt);
  assert.ok(route.cells < RIDE_FROM);
  goWalk(walk, to);
  const s = walkRoute(walk, 30, (st) => assert.ok(!st.mount && !st.bike, 'got on a horse for a few steps'));
  assert.ok(Math.hypot(s.pos.x - to[0], s.pos.z - to[1]) < 0.3);
});

test('others see a rider on a route from above riding, never asleep', async () => {
  // net.js sends FLAG_RIDING off `bike || mount` whether the body is driven by keys or from above, and
  // FLAG_ASLEEP only for a parked body with no route: a horse reining in for a corner is not asleep.
  const { readFileSync } = await import('node:fs');
  const net = readFileSync(new URL('../web/js/net.js', import.meta.url), 'utf8');
  assert.match(net, /\(s\.bike \|\| s\.mount \? FLAG_RIDING : 0\)/);
  assert.match(net, /\(s\.parked && !s\.route && !s\.moving \? FLAG_ASLEEP : 0\)/);
  const walk = walker(village(3), [-20.5, -12.5], 'adventurer');
  goWalk(walk, [19.5, -12.5]);
  walk.update(FRAME);
  assert.ok(walk.state.mount && walk.state.parked && walk.state.route, 'not riding a route');
});

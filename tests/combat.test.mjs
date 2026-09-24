// Fighting on the volcano, the sea's half (step 7 of Plans/vulkaan-in-het-midden.md): a
// guard's blow with its cooldown, its reach and a shield in the way; a player's swing with
// its own cooldown, arc and reach; agents with health who fall and come back through the
// running crowd. No loader and no document: all of this is the sea's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalk } from '../shared/settlerwalk.mjs';
import { VOLCANO, GUARDS, volcanoTerrain, codexId } from '../shared/volcano.mjs';
import { crowdRoster } from '../shared/settlerwire.mjs';
import { volcanoBundle } from '../lib/islandbundle.mjs';
import {
  createHostility, GUARD_HIT, RESIDENT_HIT, GUARD_REACH, GUARD_SWING_MS, GUARD_WINDUP_MS, REACH_SLACK, MAX_ATTACKERS,
  BLOCK_FRACTION, SHIELD_ARMOR, inFront, armorOf,
} from '../lib/hostility.mjs';
import { createHealth, MAX_HEALTH } from '../lib/health.mjs';
import { createCombat, AGENT_HEALTH, PLAYER_HIT, SWING_MS, SWING_REACH } from '../lib/combat.mjs';
import { createRoster, POSE } from '../lib/players.mjs';
import { createCrowds } from '../lib/crowd.mjs';
import { createGuards } from '../lib/guards.mjs';
import { createResidents } from '../lib/residents.mjs';
import { createSea } from '../lib/sea.mjs';

// The heading a pose carries: web/js/walk.js faces (sin yaw, cos yaw).
const yawTowards = (dx, dz) => Math.atan2(dx, dz);

// ---- a guard's blow -----------------------------------------------------------------------
//
// hostility.test.mjs's flat island: one figure at the middle of a hostile island at a berth
// that is not the origin, and a player standing right in front of it.
function brawl({ id = 'guard:0', flags = 0, facing = true, more = 0 } = {}) {
  let time = 1000;
  const cellWorld = (x, z) => [x - 15.5, z - 15.5];
  const terrain = { size: 32, half: 16, seed: 1, slope: () => 0, isLand: () => true, worldHeight: () => 1, cellWorld };
  const walk = createWalk(terrain, { buildings: [], districts: [] });
  const f = walk.spawn(id, { plot: { gx: 15, gz: 15, w: 3, d: 3, rot: 0 } }, [0, 0, 0]);
  // `more` guards standing on the first one's spot, every one of them in reach.
  for (let i = 1; i <= more; i++) {
    const g = walk.spawn(`guard:${i}`, { plot: { gx: 15, gz: 15, w: 3, d: 3, rot: 0 } }, [0, 0, 0]);
    g.pos[0] = f.pos[0]; g.pos[1] = f.pos[1];
  }
  const crowd = { id: 'enemy', walk, figures: walk.figures };
  const enemy = { id: 'enemy', terrain, origin: [-80, 20], bundle: { island: { hostile: true, name: 'De Vulkaan' } } };
  const home = { id: 'home', terrain, origin: [150, -40], bundle: { island: { town: { centre: [16, 16] } } } };
  const islands = new Map([['enemy', enemy], ['home', home]]);
  // Beside the figure, 0.4 along +x, facing it (or away).
  const p = { id: 'visitor', island: 'home', walking: true, posed: true, f: flags,
    x: -80 + f.pos[0] + 0.4, y: 1, z: 20 + f.pos[1], yaw: facing ? yawTowards(-1, 0) : yawTowards(1, 0) };
  const evictions = [];
  const roster = { all: () => [p], boats: { snapshot: () => [] }, evict(player, at) { evictions.push(at); [player.x, player.y, player.z] = at; } };
  const fleet = { all: () => [...islands.values()], get: (i) => islands.get(i) };
  const health = createHealth({ fleet, roster, now: () => time });
  const blows = [];
  const spy = { ...health, hurt: (who, amount, cause) => {
    blows.push({ at: time, amount, cause, d: Math.hypot(who.x - (-80 + f.pos[0]), who.z - (20 + f.pos[1])) });
    return health.hurt(who, amount, cause);
  } };
  const swings = [];
  const broadcast = (m) => swings.push({ ...m, at: time });
  const hostility = createHostility({ fleet, crowds: { get: (i) => (i === 'enemy' ? crowd : null) }, roster, health: spy, broadcast, now: () => time });
  const s = { f, p, blows, swings, evictions, health, tick() { time += 50; hostility.tick(); health.tick(); walk.advance(1); } };
  // Beats until the first blow has landed (its wind-up included), and that blow.
  s.first = () => { for (let i = 0; i < 40 && !blows.length; i++) s.tick(); return blows[0]; };
  return s;
}

test('a guard swing is announced to everybody and lands GUARD_WINDUP_MS later', () => {
  const s = brawl();
  s.tick();
  assert.deepEqual(s.swings.map(({ t, a, i, id }) => ({ t, a, i, id })), [{ t: 'agent', a: 'swing', i: 'enemy', id: 'guard:0' }]);
  assert.equal(s.blows.length, 0, 'the blow landed with the announcement: no swing to see before it hurts');
  const b = s.first();
  const late = b.at - s.swings[0].at;
  assert.ok(late >= GUARD_WINDUP_MS && late < GUARD_WINDUP_MS + 100, `the blow landed ${late} ms after the swing`);
});

test('no more than MAX_ATTACKERS swing at one player, and it stays the same ones', () => {
  const s = brawl({ more: 5 });
  s.tick();
  assert.equal(MAX_ATTACKERS, 3);
  assert.equal(s.swings.length, MAX_ATTACKERS, `${s.swings.length} guards swung at once`);
  const first = new Set(s.swings.map((w) => w.id));
  for (let i = 0; i < Math.ceil(GUARD_SWING_MS / 50) + 2; i++) s.tick();
  assert.equal(s.swings.length, 2 * MAX_ATTACKERS, 'the second round was not three swings');
  assert.deepEqual(new Set(s.swings.slice(MAX_ATTACKERS).map((w) => w.id)), first, 'the ring traded places');
});

test('stepping out of reach during the wind-up makes the blow miss', () => {
  const s = brawl();
  s.tick();
  assert.equal(s.swings.length, 1);
  s.p.x += GUARD_REACH + REACH_SLACK + 0.2;
  for (let i = 0; i < 14; i++) s.tick();
  assert.equal(s.blows.length, 0, 'a blow followed somebody who had already stepped away');
});

test('a guard in reach swings once per GUARD_SWING_MS, not once per beat, and it takes ten blows to send you back', () => {
  const s = brawl();
  for (let i = 0; i < 400 && !s.evictions.length; i++) s.tick();
  const need = Math.ceil(MAX_HEALTH / GUARD_HIT);
  assert.equal(need, 10);
  assert.equal(s.evictions.length, 1, 'never sent back');
  assert.equal(s.blows.length, need, `${s.blows.length} blows landed`);
  for (const b of s.blows) assert.equal(b.amount, GUARD_HIT);
  assert.ok(s.blows.every((b) => b.cause.kind === 'guard'));
  for (let i = 1; i < need; i++) {
    const gap = s.blows[i].at - s.blows[i - 1].at;
    assert.ok(gap >= GUARD_SWING_MS && gap < GUARD_SWING_MS + 100, `the blows came ${gap} ms apart`);
  }
  assert.equal(s.health.health(s.p), MAX_HEALTH, 'whole again at the square');
});

test('a guard only lands a blow within its reach', () => {
  const s = brawl();
  // Start out of reach: the guard has to walk up before anything lands.
  s.p.x += 1.5;
  for (let i = 0; i < 80; i++) s.tick();
  assert.ok(s.blows.length > 0, 'the guard never got there');
  for (const b of s.blows) assert.ok(b.d < GUARD_REACH + REACH_SLACK, `a blow landed from ${b.d.toFixed(2)} away`);
});

test('a raised shield facing the guard takes seventy per cent off; turned away, or in the water, it does not', () => {
  const up = brawl({ flags: POSE.BLOCKING });
  up.first();
  assert.equal(up.blows.length, 1);
  assert.ok(Math.abs(up.blows[0].amount - GUARD_HIT * BLOCK_FRACTION) < 1e-9);
  assert.ok(Math.abs(up.health.health(up.p) - (MAX_HEALTH - GUARD_HIT * BLOCK_FRACTION)) < 1e-9);
  for (const s of [brawl({ flags: POSE.BLOCKING, facing: false }), brawl({ flags: POSE.BLOCKING | POSE.SWIMMING }), brawl()]) {
    assert.equal(s.first().amount, GUARD_HIT);
  }
});

test('a shield raised during the wind-up still catches the blow', () => {
  const s = brawl();
  s.tick();
  s.p.f = POSE.BLOCKING;
  assert.ok(Math.abs(s.first().amount - GUARD_HIT * BLOCK_FRACTION) < 1e-9);
});

test('a shield carried is armour, and two stack: raised or not, and a raised one on top', () => {
  assert.equal(armorOf({ f: 0 }), 0);
  assert.equal(armorOf({ f: POSE.SHIELD_LEFT }), SHIELD_ARMOR);
  assert.equal(armorOf({ f: POSE.SHIELD_RIGHT }), SHIELD_ARMOR);
  assert.equal(armorOf({ f: POSE.SHIELD_LEFT | POSE.SHIELD_RIGHT }), 2 * SHIELD_ARMOR);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(brawl({ flags: POSE.SHIELD_LEFT }).first().amount, GUARD_HIT * (1 - SHIELD_ARMOR)));
  const two = POSE.SHIELD_LEFT | POSE.SHIELD_RIGHT;
  assert.ok(near(brawl({ flags: two }).first().amount, GUARD_HIT * (1 - 2 * SHIELD_ARMOR)));
  assert.ok(near(brawl({ flags: two | POSE.BLOCKING }).first().amount, GUARD_HIT * (1 - 2 * SHIELD_ARMOR) * BLOCK_FRACTION));
  // Two shields and the arm up still hurt: armour takes the edge off, it does not make a wall.
  assert.ok(GUARD_HIT * (1 - 2 * SHIELD_ARMOR) * BLOCK_FRACTION > 0);
});

test('a Codex resident hits softer than a guard', () => {
  assert.ok(RESIDENT_HIT > 0 && RESIDENT_HIT < GUARD_HIT);
  const s = brawl({ id: codexId('aaaaaaaaaaaaaaaa', 'house:s1') });
  assert.equal(s.first().amount, RESIDENT_HIT);
});

test('the front arc is sixty degrees either side of the pose heading', () => {
  const p = { x: 10, z: 10, yaw: 0 };                                  // facing +z
  const at = (deg, r = 0.5) => [10 + Math.sin(deg * Math.PI / 180) * r, 10 + Math.cos(deg * Math.PI / 180) * r];
  assert.ok(inFront(p, ...at(0)));
  assert.ok(inFront(p, ...at(59)));
  assert.ok(inFront(p, ...at(-59)));
  assert.ok(!inFront(p, ...at(61)));
  assert.ok(!inFront(p, ...at(180)));
  assert.ok(inFront({ ...p, yaw: Math.PI / 2 }, 11, 10), 'yaw a quarter turn faces +x');
});

// ---- a player's swing ---------------------------------------------------------------------

function arena({ hostile = true } = {}) {
  let time = 5000;
  const figures = new Map();
  const island = { id: 'enemy', origin: [100, -50], bundle: { island: { hostile } } };
  const crowd = { id: 'enemy', figures };
  const add = (id, lx, lz, y = 1) => { const f = { id, pos: [lx, lz], y, visible: true, dead: false }; figures.set(id, f); return f; };
  // Standing at the island's middle, facing +z.
  const p = { id: 'hero', walking: true, posed: true, room: null, f: 0, x: 100, y: 1, z: -50, yaw: 0 };
  let boats = [];
  const roster = { all: () => [p], boats: { snapshot: () => boats } };
  const died = [];
  const fall = (id) => { const f = figures.get(id); if (!f || f.dead) return false; f.dead = true; f.visible = false; died.push(id); return true; };
  const said = [];
  const combat = createCombat({
    fleet: { all: () => [island] }, crowds: { get: (i) => (i === 'enemy' ? crowd : null) }, roster,
    guards: { guardDied: fall }, residents: { died: fall }, broadcast: (m) => said.push(m), now: () => time,
  });
  return { combat, p, add, died, said, later: (ms) => { time += ms; }, boats: (v) => { boats = v; } };
}

test('four swings fell a guard: flat damage, said to everybody, the last one through guardDied', () => {
  assert.equal(AGENT_HEALTH / PLAYER_HIT, 4);
  const s = arena();
  s.add('guard:3', 0, 0.5);
  for (let i = 0; i < 4; i++) { assert.equal(s.combat.swing(s.p), true); s.later(SWING_MS); }
  assert.deepEqual(s.said, [75, 50, 25, 0].map((hp) => ({ t: 'agent', a: 'hit', i: 'enemy', id: 'guard:3', hp, max: AGENT_HEALTH })));
  assert.deepEqual(s.died, ['guard:3']);
  assert.equal(s.combat.swing(s.p), false, 'nobody left to hit');
  assert.equal(s.said.length, 4, 'a swing at nothing says nothing');
});

test('a swing is rate limited per player, and one at nothing still spends it', () => {
  const s = arena();
  s.add('guard:0', 0, 0.5);
  assert.equal(s.combat.swing(s.p), true);
  s.later(SWING_MS - 1);
  assert.equal(s.combat.swing(s.p), false);
  s.later(1);
  assert.equal(s.combat.swing(s.p), true);
  assert.equal(s.said.length, 2);
  s.p.yaw = Math.PI;                    // turned away: a swing at the air
  s.later(SWING_MS);
  assert.equal(s.combat.swing(s.p), false);
  s.p.yaw = 0;
  s.later(SWING_MS - 1);
  assert.equal(s.combat.swing(s.p), false, 'the swing at the air was a swing');
});

test('a swing reaches SWING_REACH, in the front arc, and takes the nearest', () => {
  const s = arena();
  const far = s.add('guard:0', 0, SWING_REACH + 0.05);
  assert.equal(s.combat.swing(s.p), false, 'out of reach');
  far.pos = [0, SWING_REACH - 0.05];
  const side = s.add('guard:1', Math.sin(1.1) * 0.5, Math.cos(1.1) * 0.5);   // 63 degrees off
  s.later(SWING_MS);
  assert.equal(s.combat.swing(s.p), true);
  assert.equal(s.said.at(-1).id, 'guard:0', 'the one outside the arc was hit');
  s.add('codex:aaaaaaaaaaaaaaaa:house:s1', 0.1, 0.4);
  s.later(SWING_MS);
  s.combat.swing(s.p);
  assert.equal(s.said.at(-1).id, 'codex:aaaaaaaaaaaaaaaa:house:s1', 'not the nearest');
  side.pos = [0, -0.3];                 // right behind
  s.later(SWING_MS);
  s.combat.swing(s.p);
  assert.notEqual(s.said.at(-1).id, 'guard:1');
});

test('only guards and Codex residents of a hostile island can be hit', () => {
  const calm = arena({ hostile: false });
  calm.add('guard:0', 0, 0.5);
  assert.equal(calm.combat.swing(calm.p), false);
  const s = arena();
  s.add('house:s3', 0, 0.5);            // an old islander's own hostile Codex island
  assert.equal(s.combat.swing(s.p), false);
  const f = s.add('guard:0', 0, 0.6, 3);
  s.later(SWING_MS);
  assert.equal(s.combat.swing(s.p), false, 'two metres up the slope is out of reach');
  f.y = 1; f.dead = true; f.visible = false;
  s.later(SWING_MS);
  assert.equal(s.combat.swing(s.p), false, 'a fallen guard is not there to hit');
  assert.equal(s.said.length, 0);
});

test('no swing in orbit, in a room, at a tiller, in the water, or before a pose', () => {
  for (const change of [
    (s) => { s.p.walking = false; }, (s) => { s.p.room = 'tavern'; }, (s) => s.boats([{ pilot: 'hero' }]),
    (s) => { s.p.f = POSE.SWIMMING; }, (s) => { s.p.posed = false; },
  ]) {
    const s = arena();
    s.add('guard:0', 0, 0.5);
    change(s);
    assert.equal(s.combat.swing(s.p), false);
    assert.equal(s.said.length, 0);
  }
});

test('a swing from behind a raised shield lands: one hand blocks while the other fights', () => {
  const s = arena();
  s.add('guard:0', 0, 0.5);
  s.p.f = POSE.BLOCKING | POSE.SHIELD_LEFT;
  assert.equal(s.combat.swing(s.p), true);
  assert.equal(s.said.length, 1);
});

test('the roster keeps BLOCKING, the shields and RIDING in a pose, drops what is above them, and hands a swing on', () => {
  const swung = [];
  const roster = createRoster({ swing: (p) => swung.push(p.id) });
  const p = roster.attach({ id: 'aabbccdd', send() {}, close() {} }, { island: 'aaaaaaaa' });
  roster.message(p.conn, JSON.stringify({ t: 'p', x: 1, y: 1, z: 1, yaw: 0.5, f: POSE.BLOCKING | POSE.MOVING }));
  assert.equal(p.f, 17);
  assert.equal(p.yaw, 0.5, 'the heading a swing is aimed by');
  roster.message(p.conn, JSON.stringify({ t: 'p', x: 1, y: 1, z: 1, yaw: 0, f: 256 | POSE.BLOCKING | POSE.SHIELD_LEFT | POSE.SHIELD_RIGHT }));
  assert.equal(p.f, POSE.BLOCKING | POSE.SHIELD_LEFT | POSE.SHIELD_RIGHT, 'the shields are kept, and nothing above them');
  // The bicycle is relayed as it is (Plans/fiets.md), so a peer can draw it.
  roster.message(p.conn, JSON.stringify({ t: 'p', x: 1, y: 1, z: 1, yaw: 0, f: POSE.RIDING | POSE.MOVING }));
  assert.equal(p.f, POSE.RIDING | POSE.MOVING);
  assert.equal(POSE.RIDING, 128);
  roster.message(p.conn, JSON.stringify({ t: 'swing', target: 'guard:0', hp: 0 }));
  assert.deepEqual(swung, ['aabbccdd']);
});

// ---- falling and coming back, on the real volcano ------------------------------------------

const terrain = volcanoTerrain();

// A pose beside `f`, facing it, from a side where it is the nearest agent in the swing's arc -
// the guards stand 0.35 apart in their rows, so some side of him has nobody closer. Worked
// out from where they actually stand rather than from where the guardhouse is today, which
// the lava flows may yet move.
function besideOf(crowd, f) {
  const r = 0.3;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    const pose = { x: f.pos[0] + dx * r, z: f.pos[1] + dz * r, y: f.y, yaw: yawTowards(-dx, -dz) };
    const rival = [...crowd.figures.values()].some((o) => o !== f && o.visible && !o.dead
      && Math.hypot(o.pos[0] - pose.x, o.pos[1] - pose.z) <= r + 1e-6 + 0.05 && inFront(pose, o.pos[0], o.pos[1]));
    if (!rival) return pose;
  }
  throw new Error(`nowhere to stand beside ${f.id}`);
}

function volcano() {
  let time = 1000;
  const bundle = volcanoBundle(terrain);
  const island = { id: VOLCANO.id, sea: true, live: true, bundle, raised: bundle.buildings, terrain, origin: [0, 0], half: terrain.half };
  const others = [];
  const fleet = {
    all: () => [island, ...others],
    get: (id) => (id === VOLCANO.id ? island : null),
    furnishVolcano: (houses) => { island.bundle = { ...island.bundle, buildings: [...island.raised, ...houses] }; return island; },
  };
  const crowds = createCrowds({ now: () => time });
  const crowd = crowds.join(island);
  const rosters = [];
  const onRoster = (c) => rosters.push(crowdRoster(c));
  const guards = createGuards({ fleet, crowds, now: () => time, onRoster });
  const residents = createResidents({ fleet, crowds, now: () => time, onRoster });
  const p = { id: 'hero', walking: true, posed: true, room: null, f: 0, x: 0, y: 0, z: 0, yaw: 0 };
  const said = [];
  const combat = createCombat({ fleet, crowds, roster: { all: () => [p], boats: { snapshot: () => [] } },
    guards, residents, broadcast: (m) => said.push(m), now: () => time });
  guards.tick();
  function faceUp(id) {
    const f = crowd.figures.get(id);
    Object.assign(p, besideOf(crowd, f));
    return f;
  }
  function fell(id) {
    faceUp(id);
    for (let i = 0; i < AGENT_HEALTH / PLAYER_HIT; i++) { combat.swing(p); time += SWING_MS; }
  }
  return {
    crowd, guards, residents, combat, rosters, said, faceUp, fell,
    join() { const i = { sea: false, live: true, bundle: { island: { hostile: false } } }; others.push(i); return i; },
    later(ms) { time += ms; },
  };
}

test('a guard beaten to nothing falls as a hole and is back out of the guardhouse after twenty seconds when below the target', () => {
  const s = volcano();
  assert.equal(s.crowd.guardsStanding(), GUARDS.BASE);
  s.fell('guard:0');
  assert.deepEqual(s.said.map((m) => m.hp), [75, 50, 25, 0]);
  assert.ok(s.said.every((m) => m.t === 'agent' && m.a === 'hit' && m.i === VOLCANO.id && m.id === 'guard:0' && m.max === AGENT_HEALTH));
  const g = s.crowd.figures.get('guard:0');
  assert.equal(g.dead, true);
  assert.equal(s.rosters.at(-1)[0], null, 'the roster carries a hole, not a rebuild');
  assert.equal(s.rosters.at(-1).length, GUARDS.BASE);
  assert.equal(s.guards.pending(), 1);
  s.later(GUARDS.RESPAWN_MS - SWING_MS * 4 - 1); s.guards.tick();
  assert.equal(g.dead, true);
  s.later(SWING_MS * 4 + 1); s.guards.tick();
  assert.equal(g.dead, false);
  assert.deepEqual(g.pos, g.door, 'back at his own place in front of the guardhouse');
  assert.equal(s.rosters.at(-1)[0], 'guard:0');
  // And whole: it takes four blows again.
  s.said.length = 0;
  s.fell('guard:0');
  assert.deepEqual(s.said.map((m) => m.hp), [75, 50, 25, 0]);
});

test('a guard who falls while there are more than the target stays down', () => {
  const s = volcano();
  const a = s.join();
  s.guards.tick();                         // 7 standing, target 7
  a.live = false;
  s.guards.tick();                         // target 4
  s.fell('guard:6');
  assert.equal(s.crowd.figures.get('guard:6').dead, true);
  assert.equal(s.guards.pending(), 0);
  s.later(GUARDS.RESPAWN_MS * 2); s.guards.tick();
  assert.equal(s.crowd.figures.get('guard:6').dead, true);
  assert.equal(s.crowd.guardsStanding(), 6);
});

test('a Codex resident beaten to nothing gets up at its own house twenty seconds later, and a list meanwhile does not raise it', () => {
  const s = volcano();
  const A = 'aaaaaaaaaaaaaaaa';
  const entry = (extra = {}) => ({ id: 'house:s0', style: 'unknown', tier: 'hut', kind: 'house', active: false, ...extra });
  s.residents.set(A, [entry()]);
  const fid = codexId(A, 'house:s0');
  const f = s.crowd.figures.get(fid);
  const door = [...f.door];
  const index = crowdRoster(s.crowd).indexOf(fid);
  assert.ok(index >= GUARDS.BASE, 'appended behind the guards');
  s.fell(fid);
  assert.equal(f.dead, true);
  assert.equal(s.residents.down(), 1);
  assert.equal(s.said.at(-1).hp, 0);
  const holed = s.rosters.at(-1);
  assert.equal(holed[index], null, 'a hole where the resident stood');
  assert.equal(holed.length, crowdRoster(s.crowd).length, 'nobody behind it renumbered');
  // The islander's next list marks the settler as at work: it stays down all the same.
  s.residents.set(A, [entry({ active: true })]);
  assert.equal(f.dead, true, 'a list brought a fallen resident back early');
  s.later(10000); s.residents.tick();
  assert.equal(f.dead, true);
  s.later(10000); s.residents.tick();
  assert.equal(f.dead, false);
  assert.equal(s.residents.down(), 0);
  assert.ok(Math.hypot(f.pos[0] - door[0], f.pos[1] - door[1]) < 1e-6, `got up at ${f.pos}, its door is ${door}`);
  assert.equal(s.rosters.at(-1)[index], fid, 'back under its own number');
  assert.equal(f.mode, 'hammer', 'and at work, as the list said while it lay there');
});

test('a resident whose islander drops it while it lies there does not get up at all', () => {
  const s = volcano();
  const A = 'aaaaaaaaaaaaaaaa';
  s.residents.set(A, [{ id: 'house:s0', style: 'unknown', tier: 'hut', kind: 'house', active: false }]);
  const fid = codexId(A, 'house:s0');
  s.fell(fid);
  s.residents.set(A, []);
  assert.equal(s.residents.down(), 0);
  s.later(GUARDS.RESPAWN_MS); s.residents.tick();
  assert.equal(s.crowd.figures.get(fid).dead, true);
});

// ---- through the sea ---------------------------------------------------------------------

test('a swing over the wire, aimed by the last pose, costs the guard in front of the player', async () => {
  const sea = createSea({ port: 0 });
  try {
    const sent = [];
    const conn = { id: 'aabbccdd', joined: true, send: (m) => sent.push(JSON.parse(m)), close() {} };
    const p = sea.roster.attach(conn, { island: null, announce: false });
    const crowd = sea.crowds.get(VOLCANO.id);
    const g = crowd.figures.get('guard:0');
    // The volcano is at the origin, so its local frame is the world's.
    sea.roster.message(conn, JSON.stringify({ t: 'p', ...besideOf(crowd, g), f: 0 }));
    assert.equal(p.posed, true);
    sea.roster.message(conn, JSON.stringify({ t: 'swing' }));
    assert.equal(sea.combat.health(g), AGENT_HEALTH - PLAYER_HIT);
    sea.roster.message(conn, JSON.stringify({ t: 'swing' }));
    assert.equal(sea.combat.health(g), AGENT_HEALTH - PLAYER_HIT, 'the second swing came inside the cooldown');
  } finally {
    await sea.close();
  }
});

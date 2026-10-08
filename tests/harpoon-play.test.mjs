// The harpoons in play (web/js/harpoon-play.js, Plans/harpoen.md) on a real ship under Node: fired at the
// statue floating off her bow, the line hooks her, drags her over the water to the gun and lays her on the
// deck; fired at the shore, our ship is drawn to it (and never past the line's hold); the fire button with
// a line out lets go; and another page's hull is never moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = { createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop };

const { CRAFTS } = await import('../shared/crafts.mjs');
const { createBoat } = await import('../web/js/boat.js');
const { createHarpoonPlay } = await import('../web/js/harpoon-play.js');

const I = CRAFTS.galleon.mounts.findIndex((m) => m.kind === 'harpoon');
const DT = 1 / 60;

function setup({ ground = () => -3, followed = () => false, others = [], peers = [] } = {}) {
  const scene = new THREE.Scene();
  const craft = createBoat({ scene, material: new THREE.MeshBasicMaterial(), kind: 'ship' });
  const ship = { id: 'boat:ours', x: 0, z: 0, yaw: 0, v: 0, craft };
  craft.place(0, 0, 0);
  const statue = { x: 0, y: 0, z: 0, aboard: null, drags: 0, ends: 0 };
  const hunt = {
    loose: () => (statue.aboard || statue.gone ? null : { x: statue.x, y: statue.y, z: statue.z, afloat: true }),
    drag(at) { statue.x = at.x; statue.y = at.y; statue.z = at.z; statue.drags++; },
    dragEnd() { statue.ends++; },
    reelAboard(hull) { statue.aboard = hull; return true; },
  };
  const sent = [];
  const net = { harpoonLine: (m) => sent.push({ t: 'line', ...m }), harpoonHook: (m) => sent.push({ t: 'hook', ...m }),
    harpoonFree: (m) => sent.push({ t: 'free', ...m }), towBoat: (id, by, x, z, yaw) => sent.push({ t: 'tow', id, by, x, z, yaw }) };
  const all = () => [ship, ...others];
  const play = createHarpoonPlay({
    scene, boats: all, sea: () => ({ height: ground }), hunt: () => hunt,
    kindOf: (b) => b.kind || 'galleon', followed, surfaceAt: () => 0,
    net: () => net, peers: () => peers, boatAt: (id) => all().find((b) => b.id === id) || null, stepping: (b) => !followed(b),
  });
  const run = (s, each = null) => {
    for (let i = 0; i < Math.round(s / DT); i++) {
      if (each) each();
      craft.place(ship.x, ship.z, ship.yaw);
      play.frame(DT);
    }
  };
  return { scene, craft, ship, statue, play, run, sent };
}

// Aim gun I straight at a point on the water, as walk mode would lay it.
function aimAt(craft, ship, x, z, pitch) {
  const m = CRAFTS.galleon.mounts[I];
  const yaw = Math.atan2(x - m.x, z - m.z) - m.yaw;
  craft.layGun(I, [yaw, pitch]);
}

test('fired at the floating statue, the line hooks her, hauls her in and lays her on the deck', () => {
  const { craft, ship, statue, play, run } = setup();
  Object.assign(statue, { x: 8, y: 0, z: 9 });
  aimAt(craft, ship, 8, 9, -0.12);
  assert.equal(play.fire(ship, I), 'fired');
  run(1.2);
  const line = play.lineAt(ship, I);
  assert.equal(line.state, 'hooked', `line ${line.state}`);
  assert.equal(line.hooked().kind, 'statue');
  run(8);
  assert.equal(statue.aboard, ship, 'on her deck');
  assert.ok(statue.drags > 10, 'dragged over the water to her');
  run(4);
  assert.equal(line.state, 'stowed', 'and the bolt is home');
});

test('fired at the shore our ship is drawn to it and held off it, and the fire button lets go', () => {
  const shore = (x, z) => (z > 25 ? 3 : -3);
  const { craft, ship, statue, play, run } = setup({ ground: shore });
  statue.gone = true;
  aimAt(craft, ship, 3, 30, 0.15);
  play.fire(ship, I);
  run(2);
  const line = play.lineAt(ship, I);
  assert.equal(line.hooked().kind, 'land');
  const hook = line.hooked();
  const gun = { i: I, kind: 'harpoon' };
  run(20, () => play.tow(ship, gun, DT));
  // The ship moves along her heading in the page; this test moves her by her way as stepBoat would.
  assert.ok(line.reeledIn(), 'all the line it will take is in');
  assert.equal(play.fire(ship, I), 'released');
  assert.notEqual(line.state, 'hooked');
  assert.ok(Math.hypot(hook.x - ship.x, hook.z - ship.z) > 1, 'never on the rock');
});

test('a hull another page is stepping is never towed', () => {
  const shore = (x, z) => (z > 25 ? 3 : -3);
  const { craft, ship, statue, play, run } = setup({ ground: shore, followed: () => true });
  statue.gone = true;
  aimAt(craft, ship, 3, 30, 0.15);
  play.fire(ship, I);
  run(2);
  const before = { x: ship.x, z: ship.z, yaw: ship.yaw, v: ship.v };
  run(5, () => play.tow(ship, { i: I, kind: 'harpoon' }, DT));
  assert.deepEqual({ x: ship.x, z: ship.z, yaw: ship.yaw, v: ship.v }, before);
});

test('what sound.js hears: the shot, and the reel ticking while it takes line in', () => {
  const { craft, ship, statue, play, run } = setup();
  Object.assign(statue, { x: 8, y: 0, z: 9 });
  aimAt(craft, ship, 8, 9, -0.12);
  play.fire(ship, I);
  const shot = play.events();
  assert.equal(shot.list.at(-1).kind, 'harpoon');
  run(3);
  const kinds = new Set(play.events().list.map((e) => e.kind));
  assert.ok(kinds.has('ratchet'), [...kinds].join());
  assert.ok(play.events().list.length <= 12);
});

test('a line out is said to the sea while it is out, and once when it is in', () => {
  const { craft, ship, statue, play, run, sent } = setup();
  statue.gone = true;
  aimAt(craft, ship, 6, 6, -0.2);
  play.fire(ship, I);
  run(4);
  const lines = sent.filter((m) => m.t === 'line');
  assert.ok(lines.filter((m) => m.s === 'out').length > 5, 'said while out');
  assert.equal(lines.at(-1).s, 'off', 'and once when in');
  assert.equal(lines.filter((m) => m.s === 'off').length, 1);
  assert.ok(lines.filter((m) => m.s === 'out').length < 4 / 0.1 + 3, 'a few times a second, not every frame');
});

test('another player struck: the sea is told, and let go of they are freed', () => {
  const peers = [{ id: 'p2', x: 8, y: 0, z: 9, sailing: false }];
  const { craft, ship, statue, play, run, sent } = setup({ peers });
  statue.gone = true;
  aimAt(craft, ship, 8, 9, -0.12);
  play.fire(ship, I);
  run(1.2);
  assert.equal(play.lineAt(ship, I).hooked().kind, 'player');
  assert.ok(sent.some((m) => m.t === 'hook' && m.who === 'p2' && m.b === 'boat:ours' && m.i === I));
  play.fire(ship, I);
  assert.ok(sent.some((m) => m.t === 'free' && m.who === 'p2'));
});

test('a loose rowing boat is drawn in and the sea told where; a sailed one is chased instead', () => {
  const row = { id: 'boat:abcd-n1', kind: 'rowboat', x: 8, z: 9, yaw: 0, pilot: null, craft: {} };
  const { craft, ship, statue, play, run, sent } = setup({ others: [row] });
  statue.gone = true;
  aimAt(craft, ship, 8, 9, -0.1);
  play.fire(ship, I);
  run(1.2);
  assert.equal(play.lineAt(ship, I).hooked().kind, 'rowboat');
  assert.equal(play.towing(row.id), true);
  run(3);
  const mouth = craft.gunMuzzle(I).at;
  assert.ok(Math.hypot(row.x - mouth[0], row.z - mouth[2]) < 4.5, `drawn in alongside (${row.x}, ${row.z})`);
  assert.ok(sent.some((m) => m.t === 'tow' && m.id === row.id && m.by === 'boat:ours'));
  // Not ours to tow once somebody has her helm.
  row.pilot = 'somebody';
  run(0.2);
  assert.equal(play.towing(row.id), false);
});

test('a line of her crew\'s draws the ship this page sails; somebody else\'s line is drawn here', () => {
  const { ship, play, run, scene } = setup();
  play.onLine({ id: 'crewmate', b: 'boat:ours', i: I, s: 'out', at: [0, 1, 40], L: 20, k: 'land' });
  run(0.1);
  assert.equal(play.remoteCount(), 1);
  const z0 = ship.z;
  for (let k = 0; k < 60; k++) play.towByCrew(ship, 1 / 60);
  assert.ok(ship.z > z0 + 1, `drawn toward it (${ship.z})`);
  play.onLine({ id: 'crewmate', b: 'boat:ours', i: I, s: 'off' });
  assert.equal(play.remoteCount(), 0);
  assert.ok(scene.children.length > 0);
});

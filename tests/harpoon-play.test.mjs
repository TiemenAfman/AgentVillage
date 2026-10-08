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

function setup({ ground = () => -3, followed = () => false } = {}) {
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
  const play = createHarpoonPlay({
    scene, boats: () => [ship], sea: () => ({ height: ground }), hunt: () => hunt,
    kindOf: () => 'galleon', followed, surfaceAt: () => 0,
  });
  const run = (s, each = null) => {
    for (let i = 0; i < Math.round(s / DT); i++) {
      if (each) each();
      craft.place(ship.x, ship.z, ship.yaw);
      play.frame(DT);
    }
  };
  return { scene, craft, ship, statue, play, run };
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

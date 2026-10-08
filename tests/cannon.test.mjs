// The galleon's guns (Plans/kanonnen.md): the ball's flight in shared/cannon.mjs, which the page and
// the sea both fly, and the gun as drawn - two of the keeper's cannons welded into the hull's one
// geometry, the barrel laid on its trunnions and the muzzle a ball leaves from where the bore is.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = { createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop };

const C = await import('../shared/cannon.mjs');
const { CRAFTS } = await import('../shared/crafts.mjs');
const { DECK_Y } = await import('../shared/hull.mjs');
const { createBoat } = await import('../web/js/boat.js');
const { cannonShape, layPoint, muzzleOf, restLay } = await import('../web/js/cannon.js');
const { PIRATESHIP } = await import('../web/js/pirateship-mesh.js');

test('shared/cannon.mjs keeps shared\'s rule: no trig, no clock, no three', () => {
  const src = readFileSync(new URL('../shared/cannon.mjs', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Math\.(sin|cos|tan|atan2?|pow|exp|log|sqrt|hypot)\b/);
  assert.doesNotMatch(src, /Date\.now|performance\.now|from 'three'/);
});

test('a ball flies the closed form of a throw and comes down on water, land or a hull', () => {
  const shot = { o: [0, 2, 0], v: [30, 10, 0] };
  const at = C.ballAt(shot, 1);
  assert.deepEqual(at, [30, 2 + 10 - 0.5 * C.BALL_G, 0]);
  const sea = C.ballHit(shot, { height: () => -2.5 });
  assert.equal(sea.kind, 'splash');
  assert.ok(Math.abs(sea.at[1]) < 1e-9);
  // Its time is where y crosses 0: 2 + 10 t - g t^2 / 2 = 0.
  const t = (10 + Math.sqrt(100 + 4 * C.BALL_G)) / C.BALL_G;
  assert.ok(Math.abs(sea.t - t) <= C.BALL_STEP + 1e-9, `${sea.t} vs ${t}`);
  const land = C.ballHit(shot, { height: (x) => (x > 20 ? 8 : -2.5) });
  assert.equal(land.kind, 'blast');
  assert.ok(land.at[0] > 20 && land.at[0] < 21);
  const hull = { id: 'boat:x', x: 82, z: 0, fx: 0, fz: 1, y: 0 };
  const ship = C.ballHit(shot, { height: () => -2.5, hulls: [hull] });
  assert.equal(ship.kind, 'hull');
  assert.equal(ship.id, 'boat:x');
  // Its own ship is not hit by the ball leaving her, but is by one coming back down on her.
  const own = { ...shot, b: 'boat:x' };
  const near = C.ballHit({ ...own, o: [82, 1.5, 0] }, { height: () => -2.5, hulls: [hull] });
  assert.notEqual(near.kind === 'hull' && near.t < 0.03, true);
  const up = C.ballHit({ o: [82, 1.5, 0], v: [0, 20, 0.1], b: 'boat:x' }, { height: () => -2.5, hulls: [hull] });
  assert.equal(up.kind, 'hull');
});

test('the gun\'s range is a long shot, not a short one and not the whole sea', () => {
  const range = (pitch) => {
    const v = [0, C.BALL_SPEED * Math.sin(pitch), C.BALL_SPEED * Math.cos(pitch)];
    return C.ballHit({ o: [0, 1.5, 0], v }, { height: () => -2.5 }).at[2];
  };
  assert.ok(range(0) > 15 && range(0) < 30, `level: ${range(0)}`);
  assert.ok(range(C.GUN_PITCH_MAX) > 110 && range(C.GUN_PITCH_MAX) < 170, `highest: ${range(C.GUN_PITCH_MAX)}`);
});

test('a blast costs most at its heart and nothing past its edge; a body hit square costs the whole', () => {
  assert.ok(C.blastOn('blast', [0, 0.3, 0], [0, 0, 0]) > C.BALL_HIT * 0.99);
  const half = C.blastOn('blast', [0, 0.3, 0], [C.BLAST_R / 2, 0, 0]);
  assert.ok(Math.abs(half - C.BALL_HIT / 2) < 0.5, `${half}`);
  assert.equal(C.blastOn('blast', [0, 0.3, 0], [C.BLAST_R + 0.01, 0, 0]), 0);
  assert.equal(C.blastOn('body', [9, 9, 9], [0, 0, 0]), C.BALL_HIT);
  assert.equal(C.blastOn('splash', [0, 0, 0], [5, 0, 0]), 0);
});

test('a shot off the wire is believed for where and which way, not for how fast', () => {
  assert.deepEqual(C.parseShot({ o: [1, 2, 3], v: [C.BALL_SPEED, 0, 0] }, 3000), { o: [1, 2, 3], v: [C.BALL_SPEED, 0, 0] });
  assert.equal(C.parseShot({ o: [1, 2, 3], v: [C.BALL_SPEED, C.BALL_SPEED, 0] }, 3000), null);
  assert.equal(C.parseShot({ o: [1, 'x', 3], v: [1, 0, 0] }, 3000), null);
  assert.equal(C.parseShot({ o: [1e9, 2, 3], v: [1, 0, 0] }, 3000), null);
  assert.deepEqual(C.clampLay(5, -5), [C.GUN_TRAVERSE, C.GUN_PITCH_MIN]);
  assert.deepEqual(C.slewLay([0, 0], [1, -1], 0.1), [C.GUN_TURN * 0.1, -C.GUN_TURN * 0.1]);
});

test('the body\'s gravity in a flight out of the gun is walk mode\'s own', () => {
  const walk = readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8');
  assert.equal(Number(/const GRAVITY = ([\d.]+);/.exec(walk)[1]), C.HUMAN_G);
});

test('the old guns are out of the galleon, and her two new ones stand on her waist, one a side', () => {
  // The source's guns stood out of her ports to 2.63 from the middle; nothing does any more below
  // the bulwark's height, between the ladders and the quarterdeck stairs.
  const p = PIRATESHIP.parts['pirateship hull'].positions;
  let out = 0;
  for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]) > 2.5 && p[i + 2] > -2.4 && p[i + 2] < 1.4 && p[i + 1] > 3 && p[i + 1] < 4) out++;
  assert.equal(out, 0, `${out} corners still stand out of the ports`);
  const guns = CRAFTS.galleon.mounts.filter((m) => m.kind === 'cannon');
  assert.equal(guns.length, 2);
  assert.ok(guns[0].x > 0 && guns[1].x < 0);
  for (const g of guns) {
    const deck = CRAFTS.galleon.deck[0];
    assert.ok(Math.abs(g.x) + 0.2 < deck.hx + 0.1 && Math.abs(g.z) < deck.hz, 'on the waist');
  }
});

test('a laid barrel turns about its trunnions, and the muzzle a ball leaves from is the drawn bore\'s', () => {
  const s = cannonShape();
  assert.ok(s, 'the cannon set is baked');
  assert.ok(Math.abs(s.rest - 0.166) < 0.02, `rest elevation ${s.rest}`);
  const spec = CRAFTS.galleon.mounts[0];
  const pin = layPoint(spec, restLay(), 0, true, 0, 0, 0);
  for (const pitch of [C.GUN_PITCH_MIN, 0, C.GUN_PITCH_MAX]) {
    for (const yaw of [-C.GUN_TRAVERSE, 0, C.GUN_TRAVERSE]) {
      const m = muzzleOf(spec, [yaw, pitch]);
      const p = layPoint(spec, [yaw, pitch], 0, true, 0, 0, 0);
      assert.ok(Math.abs(Math.hypot(m.at[0] - p[0], m.at[1] - p[1], m.at[2] - p[2]) - s.length) < 1e-9);
      assert.ok(Math.abs(p[1] - pin[1]) < 1e-9, 'the trunnions do not move');
      // Elevation of the bore is the laying; its heading is the gun's plus the traverse.
      assert.ok(Math.abs(Math.asin(m.dir[1]) - pitch) < 1e-6, `pitch ${pitch}: ${Math.asin(m.dir[1])}`);
      const heading = Math.atan2(m.dir[0], m.dir[2]);
      assert.ok(Math.abs(heading - (spec.yaw + yaw)) < 1e-6);
    }
  }
  // Square out of her starboard side at rest: the muzzle over the bulwark, on the deck's height.
  const m = muzzleOf(spec, restLay());
  assert.ok(m.at[0] > 1.7 && m.at[0] < 2.1, `muzzle x ${m.at[0]}`);
  assert.ok(m.at[1] - DECK_Y - spec.y > 0.2, 'the bore stands over the bulwark');
});

test('the guns are welded into the hull\'s one geometry and laying one moves only its own corners', () => {
  const scene = new THREE.Scene();
  const boat = createBoat({ scene, material: new THREE.MeshBasicMaterial(), kind: 'ship' });
  assert.equal(boat.guns, 2);
  assert.equal(scene.children.filter((o) => o.isMesh).length, 1, 'one mesh, one draw call');
  const pos = boat.object.geometry.attributes.position.array.slice();
  boat.layGun(0, [0.3, 0.3], 0.1);
  const now = boat.object.geometry.attributes.position.array;
  let moved = 0, first = Infinity;
  for (let i = 0; i < pos.length; i++) if (pos[i] !== now[i]) { moved++; first = Math.min(first, i); }
  assert.ok(moved > 1000);
  // Everything that moved lies in the last runs, the guns'; the hull and her ladders did not.
  const tail = boat.object.geometry.attributes.position.count * 3;
  assert.ok(first > tail * 0.5, `first moved number ${first} of ${tail}`);
  boat.dispose();
});

// The director (Plans/regisseur.md): the camera that goes to watch something happen when nobody
// has touched the island for a while, and the fisherman who gave the fisherman's hut something to
// be watched for.
//
// Held here:
//   the choice   an arrival before anything else, never the same thing twice in a row, and by
//                weight otherwise;
//   the island   back up to the whole island after every shot, and circling it slowly for as
//                long as nothing is happening;
//   the camera   nothing before IDLE_S of quiet, a flight with no jump in it, a slow circle round
//                what it watches, the next thing after HOLD_S or as soon as this one is gone, and
//                any input stopping it where it stands;
//   the fisher   out of the door in the morning, down to the last dry ground before the water,
//                a strike and a cast now and then, and in again at night.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

import { createDirector, pickShot, viewOf, poseOf, IDLE_S, FLY_S, HOLD_S, SHOT_DIST, SHOT_EL, OVERVIEW_S, OVERVIEW_RATE } from '../web/js/director.js';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const THREE = await import('three');
const { attachFisher, updateFisher, fisherAt, disposeFisher, FISH_ARM } = await import('../web/js/fisher.js');
delete globalThis.document;

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const still = (key, at, o = {}) => ({ key, label: key, where: () => at, ...o });

// ---- the choice ------------------------------------------------------------------------------

test('an arrival goes first, the last shot is not taken again, and weight decides the rest', () => {
  const a = still('a', [0, 0, 0]), b = still('b', [1, 0, 0]), gone = still('gone', null);
  const newcomer = still('new', [2, 0, 0], { first: true });
  assert.equal(pickShot([a, b, newcomer], null, () => 0.99).key, 'new', 'an arrival will not wait');
  assert.equal(pickShot([a, b, newcomer], 'new', () => 0).key, 'a', 'but is not watched twice in a row');
  assert.equal(pickShot([a, b], 'a', () => 0).key, 'b');
  assert.equal(pickShot([a], 'a', () => 0).key, 'a', 'the one thing there is, again, rather than nothing');
  assert.equal(pickShot([gone], null), null, 'nothing that is still going on is nothing to watch');
  const heavy = still('heavy', [0, 0, 0], { weight: 9 });
  let heavyWins = 0;
  for (let i = 0; i < 100; i++) if (pickShot([a, heavy], null, () => i / 100).key === 'heavy') heavyWins++;
  assert.ok(heavyWins >= 85 && heavyWins <= 95, `weight 9 against 1 won ${heavyWins} of 100`);
});

test('viewOf and poseOf are each other\'s inverse', () => {
  const target = [3, 1, -2], position = [10, 6, 4];
  const back = poseOf(target, viewOf(target, position)).position;
  assert.ok(dist3(back, position) < 1e-9);
});

// ---- the camera ------------------------------------------------------------------------------

function running(sources) {
  const d = createDirector({ sources, rand: () => 0 });
  let cam = { target: [0, 1, 0], position: [30, 40, 30] };
  const step = (dt, can = true) => {
    const pose = d.step(dt, can, cam);
    if (pose) cam = pose;
    return pose;
  };
  return { d, step, cam: () => cam };
}

test('nothing moves before IDLE_S of quiet, and then the camera flies without a jump', () => {
  const r = running(() => [still('a', [5, 0, 5])]);
  for (let t = 0; t < IDLE_S - 0.5; t += 0.1) assert.equal(r.step(0.1), null, `the camera moved at ${t.toFixed(1)} s`);
  let prev = r.cam();
  for (let t = 0; t < FLY_S + 2; t += 0.05) {
    r.step(0.05);
    const now = r.cam();
    assert.ok(dist3(now.position, prev.position) < 2.5, 'the camera jumped');
    prev = now;
  }
  assert.equal(r.d.caption(), 'a');
  const v = viewOf(r.cam().target, r.cam().position);
  assert.ok(Math.abs(v.dist - SHOT_DIST) < 1e-6 && Math.abs(v.el - SHOT_EL) < 1e-6, 'it watches from the shot\'s distance and height');
  assert.ok(dist3(r.cam().target, [5, 0, 5]) < 0.05, 'and looks at the thing');
});

test('it circles what it watches, follows it when it moves, and goes on after HOLD_S', () => {
  let x = 0;
  const r = running(() => [still('a', [0, 0, 0]), { key: 'b', label: 'b', where: () => [x, 0, 0] }]);
  for (let t = 0; t < IDLE_S + FLY_S + 1; t += 0.1) r.step(0.1);
  const first = r.d.key();
  const az0 = viewOf(r.cam().target, r.cam().position).az;
  for (let t = 0; t < 3; t += 0.1) { x += 0.05; r.step(0.1); }
  const az1 = viewOf(r.cam().target, r.cam().position).az;
  assert.ok(az1 > az0, 'it does not circle');
  if (first === 'b') assert.ok(r.cam().target[0] > 0.5, 'it does not follow');
  for (let t = 0; t < HOLD_S; t += 0.1) r.step(0.1);
  assert.notEqual(r.d.key(), first, 'it never went on to the next');
});

test('a thing that is over is left at once, and any input stops the camera where it is', () => {
  let alive = true;
  const r = running(() => [{ key: 'brief', label: 'brief', where: () => (alive ? [2, 0, 2] : null) }, still('other', [9, 0, 9])]);
  for (let t = 0; t < IDLE_S + 1; t += 0.1) r.step(0.1);
  assert.equal(r.d.key(), 'brief');
  alive = false;
  r.step(0.1);
  assert.equal(r.d.key(), 'other', 'it stayed on something that was over');

  const before = r.cam();
  assert.equal(r.d.poke(), true);
  assert.equal(r.d.active(), false);
  assert.equal(r.d.caption(), null);
  assert.equal(r.step(0.1), null, 'the camera moved after somebody touched it');
  assert.deepEqual(r.cam(), before);
  for (let t = 0; t < IDLE_S - 1; t += 0.1) assert.equal(r.step(0.1), null, 'the count did not start again');

  // Not allowed (walking, a panel open, the intro): nothing, and the count starts again.
  const q = running(() => [still('a', [0, 0, 0])]);
  for (let t = 0; t < IDLE_S * 2; t += 0.1) assert.equal(q.step(0.1, false), null);
  assert.equal(q.step(0.1, true), null, 'the time it was not allowed counted as quiet');
});

test('with nothing to watch the camera stays where it is', () => {
  const r = running(() => []);
  for (let t = 0; t < IDLE_S * 3; t += 0.1) assert.equal(r.step(0.1), null);
});

test('after every shot the camera goes back up to the whole island before the next', () => {
  const island = { target: [0, 1, 0], dist: 150, el: 0.72 };
  const d = createDirector({ sources: () => [still('a', [5, 0, 5]), still('b', [-5, 0, -5])], overview: () => island, rand: () => 0 });
  let cam = { target: [0, 1, 0], position: [30, 40, 30] };
  const keys = [];
  for (let t = 0; t < IDLE_S + 4 * (FLY_S + HOLD_S + OVERVIEW_S + 5); t += 0.1) {
    const pose = d.step(0.1, true, cam);
    if (pose) cam = pose;
    const k = d.key();
    if (k && keys[keys.length - 1] !== k) keys.push(k);
  }
  assert.ok(keys.length >= 5, keys.join(' '));
  keys.forEach((k, i) => assert.equal(k === 'overview', i % 2 === 1, `shot and island should take turns: ${keys.join(' ')}`));
  assert.equal(d.caption() === null || typeof d.caption() === 'string', true);
});

test('with nothing happening it circles the whole island, slowly, and flies nowhere else', () => {
  const island = { target: [10, 1, -4], dist: 150, el: 0.72 };
  const d = createDirector({ sources: () => [], overview: () => island });
  let cam = { target: [0, 1, 0], position: [30, 40, 30] };
  const step = (n) => { for (let i = 0; i < n; i++) { const p = d.step(0.1, true, cam); if (p) cam = p; } };
  step(IDLE_S * 10 + 80);
  assert.equal(d.key(), 'overview');
  assert.equal(d.caption(), null, 'the island needs no caption');
  const v0 = viewOf(cam.target, cam.position);
  assert.ok(dist3(cam.target, island.target) < 0.05 && Math.abs(v0.dist - 150) < 1e-6, 'it frames the island');
  let prev = cam;
  for (let i = 0; i < (OVERVIEW_S * 3) * 10; i++) {
    step(1);
    assert.ok(dist3(cam.position, prev.position) < 150 * OVERVIEW_RATE * 0.1 * 1.5, 'the orbit jumped, or flew off again');
    prev = cam;
  }
  const v1 = viewOf(cam.target, cam.position);
  const turned = ((v1.az - v0.az) + 4 * Math.PI) % (2 * Math.PI);
  assert.ok(Math.abs(turned - OVERVIEW_RATE * OVERVIEW_S * 3) < 0.01, `it turned ${turned.toFixed(3)} rad`);
});

// ---- the fisherman ---------------------------------------------------------------------------

test('the fisherman comes out in the morning, fishes at the water\'s edge, and goes in at night', () => {
  const uniforms = { uNight: { value: 1 } };
  const material = new THREE.MeshBasicMaterial();
  material.userData.uniforms = uniforms;
  const hut = new THREE.Group();
  hut.position.set(10, 0.5, 20);
  // Dry up to z 0.8 in front of the hut, sea beyond.
  const groundAt = (x, z) => (z - 20 < 0.8 ? 0.5 : -0.3);
  const f = attachFisher(hut, material, groundAt);
  updateFisher(f, 0.1);
  assert.equal(fisherAt(f), null, 'out at night');

  uniforms.uNight.value = 0;
  let strikes = 0;
  const attack = f.avatar.attack.bind(f.avatar);
  f.avatar.attack = (side) => { strikes++; return attack(side); };
  for (let t = 0; t < 60; t += 0.05) updateFisher(f, 0.05);
  assert.equal(f.mode, 'fish');
  const at = fisherAt(f);
  assert.ok(at, 'nobody fishing by day');
  assert.ok(Math.abs(at[1] - 20.75) < 0.06, `he fishes at z ${(at[1] - 20).toFixed(2)} in front of the hut, not at the water's edge (0.75)`);
  assert.ok(f.figure.position.y > -0.01, 'he stands in the water');
  assert.ok(strikes >= 6 && strikes <= 24, `${strikes} strikes and casts in a minute`);
  assert.equal(FISH_ARM < -1.5, true);

  uniforms.uNight.value = 1;
  for (let t = 0; t < 20; t += 0.05) updateFisher(f, 0.05);
  assert.equal(fisherAt(f), null, 'he stayed out after dark');
  disposeFisher(f);
  assert.equal(hut.children.length, 0);
});

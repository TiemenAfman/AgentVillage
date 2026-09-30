// What the hunt looks like (web/js/treasure-site.js): a statue that comes out of the sand instead of
// being swapped for another, a bottle that comes and goes with the day, a chest that is under its
// X until it is opened, and grains of sand that live a moment and are gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 16, height: 16, getContext: () => ctx });
globalThis.document = { createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop };
const S = await import('../web/js/treasure-site.js');

const make = () => {
  const scene = new THREE.Scene();
  const view = S.createTreasureView({ scene, material: new THREE.MeshBasicMaterial() });
  return { scene, view };
};
const statue = (stage, over = {}) => ({ id: 'statue', kind: 'statue', stage, x: 5, y: 0.4, z: -3, rot: 1, ...over });
const run = (view, seconds) => { for (let i = 0; i < Math.round(seconds * 60); i++) view.update(1 / 60); };
const bodyY = (view, id) => view.entries().get(id).parts.body.position.y;

test('the statue is half in the sand, and digging her up raises the same figure to lie on it', () => {
  const { view } = make();
  view.setSites([statue('buried')]);
  const buried = bodyY(view, 'statue');
  assert.ok(buried < -0.2 && buried > -0.4, `almost half of her 0.55 is under the sand: ${buried}`);
  const e = view.entries().get('statue');
  assert.deepEqual(e.group.position.toArray(), [5, 0.4, -3]);
  view.setSites([statue('unearthed')]);
  assert.equal(view.entries().get('statue'), e, 'the same figure, not a second one');
  run(view, S.RISE_S / 2);
  const mid = bodyY(view, 'statue');
  assert.ok(mid > buried && mid < -0.05, 'still on her way up');
  run(view, S.RISE_S);
  assert.ok(bodyY(view, 'statue') > buried + 0.15 && bodyY(view, 'statue') <= 0, 'out of the sand');
});

test('a chest is an X on the sand until it is opened, and then comes up out of it', () => {
  const { view } = make();
  const chest = (stage) => ({ id: 'chest:s', kind: 'chest', stage, x: 0, y: 0.2, z: 0, rot: 0 });
  view.setSites([chest('buried')]);
  const parts = view.entries().get('chest:s').parts;
  assert.equal(parts.cross.visible, true);
  assert.equal(parts.body.visible, false, 'nothing to see of the chest');
  view.setSites([chest('open')]);
  run(view, S.RISE_S + 0.1);
  assert.equal(parts.body.visible, true);
  assert.equal(parts.cross.visible, false);
  assert.ok(Math.abs(parts.body.position.y) < 1e-6);
});

test('a site the hunt stops listing shrinks away and is freed; one it lists again in time stays', () => {
  const { view, scene } = make();
  view.setSites([statue('buried')]);
  assert.equal(scene.getObjectByName('treasure').children.length >= 2, true);
  view.setSites([]);
  run(view, 0.1);
  assert.ok(view.entries().get('statue').group.scale.x < 1, 'shrinking');
  view.setSites([statue('buried')]);
  assert.equal(view.entries().get('statue').group.scale.x, 1, 'listed again: back at full size');
  view.setSites([]);
  run(view, 1);
  assert.equal(view.entries().size, 0);
});

test('a bottle is on the beach for its day and gone with it, and turns a different way on every cell', () => {
  const { view } = make();
  const day1 = { id: 'bottle:a:1', x: 1, y: 0.1, z: 2, cell: [100, 103] };
  view.setBottle(day1);
  const e = view.entries().get('bottle:bottle:a:1');
  assert.deepEqual(e.group.position.toArray(), [1, 0.1, 2]);
  view.setBottle(day1);
  assert.equal(view.entries().size, 1, 'asked twice is one bottle');
  view.setBottle(null);
  run(view, 1);
  assert.equal(view.entries().size, 0);
  // A site refresh does not take the bottle with it.
  view.setBottle(day1);
  view.setSites([]);
  run(view, 1);
  assert.equal(view.entries().size, 1);
});

test('the heap swells with the dig, is kept beside a good hole and dropped when the dig is cancelled', () => {
  const { view } = make();
  const heaps = () => view.group.children.filter((c) => c.isMesh && c.visible);
  view.setMound({ x: 1, y: 0, z: 1 }, 0.5);
  run(view, 0.5);
  assert.equal(heaps().length, 1);
  const half = heaps()[0].scale.y;
  view.setMound({ x: 1, y: 0, z: 1 }, 1);
  run(view, 0.5);
  assert.ok(heaps()[0].scale.y > half);
  view.setMound(null, 0);
  run(view, 1);
  assert.equal(heaps().length, 0, 'cancelled: the heap is gone');
  view.setMound({ x: 1, y: 0, z: 1 }, 1);
  run(view, 0.5);
  view.keepMound();
  run(view, 5);
  assert.equal(heaps().length, 1, 'kept');
  view.setMound({ x: 4, y: 0, z: 4 }, 0.3);
  run(view, 0.5);
  assert.equal(heaps().length, 2, 'and a new dig gets a heap of its own');
});

test('sand grains are thrown up, fall back and are gone within a second', () => {
  const g = S.createGrains(8);
  assert.equal(g.alive(), 0);
  g.burst(0, 0, 0, 5);
  assert.equal(g.alive(), 5);
  g.step(0.1);
  assert.ok([...g.pos].some((v, i) => i % 3 === 1 && v > 0.04), 'up');
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  assert.equal(g.alive(), 0);
  assert.ok(g.pos.every((v, i) => i % 3 !== 1 || v < -1000), 'parked out of sight');
  // A full pool drops its oldest rather than refusing the newest.
  g.burst(0, 0, 0, 20);
  assert.equal(g.alive(), 8);
});

test('the shapes are small and drawn with the island\'s own material', () => {
  const tris = (g) => g.attributes.position.count / 3;
  assert.ok(tris(S.bottleGeometry()) < 200);
  assert.ok(tris(S.chestGeometry()) < 100);
  assert.ok(tris(S.crossGeometry()) <= 24);
  assert.ok(tris(S.statueGeometry()) <= 120 && tris(S.statueGeometry()) > 50, 'the baked prop_treasure_carry');
  assert.ok(tris(S.moundGeometry()) <= 120);
});

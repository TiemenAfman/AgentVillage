// Plans/verborgen-inwoners-tellen-niet.md: a settler who is not drawn costs the GPU nothing.
//
// Every batch the crowd is drawn with keeps the figures it draws packed in front of `count`,
// so a body past NPC Distance, under an imp, filtered or not yet placed by the sea is not an
// instance at all - in the colour pass or the shadow pass. Before this a hidden body was an
// instance parked at y = -999 under a scale of 0.0001 and still inside `count`, and on
// Hoogezand NPC Distance 1000 or 50 was 432 triangles apart out of 5.5 million. The same
// went for every skirt and head of hair on somebody who does not wear one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./support/shared-loader.mjs', import.meta.url);
// buildings.js starts texture requests on import (reached through the boat crowd-view makes
// for an outing); geometry tests need no image IO.
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { createFigures, settlerLook } = await import('../web/js/settler-figures.js');
const { createCrowdView } = await import('../web/js/crowd-view.js');
const { HAT_SHAPES } = await import('shared/palette.mjs');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

// The metric the problem was measured with: instances inside `count` whose matrix has a scale
// under 0.001, over every InstancedMesh that draws anything.
function parked(scene) {
  let n = 0;
  scene.traverse((m) => {
    if (!m.isInstancedMesh || !m.count) return;
    const a = m.instanceMatrix.array;
    for (let i = 0; i < m.count; i++) if (Math.hypot(a[i * 16], a[i * 16 + 1], a[i * 16 + 2]) < 0.001) n++;
  });
  return n;
}

// A crowd of three kinds - a woman in a skirt, a woman in trousers, a man - each with the hat
// the id gives them, standing in a row where nothing about them moves between frames.
function crowd(n = 30) {
  const scene = new THREE.Scene();
  const view = createFigures(scene, new THREE.MeshBasicMaterial());
  const [torso, , , , , , , , , head] = scene.children;
  const skirts = scene.getObjectByName('resident-skirts');
  const hair = scene.getObjectByName('resident-woman-hair');
  // The hat batches, in HAT_SHAPES order, right after the two appearance layers.
  const shapes = HAT_SHAPES.filter((h) => h.id !== 'none').map((h) => h.id);
  const hats = new Map(shapes.map((id, k) => [id, scene.children[13 + k]]));
  const figures = new Map();
  const add = (i) => {
    const id = `resident:${i}`;
    const [presentation, outfit] = [['woman', 'skirt'], ['woman', 'trousers'], ['man', 'trousers']][i % 3];
    const f = { id, visible: true, pos: [i + 1, -2 * i - 1], y: 0.25, yaw: 0, anim: 'still', mode: 'idle', speed: 0 };
    assert.ok(view.enrol(f, { ...settlerLook(id, 'sonnet'), presentation, outfit }, 'adult'));
    figures.set(id, f);
    return f;
  };
  for (let i = 0; i < n; i++) add(i);
  return { scene, view, torso, head, skirts, hair, hats, figures, add };
}

// Everything that has to hold whatever order the slots have been shuffled into: whoever is
// drawn is inside every batch they are in, whoever is not is outside every one, nothing inside
// is parked, and each drawn slot carries its own figure's pose, colours and name.
const m = new THREE.Matrix4(), at = new THREE.Vector3(), c = new THREE.Color();
function check(k, label) {
  const drawn = [...k.figures.values()].filter((f) => f.visible);
  assert.equal(k.torso.count, drawn.length, `${label}: the body batch counts somebody it does not draw`);
  assert.equal(k.skirts.count, drawn.filter((f) => f.look.outfit === 'skirt').length, `${label}: skirts`);
  assert.equal(k.hair.count, drawn.filter((f) => f.look.presentation === 'woman').length, `${label}: hair`);
  for (const [shape, mesh] of k.hats) {
    assert.equal(mesh.count, drawn.filter((f) => f.look.hatShape === shape).length, `${label}: ${shape} hats`);
  }
  for (const f of k.figures.values()) {
    const inside = (slot, mesh) => slot >= 0 && slot < mesh.count;
    const hat = k.hats.get(f.look.hatShape);
    if (!f.visible) {
      assert.ok(!inside(f.slot, k.torso), `${label}: ${f.id} is hidden inside the body batch`);
      assert.ok(!inside(f.skirtSlot, k.skirts) && !inside(f.hairSlot, k.hair), `${label}: ${f.id}'s clothes are still drawn`);
      if (hat) assert.ok(!inside(f.hatSlot, hat), `${label}: ${f.id}'s hat is still drawn`);
      assert.equal(k.view.figureAt(k.torso, f.slot), null, `${label}: a ray finds ${f.id}`);
      continue;
    }
    assert.ok(inside(f.slot, k.torso), `${label}: ${f.id} is drawn outside the body batch`);
    assert.equal(k.view.figureAt(k.torso, f.slot), f, `${label}: slot ${f.slot} names somebody else`);
    assert.equal(k.view.figureAt(k.head, f.slot), f);
    k.torso.getMatrixAt(f.slot, m);
    at.setFromMatrixPosition(m);
    assert.deepEqual([at.x, at.y, at.z], [f.pos[0], f.y, f.pos[1]], `${label}: ${f.id} stands where somebody else does`);
    k.torso.getColorAt(f.slot, c);
    assert.equal(c.getHex(), new THREE.Color(f.look.tunic).getHex(), `${label}: ${f.id} wears somebody else's shirt`);
    k.head.getColorAt(f.slot, c);
    assert.equal(c.getHex(), new THREE.Color(f.look.skin).getHex(), `${label}: ${f.id} has somebody else's face`);
    assert.equal(f.skirtSlot >= 0, f.look.outfit === 'skirt', `${label}: ${f.id} has a skirt slot they do not wear`);
    assert.equal(f.hairSlot >= 0, f.look.presentation === 'woman');
    if (f.skirtSlot >= 0) {
      k.skirts.getMatrixAt(f.skirtSlot, m);
      assert.deepEqual(at.setFromMatrixPosition(m).toArray(), [f.pos[0], f.y, f.pos[1]], `${label}: ${f.id}'s skirt is elsewhere`);
      k.skirts.getColorAt(f.skirtSlot, c);
      assert.equal(c.getHex(), new THREE.Color(f.look.tunic).getHex());
    }
    if (hat) {
      assert.ok(inside(f.hatSlot, hat), `${label}: ${f.id}'s hat is not drawn`);
      hat.getColorAt(f.hatSlot, c);
      assert.equal(c.getHex(), new THREE.Color(f.look.hat).getHex(), `${label}: ${f.id} wears somebody else's hat`);
    }
  }
  assert.equal(parked(k.scene), 0, `${label}: an instance is parked inside a count`);
}

test('nobody enrolled is drawn before draw() has placed them', () => {
  const k = crowd(12);
  k.scene.traverse((o) => { if (o.isInstancedMesh) assert.equal(o.count, 0, `${o.name || 'a batch'} counts the unplaced`); });
  assert.deepEqual(k.view.pickables(), [], 'an unplaced body can be hovered');
  k.view.draw(k.figures, 0.1);
  check(k, 'first frame');
  k.view.dispose();
});

test('a hidden figure is not inside count, in any batch it is in, and comes back where it was', () => {
  const k = crowd(30);
  k.view.draw(k.figures, 0.1);
  check(k, 'everybody');
  // Every other one out of range: told by `visible`, the way crowd-view tells it.
  for (const f of k.figures.values()) if (Number(f.id.split(':')[1]) % 2) f.visible = false;
  k.view.draw(k.figures, 0.1);
  check(k, 'odd ones hidden');
  assert.equal(k.torso.count, 15);
  // And straight through hide(), with no draw after it - the chronicle taking the crowd away.
  for (const f of k.figures.values()) if (f.visible && Number(f.id.split(':')[1]) % 4 === 0) { f.visible = false; k.view.hide(f); }
  check(k, 'hidden without a draw');
  // Back in range, all of them, in the order the map happens to give.
  for (const f of k.figures.values()) f.visible = true;
  k.view.draw(k.figures, 0.1);
  check(k, 'everybody back');
  k.view.dispose();
});

test('a flinch that changes slot takes its red with it and gives the right colours back', () => {
  const k = crowd(9);
  k.view.draw(k.figures, 0.1);
  const f = k.figures.get('resident:8');
  k.view.flinch(f);
  k.view.draw(k.figures, 0.016);
  const was = f.slot;
  // Somebody drawn before them goes, and the last drawn - them - takes that slot.
  const gone = k.figures.get('resident:1');
  gone.visible = false;
  k.view.draw(k.figures, 0.016);
  assert.notEqual(f.slot, was, 'nobody moved; the test proves nothing');
  k.torso.getColorAt(f.slot, c);
  assert.ok(c.r > c.g, 'the flush stayed behind in the old slot');
  for (let i = 0; i < 30; i++) k.view.draw(k.figures, 0.016);
  assert.equal(f.flinch, 0);
  check(k, 'after the flinch');
  k.view.dispose();
});

test('leaving and arriving keeps every batch packed, and the freed slots are the next taken', () => {
  const k = crowd(20);
  k.view.draw(k.figures, 0.1);
  // A few hidden, then a few freed - some of each kind, drawn and not.
  for (const i of [2, 5, 11]) k.figures.get(`resident:${i}`).visible = false;
  k.view.draw(k.figures, 0.1);
  for (const i of [0, 5, 7, 13, 19]) {
    const f = k.figures.get(`resident:${i}`);
    f.visible = false;
    k.view.free(f);
    assert.equal(f.slot, null);
    k.figures.delete(f.id);
  }
  check(k, 'after the departures');
  // Arrivals take the room the departures left, drawn at once or not at all.
  for (let i = 20; i < 26; i++) k.add(i);
  const late = k.figures.get('resident:25');
  late.visible = false;
  k.view.draw(k.figures, 0.1);
  check(k, 'after the arrivals');
  assert.ok(Math.max(...[...k.figures.values()].map((f) => f.slot)) < k.figures.size, 'a slot past the crowd was taken');
  k.view.dispose();
});

test('past NPC Distance a settler is out of every count, and back in when they come into range', () => {
  const scene = new THREE.Scene();
  const region = { id: 'rangeholm', origin: [0, 0], half: 32, worldHeight: () => 0 };
  const buildings = ['house:a', 'house:b', 'house:c'].map((id) => ({ id, kind: 'house', name: id, style: 'opus' }));
  let eye = { x: 0, y: 40, z: 0 };
  const view = createCrowdView({ scene, material: new THREE.MeshBasicMaterial(), region, buildings, eye: () => eye, range: 10 });
  view.roster(buildings.map((b) => b.id));
  view.apply(new Map([[0, { x: 0, z: 0, anim: 'still' }], [1, { x: 5, z: 0, anim: 'still' }], [2, { x: 30, z: 0, anim: 'still' }]]), 1000);
  const torso = scene.children[0];
  const drawnIds = () => [...view.figures().values()].filter((f) => f.slot < torso.count).map((f) => f.id).sort();
  view.draw(0.016, () => 0, 1100);
  assert.deepEqual(drawnIds(), ['house:a', 'house:b']);
  assert.equal(torso.count, 2, 'a settler past NPC Distance is still an instance');
  assert.equal(parked(scene), 0);
  eye = { x: 30, y: 40, z: 0 };
  view.draw(0.016, () => 0, 1116);
  assert.deepEqual(drawnIds(), ['house:c']);
  assert.equal(parked(scene), 0);
  // The planner's whole village, and nobody out of range.
  view.setRange(0);
  view.draw(0.016, () => 0, 1132);
  assert.equal(torso.count, 3);
  assert.equal(parked(scene), 0);
  view.dispose();
});

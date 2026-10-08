// A figure told `anim: 'sit'` (settler-figures.js sitPose) sits on the seat it is handed: the
// Salty Kraken's crew on their benches and stools (Plans/piratenkroeg.md). Drawing only - the
// word is not on the wire (shared/settlerwire.mjs ANIMS) - so what is held here is the picture:
// the hips sink into the plank, the feet stay out of the floor, a seat too high leaves them
// dangling, and sitting never moves the figure itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./support/shared-loader.mjs', import.meta.url);
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { createFigures, settlerLook, sitPose } = await import('../web/js/settler-figures.js');
const { ANIMS } = await import('shared/settlerwire.mjs');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

function seated(seat, y = 0.06) {
  const scene = new THREE.Scene();
  const view = createFigures(scene, new THREE.MeshBasicMaterial(), { skinned: false });
  // children: torso, trim, left leg, right leg, ... (createFigures' own order)
  const [torso, , leftLeg, rightLeg] = scene.children;
  const f = { id: 'sitter', visible: true, pos: [0.4, -0.3], y, yaw: 0, faceAngle: 0, anim: 'sit', mode: 'idle', speed: 0, seat };
  assert.ok(view.enrol(f, { ...settlerLook('sitter', 'sonnet'), presentation: 'man', outfit: 'trousers', height: 1, build: 1 }, 'adult'));
  view.draw(new Map([[f.id, f]]), 1 / 60);
  return { f, torso, leftLeg, rightLeg };
}

// The lowest point of one instance of a batch, in the scene.
function lowest(mesh, slot = 0) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(slot, m);
  const pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < pos.count; i++) min = Math.min(min, v.fromBufferAttribute(pos, i).applyMatrix4(m).y);
  return min;
}

test('sit is drawn only: it is not a word the sea sends', () => {
  assert.ok(!ANIMS.includes('sit'));
});

test('on a bench the hips sink into the plank and the feet stay out of the floor', () => {
  const { f, torso, leftLeg, rightLeg } = seated({ h: 0.135 });
  const m = new THREE.Matrix4(), at = new THREE.Vector3();
  torso.getMatrixAt(0, m);
  at.setFromMatrixPosition(m);
  const pose = sitPose(f, 0);
  assert.ok(Math.abs(pose.bob - (0.135 - 0.02 - 0.14)) < 0.005, `the body drops ${pose.bob}`);
  assert.ok(Math.abs(at.y - (0.06 + pose.bob)) < 0.01, `torso origin at ${at.y}`);
  for (const leg of [leftLeg, rightLeg]) assert.ok(lowest(leg) >= 0.06 - 0.001, `a foot at ${lowest(leg)}`);
  assert.ok(pose.legL < -0.5, 'the legs go forward off the bench');
});

test('on a stool the feet rest on its ring', () => {
  const { leftLeg, rightLeg } = seated({ h: 0.19, rest: 0.06 });
  for (const leg of [leftLeg, rightLeg]) assert.ok(lowest(leg) >= 0.09 - 0.001, `over the ring: ${lowest(leg)}`);
});

test('a seat too high leaves the legs hanging straight', () => {
  const { f } = seated({ h: 0.4 });
  const pose = sitPose(f, 0);
  assert.equal(pose.legL, -0);
});

test('sitting never moves the figure itself', () => {
  const { f } = seated({ h: 0.135 });
  assert.deepEqual(f.pos, [0.4, -0.3]);
  assert.equal(f.y, 0.06);
});

test('the nod keeps time when there is a tune', () => {
  const { f } = seated({ h: 0.135 });
  f.beat = 3.0;
  const on = sitPose(f, 0).lean;
  f.beat = 3.5;
  const off = sitPose(f, 0).lean;
  assert.ok(on > off, 'the head goes down on the count');
});

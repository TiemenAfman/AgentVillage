// Object Distance on the CPU (web/js/record-cull.js): a record is taken out of the picture
// by a layer mask once the fog has closed over it, and put back exactly as it was. Driven with
// real three.js objects rather than stand-ins, because what matters is what three reads:
// `layers.test` for the colour pass, the shadow pass and the raycaster, and the light list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const THREE = await import('three');
const { keepRecord, maskGroup, unmaskGroup, seenThroughFog } = await import('../web/js/record-cull.js');
const { CULL_PAD } = await import('../web/js/fade.js');

const eye = new THREE.Vector3(0, 0, 0);
const camera = new THREE.PerspectiveCamera();
function record(x, extras = []) {
  const group = new THREE.Group();
  group.position.set(x, 0, 0);
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const roof = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  body.add(roof);
  group.add(body, ...extras);
  group.updateMatrixWorld(true);
  return { rec: { group }, body, roof };
}
const drawn = (o) => o.layers.test(camera.layers);

test('near stays drawn, past the range plus the pad goes, and comes back as it was', () => {
  const { rec, body, roof } = record(50);
  assert.equal(keepRecord(rec, 60, eye), true);
  assert.ok(drawn(body) && drawn(roof));
  // Past the range but inside the pad: still drawn (the fog is still closing over its edge).
  rec.group.position.x = 60 + CULL_PAD - 1; rec.group.updateMatrixWorld(true);
  assert.equal(keepRecord(rec, 60, eye), true);
  rec.group.position.x = 60 + CULL_PAD + 1; rec.group.updateMatrixWorld(true);
  assert.equal(keepRecord(rec, 60, eye), false);
  // Every object under it, the grandchild too, matches no camera.
  assert.ok(!drawn(rec.group) && !drawn(body) && !drawn(roof));
  // group.visible is state that belongs to applyVisibility, and is never touched.
  assert.equal(rec.group.visible, true);
  // Back in: the mask each one had, restored.
  rec.group.position.x = 50; rec.group.updateMatrixWorld(true);
  assert.equal(keepRecord(rec, 60, eye), true);
  assert.ok(drawn(rec.group) && drawn(body) && drawn(roof));
  assert.equal(body.userData.cullMask, undefined);
});

test('a range of 0 (the planner) lets everything back in', () => {
  const { rec, body } = record(500);
  assert.equal(keepRecord(rec, 60, eye), false);
  assert.equal(keepRecord(rec, 0, eye), true);
  assert.ok(drawn(body));
});

test('a light is turned down, not taken out of the light list', () => {
  // three builds its light list from what passes the layer test, and the light count is part
  // of every lit program's key: a masked campfire recompiled every material on screen.
  const lamp = new THREE.PointLight(0xff9a40, 2.4, 5, 2);
  const { rec } = record(500, [lamp]);
  assert.equal(keepRecord(rec, 60, eye), false);
  assert.ok(drawn(lamp), 'the light left the light list');
  assert.equal(lamp.intensity, 0);
  rec.group.position.x = 10; rec.group.updateMatrixWorld(true);
  assert.equal(keepRecord(rec, 60, eye), true);
  assert.equal(lamp.intensity, 2.4);
});

test('a record with a part the fog never covers is a landmark and never cut', () => {
  // A lighthouse's beam and a campfire's flame are fog: false on purpose; "cut in full fog"
  // means nothing for them, and masking one made it vanish at the line.
  const beam = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ fog: false }));
  const { rec, body } = record(5000, [beam]);
  assert.equal(seenThroughFog(rec.group), true);
  assert.equal(keepRecord(rec, 60, eye), true);
  assert.ok(drawn(body) && drawn(beam));
  assert.equal(seenThroughFog(record(10).rec.group), false);
});

test('what is added to a record while it is out is masked too, deep ones included', () => {
  const { rec, roof } = record(500);
  assert.equal(keepRecord(rec, 60, eye), false);
  // A nameplate on the group itself: caught on the next frame.
  const sign = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  rec.group.add(sign);
  keepRecord(rec, 60, eye);
  assert.ok(!drawn(sign));
  // A part added a level down: caught within the deep walk's period.
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  roof.add(chimney);
  for (let i = 0; i < 30; i++) keepRecord(rec, 60, eye);
  assert.ok(!drawn(chimney));
  // And all of it comes back.
  rec.group.position.x = 10; rec.group.updateMatrixWorld(true);
  keepRecord(rec, 60, eye);
  assert.ok(drawn(sign) && drawn(chimney));
});

test('a rebuilt record starts over with the group it has now', () => {
  const { rec } = record(500);
  keepRecord(rec, 60, eye);
  const old = rec.group;
  const fresh = record(10).rec.group;
  rec.group = fresh;
  assert.equal(keepRecord(rec, 60, eye), true);
  assert.equal(rec.cull, null);
  // The old group is left as it was: it has been thrown away with its record.
  assert.ok(!drawn(old));
});

test('mask and unmask are exact inverses, and keep a mask somebody else set', () => {
  const { rec, body } = record(0);
  body.layers.set(3);
  maskGroup(rec.group); maskGroup(rec.group);
  assert.equal(body.layers.mask, 0);
  unmaskGroup(rec.group);
  assert.equal(body.layers.mask, 1 << 3);
  unmaskGroup(rec.group);
  assert.equal(body.layers.mask, 1 << 3);
});

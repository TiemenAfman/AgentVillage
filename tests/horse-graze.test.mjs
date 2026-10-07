// A grazing horse gets its muzzle onto the grass (fauna.js HORSE_GRAZE, horse-rig.js poseHorse):
// its neck and head alone came a hand short, ~1.2 m in the island's metres, so it also leans onto
// its forehand and sinks a little. Measured on the skinned vertices, as they are drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { createAnimal, stepPose, applyPose } = await import('../web/js/fauna.js');
const { createMount } = await import('../web/js/mount.js');
delete globalThis.document;

const v = new THREE.Vector3();
let lowZ = 0, lowX = 0;
function lowest(joints, name) {
  let y = Infinity;
  for (const j of joints) {
    if (!j.name.endsWith(name)) continue;
    const m = j.pivot.children[0], p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      if (v.y < y) { y = v.y; lowZ = v.z; lowX = v.x; }
    }
  }
  return y;
}
const soles = (rig) => rig.legs.map((l) => l.hoof.localToWorld(new THREE.Vector3(0, -l.sole, 0)).y);

test('the stable horse grazes with its muzzle on the grass and all four hooves down', () => {
  const horse = createAnimal('horse', new THREE.MeshBasicMaterial(), { area: { x: 0, z: 0, r: 0 }, seed: 'graze' });
  for (let i = 0; i < 600; i++) stepPose('horse', horse.pose, { act: 'feed' }, 1 / 60);
  applyPose(horse, 0, 0, 0); horse.object.updateMatrixWorld(true);
  const muzzle = lowest(horse.joints, 'head');
  assert.ok(muzzle > -0.005 && muzzle < 0.02, `muzzle ${muzzle.toFixed(3)} over the grass`);
  // Out in front, the neck reaching forward: not curled in between the forelegs (z 0.175).
  const ahead = lowX * Math.sin(horse.yaw) + lowZ * Math.cos(horse.yaw);
  assert.ok(ahead > 0.28, `muzzle ${ahead.toFixed(3)} ahead`);
  for (const y of soles(horse.horseRig)) assert.ok(Math.abs(y) < 0.001, `a hoof at ${y}`);
  // And up again: standing, the head is back where it was.
  for (let i = 0; i < 600; i++) stepPose('horse', horse.pose, { act: 'still' }, 1 / 60);
  applyPose(horse, 0, 0, 0); horse.object.updateMatrixWorld(true);
  assert.ok(lowest(horse.joints, 'head') > 0.25, 'the head comes up again');
  horse.dispose();
});

test('a ridden horse grazes when it stands and is told to, and never at a trot', () => {
  const mount = createMount({ scene: new THREE.Scene(), material: new THREE.MeshBasicMaterial() });
  mount.place(0, 0, 0, 0);
  for (let i = 0; i < 600; i++) mount.pose({ speed: 0, graze: true }, 1 / 60);
  assert.ok(mount.ride.pose.graze > 0.95, `graze ${mount.ride.pose.graze}`);
  let z = 0;
  for (let i = 0; i < 300; i++) { z += 1.9 / 60; mount.place(0, 0, z, 0); mount.pose({ speed: 1.9, graze: true }, 1 / 60); }
  assert.ok(mount.ride.pose.graze < 0.05, `grazing at a trot ${mount.ride.pose.graze}`);
  mount.dispose();
});

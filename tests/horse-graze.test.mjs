// A grazing horse puts its head down the way a horse does (fauna.js HORSE_GRAZE, horse-rig.js
// poseHorse): the face hanging plumb with the lips towards the grass, out in front of the forelegs,
// the forelegs straight and every hoof down. Measured on the muzzle's own tip and the poll as they
// are drawn (skinned): a first version was checked by the lowest point of the head, which was the
// forelock of a head bent round to point at the forelegs, over fore knees folded as if kneeling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { createAnimal, stepPose, applyPose } = await import('../web/js/fauna.js');
const { createMount } = await import('../web/js/mount.js');
delete globalThis.document;

const DEG = 180 / Math.PI;
const v = new THREE.Vector3();
const soles = (rig) => rig.legs.map((l) => l.hoof.localToWorld(new THREE.Vector3(0, -l.sole, 0)).y);

// The head's skinned mesh, and in it the muzzle's tip (the most forward vertex below the eye)
// and the poll (the top of the skull on the midline), found in the rest pose.
function headMarks(horse) {
  horse.yaw = 0; applyPose(horse, 0, 0, 0); horse.object.updateMatrixWorld(true);
  const m = horse.joints.find((j) => j.name.endsWith('head')).pivot.children[0];
  const p = m.geometry.attributes.position;
  let tip = -1, tz = -Infinity, poll = -1, py = -Infinity;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
    if (v.y < 0.6 && v.z > tz) { tz = v.z; tip = i; }
    if (v.z > 0.27 && v.z < 0.31 && Math.abs(v.x) < 0.01 && v.y > py) { py = v.y; poll = i; }
  }
  const at = (i) => { v.fromBufferAttribute(p, i); m.applyBoneTransform(i, v); return v.applyMatrix4(m.matrixWorld).clone(); };
  return { m, p, at, tip, poll };
}

test('the stable horse grazes with its face hanging plumb over the grass, forelegs straight', () => {
  const horse = createAnimal('horse', new THREE.MeshBasicMaterial(), { area: { x: 0, z: 0, r: 0 }, seed: 'graze' });
  for (let i = 0; i < 60; i++) stepPose('horse', horse.pose, { act: 'still' }, 1 / 60);
  const H = headMarks(horse);
  for (let i = 0; i < 600; i++) stepPose('horse', horse.pose, { act: 'feed' }, 1 / 60);
  horse.yaw = 0; applyPose(horse, 0, 0, 0); horse.object.updateMatrixWorld(true);
  const tip = H.at(H.tip), poll = H.at(H.poll);
  // The face's line, poll to muzzle, from the horizontal: 90 is plumb, past it the head is tucked.
  const face = Math.atan2(poll.y - tip.y, tip.z - poll.z) * DEG;
  assert.ok(face > 75 && face < 100, `face at ${face.toFixed(0)} degrees`);
  assert.ok(tip.z > 0.28, `muzzle ${tip.z.toFixed(3)} ahead, not between the forelegs (z 0.175)`);
  assert.ok(tip.y < 0.1, `lips ${tip.y.toFixed(3)} over the grass`);
  let low = Infinity;
  for (let i = 0; i < H.p.count; i++) low = Math.min(low, H.at(i).y);
  assert.ok(low > -0.005, `the head ${low.toFixed(3)} into the ground`);
  for (const l of horse.horseRig.legs.filter((l) => l.front)) {
    const knee = new THREE.Euler().setFromQuaternion(l.lower.quaternion).x;
    assert.ok(Math.abs(knee) < 0.1, `a fore knee bent ${knee.toFixed(2)} rad`);
  }
  for (const y of soles(horse.horseRig)) assert.ok(Math.abs(y) < 0.001, `a hoof at ${y}`);
  // And up again: standing, the head is back where it was.
  for (let i = 0; i < 600; i++) stepPose('horse', horse.pose, { act: 'still' }, 1 / 60);
  horse.yaw = 0; applyPose(horse, 0, 0, 0); horse.object.updateMatrixWorld(true);
  assert.ok(H.at(H.tip).y > 0.25, 'the head comes up again');
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

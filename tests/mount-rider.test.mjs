// The rider rides the horse rather than being bolted to it (mount.js carry / stepRider): his
// hips stay on the saddle, his pelvis takes only part of the gallop's rock, his body gets a
// half seat in the gallop and his hands follow the horse's head. Copying the horse's whole
// quaternion onto him, as every caller did, swung his head through the rock like a stick's end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { createMount, MOUNT, MOUNT_TOP, MOUNT_GALLOP, PELVIS_SHARE } = await import('../web/js/mount.js');
delete globalThis.document;

const HIP_Y = 0.5, PERCH = 0.045, dt = 1 / 60;

function gallop(speed, seconds) {
  const mat = new THREE.MeshBasicMaterial();
  const horse = createMount({ scene: new THREE.Scene(), material: mat });
  const rider = new THREE.Object3D();
  const out = { horsePitch: [], riderPitch: [], off: 0, lean: [], arm: [], lift: [] };
  let z = 0;
  for (let i = 0; i < seconds / dt; i++) {
    z += speed * dt;
    horse.place(0, 0, z, 0);
    horse.pose({ speed }, dt);
    const m = horse.carry(rider, HIP_Y, PERCH, dt);
    rider.updateMatrixWorld(true);
    if (i < 120) continue;
    const hips = new THREE.Vector3(0, HIP_Y, 0).applyMatrix4(rider.matrixWorld);
    const saddle = new THREE.Vector3(0, MOUNT.seat + PERCH, 0).applyMatrix4(horse.object.matrixWorld);
    out.off = Math.max(out.off, Math.hypot(hips.x - saddle.x, hips.z - saddle.z));
    out.lift.push(hips.y - saddle.y);
    out.horsePitch.push(horse.object.rotation.x);
    out.riderPitch.push(rider.rotation.x);
    out.lean.push(m.lean); out.arm.push(m.arm);
  }
  horse.dispose(); mat.dispose();
  return out;
}
const span = (a) => Math.max(...a) - Math.min(...a);

test('in the gallop the rider sits the saddle, takes only part of the rock and goes into a half seat', () => {
  const g = gallop(MOUNT_TOP * MOUNT_GALLOP, 6);
  assert.ok(span(g.horsePitch) > 0.15, `the horse rocks ${span(g.horsePitch)}`);
  assert.ok(Math.abs(span(g.riderPitch) - PELVIS_SHARE * span(g.horsePitch)) < 1e-6, 'the pelvis takes its share');
  assert.ok(g.off < 0.003, `hips ${g.off} off the saddle along the ground`);
  assert.ok(Math.min(...g.lift) >= 0, 'never into the saddle');
  assert.ok(Math.max(...g.lift) < 0.04, `hips ${Math.max(...g.lift)} over the saddle`);
  assert.ok(Math.min(...g.lift) > 0.005, 'a half seat: the hips stay off the leather');
  const lean = g.lean.reduce((s, v) => s + v, 0) / g.lean.length;
  assert.ok(lean > 0.25 && lean < 0.35, `forward over the withers ${lean}`);
  assert.ok(span(g.arm) > 0.05, `the hands give with the head ${span(g.arm)}`);
});

test('at the trot he sits it: no half seat, a lift on each diagonal, upright', () => {
  const t = gallop(MOUNT_TOP, 6);
  const lean = t.lean.reduce((s, v) => s + v, 0) / t.lean.length;
  assert.ok(lean < 0.1, `trot lean ${lean}`);
  assert.ok(span(t.lift) > 0.0005 && Math.max(...t.lift) < 0.02, `trot bounce ${span(t.lift)}`);
  assert.ok(Math.min(...t.lift) >= 0);
});

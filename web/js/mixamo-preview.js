// A Mixamo clip, loaded as an FBX by three's FBXLoader, turned into the shape a baked clip has
// (web/js/gait-clips.js) so the rig can play it as it plays those - for the motion workbench's
// catalogue only (web/js/mixamo-catalogue.js). It is scripts/bake-mixamo-gait.py's `measure`
// written again on three's objects, for a clip played by time:
//
//   - a joint's change is its world rotation now against its world rotation at rest, D = W W0^-1,
//     and what it turns by itself is that against its parent's, L = Dparent^-1 D;
//   - the arm and leg chains' rests (Mixamo's T-pose) are first turned to hang straight down;
//   - the clip faces the way its hips face at its first frame (LeftUpLeg - RightUpLeg is the left);
//   - the collarbones keep only their swing about their mean, the arm takes the rest;
//   - three's frame is Blender's turned (x, -z, y), so the bake's to_rig, (w, x, -z, y) of
//     Blender's, is (w, x, -y, -z) here: the rig's mirror.
//
// What it leaves out is what the bake does per kind of clip - a gait's stride and contact, a
// climb's rise, a step's way, the swim's lean - so a clip seen here is a fair likeness, and the
// bake gives the final one. It also hands back how far the hips go over the floor (`travel`, in
// hip heights), which the workbench may move the body by when In Place is off.
import * as THREE from 'three';
import { GAIT_JOINTS } from './gait-clips.js';

// The bake's map: our joint -> the Mixamo bone it turns with, and its parent's.
const JOINTS = {
  pelvis: ['Hips', null], spine: ['Spine1', 'Hips'], chest: ['Spine2', 'Spine1'],
  neck: ['Neck', 'Spine2'], head: ['Head', 'Neck'],
};
for (const [s, k] of [['Left', 'l'], ['Right', 'r']]) {
  Object.assign(JOINTS, {
    [k + 'Clavicle']: [s + 'Shoulder', 'Spine2'], [k + 'Arm']: [s + 'Arm', s + 'Shoulder'],
    [k + 'Elbow']: [s + 'ForeArm', s + 'Arm'], [k + 'Wrist']: [s + 'Hand', s + 'ForeArm'],
    [k + 'Hip']: [s + 'UpLeg', 'Hips'], [k + 'Knee']: [s + 'Leg', s + 'UpLeg'],
    [k + 'Ankle']: [s + 'Foot', s + 'Leg'], [k + 'Toe']: [s + 'ToeBase', s + 'Foot'],
  });
}
const ARM = ['Arm', 'ForeArm', 'Hand'], LEG = ['UpLeg', 'Leg', 'Foot', 'ToeBase'];
// Sampled at the FBX's own 30 frames a second, and never fewer than the bake's 32 a clip.
const RATE = 30, SAMPLES_MIN = 32;

// A bone's Mixamo name without its prefix: FBXLoader drops the colon ("mixamorigHips"), and a
// clip fetched for another character may carry a number ("mixamorig1:Hips").
export function bareName(name) {
  return String(name).replace(/^mixamorig\d*:?/, '');
}

export function bonesOf(root) {
  const bones = {};
  root.traverse((o) => { if (o.isBone || o.type === 'Bone' || /mixamorig/.test(o.name)) bones[bareName(o.name)] = o; });
  return bones;
}

// The clip `anim` on the skeleton under `root` (both what FBXLoader gave), as
// { source, seconds, rows, travel, frames }: `rows` as gait-clips.js has them, a quaternion per
// joint of GAIT_JOINTS then the hips' drop in leg lengths; `travel` per row [x, z] of the hips over
// the floor from where they start, in the clip's heading, in hip heights.
export function previewClip(root, anim, { source = anim.name } = {}) {
  const bones = bonesOf(root);
  for (const [b] of Object.values(JOINTS)) if (!bones[b]) throw new Error(`not a Mixamo skeleton: no ${b}`);
  const mixer = new THREE.AnimationMixer(root);
  root.updateMatrixWorld(true);
  const W = (n) => bones[n].getWorldQuaternion(new THREE.Quaternion());
  const P = (n) => bones[n].getWorldPosition(new THREE.Vector3());
  // Rest, before the clip has touched anything, and the arm and leg chains turned to hang down.
  const rest = {};
  for (const n of Object.keys(bones)) rest[n] = W(n);
  const down = new THREE.Vector3(0, -1, 0);
  for (const s of ['Left', 'Right']) {
    for (const [chain, top, next] of [[ARM, s + 'Arm', s + 'ForeArm'], [LEG, s + 'UpLeg', s + 'Leg']]) {
      const align = new THREE.Quaternion().setFromUnitVectors(P(next).sub(P(top)).normalize(), down);
      for (const n of chain) if (rest[s + n]) rest[s + n].premultiply(align);
    }
  }
  const restHips = P('Hips').y;
  const leg = P('LeftUpLeg').distanceTo(P('LeftLeg')) + P('LeftLeg').distanceTo(P('LeftFoot'));
  const action = mixer.clipAction(anim);
  action.play();
  const seconds = anim.duration;
  const at = (t) => { mixer.setTime(t); root.updateMatrixWorld(true); };
  // Faces the way its hips face at its start: the left (LeftUpLeg - RightUpLeg) turned onto +x.
  at(0);
  const across = P('LeftUpLeg').sub(P('RightUpLeg'));
  const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(across.z, across.x));
  const start = P('Hips');
  const n = Math.max(SAMPLES_MIN, Math.round(seconds * RATE));
  const rows = [], travel = [];
  const inv = {};
  for (const n2 of Object.keys(rest)) inv[n2] = rest[n2].clone().invert();
  for (let i = 0; i < n; i++) {
    // read to the last frame: the catalogue plays a clip once through (sampleOnce), or loops it
    at(seconds * i / (n - 1));
    const delta = {};
    for (const [b, parent] of Object.values(JOINTS)) {
      for (const name of parent ? [b, parent] : [b]) {
        if (!delta[name]) delta[name] = heading.clone().multiply(W(name)).multiply(inv[name]);
      }
    }
    const local = {};
    for (const name of GAIT_JOINTS) {
      const [b, parent] = JOINTS[name];
      local[name] = parent ? delta[parent].clone().invert().multiply(delta[b]) : delta[b].clone();
    }
    const hips = P('Hips');
    rows.push({ local, z: hips.y });
    const moved = hips.sub(start).applyQuaternion(heading);
    travel.push([moved.x / restHips, moved.z / restHips]);
  }
  // The collarbones' mean taken out, the arm turned by what it loses (the bake, exactly).
  for (const k of ['l', 'r']) {
    const mean = new THREE.Quaternion(0, 0, 0, 0), first = rows[0].local[k + 'Clavicle'];
    for (const { local } of rows) {
      const q = local[k + 'Clavicle'], s = q.dot(first) < 0 ? -1 : 1;
      mean.set(mean.x + s * q.x, mean.y + s * q.y, mean.z + s * q.z, mean.w + s * q.w);
    }
    mean.normalize();
    const meanInv = mean.clone().invert();
    for (const { local } of rows) {
      const K = local[k + 'Clavicle'], swing = meanInv.clone().multiply(K);
      local[k + 'Arm'] = swing.clone().invert().multiply(K).multiply(local[k + 'Arm']);
      local[k + 'Clavicle'] = swing;
    }
  }
  const baked = rows.map(({ local, z }) => {
    const row = [];
    for (const name of GAIT_JOINTS) {
      const q = local[name];
      // to_rig: (w, x, -y, -z) in three's axes, w kept positive
      const sgn = q.w < 0 ? -1 : 1;
      row.push(sgn * q.x, -sgn * q.y, -sgn * q.z, sgn * q.w);
    }
    row.push((restHips - z) / leg);
    return row;
  });
  action.stop();
  mixer.uncacheRoot(root);
  return { source, seconds, contact: 0, rows: baked, travel, frames: n };
}

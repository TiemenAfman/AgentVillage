// Talking to a settler face to face. A conversation used to open a panel about somebody
// who was nowhere in sight: you addressed a name, read a transcript, and the person whose
// transcript it was went on scurrying about their own doorstep off screen. This puts them
// in front of you for as long as you are talking, seen from your own eyes, and hands the
// island back exactly as it found it when you are done.
//
// It owns the camera outright while it runs, which is why walk mode is paused around it
// (see `talkTo` in main.js): two writers on one camera fight, and the loser stutters.
import * as THREE from 'three';
import { clamp } from 'shared/rng.mjs';
import { eyeHeight } from './settlers.js';
import { PLAYER_EYE } from './avatar.js';

// Player eyes come from the Blender figure; NPC eyes retain their own proportions.
const STANDARD_EYE = eyeHeight();

// How far away you stand from somebody you are talking to, for a settler of standard
// height, and the closest the camera will ever come to anyone. At this distance the head
// and shoulders sit in the middle of the island's 45° frame with the whole of the figure
// still inside it - and it clears the camera's 0.5 near plane, which would otherwise
// slice the face in half. The distance is scaled by how tall they actually are, so a
// tall settler is not framed tighter than a short one and an apprentice is approached
// closely enough to be seen at all.
const TALK_DIST = 0.95;
const MIN_DIST = 0.62;
const STEP_BACK = 0.45;
// Long enough to read as a movement rather than a cut, short enough not to keep you
// waiting for a conversation you have already asked for.
const MOVE_IN = 0.55;
const MOVE_OUT = 0.4;
// Once there the pose is followed rather than snapped to, so a shoulder still coming
// round towards you, or a window being resized, glides instead of jumping.
const FOLLOW = 9;
// The chat panel sits against the right edge, so the face goes in the middle of the
// island that is left over beside it. On a narrow window that strip is almost nothing,
// and aiming at the centre of it would walk the settler clean out of frame, so the shift
// stops at half a screen: an edge of the panel over a shoulder beats an empty view.
const MAX_SHIFT = 0.5;

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// `reserved` says how many pixels along the right edge are covered by something you are
// meant to be reading. It is asked every frame because a panel's width is only known once
// it is on screen, and it changes with the window.
export function createFaceToFace({ camera, reserved = () => 0 }) {
  const UP = new THREE.Vector3(0, 1, 0);
  const head = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wantPos = new THREE.Vector3();
  const wantAt = new THREE.Vector3();
  const wantQuat = new THREE.Quaternion();
  const look = new THREE.Matrix4();
  // Where the camera is coming from, and where it is to be put back. Usually the same
  // pose; they differ when getting to the conversation is what moved it in the first
  // place, which is what the dossier's "Talk to them" does.
  const fromPos = new THREE.Vector3();
  const fromQuat = new THREE.Quaternion();
  const homePos = new THREE.Vector3();
  const homeQuat = new THREE.Quaternion();

  let phase = 'off';        // off | in | held | out
  let t = 0;
  let subject = null;       // the figure being spoken to, live out of settlers.js
  let viewer = null;        // where your own feet are standing
  let onLetGo = null;
  let onReturned = null;

  // The pose the conversation wants of the camera, worked out in full every frame.
  function want() {
    const eye = eyeHeight(subject);
    head.set(subject.pos[0], subject.y + eye, subject.pos[1]);
    // The side of them you walked up to is the side you keep: the camera stands on the
    // line between the two of you rather than choosing a flattering angle of its own.
    dir.set(viewer.x - subject.pos[0], 0, viewer.z - subject.pos[1]);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);      // standing on their toes: any side will do
    const apart = Math.hypot(dir.x, dir.z);
    dir.divideScalar(apart);
    // Half a step back is allowed, and no more: standing almost on top of somebody - which
    // is where the walk over from the dossier can leave you, since walk mode shoves you out
    // of anything solid in a direction of its own - would otherwise frame their chest. A
    // camera that reached any further back than that would end up through the wall you are
    // standing against.
    const standoff = Math.max(MIN_DIST, TALK_DIST * (eye / STANDARD_EYE));
    const d = Math.max(MIN_DIST, Math.min(standoff, apart + STEP_BACK));
    wantPos.set(head.x + dir.x * d, viewer.feetY + PLAYER_EYE, head.z + dir.z * d);
    // Aiming beside somebody is how you get them off the middle of the screen: moving the
    // aim to the camera's right moves them to its left, by exactly the fraction of the
    // half-frame the panel has taken. The height, though, stays their eyes - not the
    // crown, which is what aiming at a plot and adding a settler's height gives you.
    const w = Math.max(1, window.innerWidth || 1);
    const shift = clamp((w - reserved()) / w - 1, -MAX_SHIFT, 0);
    const halfFrame = Math.tan((camera.fov * Math.PI) / 360) * camera.aspect * d;
    right.set(dir.z, 0, -dir.x);                      // the camera's right hand, looking back along dir
    wantAt.copy(head).addScaledVector(right, -shift * halfFrame);
    look.lookAt(wantPos, wantAt, UP);
    wantQuat.setFromRotationMatrix(look);
  }

  function letGo() {
    if (!onLetGo) return;
    const go = onLetGo;
    onLetGo = null;
    go();
  }

  function finish() {
    phase = 'off';
    subject = null;
    viewer = null;
    const done = onReturned;
    onReturned = null;
    if (done) done();
  }

  // Take the camera. `home` is where to put it back when that is not simply where it is
  // now. `viewer` is your feet: { x, z, feetY }, the eye height is added here.
  function begin({ subject: who, viewer: feet, home = null, onLetGo: go = null }) {
    if (!who || !feet) return false;
    subject = who;
    viewer = feet;
    onLetGo = go;
    onReturned = null;
    fromPos.copy(camera.position);
    fromQuat.copy(camera.quaternion);
    homePos.copy(home ? home.position : camera.position);
    homeQuat.copy(home ? home.quaternion : camera.quaternion);
    phase = 'in';
    t = 0;
    return true;
  }

  // Give it back, and say who to tell once it is home. The settler is let go of straight
  // away, so they are already turning back to their own business while the camera pulls
  // off them - which is what makes the end of a conversation look like the end of one.
  function end(back = null) {
    if (phase === 'off') return false;
    letGo();
    onReturned = back;
    fromPos.copy(camera.position);
    fromQuat.copy(camera.quaternion);
    phase = 'out';
    t = 0;
    return true;
  }

  // The island has moved on and the camera is wanted elsewhere - flying up to the sky,
  // say. No walk back, and nobody is told it arrived, because it is not going there.
  function cancel() {
    if (phase === 'off') return false;
    letGo();
    phase = 'off';
    subject = null;
    viewer = null;
    onReturned = null;
    return true;
  }

  function update(dt) {
    if (phase === 'off') return false;
    if (phase === 'out') {
      t += dt;
      const k = ease(clamp(t / MOVE_OUT, 0, 1));
      camera.position.lerpVectors(fromPos, homePos, k);
      camera.quaternion.slerpQuaternions(fromQuat, homeQuat, k);
      if (t >= MOVE_OUT) finish();
      return true;
    }
    want();
    if (phase === 'in') {
      t += dt;
      const k = ease(clamp(t / MOVE_IN, 0, 1));
      camera.position.lerpVectors(fromPos, wantPos, k);
      camera.quaternion.slerpQuaternions(fromQuat, wantQuat, k);
      if (t >= MOVE_IN) phase = 'held';
    } else {
      const a = 1 - Math.exp(-FOLLOW * dt);
      camera.position.lerp(wantPos, a);
      camera.quaternion.slerp(wantQuat, a);
    }
    return true;
  }

  return { begin, end, cancel, update, isActive: () => phase !== 'off' };
}

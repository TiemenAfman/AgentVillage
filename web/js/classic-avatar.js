// A tiny procedural rig for the original Blender avatar. The source model already keeps
// each arm and leg as named objects; avatar.js normally merges them for one draw call.
// Here those same objects sit below four pivots so the old look can use real strides.
import * as THREE from 'three';
import { SETTLER_PARTS } from './settler-mesh.js';
import { avatarPlayerComponentGeometry, PLAYER_SCALE } from './avatar.js';

const LIMBS = {
  leftLeg: ['Left boot', 'Left trousers', 'Left stocking cuff'],
  rightLeg: ['Right boot', 'Right trousers', 'Right stocking cuff'],
  leftArm: ['Left sleeve', 'Left cuff', 'Left hand'],
  rightArm: ['Right sleeve', 'Right cuff', 'Right hand'],
};
const MOVING = new Set(Object.values(LIMBS).flat());
const CORE = SETTLER_PARTS.map(({ name }) => name).filter((name) => !MOVING.has(name));
const PIVOTS = {
  leftLeg: [-0.052 * PLAYER_SCALE, 0.14 * PLAYER_SCALE, 0],
  rightLeg: [0.052 * PLAYER_SCALE, 0.14 * PLAYER_SCALE, 0],
  leftArm: [-0.105 * PLAYER_SCALE, 0.285 * PLAYER_SCALE, 0],
  rightArm: [0.105 * PLAYER_SCALE, 0.285 * PLAYER_SCALE, 0],
};

function damp(from, to, speed, dt) {
  return THREE.MathUtils.lerp(from, to, 1 - Math.exp(-speed * dt));
}

export function createClassicAvatar(spec, material) {
  const object = new THREE.Group();
  const pieces = {};

  function makePiece(name, names) {
    const pivot = new THREE.Group();
    const at = PIVOTS[name] || [0, 0, 0];
    pivot.position.set(...at);
    const geometry = avatarPlayerComponentGeometry(spec, names);
    geometry.translate(-at[0], -at[1], -at[2]);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    pivot.add(mesh);
    object.add(pivot);
    pieces[name] = { pivot, mesh, names, at };
  }

  makePiece('core', CORE);
  for (const [name, names] of Object.entries(LIMBS)) makePiece(name, names);

  let time = 0;
  function update(pose, dt) {
    time += dt;
    const moving = pose.moving && pose.grounded && !pose.sitting && !pose.lying;
    const phase = pose.phase;
    const stride = moving ? Math.sin(phase) * (pose.running ? 0.82 : 0.5) : 0;
    const idle = moving ? 0 : Math.sin(time * 1.8) * 0.035;
    const airborne = pose.grounded ? 0 : 0.32;
    const crouch = pose.crouching ? -0.28 : 0;
    const sit = pose.sitting ? -1.05 : 0;
    const targets = {
      leftLeg: sit || (stride + airborne + crouch),
      rightLeg: sit || (-stride - airborne + crouch),
      leftArm: moving ? -stride * 0.9 : idle,
      rightArm: moving ? stride * 0.9 : -idle,
    };
    for (const [name, target] of Object.entries(targets)) {
      pieces[name].pivot.rotation.x = damp(pieces[name].pivot.rotation.x, target, 15, dt);
    }
    pieces.leftArm.pivot.rotation.z = damp(pieces.leftArm.pivot.rotation.z, pose.running ? -0.12 : 0, 12, dt);
    pieces.rightArm.pivot.rotation.z = damp(pieces.rightArm.pivot.rotation.z, pose.running ? 0.12 : 0, 12, dt);
    pieces.core.pivot.position.y = Math.sin(time * 2.2) * (moving ? 0 : 0.0025);
  }

  function set(next) {
    for (const piece of Object.values(pieces)) {
      const geometry = avatarPlayerComponentGeometry(next, piece.names);
      geometry.translate(-piece.at[0], -piece.at[1], -piece.at[2]);
      piece.mesh.geometry.dispose();
      piece.mesh.geometry = geometry;
    }
  }

  function dispose() {
    for (const piece of Object.values(pieces)) piece.mesh.geometry.dispose();
  }

  return { object, update, set, dispose };
}

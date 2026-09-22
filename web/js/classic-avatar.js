// A tiny procedural rig for the original Blender avatar. The source model already keeps
// each arm and leg as named objects; avatar.js normally merges them for one draw call.
// Here those same objects sit below four pivots so the old look can use real strides.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SETTLER_PARTS } from './settler-mesh.js';
import { avatarPlayerComponentGeometry, PLAYER_SCALE } from './avatar.js';
import { cylinder, cone, sphere } from './buildings.js';

const LIMBS = {
  leftLeg: ['Left boot', 'Left trousers', 'Left stocking cuff'],
  rightLeg: ['Right boot', 'Right trousers', 'Right stocking cuff'],
  leftArm: ['Left sleeve', 'Left cuff', 'Left hand'],
  rightArm: ['Right sleeve', 'Right cuff', 'Right hand'],
};
const MOVING = new Set(Object.values(LIMBS).flat());
// Every gear-variant part except the hammer (still core, unequippable for now - Plans/
// uitrusting-en-vasthouden.md leaves "what is the first held item" open). Its own piece
// so equip.backpack can hide it without touching the torso it used to be merged into.
const BACKPACK = [
  'Shoulder strap', 'Strap over shoulder', 'Shoulder strap.001', 'Strap over shoulder.001',
  'Canvas backpack', 'Backpack flap', 'Pack clasp', 'Bedroll', 'Bedroll tie', 'Bedroll tie.001',
];
const EQUIPPABLE = new Set(BACKPACK);
const CORE = SETTLER_PARTS.map(({ name }) => name).filter((name) => !MOVING.has(name) && !EQUIPPABLE.has(name));
const PIVOTS = {
  leftLeg: [-0.052 * PLAYER_SCALE, 0.14 * PLAYER_SCALE, 0],
  rightLeg: [0.052 * PLAYER_SCALE, 0.14 * PLAYER_SCALE, 0],
  leftArm: [-0.105 * PLAYER_SCALE, 0.285 * PLAYER_SCALE, 0],
  rightArm: [0.105 * PLAYER_SCALE, 0.285 * PLAYER_SCALE, 0],
};
// Where "Right hand" sits, measured off its own raw geometry (bounding-box centre) and
// carried through the same PLAYER_SCALE the pivots already are, minus the rightArm pivot's
// own offset - the same translate makePiece already does to its mesh, done once here by
// hand rather than by loading the part just to throw its geometry away. Not the item's own
// origin, only where an attach point for one belongs; nothing hangs off it yet.
const RIGHT_HAND_ATTACH = [
  0.131 * PLAYER_SCALE - PIVOTS.rightArm[0],
  0.19 * PLAYER_SCALE - PIVOTS.rightArm[1],
  0.018 * PLAYER_SCALE - PIVOTS.rightArm[2],
];

// How far the arm swings to hold something out, measured against the same rotation.x the
// stride already uses (a small fraction of a radian mid-stride, ~-0.28 crouching the legs
// forward) - large enough to read as reaching out rather than a bigger stride, checked in
// the browser rather than derived, because there is no elbow here to make the geometry
// answer the question on its own.
const HOLD_ARM_X = -1.3;

function damp(from, to, speed, dt) {
  return THREE.MathUtils.lerp(from, to, 1 - Math.exp(-speed * dt));
}

// The first held item (Plans/uitrusting-en-vasthouden.md's open "what comes first"
// question) - the same lounge parasol from walk.js's loungeGeometry(), rebuilt at hand
// scale with its handle at the local origin instead of planted in the ground, so it can
// be parented straight onto rightHandAttach. Same colours, so it still reads as the same
// parasol when it moves from the beach towel to the hand.
const PARASOL_POLE = 0x5a3c28, PARASOL_CANOPY = 0xd94f3d, PARASOL_UNDERSIDE = 0xf5efe0, PARASOL_FINIAL = 0xd9a33d;
function parasolGeometry() {
  const parts = [
    cylinder(0.011, 0.013, 0.4, 6, PARASOL_POLE, { y: 0 }),
    cone(0.22, 0.1, 12, PARASOL_CANOPY, { y: 0.4 }),
    cone(0.17, 0.04, 12, PARASOL_UNDERSIDE, { y: 0.39 }),
    sphere(0.016, PARASOL_FINIAL, { y: 0.5 }),
  ];
  const geometry = mergeGeometries(parts, false);
  // buildFigure() gives every avatar part an aSheet attribute, even at zero (see
  // avatar.js) - the material expects it on everything it draws, and these primitives
  // only add one when asked (see finish() in buildings.js), which a plain-coloured item
  // never does.
  const n = geometry.attributes.position.count;
  geometry.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(n), 1));
  geometry.computeVertexNormals();
  return geometry;
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
  makePiece('backpack', BACKPACK);
  pieces.backpack.pivot.visible = spec.equip?.backpack !== false;

  // An empty group, not a mesh: a held item parents onto this and follows the hand's
  // position for free. Not its rotation, though - update() below counter-rotates the item
  // itself, so it swings to wherever the hand is but stays upright the way something
  // actually held in a hand would, instead of tipping over with the arm that carries it.
  const rightHandAttach = new THREE.Group();
  rightHandAttach.position.set(...RIGHT_HAND_ATTACH);
  pieces.rightArm.pivot.add(rightHandAttach);

  let heldMesh = null;
  let holding = false;
  function setHeldItem(item) {
    if (heldMesh) { rightHandAttach.remove(heldMesh); heldMesh.geometry.dispose(); heldMesh = null; }
    holding = !!item;
    if (item === 'parasol') {
      heldMesh = new THREE.Mesh(parasolGeometry(), material);
      heldMesh.castShadow = true;
      rightHandAttach.add(heldMesh);
    }
  }
  setHeldItem(spec.equip?.handItem || null);

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
      // Held out in front rather than swinging with the stride - a parasol on a walking
      // arm would windmill through the body otherwise, and there is no elbow to fold
      // instead.
      rightArm: holding ? HOLD_ARM_X : (moving ? stride * 0.9 : -idle),
    };
    for (const [name, target] of Object.entries(targets)) {
      pieces[name].pivot.rotation.x = damp(pieces[name].pivot.rotation.x, target, 15, dt);
    }
    pieces.leftArm.pivot.rotation.z = damp(pieces.leftArm.pivot.rotation.z, pose.running ? -0.12 : 0, 12, dt);
    pieces.rightArm.pivot.rotation.z = damp(pieces.rightArm.pivot.rotation.z, holding ? 0 : (pose.running ? 0.12 : 0), 12, dt);
    pieces.core.pivot.position.y = Math.sin(time * 2.2) * (moving ? 0 : 0.0025);
    // Cancel the arm pivot's own rotation on the item itself: rightHandAttach carries the
    // hand's position (correct - the grip moves with the arm), but a held item should not
    // also inherit the arm's tilt, or it lies over at whatever angle the arm is held at
    // instead of standing up the way something actually gripped in a hand would.
    if (heldMesh) {
      heldMesh.rotation.x = -pieces.rightArm.pivot.rotation.x;
      heldMesh.rotation.z = -pieces.rightArm.pivot.rotation.z;
    }
  }

  function set(next) {
    for (const piece of Object.values(pieces)) {
      const geometry = avatarPlayerComponentGeometry(next, piece.names);
      geometry.translate(-piece.at[0], -piece.at[1], -piece.at[2]);
      piece.mesh.geometry.dispose();
      piece.mesh.geometry = geometry;
    }
    pieces.backpack.pivot.visible = next.equip?.backpack !== false;
    setHeldItem(next.equip?.handItem || null);
  }

  function dispose() {
    for (const piece of Object.values(pieces)) piece.mesh.geometry.dispose();
    if (heldMesh) heldMesh.geometry.dispose();
  }

  return { object, update, set, dispose, rightHandAttach };
}

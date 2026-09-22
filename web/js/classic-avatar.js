// A tiny procedural rig for the original Blender avatar. The source model already keeps
// each arm and leg as named objects; avatar.js normally merges them for one draw call.
// Here those same objects sit below four pivots so the old look can use real strides.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SETTLER_PARTS } from './settler-mesh.js';
import { avatarPlayerComponentGeometry, PLAYER_SCALE } from './avatar.js';
import { box, cylinder, cone, sphere } from './buildings.js';

const LIMBS = {
  leftLeg: ['Left boot', 'Left trousers', 'Left stocking cuff'],
  rightLeg: ['Right boot', 'Right trousers', 'Right stocking cuff'],
  leftArm: ['Left sleeve', 'Left cuff', 'Left hand'],
  rightArm: ['Right sleeve', 'Right cuff', 'Right hand'],
};
const MOVING = new Set(Object.values(LIMBS).flat());
// Every gear-variant part. Its own piece so equip.backpack can hide it without touching
// the torso it used to be merged into.
const BACKPACK = [
  'Shoulder strap', 'Strap over shoulder', 'Shoulder strap.001', 'Strap over shoulder.001',
  'Canvas backpack', 'Backpack flap', 'Pack clasp', 'Bedroll', 'Bedroll tie', 'Bedroll tie.001',
];
// The baked "Hammer handle"/"Hammer head" (Plans/uitrusting-en-vasthouden.md) used to be
// core - always drawn, parked by the hip whether or not it made sense - which is not where
// a tool that is picked up and put down belongs. Dropped from every geometry group below
// (neither CORE nor BACKPACK) in favour of hammerGeometry(), a hand-held item built the
// same way the parasol is: its own procedural shape with the grip at the local origin, so
// it parents onto handAttach the same as anything else a hand can hold.
const HAMMER = ['Hammer handle', 'Hammer head'];
const EQUIPPABLE = new Set([...BACKPACK, ...HAMMER]);
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
// origin, only where an attach point for one belongs.
const HAND_ATTACH = {
  rightArm: [
    0.131 * PLAYER_SCALE - PIVOTS.rightArm[0],
    0.19 * PLAYER_SCALE - PIVOTS.rightArm[1],
    0.018 * PLAYER_SCALE - PIVOTS.rightArm[2],
  ],
};
// "Left hand" is the mirror of "Right hand" on X and nothing else (checked against the raw
// model: -0.131, 0.19, 0.018) - the arms and their pivots are symmetric, so deriving it
// keeps the two hands from drifting apart if the model ever changes.
HAND_ATTACH.leftArm = [-HAND_ATTACH.rightArm[0], HAND_ATTACH.rightArm[1], HAND_ATTACH.rightArm[2]];

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
// be parented straight onto either hand's attach point. Same colours, so it still reads as the same
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

// The second held item. Same shape and colours as the working hammer settler-figures.js
// swings for a building crew, since it is the same tool - only the origin differs, moved
// from that file's instanced-mesh centre to a grip at the local origin the way every held
// item here works, with the head above the fist and a short butt below it.
const HAMMER_HANDLE = 0x8b5e3c, HAMMER_HEAD = 0x3a3a3f;
function hammerGeometry() {
  const parts = [
    box(0.022, 0.2, 0.022, HAMMER_HANDLE, { y: -0.05 }),
    box(0.075, 0.05, 0.05, HAMMER_HEAD, { y: 0.14 }),
  ];
  const geometry = mergeGeometries(parts, false);
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

  // An empty group per arm, not a mesh: a held item parents onto this and follows the
  // hand's position for free. Not its rotation, though - update() below counter-rotates
  // the item itself, so it swings to wherever the hand is but stays upright the way
  // something actually held in a hand would, instead of tipping over with the arm.
  const handAttach = {}, heldMesh = { leftArm: null, rightArm: null }, holding = { leftArm: false, rightArm: false };
  for (const side of ['leftArm', 'rightArm']) {
    const g = new THREE.Group();
    g.position.set(...HAND_ATTACH[side]);
    pieces[side].pivot.add(g);
    handAttach[side] = g;
  }

  function setHeldItem(side, item) {
    if (heldMesh[side]) { handAttach[side].remove(heldMesh[side]); heldMesh[side].geometry.dispose(); heldMesh[side] = null; }
    holding[side] = !!item;
    if (item === 'parasol') {
      const mesh = new THREE.Mesh(parasolGeometry(), material);
      mesh.castShadow = true;
      handAttach[side].add(mesh);
      heldMesh[side] = mesh;
    } else if (item === 'hammer') {
      const mesh = new THREE.Mesh(hammerGeometry(), material);
      mesh.castShadow = true;
      handAttach[side].add(mesh);
      heldMesh[side] = mesh;
    }
  }
  setHeldItem('leftArm', spec.equip?.leftHandItem || null);
  setHeldItem('rightArm', spec.equip?.rightHandItem || null);

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
      // Held out in front rather than swinging with the stride - an item on a walking arm
      // would windmill through the body otherwise, and there is no elbow to fold instead.
      leftArm: holding.leftArm ? HOLD_ARM_X : (moving ? -stride * 0.9 : idle),
      rightArm: holding.rightArm ? HOLD_ARM_X : (moving ? stride * 0.9 : -idle),
    };
    for (const [name, target] of Object.entries(targets)) {
      pieces[name].pivot.rotation.x = damp(pieces[name].pivot.rotation.x, target, 15, dt);
    }
    pieces.leftArm.pivot.rotation.z = damp(pieces.leftArm.pivot.rotation.z, holding.leftArm ? 0 : (pose.running ? -0.12 : 0), 12, dt);
    pieces.rightArm.pivot.rotation.z = damp(pieces.rightArm.pivot.rotation.z, holding.rightArm ? 0 : (pose.running ? 0.12 : 0), 12, dt);
    pieces.core.pivot.position.y = Math.sin(time * 2.2) * (moving ? 0 : 0.0025);
    // Cancel each arm pivot's own rotation on the item it carries: the attach point gives
    // the item the hand's position (correct - the grip moves with the arm), but a held
    // item should not also inherit the arm's tilt, or it lies over at whatever angle the
    // arm is held at instead of standing up the way something actually gripped would.
    for (const side of ['leftArm', 'rightArm']) {
      if (!heldMesh[side]) continue;
      heldMesh[side].rotation.x = -pieces[side].pivot.rotation.x;
      heldMesh[side].rotation.z = -pieces[side].pivot.rotation.z;
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
    setHeldItem('leftArm', next.equip?.leftHandItem || null);
    setHeldItem('rightArm', next.equip?.rightHandItem || null);
  }

  function dispose() {
    for (const piece of Object.values(pieces)) piece.mesh.geometry.dispose();
    for (const side of ['leftArm', 'rightArm']) if (heldMesh[side]) heldMesh[side].geometry.dispose();
  }

  return { object, update, set, dispose, handAttach };
}

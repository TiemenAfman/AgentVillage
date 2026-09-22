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
// The armour set below (Plans/uitrusting-en-vasthouden.md), all baked in Blender alongside
// the rest of the settler in scripts/build-settler.py - two rounds of code-primitive gear
// (plain boxes, then sharper cone-built shapes) both read wrong next to a model the rest
// of the settler is built from, and neither one could reuse this file's own proportions
// the way build-settler.py's own ball/box/rod calls already do. Chestplate, leggings and
// boots are excluded from CORE below and get their own piece each, same as the backpack;
// the sword and shield are held items, resolved through GRIP below; the helmet is the one
// exception - it stays IN core, because a helmet is an eighth hatShape, not a toggle, and
// buildFigure()'s own variant match already shows exactly one hat at a time.
const CHESTPLATE = ['Chestplate body', 'Chestplate trim', 'Left chestplate pauldron', 'Right chestplate pauldron'];
const LEFT_LEGGING = ['Left legging', 'Left knee cop'];
const RIGHT_LEGGING = ['Right legging', 'Right knee cop'];
const LEFT_SABATON = ['Left sabaton', 'Left sabaton trim'];
const RIGHT_SABATON = ['Right sabaton', 'Right sabaton trim'];
const SWORD = ['Sword pommel', 'Sword grip', 'Sword crossguard', 'Sword blade'];
const SHIELD = ['Shield face', 'Shield rim top', 'Shield rim bottom', 'Shield boss', 'Shield grip'];
const TORCH = ['Torch stave', 'Torch band', 'Torch wrap', 'Torch flame', 'Torch flame core'];
// Which baked parts each equip toggle owns, keyed the way spec.equip is. Exported for the
// inventory screen (inventory.js), which draws a slot's icon from the very geometry the rig
// wears rather than from a glyph - and works out from these lists which recolour makes an
// icon stale, since every part carries the colour slot it reads.
export const PIECE_PARTS = {
  backpack: BACKPACK,
  chestplate: CHESTPLATE,
  leggings: [...LEFT_LEGGING, ...RIGHT_LEGGING],
  boots: [...LEFT_SABATON, ...RIGHT_SABATON],
};
const EQUIPPABLE = new Set([
  ...BACKPACK, ...HAMMER, ...CHESTPLATE, ...LEFT_LEGGING, ...RIGHT_LEGGING,
  ...LEFT_SABATON, ...RIGHT_SABATON, ...SWORD, ...SHIELD, ...TORCH,
]);
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

// The sword and shield are modelled in build-settler.py with their grip at this same
// point - "Right hand"'s own raw position - so re-centring their baked geometry here (not
// modelling them at the origin the way the procedural parasol and hammer still are) is
// what lets classic-avatar.js hand either one to either fist through the same handAttach.
const GRIP = [0.131 * PLAYER_SCALE, 0.19 * PLAYER_SCALE, 0.018 * PLAYER_SCALE];

// How far the arm swings to hold something out, measured against the same rotation.x the
// stride already uses (a small fraction of a radian mid-stride, ~-0.28 crouching the legs
// forward) - large enough to read as reaching out rather than a bigger stride, checked in
// the browser rather than derived, because there is no elbow here to make the geometry
// answer the question on its own. A shield is carried rather than held out: its arm stays
// down at the side, a little forward, so the plate covers the flank - held out, the fist
// sits at shoulder height and the shield came up beside the head.
const HOLD_ARM_X = { default: -1.3, shield: -0.35 };
const holdX = (item) => HOLD_ARM_X[item] ?? HOLD_ARM_X.default;
// A held item's turn about the arm, in radians, mirrored for the left hand. The shield is
// modelled facing straight out from the fist (+X, build-settler.py); a third of a turn
// forward keeps its face readable from in front instead of edge-on.
const ITEM_YAW = { shield: 0.6 };

// A torch lights what is around it, not only itself: a warm point light at the middle of the
// flame (build-settler.py's 'Torch flame', .350-.420, measured from GRIP's .190), the same
// colour and falloff as a camp's fire in main.js but a little weaker and shorter, since it is
// one burning stick rather than a stacked fire. Its strength follows uNight on the shared
// material - the same number that makes the windows (and the flame's own vertices) glow - so
// by day it is present and dark. It stays in the scene at zero rather than being hidden,
// because three.js recompiles every material when the number of lights changes; that is
// paid once when the torch is picked up, never at dusk. A material without that uniform
// (the inventory's own alcove) gets no light at all: that scene is lit on purpose.
const TORCH_LIGHT = { color: 0xffa050, intensity: 1.8, distance: 3.5, y: (0.385 - 0.19) * PLAYER_SCALE };

const nightOf = (material) => material?.userData?.uniforms?.uNight?.value ?? 0;

function damp(from, to, speed, dt) {
  return THREE.MathUtils.lerp(from, to, 1 - Math.exp(-speed * dt));
}

function withSheet(geometry) {
  // buildFigure() gives every avatar part an aSheet attribute, even at zero (see
  // avatar.js) - the material expects it on everything it draws, and these primitives
  // only add one when asked (see finish() in buildings.js), which a plain-coloured item
  // never does. Baked parts already carry one from buildFigure() itself, so this only
  // ever runs on the two procedural items below.
  const n = geometry.attributes.position.count;
  geometry.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(n), 1));
  geometry.computeVertexNormals();
  return geometry;
}

// The first held item (Plans/uitrusting-en-vasthouden.md's open "what comes first"
// question) - the same lounge parasol from walk.js's loungeGeometry(), rebuilt at hand
// scale with its handle at the local origin instead of planted in the ground, so it can
// be parented straight onto either hand's attach point. Same colours, so it still reads as the same
// parasol when it moves from the beach towel to the hand.
const PARASOL_POLE = 0x5a3c28, PARASOL_CANOPY = 0xd94f3d, PARASOL_UNDERSIDE = 0xf5efe0, PARASOL_FINIAL = 0xd9a33d;
function parasolGeometry() {
  return withSheet(mergeGeometries([
    cylinder(0.011, 0.013, 0.4, 6, PARASOL_POLE, { y: 0 }),
    cone(0.22, 0.1, 12, PARASOL_CANOPY, { y: 0.4 }),
    cone(0.17, 0.04, 12, PARASOL_UNDERSIDE, { y: 0.39 }),
    sphere(0.016, PARASOL_FINIAL, { y: 0.5 }),
  ], false));
}

// The second held item. Same shape and colours as the working hammer settler-figures.js
// swings for a building crew, since it is the same tool - only the origin differs, moved
// from that file's instanced-mesh centre to a grip at the local origin the way every held
// item here works, with the head above the fist and a short butt below it.
const HAMMER_HANDLE = 0x8b5e3c, HAMMER_HEAD = 0x3a3a3f;
function hammerGeometry() {
  return withSheet(mergeGeometries([
    box(0.022, 0.2, 0.022, HAMMER_HANDLE, { y: -0.05 }),
    box(0.075, 0.05, 0.05, HAMMER_HEAD, { y: 0.14 }),
  ], false));
}

// The sword and shield used to be built the same procedural way as the hammer above; both
// are baked Blender parts now (see the header comment on EQUIPPABLE), re-centred on GRIP
// the same way makePiece() re-centres a limb on its own pivot.
function heldPartGeometry(spec, names) {
  const geometry = avatarPlayerComponentGeometry(spec, names);
  geometry.translate(-GRIP[0], -GRIP[1], -GRIP[2]);
  return geometry;
}

// What HAND_ITEMS (avatar.js) can resolve to. The procedural pair are cheap enough (under
// a dozen primitives) that nothing here is worth caching; the baked pair go through
// heldPartGeometry() instead, which needs the current spec to pick up a recolour. Both are
// exported for the inventory's slot icons, which show the item on its own.
const HELD_ITEM_PROCEDURAL = { parasol: parasolGeometry, hammer: hammerGeometry };
export const HELD_ITEM_PARTS = { sword: SWORD, shield: SHIELD, torch: TORCH };

export function heldItemGeometry(item, spec) {
  if (HELD_ITEM_PROCEDURAL[item]) return HELD_ITEM_PROCEDURAL[item]();
  if (HELD_ITEM_PARTS[item]) return heldPartGeometry(spec, HELD_ITEM_PARTS[item]);
  return null;
}

export function createClassicAvatar(spec, material) {
  const object = new THREE.Group();
  const pieces = {};

  // `parent` defaults to the top-level group and `groupAt`/`translateBy` to the piece's own
  // named pivot (PIVOTS[name]) - which is what every original piece (core, the four limbs,
  // the backpack) still wants. Chestplate, leggings and boots are the exception: they want
  // to swing with a limb they are not the limb of, so they are parented straight onto that
  // limb's own pivot with no group offset of their own (it is already inside one), while
  // the geometry itself is still translated by that limb's pivot point - the same quantity,
  // used two different ways, which is why the two are separate options instead of one.
  function makePiece(name, names, { parent = object, groupAt = PIVOTS[name] || [0, 0, 0], translateBy = groupAt } = {}) {
    const pivot = new THREE.Group();
    pivot.position.set(...groupAt);
    const geometry = avatarPlayerComponentGeometry(spec, names);
    geometry.translate(-translateBy[0], -translateBy[1], -translateBy[2]);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    pivot.add(mesh);
    parent.add(pivot);
    pieces[name] = { pivot, mesh, names, at: translateBy };
  }

  makePiece('core', CORE);
  for (const [name, names] of Object.entries(LIMBS)) makePiece(name, names);
  makePiece('backpack', BACKPACK);
  makePiece('chestplate', CHESTPLATE);
  makePiece('leftLegging', LEFT_LEGGING, { parent: pieces.leftLeg.pivot, groupAt: [0, 0, 0], translateBy: PIVOTS.leftLeg });
  makePiece('rightLegging', RIGHT_LEGGING, { parent: pieces.rightLeg.pivot, groupAt: [0, 0, 0], translateBy: PIVOTS.rightLeg });
  makePiece('leftBoot', LEFT_SABATON, { parent: pieces.leftLeg.pivot, groupAt: [0, 0, 0], translateBy: PIVOTS.leftLeg });
  makePiece('rightBoot', RIGHT_SABATON, { parent: pieces.rightLeg.pivot, groupAt: [0, 0, 0], translateBy: PIVOTS.rightLeg });
  pieces.backpack.pivot.visible = spec.equip?.backpack !== false;
  pieces.chestplate.pivot.visible = !!spec.equip?.chestplate;
  pieces.leftLegging.pivot.visible = pieces.rightLegging.pivot.visible = !!spec.equip?.leggings;
  pieces.leftBoot.pivot.visible = pieces.rightBoot.pivot.visible = !!spec.equip?.boots;

  // An empty group per arm, not a mesh: a held item parents onto this and follows the
  // hand's position for free. Not its rotation, though - update() below counter-rotates
  // the item itself, so it swings to wherever the hand is but stays upright the way
  // something actually held in a hand would, instead of tipping over with the arm.
  const handAttach = {}, heldMesh = { leftArm: null, rightArm: null }, holding = { leftArm: null, rightArm: null };
  for (const side of ['leftArm', 'rightArm']) {
    const g = new THREE.Group();
    g.position.set(...HAND_ATTACH[side]);
    pieces[side].pivot.add(g);
    handAttach[side] = g;
  }

  function setHeldItem(side, item, forSpec) {
    if (heldMesh[side]) { handAttach[side].remove(heldMesh[side]); heldMesh[side].geometry.dispose(); heldMesh[side] = null; }
    holding[side] = item || null;
    const geometry = heldItemGeometry(item, forSpec);
    if (!geometry) return;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    // Every item is modelled for the right hand. The left gets the same mesh mirrored in X
    // - three.js flips the winding for a negative determinant, so nothing turns inside out -
    // which is what puts a shield's face on the outside of either arm; the symmetric items
    // do not notice. The yaw is mirrored with it, so "a little forward" stays forward.
    const left = side === 'leftArm';
    if (left) mesh.scale.x = -1;
    mesh.rotation.y = (left ? 1 : -1) * (ITEM_YAW[item] || 0);
    if (item === 'torch') {
      const light = new THREE.PointLight(TORCH_LIGHT.color, 0, TORCH_LIGHT.distance, 2);
      light.position.y = TORCH_LIGHT.y;
      mesh.add(light);
      mesh.userData.light = light;
    }
    handAttach[side].add(mesh);
    heldMesh[side] = mesh;
  }
  setHeldItem('leftArm', spec.equip?.leftHandItem || null, spec);
  setHeldItem('rightArm', spec.equip?.rightHandItem || null, spec);

  // Attacking and blocking (Plans/aanvallen-en-blokkeren.md). A swing is a short, timed
  // profile on the weapon arm - wind up behind the shoulder, strike forward and down,
  // recover to whatever the arm was doing - driven directly rather than through damp(),
  // which at 15/s would smear a 0.45 s swing into a wave. The held item stops standing
  // upright for the duration and slashes with the arm, and the counter-rotation fades back
  // in over the recovery. A block is a held pose, so it goes through the same targets and
  // damping as everything else: the shield arm comes up in front, and the shield turns from
  // its resting yaw to a quarter turn so its face points forward.
  const SWING_S = 0.45, BLOCK_ARM_X = -1.25, WEAPONS = new Set(['sword', 'hammer', 'parasol']);
  let swing = null;   // { side, t, from } while an attack is playing
  const ease = (u) => u * u * (3 - 2 * u);
  // The hand that swings: a weapon if there is one (right first), otherwise a free fist,
  // otherwise whatever the right holds. The hand that blocks: the shield if there is one,
  // otherwise the hand that would not be swinging.
  const attackSide = () => (WEAPONS.has(holding.rightArm) ? 'rightArm' : WEAPONS.has(holding.leftArm) ? 'leftArm'
    : holding.rightArm !== 'shield' ? 'rightArm' : 'leftArm');
  const blockSide = () => (holding.leftArm === 'shield' ? 'leftArm' : holding.rightArm === 'shield' ? 'rightArm'
    : attackSide() === 'rightArm' ? 'leftArm' : 'rightArm');

  function attack() {
    // A swing past its strike can be cut short by the next one; one still winding up or
    // striking plays out, or mashing the button would jitter the arm at the top.
    if (swing && swing.t / SWING_S < 0.6) return;
    const side = attackSide();
    swing = { side, t: 0, from: pieces[side].pivot.rotation.x };
  }

  // Where the swinging arm is, u of the way through, and how much of the item's upright
  // counter-rotation is cancelled there (1: the item goes with the arm). `rest` is what the
  // arm would be doing had it not swung, which is where the recovery lands.
  function swingPose(s, rest) {
    const u = Math.min(1, s.t / SWING_S);
    if (u < 0.3) { return { x: THREE.MathUtils.lerp(s.from, -2.4, ease(u / 0.3)), w: 1 }; }
    if (u < 0.55) return { x: THREE.MathUtils.lerp(-2.4, -0.35, ease((u - 0.3) / 0.25)), w: 1 };
    const r = ease((u - 0.55) / 0.45);
    return { x: THREE.MathUtils.lerp(-0.35, rest, r), w: 1 - r };
  }

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
      leftArm: holding.leftArm ? holdX(holding.leftArm) : (moving ? -stride * 0.9 : idle),
      rightArm: holding.rightArm ? holdX(holding.rightArm) : (moving ? stride * 0.9 : -idle),
    };
    const block = pose.blocking ? blockSide() : null;
    if (block) targets[block] = BLOCK_ARM_X;
    if (swing && (swing.t += dt) >= SWING_S) swing = null;
    const swung = swing ? swingPose(swing, targets[swing.side]) : null;
    for (const [name, target] of Object.entries(targets)) {
      if (swung && name === swing.side) pieces[name].pivot.rotation.x = swung.x;
      else pieces[name].pivot.rotation.x = damp(pieces[name].pivot.rotation.x, target, 15, dt);
    }
    pieces.leftArm.pivot.rotation.z = damp(pieces.leftArm.pivot.rotation.z, holding.leftArm ? 0 : (pose.running ? -0.12 : 0), 12, dt);
    pieces.rightArm.pivot.rotation.z = damp(pieces.rightArm.pivot.rotation.z, holding.rightArm ? 0 : (pose.running ? 0.12 : 0), 12, dt);
    pieces.core.pivot.position.y = Math.sin(time * 2.2) * (moving ? 0 : 0.0025);
    // Cancel each arm pivot's own rotation on the item it carries: the attach point gives
    // the item the hand's position (correct - the grip moves with the arm), but a held
    // item should not also inherit the arm's tilt, or it lies over at whatever angle the
    // arm is held at instead of standing up the way something actually gripped would.
    for (const side of ['leftArm', 'rightArm']) {
      const mesh = heldMesh[side];
      if (!mesh) continue;
      const w = swung && side === swing.side ? swung.w : 0;
      mesh.rotation.x = -pieces[side].pivot.rotation.x * (1 - w);
      mesh.rotation.z = -pieces[side].pivot.rotation.z;
      // A shield turns to face forward while it blocks and back out to the side after;
      // the same mirrored sign setHeldItem gave it, so left and right both turn inward.
      const yaw = block === side && holding[side] === 'shield' ? Math.PI / 2 : (ITEM_YAW[holding[side]] || 0);
      mesh.rotation.y = damp(mesh.rotation.y, (side === 'leftArm' ? 1 : -1) * yaw, 12, dt);
      if (mesh.userData.light) {
        // Two sines at unrelated rates, so the flicker never settles into a visible beat;
        // the two hands are offset so a pair of torches does not pulse in unison.
        const t = time + (side === 'leftArm' ? 1.7 : 0);
        const flicker = 0.85 + 0.1 * Math.sin(t * 23) + 0.05 * Math.sin(t * 7.3);
        mesh.userData.light.intensity = TORCH_LIGHT.intensity * nightOf(material) * flicker;
      }
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
    pieces.chestplate.pivot.visible = !!next.equip?.chestplate;
    pieces.leftLegging.pivot.visible = pieces.rightLegging.pivot.visible = !!next.equip?.leggings;
    pieces.leftBoot.pivot.visible = pieces.rightBoot.pivot.visible = !!next.equip?.boots;
    setHeldItem('leftArm', next.equip?.leftHandItem || null, next);
    setHeldItem('rightArm', next.equip?.rightHandItem || null, next);
  }

  function dispose() {
    for (const piece of Object.values(pieces)) piece.mesh.geometry.dispose();
    for (const side of ['leftArm', 'rightArm']) if (heldMesh[side]) heldMesh[side].geometry.dispose();
  }

  return { object, update, set, dispose, handAttach, attack };
}

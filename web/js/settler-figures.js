// What a settler looks like, and the fixed mesh batches that draw the whole crowd. The
// other half of what used to be web/js/settlers.js; settler-walk.js decides where the
// bodies are and this file decides what stands there.
//
// Residents share the player's faceted Blender style. Articulated body parts,
// optional skirts and swept hair, and six hat buckets are instanced across the
// whole crowd: population growth never adds a draw call. Tools have their own buckets.
// Movement is still sine waves and lerps - and all of those sine waves live here, run off
// this file's own clock, and feed nothing but a matrix. That is what let the two halves
// come apart: the walk tells us one word per figure (`f.anim`) and everything cosmetic is
// derived from it rather than computed alongside the position.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { residentPart, residentNamedPart, RESIDENT_HEAD_Y, RESIDENT_EYE_OFFSET } from './villager.js';
// The wardrobe. It moved to shared/ when the walk did, because a settler's height comes out
// of its look and its stride comes out of its height - so the half that decides where a
// body is has to be able to ask what it looks like, from Node. Re-exported here because
// this file has always been where the rest of the island asks.
import { HAT_SHAPES, settlerLook, styleLook, kindOf, styleOf } from 'shared/palette.mjs';
import { makeRng, hash32 } from 'shared/rng.mjs';
// The heading is ours. The walk names a direction to turn towards and how briskly; turning
// that into an angle needs atan2, and shared/ may not have one - see the header there.
import { lerpAngle } from 'shared/settlerwalk.mjs';
// The sword and the torch are the player's own baked parts (build-settler.py), not a
// second model of them: an armed resident carries exactly what the player can pick up.
import { avatarPlayerComponentGeometry, PLAYER_SCALE } from './avatar.js';
import { HELD_ITEM_PARTS } from './classic-avatar.js';
import { goldBarGeometry } from './goldpit.js';

export { settlerLook, styleLook, kindOf, styleOf };

const tmpObj = new THREE.Object3D();
// Yaw first, then the lean: a settler bent over a furrow leans towards where they are
// facing, not towards world +z. With no lean the two orders give the same matrix, so every
// body that is not at work is drawn exactly as before.
tmpObj.rotation.order = 'YXZ';
const tmpColor = new THREE.Color();
const bodyMat = new THREE.Matrix4();
const headMat = new THREE.Matrix4();
const posedMat = new THREE.Matrix4();
const pivotMat = new THREE.Matrix4();
const rotateMat = new THREE.Matrix4();
const unpivotMat = new THREE.Matrix4();
// The wheelbarrow's, see BARROW: where it stands, the wheel on its axle, a bar in its tray.
const barrowObj = new THREE.Object3D();
const frameMat = new THREE.Matrix4();
const partMat = new THREE.Matrix4();
const spinMat = new THREE.Matrix4();
// Out of sight: the same parking spot hide() puts a whole figure in.
const HIDDEN = new THREE.Matrix4().compose(new THREE.Vector3(0, -999, 0), new THREE.Quaternion(),
  new THREE.Vector3(0.0001, 0.0001, 0.0001));
// White multiplies out: a part painted white takes whatever colour its instance is given.
const WHITE = 0xffffff;
export const CAPACITY = 640;
const HEAD_Y = RESIDENT_HEAD_Y;

// How far above its own feet a figure's eyes are. A function rather than a constant
// because nobody on this island is standard height: the torso takes `height`, the head
// rides on top of whatever that came to at its own `head` size, and an apprentice has
// `baseScale` over the lot. Anything that wants to look a settler in the eye - the
// conversation camera in facetoface.js - asks here rather than adding a guess to a plot
// centre, which is how you end up addressing somebody's hat or their boots. Called with
// nothing it gives the standard figure, which is the one walk.js and the interiors wear.
export function eyeHeight({ look = null, baseScale = 1 } = {}) {
  const height = look && look.height ? look.height : 1;
  const head = look && look.head ? look.head : 1;
  return (HEAD_Y * height + RESIDENT_EYE_OFFSET * head) * baseScale;
}

// The merged portrait and the instanced crowd use exactly the same Blender parts.
function torsoGeometry(hex) { return residentPart('torso', hex); }
function limbParts(hex) { return [residentPart('limbs', hex)]; }
function handGeometry(hex) { return residentPart('hands', hex); }
function headGeometry(hex, dy = 0) { return residentPart('head', hex, dy); }
function detailGeometry(dy = 0) { return residentPart('detail', null, dy); }
function hatParts(shape, hex, dy = 0) {
  return shape === 'none' ? [] : [residentPart(shape, hex, dy)];
}
function mergeParts(parts) {
  const g = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const RESIDENT_PIECES = {
  torso: ['Work shirt', 'Left collar', 'Right collar'],
  trim: ['Left waistcoat', 'Right waistcoat', 'Short work apron', 'Apron pocket', 'Waist tie',
    'Shirt button', 'Shirt button.001', 'Shirt button.002'],
  leftLeg: ['Left clog', 'Left trousers'],
  rightLeg: ['Right clog', 'Right trousers'],
  leftArm: ['Left rolled sleeve', 'Left rolled cuff'],
  rightArm: ['Right rolled sleeve', 'Right rolled cuff'],
  leftHand: ['Left hand'],
  rightHand: ['Right hand'],
  skinCore: ['Neck'],
};
const RESIDENT_PIVOTS = {
  leftLeg: [-0.052, 0.14, 0], rightLeg: [0.052, 0.14, 0],
  leftArm: [-0.10, 0.27, 0], rightArm: [0.10, 0.27, 0],
  leftHand: [-0.10, 0.27, 0], rightHand: [0.10, 0.27, 0],
};

// One figure, merged, for everything that draws a settler as a plain mesh: walk mode, the
// interiors and the model sheet. The crowd outside does not go through here - it is drawn
// from the same parts as separate instanced meshes, see createFigures.
export function figureGeometry(style, { sailor = false, look = null } = {}) {
  const lk = look || styleLook(style, sailor);
  const build = lk.build ?? 1, height = lk.height ?? 1, head = lk.head ?? 1;
  const bodyParts = [
    torsoGeometry(lk.tunic),
    ...limbParts(lk.trim),
    handGeometry(lk.skin),
    ...(lk.outfit === 'skirt' ? [residentPart('skirt', lk.tunic)] : []),
  ].map((g) => g.scale(build, height, build));
  const headParts = [
    headGeometry(lk.skin, -HEAD_Y),
    detailGeometry(-HEAD_Y),
    ...(lk.presentation === 'woman' ? [residentPart('womanHair', null, -HEAD_Y)] : []),
    ...hatParts(lk.hatShape, lk.hat, -HEAD_Y),
  ].map((g) => g.scale(head, head, head).translate(0, HEAD_Y * height, 0));
  return mergeParts([...bodyParts, ...headParts]);
}

// Where each item sits in a resident's hand. The player's grip is its raw "Right hand"
// (classic-avatar.js's GRIP, before PLAYER_SCALE); the resident's is the middle of its own
// "Right hand" in villager-mesh.js (0.090..0.136, 0.167..0.229, -0.011..0.041). A resident
// stands 0.430 against the player's 0.451, so the item shrinks by that and no more.
const PLAYER_GRIP = [0.131, 0.19, 0.018];
const RESIDENT_GRIP = [0.113, 0.19, 0.015];
const RESIDENT_TO_PLAYER = 0.430 / 0.451;
// The torch is not mirrored into the left hand, only moved there: a mirrored geometry flips
// its winding, which an InstancedMesh cannot correct per instance the way classic-avatar.js's
// scale.x = -1 does, and a torch is round enough that nobody can tell.
function heldGeometry(names, grip) {
  const g = avatarPlayerComponentGeometry({}, names);
  g.scale(1 / PLAYER_SCALE, 1 / PLAYER_SCALE, 1 / PLAYER_SCALE);
  g.translate(-PLAYER_GRIP[0], -PLAYER_GRIP[1], -PLAYER_GRIP[2]);
  g.scale(RESIDENT_TO_PLAYER, RESIDENT_TO_PLAYER, RESIDENT_TO_PLAYER);
  g.translate(grip[0], grip[1], grip[2]);
  g.computeBoundingSphere();
  return g;
}
// The wheelbarrow the gold is fetched with (Plans/goudkuil.md): wheeled out empty ('barrow'),
// parked in front of the pile while it is loaded ('load'), wheeled home full ('carry').
//
// Built in the settler's own frame - feet at the origin, facing +z - at a resident's size, and
// set down on the ground under them rather than hung off the body: a barrow runs on its wheel,
// so it takes neither the walk's bob nor a chore's lean, only where they stand and which way
// they face. The handles end where the fists are with both arms at BARROW_ARM - the grip
// swung about the shoulder, worked out once here - a hair above the middle of the bob, so the
// hands ride on them through a stride. Everything below is in a resident's own units.
const BARROW_ARM = -0.5;
const BARROW_GRIP = (() => {
  const piv = RESIDENT_PIVOTS.rightHand;
  const dy = RESIDENT_GRIP[1] - piv[1], dz = RESIDENT_GRIP[2] - piv[2];
  const c = Math.cos(BARROW_ARM), s = Math.sin(BARROW_ARM);
  return { y: piv[1] + dy * c - dz * s + 0.012, z: piv[2] + dy * s + dz * c };
})();
export const BARROW = {
  r: 0.042,          // the wheel
  wheelZ: 0.37,      // its axle, ahead of the feet
  trayZ: 0.235,      // the middle of the tray
  trayY: 0.095,      // its floor
  handleX: 0.095,    // each handle out from the middle, about where the fists are
  legZ: 0.165,       // the two legs, under the back of the tray
  legLift: 0.02,     // how far off the ground they ride while it is pushed
};
// Parked for loading: a step further on, and let down onto its legs - a turn about the axle,
// back end down, by as much as lifts the legs off the ground while it is being pushed.
const BARROW_PARK_AHEAD = 0.05;
const BARROW_PARK_TILT = -Math.atan2(BARROW.legLift, BARROW.wheelZ - BARROW.legZ);
// At home, while its settler hammers: set down on its legs beside them, turned to run along
// the front of the house with its handles at their elbow, rather than out in front where the
// wall is. Empty - what it brought has gone into the building.
const BARROW_HOME_AT = [0.17, 0, 0.1];
// How many can be seen at once: every builder on a few islands, parked or on the move.
const BARROWS = 256;
// The gold in the tray: one bar while it is being loaded, all three once it is.
const TRAY_BARS = [[-0.03, 0, -0.02, 0.1], [0.03, 0, 0.015, -0.08], [0, 0.034, 0, 0.05]];

function barrowGeometry() {
  const wood = 0x9a6b42, dark = 0x6b4a2e;
  const box = (w, h, d, hex, x, y, z, rx = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return paintGeo(g, hex);
  };
  const { r, wheelZ, trayZ, trayY, handleX, legZ, legLift } = BARROW;
  // A handle runs from the fist forwards and down past the tray to beside the wheel. A box
  // laid along +z and turned about x by `pitch` points along (dy, dz): rotateX takes +z to
  // (0, -sin, cos).
  const gy = BARROW_GRIP.y, gz = BARROW_GRIP.z;
  const fy = r + 0.03, fz = wheelZ - 0.02;
  const dy = fy - gy, dz = fz - gz;
  const len = Math.sqrt(dy * dy + dz * dz), pitch = Math.atan2(-dy, dz);
  const parts = [];
  for (const side of [-1, 1]) {
    parts.push(box(0.014, 0.014, len, dark, side * handleX, (gy + fy) / 2, (gz + fz) / 2, pitch));
    parts.push(box(0.012, trayY - legLift, 0.012, dark, side * 0.07, legLift + (trayY - legLift) / 2, legZ));
    parts.push(box(0.01, fy - r + 0.01, 0.01, dark, side * 0.03, (r + fy) / 2, wheelZ));
  }
  // The tray: a floor and four sides, the front one highest, as a barrow is tipped from.
  parts.push(box(0.15, 0.012, 0.17, wood, 0, trayY, trayZ));
  parts.push(box(0.012, 0.055, 0.17, wood, -0.075, trayY + 0.03, trayZ));
  parts.push(box(0.012, 0.055, 0.17, wood, 0.075, trayY + 0.03, trayZ));
  parts.push(box(0.15, 0.065, 0.012, wood, 0, trayY + 0.035, trayZ + 0.085));
  parts.push(box(0.15, 0.045, 0.012, wood, 0, trayY + 0.025, trayZ - 0.085));
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}

// The wheel on its own, because it turns: a rim with two spokes across it, which is what
// shows it turning at all - a plain disc spun about its axle looks exactly like one standing
// still. Centred on the axle, which runs along x.
function wheelGeometry() {
  const r = BARROW.r;
  const rim = new THREE.CylinderGeometry(r, r, 0.02, 12);
  rim.rotateZ(Math.PI / 2);
  const g = mergeGeometries([
    paintGeo(rim, 0x4a3322),
    paintGeo(new THREE.BoxGeometry(0.024, r * 1.7, 0.01), 0x9a7a52),
    paintGeo(new THREE.BoxGeometry(0.024, 0.01, r * 1.7), 0x9a7a52),
  ], false);
  g.computeVertexNormals();
  return g;
}

// How far forward an armed resident holds each arm, on the same rotation.x the stride uses.
// Enough that the sword and the torch are held out rather than hanging against the leg,
// and the stride is halved on top of it so the blade does not windmill on a walk.
const ARMED_ARM = { right: -0.45, left: -0.35 };

function paintGeo(g, hex) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const flat = g.index ? g.toNonIndexed() : g;
  const n = flat.attributes.position.count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3), emi = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flat.setAttribute('aEmissive', new THREE.BufferAttribute(emi, 1));
  return flat;
}

// How a body stands at a chore, for the word the walk wrote (Plans/inwoners-aan-het-werk.md).
// Null for anything that is not a chore, which leaves the walk, the wander and the hammer
// exactly as they were. Angles are rotation.x, as the stride's are: negative is an arm
// raised forwards, and `lean` tips the whole body forwards about the feet. `t` is this
// file's clock plus the settler's own phase, so a field of people does not hoe in unison.
//
//   hoe     both hands on the handle, raised and brought down twice a second or so
//   weed    one foot forward, bent low, hands plucking in turn
//   chop    the axe over the shoulder and down into the trunk
//   gather  bent double, both hands at the ground, picking up
//   fish    rod held out, the odd twitch when something takes an interest
export function workPose(anim, t) {
  if (anim === 'hoe') {
    const s = Math.sin(t * 3.4);
    const arm = -0.95 - 0.45 * s;
    return { lean: 0.16 + 0.06 * s, left: arm + 0.1, right: arm, legL: -0.18, legR: 0.12, drop: 0 };
  }
  if (anim === 'weed') {
    const s = Math.sin(t * 2.6);
    return { lean: 0.62, left: -0.75 + 0.22 * s, right: -0.75 - 0.22 * s, legL: -0.55, legR: 0.35, drop: -0.05 };
  }
  if (anim === 'chop') {
    // Up slowly, down fast: the square of a sine spends longer near the top of the swing.
    const s = Math.sin(t * 2.4);
    const up = s > 0 ? s * s : 0;
    const arm = -0.75 - 1.55 * up;
    return { lean: 0.05 + 0.12 * (1 - up), left: arm + 0.15, right: arm, legL: -0.25, legR: 0.18, drop: 0 };
  }
  if (anim === 'gather') {
    const s = Math.sin(t * 2.2);
    return { lean: 0.78, left: -0.55 + 0.18 * s, right: -0.6 - 0.18 * s, legL: -0.2, legR: 0.2, drop: -0.03 };
  }
  if (anim === 'fish') {
    // A twitch now and then: the top sliver of a slow wave, which comes round every seven
    // seconds or so and lasts a fraction of one.
    const w = Math.sin(t * 0.9);
    const twitch = w > 0.94 ? (w - 0.94) * 6 : 0;
    return { lean: 0, left: -0.42, right: -0.62 - twitch, legL: -0.05, legR: 0.05, drop: 0 };
  }
  return null;
}

// A lean tips the whole body about its feet, legs and all, which bent double is a plank
// falling over. So the legs are turned back by the same angle about the hip and stand
// plumb again, which puts the feet a little below the ground - by this much, which is what
// the body is lifted by. The hip is at 0.14 in the resident's own parts, before the height.
function hipLift(lean, look) {
  return 0.14 * (1 - Math.cos(lean)) * ((look && look.height) || 1);
}

// `armed` gives every resident a sword in the right hand and a torch in the left: two more
// instanced meshes for the whole crowd, not two per settler. No light of its own per
// torch, unlike the
// player's (classic-avatar.js): a PointLight per resident would be hundreds of lights, and
// three.js recompiles every material whenever that number changes. The flame glows after
// dark through the same per-vertex night mask the player's does, which is what reads from
// across the water anyway.
export function createFigures(scene, material, { armed = false } = {}) {
  function makeMesh(geo) {
    const m = new THREE.InstancedMesh(geo, material, CAPACITY);
    m.castShadow = true;
    m.count = 0;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  }
  const tint = (mesh, i, hex) => {
    mesh.setColorAt(i, tmpColor.setHex(hex));
    mesh.instanceColor.needsUpdate = true;
  };

  // Everyone shares one slot number across the articulated meshes that everyone has, which is
  // also what lets a ray hit on a torso or a head name the person it belongs to.
  const roster = [];
  let slots = 0;
  const torso = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.torso, WHITE)]));
  const trim = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.trim, WHITE)]));
  const leftLeg = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.leftLeg, WHITE)]));
  const rightLeg = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.rightLeg, WHITE)]));
  const leftArm = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.leftArm, WHITE)]));
  const rightArm = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.rightArm, WHITE)]));
  const leftHand = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.leftHand, WHITE)]));
  const rightHand = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.rightHand, WHITE)]));
  const skinCore = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.skinCore, WHITE)]));
  const head = makeMesh(mergeParts([headGeometry(WHITE, -HEAD_Y)]));
  const details = makeMesh(mergeParts([detailGeometry(-HEAD_Y)]));
  // Optional clothing and hair remain two population-wide batches, never a mesh
  // per woman. They share the resident slot and follow its body/head respectively.
  const skirts = makeMesh(mergeParts([residentPart('skirt', WHITE)]));
  const womanHair = makeMesh(mergeParts([residentPart('womanHair', null, -HEAD_Y)]));
  skirts.name = 'resident-skirts';
  womanHair.name = 'resident-woman-hair';
  // Untinted: the baked parts carry their own brass, steel and flame in the vertex colours,
  // and setColorAt is never called on these two, so there is no instance colour to multiply.
  const swords = armed ? makeMesh(heldGeometry(HELD_ITEM_PARTS.sword, RESIDENT_GRIP)) : null;
  const torches = armed ? makeMesh(heldGeometry(HELD_ITEM_PARTS.torch,
    [-RESIDENT_GRIP[0], RESIDENT_GRIP[1], RESIDENT_GRIP[2]])) : null;
  if (swords) swords.name = 'resident-swords';
  if (torches) torches.name = 'resident-torches';
  const body = [torso, trim, leftLeg, rightLeg, leftArm, rightArm, leftHand, rightHand, skinCore, head, details, skirts, womanHair,
    ...(armed ? [swords, torches] : [])];
  torso.userData.bucket = { figs: roster };
  head.userData.bucket = { figs: roster };

  function setPosed(mesh, slot, base, pivot, angle) {
    pivotMat.makeTranslation(pivot[0], pivot[1], pivot[2]);
    rotateMat.makeRotationX(angle);
    unpivotMat.makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
    posedMat.copy(base).multiply(pivotMat).multiply(rotateMat).multiply(unpivotMat);
    mesh.setMatrixAt(slot, posedMat);
  }
  // The hats keep their own slots: a settler is in exactly one of these meshes, or in
  // none of them if it is bare-headed.
  const hats = new Map();
  for (const h of HAT_SHAPES) {
    if (h.id === 'none') continue;
    hats.set(h.id, { mesh: makeMesh(mergeParts(hatParts(h.id, WHITE, -HEAD_Y))), slots: 0 });
  }

  const hammerGeo = mergeGeometries([
    paintGeo(new THREE.BoxGeometry(0.022, 0.16, 0.022), 0x8b5e3c),
    (() => { const g = new THREE.BoxGeometry(0.075, 0.05, 0.05); g.translate(0, 0.09, 0); return paintGeo(g, 0x3a3a3f); })(),
  ], false);
  // Use the same rest grip and shoulder pose as the hand: a separate world-space
  // swing loses contact as soon as the body turns, bobs or changes proportions.
  // The resting fist points forward. An upright handle rotates back towards the
  // shoulder when this arm rises; align it with the fist before posing the arm.
  hammerGeo.rotateX(Math.PI / 2);
  hammerGeo.translate(...RESIDENT_GRIP);
  hammerGeo.computeVertexNormals();
  const hammers = new THREE.InstancedMesh(hammerGeo, material, CAPACITY);
  hammers.count = 0;
  hammers.frustumCulled = false;

  // The chores' tools (Plans/inwoners-aan-het-werk.md): one InstancedMesh each for the
  // whole crowd, like the hammer, and hidden outright while nobody holds one so that a
  // village with nobody at work costs the draw calls it always did. Built the way the
  // hammer is - a handle pointing forward out of the resting fist - and then tipped so
  // that the arm angles in `workPose` put the business end where the work is.
  const toolMesh = (parts, tilt) => {
    const g = mergeGeometries(parts, false);
    g.rotateX(tilt);
    g.translate(...RESIDENT_GRIP);
    g.computeVertexNormals();
    const m = new THREE.InstancedMesh(g, material, CAPACITY);
    m.count = 0;
    m.frustumCulled = false;
    m.visible = false;
    scene.add(m);
    return m;
  };
  const along = (w, h, len, hex, z0 = 0, y = 0) => {
    const g = new THREE.BoxGeometry(w, h, len);
    g.translate(0, y, z0 + len / 2);
    return paintGeo(g, hex);
  };
  const WOOD = 0x8b5e3c, IRON = 0x4a4a50;
  // A hoe: a long handle pointing forward and down, and a blade across its end facing the
  // ground.
  const hoes = toolMesh([
    along(0.018, 0.018, 0.36, WOOD, -0.06),
    along(0.07, 0.05, 0.012, IRON, 0.29, -0.02),
  ], Math.PI / 4);
  // An axe: the hammer's handle a little longer, with a blade on one side of its head.
  const axes = toolMesh([
    along(0.02, 0.02, 0.22, WOOD, -0.03),
    along(0.012, 0.07, 0.05, IRON, 0.15, 0.03),
  ], 0);
  // A rod: long, thin, raised; the line hangs from the tip in the rod's own frame, which is
  // near enough plumb for the few degrees the arm moves while waiting for a bite.
  const rods = toolMesh([
    along(0.014, 0.014, 0.62, WOOD, -0.04),
    (() => { const g = new THREE.BoxGeometry(0.004, 0.004, 0.44); g.rotateX(0.7 + Math.PI / 2); g.translate(0, -0.168, 0.438); return paintGeo(g, 0xd8d2c0); })(),
  ], -0.7);
  // A bundle of sticks across the back, for the walk home from the wood. Hangs off the
  // body rather than a hand, so it is built at the shoulders and not at the grip.
  const bundleGeo = mergeGeometries([0, 1, 2, 3, 4].map((i) => {
    const g = new THREE.CylinderGeometry(0.009, 0.011, 0.34, 5);
    g.translate((i % 3 - 1) * 0.018, 0, (i < 3 ? 0 : 0.016));
    return paintGeo(g, i % 2 ? 0x7a5234 : 0x96683f);
  }), false);
  bundleGeo.rotateZ(1.05);
  bundleGeo.translate(0, 0.27, -0.075);
  bundleGeo.computeVertexNormals();
  const bundles = new THREE.InstancedMesh(bundleGeo, material, CAPACITY);
  bundles.count = 0;
  bundles.frustumCulled = false;
  bundles.visible = false;
  scene.add(bundles);
  // Everybody's wheelbarrow on the way to and from the gold pit, its wheel, and the gold in
  // its tray - three batches for the whole crowd, the same bargain as the tools: count 0 and
  // no draw call while nobody is fetching any. The bars are the pile's own ingot
  // (web/js/goldpit.js), a size down to lie in a tray.
  const barrowMesh = (geo, n) => {
    const m = new THREE.InstancedMesh(geo, material, n);
    m.count = 0;
    m.castShadow = true;
    m.frustumCulled = false;
    m.visible = false;
    scene.add(m);
    return m;
  };
  const barrows = barrowMesh(barrowGeometry(), BARROWS);
  const wheels = barrowMesh(wheelGeometry(), BARROWS);
  const trayBars = barrowMesh(goldBarGeometry({ l: 0.1, h: 0.032, w: 0.05 }), BARROWS * TRAY_BARS.length);
  barrows.name = 'resident-barrows';
  wheels.name = 'resident-barrow-wheels';
  trayBars.name = 'resident-barrow-gold';
  // Fixed offsets inside a barrow's own frame, made once: the axle, the park (see
  // BARROW_PARK_TILT) and where each bar lies in the tray.
  const axleMat = new THREE.Matrix4().makeTranslation(0, BARROW.r, BARROW.wheelZ);
  const parkMat = new THREE.Matrix4().makeTranslation(0, 0, BARROW_PARK_AHEAD)
    .multiply(axleMat)
    .multiply(new THREE.Matrix4().makeRotationX(BARROW_PARK_TILT))
    .multiply(new THREE.Matrix4().makeTranslation(0, -BARROW.r, -BARROW.wheelZ));
  const homeMat = new THREE.Matrix4().makeTranslation(...BARROW_HOME_AT)
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
    .multiply(axleMat)
    .multiply(new THREE.Matrix4().makeRotationX(BARROW_PARK_TILT))
    .multiply(new THREE.Matrix4().makeTranslation(0, -BARROW.r, -BARROW.wheelZ));
  const trayAt = TRAY_BARS.map(([x, y, z, turn]) => new THREE.Matrix4().makeRotationY(turn)
    .setPosition(x, BARROW.trayY + 0.006 + y, BARROW.trayZ + z));
  const TOOL_OF = { hoe: hoes, chop: axes, fish: rods };
  // The hammer last, after the tools, where the rest of the island has always found it.
  scene.add(hammers);

  let time = 0;

  // Dress a figure the walk has already made, and give it a slot in the crowd. Returns
  // false when the crowd is full, which is the caller's cue to take the figure back out
  // again - a body with no slot would be stepped every frame and drawn nowhere.
  function enrol(f, look, kind) {
    const slot = slots;
    if (slot >= CAPACITY) return false;
    slots++;
    for (const m of body) m.count = slots;
    tint(torso, slot, look.tunic);
    tint(skirts, slot, look.tunic);
    skirts.setMatrixAt(slot, HIDDEN);
    womanHair.setMatrixAt(slot, HIDDEN);
    for (const mesh of [leftArm, rightArm]) tint(mesh, slot, look.tunic);
    for (const mesh of [trim, leftLeg, rightLeg]) tint(mesh, slot, look.trim);
    tint(head, slot, look.skin);
    for (const mesh of [leftHand, rightHand, skinCore]) tint(mesh, slot, look.skin);
    const hatBucket = hats.get(look.hatShape) || null;
    let hatSlot = -1;
    if (hatBucket && hatBucket.slots < CAPACITY) {
      hatSlot = hatBucket.slots++;
      hatBucket.mesh.count = hatBucket.slots;
      tint(hatBucket.mesh, hatSlot, look.hat);
    }
    f.slot = slot;
    f.look = look;
    f.hatBucket = hatBucket;
    f.hatSlot = hatSlot;
    f.baseScale = kind === 'apprentice' ? 0.62 : 1;
    // The body stretches and thickens; the head rides on top of it at its own size, or
    // a tall settler would be a normal one seen through a lens.
    f.mBody = new THREE.Matrix4().makeScale(look.build, look.height, look.build);
    f.mHead = new THREE.Matrix4().makeTranslation(0, HEAD_Y * look.height, 0)
      .scale(new THREE.Vector3(look.head, look.head, look.head));
    // How fast this one's legs swing and where in the wave they start. Purely cosmetic -
    // nothing here reaches a position - so they get a stream of their own rather than two
    // draws out of the middle of the walk's. Hashed off the id like everything else about
    // a settler, so the same person keeps the same gait across a rebuild, and forked with
    // its own label so that adding a third number here can never move anybody's feet.
    const rng = makeRng(hash32(f.id + ':gait'));
    f.gait = rng.range(10.2, 11.8);
    f.phase = rng.range(0, 6.28);
    roster[slot] = f;
    return true;
  }

  function hide(f) {
    if (f.slot == null) return;
    tmpObj.position.set(0, -999, 0);
    tmpObj.rotation.set(0, 0, 0);
    tmpObj.scale.setScalar(0.0001);
    tmpObj.updateMatrix();
    for (const m of body) { m.setMatrixAt(f.slot, tmpObj.matrix); m.instanceMatrix.needsUpdate = true; }
    if (f.hatBucket && f.hatSlot >= 0) {
      f.hatBucket.mesh.setMatrixAt(f.hatSlot, tmpObj.matrix);
      f.hatBucket.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Everything the eye sees, from where the walk has put everybody. `f.anim` is the whole
  // of what it is told: the four animations below are derived from it and from this file's
  // own clock, and none of them can move a body.
  const toolCount = new Map();
  function draw(figures, dt) {
    time += dt;
    let hammerCount = 0, bundleCount = 0, barrowCount = 0, trayCount = 0;
    for (const f of figures.values()) {
      if (!f.visible || f.slot == null) continue;
      // Turn towards whatever the walk pointed at. `faceAngle` is the one case where an
      // angle comes from outside - a boat knows its own heading and the body in it takes
      // it whole, with no easing, because the hull has already done the turning.
      if (f.faceAngle != null) f.yaw = f.faceAngle;
      else if (f.face) f.yaw = lerpAngle(f.yaw, Math.atan2(f.face[0], f.face[1]), f.turn);
      const hauling = f.anim === 'haul';
      // Behind a wheelbarrow to or from the gold pit, or bent over it loading - which is the
      // woodcutter's gathering stoop, pointed at a tray instead of the ground.
      const pushing = f.anim === 'barrow' || f.anim === 'carry';
      const loading = f.anim === 'load';
      const walking = f.anim === 'walk' || f.anim === 'step' || hauling || pushing;
      const hammering = f.anim === 'hammer';
      const work = workPose(loading ? 'gather' : f.anim, time + f.phase);
      const bob = f.anim === 'walk' || hauling || pushing ? Math.abs(Math.sin(time * f.gait + f.phase)) * 0.035
        : f.anim === 'hammer' ? Math.abs(Math.sin(time * 8 + f.phase)) * 0.02
          : f.anim === 'step' ? Math.abs(Math.sin(time * 9 + f.phase)) * 0.03
            : work ? work.drop + hipLift(work.lean, f.look) : 0;

      // One transform for the person, then the parts hang off it: torso and limbs take
      // the build, the head rides at the top of whatever body this is.
      tmpObj.position.set(f.pos[0], f.y + bob * f.baseScale, f.pos[1]);
      const gaitPhase = time * (f.mode === 'walk' ? f.gait : 9) + f.phase;
      tmpObj.rotation.set(work ? work.lean : 0, f.yaw, Math.sin(gaitPhase) * (walking ? 0.045 : 0.01));
      tmpObj.scale.setScalar(f.baseScale);
      tmpObj.updateMatrix();
      bodyMat.multiplyMatrices(tmpObj.matrix, f.mBody);
      torso.setMatrixAt(f.slot, bodyMat);
      skirts.setMatrixAt(f.slot, f.look.outfit === 'skirt' ? bodyMat : HIDDEN);
      trim.setMatrixAt(f.slot, bodyMat);
      skinCore.setMatrixAt(f.slot, bodyMat);
      const stride = walking ? Math.sin(gaitPhase) * (f.speed > 0.8 ? 0.72 : 0.48) : 0;
      const idle = walking || hammering || work ? 0 : Math.sin(time * 1.8 + f.phase) * 0.035;
      const swing = armed ? 0.45 : 0.9;
      // Hauling, the right hand is up on the bundle and only the left arm swings. Behind a
      // barrow both are on the handles (BARROW_ARM) and neither swings.
      const leftArmAngle = work ? work.left
        : pushing ? BARROW_ARM
          : (armed ? ARMED_ARM.left : 0) + (walking ? -stride * swing : idle);
      const rightArmAngle = work ? work.right
        : hammering ? -0.55 - (0.5 + 0.5 * Math.sin(time * 8 + f.phase)) * 0.5
          : hauling ? -2.5
            : pushing ? BARROW_ARM
              : (armed ? ARMED_ARM.right : 0) + (walking ? stride * swing : -idle);
      setPosed(leftLeg, f.slot, bodyMat, RESIDENT_PIVOTS.leftLeg, work ? work.legL - work.lean : stride);
      setPosed(rightLeg, f.slot, bodyMat, RESIDENT_PIVOTS.rightLeg, work ? work.legR - work.lean : -stride);
      setPosed(leftArm, f.slot, bodyMat, RESIDENT_PIVOTS.leftArm, leftArmAngle);
      setPosed(leftHand, f.slot, bodyMat, RESIDENT_PIVOTS.leftHand, leftArmAngle);
      setPosed(rightArm, f.slot, bodyMat, RESIDENT_PIVOTS.rightArm, rightArmAngle);
      setPosed(rightHand, f.slot, bodyMat, RESIDENT_PIVOTS.rightHand, rightArmAngle);
      if (hammering) setPosed(hammers, hammerCount++, bodyMat, RESIDENT_PIVOTS.rightHand, rightArmAngle);
      const tool = TOOL_OF[f.anim];
      if (tool) {
        const n = toolCount.get(tool) || 0;
        setPosed(tool, n, bodyMat, RESIDENT_PIVOTS.rightHand, rightArmAngle);
        toolCount.set(tool, n + 1);
      }
      if (hauling) bundles.setMatrixAt(bundleCount++, bodyMat);
      // `barrowAtHome` is crowd-view.js's: hammering, on an island with a gold pit.
      const parkedAtHome = hammering && f.barrowAtHome;
      if ((pushing || loading || parkedAtHome) && barrowCount < BARROWS) {
        // On the ground where they stand, turned the way they face, at their height - no
        // bob, no lean, no roll: it is the barrow that runs on the wheel, not the person.
        const size = f.baseScale * f.look.height;
        barrowObj.position.set(f.pos[0], f.y, f.pos[1]);
        barrowObj.rotation.set(0, f.yaw, 0);
        barrowObj.scale.setScalar(size);
        barrowObj.updateMatrix();
        frameMat.copy(barrowObj.matrix);
        if (loading) frameMat.multiply(parkMat);
        else if (parkedAtHome) frameMat.multiply(homeMat);
        barrows.setMatrixAt(barrowCount, frameMat);
        // The wheel turns as far as the body travels: speed over its radius, and a positive
        // turn about x takes the top of the wheel forwards, which is rolling ahead.
        if (pushing) f.wheelTurn = ((f.wheelTurn || 0) + ((f.speed || 0.42) * dt) / (BARROW.r * size)) % (Math.PI * 2);
        partMat.copy(frameMat).multiply(axleMat).multiply(spinMat.makeRotationX(f.wheelTurn || 0));
        wheels.setMatrixAt(barrowCount, partMat);
        barrowCount++;
        const inTray = f.anim === 'carry' ? TRAY_BARS.length : loading ? 1 : 0;
        for (let i = 0; i < inTray; i++) trayBars.setMatrixAt(trayCount++, partMat.copy(frameMat).multiply(trayAt[i]));
      }
      if (armed) {
        // A settler at work puts the sword away for the hammer or the tool rather than
        // holding both in one fist; the torch stays lit in the other hand unless that one
        // is at work too.
        if (hammering || work || hauling || pushing) swords.setMatrixAt(f.slot, HIDDEN);
        else setPosed(swords, f.slot, bodyMat, RESIDENT_PIVOTS.rightHand, rightArmAngle);
        if ((work && f.anim !== 'fish') || pushing) torches.setMatrixAt(f.slot, HIDDEN);
        else setPosed(torches, f.slot, bodyMat, RESIDENT_PIVOTS.leftHand, leftArmAngle);
      }
      headMat.multiplyMatrices(tmpObj.matrix, f.mHead);
      head.setMatrixAt(f.slot, headMat);
      details.setMatrixAt(f.slot, headMat);
      womanHair.setMatrixAt(f.slot, f.look.presentation === 'woman' ? headMat : HIDDEN);
      if (f.hatBucket && f.hatSlot >= 0) f.hatBucket.mesh.setMatrixAt(f.hatSlot, headMat);
    }
    for (const m of body) m.instanceMatrix.needsUpdate = true;
    for (const h of hats.values()) if (h.slots) h.mesh.instanceMatrix.needsUpdate = true;
    hammers.count = hammerCount;
    hammers.instanceMatrix.needsUpdate = true;
    for (const m of [hoes, axes, rods]) {
      m.count = toolCount.get(m) || 0;
      m.visible = m.count > 0;
      if (m.count) m.instanceMatrix.needsUpdate = true;
    }
    toolCount.clear();
    bundles.count = bundleCount;
    bundles.visible = bundleCount > 0;
    if (bundleCount) bundles.instanceMatrix.needsUpdate = true;
    for (const [m, n] of [[barrows, barrowCount], [wheels, barrowCount], [trayBars, trayCount]]) {
      m.count = n;
      m.visible = n > 0;
      if (n) m.instanceMatrix.needsUpdate = true;
    }
  }

  // The people are instanced, so a ray hit comes back as a mesh plus an instance
  // number. These two turn that back into the settler standing there, which is what
  // lets you hover someone halfway down a street and read who it is. Only the torso and
  // the head are offered: a ray that grazes a hat brim carries on into the head behind
  // it, and leaving the other meshes out halves the instances every hover has to test.
  const pickables = () => [torso, head].filter((m) => m.count > 0);
  const figureAt = (mesh, i) => {
    const b = mesh && mesh.userData && mesh.userData.bucket;
    const f = b && i != null ? b.figs[i] : null;
    return f && f.visible ? f : null;
  };

  // Everything this crowd put into the scene, taken back out again. There was no way to
  // do that while a crowd lasted as long as the page did; now one is built per island and
  // rebuilt on every reseed, and instanced meshes left standing empty per rebuild
  // is a leak that only shows up on the machine somebody has had open all day.
  function dispose() {
    for (const m of [...body, hammers, hoes, axes, rods, bundles, barrows, wheels, trayBars, ...[...hats.values()].map((h) => h.mesh)]) {
      if (!m) continue;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    roster.length = 0;
    slots = 0;
  }

  return { enrol, hide, draw, pickables, figureAt, dispose };
}

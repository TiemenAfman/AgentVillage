// A tiny procedural rig for the original Blender avatar. The source model already keeps
// each arm and leg as named objects; avatar.js normally merges them for one draw call.
// Here those same objects sit below four pivots so the old look can use real strides.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { avatarPlayerComponentGeometry, PLAYER_SCALE, characterOf } from './avatar.js';
import { box, cylinder, cone, sphere, meshAsset, mergeParts } from './buildings.js';
import * as models from './models.js';
import { dancePose } from './dance.js';
import { createGait, gaitOf, mixOf, sprintAt } from './avatar-gait.js';
import { GAIT_CLIPS, GAIT_JOINTS } from './gait-clips.js';
// Every gear-variant part. Its own piece so equip.backpack can hide it without touching
// the torso it used to be merged into. The same names on every body: the Adventurer's gear is
// the Traveller's refitted (scripts/build-adventurer.py).
const BACKPACK = characterOf().parts.filter((p) => p.group === 'backpack').map((p) => p.name);
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
// Everything below that is measured off a body rather than chosen by hand, worked out once per
// body (web/js/player-bodies.js) - the Traveller and the Adventurer share every part *name* for
// their gear, so the lists above hold for both, but not one joint position.
const BODIES = new Map();
// A gait that plays Mixamo's clips (web/js/gait-clips.js, scripts/bake-mixamo-gait.py) strides
// as the clips do, scaled by this body's leg (hip to ankle), and is played by distance - so a
// planted foot never slides, whatever the speed. The walk is the clip's own speed too; the run
// and the sprint keep the profile's (avatar-gait.js), faster than Mixamo's 0.90 and 1.41 on this
// leg, which only turns their cadence up. Its procedural numbers stay for what the clips do not
// cover and for blending into them.
function withClips(g, leg) {
  if (!g.clips) return g;
  const c = GAIT_CLIPS;
  return {
    ...g, leg,
    walk: c.walk.speed * leg,
    cycle: [c.walk.stride * leg, c.run.stride * leg, c.sprint.stride * leg],
  };
}
// A pose seen in a mirror: left for right, and every turn reflected across the body's middle -
// how a dig with the left hand is the clip's right-handed one.
const MIRRORED = GAIT_JOINTS.map((name) => GAIT_JOINTS.indexOf(name.replace(/^l([A-Z])/, 'R$1').replace(/^r([A-Z])/, 'l$1').replace(/^R([A-Z])/, 'r$1')));
function mirrorPose(out, a) {
  for (let j = 0; j < out.q.length; j++) {
    const q = a.q[MIRRORED[j]];
    out.q[j].set(q.x, -q.y, -q.z, q.w);
  }
  out.drop = a.drop;
  return out;
}
// One baked row of a clip at `u` (0..1 of its cycle), into `out` (a quaternion a joint).
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function sampleClip(clip, u, out) {
  const n = clip.rows.length, x = (((u % 1) + 1) % 1) * n, i0 = Math.floor(x) % n, i1 = (i0 + 1) % n, f = x - Math.floor(x);
  const a = clip.rows[i0], b = clip.rows[i1];
  for (let j = 0; j < GAIT_JOINTS.length; j++) {
    qa.set(a[j * 4], a[j * 4 + 1], a[j * 4 + 2], a[j * 4 + 3]);
    qb.set(b[j * 4], b[j * 4 + 1], b[j * 4 + 2], b[j * 4 + 3]);
    out.q[j].slerpQuaternions(qa, qb, f);
  }
  const k = GAIT_JOINTS.length * 4;
  out.drop = a[k] * (1 - f) + b[k] * f;
  return out;
}
// A clip that plays once (a jump, its flight) is read without wrapping round to its start.
function sampleOnce(clip, u, out) {
  const n = clip.rows.length;
  return sampleClip(clip, Math.max(0, Math.min(u, (n - 1) / n)), out);
}
const clipPose = () => ({ q: GAIT_JOINTS.map(() => new THREE.Quaternion()), drop: 0 });
function blendPose(out, a, b, t) {
  for (let j = 0; j < out.q.length; j++) out.q[j].slerpQuaternions(a.q[j], b.q[j], t);
  out.drop = a.drop + (b.drop - a.drop) * t;
  return out;
}
const JOINT = Object.fromEntries(GAIT_JOINTS.map((name, j) => [name, j]));
function bodyOf(character) {
  const c = characterOf(character);
  if (BODIES.has(c.id)) return BODIES.get(c.id);
  const groupedParts = (group) => c.parts.filter((p) => p.group === group).map((p) => p.name);
  const LIMBS = Object.fromEntries(['leftLeg', 'rightLeg', 'leftArm', 'rightArm'].map((group) => [group, groupedParts(group)]));
  const MOVING = new Set(Object.values(LIMBS).flat());
  // The head and whatever hat is on it: its own piece so first person (walk.js) can take it
  // away - the camera sits inside it. Every hat is a variant of its own and the face is the
  // run of body parts from the neck up, so neither list has to be kept in step by hand.
  const HEAD = groupedParts('head');
  const PIVOTS = Object.fromEntries(Object.entries(c.rig)
    .filter(([name]) => name !== 'grip').map(([name, point]) => [name, point.map((v) => v * PLAYER_SCALE)]));
  // Where "Right hand" sits, measured in the bake (the rig's grip) and carried through the
  // same PLAYER_SCALE the pivots already are, minus the rightArm pivot's own offset - the same
  // translate makePiece already does to its mesh. Not the item's own origin, only where an
  // attach point for one belongs.
  const GRIP = c.rig.grip.map((v) => v * PLAYER_SCALE);
  const HAND_ATTACH = { rightArm: GRIP.map((v, i) => v - PIVOTS.rightArm[i]) };
  HAND_ATTACH.leftArm = [-HAND_ATTACH.rightArm[0], HAND_ATTACH.rightArm[1], HAND_ATTACH.rightArm[2]];
  const body = {
    id: c.id, parts: c.parts, joints: c.joints, fingers: c.fingers, LIMBS, HEAD, PIVOTS, GRIP, HAND_ATTACH,
    BACKPACK: groupedParts('backpack'),
    CORE: c.parts.map(({ name }) => name)
      .filter((name) => !MOVING.has(name) && !EQUIPPABLE.has(name) && !HEAD.includes(name)),
    // The hips' height over the soles: where a rider's legs turn, which is what walk.js puts
    // on the saddle.
    hipY: PIVOTS.leftLeg[1],
    // How it walks and runs (avatar-gait.js GAITS): its speeds, its stride, its upper body.
    gait: withClips(gaitOf(c.gait), PIVOTS.leftLeg[1] - c.joints.leftLeg.end[1] * PLAYER_SCALE),
    eye: c.eyeY * PLAYER_SCALE,
  };
  BODIES.set(c.id, body);
  return body;
}
// A rider (web/js/bicycle.js). The legs hang forward to the bottom bracket and go round with
// the crank, one half a turn behind the other; the arms reach for the grips. Tuned by eye in
// /demo against the baked bike - a rigid leg with no knee cannot follow the pedal exactly, and
// a swing a little short of the crank's reads as pedalling rather than as kicking.
const RIDE_LEG = -0.42;
const RIDE_SWING = 0.3;
const RIDE_ARM = -1.15;

// How far the arm swings to hold something out, measured against the same rotation.x the
// stride already uses (a small fraction of a radian mid-stride, ~-0.28 crouching the legs
// forward) - large enough to read as reaching out rather than a bigger stride, checked in
// the browser rather than derived, because there is no elbow here to make the geometry
// answer the question on its own. A shield is carried rather than held out: its arm stays
// down at the side, a little forward, so the plate covers the flank - held out, the fist
// sits at shoulder height and the shield came up beside the head. A beer is held the way
// one is, in front of the chest: held out at -1.3 it was being offered to somebody.
const HOLD_ARM_X = { default: -1.3, shield: -0.35, beer: -0.7 };
const holdX = (item) => HOLD_ARM_X[item] ?? HOLD_ARM_X.default;
// The same in first person, tuned by eye in /demo: high enough that the item stands in the
// bottom corner of the view from the eye, which the arm alone - no elbow - cannot reach.
const FP_HOLD_X = { default: -1.6, shield: -1.2, beer: -1.3 };
// And how each item is turned in first person, on top of standing upright: a blade leaning
// away with its point in towards the middle of the view, a shield turned to show its face.
const FP_TILT = { sword: { x: 0.9, z: 0.35 }, hammer: { x: 0.5, z: 0.3 }, torch: { x: 0.3 }, shield: { yaw: 1.1 }, shovel: { x: 0.6, z: 0.3 } };
const FP_HIDDEN = ['core', 'head', 'backpack', 'chestplate', 'leftLeg', 'rightLeg',
  'leftLegging', 'rightLegging', 'leftBoot', 'rightBoot'];
// A held item's turn about the arm, in radians, mirrored for the left hand. The shield is
// modelled facing straight out from the fist (+X, build-settler.py); a third of a turn
// forward keeps its face readable from in front instead of edge-on.
const ITEM_YAW = { shield: 0.6 };
// Grown about the grip: the baked shield covered little more than a forearm, and in first
// person it read as a lid rather than something to stand behind.
const ITEM_SCALE = { shield: 1.4 };

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

// The miner's pick (web/js/goldmine.js, Plans/DONE/goudmijn.md): the cleaver's terms - a villager's
// tool, not in HAND_ITEMS, handed to him after normalising. The hammer's handle, longer, with a
// head that comes to a point either way across the top of it, so it swings like the hammer.
const PICK_HANDLE = 0x8b5e3c, PICK_HEAD = 0x4a4c52;
function pickaxeGeometry() {
  return withSheet(mergeGeometries([
    box(0.02, 0.24, 0.02, PICK_HANDLE, { y: -0.03 }),
    box(0.03, 0.035, 0.1, PICK_HEAD, { y: 0.155 }),
    box(0.018, 0.022, 0.07, PICK_HEAD, { y: 0.15, z: 0.075 }),
    box(0.018, 0.022, 0.07, PICK_HEAD, { y: 0.15, z: -0.075 }),
  ], false));
}

// The fisherman's rod (web/js/fisher.js, Plans/DONE/regisseur.md): a villager's tool like the pick,
// not in HAND_ITEMS. A pole pointing +y out of the fist, and the line off its tip modelled for
// the one angle he fishes at (fisher.js FISH_ARM): with the arm turned by FISH_ARM about x, a
// line along ROD_LINE in the hand's frame hangs straight down into the water. Swung with the
// arm (a strike, a cast) it swings with the rod, which is what a line does.
const ROD_POLE = 0x6b4a2b, ROD_LINE_HEX = 0xe8e2d0;
const ROD_ARM = -1.9;
const ROD_LINE = [0, -Math.cos(-ROD_ARM), -Math.sin(-ROD_ARM)];
function rodGeometry() {
  const tip = 0.42, line = 0.34;
  const lineGeo = box(0.004, line, 0.004, ROD_LINE_HEX);
  // Laid along ROD_LINE from the tip: turned about x off +y, then set on the tip.
  lineGeo.rotateX(Math.atan2(ROD_LINE[2], ROD_LINE[1]));
  lineGeo.translate(0, tip, 0);
  return withSheet(mergeGeometries([
    box(0.014, 0.5, 0.014, ROD_POLE, { y: -0.08 }),
    lineGeo,
  ], false));
}

// The butcher's cleaver (web/js/butcher.js, Plans/DONE/slagerij.md) - a villager's tool, not a
// player's: it is deliberately not in HAND_ITEMS (avatar.js), so no inventory slot offers it,
// normalizeAvatar drops it and the sea's lookOf never has to know it; the butcher is handed it
// after normalising. Pointing +y out of the fist like every item, with the blade standing
// forward (+z) of the handle's line: at the strike the swing turns the item about 1.8 rad in
// all, which puts that forward edge face down on the block.
const CLEAVER_HANDLE = 0x6b4226, CLEAVER_BLADE = 0xc9ccd1, CLEAVER_BOLSTER = 0x3a3a3f;
function cleaverGeometry() {
  return withSheet(mergeGeometries([
    box(0.02, 0.085, 0.02, CLEAVER_HANDLE, { y: -0.03 }),
    box(0.016, 0.012, 0.024, CLEAVER_BOLSTER, { y: 0.055 }),
    box(0.008, 0.085, 0.055, CLEAVER_BLADE, { y: 0.067, z: 0.022 }),
  ], false));
}

// The first held item its hand's button drinks from rather than fights with (Plans/DONE/
// bier-en-dronken.md). The pint the barman pulls in the tavern (interior.js pintGeometry),
// in the same two colours, a little bigger because it is carried rather than stood on a
// counter. The ear is in the fist and the glass stands inboard of it (-x, mirrored for the
// left hand like everything else): the arm has no elbow, so raised to the face the fist
// stops beside the cheek, and only a glass on the inside of it ends up at the mouth.
const BEER_GLASS = 0xffd27f, BEER_FOAM = 0xf5efe0;
function beerGeometry() {
  return withSheet(mergeGeometries([
    cylinder(0.03, 0.026, 0.075, 8, BEER_GLASS, { x: -0.045, y: -0.035 }),
    cylinder(0.031, 0.031, 0.014, 8, BEER_FOAM, { x: -0.045, y: 0.04 }),
    sphere(0.017, BEER_FOAM, { x: -0.05, y: 0.055 }),
    box(0.012, 0.05, 0.016, BEER_GLASS, { x: -0.01, y: -0.022 }),
  ], false));
}

// The pirate's shovel (shared/equipment.mjs, the first unlockable piece; Plans/schatkaarten.md).
// The grip is at the local origin like every item and the blade is the +y end, so it stands in
// the fist blade-up as an ordinary held item and digging (dig() below) is what turns it over.
// The blade's flat faces look along z: with the item tipped blade-down that is the face that
// meets the soil. A crossbar handle at the butt, a shaft, a socket and a blade that narrows to
// a point - six boxes, 72 triangles.
const SHOVEL_WOOD = 0x8b5e3c, SHOVEL_IRON = 0x8a8f98;
function shovelGeometry() {
  return withSheet(mergeGeometries([
    box(0.024, 0.34, 0.024, SHOVEL_WOOD, { y: 0.05 }),
    box(0.09, 0.022, 0.022, SHOVEL_WOOD, { y: -0.12 }),
    box(0.034, 0.045, 0.034, SHOVEL_IRON, { y: 0.225 }),
    box(0.105, 0.075, 0.01, SHOVEL_IRON, { y: 0.285 }),
    box(0.07, 0.03, 0.01, SHOVEL_IRON, { y: 0.3375 }),
    box(0.03, 0.02, 0.01, SHOVEL_IRON, { y: 0.362 }),
  ], false));
}

// What a pair of arms carries in front of the chest while somebody lugs the treasure statue
// (setCarry below). A stand-in: a gilded block the size of the statue's plinth, named
// 'carried' so the day prop_treasure_carry is baked it is one swap of this mesh's geometry
// (avatar.carried is the group it hangs in). Centred on the origin; the rig places the group.
const CARRIED_GOLD = 0xd9a33d, CARRIED_BASE = 0x6b4a2f;
const CARRIED_HALF = 0.11;   // half the baked figure's 0.22
export function carriedGeometry() {
  // The baked figure (assets/treasure, prop_treasure_carry) once it is there. It stands on its own
  // origin like every prop, and the group it hangs in is placed for a load centred on the origin, so
  // it is lowered by half its height; the stand-in below is the fallback for a build without it.
  if (models.hasAsset('prop_treasure_carry')) {
    const g = mergeParts(meshAsset('prop_treasure_carry'));
    g.translate(0, -CARRIED_HALF, 0);
    if (!g.attributes.aSheet) g.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    return g;
  }
  return withSheet(mergeGeometries([
    box(0.15, 0.05, 0.12, CARRIED_BASE, { y: -0.075 }),
    box(0.1, 0.1, 0.08, CARRIED_GOLD, { y: 0 }),
    sphere(0.038, CARRIED_GOLD, { y: 0.085 }),
  ], false));
}

// The sword and shield used to be built the same procedural way as the hammer above; both
// are baked Blender parts now (see the header comment on EQUIPPABLE), re-centred on GRIP
// the same way makePiece() re-centres a limb on its own pivot. Always the Traveller's: a sword
// is the same sword in whichever hand holds it, and only where that hand is differs per body
// (HAND_ATTACH). The Adventurer's bake carries refitted copies of these parts too, stretched
// with the torso they were packed beside, which is no shape for a blade.
function heldPartGeometry(spec, names) {
  const geometry = avatarPlayerComponentGeometry({ ...spec, character: null }, names);
  const { GRIP } = bodyOf();
  geometry.translate(-GRIP[0], -GRIP[1], -GRIP[2]);
  return geometry;
}

// What HAND_ITEMS (avatar.js) can resolve to. The procedural ones are cheap enough (under
// a dozen primitives) that nothing here is worth caching; the baked ones go through
// heldPartGeometry() instead, which needs the current spec to pick up a recolour. Both are
// exported for the inventory's slot icons, which show the item on its own.
const HELD_ITEM_PROCEDURAL = { parasol: parasolGeometry, hammer: hammerGeometry, beer: beerGeometry, cleaver: cleaverGeometry, pickaxe: pickaxeGeometry, rod: rodGeometry, shovel: shovelGeometry };
export const HELD_ITEM_PARTS = { sword: SWORD, shield: SHIELD, torch: TORCH };

export function heldItemGeometry(item, spec) {
  if (HELD_ITEM_PROCEDURAL[item]) return HELD_ITEM_PROCEDURAL[item]();
  if (HELD_ITEM_PARTS[item]) return heldPartGeometry(spec, HELD_ITEM_PARTS[item]);
  return null;
}

// One body's rig. createClassicAvatar below is what everybody holds; it builds one of these
// and builds a new one when the look changes body.
function buildRig(spec, material) {
  const { id: character, parts: PARTS, joints: JOINTS, fingers: FINGERS, LIMBS, HEAD, CORE, BACKPACK: BACK, PIVOTS, HAND_ATTACH, hipY, eye, gait: G } = bodyOf(spec?.character);
  // The island shares a flat building material. Give this rig smooth shading while
  // retaining its shader hooks and live night/fade uniforms; never mutate the world.
  const sourceMaterial = material;
  if (material.flatShading) {
    material = material.clone();
    material.flatShading = false;
    material.userData = sourceMaterial.userData;
    material.onBeforeCompile = sourceMaterial.onBeforeCompile;
    // Unbound: both read `this`, and a body is never seen through (see-through.js) - the
    // walker is what the cone is cut to show, and a smith or a peer is a person, not a wall.
    material.customProgramCacheKey = sourceMaterial.customProgramCacheKey;
    material.seeThroughOff = true;
  }
  const object = new THREE.Group();
  // The bake names its hands the wrong way round: "Right hand" is at +x, and a figure facing
  // +z has its right hand at -x - so the Right hand slot and the right mouse button have
  // always worked the hand on the left, which first person made impossible to miss (the
  // sword on the left of the screen). Mirroring the whole rig puts every "right" on the right
  // without touching a name, a sign or a test of which hand is which; the figure is
  // symmetric, and three.js flips the winding for a negative determinant.
  object.scale.x = -1;
  const pieces = {};
  const chains = {};
  const gait = createGait(PIVOTS.leftLeg[1], JOINTS.leftLeg.bend[1]*PLAYER_SCALE,
    JOINTS.leftLeg.end[1]*PLAYER_SCALE, G);
  let previousParent = null;
  const parentAt = new THREE.Vector3(), lastParentAt = new THREE.Vector3();
  function bindLimb(mesh, group) {
    if (!chains[group]) {
      const root = new THREE.Bone(), bend = new THREE.Bone(), end = new THREE.Bone();
      root.name = group + ':root'; bend.name = group + ':bend'; end.name = group + ':end';
      const origin = new THREE.Vector3(...PIVOTS[group]);
      const knee = new THREE.Vector3(...JOINTS[group].bend).multiplyScalar(PLAYER_SCALE);
      const ankle = new THREE.Vector3(...JOINTS[group].end).multiplyScalar(PLAYER_SCALE);
      bend.position.copy(knee).sub(origin); end.position.copy(ankle).sub(knee);
      root.add(bend); bend.add(end); mesh.add(root);
      // A fourth bone for the top of a sleeve (SHOULDER_CAP): at the shoulder, turned back by
      // whatever the arm's pivot turned, so what is weighted to it stays with the torso.
      const bones = [root, bend, end];
      let cap = null, toe = null, ball = null;
      const fingers = [];
      if (FINGERS?.[group]) {
        bones.push(...torso.skeleton.bones);
        for (const joint of FINGERS[group]) {
          const bone = new THREE.Bone();
          bone.name = group + ':' + joint.name;
          const parentPoint = joint.parent === 2 ? ankle : new THREE.Vector3(...FINGERS[group][joint.parent - 8].point).multiplyScalar(PLAYER_SCALE);
          bone.position.set(...joint.point).multiplyScalar(PLAYER_SCALE).sub(parentPoint);
          bones[joint.parent].add(bone);
          bones.push(bone);
          fingers.push({ bone, axis: new THREE.Vector3(...joint.axis), relaxed: joint.relaxed, grip: joint.grip });
        }
      } else if (G.leanAtHip && group.endsWith('Arm')) { cap = new THREE.Bone(); cap.name = group + ':cap'; root.add(cap); bones.push(cap); }
      // A toe for the foot (Mixamo's ToeBase), at the ball: FOOT_BALL of the way from the ankle
      // to the tip of the first mesh bound to this leg (its own body), on the ground.
      if (group.endsWith('Leg')) {
        const local = ankle.clone().sub(origin);
        ball = ballOf(mesh.geometry, local);
        toe = new THREE.Bone(); toe.name = group + ':toe';
        toe.position.copy(ball).sub(local);
        end.add(toe); bones.push(toe);
      }
      chains[group] = { root, bend, end, cap, toe, ball, fingers, grasp: 0, knee: knee.sub(origin), ankle: ankle.sub(origin),
        skeleton: new THREE.Skeleton(bones) };
    }
    if (chains[group].toe) weightToes(mesh.geometry, chains[group]);
    object.updateMatrixWorld(true);
    mesh.bind(chains[group].skeleton);
    mesh.frustumCulled = false;
  }

  // `parent` defaults to the top-level group and `groupAt`/`translateBy` to the piece's own
  // named pivot (PIVOTS[name]) - which is what every original piece (core, the four limbs,
  // the backpack) still wants. Chestplate, leggings and boots are the exception: they want
  // to swing with a limb they are not the limb of, so they are parented straight onto that
  // limb's own pivot with no group offset of their own (it is already inside one), while
  // the geometry itself is still translated by that limb's pivot point - the same quantity,
  // used two different ways, which is why the two are separate options instead of one.
  // The top of a sleeve, on a body that swings its arms far (the Adventurer): the arm turns
  // whole about the shoulder, and at a sprint's swing the sleeve's edge stood out of the torso
  // in jagged points. What lies above SHOULDER_CAP.to over the pivot goes with the torso
  // (`cap`, up to SHOULDER_CAP.most of it), fading to the arm by SHOULDER_CAP.from below it,
  // so the cloth stretches instead.
  const SHOULDER_CAP = { from: -.05, to: .004, most: .85 };
  function capShoulder(geometry, name) {
    if (FINGERS?.[name]) return; // Source weights share the torso bones across the sleeve seam.
    if (!G.leanAtHip || !name.endsWith('Arm')) return;
    const p = geometry.attributes.position, ix = geometry.attributes.skinIndex, w = geometry.attributes.skinWeight;
    for (let i = 0; i < p.count; i++) {
      const u = Math.max(0, Math.min(1, (p.getY(i) - SHOULDER_CAP.from) / (SHOULDER_CAP.to - SHOULDER_CAP.from)));
      const a = u * u * (3 - 2 * u) * SHOULDER_CAP.most;
      if (!a) continue;
      ix.setW(i, 3);
      w.setXYZW(i, w.getX(i) * (1 - a), w.getY(i) * (1 - a), w.getZ(i) * (1 - a), a);
    }
  }
  // Where the ball of a foot is in a leg's mesh: the furthest-forward point within a hand of the
  // sole, FOOT_BALL of the way out from the ankle.
  const FOOT_BALL = .6, TOE_FADE = .012;
  function ballOf(geometry, ankle) {
    const p = geometry.attributes.position;
    let tip = ankle.z, sole = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < ankle.y + .012) tip = Math.max(tip, p.getZ(i));
      sole = Math.min(sole, p.getY(i));
    }
    const ball = new THREE.Vector3(ankle.x, Math.max(sole, ankle.y - .03), ankle.z + (tip - ankle.z) * FOOT_BALL);
    ball.tip = tip - ball.z;   // how far the toe reaches past the ball
    return ball;
  }
  // The toe takes the front of the foot, past the ball, faded in over TOE_FADE.
  function weightToes(geometry, chain) {
    const p = geometry.attributes.position, ix = geometry.attributes.skinIndex, w = geometry.attributes.skinWeight;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > chain.ankle.y + .02) continue;
      const a = Math.max(0, Math.min(1, (p.getZ(i) - chain.ball.z) / TOE_FADE));
      if (!a) continue;
      ix.setW(i, 3);
      w.setXYZW(i, w.getX(i) * (1 - a), w.getY(i) * (1 - a), w.getZ(i) * (1 - a), a);
    }
  }
  // The torso is no longer one rigid piece (Plans/tweede-avonturier.md): it is skinned to a
  // spine of four bones - the pelvis at the hips, the small of the back, the chest and the neck -
  // whose rotations Mixamo's Hips, Spine, Spine2 and Neck give (gait-clips.js). Whatever hangs
  // from one of them rigidly - the legs from the pelvis, the pack, the chestplate and the
  // collarbones from the chest, the head from the neck - hangs from a *mount*: a group whose
  // matrix is that bone's change from its rest, exactly what skinning does to a vertex wholly
  // its own. So every pivot keeps its old position, in the rig's frame at rest, and the code
  // that reads one (a drink, a held item) reads what it always did.
  const SPINE = (() => {
    const yH = PIVOTS.leftLeg[1], yS = PIVOTS.leftArm[1], yN = PIVOTS.head[1], L = yS - yH;
    return { pelvis: yH, spine: yH + .3 * L, chest: yH + .7 * L, neck: yN, L, shoulder: yS };
  })();
  const torso = {};
  {
    let parent = object, below = 0;
    for (const name of ['pelvis', 'spine', 'chest', 'neck']) {
      const b = new THREE.Bone();
      b.name = 'torso:' + name;
      b.position.set(0, SPINE[name] - below, 0);
      parent.add(b);
      torso[name] = b;
      parent = b; below = SPINE[name];
    }
    const bones = [torso.pelvis, torso.spine, torso.chest, torso.neck];
    if (FINGERS) {
      torso.head = new THREE.Bone();
      torso.head.name = 'torso:head';
      torso.neck.add(torso.head);
      bones.push(torso.head);
    }
    torso.skeleton = new THREE.Skeleton(bones);
    torso.rest = { spine: torso.spine.position.y };
  }
  const mounts = {};
  for (const name of ['pelvis', 'chest', 'neck']) {
    const g = new THREE.Group();
    g.name = 'mount:' + name;
    g.matrixAutoUpdate = false;
    object.add(g);
    mounts[name] = g;
  }
  // The collarbones: a group per arm on the chest, turning about the inner end of the shoulder
  // (a third of the way out from the middle), which the arm's own pivot hangs from.
  const clavicles = {}, clavicleAt = {}, clavicleQ = {};
  for (const side of ['leftArm', 'rightArm']) {
    const g = new THREE.Group();
    g.name = 'clavicle:' + side;
    g.matrixAutoUpdate = false;
    mounts.chest.add(g);
    clavicles[side] = g;
    clavicleAt[side] = new THREE.Vector3(PIVOTS[side][0] * .3, PIVOTS[side][1], PIVOTS[side][2]);
    clavicleQ[side] = new THREE.Quaternion();
  }
  // Pelvis, small of the back, chest and neck: what the torso's vertices go with, by height,
  // each band fading into the next.
  function weightTorso(geometry, offsetY = 0) {
    const p = geometry.attributes.position, ix = geometry.attributes.skinIndex, w = geometry.attributes.skinWeight;
    const ramp = (y, from, span) => Math.max(0, Math.min(1, (y - from) / span));
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) + offsetY;
      const a = ramp(y, SPINE.pelvis + .1 * SPINE.L, .3 * SPINE.L);
      const b = ramp(y, SPINE.spine + .1 * SPINE.L, .3 * SPINE.L);
      const c = ramp(y, SPINE.shoulder + .3 * (SPINE.neck - SPINE.shoulder), .6 * (SPINE.neck - SPINE.shoulder));
      ix.setXYZW(i, 0, 1, 2, 3);
      w.setXYZW(i, 1 - a, a * (1 - b), a * b * (1 - c), a * b * c);
      if (FINGERS && y >= SPINE.neck) {
        // The exposed neck and the lower head overlap in the source. Give both the
        // same deformation instead of tearing that overlap apart when the head turns.
        const head = ramp(y, SPINE.neck, .016 * PLAYER_SCALE);
        ix.setXYZW(i, 3, 4, 0, 0);
        w.setXYZW(i, 1 - head, head, 0, 0);
      }
    }
  }
  const restOf = { pelvis: SPINE.pelvis, chest: SPINE.chest, neck: SPINE.neck };
  const chainTo = { pelvis: ['pelvis'], chest: ['pelvis', 'spine', 'chest'], neck: ['pelvis', 'spine', 'chest', 'neck'] };
  const acc = new THREE.Matrix4(), restInv = new THREE.Matrix4(), around = new THREE.Matrix4(), turnM = new THREE.Matrix4();
  // Every mount to its bone's change from rest, and every collarbone about its own inner end.
  function placeMounts() {
    for (const name of ['pelvis', 'spine', 'chest', 'neck']) torso[name].updateMatrix();
    for (const [name, chain] of Object.entries(chainTo)) {
      acc.identity();
      for (const b of chain) acc.multiply(torso[b].matrix);
      mounts[name].matrix.copy(acc).multiply(restInv.makeTranslation(0, -restOf[name], 0));
      mounts[name].matrixWorldNeedsUpdate = true;
    }
    for (const side of ['leftArm', 'rightArm']) {
      const c = clavicleAt[side];
      clavicles[side].matrix.makeTranslation(c.x, c.y, c.z)
        .multiply(turnM.makeRotationFromQuaternion(clavicleQ[side]))
        .multiply(around.makeTranslation(-c.x, -c.y, -c.z));
      clavicles[side].matrixWorldNeedsUpdate = true;
    }
  }
  const capQ = new THREE.Quaternion();
  function makePiece(name, names, { parent = object, groupAt = PIVOTS[name] || [0, 0, 0], translateBy = groupAt } = {}) {
    const pivot = new THREE.Group();
    pivot.position.set(...groupAt);
    const geometry = avatarPlayerComponentGeometry(spec, names);
    geometry.translate(-translateBy[0], -translateBy[1], -translateBy[2]);
    capShoulder(geometry, name);
    const group = PARTS.find((part) => names.includes(part.name) && part.skinGroup)?.skinGroup;
    const mesh = group ? new THREE.SkinnedMesh(geometry, material) : new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    pivot.add(mesh);
    parent.add(pivot);
    if (group) bindLimb(mesh, group);
    pieces[name] = { pivot, mesh, names, at: translateBy };
  }

  makePiece('core', CORE);
  {
    // The torso, skinned to the spine (above) instead of standing whole.
    const old = pieces.core.mesh, skinned = new THREE.SkinnedMesh(old.geometry, material);
    weightTorso(skinned.geometry);
    skinned.castShadow = true;
    skinned.frustumCulled = false;
    pieces.core.pivot.remove(old);
    pieces.core.pivot.add(skinned);
    pieces.core.mesh = skinned;
    object.updateMatrixWorld(true);
    skinned.bind(torso.skeleton);
  }
  makePiece('head', HEAD, { parent: mounts.neck });
  if (FINGERS) {
    pieces.head.pivot.add(torso.head);
    const old = pieces.head.mesh, head = new THREE.SkinnedMesh(old.geometry, material);
    weightTorso(head.geometry, PIVOTS.head[1]);
    head.castShadow = true;
    head.frustumCulled = false;
    pieces.head.pivot.remove(old);
    pieces.head.pivot.add(head);
    pieces.head.mesh = head;
    object.updateMatrixWorld(true);
    head.bind(torso.skeleton);
  }
  for (const [name, names] of Object.entries(LIMBS)) {
    makePiece(name, names, { parent: name.endsWith('Leg') ? mounts.pelvis : clavicles[name] });
  }
  makePiece('backpack', BACK, { parent: mounts.chest });
  makePiece('chestplate', CHESTPLATE, { parent: mounts.chest });
  placeMounts();
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
  // What the hands are doing beyond holding: see dig() and setCarry() below. Declared here,
  // ahead of the first setHeldItem, which reads `carrying`.
  let digging = null, carrying = false;
  for (const side of ['leftArm', 'rightArm']) {
    const g = new THREE.Group();
    g.position.set(...HAND_ATTACH[side]);
    pieces[side].pivot.add(g);
    handAttach[side] = g;
  }

  // The look the rig last wore: a shovel taken up for a dig is cut from it, and a change of
  // look in the middle of a dig has to know what to put back.
  let lookSpec = spec;
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
    mesh.scale.setScalar(ITEM_SCALE[item] || 1);
    if (left) mesh.scale.x = -mesh.scale.x;
    mesh.rotation.y = (left ? 1 : -1) * (ITEM_YAW[item] || 0);
    if (item === 'torch') {
      const light = new THREE.PointLight(TORCH_LIGHT.color, 0, TORCH_LIGHT.distance, 2);
      light.position.y = TORCH_LIGHT.y;
      mesh.add(light);
      mesh.userData.light = light;
    }
    // Whatever the hands hold is out of sight while they carry something else.
    mesh.visible = !carrying;
    handAttach[side].add(mesh);
    heldMesh[side] = mesh;
  }
  setHeldItem('leftArm', spec.equip?.leftHandItem || null, spec);
  setHeldItem('rightArm', spec.equip?.rightHandItem || null, spec);

  // Attacking and blocking (Plans/DONE/aanvallen-en-blokkeren.md). A swing is a short, timed
  // profile on the weapon arm - wind up behind the shoulder, strike forward and down,
  // recover to whatever the arm was doing - driven directly rather than through damp(),
  // which at 15/s would smear a 0.45 s swing into a wave. The held item stops standing
  // upright for the duration and turns about the fist with its own wrist (swingPose), and
  // the counter-rotation takes over again at the end of the recovery. A block is a held pose, so it goes through the same targets and
  // damping as everything else: the shield arm comes up in front, and the shield turns from
  // its resting yaw to a quarter turn so its face points forward.
  const SWING_S = 0.45, BLOCK_ARM_X = -1.25, WEAPONS = new Set(['sword', 'hammer', 'parasol', 'cleaver', 'pickaxe']);
  let swing = null;   // { side, t, from } while an attack is playing
  const ease = (u) => u * u * (3 - 2 * u);
  // The hand that swings when nobody says which: a weapon if there is one (right first),
  // otherwise a free fist, otherwise whatever the right holds. The hand that blocks when
  // nobody says which: the shield if there is one, otherwise the hand that would not be
  // swinging. walk.js says which - one mouse button per hand - so these are the defaults
  // for anything that does not (the studio, a test).
  const attackSide = () => (WEAPONS.has(holding.rightArm) ? 'rightArm' : WEAPONS.has(holding.leftArm) ? 'leftArm'
    : holding.rightArm !== 'shield' ? 'rightArm' : 'leftArm');
  const blockSide = () => (holding.leftArm === 'shield' ? 'leftArm' : holding.rightArm === 'shield' ? 'rightArm'
    : attackSide() === 'rightArm' ? 'leftArm' : 'rightArm');

  // Whether a swing started. walk.js tells the sea once for each one that did (net.js
  // swing()), so a click the arm refused - still winding up - is no blow on the sea either.
  // (The sea counts one per 0.45 s, the length of the swing; one that cuts the last short
  // past its strike is drawn but not sent - see SWING_MS in net.js.)
  function attack(side = attackSide()) {
    // The hands are busy with the shovel; a click is no blow (walk.js does not offer one
    // either - this only keeps the arm from fighting the dig pose for the shoulder).
    if (digging) return false;
    // A swing past its strike can be cut short by the next one; one still winding up or
    // striking plays out, or mashing the button would jitter the arm at the top.
    if (swing && swing.t / SWING_S < 0.6) return false;
    swing = { side, t: 0, from: pieces[side].pivot.rotation.x };
    return true;
  }

  // Where the swinging arm is, u of the way through, and the item's own turn about the fist
  // (`wrist`, its rotation.x under the arm). `rest` is what the arm would be doing had it not
  // swung, which is where the recovery lands. Every item points +y out of the fist, so the
  // item is at arm + wrist in the arm's frame: held upright the wrist is -arm, and a wrist of
  // 0 lays the item along the arm back towards the shoulder - which is what "the item goes
  // with the arm" (w: 1, the old profile) drew: a hammer that struck upwards beside the head,
  // having snapped from upright to that in the first frame. The wrist starts where the held
  // pose left it and stays there on the way up, so the arm raised overhead cocks the head
  // back behind the shoulder; it then snaps forward with the strike so the head comes down
  // in front at waist height; the recovery hands it back to the upright counter-rotation.
  const WIND_ARM = -2.7, STRIKE_ARM = -0.5, STRIKE_WRIST = 2.3;
  function swingPose(s, rest) {
    const lerp = THREE.MathUtils.lerp, u = Math.min(1, s.t / SWING_S);
    const cocked = -s.from;
    if (u < 0.3) return { x: lerp(s.from, WIND_ARM, ease(u / 0.3)), wrist: cocked };
    if (u < 0.55) {
      const e = ease((u - 0.3) / 0.25);
      return { x: lerp(WIND_ARM, STRIKE_ARM, e), wrist: lerp(cocked, STRIKE_WRIST, e) };
    }
    const r = ease((u - 0.55) / 0.45), x = lerp(STRIKE_ARM, rest, r);
    return { x, wrist: lerp(STRIKE_WRIST, -x, r) };
  }

  // Drinking (Plans/DONE/bier-en-dronken.md). A beer's hand drinks where any other hand would swing
  // - walk.js gives each hand its own mouse button - and lifts the glass instead: up to the
  // face and a little inward, a swallow with the glass tipped towards the mouth, and back
  // down. Timed
  // and driven directly like the swing, one per hand. Only the
  // swallow counts, and it is handed out a frame at a time through swallowed(), which is what
  // lets walk.js fill the bar while the glass is tipped rather than once it is back down.
  // The glass is not counter-rotated while it is drunk from: it is given a whole orientation
  // in the body's frame (SIP at the start of the swallow, TIPPED at its end, slerped), because
  // a roll about the arm's own z is what this used to be - it tipped the glass sideways
  // beside the cheek until its top pointed at the ground, which looked like pouring it out.
  // The numbers were found by a search over the real rig (right hand; the left is its
  // mirror): the arm raised to -1.5 and turned 0.62 inward puts the fist beside the chin,
  // and SIP/TIPPED put the near edge of the rim on the mouth with the glass standing in front
  // of the face and its top leaning back into it - 40 degrees off upright, then 78.
  const DRINK_S = 1.6, GULP = [0.45, 1.25], DRINK_ARM = { x: -1.51, rise: 0.06, z: 0.62 };
  const quatOf = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  const UPRIGHT = new THREE.Quaternion(), SIP = quatOf(-0.81, 0.51, 0.31), TIPPED = quatOf(-1.45, 0.35, 0.47);
  // Two pints are not two arms drinking in turn - nobody drinks like that - but a beer relay
  // (bierestafette), the way Martijn's reference picture has it: the hand whose button it was
  // lifts its glass to the mouth, the other stacks its own on top and pours it in, a thin
  // stream running between them, and both go down in the one swallow, the head tipped back.
  // The stack: both glasses on the body's middle line, not rolled to either side, both
  // openings towards the face; the lower one fairly upright (58 degrees above level, 40 by
  // the end, before the head's tip adds its own), the upper one 20 more tipped, its bottom lip
  // resting just inside the lower one's top lip. Tipped further than that it read as pouring
  // the lot over his face. Our pints are straight rather than the tapered cups that nest in the picture, so
  // they lean rim on rim instead of sliding into each other.
  // The arm has no elbow and is a tenth of a unit long, so no fist gets in front of the face:
  // the glasses slide out of the fists for the relay (`slide`, eased in and out with the
  // reach), 5 cm for the drinking one and 11 for the pouring one, which also stand 1.5 cm
  // off the face: close enough to read as at the mouth. Every number is a key(), seven per
  // glass through the swallow, found by a search over the real rig that refused any
  // glass in the head, nose or hat (1 mm of rim on the lips allowed), any overlap between
  // the two glasses, and neighbouring keys that were not neighbours - two end poses solved
  // alone went 13 mm into the face half way between them.
  // key(arm x, arm z inwards, glass turn in the body's frame, slide in the arm's frame) - for
  // the right hand; the left is its mirror.
  const key = (x, z, qx, qy, qz, sx, sy, sz) => ({ x, z, q: quatOf(qx, qy, qz), slide: new THREE.Vector3(sx, sy, sz) });
  const RELAY_S = 2.6, RELAY_GULP = [0.55, 2.1];
  const PROFILE = {
    sip: { s: DRINK_S, gulp: GULP, arm: DRINK_ARM, start: SIP, end: TIPPED, dose: 1 },
    relay: { s: RELAY_S, gulp: RELAY_GULP, dose: 2, keys: [
      key(-1.381, 0.718, 2.579, 3.105, -3.127, 0.014, -0.05, 0.011), key(-1.391, 0.715, 2.531, 3.104, -3.126, 0.014, -0.05, 0.011),
      key(-1.4, 0.713, 2.481, 3.104, -3.125, 0.014, -0.051, 0.012), key(-1.406, 0.711, 2.45, 3.105, -3.125, 0.014, -0.052, 0.012),
      key(-1.41, 0.708, 2.408, 3.105, -3.123, 0.015, -0.053, 0.012), key(-1.412, 0.705, 2.375, 3.105, -3.122, 0.015, -0.054, 0.012),
      key(-1.409, 0.702, 2.314, 3.11, -3.122, 0.015, -0.054, 0.011)] },
    pour: { s: RELAY_S, gulp: RELAY_GULP, dose: 0, keys: [
      key(-1.631, 0.606, 2.177, 3.086, 3.17, 0.033, -0.107, 0.024), key(-1.648, 0.606, 2.142, 3.087, 3.169, 0.032, -0.107, 0.025),
      key(-1.665, 0.605, 2.103, 3.088, 3.169, 0.032, -0.106, 0.025), key(-1.68, 0.605, 2.064, 3.09, 3.169, 0.031, -0.106, 0.025),
      key(-1.693, 0.604, 2.026, 3.091, 3.169, 0.031, -0.106, 0.024), key(-1.704, 0.604, 1.988, 3.093, 3.17, 0.031, -0.105, 0.024),
      key(-1.709, 0.604, 1.952, 3.099, 3.169, 0.03, -0.104, 0.023)] },
  };
  const OTHER = { leftArm: 'rightArm', rightArm: 'leftArm' };
  // And the relay is drunk with the head tipped back, the way it is in the pub: further back
  // as the glasses empty, eased in and out with the reach. The stack of glasses turns about
  // the neck with the head, so it stays at the mouth, and the arms follow part of the way up
  // (ARM_FOLLOW) so the glasses do not have to slide further out of the fists for it.
  const HEAD_BACK = [0.2, 0.35], ARM_FOLLOW = 0.6;
  const tiltQ = new THREE.Quaternion(), armQ = new THREE.Quaternion(), unArm = new THREE.Quaternion();
  const turn = new THREE.Euler(), neck = new THREE.Vector3(), at = new THREE.Vector3();
  const MIRROR = { rightArm: new THREE.Vector3(1, 1, 1), leftArm: new THREE.Vector3(-1, 1, 1) };
  const drinks = { leftArm: null, rightArm: null };
  let gulped = 0;
  // The stream from one glass into the other: a thin amber cylinder hung off the body and
  // stretched between the two rims every frame it shows. Its own tiny geometry on the shared
  // material, so it is no new program; no shadow, it is two centimetres of beer.
  const stream = new THREE.Mesh(withSheet(cylinder(0.005, 0.0065, 1, 5, BEER_GLASS, { y: -1 })), material);
  stream.visible = false;
  object.add(stream);
  const RIM = new THREE.Vector3(-0.045, 0.047, 0), DOWN = new THREE.Vector3(0, -1, 0);
  const pourFrom = new THREE.Vector3(), pourTo = new THREE.Vector3();
  // A beer handed to a settler (main.js giveBeer): the arm reaches out with it, the glass
  // leaves the hand as they take it, and a fresh one is back in the fist once theirs is down,
  // `away` seconds later - the pint in a hand is a thing you carry, not a thing you run out of.
  const HAND_OVER = { reach: 0.5, x: -1.5 };
  const given = { leftArm: null, rightArm: null };
  function handOver(side, away) {
    if (holding[side] !== 'beer' || given[side]) return false;
    drinks[side] = null;
    given[side] = { t: 0, away };
    return true;
  }

  // Whether `side` ('leftArm' or 'rightArm') started a drink: not without a glass in it, and
  // not while it is still drinking the last one or has just handed it over. With a glass in
  // the other hand too it is the relay, and then the other hand has to be free as well: two
  // pints go down together or not at all, never one after the other.
  function drink(side) {
    if (holding[side] !== 'beer' || drinks[side] || given[side]) return false;
    const other = OTHER[side], relay = holding[other] === 'beer' && !given[other];
    if (relay && drinks[other]) return false;
    const start = (s, kind) => {
      drinks[s] = { t: 0, kind, from: pieces[s].pivot.rotation.x, fromZ: pieces[s].pivot.rotation.z };
    };
    start(side, relay ? 'relay' : 'sip');
    if (relay) start(other, 'pour');
    return true;
  }
  // How much of a whole drink went down since the last time this was asked.
  function swallowed() { const g = gulped; gulped = 0; return g; }

  // Digging (Plans/schatkaarten.md, "Graven met een schep"). Not a blow and not a drink: a
  // dig lasts, so - like a dance - it is a state somebody switches on with dig(true) and off
  // again, and the rig repeats one stroke for as long as it is on. The stroke is DIG_S long:
  // the blade goes into the ground (DIG_KEYS[1], 0.25 s), is lifted with its load and flung
  // to the side (0.35 s, the throw at THROW_AT), and comes back to where it started. The
  // whole body bows forward with it (`lean`, about the feet, the way a dancer's does) and the
  // legs stand apart. `tilt` is the shovel's own turn about x in the body's frame - 0 blade
  // up, pi blade down, to which the bow (`lean`) is added in the world: the numbers below put
  // the blade 0.1 deep in the ground about 0.4 in front of the feet, and the load flat
  // (tilt + lean = pi / 2) on the way up - and the rest is the arm's, driven by update() through damping quick
  // enough to keep the 0.25 s plunge.
  // The dig takes the shovel into the hand whether or not it is worn (`swapped` remembers
  // what it displaced, `prev`, and puts it back the moment the dig stops): the player has to
  // be able to dig with a sword equipped without opening the bag first.
  const DIG_S = 0.6, THROW_AT = 0.45;
  const DIG_START = { t: 0, x: -1.75, tilt: 0.74, z: 0.42, lean: 0.36 };
  const DIG_KEYS = [
    DIG_START,
    { t: 0.25, x: -0.8, tilt: 2.14, z: 0.25, lean: 0.46 },     // the blade in the ground
    { t: THROW_AT, x: -1.35, tilt: 1.15, z: 0.3, lean: 0.4 },   // lifted, the load flat on the blade
    { ...DIG_START, t: DIG_S },                                  // flicked up and off, round again
  ];
  // The hand that is not on the shovel steadies the shaft: forward and in, holding nothing.
  const DIG_OFF_ARM = -1.0, DIG_OFF_Z = 0.3;
  const DIG_STANCE = { back: -0.22, front: 0.12 };
  function digKey(t) {
    const lerp = THREE.MathUtils.lerp;
    let i = 0;
    while (i < DIG_KEYS.length - 2 && t >= DIG_KEYS[i + 1].t) i++;
    const a = DIG_KEYS[i], b = DIG_KEYS[i + 1], u = ease(Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))));
    return { x: lerp(a.x, b.x, u), tilt: lerp(a.tilt, b.tilt, u), z: lerp(a.z, b.z, u), lean: lerp(a.lean, b.lean, u) };
  }
  let dirt = 0;                       // shovelfuls flung since digged() was last asked
  let tiltNow = 0, tiltSide = null;   // the shovel's own turn, damped so it neither snaps in nor out
  function takeShovel() {
    const d = digging;
    d.prev = holding[d.side];
    d.swapped = d.prev !== 'shovel';
    if (d.swapped) setHeldItem(d.side, 'shovel', lookSpec);
  }
  // Start (`on`) or stop digging with `side` ('leftArm' or 'rightArm'; by default the hand that
  // already has a shovel, else a free one, else the right). True when this call started a dig;
  // idempotent otherwise, so a frame loop can hand it the state every frame. Refused while the
  // arms carry something (setCarry).
  function dig(on = true, side) {
    if (!on) {
      if (!digging) return false;
      const d = digging;
      digging = null;
      // The shovel goes back where it came from at once; the arm eases up on its own.
      if (d.swapped) { setHeldItem(d.side, d.prev, lookSpec); tiltSide = null; tiltNow = 0; }
      return false;
    }
    if (digging || carrying) return false;
    digging = {
      side: side || (holding.rightArm === 'shovel' ? 'rightArm' : holding.leftArm === 'shovel' ? 'leftArm'
        : !holding.rightArm ? 'rightArm' : !holding.leftArm ? 'leftArm' : 'rightArm'),
      t: 0, prev: null, swapped: false,
    };
    swing = null;
    takeShovel();
    tiltSide = digging.side;
    return true;
  }
  // How many shovelfuls were flung since the last call: walk.js grows the pile and throws the
  // dust once for each, so the sand follows the stroke the rig draws instead of a timer of its own.
  function digged() { const n = dirt; dirt = 0; return n; }

  // Carrying (the treasure statue, Plans/schatkaarten.md): both arms out in front and held high,
  // the load between the fists, the body leaning back against the weight. Hands that hold
  // something else let go of it out of sight (the item stays in the spec and comes back).
  // `carried` is a group so the finished model can replace the stand-in's geometry without
  // touching the rig; it hangs on the body's root, so it leans with it.
  const CARRY_ARM = -1.42, CARRY_Z = 0.5, CARRY_LEAN = -0.1;
  // Treading water (update() below): how far the free arms are held out sideways, how far
  // forward, how far they scull about that and how fast, and how far the legs kick.
  const TREAD_OUT = -0.85, TREAD_ARM = -0.25, TREAD_SCULL = 0.3, TREAD_RATE = 2.4, TREAD_KICK = 0.35;
  const CARRIED_AT = [0, 0.29 * PLAYER_SCALE, 0.145];
  const carried = new THREE.Group();
  carried.name = 'carried';
  carried.position.set(...CARRIED_AT);
  carried.visible = false;
  const carriedMesh = new THREE.Mesh(carriedGeometry(), material);
  carriedMesh.castShadow = true;
  carried.add(carriedMesh);
  object.add(carried);
  // True when this call changed it. A dig in progress is put down first: the hands cannot do both.
  function setCarry(on = true) {
    on = !!on;
    if (on === carrying) return false;
    if (on) dig(false);
    carrying = on;
    carried.visible = on;
    for (const side of ['leftArm', 'rightArm']) if (heldMesh[side]) heldMesh[side].visible = !on;
    return true;
  }

  // Where a drinking arm is, and the glass's orientation in the body's frame - worked out
  // for the right hand and mirrored for the left (X·q·X: y and z negated).
  // `rest`/`restZ` are what the arm would be doing had it not lifted the glass.
  function drinkPose(d, side, rest, restZ) {
    const lerp = THREE.MathUtils.lerp, prof = PROFILE[d.kind], [g0, g1] = prof.gulp, sign = side === 'rightArm' ? -1 : 1;
    let pose;
    if (prof.keys) {
      // A relay glass: up to the first key, through the keys, and down from the last.
      const K = prof.keys, first = K[0], last = K[K.length - 1];
      if (d.t < g0) {
        const e = ease(d.t / g0);
        pose = { x: lerp(d.from, first.x, e), z: lerp(d.fromZ, sign * first.z, e), q: UPRIGHT.clone().slerp(first.q, e),
          slide: first.slide.clone().multiplyScalar(e), reach: e, g: 0 };
      } else if (d.t < g1) {
        const g = (d.t - g0) / (g1 - g0), u = ease(g) * (K.length - 1), i = Math.min(K.length - 2, Math.floor(u)), f = u - i;
        const a = K[i], b = K[i + 1];
        pose = { x: lerp(a.x, b.x, f), z: sign * lerp(a.z, b.z, f), q: a.q.clone().slerp(b.q, f), slide: a.slide.clone().lerp(b.slide, f), reach: 1, g };
      } else {
        const e = ease(Math.min(1, (d.t - g1) / (prof.s - g1)));
        pose = { x: lerp(last.x, rest, e), z: lerp(sign * last.z, restZ, e), q: last.q.clone().slerp(UPRIGHT, e),
          slide: last.slide.clone().multiplyScalar(1 - e), reach: 1 - e, g: 1 };
      }
      pose.slide.multiply(MIRROR[side]);
    } else {
      const { s: DRINK_S, arm, start: SIP, end: TIPPED } = prof;
      const upX = arm.x, topX = upX + arm.rise, upZ = sign * arm.z;
      if (d.t < g0) {
        const e = ease(d.t / g0);
        pose = { x: lerp(d.from, upX, e), z: lerp(d.fromZ, upZ, e), q: UPRIGHT.clone().slerp(SIP, e) };
      } else if (d.t < g1) {
        // The glass tips further as it empties, and the arm bobs once a gulp.
        const g = (d.t - g0) / (g1 - g0);
        pose = { x: lerp(upX, topX, g) + 0.035 * Math.sin(g * Math.PI * 5), z: upZ, q: SIP.clone().slerp(TIPPED, ease(g)) };
      } else {
        const e = ease(Math.min(1, (d.t - g1) / (DRINK_S - g1)));
        pose = { x: lerp(topX, rest, e), z: lerp(upZ, restZ, e), q: TIPPED.clone().slerp(UPRIGHT, e) };
      }
    }
    // The authored drinking keys were solved on the earlier, broader rig. Retarget
    // their glass positions, easing from the new hand at rest to the same rim path.
    const reach = pose.reach ?? (d.t < g0 ? ease(d.t / g0)
      : d.t < g1 ? 1 : 1 - ease(Math.min(1, (d.t - g1) / (prof.s - g1))));
    const mirror = side === 'rightArm' ? 1 : -1;
    const canonicalPivot = new THREE.Vector3(mirror * .105, .285, 0).multiplyScalar(PLAYER_SCALE);
    const canonicalHand = new THREE.Vector3(mirror * (.131 - .105), .19 - .285, .018).multiplyScalar(PLAYER_SCALE);
    const rotation = quatOf(pose.x, 0, pose.z);
    const offset = canonicalPivot.sub(new THREE.Vector3(...PIVOTS[side])).applyQuaternion(rotation.invert())
      .add(canonicalHand).sub(new THREE.Vector3(...HAND_ATTACH[side])).multiplyScalar(reach);
    pose.slide = (pose.slide || new THREE.Vector3()).add(offset);
    if (side === 'leftArm') { pose.q.y = -pose.q.y; pose.q.z = -pose.q.z; }
    return pose;
  }

  // Mixamo's clips over the procedural pose (Plans/tweede-avonturier.md): the walk, run and
  // sprint by distance (the gait's own step counter, lined up so its left foot coming down is
  // the clip's), the idle by time while standing, a jump over its time in the air. Every joint
  // the clip has is turned towards it by `clipMix`, which eases in and out, so nothing snaps
  // when a clip starts or a pose (a dance, a dig, a saddle) takes over; an arm with something to
  // do (an item, a swing, a block) keeps its own pose.
  const busy = { leftArm: false, rightArm: false };
  // Mixamo's dig is one scoop in DIG_CLIP_S of its 4.8 s: bent down, the blade in, lifted, and
  // the load flung at DIG_THROW of the clip. The swim is played at SWIM_RATE (none, all out) of
  // its own pace by how fast the swimmer goes, SWIM_PACE (walk.js SWIM_SPEED) being all out.
  const DIG_THROW = .52, SWIM_RATE = [.45, 1.25], SWIM_PACE = 1.9;
  let digByClip = false, digT = 0, swimT = 0, treadT = 0, speedOf = 0;
  const poseSwim = clipPose(), poseDig = clipPose(), poseMirror = clipPose(), poseTread = clipPose(), poseTreadMix = clipPose();
  const handA = new THREE.Vector3(), handB = new THREE.Vector3(), alongY = new THREE.Vector3(0, 1, 0), handInv = new THREE.Matrix4();
  let clipFree = false, clipMix = 0, jumpMix = 0, airT = 0, leanNow = 0, jumpLeap = 0;
  const poseWalk = clipPose(), poseRun = clipPose(), poseSprint = clipPose(), poseIdle = clipPose();
  const poseJump = clipPose(), poseLeap = clipPose(), poseGait = clipPose(), poseOut = clipPose();
  const AIR_S = 2 * 3.1 / 12.5;   // walk.js's JUMP_V and GRAVITY: how long a jump is in the air
  function playClips(pose, dt, { run, dash, flying, fp, dance, dug, carryOn, ride, gaitPose, back }) {
    if (!G.clips) return;
    // Which clip, if any: the swim in the water, the dig with a shovel, else the walk family.
    const swim = !!pose.swimming && !ride;
    const digging = !!dug && !fp && !swim;
    const free = !dance && !dug && !carryOn && !ride && !fp && !pose.sitting && !pose.lying && !pose.swimming;
    clipFree = free;
    digByClip = digging;
    clipMix = damp(clipMix, free || swim || digging ? 1 : 0, 10, dt);
    if (digging) {
      const C = GAIT_CLIPS.dig, was = digT;
      digT += dt;
      const at = C.seconds * DIG_THROW, k = Math.floor(was / C.seconds);
      if (was - k * C.seconds < at && digT - k * C.seconds >= at) dirt++;
    } else digT = 0;
    swimT = swim ? swimT + dt * (SWIM_RATE[0] + (SWIM_RATE[1] - SWIM_RATE[0]) * Math.min(1, speedOf / SWIM_PACE)) : 0;
    treadT = swim ? treadT + dt : 0;
    if (swim || digging) {
      if (clipMix < 1e-3) return;
      let p;
      if (swim) {
        // The breaststroke while going somewhere, Mixamo's Treading Water while going nowhere, as
        // far as walk.js has stood the swimmer up (swimPose, `pose.treading` 0..1) - each on its
        // own clock.
        const tread = Math.max(0, Math.min(1, pose.treading || 0)), C = GAIT_CLIPS;
        p = sampleClip(C.swim, swimT / C.swim.seconds, poseSwim);
        if (C.tread && tread > 0) p = blendPose(poseTreadMix, p, sampleClip(C.tread, treadT / C.tread.seconds, poseTread), tread);
      } else {
        p = sampleClip(GAIT_CLIPS.dig, digT / GAIT_CLIPS.dig.seconds, poseDig);
        // The clip digs right-handed; with the shovel in the left hand it is its mirror.
        if (dug.side === 'leftArm') p = mirrorPose(poseMirror, p);
      }
      applyClip(p, clipMix, { arms: true, drop: digging && pose.grounded });
      return;
    }
    // Which jump, decided once, at the take-off, by the speed the body leaves the ground with: from
    // standing the standing jump, from a run or a sprint the running one, a walk between. Not
    // `leap`, which is eased and was still 0 on the first frame in the air - every jump was the
    // standing one.
    if (flying && !airT) jumpLeap = Math.max(0, Math.min(1, (speedOf - G.walk / 2) / (G.run - G.walk / 2)));
    airT = flying ? airT + dt : 0;
    jumpMix = damp(jumpMix, flying ? 1 : 0, 14, dt);
    if (clipMix < 1e-3) return;
    const C = GAIT_CLIPS, u = gaitPose.phase / (Math.PI * 2);
    sampleClip(C.walk, u + C.walk.contact, poseWalk);
    blendPose(poseGait, poseWalk, sampleClip(C.run, u + C.run.contact, poseRun), run);
    if (dash > 0) blendPose(poseGait, poseGait, sampleClip(C.sprint, u + C.sprint.contact, poseSprint), dash);
    // Standing still is the idle; walking off is the gait, by how far into a step the body is.
    blendPose(poseOut, sampleClip(C.idle, time / C.idle.seconds, poseIdle), poseGait, gaitPose.blend);
    if (jumpMix > 1e-3) {
      // From standing the standing jump, at speed the running one: each over its own flight,
      // stretched over the time walk.js keeps a jumper in the air.
      const t = Math.min(1, airT / AIR_S);
      const stand = C.standingJump || C.jump, go = C.jump;
      sampleOnce(stand, stand.air[0] + (stand.air[1] - stand.air[0]) * t, poseJump);
      sampleOnce(go, go.air[0] + (go.air[1] - go.air[0]) * t, poseLeap);
      blendPose(poseJump, poseJump, poseLeap, jumpLeap);
      blendPose(poseOut, poseOut, poseJump, jumpMix);
    }
    applyClip(poseOut, clipMix, { back, drop: pose.grounded });
  }
  // Every joint of the rig turned towards the clip's pose by `w`. The arms only when they are
  // free, or when the clip is the one that owns them (`arms`: a dig holds the shovel with both).
  function applyClip(p, w, { arms = false, back = 0, drop = false } = {}) {
    const q = p.q;
    torso.pelvis.quaternion.slerp(q[JOINT.pelvis], w);
    torso.spine.quaternion.slerp(q[JOINT.spine], w);
    torso.chest.quaternion.slerp(q[JOINT.chest], w);
    torso.neck.quaternion.slerp(q[JOINT.neck], w);
    if (!back) pieces.head.pivot.quaternion.slerp(q[JOINT.head], w);
    for (const [side, k] of [['leftLeg', 'l'], ['rightLeg', 'r']]) {
      const chain = chains[side];
      pieces[side].pivot.quaternion.slerp(q[JOINT[k + 'Hip']], w);
      chain.bend.quaternion.slerp(q[JOINT[k + 'Knee']], w);
      chain.end.quaternion.slerp(q[JOINT[k + 'Ankle']], w);
      if (chain.toe) chain.toe.quaternion.slerp(q[JOINT[k + 'Toe']], w);
    }
    for (const [side, k] of [['leftArm', 'l'], ['rightArm', 'r']]) {
      if (busy[side] && !arms) continue;
      const chain = chains[side];
      clavicleQ[side].slerp(q[JOINT[k + 'Clavicle']], w);
      pieces[side].pivot.quaternion.slerp(q[JOINT[k + 'Arm']], w);
      chain.bend.quaternion.slerp(q[JOINT[k + 'Elbow']], w);
      chain.end.quaternion.slerp(q[JOINT[k + 'Wrist']], w);
    }
    // The hips' height is the clip's on the ground; in the air it is the jump's own.
    if (drop) object.position.y += (-p.drop * G.leg - object.position.y) * w;
  }

  // The clips' angles on this body's own proportions leave a foot a centimetre or so into the
  // ground or over it. So, while a clip is playing on the ground, the body is lifted until no
  // heel, ball or toe is below the ground - and at a walk or standing, where a foot is always
  // down, let down onto the lowest of them too; a run and a sprint keep their flight.
  const footPoint = new THREE.Vector3();
  function lowestFoot() {
    mounts.pelvis.updateWorldMatrix(true, true);
    let low = Infinity;
    for (const side of ['leftLeg', 'rightLeg']) {
      const c = chains[side], heel = PIVOTS[side][1] + c.ankle.y;
      for (const [bone, x, y, z] of [[c.end, 0, -heel, -.01], [c.toe, 0, 0, 0], [c.toe, 0, 0, c.ball.tip]]) {
        footPoint.set(x, y, z).applyMatrix4(bone.matrixWorld);
        if (object.parent) object.parent.worldToLocal(footPoint);
        low = Math.min(low, footPoint.y);
      }
    }
    return low;
  }
  function plantFeet(pose, run, gaitPose) {
    if (!G.clips || !(clipFree || digByClip) || clipMix < 1e-3 || !pose.grounded || pose.swimming || pose.sitting || pose.lying) return;
    const low = lowestFoot();
    const lift = low < 0 ? -low : -low * (1 - run);
    object.position.y += lift * clipMix;
  }

  let time = 0;
  let danceMix = 0;   // how far into a dance the body is, 0..1, so starting and stopping ease
  // The leap of a jump (Plans/tweede-avonturier.md): 0 for a jump from standing, 1 for one at a
  // sprint, eased so a landing does not snap. `trail` is the leg that pushed off - the one that
  // was planted, furthest back - which trails behind in the air while the other reaches ahead.
  let leap = 0, trail = 0, bowNow = 0;
  function update(pose, dt) {
    time += dt;
    // A caller that has the state as a flag (peers.js decodes it from the pose bits) may hand
    // it in here instead of calling dig()/setCarry() on the edge; left out, nothing changes.
    if (pose.digging !== undefined && !!pose.digging !== !!digging) dig(!!pose.digging);
    if (pose.carrying !== undefined && !!pose.carrying !== carrying) setCarry(!!pose.carrying);
    const ride = pose.riding || null;
    const moving = pose.moving && pose.grounded && !pose.sitting && !pose.lying && !ride;
    let distance = pose.distance;
    if (!Number.isFinite(distance)) {
      if (object.parent) {
        parentAt.copy(object.parent.position);
        distance = previousParent === object.parent ? Math.hypot(parentAt.x-lastParentAt.x, parentAt.z-lastParentAt.z) : 0;
        lastParentAt.copy(parentAt); previousParent = object.parent;
      } else distance = moving ? dt * (pose.running ? (pose.sprinting ? G.sprint : G.run) : G.walk) : 0;
    }
    // A peer is only said to be running (FLAG_RUNNING): whether it is a sprint is read off how
    // fast the body goes, so no new bit has to cross the sea for it.
    const speedNow = dt > 0 ? Math.max(0, distance) / dt : 0;
    speedOf = speedNow;
    const sprinting = pose.sprinting ?? (!!pose.running && sprintAt(G, speedNow) > 0);
    const gaitPose = gait.update(Math.max(0,distance), { ...pose, sprinting }, dt);
    const run = gaitPose.run, dash = gaitPose.sprint;
    // In the air: how fast the jump is going, as a share of a sprint.
    const flying = !pose.grounded && !pose.swimming && !ride && !pose.sitting && !pose.lying;
    leap = damp(leap, flying ? Math.min(1, speedNow / G.sprint) : 0, flying ? 8 : 14, dt);
    if (pose.grounded) {
      const [a, b] = gaitPose.feet;
      if (a.planted !== b.planted) trail = a.planted ? 0 : 1;
      else if (a.planted) trail = a.z < b.z ? 0 : 1;
    }
    const phase = gaitPose.phase;
    const stride = moving ? -gaitPose.feet[0].z * (6 + 2*gaitPose.run) : 0;
    // A body with its own arm swing (the Adventurer) swings by where its foot is in the stride,
    // -1 to 1, times an amplitude that grows into a run - not by the foot's distance, which on
    // his longer stride swung the arms up to the shoulder at a walk.
    const half = gaitPose.span / 2;
    // Where the left arm is in its swing, -1 (in front) to 1 (behind); the right is the other way.
    const swingAt = G.arm && moving && half > 1e-6 ? Math.max(-1, Math.min(1, gaitPose.feet[0].z / half)) : 0;
    const reachOf = G.arm ? swingAt * mixOf(G.arm, run, dash) * gaitPose.blend : 0;
    // Positive is back. In front of the body only `armForward` of the swing is taken.
    const forward = G.armForward ? mixOf(G.armForward, run, dash) : 1, fore = (v) => (v < 0 ? v * forward : v);
    const swingL = G.arm ? fore(reachOf) : -stride * 0.9, swingR = G.arm ? fore(-reachOf) : stride * 0.9;
    const idle = moving ? 0 : Math.sin(time * 1.8) * 0.035;
    // Airborne the legs part: the old 0.32 either way from standing, a stride's split at speed -
    // the pushing leg back, the other reaching ahead - and the free arms the other way round.
    const airborne = pose.grounded ? 0 : 0.32;
    const trails = trail === 0 ? 1 : -1;
    const split = { leftLeg: trails * (airborne + .5 * leap), rightLeg: -trails * (airborne + .5 * leap) };
    const flung = { leftArm: -trails * .6 * leap, rightArm: trails * .55 * leap };
    const crouch = pose.crouching ? -0.28 : 0;
    const sit = pose.sitting ? -1.05 : 0;
    // The left crank arm starts up and the right one down (scripts/build-bicycle.py), and a
    // leg is furthest forward when its pedal is: -sin of the crank for the right, +sin left.
    const pedal = ride ? RIDE_SWING * Math.sin(ride.crank) : 0;
    const targets = {
      leftLeg: ride ? RIDE_LEG - pedal : sit || (stride + (pose.grounded ? 0 : split.leftLeg) + crouch),
      rightLeg: ride ? RIDE_LEG + pedal : sit || (-stride + (pose.grounded ? 0 : split.rightLeg) + crouch),
      // Held out in front rather than swinging with the stride - an item on a walking arm
      // would sweep equipment through the body. Free arms counter the opposite foot.
      leftArm: holding.leftArm ? holdX(holding.leftArm) : (moving ? swingL : idle + flung.leftArm),
      rightArm: holding.rightArm ? holdX(holding.rightArm) : (moving ? swingR : -idle + flung.rightArm),
    };
    // First person (walk.js) draws what a shooter draws: the two arms and what is in them,
    // and nothing of the body the camera is standing in. The arms are carried higher and
    // follow the look up and down (`pose.pitch`, walk.js's camPitch: positive looks down),
    // so the hands stay in the bottom corners of the view. Nobody else sees this pose - it
    // is not on the wire - so it is free to be a view model rather than a body.
    const fp = !!pose.firstPerson;
    for (const name of FP_HIDDEN) pieces[name].mesh.visible = !fp;
    if (fp) {
      const look = pose.pitch || 0;
      for (const side of ['leftArm', 'rightArm']) {
        if (holding[side]) targets[side] = (FP_HOLD_X[holding[side]] ?? FP_HOLD_X.default) + look + stride * 0.08;
      }
    }
    // Dancing (Plans/DONE/dansen.md): `pose.dancing` is { move, beat, hype } - danceStep's move for
    // this dancer and the beat whoever is watching hears (web/js/dance.js) - and the angles are
    // the same dancePose the settlers on the castle's floor are drawn from. Whatever is in the
    // hands is danced with. The limbs take it here; the bob, lean, twist and roll are the whole
    // body's and go on `object` below, the rig's root at the feet, since the limbs are not
    // children of the core. Not in first person: that pose is a view model nobody else sees.
    // A dig cannot go on from a saddle, a bench, the ground or the water: put down, as a drink is.
    if (digging && (ride || pose.sitting || pose.lying || pose.swimming)) dig(false);
    const dug = digging, carryOn = carrying && !ride;
    const dancing = pose.dancing && !ride && !pose.sitting && !pose.lying && !pose.swimming && !fp && !dug && !carryOn ? pose.dancing : null;
    const dance = dancing ? dancePose(dancing.move, dancing.beat, dancing.hype || 0) : null;
    if (dance) {
      // The legs take the lean back off, as the settlers' do, so they stay under the body.
      targets.leftLeg = dance.legL - dance.lean;
      targets.rightLeg = dance.legR - dance.lean;
      targets.leftArm = dance.left;
      targets.rightArm = dance.right;
    }
    // `blocking` is either which hands are up ({ leftArm, rightArm }, from walk.js) or a bare
    // true, which means the default hand.
    const blocks = !pose.blocking ? []
      : typeof pose.blocking === 'object' ? ['leftArm', 'rightArm'].filter((side) => pose.blocking[side])
        : [blockSide()];
    for (const side of blocks) targets[side] = BLOCK_ARM_X;
    // Arms turned in about their own axis (z) instead of straight ahead, when a pose wants it,
    // and how far the whole body bows (positive: forward) - dig() and setCarry() above.
    const armZ = { leftArm: null, rightArm: null };
    let lean = 0, digPose = null;
    if (dug) {
      const was = dug.t;
      dug.t += dt;
      // The throw is the moment the stroke passes THROW_AT - or, while Mixamo's dig plays,
      // the clip's own throw (playClips).
      if (!digByClip && was < THROW_AT && dug.t >= THROW_AT) dirt++;
      if (dug.t >= DIG_S) dug.t -= DIG_S;
      digPose = digKey(dug.t);
      const off = OTHER[dug.side], sign = dug.side === 'rightArm' ? -1 : 1;
      targets[dug.side] = digPose.x;
      armZ[dug.side] = sign * digPose.z;
      if (!holding[off]) { targets[off] = DIG_OFF_ARM; armZ[off] = -sign * DIG_OFF_Z; }
      targets.leftLeg = dug.side === 'rightArm' ? DIG_STANCE.front : DIG_STANCE.back;
      targets.rightLeg = dug.side === 'rightArm' ? DIG_STANCE.back : DIG_STANCE.front;
      lean = digByClip ? 0 : digPose.lean * (fp ? 0.3 : 1);
    } else if (carryOn) {
      targets.leftArm = targets.rightArm = CARRY_ARM;
      armZ.leftArm = CARRY_Z;
      armZ.rightArm = -CARRY_Z;
      lean = CARRY_LEAN;
    }
    // Treading water (diving.js swimPose: walk.js and peers.js stand a swimmer going nowhere
    // upright and hand in `treading`, 0..1 of the way there): free arms out to the sides,
    // sculling a little forward and back, and the legs kicking slowly under the surface.
    // A held item stays where the hand holds it.
    const tread = pose.swimming && !fp ? (pose.treading || 0) : 0;
    if (tread > 0) {
      const s = Math.sin(time * TREAD_RATE);
      for (const [side, out] of [['leftArm', TREAD_OUT], ['rightArm', -TREAD_OUT]]) {
        if (holding[side]) continue;
        targets[side] = (TREAD_ARM + TREAD_SCULL * (side === 'leftArm' ? s : -s)) * tread;
        armZ[side] = out * tread;
      }
      targets.leftLeg = TREAD_KICK * s * tread;
      targets.rightLeg = -TREAD_KICK * s * tread;
    }
    // Both hands on the bars, whatever they are holding.
    if (ride) targets.leftArm = targets.rightArm = RIDE_ARM;
    // Both hands on the handles of a barrow or the rim of a cart (web/js/goldrun.js): the
    // angle is the caller's, since a barrow's handles are lower than a cart's rim.
    if (Number.isFinite(pose.pushing)) targets.leftArm = targets.rightArm = pose.pushing;
    // One arm held out, the fisherman's with his rod over the water (web/js/fisher.js).
    if (Number.isFinite(pose.reach)) targets.rightArm = pose.reach;
    // A glass being handed over: reached out for the first half second, through the same
    // damping as any held pose, and not in the hand at all until the settler has drunk it.
    for (const side of ['leftArm', 'rightArm']) {
      const g = given[side];
      if (!g) continue;
      g.t += dt;
      const mesh = heldMesh[side];
      if (holding[side] !== 'beer' || g.t >= g.away) {
        given[side] = null;
        if (mesh) mesh.visible = true;
        continue;
      }
      if (g.t < HAND_OVER.reach) targets[side] = HAND_OVER.x;
      if (mesh) mesh.visible = g.t < HAND_OVER.reach * 0.8;
    }
    if (swing && (swing.t += dt) >= SWING_S) swing = null;
    const swung = swing ? swingPose(swing, targets[swing.side]) : null;
    // Stepped before it is posed, like the swing. A drink is put down with the glass, or
    // the moment the arms have something else to do.
    const drunk = {};
    for (const side of ['leftArm', 'rightArm']) {
      const d = drinks[side];
      if (!d) continue;
      // A relay is put down whole: the pouring glass with nothing under it, or the drinking
      // one with nothing pouring into it, is neither drink.
      const paired = d.kind !== 'sip', partner = paired ? drinks[OTHER[side]] : null;
      if (holding[side] !== 'beer' || pose.swimming || pose.lying || (paired && !partner)) {
        drinks[side] = null;
        if (partner) drinks[OTHER[side]] = null;
        continue;
      }
      const { s, gulp: [g0, g1], dose } = PROFILE[d.kind];
      const was = d.t;
      d.t += dt;
      gulped += dose * Math.max(0, Math.min(d.t, g1) - Math.max(was, g0)) / (g1 - g0);
      if (d.t >= s) drinks[side] = null;
      else drunk[side] = drinkPose(d, side, targets[side], 0);
    }
    const mouth = ['leftArm', 'rightArm'].find((side) => drunk[side] && drinks[side].kind === 'relay');
    const back = mouth ? drunk[mouth].reach * THREE.MathUtils.lerp(HEAD_BACK[0], HEAD_BACK[1], drunk[mouth].g) : 0;
    // The head takes back part of the run's lean, so the eyes stay on the way ahead (set again
    // below, once the lean of this frame is known).
    pieces.head.pivot.rotation.x = -back;
    tiltQ.setFromEuler(turn.set(-back, 0, 0));
    // Where the relay's arms would have been with the head up: the glasses' poses were found
    // there, and are turned with the head from there.
    const upright = {};
    if (back) {
      for (const side of ['leftArm', 'rightArm']) {
        if (!drunk[side] || drinks[side].kind === 'sip') continue;
        upright[side] = { x: drunk[side].x, z: drunk[side].z };
        drunk[side].x -= back * ARM_FOLLOW;
      }
    }
    const locomotion = pose.grounded && !pose.swimming && !pose.sitting && !pose.lying && !ride && !dance;
    // The run's forward lean (Plans/tweede-avonturier.md), turned about the hips rather than the
    // feet: the legs hang from the hips and stay under them, and everything above - the torso,
    // the pack, the chestplate and the shoulders the arms hang from - tips forward round them.
    // The arms hang from a leaning torso, so the lean is added to where each one points.
    // In the air the lean is the leap's (a long jump goes forward over the front leg), and it is
    // eased either way, so neither the take-off nor the landing snaps the torso upright.
    const bowWant = !G.leanAtHip || dug || carryOn || fp ? 0
      : locomotion ? mixOf(G.lean, run, dash) * gaitPose.blend
        : flying ? mixOf(G.lean, 1, .5) * .8 * leap : 0;
    bowNow = damp(bowNow, bowWant, 10, dt);
    const bow = bowNow;
    for (const [name, target] of Object.entries(targets)) {
      if (swung && name === swing.side) pieces[name].pivot.rotation.x = swung.x;
      else if (drunk[name]) pieces[name].pivot.rotation.x = drunk[name].x;
      // A pedalling leg follows the crank exactly: damped, it lags a quarter turn at speed.
      else if (ride && (name === 'leftLeg' || name === 'rightLeg')) pieces[name].pivot.rotation.x = target;
      // Twice as quick on the dance floor: at 15 a punch on the kick is still on its way up
      // when the next one comes.
      else pieces[name].pivot.rotation.x = damp(pieces[name].pivot.rotation.x, target, dance || (dug && name === dug.side) ? 30 : 15, dt);
    }
    pieces.leftArm.pivot.rotation.y = pieces.rightArm.pivot.rotation.y = 0;
    pieces.leftArm.pivot.rotation.z = drunk.leftArm ? drunk.leftArm.z
      : damp(pieces.leftArm.pivot.rotation.z, armZ.leftArm ?? (holding.leftArm ? 0 : (pose.running ? -0.12 : 0)), armZ.leftArm === null ? 12 : 20, dt);
    pieces.rightArm.pivot.rotation.z = drunk.rightArm ? drunk.rightArm.z
      : damp(pieces.rightArm.pivot.rotation.z, armZ.rightArm ?? (holding.rightArm ? 0 : (pose.running ? 0.12 : 0)), armZ.rightArm === null ? 12 : 20, dt);
    // The idle breath, in the small of the back: the chest, the arms and the head rise with it.
    torso.spine.position.y = torso.rest.spine + Math.sin(time * 2.2) * (moving ? 0 : 0.0025);
    // The body's share of the dance, eased in over a beat or so and back out when it stops.
    // Scaled by PLAYER_SCALE like every pivot here: dancePose's lifts are a settler's.
    danceMix = damp(danceMix, dance ? 1 : 0, 6, dt);
    if (dance) {
      object.position.y = dance.bob * PLAYER_SCALE * danceMix;
      object.rotation.set(dance.lean * danceMix, dance.twist * danceMix, dance.roll * danceMix);
    } else if (lean || object.position.y || object.rotation.x || object.rotation.y || object.rotation.z) {
      // The bow of a dig or a heavy carry is the target here, not 0; a body at rest settles at 0.
      object.position.y = damp(object.position.y, 0, 12, dt);
      object.rotation.set(damp(object.rotation.x, lean, lean ? 14 : 12, dt), damp(object.rotation.y, 0, 12, dt), damp(object.rotation.z, 0, 12, dt));
      if (Math.abs(object.position.y) + Math.abs(object.rotation.x - lean) + Math.abs(object.rotation.y) + Math.abs(object.rotation.z) < 1e-4) {
        object.position.y = 0;
        object.rotation.set(lean, 0, 0);
      }
    }
    for (const [i, side] of ['leftLeg', 'rightLeg'].entries()) {
      const chain = chains[side];
      const foot = gaitPose.feet[i];
      pieces[side].pivot.rotation.y = pieces[side].pivot.rotation.z = 0;
      if (chain.toe) chain.toe.quaternion.identity();
      if (locomotion) {
        pieces[side].pivot.rotation.x = foot.hip;
        chain.bend.rotation.set(foot.knee, 0, 0);
        chain.end.rotation.set(foot.ankle, 0, 0);
      } else {
        // The pushing leg folds up behind in a leap, the reaching one straightens towards the landing.
        const pushing = i === trail;
        chain.bend.rotation.x = ride ? .65 : pose.sitting ? 1.2
          : !pose.grounded ? .55 + (pushing ? .75 : -.2) * leap : .12;
        chain.bend.rotation.y = chain.bend.rotation.z = 0;
        chain.end.rotation.set(-chain.bend.rotation.x*.55, 0, 0);
      }
    }
    // The torso's own pose when no clip is playing: the lean shared between the small of the
    // back and the chest, the shoulders' turn against the hips in the chest, the pelvis and the
    // neck still. A clip (playClips) is blended over this.
    const twistNow = locomotion ? Math.sin(phase) * (G.twist ? mixOf(G.twist, run, dash) : .025) * gaitPose.blend : 0;
    leanNow = G.leanAtHip ? bow : locomotion ? mixOf(G.lean, run, dash) * gaitPose.blend : 0;
    if (locomotion) object.position.y = gaitPose.drop ? -gaitPose.drop : 0;
    torso.pelvis.quaternion.identity();
    torso.spine.rotation.set(leanNow / 2, 0, 0);
    torso.chest.rotation.set(leanNow / 2, twistNow, 0);
    torso.neck.quaternion.identity();
    pieces.backpack.pivot.rotation.set(locomotion ? Math.sin(phase * 2) * .015 * gaitPose.blend : 0, 0, 0);
    pieces.head.pivot.rotation.set(G.leanAtHip ? -back - bow * mixOf(G.head, run, dash) : -back, 0, 0);
    for (const side of ['leftArm', 'rightArm']) clavicleQ[side].identity();
    for (const side of ['leftArm','rightArm']) {
      const chain = chains[side];
      // Action poses already have authored hand targets. Preserve those targets;
      // free arms flex naturally during locomotion and a little while at rest.
      const action = holding[side] || drunk[side] || (swung && swing.side === side)
        || ride || Number.isFinite(pose.pushing) || Number.isFinite(pose.reach)
        // A dig and a carry pose both arms themselves (the shovel stroke, the load held out).
        || !!digging || carrying || blocks.includes(side);
      busy[side] = !!action;
      // A body with its own elbows (the Adventurer) bends them to a runner's right angle and
      // keeps them there while the arm pumps; the Traveller's formula is the old one.
      const elbow = action ? 0 : G.elbow ? .10 * (1 - gaitPose.blend) + mixOf(G.elbow, run, dash) * Math.max(gaitPose.blend, leap)
        : (.10 + (.20+.65*gaitPose.run)*gaitPose.blend);
      // A runner's elbow closes as the arm comes forward - the fist up to the chin - and opens
      // as it drives back: at one angle all the way, the forearm stood out level in front of him.
      const armAt = side === 'leftArm' ? swingAt : -swingAt;
      const pumped = action || !G.pump ? elbow : elbow + mixOf(G.pump, run, dash) * gaitPose.blend * (armAt < 0 ? -armAt : -.5 * armAt);
      chain.bend.rotation.set(-pumped, 0, 0);
      chain.end.rotation.set(pumped*.22, 0, 0);
    }
    playClips(pose, dt, { run, dash, flying, fp, dance, dug, carryOn, ride, gaitPose, back });
    for (const side of ['leftArm', 'rightArm']) {
      const chain = chains[side];
      // The hand where the elbow and wrist put it, so a held item follows them.
      chain.grasp = damp(chain.grasp, holding[side] || digging || carrying || ride ? 1 : 0, 12, dt);
      for (const finger of chain.fingers) {
        finger.bone.quaternion.setFromAxisAngle(finger.axis,
          finger.relaxed + (finger.grip - finger.relaxed) * chain.grasp);
      }
      const hand = handAttach[side];
      hand.position.set(...HAND_ATTACH[side]);
      hand.position.sub(chain.ankle).applyQuaternion(chain.end.quaternion).add(chain.ankle)
        .sub(chain.knee).applyQuaternion(chain.bend.quaternion).add(chain.knee);
      // The top of the sleeve with the collarbone, not the arm (SHOULDER_CAP).
      if (chain.cap) chain.cap.quaternion.copy(capQ.copy(pieces[side].pivot.quaternion).invert());
    }
    placeMounts();
    plantFeet(pose, run, gaitPose);
    if (tiltSide) {
      tiltNow = damp(tiltNow, dug ? digPose.tilt : 0, 30, dt);
      if (!dug && Math.abs(tiltNow) <= 1e-3) { tiltNow = 0; tiltSide = null; }
    }
    // Cancel each arm pivot's own rotation on the item it carries: the attach point gives
    // the item the hand's position (correct - the grip moves with the arm), but a held
    // item should not also inherit the arm's tilt, or it lies over at whatever angle the
    // arm is held at instead of standing up the way something actually gripped would.
    // The relay's slide out of the fist, put back the moment it is over.
    for (const side of ['leftArm', 'rightArm']) {
      if (!heldMesh[side]) continue;
      if (drunk[side]?.slide) heldMesh[side].position.copy(drunk[side].slide);
      else heldMesh[side].position.set(0, 0, 0);
    }
    for (const side of ['leftArm', 'rightArm']) {
      const mesh = heldMesh[side];
      if (!mesh) continue;
      // A glass being drunk from: the arm's own turn taken off the orientation it should have
      // on the body (the left mesh's mirror is in its scale, and the mirrored q undoes it).
      if (drunk[side]) {
        const pivot = pieces[side].pivot;
        unArm.copy(pivot.quaternion).invert();
        if (upright[side]) {
          // The glass where it would be on the body with the head up, turned about the neck,
          // and handed back to the arm that is actually there.
          armQ.setFromEuler(turn.set(upright[side].x, 0, upright[side].z));
          at.copy(mesh.position).add(handAttach[side].position).applyQuaternion(armQ).add(pivot.position);
          neck.copy(pieces.head.pivot.position).add(pieces.core.pivot.position);
          at.sub(neck).applyQuaternion(tiltQ).add(neck).sub(pivot.position).applyQuaternion(unArm).sub(handAttach[side].position);
          mesh.position.copy(at);
          mesh.quaternion.copy(unArm).multiply(tiltQ).multiply(drunk[side].q);
        } else {
          mesh.quaternion.copy(unArm).multiply(drunk[side].q);
        }
        continue;
      }
      const tilt = fp && !(swung && side === swing.side) ? FP_TILT[holding[side]] : null;
      // The shovel's own turn while digging, and its way back to upright once the dig is over:
      // a turn in the body's frame (0 blade up), so the arm's own is taken off it.
      // Mixamo digs with both hands on the shaft: the blade (the shovel's +y, out of this fist)
      // points from this hand past the other.
      if (digByClip && holding[side] === 'shovel' && clipMix > .5) {
        mounts.chest.updateWorldMatrix(true, true);
        handAttach[side].getWorldPosition(handA);
        handAttach[OTHER[side]].getWorldPosition(handB);
        handInv.copy(handAttach[side].matrixWorld).invert();
        handB.applyMatrix4(handInv);
        mesh.quaternion.setFromUnitVectors(alongY, handB.normalize());
        mesh.position.set(0, 0, 0);
        continue;
      }
      if (side === tiltSide && Math.abs(tiltNow) > 1e-3) {
        // Through the arm's whole inverse, not the per-axis undo below: the arm is turned in
        // about z as well while it digs, and the two turns do not commute.
        unArm.copy(pieces[side].pivot.quaternion).invert();
        mesh.quaternion.copy(unArm).multiply(tiltQ.setFromEuler(turn.set(tiltNow, 0, 0)));
        continue;
      }
      // Upright against the arm's turn and the torso's lean both: the arm hangs from the chest now.
      mesh.rotation.x = swung && side === swing.side ? swung.wrist : -pieces[side].pivot.rotation.x - leanNow + (tilt?.x || 0);
      mesh.rotation.z = -pieces[side].pivot.rotation.z + (side === 'rightArm' ? 1 : -1) * (tilt?.z || 0);
      // A shield turns to face forward while it blocks and back out to the side after;
      // the same mirrored sign setHeldItem gave it, so left and right both turn inward.
      const yaw = blocks.includes(side) && holding[side] === 'shield' ? Math.PI / 2 : tilt?.yaw ?? (ITEM_YAW[holding[side]] || 0);
      mesh.rotation.y = damp(mesh.rotation.y, (side === 'leftArm' ? 1 : -1) * yaw, 12, dt);
      if (mesh.userData.light) {
        // Two sines at unrelated rates, so the flicker never settles into a visible beat;
        // the two hands are offset so a pair of torches does not pulse in unison.
        const t = time + (side === 'leftArm' ? 1.7 : 0);
        const flicker = 0.85 + 0.1 * Math.sin(t * 23) + 0.05 * Math.sin(t * 7.3);
        mesh.userData.light.intensity = TORCH_LIGHT.intensity * nightOf(material) * flicker;
      }
    }
    // The relay's stream, only while it is actually pouring: from the pouring glass's rim
    // into the drinking glass's, both read in the body's own frame (so whatever the body's
    // parents are doing, the two ends agree).
    const pourer = drinks.leftArm?.kind === 'pour' ? 'leftArm' : drinks.rightArm?.kind === 'pour' ? 'rightArm' : null;
    const pd = pourer && drinks[pourer], [p0, p1] = RELAY_GULP;
    stream.visible = !!(pd && drunk[pourer] && pd.t > p0 + 0.1 && pd.t < p1 && heldMesh[pourer] && heldMesh[OTHER[pourer]]);
    if (stream.visible) {
      object.updateMatrixWorld(true);
      object.worldToLocal(heldMesh[pourer].localToWorld(pourFrom.copy(RIM)));
      object.worldToLocal(heldMesh[OTHER[pourer]].localToWorld(pourTo.copy(RIM)));
      pourTo.sub(pourFrom);
      const length = pourTo.length();
      stream.position.copy(pourFrom);
      stream.quaternion.setFromUnitVectors(DOWN, pourTo.divideScalar(length || 1));
      stream.scale.set(1, Math.max(length, 0.005), 1);
    }
  }

  function set(next) {
    lookSpec = next;
    for (const piece of Object.values(pieces)) {
      const geometry = avatarPlayerComponentGeometry(next, piece.names);
      geometry.translate(-piece.at[0], -piece.at[1], -piece.at[2]);
      const name = Object.keys(pieces).find((k) => pieces[k] === piece);
      capShoulder(geometry, name);
      if (name === 'core') weightTorso(geometry);
      if (name === 'head' && FINGERS) weightTorso(geometry, PIVOTS.head[1]);
      const leg = PARTS.find((part) => piece.names.includes(part.name) && part.skinGroup)?.skinGroup;
      if (leg && chains[leg]?.toe) weightToes(geometry, chains[leg]);
      piece.mesh.geometry.dispose();
      piece.mesh.geometry = geometry;
    }
    pieces.backpack.pivot.visible = next.equip?.backpack !== false;
    pieces.chestplate.pivot.visible = !!next.equip?.chestplate;
    pieces.leftLegging.pivot.visible = pieces.rightLegging.pivot.visible = !!next.equip?.leggings;
    pieces.leftBoot.pivot.visible = pieces.rightBoot.pivot.visible = !!next.equip?.boots;
    setHeldItem('leftArm', next.equip?.leftHandItem || null, next);
    setHeldItem('rightArm', next.equip?.rightHandItem || null, next);
    // A new look arriving in the middle of a dig (a peer changed their outfit) must not take
    // the shovel out of their hands: what the look holds becomes what a stopped dig restores.
    if (digging) takeShovel();
  }

  function dispose() {
    for (const piece of Object.values(pieces)) piece.mesh.geometry.dispose();
    for (const side of ['leftArm', 'rightArm']) if (heldMesh[side]) heldMesh[side].geometry.dispose();
    stream.geometry.dispose();
    carriedMesh.geometry.dispose();
    for (const chain of Object.values(chains)) chain.skeleton.dispose();
    torso.skeleton.dispose();
    if (material !== sourceMaterial) material.dispose();
  }

  // Bind in the source rest pose first; even previews without an animation tick then
  // start with relaxed fingers rather than the imported straight-finger pose.
  for (const chain of Object.values(chains)) {
    for (const finger of chain.fingers) finger.bone.quaternion.setFromAxisAngle(finger.axis, finger.relaxed);
  }
  return {
    object, update, set, dispose, handAttach, joints: chains, attack, held: (side) => holding[side], drink, swallowed, handOver,
    dig, digged, digging: () => !!digging, setCarry, carrying: () => carrying, carried,
    character, hipY, eye, speeds: { walk: G.walk, run: G.run, sprint: G.sprint },
    strokes: !!(G.clips && GAIT_CLIPS.swim),
  };
}

// The rig everybody holds: the player (walk.js), every peer (peers.js), the inventory's alcove
// and every villager. It keeps one body's rig inside and, when a look changes body, builds the
// other one and swaps its root into the same parent - so a caller that put `object` in a group
// once, as walk.js and peers.js do, keeps drawing it without knowing. Read `object`,
// `handAttach` and `joints` off the rig when you use them rather than keeping them: they are
// the new body's after a swap.
export function createClassicAvatar(spec, material) {
  let rig = buildRig(spec, material);
  function set(next) {
    if (characterOf(next?.character).id === rig.character) { rig.set(next); return; }
    const old = rig;
    rig = buildRig(next, material);
    const parent = old.object.parent;
    if (parent) { parent.add(rig.object); parent.remove(old.object); }
    rig.object.visible = old.object.visible;
    old.dispose();
  }
  return {
    get object() { return rig.object; },
    get handAttach() { return rig.handAttach; },
    get joints() { return rig.joints; },
    get character() { return rig.character; },
    get hipY() { return rig.hipY; },
    get eye() { return rig.eye; },
    // How fast this body walks and runs (avatar-gait.js GAITS): walk.js asks every step.
    get speeds() { return rig.speeds; },
    // Whether this body swims its own stroke (the Adventurer's Mixamo breaststroke): walk.js and
    // peers.js then lay it in the water without the whole-body roll and nod the Traveller swims by.
    get strokes() { return rig.strokes; },
    update: (pose, dt) => rig.update(pose, dt),
    set,
    dispose: () => rig.dispose(),
    attack: (side) => rig.attack(side),
    held: (side) => rig.held(side),
    drink: (side) => rig.drink(side),
    swallowed: () => rig.swallowed(),
    handOver: (side, away) => rig.handOver(side, away),
    // The treasure hunt's (Plans/schatkaarten.md). A swap mid-dig or mid-carry starts the new
    // body empty-handed; the hunt asks again on its next frame.
    dig: (on, side) => rig.dig(on, side),
    digged: () => rig.digged(),
    digging: () => rig.digging(),
    setCarry: (on) => rig.setCarry(on),
    carrying: () => rig.carrying(),
    get carried() { return rig.carried; },
  };
}

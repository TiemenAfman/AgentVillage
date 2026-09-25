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
// The hips' height over the soles: where a rider's legs turn, which is what walk.js puts on
// the saddle.
export const HIP_Y = PIVOTS.leftLeg[1];
// A rider (web/js/bicycle.js). The legs hang forward to the bottom bracket and go round with
// the crank, one half a turn behind the other; the arms reach for the grips. Tuned by eye in
// /demo against the baked bike - a rigid leg with no knee cannot follow the pedal exactly, and
// a swing a little short of the crank's reads as pedalling rather than as kicking.
const RIDE_LEG = -0.42;
const RIDE_SWING = 0.3;
const RIDE_ARM = -1.15;
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
// sits at shoulder height and the shield came up beside the head. A beer is held the way
// one is, in front of the chest: held out at -1.3 it was being offered to somebody.
const HOLD_ARM_X = { default: -1.3, shield: -0.35, beer: -0.7 };
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

// The first held item its hand's button drinks from rather than fights with (Plans/
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

// The sword and shield used to be built the same procedural way as the hammer above; both
// are baked Blender parts now (see the header comment on EQUIPPABLE), re-centred on GRIP
// the same way makePiece() re-centres a limb on its own pivot.
function heldPartGeometry(spec, names) {
  const geometry = avatarPlayerComponentGeometry(spec, names);
  geometry.translate(-GRIP[0], -GRIP[1], -GRIP[2]);
  return geometry;
}

// What HAND_ITEMS (avatar.js) can resolve to. The procedural ones are cheap enough (under
// a dozen primitives) that nothing here is worth caching; the baked ones go through
// heldPartGeometry() instead, which needs the current spec to pick up a recolour. Both are
// exported for the inventory's slot icons, which show the item on its own.
const HELD_ITEM_PROCEDURAL = { parasol: parasolGeometry, hammer: hammerGeometry, beer: beerGeometry };
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
  // upright for the duration and turns about the fist with its own wrist (swingPose), and
  // the counter-rotation takes over again at the end of the recovery. A block is a held pose, so it goes through the same targets and
  // damping as everything else: the shield arm comes up in front, and the shield turns from
  // its resting yaw to a quarter turn so its face points forward.
  const SWING_S = 0.45, BLOCK_ARM_X = -1.25, WEAPONS = new Set(['sword', 'hammer', 'parasol']);
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

  // Drinking (Plans/bier-en-dronken.md). A beer's hand drinks where any other hand would swing
  // - walk.js gives each hand its own mouse button - and lifts the glass instead: up to the
  // face and a little inward, a swallow with the glass tipped towards the mouth, and back
  // down. Timed
  // and driven directly like the swing, one per hand, so two pints are two arms. Only the
  // swallow counts, and it is handed out a frame at a time through swallowed(), which is what
  // lets walk.js fill the bar while the glass is tipped rather than once it is back down.
  // DRINK_ARM was found by measuring the model: the shoulder is at chin height and the arm is
  // 0.11 long, so about -2 puts the fist level with the mouth and the 0.35 inward turn puts
  // it beside the cheek; the glass is inboard of the fist (beerGeometry) and covers the rest.
  // -1.95 by the numbers left the rim at the chin in the browser, hence -2.05.
  // The roll turns about the ear in the fist, so it also lowers the rim: past about 1.2 the
  // rim drops under the chin, which is why the arm creeps up while it rolls further.
  const DRINK_S = 1.6, GULP = [0.45, 1.25], DRINK_ARM = { x: -2.05, z: 0.35 }, DRINK_ROLL = [0.8, 1.2];
  const drinks = { leftArm: null, rightArm: null };
  let gulped = 0;
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
  // not while it is still drinking the last one or has just handed it over.
  function drink(side) {
    if (holding[side] !== 'beer' || drinks[side] || given[side]) return false;
    drinks[side] = { t: 0, from: pieces[side].pivot.rotation.x, fromZ: pieces[side].pivot.rotation.z };
    return true;
  }
  // How much of a whole drink went down since the last time this was asked.
  function swallowed() { const g = gulped; gulped = 0; return g; }

  // Where a drinking arm is, and how far its glass is rolled in towards the mouth (the sign
  // is the caller's: the glass tips towards the middle of the body from either hand).
  // `rest`/`restZ` are what the arm would be doing had it not lifted the glass.
  function drinkPose(d, side, rest, restZ) {
    const lerp = THREE.MathUtils.lerp, [g0, g1] = GULP;
    const upX = DRINK_ARM.x, upZ = (side === 'rightArm' ? -1 : 1) * DRINK_ARM.z;
    if (d.t < g0) {
      const e = ease(d.t / g0);
      return { x: lerp(d.from, upX, e), z: lerp(d.fromZ, upZ, e), roll: DRINK_ROLL[0] * e };
    }
    if (d.t < g1) {
      // The arm creeps up as the glass empties, and bobs once a gulp.
      const g = (d.t - g0) / (g1 - g0);
      return { x: upX - 0.12 * g + 0.035 * Math.sin(g * Math.PI * 5), z: upZ, roll: lerp(DRINK_ROLL[0], DRINK_ROLL[1], ease(g)) };
    }
    const e = ease(Math.min(1, (d.t - g1) / (DRINK_S - g1)));
    return { x: lerp(upX - 0.12, rest, e), z: lerp(upZ, restZ, e), roll: DRINK_ROLL[1] * (1 - e) };
  }

  let time = 0;
  function update(pose, dt) {
    time += dt;
    const ride = pose.riding || null;
    const moving = pose.moving && pose.grounded && !pose.sitting && !pose.lying && !ride;
    const phase = pose.phase;
    const stride = moving ? Math.sin(phase) * (pose.running ? 0.82 : 0.5) : 0;
    const idle = moving ? 0 : Math.sin(time * 1.8) * 0.035;
    const airborne = pose.grounded ? 0 : 0.32;
    const crouch = pose.crouching ? -0.28 : 0;
    const sit = pose.sitting ? -1.05 : 0;
    // The left crank arm starts up and the right one down (scripts/build-bicycle.py), and a
    // leg is furthest forward when its pedal is: -sin of the crank for the right, +sin left.
    const pedal = ride ? RIDE_SWING * Math.sin(ride.crank) : 0;
    const targets = {
      leftLeg: ride ? RIDE_LEG - pedal : sit || (stride + airborne + crouch),
      rightLeg: ride ? RIDE_LEG + pedal : sit || (-stride - airborne + crouch),
      // Held out in front rather than swinging with the stride - an item on a walking arm
      // would windmill through the body otherwise, and there is no elbow to fold instead.
      leftArm: holding.leftArm ? holdX(holding.leftArm) : (moving ? -stride * 0.9 : idle),
      rightArm: holding.rightArm ? holdX(holding.rightArm) : (moving ? stride * 0.9 : -idle),
    };
    // `blocking` is either which hands are up ({ leftArm, rightArm }, from walk.js) or a bare
    // true, which means the default hand.
    const blocks = !pose.blocking ? []
      : typeof pose.blocking === 'object' ? ['leftArm', 'rightArm'].filter((side) => pose.blocking[side])
        : [blockSide()];
    for (const side of blocks) targets[side] = BLOCK_ARM_X;
    // Both hands on the bars, whatever they are holding.
    if (ride) targets.leftArm = targets.rightArm = RIDE_ARM;
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
      if (holding[side] !== 'beer' || pose.swimming || pose.lying) { drinks[side] = null; continue; }
      const was = d.t;
      d.t += dt;
      gulped += Math.max(0, Math.min(d.t, GULP[1]) - Math.max(was, GULP[0])) / (GULP[1] - GULP[0]);
      if (d.t >= DRINK_S) drinks[side] = null;
      else drunk[side] = drinkPose(d, side, targets[side], 0);
    }
    for (const [name, target] of Object.entries(targets)) {
      if (swung && name === swing.side) pieces[name].pivot.rotation.x = swung.x;
      else if (drunk[name]) pieces[name].pivot.rotation.x = drunk[name].x;
      // A pedalling leg follows the crank exactly: damped, it lags a quarter turn at speed.
      else if (ride && (name === 'leftLeg' || name === 'rightLeg')) pieces[name].pivot.rotation.x = target;
      else pieces[name].pivot.rotation.x = damp(pieces[name].pivot.rotation.x, target, 15, dt);
    }
    pieces.leftArm.pivot.rotation.z = drunk.leftArm ? drunk.leftArm.z
      : damp(pieces.leftArm.pivot.rotation.z, holding.leftArm ? 0 : (pose.running ? -0.12 : 0), 12, dt);
    pieces.rightArm.pivot.rotation.z = drunk.rightArm ? drunk.rightArm.z
      : damp(pieces.rightArm.pivot.rotation.z, holding.rightArm ? 0 : (pose.running ? 0.12 : 0), 12, dt);
    pieces.core.pivot.position.y = Math.sin(time * 2.2) * (moving ? 0 : 0.0025);
    // Cancel each arm pivot's own rotation on the item it carries: the attach point gives
    // the item the hand's position (correct - the grip moves with the arm), but a held
    // item should not also inherit the arm's tilt, or it lies over at whatever angle the
    // arm is held at instead of standing up the way something actually gripped would.
    for (const side of ['leftArm', 'rightArm']) {
      const mesh = heldMesh[side];
      if (!mesh) continue;
      mesh.rotation.x = swung && side === swing.side ? swung.wrist : -pieces[side].pivot.rotation.x;
      // A glass being drunk from rolls in towards the mouth: +z tips the top to -x, which is
      // inward for the right hand and, through the left hand's mirror, for the left one too
      // once the sign is flipped.
      const roll = drunk[side] ? (side === 'rightArm' ? 1 : -1) * drunk[side].roll : 0;
      mesh.rotation.z = -pieces[side].pivot.rotation.z + roll;
      // A shield turns to face forward while it blocks and back out to the side after;
      // the same mirrored sign setHeldItem gave it, so left and right both turn inward.
      const yaw = blocks.includes(side) && holding[side] === 'shield' ? Math.PI / 2 : (ITEM_YAW[holding[side]] || 0);
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

  return { object, update, set, dispose, handAttach, attack, held: (side) => holding[side], drink, swallowed, handOver };
}

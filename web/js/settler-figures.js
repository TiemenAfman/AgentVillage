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
import { makeRng, hash32, clamp } from 'shared/rng.mjs';
// The heading is ours. The walk names a direction to turn towards and how briskly; turning
// that into an angle needs atan2, and shared/ may not have one - see the header there.
import { lerpAngle } from 'shared/settlerwalk.mjs';
// The sword and the torch are the player's own baked parts (build-settler.py), not a
// second model of them: an armed resident carries exactly what the player can pick up.
import { avatarPlayerComponentGeometry, PLAYER_SCALE } from './avatar.js';
import { HELD_ITEM_PARTS, heldItemGeometry } from './classic-avatar.js';
import { goldBarGeometry } from './goldpit.js';
import { DANCE_MOVES, dancePose } from './dance.js';

export { settlerLook, styleLook, kindOf, styleOf };

const tmpObj = new THREE.Object3D();
// Yaw first, then pitch: a flinch rocks a body back about its own shoulders, and a settler
// bent over a furrow leans towards where they are facing, whichever way either faces. With
// no pitch the two orders give the same matrix, so nothing else that was drawn before moves.
tmpObj.rotation.order = 'YXZ';
const tmpColor = new THREE.Color();
const bodyMat = new THREE.Matrix4();
const headMat = new THREE.Matrix4();
const posedMat = new THREE.Matrix4();
const pivotMat = new THREE.Matrix4();
const rotateMat = new THREE.Matrix4();
const unpivotMat = new THREE.Matrix4();
const rollMat = new THREE.Matrix4();
// The wheelbarrow's, see BARROW: where it stands, the wheel on its axle, a bar in its tray.
const barrowObj = new THREE.Object3D();
const frameMat = new THREE.Matrix4();
const partMat = new THREE.Matrix4();
const spinMat = new THREE.Matrix4();
// `n` floats at `i` and at `j` trade places: two instances' matrices or colours.
function swapFloats(a, i, j, n) {
  for (let k = 0; k < n; k++) { const t = a[i + k]; a[i + k] = a[j + k]; a[j + k] = t; }
}
// White multiplies out: a part painted white takes whatever colour its instance is given.
const WHITE = 0xffffff;
// How many bodies one crowd can hold. 640 held Hoogezand until it passed it: at 883 figures
// (houses, sheds, then the keepers appended at the end) everybody past 640 was never enrolled,
// the innkeeper, the mayor and the pirate among them (7 October 2026). crowd-view.js now enrols
// the keepers first, so a crowd that does overflow drops a settler and never the town's
// keepers; and the matrices go up to the GPU only as far as `count` (`upload` below), so a
// bigger buffer costs memory and no bandwidth a frame.
export const CAPACITY = 1024;
// A blow landing on a figure (crowd-view.js hit): how long the flinch lasts, how far it rocks
// back (radians), and how far its clothes and skin go towards FLINCH_RED at the moment of the
// hit. Through the instance colours the crowd already has, so it costs no material and no
// draw call - only a re-upload of those few colour buffers while a flinch is showing, and
// one more when it ends to put the real colours back. The same length as an imp's (imp.js
// HIT_S), so a guard past the imp limit and one with an imp flinch alike.
const FLINCH_S = 0.3;
const FLINCH_LEAN = 0.3;
const FLINCH_TINT = 0.65;
const FLINCH_RED = new THREE.Color(0xd8281c);
// A swing the sea has started (crowd-view.js swing, `{t:'agent', a:'swing'}`): the sword arm
// winds up over the head and comes down, timed so the blade falls where the sea lands the
// blow - GUARD_WINDUP_MS (0.55 s) in lib/hostility.mjs, the imp's own strike frame too - and
// then eases back to wherever the arm was. `strikeArm` is the arm's rotation.x at `u`
// (0..1 of STRIKE_S), `rest` the angle it would have had without the swing.
export const STRIKE_S = 0.8;
const STRIKE_UP = -2.3, STRIKE_DOWN = -0.2, STRIKE_TOP = 0.55, STRIKE_HIT = 0.72;
const smooth = (u) => u * u * (3 - 2 * u);
export function strikeArm(u, rest) {
  if (u < STRIKE_TOP) return rest + (STRIKE_UP - rest) * smooth(u / STRIKE_TOP);
  if (u < STRIKE_HIT) return STRIKE_UP + (STRIKE_DOWN - STRIKE_UP) * smooth((u - STRIKE_TOP) / (STRIKE_HIT - STRIKE_TOP));
  return STRIKE_DOWN + (rest - STRIKE_DOWN) * smooth((u - STRIKE_HIT) / (1 - STRIKE_HIT));
}
// A beer the player has handed over (crowd-view.js giveBeer; Plans/DONE/bier-en-dronken.md): the
// right arm brings a pint to the mouth, holds it tipped while they gulp, and puts it down.
// The player's own drink (classic-avatar.js drinkPose) at a settler's size: up to about -2 on
// the stride's rotation.x, turned a little inward so the glass ends up in front of the face
// rather than out by the ear, and the glass rolled towards the mouth. `drinkArm` is how far
// into that pose the arm is at `t` seconds (`w`, 0..1, so the rest can be blended in) and
// where it is going.
export const SETTLER_DRINK_S = 2.2;
// The roll is gentler than the player's: it turns the glass about the fist, and past about
// 0.95 the rim of a glass held out in front (PINT_OUT) drops below a settler's chin.
const DRINK_UP = 0.45, DRINK_DOWN = 1.7, DRINK_X = -2.0, DRINK_Z = 0.3, DRINK_ROLL = [0.6, 0.95];
export function drinkArm(t) {
  const w = t < DRINK_UP ? smooth(t / DRINK_UP) : t < DRINK_DOWN ? 1 : 1 - smooth(Math.min(1, (t - DRINK_DOWN) / (SETTLER_DRINK_S - DRINK_DOWN)));
  const g = Math.max(0, Math.min(1, (t - DRINK_UP) / (DRINK_DOWN - DRINK_UP)));
  const bob = t > DRINK_UP && t < DRINK_DOWN ? 0.035 * Math.sin(g * Math.PI * 6) : 0;
  return { w, x: DRINK_X - 0.12 * g + bob, z: DRINK_Z, roll: DRINK_ROLL[0] + (DRINK_ROLL[1] - DRINK_ROLL[0]) * g };
}
// What a settler who has had a few does with it (tipsy.js settlerSway gives `f.sway`, 0..1): a
// roll about their own forward, a nod, and the body drawn a few centimetres to one side and
// then the other. All of it on the drawn matrix and none of it on `f.pos` - the sea is where
// they are, this is only how they stand there.
const SWAY_ROLL = 0.15, SWAY_NOD = 0.05, SWAY_SIDE = 0.045;
// And on the move a zigzag round the route the sea walks them along rather than a wobble on
// it - "he still follows his route neatly", said about the first version - with the nose
// swinging after each lurch, and now and then a stumble: a pitch forward and a stagger
// sideways. Two sines at unrelated rates for the zigzag, as walk.js does for the player, and
// a narrow pulse off a slower one for the stumble, so it comes every few seconds and never on
// a beat.
const STAGGER_SIDE = 0.2, STAGGER_YAW = 0.45, STUMBLE_PITCH = 0.3, STUMBLE_SIDE = 0.12;

// Dancing (Plans/DONE/rave-in-het-kasteel.md). `'dance'` is written by the castle's rave
// (web/js/rave.js) onto figures it made itself, together with `f.beat` - how many beats of the
// music have gone by, off the music's own clock - `f.move`, which of the moves, and `f.hype`,
// 0..1, how hard the drop has hit. The beat and not this file's clock, or seventy people bounce
// out of time with the kick. The moves themselves are web/js/dance.js's, the one copy, because
// a player dances them too (classic-avatar.js, Plans/DONE/dansen.md); they are exported from here
// as well for whoever already reached for them here.
export { DANCE_MOVES, dancePose };
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
// The player's pint (classic-avatar.js beerGeometry: its ear at the grip, in world units,
// the glass inboard of the fist) moved into a resident's right fist at a resident's size -
// and held a few centimetres further out in front. A resident's arm is short and its head
// large: measured in the browser, the player's own grip put the glass's middle 5 cm *inside*
// the face at the height of the mouth, where nobody could see it being drunk.
const PINT_OUT = 0.045;
function pintGeometry() {
  const g = heldItemGeometry('beer', {});
  g.scale(RESIDENT_TO_PLAYER, RESIDENT_TO_PLAYER, RESIDENT_TO_PLAYER);
  g.translate(RESIDENT_GRIP[0], RESIDENT_GRIP[1], RESIDENT_GRIP[2] + PINT_OUT);
  g.computeBoundingSphere();
  return g;
}
// How many settlers can be seen drinking at once: one instanced mesh for all of them, like
// the hammers. A beer is handed over one at a time, so this is only ever a handful.
const PINTS = 32;
// The wheelbarrow the gold is fetched with (Plans/DONE/goudkuil.md): wheeled out empty ('barrow'),
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
export const TRAY_BARS = [[-0.03, 0, -0.02, 0.1], [0.03, 0, 0.015, -0.08], [0, 0.034, 0, 0.05]];

// Exported, with the wheel below, for the goldsmith's own barrow (web/js/goldrun.js): the
// same barrow the settlers fetch their gold with, at the same size, since he is a villager.
export function barrowGeometry() {
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
export function wheelGeometry() {
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

// How a body stands at a chore, for the word the walk wrote (Plans/DONE/inwoners-aan-het-werk.md).
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

// Sitting, for a figure somebody has put on a bench or a stool (the Salty Kraken's crew,
// web/js/pirate-tavern.js). Drawn only: `'sit'` is not one of the wire's ANIMS
// (shared/settlerwire.mjs), because nobody the sea walks ever sits - it is the room's furniture
// that does, like the rave's dancers dance. The caller sets `f.y` to the floor under the seat and
// `f.seat = { h, rest }`: the seat's top over that floor, and where the feet rest (0 on the
// floor, a stool's foot ring otherwise). `f.beat`, if it has one, is the tune they nod along to.
//
// The legs are one piece each with no knee, so a sitter's legs go forward from the hip until the
// feet just clear what they rest on: the hip sinks SIT_SINK into the plank (nobody sits on the
// top of a cushion), the clog's heel ends up a hair over the floor. Measured in the resident's
// own parts: hip pivot at 0.14, legs 0.14 long, trunk from 0.121 up - so on the island's 0.135
// benches a settler's hips are nearly at seat height already, which is why sitting is a small
// drop and a lot of leg. A seat too high for the feet leaves them dangling (angle 0).
const SIT_HIP = 0.14, SIT_SINK = 0.02, SIT_FOOT_CLEAR = 0.03;
export function sitPose(f, time) {
  const seat = f.seat || { h: SIT_HIP };
  const h = SIT_HIP * ((f.look && f.look.height) || 1) * (f.baseScale || 1);
  const hip = seat.h - SIT_SINK;
  const legs = -Math.acos(clamp((hip - (seat.rest || 0) - SIT_FOOT_CLEAR) / h, 0, 1));
  const phase = f.phase || 0;
  const breath = Math.sin(time * 1.8 + phase);
  const u = f.beat != null ? f.beat - Math.floor(f.beat) : 0;
  return {
    bob: hip - h + 0.004 * breath,
    // A nod on every count of the tune, and a steady lean over the table without one.
    lean: f.beat != null ? 0.04 + 0.07 * Math.exp(-u * 6) : 0.04,
    left: -1.30 + 0.03 * breath,          // a forearm on the table
    right: -1.10 - 0.03 * breath,         // a hand round the tankard
    legL: legs, legR: legs + 0.08 * Math.sign(Math.sin(phase * 7.3) || 1),
  };
}

// `armed` gives every resident a sword in the right hand and a torch in the left: two more
// instanced meshes for the whole crowd, not two per settler. No light of its own per
// torch, unlike the
// player's (classic-avatar.js): a PointLight per resident would be hundreds of lights, and
// three.js recompiles every material whenever that number changes. The flame glows after
// dark through the same per-vertex night mask the player's does, which is what reads from
// across the water anyway.
//
// `bounds` ({ x, z, r }, scene frame) is where this crowd can be: its island's grid. Every
// batch is culled on that one sphere. Without it they are never culled, because three
// culls an InstancedMesh on a sphere worked out once from wherever the instances stood
// then, and a crowd walks. Measured on a 150-settler island with the volcano and three
// starters in the sea: the four guest crowds' 36 shadow-pass calls were drawn into a shadow
// map a few hundred units away from every one of them. The same sphere is what a ray tests
// first when a figure is hovered (InstancedMesh.raycast), and it is right for that too.
export function createFigures(scene, material, { armed = false, bounds = null } = {}) {
  const sphere = bounds ? new THREE.Sphere(new THREE.Vector3(bounds.x, 0, bounds.z), bounds.r) : null;
  const cull = (m) => {
    if (sphere) { m.boundingSphere = sphere; m.frustumCulled = true; } else m.frustumCulled = false;
    return m;
  };
  // Every mesh the crowd is drawn with. The one place they are made, so the one place each is
  // handed the material's depth twin (buildings.js `fadeDepth`, when the material has one):
  // with NPC Distance inside the haze a settler dithers out, and without the twin their
  // shadow stayed whole on the grass. Given at birth rather than found by a sweep over the
  // scene, which cost every frame budget a walk once a second.
  const instanced = (geo, n) => {
    const m = new THREE.InstancedMesh(geo, material, n);
    if (material.userData && material.userData.fadeDepth) m.customDepthMaterial = material.userData.fadeDepth;
    return cull(m);
  };
  function makeMesh(geo, { shadow = true } = {}) {
    const m = instanced(geo, CAPACITY);
    m.castShadow = shadow;
    m.count = 0;
    scene.add(m);
    return m;
  }
  // The drawn instances' matrices, and no further: draw() writes every one of them each frame,
  // and what lies past `count` is nobody drawn - a trade() that put a matrix there is undone
  // by the next show() before it is ever drawn. Without the range three uploads the whole
  // CAPACITY buffer of every live mesh every frame, however few are standing in it.
  const upload = (m) => {
    const a = m.instanceMatrix;
    a.clearUpdateRanges();
    a.addUpdateRange(0, m.count * 16);
    a.needsUpdate = true;
  };
  const tint =(mesh, i, hex) => {
    mesh.setColorAt(i, tmpColor.setHex(hex));
    mesh.instanceColor.needsUpdate = true;
  };

  // A batch: meshes that draw one instance per figure in it, and which figure is in which slot.
  // Kept packed (Plans/DONE/verborgen-inwoners-tellen-niet.md): the figures drawn this frame in
  // [0, live), the ones enrolled but not drawn in [live, n), nobody past n, and `count` is
  // `live`. It used to be the highest slot ever taken, with a hidden figure parked at y = -999
  // under a scale of 0.0001 - and the GPU ran the vertex shader for every one of those, in
  // the colour pass and the shadow pass: measured on Hoogezand, NPC Distance 1000 or 50 was
  // 432 triangles apart out of 5.5 million, 2 million of them people nobody could see.
  // `key` is the field on the figure that holds its slot here.
  const batch = (meshes, key) => ({ meshes, key, figs: [], live: 0, n: 0 });
  // Two slots trade places: matrix and colour in every mesh of the batch, and the two figures
  // their numbers. Only ever for somebody changing sides, so a crowd that stands still costs
  // nothing and one that walks out of NPC Distance costs a few hundred floats a body.
  function trade(b, i, j) {
    if (i === j) return;
    for (const m of b.meshes) {
      swapFloats(m.instanceMatrix.array, i * 16, j * 16, 16);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) { swapFloats(m.instanceColor.array, i * 3, j * 3, 3); m.instanceColor.needsUpdate = true; }
    }
    const fi = b.figs[i], fj = b.figs[j];
    b.figs[i] = fj; b.figs[j] = fi;
    if (fi) fi[b.key] = j;
    if (fj) fj[b.key] = i;
  }
  // No draw call, and no program set up for one, for a batch nobody in it is drawn from - the
  // same bargain as the tools: a guest island past NPC Distance costs its meshes nothing.
  function settle(b) {
    for (const m of b.meshes) { m.count = b.live; m.visible = b.live > 0; }
  }
  // In at the undrawn end: nobody is drawn before draw() has put them somewhere, so a new
  // arrival never shows an identity matrix, or the last pose of whoever had the slot before.
  function join(b, f) {
    const i = b.n++;
    b.figs[i] = f;
    f[b.key] = i;
  }
  function show(b, f) {
    const i = f[b.key];
    if (i < b.live) return;
    trade(b, i, b.live++);
    settle(b);
  }
  function unshow(b, f) {
    const i = f[b.key];
    if (i >= b.live) return;
    trade(b, i, --b.live);
    settle(b);
  }
  // Out altogether: to the undrawn side, then to the very end, and the end moves in by one. A
  // slot freed is the next one taken, so the volcano's crowd - guards falling and coming back,
  // Codex settlers arriving and leaving, for as long as the page is open - never fills up.
  function leave(b, f) {
    unshow(b, f);
    trade(b, f[b.key], --b.n);
    b.figs.pop();
    f[b.key] = -1;
  }

  const torso = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.torso, WHITE)]));
  // No shadow from what lies on the body's own surface: the waistcoat, apron and buttons on
  // the shirt, the neck between head and collar, and the face's eyes, brows, sideburns and
  // hair cap on the head. Each is inside the silhouette of a batch that does cast, a figure
  // is some ten texels tall in the shadow map at its sharpest, and figures receive no
  // shadow, so none of it ever showed - but it was 142k of the 852k triangles the shadow
  // pass drew on a 150-settler island (the buttons alone are 300 a figure).
  const trim = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.trim, WHITE)]), { shadow: false });
  const leftLeg = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.leftLeg, WHITE)]));
  const rightLeg = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.rightLeg, WHITE)]));
  const leftArm = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.leftArm, WHITE)]));
  const rightArm = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.rightArm, WHITE)]));
  const leftHand = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.leftHand, WHITE)]));
  const rightHand = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.rightHand, WHITE)]));
  const skinCore = makeMesh(mergeParts([residentNamedPart(RESIDENT_PIECES.skinCore, WHITE)]), { shadow: false });
  const head = makeMesh(mergeParts([headGeometry(WHITE, -HEAD_Y)]));
  const details = makeMesh(mergeParts([detailGeometry(-HEAD_Y)]), { shadow: false });
  // Optional clothing and hair remain two population-wide batches, never a mesh
  // per woman. Each keeps its own slots, like the hats, so whoever does not wear one has no
  // instance in it at all: a skirt or a head of hair parked under everybody else was 166k
  // triangles a pass on Hoogezand. They follow the body and the head respectively.
  const skirts = makeMesh(mergeParts([residentPart('skirt', WHITE)]));
  const womanHair = makeMesh(mergeParts([residentPart('womanHair', null, -HEAD_Y)]));
  skirts.name = 'resident-skirts';
  womanHair.name = 'resident-woman-hair';
  // Untinted: the baked parts carry their own brass, steel and flame in the vertex colours,
  // and setColorAt is never called on these two, so there is no instance colour to multiply.
  // Counted every frame like the hammer, not given a slot each: a hand that is busy with
  // something else holds no sword, rather than a sword parked out of sight.
  const swords = armed ? makeMesh(heldGeometry(HELD_ITEM_PARTS.sword, RESIDENT_GRIP)) : null;
  const torches = armed ? makeMesh(heldGeometry(HELD_ITEM_PARTS.torch,
    [-RESIDENT_GRIP[0], RESIDENT_GRIP[1], RESIDENT_GRIP[2]])) : null;
  if (swords) swords.name = 'resident-swords';
  if (torches) torches.name = 'resident-torches';
  // Everyone shares one slot number across the articulated meshes that everyone has, which is
  // also what lets a ray hit on a torso or a head name the person it belongs to.
  const body = batch([torso, trim, leftLeg, rightLeg, leftArm, rightArm, leftHand, rightHand, skinCore, head, details], 'slot');
  const skirted = batch([skirts], 'skirtSlot');
  const haired = batch([womanHair], 'hairSlot');
  torso.userData.bucket = { figs: body.figs };
  head.userData.bucket = { figs: body.figs };

  // `turn` is a turn about z after the swing about x - the same XYZ order classic-avatar.js
  // poses the player's arms in - which only a drinking arm uses, to bring its fist in.
  function setPosed(mesh, slot, base, pivot, angle, turn = 0) {
    pivotMat.makeTranslation(pivot[0], pivot[1], pivot[2]);
    rotateMat.makeRotationX(angle);
    if (turn) rotateMat.multiply(rollMat.makeRotationZ(turn));
    unpivotMat.makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
    posedMat.copy(base).multiply(pivotMat).multiply(rotateMat).multiply(unpivotMat);
    mesh.setMatrixAt(slot, posedMat);
  }
  // A pint in a drinking fist. It swings with the arm like the sword does, and then has the
  // arm's own turn taken back off about its grip, so it stands upright wherever the arm is -
  // the counter-rotation classic-avatar.js gives the player's held items - before `roll` tips
  // it in towards the mouth (+z tips the top to -x, inboard for a right hand).
  const gripMat = new THREE.Matrix4(), ungripMat = new THREE.Matrix4(), uprightMat = new THREE.Matrix4();
  function setPint(i, base, angle, turn, roll) {
    const pivot = RESIDENT_PIVOTS.rightHand;
    pivotMat.makeTranslation(pivot[0], pivot[1], pivot[2]);
    rotateMat.makeRotationX(angle).multiply(rollMat.makeRotationZ(turn));
    unpivotMat.makeTranslation(-pivot[0], -pivot[1], -pivot[2]);
    gripMat.makeTranslation(RESIDENT_GRIP[0], RESIDENT_GRIP[1], RESIDENT_GRIP[2]);
    ungripMat.makeTranslation(-RESIDENT_GRIP[0], -RESIDENT_GRIP[1], -RESIDENT_GRIP[2]);
    uprightMat.copy(rotateMat).invert().multiply(rollMat.makeRotationZ(roll));
    posedMat.copy(base).multiply(pivotMat).multiply(rotateMat).multiply(unpivotMat)
      .multiply(gripMat).multiply(uprightMat).multiply(ungripMat);
    pints.setMatrixAt(i, posedMat);
  }
  // The hats keep their own slots: a settler is in exactly one of these meshes, or in
  // none of them if it is bare-headed.
  const hats = new Map();
  for (const h of HAT_SHAPES) {
    if (h.id === 'none') continue;
    hats.set(h.id, batch([makeMesh(mergeParts(hatParts(h.id, WHITE, -HEAD_Y)))], 'hatSlot'));
  }
  const batches = [body, skirted, haired, ...hats.values()];
  // Which of those each figure is in, body first, and its hat's mesh. Kept here rather than on
  // the figure, which is the caller's: a figure that held its batches held every mesh and every
  // other figure, and an assertion that failed on one tried to print all of it.
  const worn = new WeakMap();

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
  const hammers = instanced(hammerGeo, CAPACITY);
  hammers.count = 0;
  hammers.name = 'resident-hammers';

  // The chores' tools (Plans/DONE/inwoners-aan-het-werk.md): one InstancedMesh each for the
  // whole crowd, like the hammer, and hidden outright while nobody holds one so that a
  // village with nobody at work costs the draw calls it always did. Built the way the
  // hammer is - a handle pointing forward out of the resting fist - and then tipped so
  // that the arm angles in `workPose` put the business end where the work is.
  const toolMesh = (parts, tilt) => {
    const g = mergeGeometries(parts, false);
    g.rotateX(tilt);
    g.translate(...RESIDENT_GRIP);
    g.computeVertexNormals();
    const m = instanced(g, CAPACITY);
    m.count = 0;
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
  const bundles = instanced(bundleGeo, CAPACITY);
  bundles.count = 0;
  bundles.visible = false;
  scene.add(bundles);
  // Everybody's wheelbarrow on the way to and from the gold pit, its wheel, and the gold in
  // its tray - three batches for the whole crowd, the same bargain as the tools: count 0 and
  // no draw call while nobody is fetching any. The bars are the pile's own ingot
  // (web/js/goldpit.js), a size down to lie in a tray.
  const barrowMesh = (geo, n) => {
    const m = instanced(geo, n);
    m.count = 0;
    m.castShadow = true;
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
  // Everybody's beer, drawn only while it is being drunk (count 0 the rest of the time, so
  // an island nobody has bought a round costs no draw call for it).
  const pints = instanced(pintGeometry(), PINTS);
  pints.count = 0;
  pints.castShadow = true;
  scene.add(pints);

  let time = 0;

  // Dress a figure the walk has already made, and give it a slot in the crowd - on the
  // undrawn side, until the first draw() that is handed it `visible`. Returns
  // false when the crowd is full, which is the caller's cue to take the figure back out
  // again - a body with no slot would be stepped every frame and drawn nowhere.
  function enrol(f, look, kind) {
    if (body.n >= CAPACITY) return false;
    join(body, f);
    const slot = f.slot;
    tint(torso, slot, look.tunic);
    for (const mesh of [leftArm, rightArm]) tint(mesh, slot, look.tunic);
    for (const mesh of [trim, leftLeg, rightLeg]) tint(mesh, slot, look.trim);
    tint(head, slot, look.skin);
    for (const mesh of [leftHand, rightHand, skinCore]) tint(mesh, slot, look.skin);
    // What only some wear goes in a batch of its own, or nowhere. None of these can be fuller
    // than the body, which has already said there is room.
    const wears = [body];
    f.skirtSlot = f.hairSlot = f.hatSlot = -1;
    if (look.outfit === 'skirt') {
      join(skirted, f);
      tint(skirts, f.skirtSlot, look.tunic);
      wears.push(skirted);
    }
    if (look.presentation === 'woman') { join(haired, f); wears.push(haired); }
    const hat = hats.get(look.hatShape) || null;
    if (hat) {
      join(hat, f);
      tint(hat.meshes[0], f.hatSlot, look.hat);
      wears.push(hat);
    }
    worn.set(f, { batches: wears, hat: hat ? hat.meshes[0] : null });
    f.look = look;
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
    return true;
  }

  // Somebody has been hit. Only starts the clock - draw() does the lean and the colour - and
  // a second blow while the first is showing starts it again.
  function flinch(f) {
    if (f.slot == null) return;
    f.flinch = FLINCH_S;
  }
  // Somebody has started a swing. Only starts the clock, like a flinch; draw() moves the arm.
  function strike(f) {
    if (f.slot == null) return;
    f.strike = STRIKE_S;
  }
  // Somebody has been handed a beer. The same kind of clock, except that a second one is
  // refused while the first is still going down: whether it started is the caller's cue to
  // count it (crowd-view.js giveBeer).
  function drinkBeer(f) {
    if (f.slot == null || f.drink > 0) return false;
    f.drink = SETTLER_DRINK_S;
    return true;
  }
  // Their colours, pushed `k` of FLINCH_TINT towards red, or put back exactly when `k` is 0.
  function tintFlinch(f, k) {
    const t = k * FLINCH_TINT;
    const put = (mesh, hex) => { mesh.setColorAt(f.slot, tmpColor.setHex(hex).lerp(FLINCH_RED, t)); mesh.instanceColor.needsUpdate = true; };
    put(torso, f.look.tunic);
    put(leftArm, f.look.tunic);
    put(rightArm, f.look.tunic);
    put(head, f.look.skin);
  }

  // Out of sight: past `count` in every batch the figure is in, so the GPU does nothing for
  // it at all. Now, for a caller that will not draw again this frame (crowd-view's crowd
  // taken off the screen while the chronicle is scrubbed back); draw() does the same for any
  // figure it is handed with `visible` false, and puts back whoever has it true.
  function hide(f) {
    if (f.slot == null) return;
    for (const b of worn.get(f).batches) unshow(b, f);
  }

  // Out of sight for good: out of every batch, its slots taken by the next one enrolled. The
  // figure keeps nothing of them, so a figure freed and then drawn again would draw nowhere -
  // the caller enrols a new one instead (web/js/crowd-view.js retire).
  function free(f) {
    if (f.slot == null) return;
    for (const b of worn.get(f).batches) leave(b, f);
    worn.delete(f);
    f.slot = null;
  }

  // Everything the eye sees, from where the walk has put everybody. `f.anim` is the whole
  // of what it is told: the four animations below are derived from it and from this file's
  // own clock, and none of them can move a body.
  const toolCount = new Map();
  function draw(figures, dt) {
    time += dt;
    let hammerCount = 0, pintCount = 0, bundleCount = 0, barrowCount = 0, trayCount = 0, swordCount = 0, torchCount = 0;
    for (const f of figures.values()) {
      if (f.slot == null) continue;
      // Whether they are drawn is `visible`, read here and nowhere else in this file: whoever
      // has it false goes past `count`, whoever has it true is brought in front of it. Both
      // are no-ops for somebody already on that side, which is everybody on most frames.
      if (!f.visible) { hide(f); continue; }
      const dress = worn.get(f);
      for (const b of dress.batches) show(b, f);
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
      // A flinch: `k` from 1 at the blow to 0, eased so it snaps back first and settles last.
      // The frame it runs out puts the real colours back and then it is forgotten.
      let flinchK = 0;
      if (f.flinch > 0) {
        f.flinch = Math.max(0, f.flinch - dt);
        flinchK = f.flinch / FLINCH_S;
        tintFlinch(f, flinchK);
        flinchK *= flinchK;
      }
      const work = workPose(loading ? 'gather' : f.anim, time + f.phase);
      const dance = f.anim === 'dance' ? dancePose(f.move || 0, f.beat || 0, f.hype || 0) : null;
      const sit = f.anim === 'sit' ? sitPose(f, time) : null;
      const bob = sit ? 0 : f.anim === 'walk' || hauling || pushing ? Math.abs(Math.sin(time * f.gait + f.phase)) * 0.035
        : f.anim === 'hammer' ? Math.abs(Math.sin(time * 8 + f.phase)) * 0.02
          : f.anim === 'step' ? Math.abs(Math.sin(time * 9 + f.phase)) * 0.03
            : dance ? dance.bob
              : work ? work.drop + hipLift(work.lean, f.look) : 0;
      // A beer going down (drinkBeer), `t` seconds in, and what a few have done already.
      let drunk = null;
      if (f.drink > 0) {
        f.drink = Math.max(0, f.drink - dt);
        drunk = drinkArm(SETTLER_DRINK_S - f.drink);
      }
      const sway = f.sway || 0;
      const swayPhase = time * 1.9 + f.phase;
      const swayRoll = sway * SWAY_ROLL * Math.sin(swayPhase);
      // How far into the zigzag they are: eased in as they set off and out as they stop, or
      // every halt would jump the body 20 cm back onto the route.
      f.lurch = (f.lurch || 0) + ((walking && sway ? 1 : 0) - (f.lurch || 0)) * Math.min(1, dt * 3);
      const stagger = sway * f.lurch;
      const zig = 0.65 * Math.sin(swayPhase * 0.6) + 0.35 * Math.sin(swayPhase * 0.23 + 2);
      const stumble = stagger ? stagger * Math.pow(Math.max(0, Math.sin(time * 1.3 + f.phase * 2)), 12) : 0;
      const swayNod = sway * SWAY_NOD * Math.sin(swayPhase * 0.7 + 1.1) + stumble * STUMBLE_PITCH;
      // Sideways from where they face: half as fast as the roll standing, so they lean into
      // each lurch; the zigzag on the move, and a stumble throws them further the way they
      // were already going.
      const swaySide = sway * SWAY_SIDE * Math.sin(swayPhase * 0.5)
        + stagger * STAGGER_SIDE * zig + stumble * STUMBLE_SIDE * Math.sign(zig);
      const sx = f.pos[0] + Math.cos(f.yaw) * swaySide, sz = f.pos[1] - Math.sin(f.yaw) * swaySide;
      // The nose follows the zigzag - pointing where the lurch is taking them, which is the
      // zigzag's slope - so they look like they are walking it rather than sliding along it.
      const drawnYaw = f.yaw + stagger * STAGGER_YAW * Math.cos(swayPhase * 0.6) + (dance ? dance.twist : 0);

      // One transform for the person, then the parts hang off it: torso and limbs take
      // the build, the head rides at the top of whatever body this is.
      tmpObj.position.set(sx, f.y + (sit ? sit.bob : bob * f.baseScale), sz);
      const gaitPhase = time * (f.mode === 'walk' ? f.gait : 9) + f.phase;
      tmpObj.rotation.set((sit ? sit.lean : work ? work.lean : dance ? dance.lean : 0) - FLINCH_LEAN * flinchK + swayNod, drawnYaw,
        (sit ? 0 : dance ? dance.roll : Math.sin(gaitPhase) * (walking ? 0.045 : 0.01)) + swayRoll);
      tmpObj.scale.setScalar(f.baseScale);
      tmpObj.updateMatrix();
      bodyMat.multiplyMatrices(tmpObj.matrix, f.mBody);
      torso.setMatrixAt(f.slot, bodyMat);
      if (f.skirtSlot >= 0) skirts.setMatrixAt(f.skirtSlot, bodyMat);
      trim.setMatrixAt(f.slot, bodyMat);
      skinCore.setMatrixAt(f.slot, bodyMat);
      const stride = walking ? Math.sin(gaitPhase) * (f.speed > 0.8 ? 0.72 : 0.48) : 0;
      const idle = walking || hammering || work || dance || sit ? 0 : Math.sin(time * 1.8 + f.phase) * 0.035;
      const swing = armed ? 0.45 : 0.9;
      // Hauling, the right hand is up on the bundle and only the left arm swings. Behind a
      // barrow both are on the handles (BARROW_ARM) and neither swings.
      const leftArmAngle = sit ? sit.left : work ? work.left
        : dance ? dance.left
          : pushing ? BARROW_ARM
            : (armed ? ARMED_ARM.left : 0) + (walking ? -stride * swing : idle);
      let rightArmAngle = sit ? sit.right : work ? work.right
        : dance ? dance.right
          : hammering ? -0.55 - (0.5 + 0.5 * Math.sin(time * 8 + f.phase)) * 0.5
            : hauling ? -2.5
              : pushing ? BARROW_ARM
                : (armed ? ARMED_ARM.right : 0) + (walking ? stride * swing : -idle);
      if (f.strike > 0) {
        f.strike = Math.max(0, f.strike - dt);
        rightArmAngle = strikeArm(1 - f.strike / STRIKE_S, rightArmAngle);
      }
      // The drinking arm blends from whatever it would have been doing into the pose and back.
      let rightTurn = 0;
      if (drunk) {
        rightArmAngle += (drunk.x - rightArmAngle) * drunk.w;
        rightTurn = -drunk.z * drunk.w;       // inward, which for the right arm is -z
      }
      // Not less the nod, as a chore's legs are: the nod is the trunk's, and the thighs stay on the bench.
      setPosed(leftLeg, f.slot, bodyMat, RESIDENT_PIVOTS.leftLeg, sit ? sit.legL : work ? work.legL - work.lean : dance ? dance.legL - dance.lean : stride);
      setPosed(rightLeg, f.slot, bodyMat, RESIDENT_PIVOTS.rightLeg, sit ? sit.legR : work ? work.legR - work.lean : dance ? dance.legR - dance.lean : -stride);
      setPosed(leftArm, f.slot, bodyMat, RESIDENT_PIVOTS.leftArm, leftArmAngle);
      setPosed(leftHand, f.slot, bodyMat, RESIDENT_PIVOTS.leftHand, leftArmAngle);
      setPosed(rightArm, f.slot, bodyMat, RESIDENT_PIVOTS.rightArm, rightArmAngle, rightTurn);
      setPosed(rightHand, f.slot, bodyMat, RESIDENT_PIVOTS.rightHand, rightArmAngle, rightTurn);
      // The right fist holds one thing: a beer puts down the hammer or the tool.
      if (hammering && !drunk) setPosed(hammers, hammerCount++, bodyMat, RESIDENT_PIVOTS.rightHand, rightArmAngle);
      const tool = drunk ? null : TOOL_OF[f.anim];
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
      if (drunk && pintCount < PINTS) setPint(pintCount++, bodyMat, rightArmAngle, rightTurn, drunk.roll * drunk.w);
      if (armed) {
        // A settler at work puts the sword away for the hammer, the tool or a beer rather
        // than holding both in one fist; the torch stays lit in the other hand unless that
        // one is at work too.
        if (!(hammering || work || hauling || pushing || drunk)) setPosed(swords, swordCount++, bodyMat, RESIDENT_PIVOTS.rightHand, rightArmAngle);
        if (!((work && f.anim !== 'fish') || pushing)) setPosed(torches, torchCount++, bodyMat, RESIDENT_PIVOTS.leftHand, leftArmAngle);
      }
      headMat.multiplyMatrices(tmpObj.matrix, f.mHead);
      head.setMatrixAt(f.slot, headMat);
      details.setMatrixAt(f.slot, headMat);
      if (f.hairSlot >= 0) womanHair.setMatrixAt(f.hairSlot, headMat);
      if (f.hatSlot >= 0) dress.hat.setMatrixAt(f.hatSlot, headMat);
    }
    for (const b of batches) if (b.live) for (const m of b.meshes) upload(m);
    // With no island's sphere to hang on (the tests, the rave), three works the one a ray is
    // tested against out once, from wherever the instances stood then, and keeps it. It used
    // to be saved by the parked bodies at y = -999, which stretched it over everything.
    if (!sphere) { torso.boundingSphere = null; head.boundingSphere = null; }
    if (armed) {
      for (const [m, n] of [[swords, swordCount], [torches, torchCount]]) {
        m.count = n;
        m.visible = n > 0;
        if (n) upload(m);
      }
    }
    hammers.count = hammerCount;
    if (hammerCount) upload(hammers);
    pints.count = pintCount;
    if (pintCount) upload(pints);
    for (const m of [hoes, axes, rods]) {
      m.count = toolCount.get(m) || 0;
      m.visible = m.count > 0;
      if (m.count) upload(m);
    }
    toolCount.clear();
    bundles.count = bundleCount;
    bundles.visible = bundleCount > 0;
    if (bundleCount) upload(bundles);
    for (const [m, n] of [[barrows, barrowCount], [wheels, barrowCount], [trayBars, trayCount]]) {
      m.count = n;
      m.visible = n > 0;
      if (n) upload(m);
    }
  }

  // The people are instanced, so a ray hit comes back as a mesh plus an instance
  // number. These two turn that back into the settler standing there, which is what
  // lets you hover someone halfway down a street and read who it is. Only the torso and
  // the head are offered: a ray that grazes a hat brim carries on into the head behind
  // it, and leaving the other meshes out halves the instances every hover has to test.
  const pickables = () => [torso, head].filter((m) => m.count > 0);
  // Only a slot under `count` is somebody drawn: past it are the undrawn, whose slots a ray
  // can never have come back with.
  const figureAt = (mesh, i) => {
    const b = mesh && mesh.userData && mesh.userData.bucket;
    const f = b && i != null && i < mesh.count ? b.figs[i] : null;
    return f && f.visible ? f : null;
  };

  // Everything this crowd put into the scene, taken back out again. There was no way to
  // do that while a crowd lasted as long as the page did; now one is built per island and
  // rebuilt on every reseed, and instanced meshes left standing empty per rebuild
  // is a leak that only shows up on the machine somebody has had open all day.
  function dispose() {
    for (const m of [...batches.flatMap((b) => b.meshes), swords, torches, hammers, pints, hoes, axes, rods, bundles, barrows, wheels, trayBars]) {
      if (!m) continue;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
      // And the mesh itself: every one of these is an InstancedMesh of CAPACITY, and its
      // instanceMatrix and instanceColor buffers are freed by the renderer on the mesh's
      // dispose() alone - the geometry's leaves them. Some 21 of them a crowd, raised again
      // with every guest region.
      m.dispose();
    }
    for (const b of batches) { b.figs.length = 0; b.live = 0; b.n = 0; }
  }

  return { enrol, hide, free, flinch, strike, drinkBeer, draw, pickables, figureAt, dispose };
}

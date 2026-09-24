// What a settler looks like, and the eleven meshes the whole crowd is drawn with. The
// other half of what used to be web/js/settlers.js; settler-walk.js decides where the
// bodies are and this file decides what stands there.
//
// Residents share the player's faceted Blender style, but wear waistcoats, short aprons
// and compact work hats. Five instanced body meshes keep skin, dyed clothing and facial
// details separate; six hat buckets preserve each resident's wardrobe. The whole crowd
// costs eleven meshes, regardless of population. Working hammers retain their own bucket.
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
import { HELD_ITEM_PARTS, heldItemGeometry } from './classic-avatar.js';

export { settlerLook, styleLook, kindOf, styleOf };

const tmpObj = new THREE.Object3D();
// Yaw first, then pitch: a flinch rocks a body back about its own shoulders, whichever way
// it faces. Every other rotation written through this object has no pitch, and for those the
// two orders give the same matrix, so nothing that was drawn before moves.
tmpObj.rotation.order = 'YXZ';
const tmpColor = new THREE.Color();
const bodyMat = new THREE.Matrix4();
const headMat = new THREE.Matrix4();
const posedMat = new THREE.Matrix4();
const pivotMat = new THREE.Matrix4();
const rotateMat = new THREE.Matrix4();
const unpivotMat = new THREE.Matrix4();
const rollMat = new THREE.Matrix4();
// Out of sight: the same parking spot hide() puts a whole figure in.
const HIDDEN = new THREE.Matrix4().compose(new THREE.Vector3(0, -999, 0), new THREE.Quaternion(),
  new THREE.Vector3(0.0001, 0.0001, 0.0001));
// White multiplies out: a part painted white takes whatever colour its instance is given.
const WHITE = 0xffffff;
export const CAPACITY = 640;
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
// A beer the player has handed over (crowd-view.js giveBeer; Plans/bier-en-dronken.md): the
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
  torso: ['Work shirt'],
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
  ].map((g) => g.scale(build, height, build));
  const headParts = [
    headGeometry(lk.skin, -HEAD_Y),
    detailGeometry(-HEAD_Y),
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

// `armed` gives every resident a sword in the right hand and a torch in the left: two more
// instanced meshes for the whole crowd, not two per settler, so a hostile island costs 13
// draw calls where a friendly one costs 11. No light of its own per torch, unlike the
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
  // Slots given back by `free`, taken again before the count grows. A crowd used to be
  // enrolled once and thrown away whole, so a slot was never reused; the volcano's crowd
  // runs for as long as the page does while guards fall and come back and islanders' Codex
  // settlers arrive and leave, and every one of those that took a fresh slot would fill
  // CAPACITY in an evening and leave the next arrival undrawn.
  const spare = [];
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
  // Untinted: the baked parts carry their own brass, steel and flame in the vertex colours,
  // and setColorAt is never called on these two, so there is no instance colour to multiply.
  const swords = armed ? makeMesh(heldGeometry(HELD_ITEM_PARTS.sword, RESIDENT_GRIP)) : null;
  const torches = armed ? makeMesh(heldGeometry(HELD_ITEM_PARTS.torch,
    [-RESIDENT_GRIP[0], RESIDENT_GRIP[1], RESIDENT_GRIP[2]])) : null;
  const body = [torso, trim, leftLeg, rightLeg, leftArm, rightArm, leftHand, rightHand, skinCore, head, details,
    ...(armed ? [swords, torches] : [])];
  torso.userData.bucket = { figs: roster };
  head.userData.bucket = { figs: roster };

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
    hats.set(h.id, { mesh: makeMesh(mergeParts(hatParts(h.id, WHITE, -HEAD_Y))), slots: 0, spare: [] });
  }

  const hammerGeo = mergeGeometries([
    paintGeo(new THREE.BoxGeometry(0.022, 0.16, 0.022), 0x8b5e3c),
    (() => { const g = new THREE.BoxGeometry(0.075, 0.05, 0.05); g.translate(0, 0.09, 0); return paintGeo(g, 0x3a3a3f); })(),
  ], false);
  hammerGeo.computeVertexNormals();
  const hammers = new THREE.InstancedMesh(hammerGeo, material, 64);
  hammers.count = 0;
  hammers.frustumCulled = false;
  scene.add(hammers);
  // Everybody's beer, drawn only while it is being drunk (count 0 the rest of the time, so
  // an island nobody has bought a round costs no draw call for it).
  const pints = new THREE.InstancedMesh(pintGeometry(), material, PINTS);
  pints.count = 0;
  pints.castShadow = true;
  pints.frustumCulled = false;
  scene.add(pints);

  let time = 0;

  // Dress a figure the walk has already made, and give it a slot in the crowd. Returns
  // false when the crowd is full, which is the caller's cue to take the figure back out
  // again - a body with no slot would be stepped every frame and drawn nowhere.
  function enrol(f, look, kind) {
    const slot = spare.length ? spare.pop() : slots;
    if (slot >= CAPACITY) return false;
    if (slot === slots) slots++;
    for (const m of body) m.count = slots;
    tint(torso, slot, look.tunic);
    for (const mesh of [leftArm, rightArm]) tint(mesh, slot, look.tunic);
    for (const mesh of [trim, leftLeg, rightLeg]) tint(mesh, slot, look.trim);
    tint(head, slot, look.skin);
    for (const mesh of [leftHand, rightHand, skinCore]) tint(mesh, slot, look.skin);
    const hatBucket = hats.get(look.hatShape) || null;
    let hatSlot = -1;
    if (hatBucket && (hatBucket.spare.length || hatBucket.slots < CAPACITY)) {
      hatSlot = hatBucket.spare.length ? hatBucket.spare.pop() : hatBucket.slots++;
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

  // Out of sight for good: hidden, and its slots handed back for the next one enrolled. The
  // figure keeps nothing of them, so a figure freed and then drawn again would draw nowhere -
  // the caller enrols a new one instead (web/js/crowd-view.js retire).
  function free(f) {
    if (f.slot == null) return;
    hide(f);
    if (roster[f.slot] === f) roster[f.slot] = null;
    spare.push(f.slot);
    if (f.hatBucket && f.hatSlot >= 0) f.hatBucket.spare.push(f.hatSlot);
    f.slot = null;
    f.hatSlot = -1;
  }

  // Everything the eye sees, from where the walk has put everybody. `f.anim` is the whole
  // of what it is told: the four animations below are derived from it and from this file's
  // own clock, and none of them can move a body.
  function draw(figures, dt) {
    time += dt;
    let hammerCount = 0, pintCount = 0;
    for (const f of figures.values()) {
      if (!f.visible || f.slot == null) continue;
      // Turn towards whatever the walk pointed at. `faceAngle` is the one case where an
      // angle comes from outside - a boat knows its own heading and the body in it takes
      // it whole, with no easing, because the hull has already done the turning.
      if (f.faceAngle != null) f.yaw = f.faceAngle;
      else if (f.face) f.yaw = lerpAngle(f.yaw, Math.atan2(f.face[0], f.face[1]), f.turn);
      const walking = f.anim === 'walk' || f.anim === 'step';
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
      const bob = f.anim === 'walk' ? Math.abs(Math.sin(time * f.gait + f.phase)) * 0.035
        : f.anim === 'hammer' ? Math.abs(Math.sin(time * 8 + f.phase)) * 0.02
          : f.anim === 'step' ? Math.abs(Math.sin(time * 9 + f.phase)) * 0.03
            : 0;
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
      const drawnYaw = f.yaw + stagger * STAGGER_YAW * Math.cos(swayPhase * 0.6);

      if (hammering && !drunk && hammerCount < 60) {
        // The hammer is held in a hand, so it hangs off whatever size that settler is:
        // an apprentice's is a small hammer at an apprentice's height.
        const s = f.baseScale * f.look.height;
        const swing = -1.15 + 0.75 * (0.5 + 0.5 * Math.sin(time * 8 + f.phase));
        tmpObj.position.set(sx + Math.sin(f.yaw) * 0.16 * s, f.y + 0.26 * s, sz + Math.cos(f.yaw) * 0.16 * s);
        tmpObj.rotation.set(0, f.yaw, swing);
        tmpObj.scale.setScalar(s);
        tmpObj.updateMatrix();
        hammers.setMatrixAt(hammerCount++, tmpObj.matrix);
      }

      // One transform for the person, then the parts hang off it: torso and limbs take
      // the build, the head rides at the top of whatever body this is.
      tmpObj.position.set(sx, f.y + bob * f.baseScale, sz);
      const gaitPhase = time * (f.mode === 'walk' ? f.gait : 9) + f.phase;
      tmpObj.rotation.set(-FLINCH_LEAN * flinchK + swayNod, drawnYaw, Math.sin(gaitPhase) * (walking ? 0.045 : 0.01) + swayRoll);
      tmpObj.scale.setScalar(f.baseScale);
      tmpObj.updateMatrix();
      bodyMat.multiplyMatrices(tmpObj.matrix, f.mBody);
      torso.setMatrixAt(f.slot, bodyMat);
      trim.setMatrixAt(f.slot, bodyMat);
      skinCore.setMatrixAt(f.slot, bodyMat);
      const stride = walking ? Math.sin(gaitPhase) * (f.speed > 0.8 ? 0.72 : 0.48) : 0;
      const idle = walking || hammering ? 0 : Math.sin(time * 1.8 + f.phase) * 0.035;
      const swing = armed ? 0.45 : 0.9;
      const leftArmAngle = (armed ? ARMED_ARM.left : 0) + (walking ? -stride * swing : idle);
      let rightArmAngle = hammering
        ? -0.55 - (0.5 + 0.5 * Math.sin(time * 8 + f.phase)) * 0.5
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
      setPosed(leftLeg, f.slot, bodyMat, RESIDENT_PIVOTS.leftLeg, stride);
      setPosed(rightLeg, f.slot, bodyMat, RESIDENT_PIVOTS.rightLeg, -stride);
      setPosed(leftArm, f.slot, bodyMat, RESIDENT_PIVOTS.leftArm, leftArmAngle);
      setPosed(leftHand, f.slot, bodyMat, RESIDENT_PIVOTS.leftHand, leftArmAngle);
      setPosed(rightArm, f.slot, bodyMat, RESIDENT_PIVOTS.rightArm, rightArmAngle, rightTurn);
      setPosed(rightHand, f.slot, bodyMat, RESIDENT_PIVOTS.rightHand, rightArmAngle, rightTurn);
      if (drunk && pintCount < PINTS) setPint(pintCount++, bodyMat, rightArmAngle, rightTurn, drunk.roll * drunk.w);
      if (armed) {
        // A settler at work puts the sword away for the hammer rather than holding both in
        // one fist - and for a beer; the torch stays lit in the other hand.
        if (hammering || drunk) swords.setMatrixAt(f.slot, HIDDEN);
        else setPosed(swords, f.slot, bodyMat, RESIDENT_PIVOTS.rightHand, rightArmAngle);
        setPosed(torches, f.slot, bodyMat, RESIDENT_PIVOTS.leftHand, leftArmAngle);
      }
      headMat.multiplyMatrices(tmpObj.matrix, f.mHead);
      head.setMatrixAt(f.slot, headMat);
      details.setMatrixAt(f.slot, headMat);
      if (f.hatBucket && f.hatSlot >= 0) f.hatBucket.mesh.setMatrixAt(f.hatSlot, headMat);
    }
    for (const m of body) m.instanceMatrix.needsUpdate = true;
    for (const h of hats.values()) if (h.slots) h.mesh.instanceMatrix.needsUpdate = true;
    hammers.count = hammerCount;
    hammers.instanceMatrix.needsUpdate = true;
    pints.count = pintCount;
    if (pintCount) pints.instanceMatrix.needsUpdate = true;
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
  // rebuilt on every reseed, and eleven instanced meshes left standing empty per rebuild
  // is a leak that only shows up on the machine somebody has had open all day.
  function dispose() {
    for (const m of [...body, hammers, pints, ...[...hats.values()].map((h) => h.mesh)]) {
      if (!m) continue;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    roster.length = 0;
    slots = 0;
    spare.length = 0;
  }

  return { enrol, hide, free, flinch, strike, drinkBeer, draw, pickables, figureAt, dispose };
}

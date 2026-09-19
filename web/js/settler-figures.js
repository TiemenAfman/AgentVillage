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

export { settlerLook, styleLook, kindOf, styleOf };

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();
const bodyMat = new THREE.Matrix4();
const headMat = new THREE.Matrix4();
const posedMat = new THREE.Matrix4();
const pivotMat = new THREE.Matrix4();
const rotateMat = new THREE.Matrix4();
const unpivotMat = new THREE.Matrix4();
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

export function createFigures(scene, material) {
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
  const body = [torso, trim, leftLeg, rightLeg, leftArm, rightArm, leftHand, rightHand, skinCore, head, details];
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
  hammerGeo.computeVertexNormals();
  const hammers = new THREE.InstancedMesh(hammerGeo, material, 64);
  hammers.count = 0;
  hammers.frustumCulled = false;
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
  function draw(figures, dt) {
    time += dt;
    let hammerCount = 0;
    for (const f of figures.values()) {
      if (!f.visible || f.slot == null) continue;
      // Turn towards whatever the walk pointed at. `faceAngle` is the one case where an
      // angle comes from outside - a boat knows its own heading and the body in it takes
      // it whole, with no easing, because the hull has already done the turning.
      if (f.faceAngle != null) f.yaw = f.faceAngle;
      else if (f.face) f.yaw = lerpAngle(f.yaw, Math.atan2(f.face[0], f.face[1]), f.turn);
      const walking = f.anim === 'walk' || f.anim === 'step';
      const hammering = f.anim === 'hammer';
      const bob = f.anim === 'walk' ? Math.abs(Math.sin(time * f.gait + f.phase)) * 0.035
        : f.anim === 'hammer' ? Math.abs(Math.sin(time * 8 + f.phase)) * 0.02
          : f.anim === 'step' ? Math.abs(Math.sin(time * 9 + f.phase)) * 0.03
            : 0;

      if (hammering && hammerCount < 60) {
        // The hammer is held in a hand, so it hangs off whatever size that settler is:
        // an apprentice's is a small hammer at an apprentice's height.
        const s = f.baseScale * f.look.height;
        const swing = -1.15 + 0.75 * (0.5 + 0.5 * Math.sin(time * 8 + f.phase));
        tmpObj.position.set(f.pos[0] + Math.sin(f.yaw) * 0.16 * s, f.y + 0.26 * s, f.pos[1] + Math.cos(f.yaw) * 0.16 * s);
        tmpObj.rotation.set(0, f.yaw, swing);
        tmpObj.scale.setScalar(s);
        tmpObj.updateMatrix();
        hammers.setMatrixAt(hammerCount++, tmpObj.matrix);
      }

      // One transform for the person, then the parts hang off it: torso and limbs take
      // the build, the head rides at the top of whatever body this is.
      tmpObj.position.set(f.pos[0], f.y + bob * f.baseScale, f.pos[1]);
      const gaitPhase = time * (f.mode === 'walk' ? f.gait : 9) + f.phase;
      tmpObj.rotation.set(0, f.yaw, Math.sin(gaitPhase) * (walking ? 0.045 : 0.01));
      tmpObj.scale.setScalar(f.baseScale);
      tmpObj.updateMatrix();
      bodyMat.multiplyMatrices(tmpObj.matrix, f.mBody);
      torso.setMatrixAt(f.slot, bodyMat);
      trim.setMatrixAt(f.slot, bodyMat);
      skinCore.setMatrixAt(f.slot, bodyMat);
      const stride = walking ? Math.sin(gaitPhase) * (f.speed > 0.8 ? 0.72 : 0.48) : 0;
      const idle = walking || hammering ? 0 : Math.sin(time * 1.8 + f.phase) * 0.035;
      const leftArmAngle = walking ? -stride * 0.9 : idle;
      const rightArmAngle = hammering
        ? -0.55 - (0.5 + 0.5 * Math.sin(time * 8 + f.phase)) * 0.5
        : walking ? stride * 0.9 : -idle;
      setPosed(leftLeg, f.slot, bodyMat, RESIDENT_PIVOTS.leftLeg, stride);
      setPosed(rightLeg, f.slot, bodyMat, RESIDENT_PIVOTS.rightLeg, -stride);
      setPosed(leftArm, f.slot, bodyMat, RESIDENT_PIVOTS.leftArm, leftArmAngle);
      setPosed(leftHand, f.slot, bodyMat, RESIDENT_PIVOTS.leftHand, leftArmAngle);
      setPosed(rightArm, f.slot, bodyMat, RESIDENT_PIVOTS.rightArm, rightArmAngle);
      setPosed(rightHand, f.slot, bodyMat, RESIDENT_PIVOTS.rightHand, rightArmAngle);
      headMat.multiplyMatrices(tmpObj.matrix, f.mHead);
      head.setMatrixAt(f.slot, headMat);
      details.setMatrixAt(f.slot, headMat);
      if (f.hatBucket && f.hatSlot >= 0) f.hatBucket.mesh.setMatrixAt(f.hatSlot, headMat);
    }
    for (const m of body) m.instanceMatrix.needsUpdate = true;
    for (const h of hats.values()) if (h.slots) h.mesh.instanceMatrix.needsUpdate = true;
    hammers.count = hammerCount;
    hammers.instanceMatrix.needsUpdate = true;
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
    for (const m of [...body, hammers, ...[...hats.values()].map((h) => h.mesh)]) {
      if (!m) continue;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    roster.length = 0;
    slots = 0;
  }

  return { enrol, hide, draw, pickables, figureAt, dispose };
}

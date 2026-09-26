// The baker at the bakery's oven (Plans/stal-en-veld.md). By day a baker - a passive settler,
// nobody's agent, the smith's kind (web/js/smithy.js) - stands before the oven's mouth and works
// it with a peel: a loaf of dough slid in, a moment, a baked one drawn out and set aside, and a
// breath before the next. At nightfall he walks round to the shop door and goes in, and in the
// morning he comes out again. The oven itself is countryside.js's (`attachBakery`) and is left
// alone: a brick oven keeps its heat through the night, and its glow lighting the porch after
// dark is what the bake was made to do.
//
// Everything he does is measured off the bake rather than written down again. The fire,
// `civic_bakery glow`, has its origin on the oven's mouth, which faces +z
// (scripts/build-bakery.py); the shop door is `anchor.door`. How far back from the mouth he
// stands is worked out from his own rig once, when he is made (`calibrate`): the peel is in his
// right fist, wherever the rig puts the fist, and he is set down so that at full stretch its
// blade is PEEL_IN inside the mouth and drawn back it is clear of it. A rig that changes its
// arms moves where he stands, not where the peel goes.
//
// Deterministic like the smith: his own clock, a seeded rng, and a state machine that is a
// function of those and of the night - the shared material's uNight, the number that lights the
// windows, so this needs nothing handed to it but the frame's dt (tests/bakery-keeper.test.mjs).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from 'shared/rng.mjs';
import { box } from './buildings.js';
import * as models from './models.js';
import { createClassicAvatar } from './classic-avatar.js';
import { normalizeAvatar } from './avatar.js';
// The smith's numbers, so the island's two passive settlers are one size, walk at one pace and
// go in on the same evening rather than a slider's width apart.
import { SMITH_SCALE, WALK_SPEED, DUSK, DAWN } from './smithy.js';

const GLOW = 'civic_bakery glow';
const BAKERY = 'civic_bakery';

// The baker: whites and a white wool cap (the rig's 'dome', the nearest thing it has to a
// baker's hat), pale trousers with the flour on them, and no pack. The peel is not one of the
// rig's hand items - those are the player's inventory (avatar.js HAND_ITEMS) - so his hands
// are empty to the rig and the peel is hung on his right fist here.
export const BAKER_LOOK = normalizeAvatar({
  skin: 0xe6b08c, tunic: 0xf3eee4, trim: 0xb8b0a2, hat: 0xf8f5ee, hatShape: 'dome',
  equip: { backpack: false },
});
export const BAKER_SCALE = SMITH_SCALE;

// The peel, in the bakery's own units (the figure's scale is taken back out of it): a long
// handle and a thin square blade, with the fist a quarter of the way up the handle.
const PEEL = { back: 0.07, handle: 0.2, blade: 0.08, width: 0.075, thick: 0.006, stick: 0.012 };
const PEEL_WOOD = 0x9a6b3f, PEEL_BLADE = 0xc49a64;
// The loaf on the blade: dough going in, bread coming out (the bake's own crust colour).
const DOUGH = 0xecdcb8, BREAD = 0xc98a45;
const LOAF = { w: 0.05, h: 0.022, d: 0.045 };
// How the peel is held, as angles of the rig's arms (rotation.x, negative is forward; the
// smith's hammer is held out at -1.3). Drawn back the fists are low at his belt; at full
// stretch they are out in front of him. The peel itself keeps PITCH to the ground whatever the
// arms do - tipped down to the mouth, which is at his hip.
export const ARM_BACK = -0.55;
export const ARM_OUT = -1.05;
const PITCH = 0.22;
// Of the reach into the oven, how much is the handle sliding through his fist and how much is
// him leaning in after it.
const SLIDE = 0.1;
const LEAN = 0.03;
const LEAN_TILT = 0.14;
// How far into the mouth the blade goes, and a hand's width more than that it has to come out
// by before he counts it clear.
export const PEEL_IN = 0.09;

// One loaf: rest (dough is put on the peel), in, bake (the blade still in the oven), out, and
// the bread is set aside while the next is shaped. REST_S is lengthened a little at random,
// off the seeded rng, so the baker is not a metronome.
export const PUSH_S = 0.9;
export const BAKE_S = 0.6;
export const REST_S = 1.6;
const REST_JITTER = 0.8;
// Of the rest, how long the bread stays on the peel before it is set down.
const SHOW_BREAD_S = 0.7;
// How far in front of the shop's door he walks along the front: clear of the loaves on the
// window sill, which stand out to 0.105 in front of the wall.
const FRONT = 0.07;

const ease = (u) => u * u * (3 - 2 * u);
const nightOf = (material) => material?.userData?.uniforms?.uNight?.value ?? 0;

// Where along a polyline a walker is after `d` of walking: the point and the heading. The
// smith's own, in smithy.js; the two are one rule and small enough to keep side by side.
function along(path, d) {
  let left = Math.max(0, d);
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, , az] = path[i], [bx, , bz] = path[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (left <= len || i === path.length - 2) {
      const k = len > 0 ? Math.min(1, left / len) : 1;
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, yaw: Math.atan2(bx - ax, bz - az) };
    }
    left -= len;
  }
  const [x, , z] = path[path.length - 1];
  return { x, z, yaw: 0 };
}
const pathLength = (path) => path.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - path[i][0], p[2] - path[i][2]), 0);

// The bake's two measurements: the oven's mouth and the shop door, in the bakery's frame.
export function bakeryMarks() {
  const glow = models.assetParts(BAKERY).find((n) => n === GLOW || n.startsWith(GLOW + ':'));
  const door = models.anchorsOf(BAKERY).door;
  if (!glow || !door) return null;
  return { mouth: [...models.part(glow).at], door: [...door] };
}

function peelGeometry() {
  const s = 1 / BAKER_SCALE;
  const { back, handle, blade, width, thick, stick } = PEEL;
  const g = mergeGeometries([
    box(stick, stick, back + handle, PEEL_WOOD, { y: -stick / 2, z: (handle - back) / 2 }),
    box(width, thick, blade, PEEL_BLADE, { y: -thick / 2, z: handle + blade / 2 }),
  ], false);
  g.scale(s, s, s);
  g.computeVertexNormals();
  return g;
}
function loafGeometry(hex) {
  const s = 1 / BAKER_SCALE;
  const g = box(LOAF.w, LOAF.h, LOAF.d, hex, { y: PEEL.thick / 2, z: PEEL.handle + PEEL.blade * 0.55 });
  g.scale(s, s, s);
  g.computeVertexNormals();
  return g;
}

// The rig's arm pivots. Each hand's attach group hangs on its arm's own pivot
// (classic-avatar.js createClassicAvatar), so its parent is the arm; setting that turn after
// the rig's own update is how the arms hold the peel without the rig being told about peels.
const armsOf = (rig) => [rig.handAttach.leftArm.parent, rig.handAttach.rightArm.parent];

// Put the arms, the peel and the lean where `push` (0 drawn back, 1 at full stretch) has them.
function hold(baker, push) {
  const a = ARM_BACK + (ARM_OUT - ARM_BACK) * push;
  for (const arm of baker.arms) arm.rotation.x = a;
  // Less the arm's own turn and less his lean, so the peel stays at PITCH to the ground: tipped
  // with the lean as well, its blade went in under the mouth, through the stone lip.
  baker.peel.rotation.x = PITCH - a - LEAN_TILT * push;
  baker.blade.position.z = (SLIDE / BAKER_SCALE) * push;
  baker.figure.rotation.x = LEAN_TILT * push;
}

// Where the tip of the blade is, relative to his feet, when he faces +z and holds `push` -
// read off the scene graph, because where his fist is belongs to the rig.
function reachAt(baker, push) {
  const { figure } = baker;
  const saved = [figure.position.clone(), figure.rotation.y];
  figure.position.set(0, 0, 0);
  figure.rotation.y = 0;
  hold(baker, push);
  baker.root.updateMatrixWorld(true);
  const tip = baker.root.worldToLocal(baker.tip.getWorldPosition(new THREE.Vector3()));
  figure.position.copy(saved[0]);
  figure.rotation.y = saved[1];
  return tip;
}

// Where he stands: facing the mouth (-z), set back so the blade reaches PEEL_IN into it at full
// stretch, and to the side so the peel - in his right fist - goes in at the middle of the mouth.
// `reachAt` has him standing still; at work he also steps LEAN towards the oven at full
// stretch (updateBaker), so the stand is that much further back.
function calibrate(baker) {
  const { mouth, door } = baker.marks;
  const full = reachAt(baker, 1);
  // Facing -z turns his +x to -x and his +z to -z.
  const work = [mouth[0] + full.x, 0, mouth[2] + full.z - PEEL_IN + LEAN];
  const front = door[2] + FRONT;
  const path = [work, [work[0], 0, front], [door[0] + 0.12, 0, front], [door[0], 0, door[2]]];
  return { work, path, full, rest: reachAt(baker, 0) };
}

export function attachBaker(group, at, material, yaw = 0) {
  const marks = bakeryMarks();
  if (!marks) return null;
  const root = new THREE.Group();
  root.position.set(...at);
  root.rotation.y = yaw;
  group.add(root);

  const rig = createClassicAvatar(BAKER_LOOK, material);
  const figure = new THREE.Group();
  figure.rotation.order = 'YXZ';
  figure.scale.setScalar(BAKER_SCALE);
  figure.add(rig.object);
  root.add(figure);

  // The peel: a turned group on the right fist that keeps it at PITCH, and inside it the peel
  // itself, which slides along its own length through the fist.
  const geometries = [peelGeometry(), loafGeometry(DOUGH), loafGeometry(BREAD)];
  const peel = new THREE.Group();
  rig.handAttach.rightArm.add(peel);
  const blade = new THREE.Mesh(geometries[0], material);
  blade.castShadow = true;
  peel.add(blade);
  const dough = new THREE.Mesh(geometries[1], material);
  const bread = new THREE.Mesh(geometries[2], material);
  for (const m of [dough, bread]) { m.castShadow = true; blade.add(m); }
  const tip = new THREE.Object3D();
  tip.position.set(0, 0, (PEEL.handle + PEEL.blade) / BAKER_SCALE);
  blade.add(tip);

  const baker = {
    root, figure, rig, arms: armsOf(rig), peel, blade, dough, bread, tip, marks, material, geometries,
    time: 0, rng: makeRng('baker'),
    // 'work' at the oven, 'in' walking to the door, 'inside', 'out' walking back.
    mode: 'work', walked: 0, walkPhase: 0,
    // Within a loaf: 'rest', 'in', 'bake', 'out'; `phaseAt` is when this one began.
    phase: 'rest', phaseAt: 0, restFor: REST_S, loaves: 0, push: 0,
  };
  Object.assign(baker, calibrate(baker));
  baker.pathLength = pathLength(baker.path);
  updateBaker(baker, 0);
  return baker;
}

// The loaf's own clock, while he is at the oven.
function stepLoaf(baker, t) {
  const since = t - baker.phaseAt;
  const next = (phase) => { baker.phase = phase; baker.phaseAt = t; };
  if (baker.phase === 'rest' && since >= baker.restFor) next('in');
  else if (baker.phase === 'in' && since >= PUSH_S) next('bake');
  else if (baker.phase === 'bake' && since >= BAKE_S) next('out');
  else if (baker.phase === 'out' && since >= PUSH_S) {
    next('rest');
    baker.loaves++;
    baker.restFor = REST_S + baker.rng.range(0, REST_JITTER);
  }
  const u = Math.min(1, (t - baker.phaseAt) / PUSH_S);
  baker.push = baker.phase === 'in' ? ease(u) : baker.phase === 'bake' ? 1 : baker.phase === 'out' ? 1 - ease(u) : 0;
  // Dough goes in; the bread is what comes out, is shown on the peel a moment and set down.
  const resting = baker.phase === 'rest', shown = t - baker.phaseAt < SHOW_BREAD_S;
  baker.dough.visible = baker.phase === 'in' || (resting && (!shown || baker.loaves === 0));
  baker.bread.visible = baker.phase === 'bake' || baker.phase === 'out' || (resting && shown && baker.loaves > 0);
}

export function updateBaker(baker, dt) {
  if (!baker) return;
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  baker.time += step;
  const t = baker.time;
  const night = nightOf(baker.material);

  // ---- where the baker is -----------------------------------------------------------
  // He only goes in with the peel drawn back and empty, so a dusk mid-loaf finishes the loaf.
  if (baker.mode === 'work' && night > DUSK && baker.phase === 'rest') { baker.mode = 'in'; baker.walked = 0; }
  else if (baker.mode === 'inside' && night < DAWN) { baker.mode = 'out'; baker.walked = 0; }
  let moving = false;
  if (baker.mode === 'in' || baker.mode === 'out') {
    baker.walked += WALK_SPEED * step;
    moving = true;
    if (baker.walked >= baker.pathLength) {
      const back = baker.mode === 'out';
      baker.mode = back ? 'work' : 'inside';
      moving = false;
      if (back) { baker.phase = 'rest'; baker.phaseAt = t; baker.loaves = 0; }
    }
  }
  baker.figure.visible = baker.mode !== 'inside';
  if (baker.mode === 'work') {
    stepLoaf(baker, t);
    const [wx, , wz] = baker.work;
    // Facing the mouth, which is -z; leaning in is towards it.
    baker.figure.position.set(wx, 0, wz - LEAN * baker.push);
    baker.figure.rotation.y = Math.PI;
  } else {
    baker.push = 0;
    baker.dough.visible = baker.bread.visible = false;
    if (moving) {
      const pose = along(baker.mode === 'out' ? [...baker.path].reverse() : baker.path, baker.walked);
      baker.figure.position.set(pose.x, 0, pose.z);
      baker.figure.rotation.y = pose.yaw;
    }
  }

  // ---- the rig, then the arms on the peel ---------------------------------------------
  baker.walkPhase += step * (moving ? 9 : 1.5);
  baker.rig.update({ moving, grounded: true, phase: baker.walkPhase }, step);
  hold(baker, baker.push);
}

export function disposeBaker(baker) {
  if (!baker) return;
  baker.root.parent?.remove(baker.root);
  for (const g of baker.geometries) g.dispose();
  baker.rig.dispose();
}

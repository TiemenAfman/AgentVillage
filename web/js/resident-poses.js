// How a skinned resident stands, joint by joint (Plans/inwoners-in-avonturierstijl.md, fase 3).
// settler-figures.js works out, as it always has, what a figure is doing this frame - the stride,
// the chore, the seat, the dance, the drink, the swing - as angles a hip and a shoulder are turned
// by; this file puts those on the skinned body's joints and adds what the old one-piece limbs never
// had: a knee and an elbow, and an ankle that keeps a foot flat when the knee bends under a crouch.
// Pure arithmetic over the rig the bake wrote (residents-mesh.js `rig.points`), no three.js, so
// tests/resident-poses.test.mjs can hold every pose to its limits and its feet to the floor.
//
// Angles are rotation.x as the stride's always were: positive turns a hanging limb back, so a thigh
// forward is negative, a knee bent is positive (the shin goes back) and an elbow bent is negative
// (the forearm comes forward).
import { JOINT } from './resident-skin.js';

// The joints' own limits, which nothing here may pass: a knee does not bend forward or past its
// stop, an elbow likewise. tests/resident-poses.test.mjs holds every pose inside them.
export const KNEE_LIMIT = [0, 2.4];
export const ELBOW_LIMIT = [-2.5, 0];

// The walk (fase 2): a knee a touch bent even under the body, up to KNEE_WALK more mid-swing (more
// at a run), and a forearm that hangs a little forward and comes up with the arm as it swings in front.
const KNEE_STAND = 0.06, KNEE_WALK = 0.75, KNEE_RUN = 1.05;
const ELBOW_HANG = 0.2, ELBOW_SWING = 0.5;
// Standing about: soft knees and arms, never locked straight like a mannequin's.
const KNEE_IDLE = 0.03, ELBOW_IDLE = 0.14;
// A chore's crouch (radians at the hip; the knee takes twice it and the ankle gives it back, so the
// foot stays flat and the body comes down) and its elbows, per word of workPose.
const WORK = {
  hoe: { crouch: 0.1, left: -0.45, right: -0.45 },
  weed: { crouch: 0.32, left: -0.5, right: -0.5 },
  chop: { crouch: 0.12, left: -0.35, right: -0.3 },
  gather: { crouch: 0.42, left: -0.45, right: -0.45 },
  fish: { crouch: 0.04, left: -0.5, right: -0.65 },
};
// Holding a sword and a torch out in front: the forearms up from the elbow.
const ELBOW_ARMED = -0.55;
// Hammering: the forearm brings the hammer down from the elbow as the upper arm swings.
const HAMMER_ELBOW = -0.45, HAMMER_ELBOW_SWING = 0.5;
// Hauling a bundle on the right shoulder: the arm up and folded back so the hand holds it there.
const HAUL_SHOULDER = -2.3, HAUL_ELBOW = -1.9;
// A sword swing (crowd-view.js swing): the elbow is folded at the wind-up and straight by the blow,
// read off how far the shoulder has come up from where it strikes (STRIKE_DOWN in settler-figures.js).
const STRIKE_FOLD = -1.1, STRIKE_LOW = -0.2, STRIKE_HIGH = -2.3;
// A drink brought to the mouth: the upper arm forward and turned in about the vertical (which turns
// the plane the elbow bends in, so the forearm folds up towards the middle of the face rather than
// past the ear), the forearm folded up. Searched per body for the fist at the mouth with the elbow
// below the shoulder; tests/resident-poses.test.mjs holds the fist there.
export const DRINK = {
  male: { x: -0.95, y: -0.9, z: 0, elbow: -1.75 },
  female: { x: -0.75, y: -0.6, z: -0.3, elbow: -1.95 },
};
// A flinch: the forearms come up in front, by how hard the blow was (0..1).
const FLINCH_ELBOW = -0.9;
// Sitting: the hip sinks this far into the seat, the heel clears what the feet rest on by this
// much, the trunk leans over the table, and the arms rest on it.
const SIT_SINK = 0.012, SIT_FOOT_CLEAR = 0.012;
const SIT_ARMS = { left: [-0.55, -1.15], right: [-0.45, -1.35] };

const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// The leg off the rig, once per rig: the thigh and the shin as they really lie in the rest pose
// (the ankle stands a little behind the knee), not as two plumb lengths - plumb, a crouch came out
// 4 mm off the ground and a sitter's heels went into the floor.
const legs = new WeakMap();
export function legOf(rig) {
  let l = legs.get(rig);
  if (!l) {
    const p = rig.points, h = p[JOINT.leftHip], k = p[JOINT.leftKnee], a = p[JOINT.leftAnkle];
    l = {
      hip: h[1],
      thigh: len(h, k),
      shin: len(k, a),
      ankle: a[1],
      v1: [k[1] - h[1], k[2] - h[2]],
      v2: [a[1] - k[1], a[2] - k[2]],
    };
    legs.set(rig, l);
  }
  return l;
}
// How far the ankle hangs below the hip with the thigh turned by `hip` and the knee by `knee`
// (rotation.x, so a turn t takes (y, z) to (y cos t - z sin t, ...)).
function drop(leg, hip, knee) {
  const turnY = (v, t) => v[0] * Math.cos(t) - v[1] * Math.sin(t);
  return -(turnY(leg.v1, hip) + turnY(leg.v2, hip + knee));
}
// The t in [lo, hi] at which f(t) = want, for an f that only falls (or only rises) over it.
function solve(fn, want, lo, hi) {
  const rising = fn(hi) > fn(lo);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if ((fn(mid) < want) === rising) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Bends both legs by `a` at the hip, 2a at the knee and back by a at the ankle: the feet stay flat
// and under the hips, and the body comes down by what that costs the leg's length - which is
// returned, in the rig's units, for the caller to lower the body by.
function crouch(P, a, leg) {
  if (!(a > 0)) return 0;
  for (const side of ['left', 'right']) {
    P.x[JOINT[side + 'Hip']] -= a;
    P.x[JOINT[side + 'Knee']] += 2 * a;
    P.x[JOINT[side + 'Ankle']] -= a;
  }
  return drop(leg, 0, 0) - drop(leg, -a, 2 * a);
}

// The pose for one figure this frame, into P (resident-skin.js createPose, cleared by the caller).
// `s` is what settler-figures.js draw() already knows:
//   legL, legR, left, right, rightTurn  the hip and shoulder angles it has always worked out
//   anim                                the walk's word (walk, step, hammer, haul, barrow, ...)
//   gait (phase or null), fast          walking, and at a run
//   work, dance                         workPose / dancePose, or null
//   seat                                { h, rest } when sitting (sitPose's), in world units
//   drunk                               drinkArm's { w } while a beer goes down, or null
//   striking, flinch (0..1), armed      a sword swing on, a blow landing, a sword and torch held
//   sex                                 which body (the drink is fitted to each)
//   scale                               look.height * baseScale: rig units to world units upright
// Returns how far (world units) to move the body up from where draw() stood it: down for a
// crouch, and for a seat the difference between where the old pose put the hips and these.
export function residentPose(P, s, rig) {
  const leg = legOf(rig);
  const J = JOINT;
  let dy = 0;
  P.x[J.leftHip] = s.legL;
  P.x[J.rightHip] = s.legR;
  P.x[J.leftShoulder] = s.left;
  P.x[J.rightShoulder] = s.right;
  P.z[J.rightShoulder] = s.rightTurn || 0;
  let elbowL = -ELBOW_IDLE, elbowR = -ELBOW_IDLE;
  let kneeL = KNEE_IDLE, kneeR = KNEE_IDLE;

  if (s.seat) {
    // Hips on the seat and the shins hanging as they do standing, the thighs coming up off the
    // plumb until the heels just clear what the feet rest on - and on a seat lower than that (the
    // island's benches were made for the old, short-legged body) the thighs flat on it and the
    // shins reaching forward. A seat too high leaves the legs hanging.
    const hip = s.seat.h - SIT_SINK;
    const want = (hip - (s.seat.rest || 0) - SIT_FOOT_CLEAR) / s.scale - leg.ankle;
    const flat = Math.PI / 2;
    let tilt = 0, knee = 0;
    if (want >= drop(leg, 0, 0)) { tilt = 0; knee = 0; }
    else if (want >= drop(leg, -flat, flat)) { tilt = solve((t) => drop(leg, -t, t), want, 0, flat); knee = tilt; }
    else { tilt = flat; knee = want <= drop(leg, -flat, 0) ? 0 : solve((k) => drop(leg, -flat, k), want, 0, flat); }
    const lift = s.legR - s.legL;          // sitPose crosses one leg a little; keep it
    P.x[J.leftHip] = -tilt;
    P.x[J.rightHip] = -tilt + lift * 0.5;
    kneeL = knee;
    kneeR = knee - lift * 0.5;
    P.x[J.leftShoulder] = SIT_ARMS.left[0];
    P.x[J.rightShoulder] = SIT_ARMS.right[0];
    elbowL = SIT_ARMS.left[1];
    elbowR = SIT_ARMS.right[1];
    // draw() stood the body for the old one-piece leg (its own `sit.bob`); move it so these hips
    // are at the seat.
    dy = (hip - leg.hip * s.scale) - s.sitBob;
  } else if (s.gait != null) {
    // A leg bends at the knee while it swings through and is all but straight while it carries
    // the body: the stride's angle goes as sin, so it moves forward while cos is below zero for
    // the left leg and above it for the right (which takes -stride). Most bend mid-swing, as the
    // leg passes under the hip - where a stiff one would scuff the ground.
    const c = Math.cos(s.gait), knee = s.fast ? KNEE_RUN : KNEE_WALK;
    kneeL = KNEE_STAND + knee * Math.max(0, -c);
    kneeR = KNEE_STAND + knee * Math.max(0, c);
    // The forearm comes forward with the arm and hangs back nearly straight behind.
    elbowL = -(ELBOW_HANG + ELBOW_SWING * Math.max(0, -s.left));
    elbowR = -(ELBOW_HANG + ELBOW_SWING * Math.max(0, -s.right));
  }

  if (s.work) {
    const w = WORK[s.anim === 'load' ? 'gather' : s.anim] || WORK.hoe;
    elbowL = w.left; elbowR = w.right;
    kneeL = kneeR = 0;
    dy -= crouch(P, w.crouch, leg) * s.scale;
  } else if (s.dance) {
    // Knees that give on the beat (the dance's own bob is how far it lifts), and arms that bend
    // where they are held up in front and stay long where they are thrown up or hang.
    kneeL = kneeR = 0;
    dy -= crouch(P, 0.1 + Math.max(0, 0.04 - s.dance.bob) * 3, leg) * s.scale;
    const bend = (a) => (a < -2 ? -0.25 : a < -0.7 ? -1.15 : -0.35);
    elbowL = bend(s.left); elbowR = bend(s.right);
  } else if (s.anim === 'hammer') {
    elbowR = HAMMER_ELBOW - HAMMER_ELBOW_SWING * clamp((-0.55 - s.right) / 0.5, 0, 1);
    elbowL = -0.35;
  } else if (s.anim === 'haul') {
    P.x[J.rightShoulder] = HAUL_SHOULDER;
    elbowR = HAUL_ELBOW;
  } else if (s.anim === 'barrow' || s.anim === 'carry') {
    // Both hands on the handles: s.barrow, the angles that put a fist on one (barrowArms below).
    if (s.barrow) {
      P.x[J.leftShoulder] = P.x[J.rightShoulder] = s.barrow[0];
      elbowL = elbowR = s.barrow[1];
    }
  } else if (s.armed && !s.seat) {
    elbowL = elbowR = ELBOW_ARMED;
  }

  if (s.striking) {
    elbowR = STRIKE_FOLD * clamp((STRIKE_LOW - s.right) / (STRIKE_LOW - STRIKE_HIGH), 0, 1);
  }
  if (s.drunk && s.drunk.w > 0) {
    const w = s.drunk.w, d = DRINK[s.sex] || DRINK.male;
    P.x[J.rightShoulder] += (d.x - P.x[J.rightShoulder]) * w;
    P.y[J.rightShoulder] += (d.y - P.y[J.rightShoulder]) * w;
    P.z[J.rightShoulder] += (d.z - P.z[J.rightShoulder]) * w;
    elbowR += (d.elbow - elbowR) * w;
  }
  if (s.flinch > 0) {
    elbowL += (FLINCH_ELBOW - elbowL) * s.flinch;
    elbowR += (FLINCH_ELBOW - elbowR) * s.flinch;
  }

  P.x[J.leftKnee] += clamp(kneeL, KNEE_LIMIT[0], KNEE_LIMIT[1]);
  P.x[J.rightKnee] += clamp(kneeR, KNEE_LIMIT[0], KNEE_LIMIT[1]);
  P.x[J.leftElbow] = clamp(elbowL, ELBOW_LIMIT[0], ELBOW_LIMIT[1]);
  P.x[J.rightElbow] = clamp(elbowR, ELBOW_LIMIT[0], ELBOW_LIMIT[1]);
  return dy;
}

// The shoulder and elbow that put a fist on a point (y, z) in the figure's own frame, the arm
// swinging in its own plane: the barrow's handles (barrowGrip below). Two links, the elbow bending forward (negative); a point out
// of reach is reached for along the line to it.
export function armTo(rig, side, y, z) {
  const p = rig.points;
  const sh = p[JOINT[side + 'Shoulder']], el = p[JOINT[side + 'Elbow']], wr = p[JOINT[side + 'Wrist']];
  const a = Math.hypot(el[1] - sh[1], el[2] - sh[2]);
  // To the grip, a little past the wrist (resident-skin.js gripOf).
  const b = Math.hypot(wr[1] - el[1], wr[2] - el[2]) * 1.35;
  const dy = y - sh[1], dz = z - sh[2];
  const d = clamp(Math.hypot(dy, dz), Math.abs(a - b) + 1e-6, a + b - 1e-6);
  // The angle from straight down to the target, about x: rotation.x of a hanging limb by t points it
  // along (0, -cos t, -sin t), so forward (+z) is negative t.
  const toward = -Math.atan2(dz, -dy);
  const inner = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const bend = Math.PI - Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  // Upper arm turned further forward than the line by the triangle's angle, forearm folding back
  // towards the line: an elbow bent forward is negative, so the shoulder goes the other way.
  return [toward + inner, -bend];
}


// Where a skinned figure's fists close on a barrow's handles: the man's right arm a little forward
// and a little bent (BARROW_POSE), measured off the rig the way the shader will pose it. The skinned
// crowd's barrows are built with their handles here (settler-figures.js barrowGeometry), and every
// body reaches them by armTo. The old body's barrows keep the old grip.
export const BARROW_POSE = { shoulder: -0.42, elbow: -0.4 };
export function barrowGrip(rig) {
  const p = rig.points;
  const sh = p[JOINT.rightShoulder], el = p[JOINT.rightElbow], wr = p[JOINT.rightWrist];
  const turn = (v, t) => [v[0], v[1] * Math.cos(t) - v[2] * Math.sin(t), v[1] * Math.sin(t) + v[2] * Math.cos(t)];
  const up = turn([el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]], BARROW_POSE.shoulder);
  const fore = turn([(wr[0] - el[0]) * 1.35, (wr[1] - el[1]) * 1.35, (wr[2] - el[2]) * 1.35], BARROW_POSE.shoulder + BARROW_POSE.elbow);
  return { x: sh[0] + up[0] + fore[0], y: sh[1] + up[1] + fore[1], z: sh[2] + up[2] + fore[2] };
}

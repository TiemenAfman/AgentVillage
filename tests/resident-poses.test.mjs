// A skinned resident's poses, joint by joint (Plans/inwoners-in-avonturierstijl.md, fase 3): every
// pose the crowd can be in keeps its knees and elbows inside their limits, a crouch keeps its feet
// on the ground, a sitter has hips on the seat and heels off the floor, a drink reaches the mouth,
// and a barrow's handles are in the fists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./support/shared-loader.mjs', import.meta.url);
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { workPose, sitPose, dancePose, drinkArm, strikeArm, SETTLER_DRINK_S, STRIKE_S } = await import('../web/js/settler-figures.js');
const skin = await import('../web/js/resident-skin.js');
const poses = await import('../web/js/resident-poses.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;
const { createPose, poseJoints, residentRig, gripOf, JOINT, POSE_FLOATS } = skin;
const { residentPose, armTo, legOf, KNEE_LIMIT, ELBOW_LIMIT } = poses;

const out = new Float32Array(POSE_FLOATS);
const at = (j, p) => {
  const w = j * 12;
  return [0, 1, 2].map((r) => out[w + r * 4] * p[0] + out[w + r * 4 + 1] * p[1] + out[w + r * 4 + 2] * p[2] + out[w + r * 4 + 3]);
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const base = (over = {}) => ({
  legL: 0, legR: 0, left: 0, right: 0, rightTurn: 0, anim: 'still', gait: null, fast: false,
  work: null, dance: null, seat: null, sitBob: 0, drunk: null, striking: false, flinch: 0, armed: false,
  scale: 1, sex: 'male', ...over,
});
const pose = (s, sex = s.sex) => {
  const P = createPose();
  const dy = residentPose(P, s, residentRig(sex));
  poseJoints(residentRig(sex), P, out);
  return { P, dy };
};

test('no pose bends a knee or an elbow past its stop', () => {
  for (const sex of ['male', 'female']) {
    for (let t = 0; t < 6; t += 0.13) {
      const cases = [
        base({ anim: 'walk', gait: t * 10, legL: Math.sin(t * 10) * 0.48, legR: -Math.sin(t * 10) * 0.48, left: -0.4 * Math.sin(t * 10), right: 0.4 * Math.sin(t * 10) }),
        base({ anim: 'walk', gait: t * 10, fast: true, legL: 0.72, legR: -0.72 }),
        base({ anim: 'hammer', right: -0.55 - (0.5 + 0.5 * Math.sin(t * 8)) * 0.5 }),
        base({ anim: 'haul', right: -2.5 }),
        base({ anim: 'barrow', left: -0.5, right: -0.5, barrow: armTo(residentRig(sex), 'right', 0.19, 0.05) }),
        base({ armed: true, left: -0.35, right: -0.45 }),
        base({ striking: true, right: strikeArm((t % STRIKE_S) / STRIKE_S, 0) }),
        base({ drunk: drinkArm(t % SETTLER_DRINK_S) }),
        base({ flinch: (t % 1) }),
      ];
      for (const anim of ['hoe', 'weed', 'chop', 'gather', 'fish']) {
        const w = workPose(anim, t);
        cases.push(base({ anim, work: w, legL: w.legL - w.lean, legR: w.legR - w.lean, left: w.left, right: w.right }));
      }
      for (let move = 0; move < 6; move++) {
        const d = dancePose(move, t * 2, t % 1);
        cases.push(base({ anim: 'dance', dance: d, legL: d.legL - d.lean, legR: d.legR - d.lean, left: d.left, right: d.right }));
      }
      for (const s of cases) {
        s.sex = sex;
        const { P, dy } = pose(s);
        assert.ok(Number.isFinite(dy), `${s.anim}: the body moved by ${dy}`);
        for (const side of ['left', 'right']) {
          const k = P.x[JOINT[side + 'Knee']], e = P.x[JOINT[side + 'Elbow']];
          assert.ok(k >= KNEE_LIMIT[0] - 1e-9 && k <= KNEE_LIMIT[1] + 1e-9, `${sex} ${s.anim} t=${t}: ${side} knee at ${k}`);
          assert.ok(e >= ELBOW_LIMIT[0] - 1e-9 && e <= ELBOW_LIMIT[1] + 1e-9, `${sex} ${s.anim} t=${t}: ${side} elbow at ${e}`);
        }
        assert.ok([...P.x, ...P.y, ...P.z].every(Number.isFinite), `${sex} ${s.anim}: a joint turned by something that is not a number`);
      }
    }
  }
});

test('a crouch at a chore keeps the feet flat on the ground', () => {
  for (const sex of ['male', 'female']) {
    const rig = residentRig(sex);
    const ankle = rig.points[JOINT.leftAnkle];
    for (const anim of ['hoe', 'weed', 'gather']) {
      // The chore's own leg angles cancel against its lean in draw(); here only the crouch.
      const { P, dy } = pose(base({ anim, work: workPose(anim, 0), sex }));
      const a = at(JOINT.leftAnkle, ankle);
      assert.ok(Math.abs(a[1] + dy - ankle[1]) < 0.002, `${sex} ${anim}: the ankle ends ${a[1] + dy - ankle[1]} off where it stood`);
      assert.ok(Math.abs(a[2] - ankle[2]) < 0.02, `${sex} ${anim}: the foot slid ${a[2] - ankle[2]} along`);
      assert.ok(P.x[JOINT.leftKnee] > 0.15, `${sex} ${anim}: no knee in it`);
    }
  }
});

test('a sitter has hips on the seat and heels off the floor, on every seat the island has', () => {
  for (const sex of ['male', 'female']) {
    const rig = residentRig(sex), leg = legOf(rig);
    for (const seat of [{ h: 0.1 }, { h: 0.135 }, { h: 0.18 }, { h: 0.24 }, { h: 0.3, rest: 0.09 }]) {
      for (const height of [0.9, 1, 1.1]) {
        const f = { seat, look: { height }, baseScale: 1, phase: 1.3 };
        const sit = sitPose(f, 2);
        const { dy } = pose(base({ seat, sitBob: sit.bob, legL: sit.legL, legR: sit.legR, scale: height, sex }));
        const rootY = sit.bob + dy;
        const hip = rootY + at(JOINT.leftHip, rig.points[JOINT.leftHip])[1] * height;
        assert.ok(Math.abs(hip - (seat.h - 0.012)) < 1e-4, `${sex} on ${seat.h}: hips at ${hip}`);
        for (const side of ['left', 'right']) {
          const heel = rootY + (at(JOINT[side + 'Ankle'], rig.points[JOINT[side + 'Ankle']])[1] - leg.ankle) * height;
          assert.ok(heel >= (seat.rest || 0) + 0.005, `${sex} h ${height} on ${seat.h}: ${side} heel at ${heel}, in the floor`);
        }
      }
    }
  }
});

test('a drink comes up to the mouth with the elbow below the shoulder', () => {
  for (const sex of ['male', 'female']) {
    const rig = residentRig(sex);
    const { P } = pose(base({ drunk: { w: 1 }, sex }));
    const fist = at(JOINT.rightWrist, gripOf(sex, 'right'));
    const mouth = [0, rig.eyeY - 0.034, rig.points[JOINT.head][2] + 0.058];
    assert.ok(dist(fist, mouth) < 0.006, `${sex}: the fist is ${dist(fist, mouth)} from the mouth`);
    const elbow = at(JOINT.rightElbow, rig.points[JOINT.rightElbow]);
    assert.ok(elbow[1] < rig.points[JOINT.rightShoulder][1] - 0.02, `${sex}: the elbow is up by the ear`);
    assert.ok(P.x[JOINT.rightElbow] < -1.5, `${sex}: the forearm is not folded`);
  }
});

test('the barrow handles are in the fists', () => {
  const grip = poses.barrowGrip(residentRig('male'));
  for (const sex of ['male', 'female']) {
    const rig = residentRig(sex);
    // armTo finds back any point the arm can reach, and the barrow's handles are one of them.
    const targets = [[-0.6, -0.3], [-0.2, -0.9], [-1.1, -0.2]].map(([sh, el]) => {
      const P = createPose();
      P.x[JOINT.rightShoulder] = sh; P.x[JOINT.rightElbow] = el;
      poseJoints(rig, P, out);
      const g = at(JOINT.rightWrist, gripOf(sex, 'right'));
      return [g[1], g[2]];
    });
    targets.push([grip.y, grip.z]);
    for (const [y, z] of targets) {
      const [shoulder, elbow] = armTo(rig, 'right', y, z);
      const P = createPose();
      P.x[JOINT.rightShoulder] = shoulder; P.x[JOINT.rightElbow] = elbow;
      poseJoints(rig, P, out);
      const g = at(JOINT.rightWrist, gripOf(sex, 'right'));
      assert.ok(Math.hypot(g[1] - y, g[2] - z) < 0.004, `${sex}: reaching (${y}, ${z}) the fist is at (${g[1]}, ${g[2]})`);
      assert.ok(elbow <= 0, `${sex}: the elbow bends backwards`);
    }
    // Reaching the handles, the fist is beside them too, not a hand's breadth inside.
    const x = Math.abs(at(JOINT.rightWrist, gripOf(sex, 'right'))[0]);
    assert.ok(Math.abs(x - grip.x) < 0.02, `${sex}: the fist is at x ${x}, the handle at ${grip.x}`);
  }
});

test('a sword swing folds the elbow at the top and strikes with it straight', () => {
  const top = pose(base({ striking: true, right: -2.3 })).P.x[JOINT.rightElbow];
  const hit = pose(base({ striking: true, right: -0.2 })).P.x[JOINT.rightElbow];
  assert.ok(top < -1, `folded only ${top} at the top`);
  assert.ok(Math.abs(hit) < 1e-9, `${hit} at the blow`);
});

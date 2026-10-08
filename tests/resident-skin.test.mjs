// The residents in the Wanderer's style, skinned per instance (Plans/inwoners-in-avonturierstijl.md,
// fase 2): the joint matrices web/js/resident-skin.js composes, the shader patch on the crowd's
// material and its depth twin, and the skinned crowd's bookkeeping - every drawn instance of every
// piece a figure wears names that figure's own pose row, however the packed batches shuffle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./support/shared-loader.mjs', import.meta.url);
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const skin = await import('../web/js/resident-skin.js');
const { createFigures, settlerLook } = await import('../web/js/settler-figures.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;
const { createPose, poseJoints, residentRig, JOINT, POSE_FLOATS, RESIDENT_JOINTS } = skin;

const apply = (m, o, j, p) => {
  const w = o + j * 12;
  return [0, 1, 2].map((r) => m[w + r * 4] * p[0] + m[w + r * 4 + 1] * p[1] + m[w + r * 4 + 2] * p[2] + m[w + r * 4 + 3]);
};
const close = (a, b, eps = 1e-5) => a.every((v, k) => Math.abs(v - b[k]) < eps);

test('the rest pose is every joint standing still', () => {
  for (const sex of ['male', 'female']) {
    const out = poseJoints(residentRig(sex), createPose(), new Float32Array(POSE_FLOATS));
    for (let j = 0; j < RESIDENT_JOINTS.length; j++) {
      const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
      assert.ok(close([...out.subarray(j * 12, j * 12 + 12)], id), `${sex} ${RESIDENT_JOINTS[j]} is not the identity`);
    }
  }
});

test('a knee bends the shin back and leaves the thigh where it was', () => {
  const rig = residentRig('male');
  const pose = createPose();
  pose.x[JOINT.leftKnee] = 1.0;
  const out = poseJoints(rig, pose, new Float32Array(POSE_FLOATS));
  const knee = rig.points[JOINT.leftKnee], ankle = rig.points[JOINT.leftAnkle];
  assert.ok(close(apply(out, 0, JOINT.leftKnee, knee), knee), 'the knee itself moved');
  assert.ok(close(apply(out, 0, JOINT.leftHip, knee), knee), 'the thigh moved with the knee');
  const a = apply(out, 0, JOINT.leftAnkle, ankle);
  assert.ok(a[2] < ankle[2] - 0.03, `the foot went ${a[2] - ankle[2]} along z, not back`);
  assert.ok(a[1] > ankle[1] + 0.02, 'the foot did not come up');
  // The shin keeps its length.
  const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  assert.ok(Math.abs(len(a, knee) - len(ankle, knee)) < 1e-5);
});

test('a big head stays on its neck, and a tall body stretches under it', () => {
  const rig = residentRig('female');
  const pose = createPose();
  pose.height = 1.1; pose.head = 1.2;
  const out = poseJoints(rig, pose, new Float32Array(POSE_FLOATS));
  const hp = rig.points[JOINT.head];
  const top = [hp[0], hp[1] + 0.05, hp[2]];
  const at = apply(out, 0, JOINT.head, top), base = apply(out, 0, JOINT.head, hp);
  assert.ok(Math.abs(base[1] - hp[1] * 1.1) < 1e-5, 'the head does not sit where the stretched neck ends');
  assert.ok(Math.abs((at[1] - base[1]) - 0.05 * 1.2) < 1e-5, 'the head is not drawn at its own size');
});

test('the skin goes into the crowd material and its shadow twin', () => {
  const base = new THREE.MeshStandardMaterial();
  base.userData.fadeDepth = new THREE.MeshDepthMaterial();
  const pose = { value: null };
  const { material, depth } = skin.skinnedMaterial(base, pose);
  assert.ok(material.customProgramCacheKey().endsWith('-skin'));
  assert.ok(depth.customProgramCacheKey().endsWith('-skin'));
  for (const [m, lib] of [[material, THREE.ShaderLib.standard], [depth, THREE.ShaderLib.depth]]) {
    const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} };
    m.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uPose, pose);
    assert.match(shader.vertexShader, /#include <begin_vertex>\n[\s\S]*transformed = \(residentSkin\(\)/);
    assert.match(shader.vertexShader, /aMask[\s\S]*aShow/);
    assert.match(shader.vertexShader, /attribute float aFigure;/);
  }
  // The source's fade flipping reaches the clone (buildings.js follows `followers`).
  assert.ok(base.userData.followers.includes(material) && base.userData.followers.includes(depth));
  // And the source can still be cloned by anybody else (a player's rig clones the crowd's
  // material), and a second crowd made from it too: userData goes through JSON in three's copy.
  assert.doesNotThrow(() => base.clone());
  assert.doesNotThrow(() => skin.skinnedMaterial(base, pose));
});

function crowd(n = 24) {
  const scene = new THREE.Scene();
  const view = createFigures(scene, new THREE.MeshBasicMaterial(), { skinned: true });
  const figures = new Map();
  const styles = ['fable', 'opus', 'sonnet', 'haiku', 'unknown'], kinds = ['adult', 'adult', 'sailor', 'apprentice'];
  for (let i = 0; i < n; i++) {
    const id = `resident:${i}`;
    const [presentation, outfit] = [['woman', 'skirt'], ['woman', 'trousers'], ['man', 'trousers']][i % 3];
    const f = { id, visible: true, pos: [i, -i], y: 0, yaw: 0, anim: i % 2 ? 'walk' : 'still', mode: 'walk', speed: 0.5 };
    const kind = kinds[i % 4];
    assert.ok(view.enrol(f, { ...settlerLook(id, styles[i % 5], kind), presentation, outfit }, kind));
    figures.set(id, f);
  }
  return { scene, view, figures };
}

function check(k, label) {
  const meshes = k.scene.children.filter((m) => m.isInstancedMesh && m.name.startsWith('resident-') && m.geometry.attributes.aFigure);
  const drawn = [...k.figures.values()].filter((f) => f.visible);
  const male = meshes.find((m) => m.name === 'resident-male-skin'), female = meshes.find((m) => m.name === 'resident-female-skin');
  assert.equal(male.count + female.count, drawn.length, `${label}: the bodies count somebody they do not draw`);
  // The pose texture, read the way the shader reads it.
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: '', uniforms: {} };
  male.material.onBeforeCompile(shader);
  const data = shader.uniforms.uPose.value.image.data;
  for (const m of meshes) {
    const figs = m.userData.bucket?.figs;
    for (let i = 0; i < m.count; i++) {
      const row = m.geometry.attributes.aFigure.array[i];
      assert.ok(row < drawn.length, `${label}: ${m.name} instance ${i} names row ${row}, past the drawn`);
      if (figs) assert.equal(figs[i].slot, row, `${label}: ${m.name} instance ${i} names somebody else's row`);
    }
  }
  // Every drawn figure's row holds its own pose: its hips where its look's build puts them.
  for (const f of drawn) {
    assert.ok(f.slot < drawn.length, `${label}: ${f.id} is drawn from an undrawn row`);
    assert.ok(Math.abs(data[f.slot * POSE_FLOATS] - f.look.build) < 1e-4, `${label}: ${f.id}'s row is not its own`);
  }
  return data;
}

test('every drawn instance names its own figure\'s pose row, however the batches shuffle', () => {
  const k = crowd();
  k.view.draw(k.figures, 0.016);
  check(k, 'all drawn');
  const all = [...k.figures.values()];
  for (const i of [0, 3, 4, 9, 17, 22]) all[i].visible = false;
  k.view.draw(k.figures, 0.016);
  check(k, 'some hidden');
  all[3].visible = true; all[22].visible = true;
  k.view.free(all[5]); k.figures.delete(all[5].id);
  k.view.draw(k.figures, 0.016);
  check(k, 'some back, one gone');
  // A walker's knees bend; somebody standing still has straight ones.
  const data = check(k, 'again');
  const row = (f, j) => [...data.subarray(f.slot * POSE_FLOATS + j * 12, f.slot * POSE_FLOATS + j * 12 + 12)];
  const walker = all.find((f) => f.visible && f.anim === 'walk' && f.slot != null);
  const still = all.find((f) => f.visible && f.anim === 'still' && f.slot != null);
  // How far a knee is bent: how far its matrix is from the thigh's above it. Standing is soft-kneed
  // (resident-poses.js KNEE_IDLE) and a stride bends a knee a good deal more, at least on one leg.
  const bent = (f, side) => {
    const k = row(f, JOINT[side + 'Knee']), h = row(f, JOINT[side + 'Hip']);
    return Math.hypot(...k.map((v, i) => v - h[i]));
  };
  const walking = Math.max(bent(walker, 'left'), bent(walker, 'right'));
  const standing = Math.max(bent(still, 'left'), bent(still, 'right'));
  assert.ok(standing < 0.1, `somebody standing still bends a knee by ${standing}`);
  assert.ok(walking > 2 * standing, `a walker's knees bend ${walking}, hardly more than standing (${standing})`);
  k.view.dispose();
});

test('a skinned crowd draws a variant per call, not a person per call', () => {
  // Three hundred, every style and kind, so every garment, hairstyle and hat the wardrobe has is
  // worn by somebody: the keeper's limit is ~40 calls a pass for the people (8 October 2026).
  const k = crowd(300);
  k.view.draw(k.figures, 0.016);
  const people = k.scene.children.filter((m) => m.isInstancedMesh && m.visible && m.count > 0 && /^resident-(male|female)-/.test(m.name));
  assert.ok(people.length <= 36, `${people.length} instanced meshes for three hundred people: ${people.map((m) => m.name).join(', ')}`);
  k.view.dispose();
  assert.equal(k.scene.children.filter((m) => m.isInstancedMesh).length, 0, 'dispose left meshes in the scene');
});

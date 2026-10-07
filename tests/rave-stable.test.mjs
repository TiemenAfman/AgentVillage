// The stable on a Saturday night (Plans/DONE/rave-in-het-kasteel.md): the paddock stands empty while
// the castle raves, because its horse and hens are on the dance floor (web/js/stable.js `away`,
// web/js/rave.js, fauna.js stepDance).
//
// The promises: nothing is left in the paddock and nothing there moves while they are out, so
// they come home to where they were; the horse dances on the music's own count - a front hoof
// down on every kick, and up on its hind legs standing on them, never through the floor; and in
// the hall it has a patch of floor to itself that the crowd gives it without losing a dancer,
// and is in the walk's way only on the nights it came.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const stub = () => { globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) }; };
stub();
const { createAnimal, createPose, stepDance, applyPose } = await import('../web/js/fauna.js');
const { attachStable, updateStable } = await import('../web/js/stable.js');
const { buildRave } = await import('../web/js/rave.js');
delete globalThis.document;

const FRAME = 1 / 60;
const FLOOR = 0.06;
const material = () => { const m = new THREE.MeshBasicMaterial(); m.userData.uniforms = { uNight: { value: 0 } }; return m; };
const rect = (x, z, hx, hz) => ({ x, z, hx, hz });

// The lowest point of each named part of an animal, in the world, as it stands now.
function lowest(a) {
  a.object.updateMatrixWorld(true);
  const out = {};
  const v = new THREE.Vector3();
  for (const j of a.joints) {
    const mesh = j.pivot.children[0];
    const p = mesh.geometry.attributes.position;
    let y = Infinity;
    // The horse is skinned since horse-rig.js: its vertices move with the bones, not the pivot.
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v);
      y = Math.min(y, v.applyMatrix4(mesh.matrixWorld).y);
    }
    out[j.name.split(' ').slice(1).join(' ')] = y;
  }
  return out;
}

test('on a Saturday night the paddock is empty, and they come home to where they left off', () => {
  stub();
  const stable = attachStable(new THREE.Scene(), [0, 0, 0], material());
  for (let i = 0; i < 5 / FRAME; i++) updateStable(stable, FRAME);
  const where = () => stable.animals.map((a) => [a.x, a.z, a.yaw, a.mood]);
  const before = where();
  for (let i = 0; i < 30 / FRAME; i++) updateStable(stable, FRAME, { away: true });
  assert.equal(stable.root.visible, false, 'the horse and hens are still in the paddock during the rave');
  assert.deepEqual(where(), before, 'somebody moved in an empty paddock');
  updateStable(stable, FRAME);
  assert.equal(stable.root.visible, true, 'nobody came home at three');
  delete globalThis.document;
});

test('the horse dances on the beat, and up on its hind legs it stands on them', () => {
  stub();
  const horse = createAnimal('horse', material(), { area: { x: 0, z: 0, r: 0 }, seed: 'rave:horse' });
  const dance = (beat, up, dt) => { stepDance('horse', horse.pose, { beat, up }, dt); applyPose(horse, 0, 0, 0); return lowest(horse); };
  // Standing: on every kick both front hooves are down, and in between one of them is up.
  for (let beat = 0; beat < 8; beat += 1) {
    const on = dance(beat, false, FRAME);
    for (const leg of ['leg fl', 'leg fr']) assert.ok(Math.abs(on[leg]) < 0.01, `${leg} not down on beat ${beat}: ${on[leg].toFixed(3)}`);
    const off = dance(beat + 0.5, false, FRAME);
    assert.ok(Math.max(off['leg fl'], off['leg fr']) > 0.02, `no hoof up between beats ${beat} and ${beat + 1}`);
  }
  // Going up, coming down and everything between: nothing ever goes through the floor, and
  // once it is up it is on its hind hooves with both front ones in the air.
  let beat = 8;
  for (const up of [true, false, true]) {
    for (let i = 0; i < 2 / FRAME; i++, beat += FRAME * 2.2) {
      const low = dance(beat, up, FRAME);
      for (const [part, y] of Object.entries(low)) assert.ok(y > -0.012, `${part} ${y.toFixed(3)} through the floor at beat ${beat.toFixed(2)}`);
    }
    const low = lowest(horse);
    if (up) {
      for (const leg of ['leg bl', 'leg br']) assert.ok(Math.abs(low[leg]) < 0.012, `reared, ${leg} is at ${low[leg].toFixed(3)}, not on the floor`);
      for (const leg of ['leg fl', 'leg fr']) assert.ok(low[leg] > 0.05, `reared, ${leg} is still on the floor`);
    }
  }
  delete globalThis.document;
});

test('a dance keeps no clock: the same count is the same pose', () => {
  const go = (kind) => {
    const pose = createPose(kind);
    for (let i = 0; i < 400; i++) stepDance(kind, pose, { beat: i * 0.037, up: i > 200 && i < 300 }, FRAME);
    return JSON.stringify(pose);
  };
  for (const kind of ['horse', 'chicken']) assert.equal(go(kind), go(kind), kind);
});

test('in the hall the horse has room, the floor is as full as ever, and it is in the way only when it came', () => {
  stub();
  const def = buildRave({ FLOOR, rect });
  const scene = new THREE.Scene();
  const mat = material();
  const show = def.show({ scene, material: mat });
  const herdOf = () => scene.children.filter((o) => o.isGroup);
  const guests = Array.from({ length: 40 }, (_, i) => ({ id: `house:${i}`, style: 'opus' }));
  // Now and then a dancer has a drink (Math.random), and a pint is one more part to count.
  const random = Math.random;
  Math.random = () => 1;

  // Without a stable the hall is the hall it was: nobody from a paddock, nothing in the way.
  show.enter({ dancers: guests });
  show.update(FRAME, {}, null);
  assert.equal(herdOf().filter((o) => o.visible).length, 0, 'a horse came from an island with no stable');
  assert.deepEqual(show.blockers(), []);

  show.enter({ dancers: guests, stable: true });
  for (let i = 0; i < 60; i++) show.update(FRAME, {}, null);
  const herd = herdOf();
  assert.equal(herd.filter((o) => o.visible).length, 3, 'the horse and its two hens are not all on the floor');
  const [horse] = herd;
  const blocks = show.blockers();
  assert.ok(blocks.length >= 3, 'the horse is not in the way');
  assert.ok(blocks.some((b) => Math.hypot(b.x - horse.position.x, b.z - horse.position.z) < 0.2), 'the horse is in the way somewhere it is not');
  // Nobody dances inside the horse or on a hen: every part of every figure the crowd draws
  // (settler-figures.js's batches, which are the only instanced meshes on the building
  // material) stands clear of the three of them.
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  const parts = (count) => {
    let n = 0;
    scene.traverse((o) => {
      if (!o.isInstancedMesh || o.material !== mat) return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        if (Math.abs(m.determinant()) < 1e-9) continue;          // a slot drawn as nothing
        v.setFromMatrixPosition(m);
        if (count) { n++; continue; }
        for (const b of blocks) {
          assert.ok(Math.hypot(v.x - b.x, v.z - b.z) > b.r + 0.08, `somebody dances at ${v.x.toFixed(2)},${v.z.toFixed(2)}, in the horse's way`);
        }
      }
    });
    return n;
  };
  const withHorse = parts(true);
  assert.ok(withHorse > 200, `found only ${withHorse} parts of people on the floor to check`);
  parts(false);
  // As full as without it: the spots the horse takes go to whoever was next in line.
  show.enter({ dancers: guests });
  for (let i = 0; i < 3; i++) show.update(FRAME, {}, null);
  assert.equal(parts(true), withHorse, 'the horse cost the floor dancers');
  Math.random = random;
  show.dispose();
  delete globalThis.document;
});

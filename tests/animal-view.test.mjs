// The story animals as the page draws them (web/js/animal-view.js, web/js/fauna.js's pose;
// Plans/dierenverhalen.md, docs/animals-wire.md).
//
// The promises: every act the sea can say has a pose, and the ones that mean something
// different look different; the demo's own animals move through that same pose; all the
// animals of every island are one fixed set of instanced meshes, so twelve cost what one
// costs; a row lands where the contract says, in the island's own frame plus its berth;
// nobody is drawn before the sea has said where they are, nor while the chronicle is
// scrubbed back; a retired animal's slot is the next one's; and a ray names the animal it hit,
// on the island it stands on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

// fauna.js reaches buildings.js, which builds a TextureLoader the moment it loads.
const stub = () => { globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) }; };
stub();
const { createPose, stepPose, createAnimal, KINDS, animalParts, assetsOf } = await import('../web/js/fauna.js');
const { createAnimalBatch, createAnimalView, drawCalls, ANIMAL_CAPACITY } = await import('../web/js/animal-view.js');
const { ACTS, ACT_OF, MOTION, STORY_SPECIES } = await import('shared/animals.mjs');
delete globalThis.document;

const FRAME = 1 / 60;
const GRID = 32;
const material = () => { const m = new THREE.MeshBasicMaterial(); m.userData.uniforms = { uNight: { value: 0 } }; return m; };

// Everything a pose writes, as one flat list of numbers.
const fields = (p) => [p.headX, p.headY, p.tailX, p.tailZ, ...p.legs, ...p.wingY, ...p.wingZ, p.bodyY, p.bodyX, p.bodyZ, p.surge, p.flying ? 1 : 0];
// A few seconds of one act, summed up per field as its mean and its spread.
function run(kind, act, { moving = false, speed = 0, seconds = 3 } = {}) {
  const pose = createPose(kind);
  const lo = [], hi = [], sum = [];
  let n = 0;
  for (let i = 0; i < seconds / FRAME; i++) {
    stepPose(kind, pose, { act, moving, speed }, FRAME);
    const f = fields(pose);
    f.forEach((v, k) => {
      assert.ok(Number.isFinite(v), `${kind} ${act}: field ${k} is ${v}`);
      lo[k] = Math.min(lo[k] ?? v, v); hi[k] = Math.max(hi[k] ?? v, v); sum[k] = (sum[k] || 0) + v;
    });
    n++;
  }
  return { pose, stats: sum.map((s, k) => [s / n, hi[k] - lo[k]]).flat() };
}
const differs = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > 1e-3);
const TRAVEL = new Set(['walk', 'fly', 'hop', 'steal']);
const inputFor = (kind, act) => (TRAVEL.has(act) && act !== 'hop' ? { moving: true, speed: (MOTION[kind] || KINDS[kind]).walk } : {});

test('every act the sea can say has a pose, and the ones that mean something else look it', () => {
  for (const kind of STORY_SPECIES) {
    const still = run(kind, 'still').stats;
    for (const act of ACTS) {
      if (act === 'still') continue;
      const { stats } = run(kind, act, inputFor(kind, act));
      assert.ok(differs(stats, still), `a ${kind} doing '${act}' looks like one standing still`);
    }
    // A word it has never heard of is standing still, and so is a walk that goes nowhere.
    assert.deepEqual(run(kind, 'juggle').stats, still, `${kind}: an unknown act is not 'still'`);
    assert.deepEqual(run(kind, 'walk').stats, still, `${kind}: a walk on the spot is not standing`);
  }
  // And every other kind the demo keeps survives every act without a number going bad.
  for (const kind of Object.keys(KINDS)) for (const act of ACTS) run(kind, act, { ...inputFor(kind, act), seconds: 1 });
});

test('the poses say what they mean: lying down, a butt, dust, scratching, the wing', () => {
  const rest = run('goat', 'rest').pose;
  assert.ok(rest.bodyY < -0.04, `a resting goat stays up at ${rest.bodyY.toFixed(3)}`);
  assert.ok(rest.legs[0] > 1 && rest.legs[3] < -1, 'a resting goat has not folded its legs');
  const hen = run('chicken', 'rest').pose;
  assert.ok(hen.bodyY < -0.025 && hen.legs.every((l) => l > 0.9), 'a resting hen is still standing');

  // A butt lunges forward along the goat's facing, in jabs, head down.
  const butt = createPose('goat');
  let far = 0, back = Infinity;
  for (let i = 0; i < 3 / FRAME; i++) {
    stepPose('goat', butt, { act: 'butt' }, FRAME);
    far = Math.max(far, butt.surge); back = Math.min(back, butt.surge);
    // Once the head has come down - it eases there, like every change of act.
    if (i * FRAME > 0.3) assert.ok(butt.headX > 0.3, `a butt with the head up (${butt.headX.toFixed(2)})`);
  }
  assert.ok(far > 0.03 && back < 0.005, `a butt that does not jab (${back.toFixed(3)}..${far.toFixed(3)})`);

  // A hen in the dust is down and fluttering; scratching kicks back one foot, then the other.
  const dust = run('chicken', 'dust').pose;
  assert.ok(dust.bodyY < -0.015 && Math.abs(dust.wingZ[0]) > 0.2, 'a dust bath without the dust');
  const scratch = createPose('chicken');
  const kicked = [0, 0];
  let both = false;
  for (let i = 0; i < 2 / FRAME; i++) {
    stepPose('chicken', scratch, { act: 'scratch' }, FRAME);
    kicked[0] = Math.max(kicked[0], scratch.legs[0]); kicked[1] = Math.max(kicked[1], scratch.legs[1]);
    if (scratch.legs[0] > 0.4 && scratch.legs[1] > 0.4) both = true;
  }
  assert.ok(kicked[0] > 0.5 && kicked[1] > 0.5 && !both, 'a scratch is not one foot and then the other');

  // The sparrow's two models: on the wing for a flight or anything that fast, sitting for the
  // rest - perched, singing, hopping along.
  assert.equal(run('sparrow', 'fly', { moving: true, speed: 1.1 }).pose.flying, true);
  assert.equal(run('sparrow', 'walk', { moving: true, speed: 1.1 }).pose.flying, true, 'a sparrow crossing at a hurry hops');
  for (const act of ['perch', 'chirp', 'hop', 'peck', 'still']) assert.equal(run('sparrow', act).pose.flying, false, act);
  const chirp = run('sparrow', 'chirp').pose;
  assert.ok(chirp.headX < -0.2, 'a sparrow singing with its head down');
});

test('the demo animals are drawn through the same pose', () => {
  stub();
  for (const kind of ['chicken', 'goat', 'sheep', 'sparrow']) {
    const a = createAnimal(kind, material(), { area: { x: 0, z: 0, r: 0.5 }, seed: `pose:${kind}` });
    for (let i = 0; i < 5 / FRAME; i++) a.update(FRAME);
    if (a.head) assert.equal(a.head.rotation.x, a.pose.headX, `${kind}: the head is not the pose's`);
    (a.legs || []).forEach((leg, i) => leg && assert.equal(leg.rotation.x, a.pose.legs[i], `${kind}: leg ${i}`));
    assert.equal(a.object.rotation.z, a.pose.bodyZ);
    a.dispose();
  }
  delete globalThis.document;
});

// ---- the view -------------------------------------------------------------------------------
function world() {
  stub();
  const scene = new THREE.Scene();
  const batch = createAnimalBatch(scene, material());
  delete globalThis.document;
  return { scene, batch, instanced: () => scene.children.filter((c) => c.isInstancedMesh).length };
}
const regionAt = (id, origin, half = 32) => ({ id, origin, half });
const animal = (n, species = 'chicken') => ({ id: `animal:${n}`, species, name: `Pip ${n}`, traits: ['bold'], home: [0, 0], r: 0.9, about: null, friends: [] });
// One row as docs/animals-wire.md spells it, from island-local numbers.
const row = (idx, x, z, act = 'still', h = 0, fx = 0, fz = 0, half = 32) =>
  [idx, Math.round((x + half) * GRID), Math.round((z + half) * GRID), ACT_OF.get(act), Math.round(h * GRID), fx, fz];
const where = (mesh, slot) => {
  const m = new THREE.Matrix4(); mesh.getMatrixAt(slot, m);
  return new THREE.Vector3().setFromMatrixPosition(m);
};
const bodyMesh = (batch, species, asset = assetsOf(species)[0]) =>
  batch.kinds.get(species).models.find((m) => m.asset === asset).parts.find((p) => p.role === 'body').mesh;

test('one batch of meshes for every animal on every island: twelve cost what one does', () => {
  const { batch, instanced } = world();
  const parts = (sp) => assetsOf(sp).reduce((n, a) => n + animalParts(a).length, 0);
  const all = STORY_SPECIES.reduce((n, sp) => n + parts(sp), 0);
  assert.equal(instanced(), all, 'the batch is not one InstancedMesh per part');
  assert.equal(all, 18, 'the three species are 18 parts: chicken 6, goat 7, sparrow 2 + 3');
  assert.equal(drawCalls(batch), 0, 'an empty batch draws');

  const regions = [regionAt('a', [0, 0]), regionAt('b', [176, 0]), regionAt('c', [-176, 40])];
  const views = regions.map((region) => createAnimalView({ batch, region }));
  const place = (list) => views.forEach((v, r) => {
    v.herd({ seq: 1 + r, animals: list(r), traces: [] });
    v.apply(v.animals().flatMap((_, i) => row(i, i * 0.5, -i * 0.5)), 1000);
    v.draw(FRAME, () => 0, 2000);
  });

  place((r) => (r === 0 ? [animal(1)] : []));
  const one = drawCalls(batch);
  assert.equal(one, parts('chicken'), 'one hen is not one draw call per hen part');
  place(() => [1, 2, 3, 4].map((n) => animal(n)));
  assert.equal(views.reduce((n, v) => n + v.count(), 0), 12);
  assert.equal(drawCalls(batch), one, 'twelve hens on three islands cost more than one');
  assert.equal(instanced(), all, 'more hens made more meshes');

  // Three species, sitting: every part of each, the flying sparrow's three still off the bill.
  place(() => [animal(1), animal(2), animal(3, 'goat'), animal(4, 'sparrow')]);
  assert.equal(drawCalls(batch), parts('chicken') + parts('goat') + animalParts('fauna_sparrow').length);
  // One sparrow up, and the whole batch is drawn: never more than there are parts.
  views[1].apply(row(3, 1, 1, 'fly', 0.4), 3000);
  views[1].draw(FRAME, () => 0, 4000);
  assert.equal(drawCalls(batch), all);
  assert.equal(instanced(), all);
  batch.dispose();
  assert.equal(instanced(), 0, 'disposing the batch left meshes in the scene');
});

test('a row lands in the island\'s own frame, plus its berth, and faces its hint', () => {
  const { batch } = world();
  const view = createAnimalView({ batch, region: regionAt('far', [120, -80], 32) });
  view.herd({ seq: 5, animals: [animal(1), animal(2, 'goat')], traces: [{ id: 'trace:nest:animal:1', kind: 'nest', x: 1, z: 2, rot: 0, name: 'n', at: 1 }] });
  assert.equal(view.traces().length, 1);
  view.apply([...row(0, 3.5, -2.25, 'peck', 0, 16, 0), ...row(1, -10, 7.5, 'watch', 0, 0, -16)], 1000);
  view.draw(FRAME, () => 0.5, 1700);
  const hen = view.animal('animal:1'), goat = view.animal('animal:2');
  assert.ok(Math.abs(hen.pos[0] - 123.5) < 1 / GRID && Math.abs(hen.pos[1] + 82.25) < 1 / GRID, `the hen is at ${hen.pos}`);
  assert.ok(Math.abs(goat.pos[0] - 110) < 1 / GRID && Math.abs(goat.pos[1] + 72.5) < 1 / GRID, `the goat is at ${goat.pos}`);
  assert.equal(hen.y, 0.5, 'not on her ground');
  assert.equal(hen.act, 'peck');
  assert.equal(hen.island, 'far');
  // The hint is a direction: +x is a quarter turn, -z is half a turn.
  assert.ok(Math.abs(hen.yaw - Math.PI / 2) < 1e-6, `the hen faces ${hen.yaw}`);
  assert.ok(Math.abs(Math.abs(goat.yaw) - Math.PI) < 1e-6, `the goat faces ${goat.yaw}`);
  // And the body part is drawn there: the batch's matrix, not only the record.
  const p = where(bodyMesh(batch, 'chicken'), batch.kinds.get('chicken').owners.findIndex((o) => o && o.rec === hen));
  assert.ok(Math.abs(p.x - 123.5) < 0.05 && Math.abs(p.z + 82.25) < 0.05 && Math.abs(p.y - 0.5) < 0.05, `the hen is drawn at ${p.toArray()}`);
});

test('a walk glides straight on, never backwards, from where it was drawn', () => {
  const { batch } = world();
  const view = createAnimalView({ batch, region: regionAt('home', [0, 0]) });
  view.herd({ seq: 1, animals: [animal(1)], traces: [] });
  let x = 0, drawn = -Infinity, now = 0;
  for (let msg = 0; msg < 20; msg++) {
    view.apply(row(0, x, 0, 'walk', 0, 16, 0), now);
    for (let f = 0; f < 12; f++) {
      now += 1000 / 60;
      view.draw(FRAME, () => 0, now);
      const at = view.animal('animal:1').pos[0];
      assert.ok(at >= drawn - 1e-9, `stepped back from ${drawn} to ${at}`);
      drawn = at;
    }
    x += 0.3 * 0.2;
  }
  assert.ok(drawn > 0.9, `a hen that should have walked a metre got to ${drawn}`);
  // A word further than anybody walks is where she is: no streak across the island.
  view.apply(row(0, 20, 0, 'still'), now);
  view.draw(FRAME, () => 0, now + 1);
  assert.equal(Math.round(view.animal('animal:1').pos[0]), 20);
});

test('nobody is drawn before the sea has said where they are, nor while the chronicle is back', () => {
  const { batch } = world();
  const view = createAnimalView({ batch, region: regionAt('home', [0, 0]) });
  view.herd({ seq: 1, animals: [animal(1), animal(2, 'goat')], traces: [] });
  view.draw(FRAME, () => 0, 1000);
  assert.equal(drawCalls(batch), 0, 'somebody was drawn before a word about them');
  assert.ok(view.animals().every((a) => !a.visible));
  assert.ok(where(bodyMesh(batch, 'chicken'), 0).y < -900, 'the slot is not parked out of sight');

  view.apply(row(0, 1, 1), 1000);
  view.draw(FRAME, () => 0, 1100);
  assert.equal(view.animal('animal:1').visible, true);
  assert.equal(view.animal('animal:2').visible, false, 'the goat nobody has placed yet is drawn');

  view.apply(row(1, 2, 2, 'nibble'), 1200);
  view.draw(FRAME, () => 0, 1300, false);
  assert.equal(drawCalls(batch), 0, 'showing=false left something drawn');
  assert.ok(view.animals().every((a) => !a.visible));
  // Still told where they are meanwhile, so coming back to Live puts them there.
  view.apply(row(1, 3, 3, 'nibble'), 1400);
  view.draw(FRAME, () => 0, 2400, false);
  view.draw(FRAME, () => 0, 2500, true);
  assert.ok(view.animals().every((a) => a.visible));
  assert.ok(Math.abs(view.animal('animal:2').pos[0] - 3) < 1e-6);

  // A filter takes one out of sight and keeps it in the herd.
  view.setVisible('animal:1', false);
  view.draw(FRAME, () => 0, 2600);
  assert.equal(view.animal('animal:1').visible, false);
  assert.equal(view.animal('animal:2').visible, true);
});

test('a retired animal gives its slot back, and the next one takes it', () => {
  const { batch } = world();
  const view = createAnimalView({ batch, region: regionAt('home', [0, 0]) });
  const owners = () => batch.kinds.get('chicken').owners.map((o) => (o ? o.rec.id : null)).slice(0, 3);
  const hens = () => bodyMesh(batch, 'chicken').count;
  view.herd({ seq: 1, animals: [animal(1), animal(2)], traces: [] });
  assert.deepEqual(owners(), ['animal:1', 'animal:2', null]);
  const two = view.animal('animal:2');
  view.herd({ seq: 2, animals: [animal(2)], traces: [] });
  assert.deepEqual(owners(), [null, 'animal:2', null]);
  assert.equal(view.animal('animal:2'), two, 'an animal that stayed was enrolled again');
  view.herd({ seq: 3, animals: [animal(2), animal(3)], traces: [] });
  assert.deepEqual(owners(), ['animal:3', 'animal:2', null], 'the newcomer did not take the free slot');
  assert.equal(hens(), 2);

  // An older herd overtaken by a newer one is ignored; the sweep's empty one at 0 is not.
  assert.equal(view.herd({ seq: 2, animals: [animal(9)], traces: [] }), false);
  assert.equal(view.count(), 2);
  assert.equal(view.herd({ seq: 0, animals: [], traces: [] }), true);
  assert.equal(view.count(), 0);
  assert.equal(hens(), 0, 'an island swept away still holds slots');

  // A second island's animal:1 is another animal, in another slot.
  const there = createAnimalView({ batch, region: regionAt('there', [176, 0]) });
  view.herd({ seq: 4, animals: [animal(1)], traces: [] });
  there.herd({ seq: 1, animals: [animal(1)], traces: [] });
  assert.equal(hens(), 2);
  assert.notEqual(view.animal('animal:1'), there.animal('animal:1'));
  there.dispose();
  assert.equal(hens(), 1);
  assert.equal(batch.kinds.get('chicken').owners.filter(Boolean).length, 1);
  assert.ok(ANIMAL_CAPACITY >= 64);
});

test('a ray names the animal it hit, on the island it stands on', () => {
  const { scene, batch } = world();
  const home = createAnimalView({ batch, region: regionAt('home', [0, 0]) });
  const guest = createAnimalView({ batch, region: regionAt('guest', [176, 0]) });
  home.herd({ seq: 1, animals: [animal(1, 'goat'), animal(2, 'sparrow')], traces: [] });
  guest.herd({ seq: 1, animals: [animal(1, 'goat')], traces: [] });
  home.apply([...row(0, 2, 3, 'watch'), ...row(1, -4, 1, 'perch')], 1000);
  guest.apply(row(0, -1, 5, 'nibble'), 1000);
  home.draw(FRAME, () => 0, 1500);
  guest.draw(FRAME, () => 0, 1500);
  scene.updateMatrixWorld(true);

  const ray = new THREE.Raycaster();
  const down = (x, z) => {
    ray.set(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
    return ray.intersectObjects(batch.pickables(), false)[0] || null;
  };
  const hit = down(175, 5);
  assert.ok(hit, 'the guest goat was not hit');
  assert.equal(guest.animalAt(hit.object, hit.instanceId)?.id, 'animal:1');
  assert.equal(guest.animalAt(hit.object, hit.instanceId).island, 'guest');
  assert.equal(home.animalAt(hit.object, hit.instanceId), null, 'our view named a neighbour\'s goat');
  assert.equal(batch.animalAt(hit.object, hit.instanceId).island, 'guest');
  const ours = down(2, 3);
  assert.equal(home.animalAt(ours.object, ours.instanceId)?.island, 'home');
  assert.equal(down(10, 10), null, 'a ray through nothing hit something');

  // A sparrow is too small to hit by its triangles, and is found by arithmetic.
  const o = new THREE.Vector3(-4, 3, 1 + 3), d = new THREE.Vector3(0, -3, -3).normalize();
  assert.equal(home.animalOnRay(o, d)?.animal.id, 'animal:2');
  assert.equal(home.animalOnRay(new THREE.Vector3(9, 3, 9), d), null);
  // Out of sight is out of reach.
  home.draw(FRAME, () => 0, 1600, false);
  assert.equal(home.animalAt(ours.object, ours.instanceId), null);
  assert.equal(home.animalOnRay(o, d), null);
});

test('a percher is lifted onto the roof under it, and a flyer never under the water', () => {
  const { batch } = world();
  const roofs = [];
  const view = createAnimalView({ batch, region: regionAt('home', [0, 0]), perchAt: (x, z) => { roofs.push([x, z]); return 0.8; } });
  view.herd({ seq: 1, animals: [animal(1, 'sparrow')], traces: [] });
  view.apply(row(0, 1, 1, 'perch'), 1000);
  let now = 1000;
  view.draw(FRAME, () => 0.1, now);
  const bird = view.animal('animal:1');
  assert.ok(Math.abs(bird.y - 0.8) < 1e-6, `a sparrow that has just been seen perching is at ${bird.y}`);
  for (let i = 0; i < 60; i++) view.draw(FRAME, () => 0.1, now += 16);
  assert.equal(roofs.length, 1, 'the roof was asked for on every frame of a bird sitting still');
  // Off the roof and away: back down to the ground, eased.
  view.apply(row(0, 1, 1, 'still'), now);
  view.draw(FRAME, () => 0.1, now += 16);
  assert.ok(bird.y > 0.5, 'dropped off the roof in one frame');
  for (let i = 0; i < 120; i++) view.draw(FRAME, () => 0.1, now += 16);
  assert.ok(Math.abs(bird.y - 0.1) < 0.01, `still up at ${bird.y}`);
  // Flying over a bay, the bed of it is not where she is drawn from.
  view.apply(row(0, 2, 1, 'fly', 0.3), now);
  view.draw(FRAME, () => -2, now += 300);
  assert.ok(bird.y > 0, `a sparrow flying under the sea at ${bird.y}`);
});

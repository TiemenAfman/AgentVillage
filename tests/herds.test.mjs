// The island's ambient animals (web/js/herds.js; Plans/stal-en-veld.md, "Later").
//
// The promises: the same island keeps the same animals in the same places on every page, and
// a hut built somewhere else moves nobody; every animal keeps to its patch - a sheep to its
// field, a hen to the front of its hut, a duck to the water, a gull to the air over its quay -
// and is drawn where it stands on its island's own berth; what they cost to draw is a number
// per species present, the same for one animal as for forty and for one island as for four;
// nobody is drawn while the chronicle is scrubbed back, nor far from the eye; a re-plan keeps
// whoever's place did not change; the volcano has none; and disposing gives everything back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

// fauna.js reaches buildings.js, which builds a TextureLoader the moment it loads.
const stub = () => { globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) }; };
stub();
const { createHerds, planAmbient, AMBIENT_SPECIES, MAX_PER_ISLAND, SHARE, FAR } = await import('../web/js/herds.js');
const { createAnimal, createBrain, stepBrain, animalParts, assetsOf } = await import('../web/js/fauna.js');
const { drawCalls } = await import('../web/js/animal-view.js');
const { makeTerrain, SEA_LEVEL } = await import('../shared/terrain.mjs');
const { quaysOf } = await import('shared/quay.mjs');
delete globalThis.document;

const FRAME = 1 / 30;
const SIZE = 64;
const SEED = 8;
const material = () => { const m = new THREE.MeshBasicMaterial(); m.userData.uniforms = { uNight: { value: 0 } }; return m; };
const partsOf = (kind) => assetsOf(kind).reduce((n, a) => n + animalParts(a).length, 0);

// An island with a bit of everything: fields laid on dry ground on a lattice, four hamlets to
// work them, a dozen huts facing every way, and a landing, so shared/quay.mjs gives it a quay.
function island(seed = SEED, { extraHut = null } = {}) {
  const terrain = makeTerrain(seed, { size: SIZE });
  const half = terrain.half;
  const dry = (gx, gz, w, d) => {
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (!terrain.isLand(gx + x, gz + z) || terrain.isBeach(gx + x, gz + z)) return false;
    return true;
  };
  const fields = [];
  for (let gz = 4; gz < SIZE - 8; gz += 6) for (let gx = 4; gx < SIZE - 8; gx += 6) if (dry(gx, gz, 4, 3)) fields.push([gx, gz, 4, 3]);
  const buildings = [];
  let n = 0;
  for (let gz = 7; gz < SIZE - 8 && n < 12; gz += 6) {
    for (let gx = 9; gx < SIZE - 8 && n < 12; gx += 12) {
      if (!dry(gx - 1, gz - 1, 5, 5)) continue;
      buildings.push({ id: `house:h${n}`, kind: 'house', tier: 'hut', plot: { gx, gz, w: 3, d: 3, rot: n % 4 } });
      n++;
    }
  }
  if (extraHut) buildings.push(extraHut);
  const q = SIZE / 4;
  const village = {
    island: { seed, landing: [half, half] },
    districts: [[q, q], [3 * q, q], [q, 3 * q], [3 * q, 3 * q]].map((center, i) => ({ id: `d${i}`, center })),
    buildings,
  };
  return { terrain, village, fields };
}
const regionOf = (it, origin = [0, 0], id = 'home') => ({ id, origin, half: it.terrain.half, terrain: it.terrain, village: it.village });
// Local position -> the cell it is over.
const cellOf = (terrain, x, z) => [Math.floor(x + terrain.half), Math.floor(z + terrain.half)];
const insideRect = (a, x, z, eps = 1e-6) => x >= a.x0 - eps && x <= a.x1 + eps && z >= a.z0 - eps && z <= a.z1 + eps;

test('the same island keeps the same animals in the same places', () => {
  const a = island(), b = island();
  const plan = planAmbient(a);
  assert.deepEqual(planAmbient(b), plan, 'the same village planned twice came out different');
  // Something of every kind, on an island that has every kind of place - and never more
  // than the cap.
  const kinds = new Set(plan.map((e) => e.kind));
  assert.deepEqual([...kinds].sort(), [...AMBIENT_SPECIES].sort(), `only ${[...kinds]}`);
  assert.ok(plan.length <= MAX_PER_ISLAND && plan.length > 12, `${plan.length} animals`);
  assert.equal(new Set(plan.map((e) => e.id)).size, plan.length, 'two animals under one id');
  assert.ok(plan.filter((e) => e.kind === 'sheep' || e.kind === 'cow').length <= SHARE.pasture);
  assert.ok(plan.filter((e) => e.kind === 'gull').length <= SHARE.quay);
  // Another seed is another island.
  assert.notDeepEqual(planAmbient(island(SEED + 1)), plan);
  // A hut built somewhere else moves nobody but, at most, the hens.
  const later = island(SEED, { extraHut: { id: 'house:new', kind: 'house', tier: 'hut', plot: { gx: 30, gz: 30, w: 3, d: 3, rot: 2 } } });
  const notHens = (p) => p.filter((e) => e.kind !== 'chicken');
  assert.deepEqual(notHens(planAmbient(later)), notHens(plan));
  // The house's id is not what decides: a visitor sees it redacted, and must see the same hens.
  const redacted = island();
  redacted.village.buildings = redacted.village.buildings.map((h, i) => ({ ...h, id: `house:s${i}` }));
  assert.deepEqual(planAmbient(redacted), plan);
  // And the fields come from the bundle when nobody hands them over: a neighbour's are the
  // survey their own keeper's page posted.
  const bundle = island();
  bundle.village.work = { fields: bundle.fields };
  assert.deepEqual(planAmbient({ terrain: bundle.terrain, village: bundle.village }), plan);
});

test('nothing grazes the volcano, and an island with no village has no animals', () => {
  const terrain = makeTerrain('volcano', { size: 192, volcano: true });
  assert.deepEqual(planAmbient({ terrain, village: { island: { volcano: true, landing: [96, 96] }, districts: [], buildings: [] }, fields: [] }), []);
  assert.deepEqual(planAmbient({ terrain: makeTerrain(SEED, { size: SIZE }), village: null }), []);
});

test('the herd walks the same brain the demo does', () => {
  // createAnimal is createBrain with pivots hung on it: the same seed walks the same field.
  const area = { x: 1, z: -2, r: 1.5 };
  const ground = (x, z) => 0.1 * x;
  for (const kind of ['sheep', 'cow', 'chicken', 'duck', 'gull']) {
    const drawn = createAnimal(kind, material(), { area, seed: `same:${kind}`, ground });
    const brain = createBrain(kind, { area, seed: `same:${kind}`, ground });
    stepBrain(brain, 0);
    for (let i = 0; i < 600; i++) {
      drawn.update(FRAME);
      stepBrain(brain, FRAME);
      assert.equal(brain.x, drawn.x, `${kind} parted at frame ${i}`);
      assert.equal(brain.z, drawn.z);
      assert.equal(brain.yaw, drawn.yaw);
    }
    drawn.dispose();
  }
});

test('every animal keeps to its patch, and is drawn where it stands on its own berth', () => {
  const it = island();
  const scene = new THREE.Scene();
  const herds = createHerds({ scene, material: material() });
  const origin = [120, -40];
  const herd = herds.forIsland({ region: regionOf(it, origin, 'guest'), fields: it.fields });
  const { terrain } = it;
  const quays = quaysOf(terrain, it.village, it.village.island.landing);
  const fieldCells = new Set();
  for (const [gx, gz, w, d] of it.fields) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) fieldCells.add(`${gx + x},${gz + z}`);
  const moved = new Map();
  for (let f = 0; f < 60 / FRAME; f++) {
    herd.update(FRAME);
    if (f % 15) continue;
    for (const a of herd.animals()) {
      const [gx, gz] = cellOf(terrain, a.x, a.z);
      if (a.kind === 'sheep' || a.kind === 'cow') {
        assert.ok(insideRect(a.area, a.x, a.z), `${a.id} left its field`);
        assert.ok(fieldCells.has(`${gx},${gz}`), `${a.id} is grazing off the field, at ${gx},${gz}`);
        assert.ok(Math.abs(a.y - terrain.worldHeight(a.x, a.z)) < 1e-9, `${a.id} is not on the ground`);
      } else if (a.kind === 'chicken') {
        assert.ok(insideRect(a.area, a.x, a.z), `${a.id} wandered off from its hut`);
        assert.ok(terrain.isLand(gx, gz), `${a.id} is scratching in the water`);
      } else if (a.kind === 'duck') {
        assert.ok(terrain.worldHeight(a.x, a.z) < SEA_LEVEL, `${a.id} is paddling on dry land at ${gx},${gz}`);
        assert.equal(a.y, SEA_LEVEL, `${a.id} is not on the surface`);
        assert.ok(Math.hypot(a.x - a.area.x, a.z - a.area.z) <= a.area.r + 1e-6, `${a.id} drifted off its spot`);
      } else if (a.kind === 'gull') {
        const q = quays.find((qq) => Math.hypot(a.area.x - qq.head[0], a.area.z - qq.head[1]) < 1.5);
        assert.ok(q, `${a.id} circles no quay`);
        assert.ok(Math.hypot(a.x - q.head[0], a.z - q.head[1]) <= a.area.r + 1, `${a.id} is not over its quay`);
        assert.ok(a.y > Math.max(SEA_LEVEL, terrain.worldHeight(a.x, a.z)) + 1, `${a.id} is not in the air`);
      }
      const was = moved.get(a.id);
      if (!was) moved.set(a.id, { x: a.x, z: a.z, far: 0 });
      else was.far = Math.max(was.far, Math.hypot(a.x - was.x, a.z - was.z));
    }
  }
  // They do go about their business - a minute is long enough for everybody to have moved.
  const still = [...moved].filter(([, m]) => m.far < 0.01).map(([id]) => id);
  assert.ok(still.length <= moved.size / 4, `${still.length} of ${moved.size} never moved: ${still.slice(0, 5)}`);

  // Drawn on the berth: every body part's instance sits over its animal's local position
  // plus the island's origin (the body's `at` is its origin, so its matrix is the animal's).
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  for (const a of herd.animals()) {
    const body = herds.batch.meshes.find((mesh) => mesh.userData.animalPart.species === a.kind && mesh.userData.animalPart.role === 'body');
    const slot = herds.batch.kinds.get(a.kind).owners.findIndex((o) => o && o.id === a.id);
    body.getMatrixAt(slot, m);
    v.setFromMatrixPosition(m);
    assert.ok(Math.hypot(v.x - (a.x + origin[0]), v.z - (a.z + origin[1])) < 0.1, `${a.id} is drawn at ${v.x},${v.z}`);
  }
  herds.dispose();
});

test('what they cost to draw is a number per species, not per animal or per island', () => {
  const it = island();
  const plan = planAmbient(it);
  const scene = new THREE.Scene();
  const herds = createHerds({ scene, material: material() });
  // One animal at a time, up to the whole island: the bill is the parts of the species on
  // it and nothing else - the same for the fortieth sheep as for the first.
  const bill = [];
  for (let max = 1; max <= plan.length; max++) {
    const herd = herds.forIsland({ region: regionOf(it), fields: it.fields, max });
    herd.update(FRAME);
    const kinds = new Set(plan.slice(0, max).map((e) => e.kind));
    const want = [...kinds].reduce((n, k) => n + partsOf(k), 0);
    assert.equal(drawCalls(herds.batch), want, `${max} animals of ${[...kinds]} cost ${drawCalls(herds.batch)}`);
    bill.push(drawCalls(herds.batch));
    herd.dispose();
  }
  assert.equal(bill[0], partsOf(plan[0].kind), 'one animal costs its own parts');
  const all = AMBIENT_SPECIES.reduce((n, k) => n + partsOf(k), 0);
  assert.equal(bill[bill.length - 1], all);
  // Four islands of it are the same bill again.
  const four = [[0, 0], [150, 0], [0, 150], [150, 150]].map((o, i) => herds.forIsland({ region: regionOf(it, o, `i${i}`), fields: it.fields }));
  for (const h of four) h.update(FRAME);
  assert.equal(four.reduce((n, h) => n + h.count(), 0), plan.length * 4);
  assert.equal(drawCalls(herds.batch), all, 'a second island put its sheep in meshes of their own');
  console.info(`# ambient: ${plan.length} animals on one island, ${plan.length * 4} on four: ${all} draw calls either way`);
  herds.dispose();
});

test('nobody is drawn while the chronicle is scrubbed back, nor far from the eye', () => {
  const it = island();
  const herds = createHerds({ scene: new THREE.Scene(), material: material() });
  const herd = herds.forIsland({ region: regionOf(it), fields: it.fields });
  herd.update(FRAME);
  const shown = drawCalls(herds.batch);
  assert.ok(shown > 0);
  const before = herd.animals().map((a) => [a.x, a.z]);
  for (let i = 0; i < 90; i++) herd.update(FRAME, { showing: false });
  assert.equal(drawCalls(herds.batch), 0, 'a scrubbed chronicle still shows the sheep');
  assert.ok(herd.animals().every((a) => !a.drawn));
  // And not stepped while nobody can see them: back to exactly where they were.
  assert.deepEqual(herd.animals().map((a) => [a.x, a.z]), before);
  herd.update(FRAME, { showing: true });
  assert.equal(drawCalls(herds.batch), shown);
  // Far from the eye they go too, and come back when it does.
  herd.update(FRAME, { eye: { x: FAR * 3, y: 40, z: 0 } });
  assert.equal(drawCalls(herds.batch), 0, 'animals drawn from across the sea');
  herd.update(FRAME, { eye: { x: 0, y: 20, z: 0 } });
  assert.equal(drawCalls(herds.batch), shown);
  herds.dispose();
});

test('a re-plan keeps whoever is still in their place, and welcomes a new hut', () => {
  const it = island();
  const herds = createHerds({ scene: new THREE.Scene(), material: material() });
  const region = regionOf(it);
  const herd = herds.forIsland({ region, fields: it.fields });
  for (let i = 0; i < 120; i++) herd.update(FRAME);
  const before = new Map(herd.animals().map((a) => [a.id, a]));
  // The next scan: a new village object, one hut more.
  region.village = { ...it.village, buildings: [...it.village.buildings] };
  herd.update(FRAME);
  for (const a of herd.animals()) {
    const b = before.get(a.id);
    assert.ok(b, `${a.id} appeared out of nowhere`);
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.1, `${a.id} jumped on a re-plan`);
  }
  assert.equal(herd.count(), before.size);
  // Take every hut away and the hens go with them; nobody else does.
  region.village = { ...it.village, buildings: [] };
  herd.update(FRAME);
  assert.ok(herd.animals().every((a) => a.kind !== 'chicken'));
  assert.equal(herd.count(), [...before.values()].filter((a) => a.kind !== 'chicken').length);
  herds.dispose();
});

test('disposing gives back every slot, and the batch its meshes', () => {
  const it = island();
  const scene = new THREE.Scene();
  const herds = createHerds({ scene, material: material() });
  const meshes = scene.children.length;
  assert.equal(meshes, AMBIENT_SPECIES.reduce((n, k) => n + partsOf(k), 0), 'one InstancedMesh per species and part');
  const a = herds.forIsland({ region: regionOf(it, [0, 0], 'a'), fields: it.fields });
  const b = herds.forIsland({ region: regionOf(it, [150, 0], 'b'), fields: it.fields });
  a.update(FRAME); b.update(FRAME);
  a.dispose();
  // Their slots are free for the next island's animals, and b is still standing.
  const owned = () => [...herds.batch.kinds.values()].reduce((n, k) => n + k.owners.filter(Boolean).length, 0);
  assert.equal(owned(), b.count());
  assert.equal(a.count(), 0);
  b.dispose();
  assert.equal(owned(), 0);
  assert.equal(drawCalls(herds.batch), 0);
  let freed = 0;
  for (const m of herds.batch.meshes) m.geometry.addEventListener('dispose', () => { freed++; });
  herds.dispose();
  assert.equal(freed, meshes, 'a part geometry was left behind');
  assert.equal(scene.children.length, 0, 'the batch left meshes in the scene');
});

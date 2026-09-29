// Every building on an island in one BatchedMesh (web/js/record-batch.js,
// Plans/gebouwen-in-een-batch.md). The batch mirrors each record's stand-in - its visibility up
// the scene graph, its layer mask, its matrix - so everything that shows, hides or moves a house
// keeps writing the record's group and never learns the batch is there. These drive the mirror
// the way a render does (onBeforeRender with a renderer's frame counter), with real three.js
// objects and real buildings, and no WebGL context.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader at import time; the sheets never arrive here.
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
};
const THREE = await import('three');
const { createRecordBatch, pickedId } = await import('../web/js/record-batch.js');
const { buildBuilding, createBuildingMaterial } = await import('../web/js/buildings.js');
const { keepRecord, maskGroup, unmaskGroup } = await import('../web/js/record-cull.js');
const { CULL_PAD } = await import('../web/js/fade.js');

const material = createBuildingMaterial();
const house = (i, tier = 'cottage') => buildBuilding({ id: `house:${i}`, kind: 'house', style: ['opus', 'sonnet', 'haiku'][i % 3], tier, name: `h${i}` });

// A render, as far as the batch can tell: three's updateMatrixWorld, then the batch's own
// onBeforeRender with a renderer whose frame counter has moved on.
const renderer = { info: { render: { frame: 0 } } };
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(0, 40, 60);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
function render(scene, batch) {
  scene.updateMatrixWorld();
  renderer.info.render.frame++;
  batch.mesh.onBeforeRender(renderer, scene, camera, batch.mesh.geometry, batch.mesh.material, null);
}
// A record the way makeRecord builds one: a group at the plot, the stand-in inside it.
function record(scene, batch, i, x = 0, z = 0) {
  const built = house(i);
  const positions = built.geometry.attributes.position.array.slice();
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const stand = batch.add(built.geometry);
  built.geometry = null;
  stand.userData.id = `house:${i}`;
  group.add(stand);
  scene.add(group);
  return { id: `house:${i}`, group, mesh: stand, built, positions };
}
const matrixOf = (batch, stand) => {
  const inst = [...Array(batch.mesh.maxInstanceCount).keys()].find((k) => batch.mesh.recordIdAt(k) === stand.userData.id);
  return { inst, m: batch.mesh.getMatrixAt(inst, new THREE.Matrix4()) };
};

test('a house is drawn where its group stands, once the batch has seen it, and not before', () => {
  const scene = new THREE.Scene();
  const batch = createRecordBatch({ material, parent: scene });
  const rec = record(scene, batch, 1, 12, -7);
  rec.group.rotation.y = 1.1;
  const { inst } = matrixOf(batch, rec.mesh);
  assert.equal(batch.mesh.getVisibleAt(inst), false, 'drawn before the batch knew where it stands - at the origin');
  render(scene, batch);
  assert.equal(batch.mesh.getVisibleAt(inst), true);
  const { m } = matrixOf(batch, rec.mesh);
  rec.mesh.updateWorldMatrix(true, false);
  assert.deepEqual(m.elements.map((v) => +v.toFixed(6)), rec.mesh.matrixWorld.elements.map((v) => +v.toFixed(6)));
});

test('the batch keeps the only copy: the geometry handed in is disposed, and its shape comes back out whole', () => {
  const scene = new THREE.Scene();
  const batch = createRecordBatch({ material, parent: scene });
  const built = house(2);
  let gone = false;
  built.geometry.addEventListener('dispose', () => { gone = true; });
  const want = built.geometry.attributes.position.array.slice();
  const stand = batch.add(built.geometry);
  assert.ok(gone, 'the loose geometry is kept beside the batch - every house in memory twice');
  const copy = batch.positionsOf(stand);
  assert.deepEqual([...copy.attributes.position.array], [...want]);
  assert.ok(copy.boundingSphere.radius > 0);
  copy.dispose();
});

test('whatever hides a house hides its instance: its group, a parent, the cut, leaving the scene', () => {
  const scene = new THREE.Scene();
  const island = new THREE.Group();
  scene.add(island);
  const batch = createRecordBatch({ material, parent: scene });
  const rec = record(scene, batch, 3);
  scene.remove(rec.group);
  island.add(rec.group);
  const { inst } = matrixOf(batch, rec.mesh);
  const shown = () => { render(scene, batch); return batch.mesh.getVisibleAt(inst); };
  assert.equal(shown(), true);
  // applyVisibility: a filter, the chronicle, a house still to pop in.
  rec.group.visible = false;
  assert.equal(shown(), false);
  rec.group.visible = true;
  assert.equal(shown(), true);
  island.visible = false;
  assert.equal(shown(), false, 'a hidden parent further up still showed the house');
  island.visible = true;
  // record-cull.js: Object Distance's cut, and a whole island's, in either order.
  maskGroup(rec.group);
  assert.equal(shown(), false);
  maskGroup(rec.group, 'far');
  unmaskGroup(rec.group);
  assert.equal(shown(), false, 'the island is still cut');
  unmaskGroup(rec.group, 'far');
  assert.equal(shown(), true);
  // Taken out of the scene (disposeRecord's scene.remove) and not yet out of the batch.
  island.remove(rec.group);
  assert.equal(shown(), false);
});

test('keepRecord past Object Distance takes the house out of the batch, and brings it back', () => {
  const scene = new THREE.Scene();
  const batch = createRecordBatch({ material, parent: scene });
  const rec = record(scene, batch, 4, 100, 0);
  const { inst } = matrixOf(batch, rec.mesh);
  const eye = new THREE.Vector3(0, 0, 0);
  render(scene, batch);
  assert.equal(keepRecord(rec, 100 - CULL_PAD - 5, eye), false);
  render(scene, batch);
  assert.equal(batch.mesh.getVisibleAt(inst), false);
  assert.equal(keepRecord(rec, 200, eye), true);
  render(scene, batch);
  assert.equal(batch.mesh.getVisibleAt(inst), true);
});

test('a house growing in (popIn) moves its instance; one standing still writes nothing', () => {
  const scene = new THREE.Scene();
  const batch = createRecordBatch({ material, parent: scene });
  const rec = record(scene, batch, 5, 3, 3);
  render(scene, batch);
  const tex = batch.mesh._matricesTexture;
  const v0 = tex.version;
  render(scene, batch);
  assert.equal(tex.version, v0, 'a house that did not move re-uploaded the matrices');
  rec.group.scale.setScalar(0.4);
  render(scene, batch);
  assert.ok(tex.version > v0);
  const { m } = matrixOf(batch, rec.mesh);
  assert.ok(Math.abs(new THREE.Vector3().setFromMatrixScale(m).x - 0.4) < 1e-6);
});

test('the mirror runs once per render, whichever pass asks first', () => {
  const scene = new THREE.Scene();
  const batch = createRecordBatch({ material, parent: scene });
  const rec = record(scene, batch, 6);
  render(scene, batch);
  // The shadow pass asks through onBeforeShadow, the colour pass straight after, same frame.
  rec.group.position.x = 9;
  scene.updateMatrixWorld();
  batch.mesh.onBeforeShadow(renderer, rec.mesh, camera, camera, batch.mesh.geometry, material, null);
  const { m } = matrixOf(batch, rec.mesh);
  assert.equal(m.elements[12], 0, 'synced a second time within one render');
  render(scene, batch);
  assert.equal(matrixOf(batch, rec.mesh).m.elements[12], 9);
});

test('an island at a berth keeps its batch in its own frame', () => {
  const scene = new THREE.Scene();
  const island = new THREE.Group();
  island.position.set(1432, 0, -864);
  scene.add(island);
  const batch = createRecordBatch({ material, parent: island });
  const rec = record(island, batch, 7, 20, 30);
  render(scene, batch);
  const { m } = matrixOf(batch, rec.mesh);
  assert.deepEqual([m.elements[12], m.elements[13], m.elements[14]].map((v) => +v.toFixed(6)), [20, 0, 30]);
});

test('a ray hits the house it points at and names it; a hidden house is not there to hit', () => {
  const scene = new THREE.Scene();
  const batch = createRecordBatch({ material, parent: scene });
  const a = record(scene, batch, 8, -6, 0);
  const b = record(scene, batch, 9, 6, 0);
  render(scene, batch);
  const ray = new THREE.Raycaster(new THREE.Vector3(6, 30, 0), new THREE.Vector3(0, -1, 0));
  let hits = ray.intersectObject(batch.mesh, false);
  assert.ok(hits.length > 0);
  assert.equal(pickedId(hits[0]), b.id);
  b.group.visible = false;
  render(scene, batch);
  hits = ray.intersectObject(batch.mesh, false);
  assert.equal(hits.length, 0, 'a hidden house could still be clicked');
  ray.set(new THREE.Vector3(-6, 30, 0), new THREE.Vector3(0, -1, 0));
  assert.equal(pickedId(ray.intersectObject(batch.mesh, false)[0]), a.id);
  // And anything that is still a mesh of its own - a dock, a guest's ground - reads as before.
  const dock = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
  dock.userData.id = 'dock:1';
  dock.updateMatrixWorld();
  ray.set(new THREE.Vector3(0, 30, 0), new THREE.Vector3(0, -1, 0));
  assert.equal(pickedId(ray.intersectObject(dock, false)[0]), 'dock:1');
});

test('houses coming and going: every survivor keeps its shape and place through a compaction and a growth', () => {
  const scene = new THREE.Scene();
  // Small on purpose, so it has to compact and grow.
  const batch = createRecordBatch({ material, parent: scene, instances: 4, vertices: 20000 });
  const recs = [];
  for (let i = 0; i < 12; i++) recs.push(record(scene, batch, 10 + i, i * 4, 0));
  for (const r of recs.filter((_, i) => i % 3 === 0)) { batch.remove(r.mesh); scene.remove(r.group); }
  const kept = recs.filter((_, i) => i % 3 !== 0);
  assert.ok(batch.stats().dead > 0);
  // A verbouwing: out, and in again bigger.
  for (let i = 0; i < 10; i++) kept.push(record(scene, batch, 40 + i, 0, i * 4));
  render(scene, batch);
  for (const r of kept) {
    assert.deepEqual([...batch.positionsOf(r.mesh).attributes.position.array], [...r.positions], `${r.id} lost its shape`);
    const { m } = matrixOf(batch, r.mesh);
    assert.deepEqual([m.elements[12], m.elements[14]], [r.group.position.x, r.group.position.z], `${r.id} moved`);
  }
  assert.equal(batch.stats().instances, kept.length);
  assert.ok(batch.stats().room >= batch.stats().vertices);
});

test('one shape for many instances: a yard sign frame, drawn twice, taken out once', () => {
  const scene = new THREE.Scene();
  const batch = createRecordBatch({ material, parent: scene });
  let made = 0;
  const frame = () => { made++; const g = new THREE.BoxGeometry(0.8, 0.3, 0.03).toNonIndexed(); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.5), 3)); g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1)); g.deleteAttribute('uv'); return g; };
  record(scene, batch, 60);
  const s1 = batch.addShared('sign', frame), s2 = batch.addShared('sign', frame);
  assert.equal(made, 1);
  scene.add(s1, s2);
  render(scene, batch);
  batch.remove(s1);
  render(scene, batch);
  const hits = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)).intersectObject(batch.mesh, false);
  assert.ok(hits.some((h) => batch.mesh.recordIdAt(h.batchId) !== undefined), 'the second sign went with the first');
});

test('a building without a sheet sits in the same batch as one with', () => {
  const scene = new THREE.Scene();
  const batch = createRecordBatch({ material, parent: scene });
  const g = new THREE.BoxGeometry().toNonIndexed();
  g.deleteAttribute('uv');
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  g.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  record(scene, batch, 70);
  assert.doesNotThrow(() => batch.add(g));
});

test('an empty batch is not drawn, and a full one is', () => {
  const scene = new THREE.Scene();
  const batch = createRecordBatch({ material, parent: scene });
  assert.equal(batch.mesh.visible, false);
  const rec = record(scene, batch, 80);
  assert.equal(batch.mesh.visible, true);
  batch.remove(rec.mesh);
  assert.equal(batch.mesh.visible, false);
  assert.equal(batch.mesh.frustumCulled, false, 'three computes a batch\'s sphere once - a growing village would be culled whole');
  assert.ok(batch.mesh.castShadow && batch.mesh.receiveShadow);
});

// The page, read as source: main.js and guest-island.js import three and boot a page, and the
// batch is only a win if every house goes through it.
test('every house on every island goes into a batch, and nothing gives one a mesh of its own', () => {
  const main = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  const make = main.slice(main.indexOf('\nfunction makeRecord('), main.indexOf('\nfunction attachExtras('));
  assert.match(make, /homeBatch\.add\(built\.geometry\)/);
  assert.doesNotMatch(make, /new THREE\.Mesh\(built\.geometry/);
  assert.match(main, /return b \? pickedId\(b\) : null;/, 'pick() reads a hit\'s id without asking the batch');
  const guest = readFileSync(new URL('../web/js/guest-island.js', import.meta.url), 'utf8');
  assert.match(guest, /batch\.add\(built\.geometry\)/);
  assert.doesNotMatch(guest, /new THREE\.Mesh\(built\.geometry/);
  const plan = readFileSync(new URL('../web/js/plan-mode.js', import.meta.url), 'utf8');
  assert.match(plan, /pickedId\(h\)/, 'the planner picks a house by the batch');
});

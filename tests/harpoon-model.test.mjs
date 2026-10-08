// The harpoon gun's model (web/models/harpoon.glb, web/js/harpoon.js, Plans/harpoen.md): fetched after
// the boot like the captain, so the same rules are asserted - nothing fetched at import, the address
// through modelUrl, a failure said once. And the file: the four nodes nested as they move, light
// enough to fetch, its credits beside its source, and a gun that turns and lifts the way it is aimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const fetched = [];
globalThis.fetch = (url) => { fetched.push(String(url && url.url ? url.url : url)); return Promise.reject(new Error('no network in a test')); };
const THREE = await import('three');
const harpoon = await import('../web/js/harpoon.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'web/js/harpoon.js'), 'utf8');
const GLB = path.join(ROOT, 'web/models', harpoon.HARPOON_FILE);

function gltfJson(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 0, 4), 'glTF');
  return JSON.parse(b.slice(20, 20 + b.readUInt32LE(12)).toString('utf8'));
}
const json = gltfJson(GLB);

test('importing the harpoon fetches nothing, and its loader is a dynamic import through modelUrl', () => {
  assert.equal(fetched.length, 0);
  assert.deepEqual(harpoon.harpoonState(), { loading: false, ready: false, failed: false });
  assert.match(SRC, /modelUrl\(HARPOON_FILE\)/);
  assert.doesNotMatch(SRC, /^import .*GLTFLoader/m);
});

test('a refused load is said once and never tried again', async () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    assert.equal(harpoon.harpoonModel(), null);
    for (let i = 0; i < 200 && !harpoon.harpoonState().failed; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(harpoon.harpoonState().failed, true);
    const asked = fetched.length;
    assert.equal(harpoon.harpoonModel(), null);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(fetched.length, asked);
    assert.equal(warned.filter((w) => /harpoon/.test(w)).length, 1);
  } finally {
    console.warn = realWarn;
  }
});

test('the file is light: under 1.2 MB, 8000 triangles, 512 textures and no occlusion maps', () => {
  assert.ok(fs.statSync(GLB).size < 1.2e6, `${fs.statSync(GLB).size} bytes`);
  let tris = 0;
  for (const m of json.meshes) for (const p of m.primitives) tris += json.accessors[p.indices].count / 3;
  assert.ok(tris <= 8000, `${tris} triangles`);
  for (const mat of json.materials) assert.equal(mat.occlusionTexture, undefined, mat.name);
  for (const img of json.images) assert.equal(img.mimeType, 'image/jpeg');
});

test('its source and credits are kept beside each other, and the credits name the source as it is', () => {
  const dir = path.join(ROOT, 'assets/harpoon');
  const credits = fs.readFileSync(path.join(dir, 'CREDITS.md'), 'utf8');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'source-harpoon.glb'))).digest('hex');
  assert.ok(credits.includes(sha), 'the sha256 in CREDITS.md is the committed source');
  const extras = gltfJson(path.join(dir, 'source-harpoon.glb')).asset.extras;
  assert.match(extras.license, /CC-BY-4\.0/);
  assert.ok(credits.includes('J.D.Productions') && credits.includes('CC BY 4.0'));
});

// The GLB's nodes as Object3Ds, without its meshes or textures (no image decoder under Node).
function skeleton() {
  const objs = json.nodes.map((n) => {
    const o = new THREE.Group();
    o.name = n.name || '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => objs[i].add(objs[c])));
  const root = new THREE.Group();
  for (const i of json.scenes[0].nodes) root.add(objs[i]);
  return root;
}

test('the four nodes hang from each other as they move', () => {
  const root = skeleton();
  const N = harpoon.HARPOON_NODES;
  assert.equal(root.getObjectByName(N.yoke).parent.name, N.mount);
  assert.equal(root.getObjectByName(N.gun).parent.name, N.yoke);
  assert.equal(root.getObjectByName(N.bolt).parent.name, N.gun);
  assert.equal(root.getObjectByName(N.muzzle).parent.name, N.gun);
});

test('aimed straight it points ahead at a chest\'s height; yaw swings it, pitch lifts it', () => {
  const gun = harpoon.makeHarpoonGun(skeleton());
  const dir = new THREE.Vector3(), at = new THREE.Vector3();
  gun.object.updateMatrixWorld(true);
  gun.aimDir(dir);
  assert.ok(dir.z > 0.999, `ahead ${dir.toArray()}`);
  gun.muzzleAt(at);
  assert.ok(at.y > 0.25 && at.y < 0.4 && at.z > 0.1, `muzzle ${at.toArray()}`);
  gun.aim(0.5, 0);
  gun.object.updateMatrixWorld(true);
  gun.aimDir(dir);
  assert.ok(Math.abs(dir.x - Math.sin(0.5)) < 1e-6 && Math.abs(dir.y) < 1e-6);
  gun.aim(0, 0.3);
  gun.object.updateMatrixWorld(true);
  gun.aimDir(dir);
  assert.ok(Math.abs(dir.y - Math.sin(0.3)) < 1e-6, `lifted ${dir.toArray()}`);
});

test('the house-style bake keeps the GLB\'s frame, so the page can draw either on the same numbers', async () => {
  const { HARPOON } = await import('../web/js/harpoon-mesh.js');
  const root = skeleton();
  root.updateMatrixWorld(true);
  const world = (name) => root.getObjectByName(name).getWorldPosition(new THREE.Vector3());
  const N = harpoon.HARPOON_NODES;
  const at = (p) => new THREE.Vector3().fromArray(HARPOON.parts[`harpoon ${p}:0`].at);
  assert.ok(at('gun').distanceTo(world(N.gun)) < 0.002, `trunnion ${at('gun').toArray()} / ${world(N.gun).toArray()}`);
  assert.ok(at('bolt').distanceTo(world(N.bolt)) < 0.002, `bolt tail ${at('bolt').toArray()} / ${world(N.bolt).toArray()}`);
  const muzzle = new THREE.Vector3().fromArray(HARPOON.anchors.muzzle);
  assert.ok(muzzle.distanceTo(world(N.muzzle)) < 0.002, `muzzle ${muzzle.toArray()} / ${world(N.muzzle).toArray()}`);
  assert.ok(Math.abs(at('yoke').x) < 1e-9 && Math.abs(at('yoke').z) < 1e-9, 'the yoke turns on the axis of the pedestal');
});

test('the baked gun is put together on the same frame and aims the same way', async () => {
  const { HARPOON } = await import('../web/js/harpoon-mesh.js');
  const at = Object.fromEntries(harpoon.HARPOON_PIECES.map((k) => [k, HARPOON.parts[`harpoon ${k}:0`].at]));
  at.muzzle = HARPOON.anchors.muzzle;
  const gun = harpoon.bakedHarpoonGun(() => new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial(), at);
  gun.object.updateMatrixWorld(true);
  const p = gun.muzzleAt(), dir = gun.aimDir();
  assert.ok(p.distanceTo(new THREE.Vector3().fromArray(at.muzzle)) < 1e-9);
  assert.ok(dir.z > 0.999);
  gun.aim(-0.4, 0.25);
  gun.object.updateMatrixWorld(true);
  gun.aimDir(dir);
  assert.ok(Math.abs(dir.y - Math.sin(0.25)) < 1e-6 && dir.x < -0.3, `${dir.toArray()}`);
});

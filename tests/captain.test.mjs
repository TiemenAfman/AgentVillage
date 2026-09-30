// Captain Spack Jarrow (web/js/captain.js, Plans/piratenkroeg.md): the second fetched model on the
// island after the lava imp, so the imp's rules are asserted rather than trusted - nothing fetched
// at import, the address through modelUrl, a failure said once and never retried, nothing waiting.
// And the file itself, as it was chosen: kept whole, no rig, no animation, small enough to fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const fetched = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (url) => { fetched.push(String(url && url.url ? url.url : url)); return Promise.reject(new Error('no network in a test')); };
const THREE = await import('three');
const captain = await import('../web/js/captain.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, '..', 'web', 'js', 'captain.js'), 'utf8');
const GLB = path.join(HERE, '..', 'web', 'models', captain.CAPTAIN_FILE);

test('importing the captain fetches nothing', () => {
  assert.equal(fetched.length, 0);
  assert.deepEqual(captain.captainState(), { loading: false, ready: false, failed: false });
});

test('his address goes through modelUrl, and no loader is imported at the top', () => {
  assert.match(SRC, /modelUrl\(CAPTAIN_FILE\)/);
  assert.doesNotMatch(SRC, /^import .*GLTFLoader/m, 'the loader is a dynamic import');
  assert.match(SRC, /import\('three\/addons\/loaders\/GLTFLoader\.js'\)/);
});

test('a refused load is said once and never tried again', async () => {
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    assert.equal(captain.captainModel(), null, 'nothing waits: the first ask answers at once');
    for (let i = 0; i < 200 && !captain.captainState().failed; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(captain.captainState().failed, true);
    const asked = fetched.length;
    assert.ok(asked >= 1 && fetched.every((u) => u.endsWith(captain.CAPTAIN_FILE)), `asked for ${fetched}`);
    assert.equal(captain.captainModel(), null);
    assert.equal(captain.captainModel(), null);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(fetched.length, asked, 'not tried again');
    assert.equal(warned.filter((w) => /captain/.test(w)).length, 1, 'said once');
  } finally {
    console.warn = realWarn;
  }
});

test('he is made 0.55 tall, feet on the floor, centred on his spot', () => {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(40, 200, 30).translate(7, 100 + 3, -2), new THREE.MeshStandardMaterial()));
  const held = captain.prepareCaptain(root);
  held.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(held);
  assert.ok(Math.abs(box.max.y - box.min.y - captain.CAPTAIN_HEIGHT) < 1e-6);
  assert.ok(Math.abs(box.min.y) < 1e-6);
  assert.ok(Math.abs(box.min.x + box.max.x) < 1e-6 && Math.abs(box.min.z + box.max.z) < 1e-6);
  root.traverse((o) => { if (o.isMesh) { assert.equal(o.castShadow, false); assert.equal(o.material.fog, true); } });
});

test('the model is the one chosen, kept whole: five meshes, textured, no rig, under a megabyte', () => {
  const buf = fs.readFileSync(GLB);
  assert.ok(buf.length < 1024 * 1024, `${buf.length} bytes`);
  assert.equal(buf.readUInt32LE(0), 0x46546c67, 'a binary glTF');
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  assert.equal(json.meshes.length, 5);
  assert.equal(json.skins, undefined);
  assert.equal(json.animations, undefined);
  assert.ok(json.images && json.images.length >= 4, 'its own textures');
  let tris = 0, lo = Infinity, hi = -Infinity;
  for (const m of json.meshes) {
    for (const p of m.primitives) {
      tris += json.accessors[p.indices].count / 3;
      const a = json.accessors[p.attributes.POSITION];
      lo = Math.min(lo, a.min[2]); hi = Math.max(hi, a.max[2]);
    }
  }
  assert.ok(tris > 10000 && tris < 11000, `${tris} triangles, not decimated`);
  // Z-up under a root that turns it Y-up: about 200 of its own units tall, which the 0.55 comes from.
  assert.ok(hi - lo > 190 && hi - lo < 210, `${hi - lo} tall`);
});

test.after(() => { globalThis.fetch = realFetch; });

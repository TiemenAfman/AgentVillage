// Models that exist on this machine only (HOME/models/, listed in local-models.json) and are
// never baked: a bought or borrowed asset may not go into the repo, a release or a bundle.
// They are fetched like the volcano's imp - GLTFLoader imported dynamically, only after the
// boot - and nothing waits for them; a failure is logged once and the island is unchanged.
// Only the keeper's own page gets them (the routes are not on PUBLIC_API), and they stand
// in our scene only: no sea, no neighbour and no visitor ever sees one.
//
// An entry: { file, side: 'n'|'e'|'s'|'w', gap, scale, rot, y, hide: [material names] }.
// It stands `gap` units off the coast on that side (the last ground or shallows from the
// middle outwards, not the grid edge: a grown grid is mostly sea), footprint centred there,
// scaled from the model's metres (a unit is 4 m, so 0.25 is true size).
import * as THREE from 'three';
import { mine, mineUrl } from './api.js';

// Water shallower than this still reads as coast, or the model lands in the surf.
const SHALLOWS = -0.6;
const SIDES = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

export async function loadLocalModels({ scene, terrain }) {
  let list;
  try {
    const r = await mine('/api/local-models');
    if (!r.ok) return [];
    list = (await r.json()).models || [];
  } catch { return []; }
  if (!list.length) return [];
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const placed = [];
  for (const m of list) {
    try {
      const gltf = await loader.loadAsync(mineUrl(`/api/local-model/${encodeURIComponent(m.file)}`));
      placed.push(place(gltf.scene, m, terrain, scene));
    } catch (e) {
      console.warn(`local model ${m.file} could not be loaded`, e);
    }
  }
  return placed;
}

function place(root, m, terrain, scene) {
  const hide = new Set(m.hide || []);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((mt) => hide.has(mt.name))) { o.visible = false; return; }
    // A million triangles cast into the sun's shadow map is the whole model drawn twice.
    o.castShadow = false;
    o.receiveShadow = true;
  });
  const scale = m.scale ?? 0.25;
  const group = new THREE.Group();
  group.name = `local:${m.file}`;
  root.scale.setScalar(scale);
  root.rotation.y = ((m.rot || 0) * Math.PI) / 180;
  group.add(root);
  // Centre the visible footprint on the spot, so the model's own origin does not matter.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((o) => { if (o.isMesh && o.visible) box.expandByObject(o); });
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  root.position.set(-c.x, m.y ?? 0, -c.z);
  const [dx, dz] = SIDES[m.side || 'e'] || SIDES.e;
  let coast = 0;
  for (let r = 0; r <= terrain.half; r += 1) {
    if (terrain.worldHeight(dx * r, dz * r) > SHALLOWS) coast = r;
  }
  const off = coast + (m.gap ?? 20) + (dx ? size.x : size.z) / 2;
  group.position.set(dx * off, 0, dz * off);
  scene.add(group);
  console.info(`local model ${m.file} at ${Math.round(dx * off)}, ${Math.round(dz * off)} (coast at ${coast})`);
  return group;
}
